interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedTtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 128) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Refresh recency for simple LRU eviction
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export class SingleFlightCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = work().finally(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }
}

export const storefrontCache = new BoundedTtlCache(160);
export const adminCache = new BoundedTtlCache(256);
export const adminAuthCache = new BoundedTtlCache(512);
export const adminSingleFlight = new SingleFlightCoordinator();

export function invalidatePublicCatalogCaches(): void {
  storefrontCache.invalidatePrefix('storefront:');
  storefrontCache.invalidatePrefix('catalog:');
}

export function invalidateSecurityPolicyCache(): void {
  storefrontCache.invalidatePrefix('security:policy');
  storefrontCache.invalidatePrefix('email:sender');
  storefrontCache.invalidatePrefix('auth:');
}

export function invalidateAdminCaches(prefix?: string): void {
  if (prefix) {
    adminCache.invalidatePrefix(prefix);
  } else {
    adminCache.clear();
  }
}

export function invalidateAdminPrefixes(prefixes: string[]): void {
  for (const prefix of prefixes) {
    adminCache.invalidatePrefix(prefix);
  }
}

export function invalidateAdminOrderCaches(): void {
  invalidateAdminPrefixes(['order-stats', 'overview:', 'notifications', 'payment-analytics:', 'report:']);
}

export function invalidateAdminProductCaches(): void {
  invalidateAdminPrefixes(['overview:', 'notifications', 'low-stock', 'report:', 'wishlist', 'attrs', 'attr-groups']);
}

export function invalidateAdminInventoryCaches(): void {
  invalidateAdminPrefixes(['overview:', 'notifications', 'low-stock', 'report:']);
}

export function invalidateAdminCategoryCaches(): void {
  invalidateAdminPrefixes(['categories', 'overview:']);
}

export function invalidateAdminBrandCaches(): void {
  invalidateAdminPrefixes(['brands', 'overview:']);
}

export function invalidateAdminAttributeCaches(): void {
  invalidateAdminPrefixes(['attrs', 'attr-groups']);
}

export function invalidateAdminAuthCaches(userId?: string): void {
  if (userId) {
    adminAuthCache.invalidatePrefix(`auth:${userId}:`);
  } else {
    adminAuthCache.clear();
  }
}
