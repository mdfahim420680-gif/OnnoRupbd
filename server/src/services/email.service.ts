import { env, integrations } from '../config/env';
import { NotificationRecordModel } from '../modules/support/support.model';
import { isDatabaseReady } from '../database/connection';
import { HomepageConfigModel } from '../modules/cms/cms.model';
import { storefrontCache } from '../utils/ttlCache';

export interface TransactionalEmailParams {
  to: string;
  subject: string;
  html: string;
  template: string;
  idempotencyKey?: string;
}

export interface TransactionalEmailResult {
  status: 'sent' | 'failed' | 'skipped_unconfigured' | 'deduplicated';
  id?: string;
  error?: string;
}

const RESEND_REQUEST_TIMEOUT_MS = 8000;
const RECENT_EMAIL_KEYS = new Map<string, number>();
const MAX_RECENT_KEYS = 1000;
const KEY_TTL_MS = 10 * 60_000;

function acquireEmailIdempotencyKey(key?: string): boolean {
  if (!key) return true;
  const now = Date.now();
  const existingExpiry = RECENT_EMAIL_KEYS.get(key);
  if (existingExpiry && existingExpiry > now) {
    return false;
  }
  if (RECENT_EMAIL_KEYS.size >= MAX_RECENT_KEYS) {
    for (const [k, exp] of RECENT_EMAIL_KEYS.entries()) {
      if (exp <= now || RECENT_EMAIL_KEYS.size >= MAX_RECENT_KEYS) {
        RECENT_EMAIL_KEYS.delete(k);
        if (RECENT_EMAIL_KEYS.size < MAX_RECENT_KEYS * 0.8) break;
      }
    }
  }
  RECENT_EMAIL_KEYS.set(key, now + KEY_TTL_MS);
  return true;
}

function releaseEmailIdempotencyKey(key?: string): void {
  if (key) RECENT_EMAIL_KEYS.delete(key);
}

async function resolveEmailFromHeaders(): Promise<{ from: string; replyTo: string }> {
  const cached = storefrontCache.get<{ from: string; replyTo: string }>('email:sender-settings');
  if (cached) return cached;

  let senderName = 'OnnoRupbd';
  let senderEmail = '';
  let replyTo = '';
  if (isDatabaseReady()) {
    try {
      const config = await HomepageConfigModel.findOne({ key: 'main' })
        .select('emailSettings')
        .lean();
      senderName = String(config?.emailSettings?.senderName || senderName).trim();
      senderEmail = String(config?.emailSettings?.senderEmail || '').trim();
      replyTo = String(config?.emailSettings?.replyTo || '').trim();
    } catch {
      // Use environment fallback when settings cannot be read.
    }
  }
  const resolved = {
    from: senderEmail ? `${senderName} <${senderEmail}>` : env.EMAIL_FROM,
    replyTo,
  };
  if (isDatabaseReady()) {
    storefrontCache.set('email:sender-settings', resolved, 30_000);
  }
  return resolved;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTransactionalEmailWithRetry(
  params: TransactionalEmailParams,
  options?: {
    maxAttempts?: number;
    backoffBaseMs?: number;
    sendImpl?: (url: string, init: RequestInit) => Promise<Response>;
    waitFn?: (ms: number) => Promise<void>;
  },
): Promise<TransactionalEmailResult> {
  if (!acquireEmailIdempotencyKey(params.idempotencyKey)) {
    return { status: 'deduplicated' };
  }

  if (!integrations.resend) {
    if (isDatabaseReady()) {
      await NotificationRecordModel.create({
        to: params.to,
        channel: 'email',
        template: params.template,
        subject: params.subject,
        status: 'skipped_unconfigured',
        error: 'RESEND_API_KEY is not configured.',
      }).catch(() => undefined);
    }
    return { status: 'skipped_unconfigured', error: 'RESEND_API_KEY is not configured.' };
  }

  const { from, replyTo } = await resolveEmailFromHeaders();
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const backoffBaseMs = Math.max(10, options?.backoffBaseMs ?? 250);
  const fetchFn = options?.sendImpl ?? fetch;
  const waitFn = options?.waitFn ?? delay;

  let lastError = 'Unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          from,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (response.ok && data.id) {
        if (isDatabaseReady()) {
          await NotificationRecordModel.create({
            to: params.to,
            channel: 'email',
            template: params.template,
            subject: params.subject,
            status: 'sent',
            providerId: data.id,
          }).catch(() => undefined);
        }
        return { status: 'sent', id: data.id };
      }

      lastError = data.message || `Resend returned HTTP ${response.status}`;
      if (!isRetryableStatus(response.status) || attempt >= maxAttempts) {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network error calling Resend';
      if (attempt >= maxAttempts) {
        break;
      }
    }

    await waitFn(backoffBaseMs * 2 ** (attempt - 1));
  }

  releaseEmailIdempotencyKey(params.idempotencyKey);
  if (isDatabaseReady()) {
    await NotificationRecordModel.create({
      to: params.to,
      channel: 'email',
      template: params.template,
      subject: params.subject,
      status: 'failed',
      error: lastError,
    }).catch(() => undefined);
  }
  return { status: 'failed', error: lastError };
}

export async function sendTransactionalEmail(params: TransactionalEmailParams): Promise<TransactionalEmailResult> {
  return sendTransactionalEmailWithRetry(params);
}

export function dispatchTransactionalEmailInBackground(
  params: TransactionalEmailParams,
  contextLabel?: string,
): void {
  setImmediate(() => {
    void sendTransactionalEmailWithRetry(params)
      .then((res) => {
        if (res.status === 'failed') {
          console.error(`[Email Async] Failed to send ${params.template}${contextLabel ? ` (${contextLabel})` : ''}:`, res.error);
        }
      })
      .catch((err) => {
        console.error(`[Email Async] Unexpected error sending ${params.template}${contextLabel ? ` (${contextLabel})` : ''}:`, err);
      });
  });
}
