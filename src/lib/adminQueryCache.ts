export interface AdminCacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
  staleTimeMs: number;
  gcTimeMs: number;
}

export interface PeekAdminQueryResult<T> {
  data: T;
  isFresh: boolean;
  fetchedAt: number;
}

export interface FetchAdminQueryOptions<T> {
  key: string;
  fetcher: () => Promise<T>;
  staleTimeMs?: number;
  gcTimeMs?: number;
  forceRefresh?: boolean;
}

interface InFlightRecord<T = unknown> {
  promise: Promise<T>;
  token: symbol;
}

const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_GC_TIME_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 240;

let currentScope = 'anon';
let scopeEpoch = 1;
let invalidationEpoch = 0;

const queryCache = new Map<string, AdminCacheEntry>();
const inFlightQueries = new Map<string, InFlightRecord>();
const keyInvalidationEpoch = new Map<string, number>();

function makeScopedKey(key: string, scope = currentScope): string {
  return `${scope}::${key}`;
}

function extractRawKey(scopedKey: string, scope = currentScope): string | null {
  const prefix = `${scope}::`;
  return scopedKey.startsWith(prefix) ? scopedKey.slice(prefix.length) : null;
}

function touchCacheEntry(scopedKey: string, entry: AdminCacheEntry): void {
  queryCache.delete(scopedKey);
  queryCache.set(scopedKey, entry);
  while (queryCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = queryCache.keys().next().value;
    if (!oldestKey) break;
    queryCache.delete(oldestKey);
  }
}

export function getAdminQueryScope(): string {
  return currentScope;
}

export function setAdminQueryScope(scope: string | null | undefined): boolean {
  const normalized = (scope || '').trim() || 'anon';
  if (normalized === currentScope) return false;
  currentScope = normalized;
  scopeEpoch += 1;
  queryCache.clear();
  inFlightQueries.clear();
  keyInvalidationEpoch.clear();
  return true;
}

export function clearAdminQueryCache(): void {
  scopeEpoch += 1;
  queryCache.clear();
  inFlightQueries.clear();
  keyInvalidationEpoch.clear();
}

export function getAdminQueryCacheStats(): { size: number; inFlight: number; scope: string } {
  return {
    size: queryCache.size,
    inFlight: inFlightQueries.size,
    scope: currentScope,
  };
}

export function peekAdminQuery<T>(key: string, maxAgeMs?: number): PeekAdminQueryResult<T> | null {
  const scopedKey = makeScopedKey(key);
  const entry = queryCache.get(scopedKey);
  if (!entry) return null;

  const age = Date.now() - entry.fetchedAt;
  const effectiveGc = maxAgeMs !== undefined ? Math.min(entry.gcTimeMs, maxAgeMs) : entry.gcTimeMs;
  if (age > effectiveGc) {
    queryCache.delete(scopedKey);
    return null;
  }

  touchCacheEntry(scopedKey, entry);
  return {
    data: entry.data as T,
    isFresh: age <= entry.staleTimeMs,
    fetchedAt: entry.fetchedAt,
  };
}

export function setAdminQueryData<T>(
  key: string,
  data: T,
  options?: { staleTimeMs?: number; gcTimeMs?: number },
): void {
  const scopedKey = makeScopedKey(key);
  const staleTimeMs = options?.staleTimeMs ?? DEFAULT_STALE_TIME_MS;
  const gcTimeMs = Math.max(options?.gcTimeMs ?? DEFAULT_GC_TIME_MS, staleTimeMs);
  touchCacheEntry(scopedKey, {
    data,
    fetchedAt: Date.now(),
    staleTimeMs,
    gcTimeMs,
  });
}

export async function fetchAdminQuery<T>(options: FetchAdminQueryOptions<T>): Promise<T> {
  const {
    key,
    fetcher,
    staleTimeMs = DEFAULT_STALE_TIME_MS,
    gcTimeMs = Math.max(DEFAULT_GC_TIME_MS, staleTimeMs),
    forceRefresh = false,
  } = options;

  if (!forceRefresh) {
    const cached = peekAdminQuery<T>(key);
    if (cached && cached.isFresh) {
      return cached.data;
    }
  }

  const scopedKey = makeScopedKey(key);
  if (!forceRefresh) {
    const existing = inFlightQueries.get(scopedKey);
    if (existing) {
      return existing.promise as Promise<T>;
    }
  }

  const requestScope = currentScope;
  const requestScopeEpoch = scopeEpoch;
  const startedAtInvalidationEpoch = keyInvalidationEpoch.get(scopedKey) ?? 0;
  const token = Symbol('inFlight');

  const promise = (async () => {
    try {
      const data = await fetcher();
      const latestInvalidation = keyInvalidationEpoch.get(scopedKey) ?? 0;
      if (
        requestScope === currentScope &&
        requestScopeEpoch === scopeEpoch &&
        latestInvalidation === startedAtInvalidationEpoch
      ) {
        touchCacheEntry(scopedKey, {
          data,
          fetchedAt: Date.now(),
          staleTimeMs,
          gcTimeMs: Math.max(gcTimeMs, staleTimeMs),
        });
      }
      return data;
    } finally {
      const active = inFlightQueries.get(scopedKey);
      if (active?.token === token) {
        inFlightQueries.delete(scopedKey);
      }
    }
  })();

  inFlightQueries.set(scopedKey, { promise, token });
  return promise;
}

