import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import toastReducer, {
  dismissToast,
  dismissToastFromStack,
  enqueueToastStack,
  MAX_VISIBLE_TOASTS,
  showToast,
  type ToastMessage,
} from './toastSlice';

function makeToast(id: string, message: string, variant: ToastMessage['variant'] = 'info'): ToastMessage {
  return {
    id,
    variant,
    message,
    durationMs: 4000,
    createdAt: Date.now(),
  };
}

describe('Top-center notification stack logic', () => {
  it('places newest notifications at the top of the stack and shifts older ones downward', () => {
    const t1 = makeToast('1', 'First alert', 'info');
    const t2 = makeToast('2', 'Second alert', 'success');
    const t3 = makeToast('3', 'Third alert', 'warning');

    let stack = enqueueToastStack([], t1);
    stack = enqueueToastStack(stack, t2);
    stack = enqueueToastStack(stack, t3);

    assert.deepEqual(
      stack.map((t) => t.id),
      ['3', '2', '1'],
    );
  });

  it('deduplicates identical active messages and moves the refreshed notification to the top', () => {
    const t1 = makeToast('1', 'Cart updated', 'success');
    const t2 = makeToast('2', 'Coupon applied', 'info');
    const t3 = makeToast('3', 'Cart updated', 'success');

    let stack = enqueueToastStack([], t1);
    stack = enqueueToastStack(stack, t2);
    stack = enqueueToastStack(stack, t3);

    assert.deepEqual(
      stack.map((t) => t.id),
      ['3', '2'],
    );
  });

  it('caps the visible notification stack so notifications never overwhelm the viewport', () => {
    let stack: ToastMessage[] = [];
    for (let i = 1; i <= MAX_VISIBLE_TOASTS + 2; i += 1) {
      stack = enqueueToastStack(stack, makeToast(String(i), `Notification ${i}`, 'info'));
    }

    assert.equal(stack.length, MAX_VISIBLE_TOASTS);
    assert.deepEqual(
      stack.map((t) => t.id),
      ['6', '5', '4', '3'],
    );
  });

  it('removes a dismissed notification without disturbing remaining stack order', () => {
    const stack = [makeToast('3', 'Three'), makeToast('2', 'Two'), makeToast('1', 'One')];
    const next = dismissToastFromStack(stack, '2');
    assert.deepEqual(
      next.map((t) => t.id),
      ['3', '1'],
    );
  });

  it('integrates showToast and dismissToast through the Redux reducer', () => {
    let state = toastReducer(undefined, showToast({ variant: 'success', message: 'First' }));
    state = toastReducer(state, showToast({ variant: 'info', message: 'Second' }));
    assert.equal(state.toasts.length, 2);
    assert.equal(state.toasts[0].message, 'Second');
    assert.equal(state.toasts[1].message, 'First');

    const topId = state.toasts[0].id;
    state = toastReducer(state, dismissToast(topId));
    assert.equal(state.toasts.length, 1);
    assert.equal(state.toasts[0].message, 'First');
  });
});
