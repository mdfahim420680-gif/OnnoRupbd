import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CartLine } from '../../types/commerce';
import { apiRequest } from '../../services/api';
import { countUniqueCartLines } from '../../lib/pricingEngine';
import {
  applyOptimisticAddItem,
  applyOptimisticToggleSelection,
  applyOptimisticUpdateQty,
  buildCartLineKey,
  computeCartSubtotal,
  rollbackLineFromSnapshot,
} from '../../lib/optimisticCart';

const GUEST_CART_KEY = 'novara_guest_cart_v1';

function loadGuestCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({ ...item, selected: item?.selected !== false }))
      : [];
  } catch {
    return [];
  }
}

export function hasGuestCartItems(): boolean {
  return loadGuestCart().length > 0;
}

function saveGuestCart(items: CartLine[]) {
  try {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota issues
  }
}

function clearGuestCartStorage() {
  try {
    localStorage.removeItem(GUEST_CART_KEY);
  } catch {
    // Ignore
  }
}

interface PendingCartMutation {
  seq: number;
  lineKey: string | null;
  snapshotItems: CartLine[];
  snapshotSubtotal: number;
}

export interface CartState {
  items: CartLine[];
  couponCode: string | null;
  couponMessage: string | null;
  appliedRuleName: string | null;
  subtotal: number;
  discount: number;
  loading: boolean;
  drawerOpen: boolean;
  error: string | null;
  pendingRequests: Record<string, PendingCartMutation>;
  nextMutationSeq: number;
  latestSeqByLine: Record<string, number>;
  latestSelectAllSeq: number;
}

function recomputeGuestTotals(items: CartLine[]) {
  return computeCartSubtotal(items);
}

const initialItems = loadGuestCart();

const initialState: CartState = {
  items: initialItems,
  couponCode: null,
  couponMessage: null,
  appliedRuleName: null,
  subtotal: recomputeGuestTotals(initialItems),
  discount: 0,
  loading: false,
  drawerOpen: false,
  error: null,
  pendingRequests: {},
  nextMutationSeq: 0,
  latestSeqByLine: {},
  latestSelectAllSeq: 0,
};

interface ServerCartResponse {
  ok: true;
  cart: {
    items: CartLine[];
    couponCode: string | null;
    couponMessage?: string | null;
    appliedRuleName?: string | null;
    subtotal: number;
    discount: number;
  };
}

function applyServerCartState(state: CartState, cart: ServerCartResponse['cart']) {
  state.items = (cart.items ?? []).map((item) => ({ ...item, selected: item.selected !== false }));
  state.couponCode = cart.couponCode ?? null;
  state.couponMessage = cart.couponMessage ?? null;
  state.appliedRuleName = cart.appliedRuleName ?? null;
  state.subtotal = cart.subtotal ?? 0;
  state.discount = cart.discount ?? 0;
}

function applySettledServerCart(
  state: CartState,
  cart: ServerCartResponse['cart'],
  requestId: string,
) {
  delete state.pendingRequests[requestId];
  const pendingEntries = Object.values(state.pendingRequests);
  if (pendingEntries.length === 0) {
    applyServerCartState(state, cart);
    return;
  }

  // Another optimistic mutation is still in flight on a sibling line; preserve those pending lines.
  const inFlightKeys = new Set(
    pendingEntries.map((entry) => entry.lineKey).filter((k): k is string => Boolean(k)),
  );
  const currentByKey = new Map(
    state.items.map((item) => [buildCartLineKey(item.productId, item.variantId), item] as const),
  );
  const serverItems = (cart.items ?? []).map((item) => ({ ...item, selected: item.selected !== false }));
  const mergedItems: CartLine[] = [];
  const seen = new Set<string>();

  for (const sItem of serverItems) {
    const key = buildCartLineKey(sItem.productId, sItem.variantId);
    seen.add(key);
    if (inFlightKeys.has(key)) {
      const localLine = currentByKey.get(key);
      if (localLine) mergedItems.push(localLine);
    } else {
      mergedItems.push(sItem);
    }
  }

  for (const pendingKey of inFlightKeys) {
    if (!seen.has(pendingKey)) {
      const localLine = currentByKey.get(pendingKey);
      if (localLine) mergedItems.push(localLine);
    }
  }

  state.items = mergedItems;
  state.couponCode = cart.couponCode ?? null;
  state.couponMessage = cart.couponMessage ?? null;
  state.appliedRuleName = cart.appliedRuleName ?? null;
  state.subtotal = computeCartSubtotal(mergedItems);
  state.discount = cart.discount ?? 0;
}

