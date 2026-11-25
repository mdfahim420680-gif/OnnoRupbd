import { useEffect, useState } from 'react';
import { apiRequest } from '../services/api';
import { fetchAdminQuery, peekAdminQuery } from './adminQueryCache';

export interface CachedApiRequestOptions {
  staleTimeMs?: number;
  gcTimeMs?: number;
  forceRefresh?: boolean;
  requestInit?: RequestInit;
}

export async function cachedApiRequest<T>(
  path: string,
  options: CachedApiRequestOptions = {},
): Promise<T> {
  const {
    staleTimeMs = 30_000,
    gcTimeMs = 5 * 60_000,
    forceRefresh = false,
    requestInit,
  } = options;

  return fetchAdminQuery<T>({
    key: path,
    staleTimeMs,
    gcTimeMs,
    forceRefresh,
    fetcher: () => apiRequest<T>(path, requestInit),
  });
}

export function readCachedAdminData<T>(path: string): T | null {
  return peekAdminQuery<T>(path)?.data ?? null;
}

export function useDebouncedValue<T>(value: T, delayMs = 220): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
