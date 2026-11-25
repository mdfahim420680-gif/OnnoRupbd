import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFinancialSummary,
  isCollectedPayment,
  isOutstandingPayment,
  isSalesEligible,
  sumCompletedRefunds,
} from './financialAnalytics';

test('financial analytics distinguishes gross, eligible, collected, outstanding, and refunded values', () => {
  const summary = calculateFinancialSummary([
    { total: 1000, orderStatus: 'delivered', paymentStatus: 'paid', paymentMethod: 'sslcommerz' },
    { total: 500, orderStatus: 'pending', paymentStatus: 'unpaid', paymentMethod: 'cod' },
    { total: 300, orderStatus: 'pending', paymentStatus: 'initiated', paymentMethod: 'bkash' },
    { total: 200, orderStatus: 'cancelled', paymentStatus: 'paid', paymentMethod: 'cod' },
  ], [
    {
      status: 'paid',
      amount: 1000,
      refundedAmount: 100,
      refunds: [{ refundId: 'r1', status: 'completed', amount: 100 }],
    },
  ]);

  assert.equal(summary.grossOrderValue, 2000);
  assert.equal(summary.eligibleGrossSales, 1800);
  assert.equal(summary.successfulRefunds, 100);
  assert.equal(summary.netSales, 900);
  assert.equal(summary.collectedCash, 900);
  assert.equal(summary.outstandingPayments, 800);
  assert.equal(summary.pendingPayments, 300);
});

test('financial status helpers exclude cancelled, returned, failed, and expired orders', () => {
  assert.equal(isSalesEligible({ orderStatus: 'cancelled', paymentStatus: 'paid' }), false);
  assert.equal(isSalesEligible({ orderStatus: 'returned', paymentStatus: 'paid' }), false);
  assert.equal(isSalesEligible({ orderStatus: 'delivered', paymentStatus: 'failed' }), false);
  assert.equal(isCollectedPayment({ orderStatus: 'delivered', paymentStatus: 'paid' }), true);
  assert.equal(isCollectedPayment({ orderStatus: 'delivered', paymentStatus: 'unpaid', paymentMethod: 'cod' }), false);
  assert.equal(isOutstandingPayment({ orderStatus: 'pending', paymentStatus: 'initiated' }), true);
  assert.equal(isOutstandingPayment({ orderStatus: 'cancelled', paymentStatus: 'unpaid' }), false);
});

test('completed refund helper deduplicates refund IDs and prevents over-refund', () => {
  assert.equal(
    sumCompletedRefunds({
      amount: 500,
      refundedAmount: 300,
      refunds: [
        { refundId: 'same', status: 'completed', amount: 200 },
        { refundId: 'same', status: 'completed', amount: 200 },
        { refundId: 'pending', status: 'pending', amount: 100 },
      ],
    }),
    200,
  );

  assert.equal(
    sumCompletedRefunds({
      status: 'refunded',
      amount: 500,
      refundedAmount: 600,
      refunds: [],
    }),
    500,
  );
});

test('pending, failed, expired, duplicate, and reconciliation-required transactions do not create collected revenue', () => {
  const summary = calculateFinancialSummary([
    { total: 100, orderStatus: 'pending', paymentStatus: 'pending' },
    { total: 200, orderStatus: 'pending', paymentStatus: 'failed' },
    { total: 300, orderStatus: 'pending', paymentStatus: 'expired' },
  ], [
    { status: 'paid', duplicatePayment: true, amount: 100 },
    { status: 'paid', reconciliationRequired: true, amount: 100 },
  ]);

  assert.equal(summary.pendingPayments, 100);
  assert.equal(summary.successfulRefunds, 0);
  assert.equal(summary.netSales, 0);
  assert.equal(summary.collectedCash, 0);
});