function beginOptimisticMutation(
  state: CartState,
  requestId: string,
  lineKey: string | null,
): void {
  const seq = state.nextMutationSeq + 1;
  state.nextMutationSeq = seq;
  state.pendingRequests[requestId] = {
    seq,
    lineKey,
    snapshotItems: state.items.map((item) => ({ ...item })),
    snapshotSubtotal: state.subtotal,
  };
  if (lineKey) {
    state.latestSeqByLine[lineKey] = seq;
  } else {
    state.latestSelectAllSeq = seq;
  }
}

function rollbackOptimisticMutation(state: CartState, requestId: string): void {
  const pending = state.pendingRequests[requestId];
  if (!pending) return;
  delete state.pendingRequests[requestId];

  const hasNewerForTarget = pending.lineKey
    ? (state.latestSeqByLine[pending.lineKey] ?? 0) > pending.seq ||
      state.latestSelectAllSeq > pending.seq
    : state.latestSelectAllSeq > pending.seq;

  const rolled = rollbackLineFromSnapshot(
    state.items,
    pending.snapshotItems,
    pending.lineKey,
    hasNewerForTarget,
  );
  state.items = rolled.items;
  state.subtotal = rolled.subtotal;
}

export const fetchServerCart = createAsyncThunk('cart/fetchServer', async () => {
  const res = await apiRequest<ServerCartResponse>('/api/account/cart');
  return res.cart;
});

export const mergeGuestCartOnLogin = createAsyncThunk('cart/mergeGuest', async () => {
  const guestItems = loadGuestCart();
  if (guestItems.length === 0) {
    const res = await apiRequest<ServerCartResponse>('/api/account/cart');
    return res.cart;
  }
  const res = await apiRequest<ServerCartResponse>('/api/account/cart/merge', {
    method: 'POST',
    body: JSON.stringify({
      items: guestItems.map((i) => ({
        productId: i.productId,
        variantId: i.variantId || null,
        quantity: i.quantity,
        selected: i.selected !== false,
      })),
    }),
  });
  clearGuestCartStorage();
  return res.cart;
});

export const mergeItemsToCartAsync = createAsyncThunk(
  'cart/mergeItems',
  async (
    payload: { items: CartLine[]; isAuthenticated: boolean },
    { rejectWithValue },
  ) => {
    if (!payload.isAuthenticated) {
      return { mode: 'guest' as const, items: payload.items };
    }
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart/merge', {
        method: 'POST',
        body: JSON.stringify({
          items: payload.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId || null,
            quantity: i.quantity,
            selected: i.selected !== false,
          })),
        }),
      });
      return { mode: 'server' as const, cart: res.cart };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unable to add selected items to cart');
    }
  },
);

export const addToCartAsync = createAsyncThunk(
  'cart/addItem',
  async (
    payload: { item: CartLine; isAuthenticated: boolean; mode?: 'idempotent' | 'set' },
    { rejectWithValue },
  ) => {
    const addMode = payload.mode || 'idempotent';
    if (!payload.isAuthenticated) {
      return { mode: 'guest' as const, addMode, item: { ...payload.item, selected: true } };
    }
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          productId: payload.item.productId,
          variantId: payload.item.variantId || null,
          quantity: payload.item.quantity,
          mode: addMode,
        }),
      });
      return { mode: 'server' as const, cart: res.cart };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unable to add item to cart');
    }
  },
);

export const updateCartQtyAsync = createAsyncThunk(
  'cart/updateQty',
  async (
    payload: { productId: string; variantId?: string | null; quantity: number; isAuthenticated: boolean },
    { rejectWithValue },
  ) => {
    if (!payload.isAuthenticated) {
      return {
        mode: 'guest' as const,
        productId: payload.productId,
        variantId: payload.variantId || null,
        quantity: payload.quantity,
      };
    }
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart/items', {
        method: 'PATCH',
        body: JSON.stringify({
          productId: payload.productId,
          variantId: payload.variantId || null,
          quantity: payload.quantity,
        }),
      });
      return { mode: 'server' as const, cart: res.cart };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to update cart quantity');
    }
  },
);

