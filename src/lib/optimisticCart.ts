import type { CartLine } from '../types/commerce';
import { addIdempotentCartLine, setCartLineQuantity } from './pricingEngine';

export function buildCartLineKey(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId ? String(variantId) : 'default'}`;
}

export function computeCartSubtotal(items: CartLine[]): number {
  return items
    .filter((item) => item.selected !== false)
    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function applyOptimisticAddItem(
  items: CartLine[],
  incoming: CartLine,
  addMode: 'idempotent' | 'set' = 'idempotent',
): { items: CartLine[]; subtotal: number; addedNewLine: boolean } {
  const existingMapped = items.map((item) => ({ ...item, maxStock: item.availableStock }));
  const nextItem = {
    ...incoming,
    variantId: incoming.variantId || null,
    maxStock: incoming.availableStock,
    selected: true,
  };
  const updated =
    addMode === 'set'
      ? setCartLineQuantity(existingMapped, nextItem)
      : addIdempotentCartLine(existingMapped, nextItem);
  const normalized: CartLine[] = updated.items.map((item) => ({
    ...item,
    selected: item.selected !== false,
  }));
  return {
    items: normalized,
    subtotal: computeCartSubtotal(normalized),
    addedNewLine: updated.addedNewLine,
  };
}

export function applyOptimisticUpdateQty(
  items: CartLine[],
  productId: string,
  variantId: string | null | undefined,
  quantity: number,
): { items: CartLine[]; subtotal: number } {
  const targetKey = buildCartLineKey(productId, variantId);
  let nextItems: CartLine[];

  if (quantity <= 0) {
    nextItems = items.filter((item) => buildCartLineKey(item.productId, item.variantId) !== targetKey);
  } else {
    nextItems = items.map((item) => {
      if (buildCartLineKey(item.productId, item.variantId) !== targetKey) {
        return item;
      }
      const maxLimit = Math.max(1, Number(item.availableStock) || 1);
      return {
        ...item,
        quantity: Math.min(Math.max(1, Math.floor(quantity)), maxLimit),
      };
    });
  }

  return {
    items: nextItems,
    subtotal: computeCartSubtotal(nextItems),
  };
}

export function applyOptimisticToggleSelection(
  items: CartLine[],
  options: {
    productId?: string;
    variantId?: string | null;
    selected: boolean;
    selectAll?: boolean;
  },
): { items: CartLine[]; subtotal: number } {
  let nextItems: CartLine[];

  if (options.selectAll) {
    nextItems = items.map((item) => ({ ...item, selected: options.selected }));
  } else if (options.productId) {
    const targetKey = buildCartLineKey(options.productId, options.variantId);
    nextItems = items.map((item) =>
      buildCartLineKey(item.productId, item.variantId) === targetKey
        ? { ...item, selected: options.selected }
        : item,
    );
  } else {
    nextItems = items.slice();
  }

  return {
    items: nextItems,
    subtotal: computeCartSubtotal(nextItems),
  };
}

/**
 * Rolls back a failed optimistic cart mutation cleanly.
 * If another mutation is newer on the same target line, preserves the newer optimistic state.
 * For line-specific mutations, only the affected line is restored so concurrent changes on other lines survive.
 */
export function rollbackLineFromSnapshot(
  currentItems: CartLine[],
  snapshotItems: CartLine[],
  targetKey: string | null,
  hasNewerPendingForTarget: boolean,
): { items: CartLine[]; subtotal: number } {
  if (hasNewerPendingForTarget) {
    return {
      items: currentItems,
      subtotal: computeCartSubtotal(currentItems),
    };
  }

  if (!targetKey) {
    const snapshotSelectedByKey = new Map<string, boolean>();
    for (const item of snapshotItems) {
      snapshotSelectedByKey.set(buildCartLineKey(item.productId, item.variantId), item.selected !== false);
    }
    const restored = currentItems.map((item) => {
      const key = buildCartLineKey(item.productId, item.variantId);
      if (!snapshotSelectedByKey.has(key)) return item;
      return { ...item, selected: snapshotSelectedByKey.get(key)! };
    });
    return {
      items: restored,
      subtotal: computeCartSubtotal(restored),
    };
  }

  const snapshotLine = snapshotItems.find(
    (item) => buildCartLineKey(item.productId, item.variantId) === targetKey,
  );
  const withoutTarget = currentItems.filter(
    (item) => buildCartLineKey(item.productId, item.variantId) !== targetKey,
  );

  if (!snapshotLine) {
    return {
      items: withoutTarget,
      subtotal: computeCartSubtotal(withoutTarget),
    };
  }

  const existingIdx = currentItems.findIndex(
    (item) => buildCartLineKey(item.productId, item.variantId) === targetKey,
  );
  if (existingIdx !== -1) {
    const restored = currentItems.slice();
    restored[existingIdx] = snapshotLine;
    return {
      items: restored,
      subtotal: computeCartSubtotal(restored),
    };
  }

  const snapshotIdx = snapshotItems.findIndex(
    (item) => buildCartLineKey(item.productId, item.variantId) === targetKey,
  );
  const restored = withoutTarget.slice();
  const insertAt = Math.min(Math.max(0, snapshotIdx), restored.length);
  restored.splice(insertAt, 0, snapshotLine);

  return {
    items: restored,
    subtotal: computeCartSubtotal(restored),
  };
}
