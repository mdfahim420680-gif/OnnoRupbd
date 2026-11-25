import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  SingleFlightCoordinator,
  adminCache,
  invalidateAdminOrderCaches,
  invalidateAdminProductCaches,
  invalidateSecurityPolicyCache,
  storefrontCache,
} from '../utils/ttlCache';
import { sendTransactionalEmailWithRetry } from './email.service';
import { comparePasswordAsync, hashPasswordAsync } from '../modules/auth/passwordWorker';
import { integrations } from '../config/env';

test('SingleFlightCoordinator deduplicates concurrent identical keys and cleans up on error', async () => {
  const sf = new SingleFlightCoordinator();
  let executions = 0;

  const work = async () => {
    executions += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { count: executions };
  };

  const [a, b, c] = await Promise.all([sf.run('k1', work), sf.run('k1', work), sf.run('k1', work)]);
  assert.equal(executions, 1);
  assert.deepEqual(a, { count: 1 });
  assert.deepEqual(b, { count: 1 });
  assert.deepEqual(c, { count: 1 });
  assert.equal(sf.pendingCount, 0);

  // Subsequent run executes cleanly after previous settled
  const d = await sf.run('k1', work);
  assert.equal(executions, 2);
  assert.deepEqual(d, { count: 2 });

  // Rejected work still cleans up entry
  await assert.rejects(
    sf.run('fail-key', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(sf.pendingCount, 0);
});

test('Domain-scoped cache invalidators evict only targeted prefixes without cross-domain wipes', () => {
  adminCache.clear();
  storefrontCache.clear();

  adminCache.set('order-stats:all', { total: 10 }, 10_000);
  adminCache.set('overview:7d', { sales: 500 }, 10_000);
  adminCache.set('products:list', { items: [] }, 10_000);
  adminCache.set('categories:tree', { items: [] }, 10_000);
  adminCache.set('low-stock', [{ id: '1' }], 10_000);

  invalidateAdminOrderCaches();
  assert.equal(adminCache.get('order-stats:all'), null);
  assert.equal(adminCache.get('overview:7d'), null);
  // Products/categories remain warm when an order mutates
  assert.ok(adminCache.get('products:list'));
  assert.ok(adminCache.get('categories:tree'));

  invalidateAdminProductCaches();
  assert.equal(adminCache.get('low-stock'), null);
  assert.ok(adminCache.get('categories:tree'));

  storefrontCache.set('security:policy', { lockout: 5 }, 10_000);
  storefrontCache.set('catalog:home', { hero: [] }, 10_000);
  invalidateSecurityPolicyCache();
  assert.equal(storefrontCache.get('security:policy'), null);
  assert.ok(storefrontCache.get('catalog:home'));
});

test('sendTransactionalEmailWithRetry retries transient 5xx responses, stops on 4xx, and deduplicates idempotency keys', async () => {
  const prevResend = integrations.resend;
  integrations.resend = true;
  try {
    let attempts = 0;
    const waits: number[] = [];

    const retryResult = await sendTransactionalEmailWithRetry(
      {
        to: 'customer@example.com',
        subject: 'Order Confirmed',
        html: '<p>Confirmed</p>',
        template: 'order_confirmed',
        idempotencyKey: `perf-test-retry-${Date.now()}`,
      },
      {
        maxAttempts: 3,
        backoffBaseMs: 50,
        waitFn: async (ms) => {
          waits.push(ms);
        },
        sendImpl: async () => {
          attempts += 1;
          if (attempts === 1) {
            return new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 });
          }
          return new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 });
        },
      },
    );

    assert.equal(retryResult.status, 'sent');
    assert.equal(retryResult.id, 'resend-msg-1');
    assert.equal(attempts, 2);
    assert.deepEqual(waits, [50]);

    // Same idempotencyKey within TTL returns deduplicated without hitting sendImpl
    let dedupeCalls = 0;
    const dedupeKey = `perf-test-dedupe-${Date.now()}`;
    await sendTransactionalEmailWithRetry(
      {
        to: 'customer@example.com',
        subject: 'Order',
        html: '<p>1</p>',
        template: 'order_confirmed',
        idempotencyKey: dedupeKey,
      },
      {
        sendImpl: async () => {
          dedupeCalls += 1;
          return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
        },
      },
    );
    const second = await sendTransactionalEmailWithRetry(
      {
        to: 'customer@example.com',
        subject: 'Order',
        html: '<p>1</p>',
        template: 'order_confirmed',
        idempotencyKey: dedupeKey,
      },
      {
        sendImpl: async () => {
          dedupeCalls += 1;
          return new Response(JSON.stringify({ id: 'msg-2' }), { status: 200 });
        },
      },
    );
    assert.equal(dedupeCalls, 1);
    assert.equal(second.status, 'deduplicated');

    // Non-retryable 400 fails immediately on attempt 1 without backoff retries
    let badReqAttempts = 0;
    const badReq = await sendTransactionalEmailWithRetry(
      {
        to: 'bad@example.com',
        subject: 'Bad',
        html: '<p>bad</p>',
        template: 'order_confirmed',
        idempotencyKey: `perf-test-400-${Date.now()}`,
      },
      {
        maxAttempts: 3,
        waitFn: async () => {
          throw new Error('Should not wait on 400');
        },
        sendImpl: async () => {
          badReqAttempts += 1;
          return new Response(JSON.stringify({ message: 'Invalid domain' }), { status: 400 });
        },
      },
    );
    assert.equal(badReq.status, 'failed');
    assert.equal(badReqAttempts, 1);
  } finally {
    integrations.resend = prevResend;
  }
});

test('passwordWorker hashPasswordAsync & comparePasswordAsync verify cost-12 bcryptjs compatibility without blocking', async () => {
  const secret = 'OnnoRupbd_Test#2026!';
  const hash = await hashPasswordAsync(secret, 12);
  assert.ok(hash.startsWith('$2b$12$') || hash.startsWith('$2a$12$'));

  const [matchWorker, matchSync, wrongMatch] = await Promise.all([
    comparePasswordAsync(secret, hash),
    bcrypt.compare(secret, hash),
    comparePasswordAsync('wrong-password', hash),
  ]);

  assert.equal(matchWorker, true);
  assert.equal(matchSync, true);
  assert.equal(wrongMatch, false);
});