export const toggleCartItemSelectionAsync = createAsyncThunk(
  'cart/toggleSelection',
  async (
    payload: {
      productId?: string;
      variantId?: string | null;
      selected: boolean;
      selectAll?: boolean;
      isAuthenticated: boolean;
    },
    { rejectWithValue },
  ) => {
    if (!payload.isAuthenticated) {
      return {
        mode: 'guest' as const,
        productId: payload.productId,
        variantId: payload.variantId || null,
        selected: payload.selected,
        selectAll: Boolean(payload.selectAll),
      };
    }
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart/selection', {
        method: 'PATCH',
        body: JSON.stringify({
          productId: payload.productId,
          variantId: payload.variantId || null,
          selected: payload.selected,
          selectAll: payload.selectAll,
        }),
      });
      return { mode: 'server' as const, cart: res.cart };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to update item selection');
    }
  },
);

export const clearCartAsync = createAsyncThunk(
  'cart/clearCart',
  async (payload: { isAuthenticated: boolean }, { rejectWithValue }) => {
    if (!payload.isAuthenticated) {
      clearGuestCartStorage();
      return { mode: 'guest' as const };
    }
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart', {
        method: 'DELETE',
      });
      return { mode: 'server' as const, cart: res.cart };
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unable to clear cart');
    }
  },
);

