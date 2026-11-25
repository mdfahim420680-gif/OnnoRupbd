import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartLine } from '../types/commerce';
import {
  applyOptimisticAddItem,
  applyOptimisticToggleSelection,
  applyOptimisticUpdateQty,
  buildCartLineKey,
  computeCartSubtotal,
  rollbackLineFromSnapshot,
} from './optimisticCart';

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: 'prod-1',
    variantId: null,
    slug: 'prod-1',
    name: 'Test Product',
    sku: 'SKU-1',
    imageUrl: '/img.png',
    unitPrice: 1200,
    quantity: 1,
    availableStock: 10,
    isAvailable: true,
    selected: true,
    ...overrides,
  };
}

test('applyOptimisticAddItem enforces idempotent add for card quick-add and set mode for PDP', () => {
  const itemA = makeLine({ productId: 'p1', unitPrice: 500, quantity: 1 });
  const first = applyOptimisticAddItem([], itemA, 'idempotent');
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].quantity, 1);
  assert.equal(first.subtotal, 500);
  assert.equal(first.addedNewLine, true);

  // Clicking quick-add again is idempotent (keeps qty=1, does not duplicate line)
  const repeat = applyOptimisticAddItem(first.items, itemA, 'idempotent');
  assert.equal(repeat.items.length, 1);
  assert.equal(repeat.items[0].quantity, 1);
  assert.equal(repeat.addedNewLine, false);

  // PDP explicit quantity uses 'set' mode
  const pdpSet = applyOptimisticAddItem(repeat.items, makeLine({ productId: 'p1', unitPrice: 500, quantity: 3 }), 'set');
  assert.equal(pdpSet.items.length, 1);
  assert.equal(pdpSet.items[0].quantity, 3);
  assert.equal(pdpSet.subtotal, 1500);
});

test('applyOptimisticUpdateQty updates clamped quantity, removes zero/negative qty, and recomputes subtotal', () => {
  const initial = [
    makeLine({ productId: 'p1', unitPrice: 400, quantity: 1, availableStock: 3 }),
    makeLine({ productId: 'p2', variantId: 'v2', unitPrice: 600, quantity: 2, availableStock: 5 }),
  ];

  const clamped = applyOptimisticUpdateQty(initial, 'p1', null, 99);
  assert.equal(clamped.items[0].quantity, 3);
  assert.equal(clamped.subtotal, 3 * 400 + 2 * 600);

  const removed = applyOptimisticUpdateQty(clamped.items, 'p1', null, 0);
  assert.equal(removed.items.length, 1);
  assert.equal(removed.items[0].productId, 'p2');
  assert.equal(removed.subtotal, 1200);
});

test('applyOptimisticToggleSelection toggles individual line or all lines cleanly', () => {
  const initial = [
    makeLine({ productId: 'p1', unitPrice: 300, quantity: 2 }),
    makeLine({ productId: 'p2', unitPrice: 500, quantity: 1 }),
  ];

  const singleOff = applyOptimisticToggleSelection(initial, { productId: 'p1', selected: false });
  assert.equal(singleOff.items[0].selected, false);
  assert.equal(singleOff.items[1].selected, true);
  assert.equal(singleOff.subtotal, 500);

  const allOn = applyOptimisticToggleSelection(singleOff.items, { selectAll: true, selected: true });
  assert.equal(computeCartSubtotal(allOn.items), 1100);
});

test('rollbackLineFromSnapshot restores only the failed target line without clobbering concurrent line changes', () => {
  const snapshotBeforeP1 = [makeLine({ productId: 'p2', unitPrice: 500, quantity: 1 })];
  const itemP1 = makeLine({ productId: 'p1', unitPrice: 400, quantity: 1 });
  const itemP3 = makeLine({ productId: 'p3', unitPrice: 700, quantity: 1 });

  // User clicked P1 (optimistic), then immediately clicked P3 (optimistic)
  const afterP1 = applyOptimisticAddItem(snapshotBeforeP1, itemP1, 'idempotent').items;
  const afterP1AndP3 = applyOptimisticAddItem(afterP1, itemP3, 'idempotent').items;

  // Suppose P1 request rejected while P3 succeeded: P1 should roll back, P3 must remain
  const rolledBack = rollbackLineFromSnapshot(
    afterP1AndP3,
    snapshotBeforeP1,
    buildCartLineKey('p1', null),
    false,
  );
  assert.deepEqual(
    rolledBack.items.map((i) => i.productId),
    ['p2', 'p3'],
  );
  assert.equal(rolledBack.subtotal, 1200);

  // If a newer mutation is already in flight on the same key, rollback does not clobber it
  const preservedNewer = rollbackLineFromSnapshot(
    afterP1AndP3,
    snapshotBeforeP1,
    buildCartLineKey('p1', null),
    true,
  );
  assert.deepEqual(
    preservedNewer.items.map((i) => i.productId),
    ['p2', 'p1', 'p3'],
  );
});
