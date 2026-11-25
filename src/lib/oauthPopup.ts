import { apiRequest } from '../services/api';
import type { UserProfile } from '../types/commerce';

export const OAUTH_BROADCAST_CHANNEL = 'novara_oauth_channel';

export type OAuthPopupProvider = 'google' | 'facebook';

export type OAuthPopupEvent =
  | {
      type: 'OAUTH_AUTH_SUCCESS';
      provider: OAuthPopupProvider;
      exchangeCode?: string;
      targetOrigin?: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_LINK_SUCCESS';
      provider: OAuthPopupProvider;
      exchangeCode?: string;
      targetOrigin?: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_EMAIL_REQUIRED';
      provider: 'facebook';
      challengeToken: string;
      name?: string;
      picture?: string;
      targetOrigin?: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_LINK_REQUIRED';
      provider: OAuthPopupProvider;
      pendingLinkToken: string;
      emailHint: string;
      existingHasPassword?: boolean;
      existingInitialProvider?: string;
      targetOrigin?: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_AUTH_ERROR';
      provider: OAuthPopupProvider;
      error?: string;
      targetOrigin?: string;
    };

export function isRunningInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function openOAuthPopupWindow(url: string, windowName: string): Window | null {
  const width = 520;
  const height = 640;
  const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
  const left = Math.max(0, Math.round(dualScreenLeft + (viewportWidth - width) / 2));
  const top = Math.max(0, Math.round(dualScreenTop + (viewportHeight - height) / 2));

  return window.open(
    url,
    windowName,
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
}

export async function requestOAuthAuthorizationUrl(params: {
  provider: OAuthPopupProvider;
  returnTo: string;
  intent?: 'login' | 'link';
}): Promise<{ url: string; flowVerifier: string }> {
  const query = new URLSearchParams({
    returnTo: params.returnTo,
    parentOrigin: window.location.origin,
  });
  if (params.intent === 'link') {
    query.set('intent', 'link');
  }
  const res = await apiRequest<{ ok: true; url: string; flowVerifier?: string }>(
    `/api/auth/oauth/${params.provider}/url?${query.toString()}`,
  );
  return {
    url: res.url,
    flowVerifier: res.flowVerifier || '',
  };
}

export async function exchangeOAuthPopupCode(params: {
  exchangeCode: string;
  flowVerifier: string;
}): Promise<{ user: UserProfile; token: string; provider: OAuthPopupProvider; returnTo?: string }> {
  return apiRequest<{
    ok: true;
    user: UserProfile;
    token: string;
    provider: OAuthPopupProvider;
    returnTo?: string;
  }>('/api/auth/oauth/exchange', {
    method: 'POST',
    body: JSON.stringify({
      exchangeCode: params.exchangeCode,
      flowVerifier: params.flowVerifier,
    }),
  });
}

function isOAuthEventPayload(data: unknown): data is OAuthPopupEvent {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return (
    type === 'OAUTH_AUTH_SUCCESS' ||
    type === 'OAUTH_LINK_SUCCESS' ||
    type === 'OAUTH_EMAIL_REQUIRED' ||
    type === 'OAUTH_LINK_REQUIRED' ||
    type === 'OAUTH_AUTH_ERROR'
  );
}

export function subscribeOAuthPopupEvents(params: {
  popupRef: { current: Window | null };
  onEvent: (event: OAuthPopupEvent) => void | Promise<void>;
}): () => void {
  const handlePostMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (params.popupRef.current && event.source && event.source !== params.popupRef.current) return;
    if (!isOAuthEventPayload(event.data)) return;
    void params.onEvent(event.data);
  };

  window.addEventListener('message', handlePostMessage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        if (!isOAuthEventPayload(event.data)) return;
        if (event.data.targetOrigin && event.data.targetOrigin !== window.location.origin) return;
        void params.onEvent(event.data);
      };
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener('message', handlePostMessage);
    if (channel) {
      try {
        channel.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}
