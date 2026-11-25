export type FinancialOrderLike = {
  total?: number | null;
  subtotal?: number | null;
  discount?: number | null;
  shippingCharge?: number | null;
  tax?: number | null;
  orderStatus?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  createdAt?: Date | string | null;
};

export type FinancialPaymentRefundLike = {
  refundId?: string | null;
  status?: string | null;
  amount?: number | null;
};

export type FinancialPaymentTransactionLike = {
  status?: string | null;
  duplicatePayment?: boolean | null;
  reconciliationRequired?: boolean | null;
  amount?: number | null;
  verifiedAmount?: number | null;
  refundedAmount?: number | null;
  refunds?: FinancialPaymentRefundLike[] | null;
  paymentMethod?: string | null;
  provider?: string | null;
};

export function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

export function sumCompletedRefunds(transaction: FinancialPaymentTransactionLike): number {
  const refunds = Array.isArray(transaction.refunds) ? transaction.refunds : [];
  const unique = new Map<string, number>();

  for (const refund of refunds) {
    if (refund.status !== 'completed') continue;
    const key = String(refund.refundId || '').trim();
    const amount = Math.max(0, money(refund.amount));
    if (key) {
      unique.set(key, amount);
    } else if (amount > 0) {
      // Legacy refund entries without an ID can still be counted once per entry.
      unique.set(`legacy-${unique.size}`, amount);
    }
  }

  let total = Array.from(unique.values()).reduce((sum, amount) => sum + amount, 0);
  if (total === 0 && transaction.status === 'refunded' && Number(transaction.refundedAmount || 0) > 0) {
    total = money(transaction.refundedAmount);
  }
  return Math.min(money(transaction.amount || transaction.verifiedAmount || 0), money(total));
}

export function isSalesEligible(order: FinancialOrderLike): boolean {
  if (['cancelled', 'returned', 'return_requested'].includes(String(order.orderStatus || ''))) return false;
  if (['failed', 'cancelled', 'expired'].includes(String(order.paymentStatus || ''))) return false;
  return true;
}

export function isCollectedPayment(order: FinancialOrderLike): boolean {
  if (order.orderStatus === 'cancelled' || order.orderStatus === 'returned' || order.orderStatus === 'return_requested') {
    return false;
  }
  return order.paymentStatus === 'paid';
}

export function isOutstandingPayment(order: FinancialOrderLike): boolean {
  if (['cancelled', 'returned', 'return_requested'].includes(String(order.orderStatus || ''))) return false;
  return ['unpaid', 'initiated', 'pending', 'authorized'].includes(String(order.paymentStatus || ''));
}

export function calculateFinancialSummary(
  orders: FinancialOrderLike[],
  transactions: FinancialPaymentTransactionLike[] = [],
) {
  let grossOrderValue = 0;
  let eligibleGrossSales = 0;
  let netSales = 0;
  let collectedCash = 0;
  let outstandingPayments = 0;
  let pendingPayments = 0;
  let successfulRefunds = 0;

  for (const order of orders) {
    const total = Math.max(0, money(order.total));
    grossOrderValue += total;

    if (isSalesEligible(order)) {
      eligibleGrossSales += total;
      if (isCollectedPayment(order)) {
        netSales += total;
        collectedCash += total;
      }
    }

    if (isOutstandingPayment(order)) {
      outstandingPayments += Math.max(0, total);
      if (order.paymentStatus === 'initiated' || order.paymentStatus === 'pending') {
        pendingPayments += Math.max(0, total);
      }
    }
  }

  for (const transaction of transactions) {
    if (transaction.status !== 'paid' && transaction.status !== 'partially_refunded' && transaction.status !== 'refunded') {
      continue;
    }
    if (transaction.duplicatePayment || transaction.reconciliationRequired) continue;
    successfulRefunds += sumCompletedRefunds(transaction);
  }

  netSales = money(Math.max(0, netSales - successfulRefunds));
  collectedCash = money(Math.max(0, collectedCash - successfulRefunds));

  return {
    grossOrderValue: money(grossOrderValue),
    eligibleGrossSales: money(eligibleGrossSales),
    successfulRefunds: money(successfulRefunds),
    netSales,
    collectedCash,
    outstandingPayments: money(outstandingPayments),
    pendingPayments: money(pendingPayments),
  };
}
