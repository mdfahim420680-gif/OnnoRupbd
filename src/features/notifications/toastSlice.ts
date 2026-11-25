import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  durationMs: number;
  createdAt: number;
}

interface ToastState {
  toasts: ToastMessage[];
}

const initialState: ToastState = {
  toasts: [],
};

export const MAX_VISIBLE_TOASTS = 4;

export function enqueueToastStack(
  current: ToastMessage[],
  next: ToastMessage,
  maxVisible = MAX_VISIBLE_TOASTS,
): ToastMessage[] {
  // Deduplicate identical active toast messages and place newest notification at the top
  const filtered = current.filter(
    (t) => !(t.message === next.message && t.variant === next.variant),
  );
  return [next, ...filtered].slice(0, maxVisible);
}

export function dismissToastFromStack(current: ToastMessage[], id: string): ToastMessage[] {
  return current.filter((t) => t.id !== id);
}

const toastSlice = createSlice({
  name: 'toast',
  initialState,
  reducers: {
    showToast(
      state,
      action: PayloadAction<{
        variant: ToastVariant;
        message: string;
        title?: string;
        durationMs?: number;
      }>,
    ) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const durationMs = action.payload.durationMs ?? 4000;
      const next: ToastMessage = {
        id,
        variant: action.payload.variant,
        title: action.payload.title,
        message: action.payload.message,
        durationMs,
        createdAt: Date.now(),
      };
      state.toasts = enqueueToastStack(state.toasts, next);
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = dismissToastFromStack(state.toasts, action.payload);
    },
  },
});

export const { showToast, dismissToast } = toastSlice.actions;
export default toastSlice.reducer;