export const applyCouponAsync = createAsyncThunk(
  'cart/applyCoupon',
  async (code: string, { rejectWithValue }) => {
    try {
      const res = await apiRequest<ServerCartResponse>('/api/account/cart/coupon', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      return res.cart;
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Invalid or ineligible coupon');
    }
  },
);

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    openCartDrawer(state) {
      state.drawerOpen = true;
    },
    closeCartDrawer(state) {
      state.drawerOpen = false;
    },
    clearCartAfterOrder(state) {
      const remaining = state.items.filter((i) => i.selected === false);
      state.items = remaining;
      state.couponCode = null;
      state.couponMessage = null;
      state.appliedRuleName = null;
      state.subtotal = recomputeGuestTotals(remaining);
      state.discount = 0;
      state.error = null;
      state.pendingRequests = {};
      if (remaining.length === 0) {
        clearGuestCartStorage();
      } else {
        saveGuestCart(remaining);
      }
    },
    resetToGuestCart(state) {
      const items = loadGuestCart();
      state.items = items;
      state.couponCode = null;
      state.couponMessage = null;
      state.appliedRuleName = null;
      state.subtotal = recomputeGuestTotals(items);
      state.discount = 0;
      state.pendingRequests = {};
    },
    setCartError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchServerCart.pending, (state) => {
        if (state.items.length === 0) {
          state.loading = true;
        }
      })
      .addCase(fetchServerCart.fulfilled, (state, action) => {
        if (action.payload && Object.keys(state.pendingRequests).length === 0) {
          applyServerCartState(state, action.payload);
        }
        state.loading = false;
      })
      .addCase(fetchServerCart.rejected, (state) => {
        state.loading = false;
      })
      .addCase(mergeGuestCartOnLogin.fulfilled, (state, action) => {
        if (action.payload) {
          state.pendingRequests = {};
          applyServerCartState(state, action.payload);
        }
        state.loading = false;
      })
      .addCase(mergeItemsToCartAsync.fulfilled, (state, action) => {
        if (action.payload.mode === 'server') {
          if (action.payload.cart) {
            state.pendingRequests = {};
            applyServerCartState(state, action.payload.cart);
          }
        } else {
          let nextItems = state.items;
          for (const incoming of action.payload.items) {
            const updated = applyOptimisticAddItem(nextItems, incoming, 'idempotent');
            nextItems = updated.items;
          }
          state.items = nextItems;
          state.subtotal = computeCartSubtotal(nextItems);
          saveGuestCart(nextItems);
        }
        state.error = null;
      })
      .addCase(mergeItemsToCartAsync.rejected, (state, action) => {
        state.error = String(action.payload || 'Unable to add selected items to cart');
      })
      .addCase(addToCartAsync.pending, (state, action) => {
        state.error = null;
        if (!action.meta.arg.isAuthenticated) return;
        const { item, mode = 'idempotent' } = action.meta.arg;
        const lineKey = buildCartLineKey(item.productId, item.variantId);
        beginOptimisticMutation(state, action.meta.requestId, lineKey);
        const updated = applyOptimisticAddItem(state.items, item, mode);
        state.items = updated.items;
        state.subtotal = updated.subtotal;
      })
      .addCase(addToCartAsync.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload.mode === 'server') {
          if (action.payload.cart) {
            applySettledServerCart(state, action.payload.cart, action.meta.requestId);
          } else {
            delete state.pendingRequests[action.meta.requestId];
          }
        } else {
          const updated = applyOptimisticAddItem(
            state.items,
            action.payload.item,
            action.payload.addMode,
          );
          state.items = updated.items;
          state.subtotal = updated.subtotal;
          saveGuestCart(updated.items);
        }
      })
      .addCase(addToCartAsync.rejected, (state, action) => {
        state.loading = false;
        rollbackOptimisticMutation(state, action.meta.requestId);
        state.error = String(action.payload || 'Unable to add item');
      })
      .addCase(updateCartQtyAsync.pending, (state, action) => {
        state.error = null;
        if (!action.meta.arg.isAuthenticated) return;
        const { productId, variantId, quantity } = action.meta.arg;
        const lineKey = buildCartLineKey(productId, variantId);
        beginOptimisticMutation(state, action.meta.requestId, lineKey);
        const updated = applyOptimisticUpdateQty(state.items, productId, variantId, quantity);
        state.items = updated.items;
        state.subtotal = updated.subtotal;
      })
      .addCase(updateCartQtyAsync.fulfilled, (state, action) => {
        if (action.payload.mode === 'server') {
          if (action.payload.cart) {
            applySettledServerCart(state, action.payload.cart, action.meta.requestId);
          } else {
            delete state.pendingRequests[action.meta.requestId];
          }
        } else {
          const { productId, variantId, quantity } = action.payload;
          const updated = applyOptimisticUpdateQty(state.items, productId, variantId, quantity);
          state.items = updated.items;
          state.subtotal = updated.subtotal;
          saveGuestCart(updated.items);
        }
      })
      .addCase(updateCartQtyAsync.rejected, (state, action) => {
        rollbackOptimisticMutation(state, action.meta.requestId);
        state.error = String(action.payload || 'Failed to update cart quantity');
      })
      .addCase(toggleCartItemSelectionAsync.pending, (state, action) => {
        state.error = null;
        if (!action.meta.arg.isAuthenticated) return;
        const { productId, variantId, selected, selectAll } = action.meta.arg;
        const lineKey = !selectAll && productId ? buildCartLineKey(productId, variantId) : null;
        beginOptimisticMutation(state, action.meta.requestId, lineKey);
        const updated = applyOptimisticToggleSelection(state.items, {
          productId,
          variantId,
          selected,
          selectAll,
        });
        state.items = updated.items;
        state.subtotal = updated.subtotal;
      })
      .addCase(toggleCartItemSelectionAsync.fulfilled, (state, action) => {
        if (action.payload.mode === 'server') {
          if (action.payload.cart) {
            applySettledServerCart(state, action.payload.cart, action.meta.requestId);
          } else {
            delete state.pendingRequests[action.meta.requestId];
          }
        } else {
          const { productId, variantId, selected, selectAll } = action.payload;
          const updated = applyOptimisticToggleSelection(state.items, {
            productId,
            variantId,
            selected,
            selectAll,
          });
          state.items = updated.items;
          state.subtotal = updated.subtotal;
          saveGuestCart(updated.items);
        }
      })
      .addCase(toggleCartItemSelectionAsync.rejected, (state, action) => {
        rollbackOptimisticMutation(state, action.meta.requestId);
        state.error = String(action.payload || 'Failed to update item selection');
      })
      .addCase(clearCartAsync.fulfilled, (state, action) => {
        state.pendingRequests = {};
        if (action.payload.mode === 'server' && action.payload.cart) {
          applyServerCartState(state, action.payload.cart);
        } else {
          state.items = [];
          state.couponCode = null;
          state.couponMessage = null;
          state.appliedRuleName = null;
          state.subtotal = 0;
          state.discount = 0;
          clearGuestCartStorage();
        }
        state.error = null;
      })
      .addCase(applyCouponAsync.fulfilled, (state, action) => {
        if (action.payload) {
          applyServerCartState(state, action.payload);
        }
        state.error = null;
      })
      .addCase(applyCouponAsync.rejected, (state, action) => {
        state.error = String(action.payload || 'Coupon error');
      });
  },
});

export const {
  openCartDrawer,
  closeCartDrawer,
  clearCartAfterOrder,
  resetToGuestCart,
  setCartError,
} = cartSlice.actions;

// Cart badge MUST reflect unique cart lines, not total item quantity
export const selectCartLineCount = (state: { cart: CartState }) => countUniqueCartLines(state.cart.items);

export default cartSlice.reducer;