export function invalidateAdminCacheByPrefixes(prefixes: string[]): number {
  if (prefixes.length === 0) return 0;
  invalidationEpoch += 1;
  let removed = 0;

  for (const scopedKey of Array.from(queryCache.keys())) {
    const rawKey = extractRawKey(scopedKey);
    if (rawKey && prefixes.some((prefix) => rawKey.startsWith(prefix))) {
      queryCache.delete(scopedKey);
      keyInvalidationEpoch.set(scopedKey, invalidationEpoch);
      removed += 1;
    }
  }

  for (const scopedKey of Array.from(inFlightQueries.keys())) {
    const rawKey = extractRawKey(scopedKey);
    if (rawKey && prefixes.some((prefix) => rawKey.startsWith(prefix))) {
      keyInvalidationEpoch.set(scopedKey, invalidationEpoch);
      inFlightQueries.delete(scopedKey);
    }
  }

  return removed;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function resolveInvalidationPrefixesForMutation(method: string, path: string): string[] {
  const upperMethod = method.toUpperCase();
  if (!MUTATION_METHODS.has(upperMethod)) return [];

  const cleanPath = path.split('?')[0];
  if (!cleanPath.startsWith('/api/admin/')) {
    if (cleanPath.startsWith('/api/auth/')) {
      return ['/api/admin/'];
    }
    return [];
  }

  if (cleanPath.startsWith('/api/admin/products')) {
    return [
      '/api/admin/products',
      '/api/admin/overview',
      '/api/admin/inventory',
      '/api/admin/reports/analytics',
      '/api/admin/categories',
      '/api/admin/brands',
      '/api/admin/notifications',
    ];
  }

  if (
    cleanPath.startsWith('/api/admin/orders') ||
    cleanPath.startsWith('/api/admin/cancellation-requests') ||
    cleanPath.startsWith('/api/admin/returns') ||
    cleanPath.startsWith('/api/admin/payments')
  ) {
    return [
      '/api/admin/orders',
      '/api/admin/cancellation-requests',
      '/api/admin/returns',
      '/api/admin/payments',
      '/api/admin/overview',
      '/api/admin/reports/analytics',
      '/api/admin/notifications',
      '/api/admin/customers',
    ];
  }

  if (cleanPath.startsWith('/api/admin/inventory')) {
    return [
      '/api/admin/inventory',
      '/api/admin/products',
      '/api/admin/overview',
      '/api/admin/reports/analytics',
      '/api/admin/notifications',
    ];
  }

  if (cleanPath.startsWith('/api/admin/categories')) {
    return ['/api/admin/categories', '/api/admin/products', '/api/admin/navigation'];
  }

  if (cleanPath.startsWith('/api/admin/brands')) {
    return ['/api/admin/brands', '/api/admin/products'];
  }

  if (cleanPath.startsWith('/api/admin/attributes') || cleanPath.startsWith('/api/admin/attribute-groups')) {
    return ['/api/admin/attributes', '/api/admin/attribute-groups', '/api/admin/products'];
  }

  if (cleanPath.startsWith('/api/admin/customers') || cleanPath.startsWith('/api/admin/customer-groups')) {
    return [
      '/api/admin/customers',
      '/api/admin/customer-groups',
      '/api/admin/overview',
      '/api/admin/reports/analytics',
      '/api/admin/users',
    ];
  }

  if (cleanPath.startsWith('/api/admin/reviews')) {
    return ['/api/admin/reviews', '/api/admin/products', '/api/admin/overview', '/api/admin/notifications'];
  }

  if (cleanPath.startsWith('/api/admin/support')) {
    return ['/api/admin/support', '/api/admin/overview', '/api/admin/notifications'];
  }

  if (cleanPath.startsWith('/api/admin/coupons') || cleanPath.startsWith('/api/admin/promotions')) {
    return ['/api/admin/coupons', '/api/admin/promotions'];
  }

  if (
    cleanPath.startsWith('/api/admin/settings') ||
    cleanPath.startsWith('/api/admin/payment-methods') ||
    cleanPath.startsWith('/api/admin/shipping')
  ) {
    return ['/api/admin/settings', '/api/admin/payment-methods', '/api/admin/shipping'];
  }

  if (cleanPath.startsWith('/api/admin/hero-slides')) {
    return ['/api/admin/hero-slides'];
  }

  if (cleanPath.startsWith('/api/admin/banners')) {
    return ['/api/admin/banners'];
  }

  if (cleanPath.startsWith('/api/admin/advertisements')) {
    return ['/api/admin/advertisements'];
  }

  if (cleanPath.startsWith('/api/admin/global-promotional-popups')) {
    return ['/api/admin/global-promotional-popups'];
  }

  if (cleanPath.startsWith('/api/admin/navigation')) {
    return ['/api/admin/navigation'];
  }

  if (cleanPath.startsWith('/api/admin/cms') || cleanPath.startsWith('/api/admin/homepage-layout')) {
    return ['/api/admin/cms', '/api/admin/homepage-layout', '/api/admin/settings'];
  }

  if (
    cleanPath.startsWith('/api/admin/staff') ||
    cleanPath.startsWith('/api/admin/roles') ||
    cleanPath.startsWith('/api/admin/audit-logs') ||
    cleanPath.startsWith('/api/admin/system')
  ) {
    return [
      '/api/admin/staff',
      '/api/admin/roles',
      '/api/admin/audit-logs',
      '/api/admin/system',
      '/api/admin/users',
    ];
  }

  return [cleanPath];
}

export function invalidateAdminCacheForMutation(method: string, path: string): number {
  const prefixes = resolveInvalidationPrefixesForMutation(method, path);
  return invalidateAdminCacheByPrefixes(prefixes);
}

export function createCooldownGuard(cooldownMs: number, startInCooldown = false): () => boolean {
  let lastRunAt = startInCooldown ? Date.now() : 0;
  return () => {
    const now = Date.now();
    if (now - lastRunAt < cooldownMs) {
      return false;
    }
    lastRunAt = now;
    return true;
  };
}
