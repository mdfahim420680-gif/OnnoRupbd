import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAdminQueryCache,
  createCooldownGuard,
  fetchAdminQuery,
  getAdminQueryCacheStats,
  invalidateAdminCacheByPrefixes,
  invalidateAdminCacheForMutation,
  peekAdminQuery,
  resolveInvalidationPrefixesForMutation,
  setAdminQueryData,
  setAdminQueryScope,
} from './adminQueryCache';

describe('adminQueryCache', () => {
  beforeEach(() => {
    setAdminQueryScope('user-a:admin');
    clearAdminQueryCache();
  });

  it('stores and peeks cached entries with freshness and scope isolation', () => {
    setAdminQueryData('/api/admin/overview?days=30', { sales: 1200 }, { staleTimeMs: 30_000, gcTimeMs: 60_000 });
    const hit = peekAdminQuery<{ sales: number }>('/api/admin/overview?days=30');
    assert.ok(hit);
    assert.equal(hit.data.sales, 1200);
    assert.equal(hit.isFresh, true);

    // Switching user/role scope wipes previous session entries
    const changed = setAdminQueryScope('user-b:staff');
    assert.equal(changed, true);
    assert.equal(peekAdminQuery('/api/admin/overview?days=30'), null);
    assert.equal(getAdminQueryCacheStats().size, 0);
  });

  it('coalesces concurrent identical fetches and honors forceRefresh', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return { count: calls };
    };

    const [a, b, c] = await Promise.all([
      fetchAdminQuery({ key: '/api/admin/products?page=1', fetcher }),
      fetchAdminQuery({ key: '/api/admin/products?page=1', fetcher }),
      fetchAdminQuery({ key: '/api/admin/products?page=1', fetcher }),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(a, { count: 1 });
    assert.deepEqual(b, { count: 1 });
    assert.deepEqual(c, { count: 1 });

    // Fresh warm cache avoids extra fetch
    const warm = await fetchAdminQuery({ key: '/api/admin/products?page=1', fetcher });
    assert.equal(calls, 1);
    assert.deepEqual(warm, { count: 1 });

    // forceRefresh bypasses fresh entry
    const refreshed = await fetchAdminQuery({ key: '/api/admin/products?page=1', fetcher, forceRefresh: true });
    assert.equal(calls, 2);
    assert.deepEqual(refreshed, { count: 2 });
  });

  it('prevents stale in-flight fetches from overwriting cache after invalidation', async () => {
    let resolveFirst!: (val: { version: number }) => void;
    const firstPromise = new Promise<{ version: number }>((resolve) => {
      resolveFirst = resolve;
    });

    const inflight = fetchAdminQuery({
      key: '/api/admin/orders?page=1',
      fetcher: () => firstPromise,
    });

    invalidateAdminCacheByPrefixes(['/api/admin/orders']);
    resolveFirst({ version: 1 });
    const returned = await inflight;
    assert.deepEqual(returned, { version: 1 });

    // Must not be written into cache because invalidation occurred mid-flight
    assert.equal(peekAdminQuery('/api/admin/orders?page=1'), null);
  });

  it('evicts oldest entries cleanly when exceeding bounded LRU limit', () => {
    for (let i = 0; i < 250; i += 1) {
      setAdminQueryData(`/api/admin/item/${i}`, { i });
    }
    const stats = getAdminQueryCacheStats();
    assert.equal(stats.size, 240);
    assert.equal(peekAdminQuery('/api/admin/item/0'), null);
    assert.ok(peekAdminQuery('/api/admin/item/249'));
  });

  it('invalidates targeted prefixes on admin mutations', () => {
    setAdminQueryData('/api/admin/products?page=1', { list: [] });
    setAdminQueryData('/api/admin/overview?days=30', { total: 1 });
    setAdminQueryData('/api/admin/settings', { siteName: 'Novara' });

    const prefixes = resolveInvalidationPrefixesForMutation('PATCH', '/api/admin/products/123');
    assert.ok(prefixes.includes('/api/admin/products'));
    assert.ok(prefixes.includes('/api/admin/overview'));

    const removed = invalidateAdminCacheForMutation('PATCH', '/api/admin/products/123');
    assert.equal(removed, 2);
    assert.equal(peekAdminQuery('/api/admin/products?page=1'), null);
    assert.equal(peekAdminQuery('/api/admin/overview?days=30'), null);
    assert.ok(peekAdminQuery('/api/admin/settings'));
  });

  it('enforces cooldown guards against duplicate bursts', () => {
    const canRun = createCooldownGuard(60_000);
    assert.equal(canRun(), true);
    assert.equal(canRun(), false);
    assert.equal(canRun(), false);
  });
});
