import mongoose from 'mongoose';
import { OrderModel, PaymentTransactionModel, serializePaymentTransaction } from './order.model';
import { ProductModel, type IProductVariant } from '../products/product.model';
import { applyInventoryMutation, applyMongoSession, withInventoryTransaction } from '../inventory/inventoryTransaction';
import { ReturnRequestModel } from '../reviews/review.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { AppError } from '../../middleware/error.middleware';
import { dispatchTransactionalEmailInBackground } from '../../services/email.service';
import { refundPaymentTransactionAdmin } from '../../services/payment.service';
import type { recordAuditLog } from '../../middleware/auth.middleware';
import { adminCache, adminSingleFlight, invalidateAdminOrderCaches } from '../../utils/ttlCache';
import {
  canTransitionOrderStatus,
  shouldRestoreStockOnCancel,
  type OrderStatus,
  type PaymentStatus,
} from '../../../../src/lib/orderStateMachine';

export async function getOrderStatsAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Record<string, number>>('order-stats');
    if (cached) return cached;
  }

  return adminSingleFlight.run('order-stats', async () => {
    if (isDbConnected) {
      const cached = adminCache.get<Record<string, number>>('order-stats');
      if (cached) return cached;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [statusCounts, paymentCounts, salesAgg, newTodayCount, pendingCancellationRequests] = await Promise.all([
      OrderModel.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      OrderModel.aggregate([{ $group: { _id: '$paymentStatus', count: { $sum: 1 } } }]),
      OrderModel.aggregate([
        { $match: { orderStatus: { $nin: ['cancelled', 'returned'] } } },
        { $group: { _id: null, totalSales: { $sum: '$total' } } },
      ]),
      OrderModel.countDocuments({ createdAt: { $gte: startOfToday } }),
      OrderModel.countDocuments({ 'cancellationRequest.status': 'pending' }),
    ]);

    const byOrderStatus: Record<string, number> = {};
    let totalOrders = 0;
    for (const row of statusCounts) {
      byOrderStatus[String(row._id)] = Number(row.count || 0);
      totalOrders += Number(row.count || 0);
    }

    const byPaymentStatus: Record<string, number> = {};
    for (const row of paymentCounts) {
      byPaymentStatus[String(row._id)] = Number(row.count || 0);
    }

    const result = {
      totalOrders,
      newTodayCount,
      pending: byOrderStatus.pending || 0,
      confirmed: byOrderStatus.confirmed || 0,
      processing: byOrderStatus.processing || 0,
      packed: byOrderStatus.packed || 0,
      shipped: byOrderStatus.shipped || 0,
      delivered: byOrderStatus.delivered || 0,
      cancelled: byOrderStatus.cancelled || 0,
      return_requested: byOrderStatus.return_requested || 0,
      returned: byOrderStatus.returned || 0,
      pendingCancellationRequests,
      totalSales: Number(salesAgg[0]?.totalSales || 0),
      paidOrders: byPaymentStatus.paid || 0,
      pendingPayments:
        (byPaymentStatus.initiated || 0) +
        (byPaymentStatus.pending || 0) +
        (byPaymentStatus.authorized || 0) +
        (byPaymentStatus.unpaid || 0),
      unpaidOrders: byPaymentStatus.unpaid || 0,
    };
    if (isDbConnected) {
      adminCache.set('order-stats', result, 15_000);
    }
    return result;
  });
}

export async function listOrdersAdmin(params: {
  page: number;
  limit: number;
  q: string;
  status: string;
  statusGroup: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: string;
}) {
  const { page, limit, q, status, statusGroup, paymentStatus, fulfillmentStatus, dateFrom, dateTo, sortBy, sortOrder } =
    params;
  const filter: Record<string, unknown> = {};
  if (status) {
    filter.orderStatus = status;
  } else if (statusGroup) {
    const groupMap: Record<string, string[]> = {
      pending: ['pending', 'confirmed'],
      processing: ['processing', 'packed'],
      shipped: ['shipped'],
      delivered: ['delivered'],
      cancelled: ['cancelled', 'returned', 'return_requested'],
    };
    if (groupMap[statusGroup]) {
      filter.orderStatus = { $in: groupMap[statusGroup] };
    }
  }
  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }
  if (fulfillmentStatus) {
    filter.fulfillmentStatus = fulfillmentStatus;
  }
  if (dateFrom || dateTo) {
    const createdAtFilter: Record<string, Date> = {};
    if (dateFrom) {
      const d = new Date(dateFrom);
      if (!Number.isNaN(d.getTime())) createdAtFilter.$gte = d;
    }
    if (dateTo) {
      const d = new Date(dateTo);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAtFilter.$lte = d;
      }
    }
    if (Object.keys(createdAtFilter).length > 0) {
      filter.createdAt = createdAtFilter;
    }
  }
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { orderNumber: regex },
      { customerName: regex },
      { customerEmail: regex },
      { customerPhone: regex },
      { 'shippingAddress.district': regex },
      { 'shippingAddress.division': regex },
    ];
  }

  const sortField = sortBy === 'total' ? 'total' : 'createdAt';
  const sortDirection = sortOrder === 'asc' ? 1 : -1;

  const [total, orders] = await Promise.all([
    OrderModel.countDocuments(filter),
    OrderModel.find(filter)
      .select('orderNumber userId customerName customerEmail customerPhone shippingAddress.division shippingAddress.district items.quantity items.name items.sku paymentMethod paymentStatus deliveryMethod deliveryMethodName fulfillmentStatus subtotal discount shippingCharge total orderStatus cancellationRequest.status cancellationRequest.reason cancellationRequest.requestedAt createdAt updatedAt')
      .sort({ [sortField]: sortDirection })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    orders: orders.map((o) => ({ ...o, id: String(o._id) })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getOrderDetailAdmin(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const order = await OrderModel.findById(id).lean();
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const [transactions, storeConfig] = await Promise.all([
    PaymentTransactionModel.find({ orderId: order._id }).lean(),
    HomepageConfigModel.findOne({ key: 'main' }).select('storeInfo contactInfo').lean(),
  ]);
  return {
    order: { ...order, id: String(order._id) },
    transactions: transactions.map((t) => serializePaymentTransaction(t as unknown as Record<string, unknown>)),
    storeInfo: storeConfig?.storeInfo || null,
    contactInfo: storeConfig?.contactInfo || null,
  };
}

export async function transitionOrderStatusAdmin(params: {
  id: string;
  nextStatus: 'confirmed' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  reason?: string;
  courierName?: string;
  trackingNumber?: string;
  actorId: unknown;
  actorName: string;
}) {
  if (!mongoose.isValidObjectId(params.id)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const result = await withInventoryTransaction(async (session) => {
    const order = await applyMongoSession(OrderModel.findById(params.id), session);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');

    const check = canTransitionOrderStatus({
      currentStatus: order.orderStatus,
      nextStatus: params.nextStatus as OrderStatus,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    });
    if (!check.allowed) {
      throw new AppError(400, 'ILLEGAL_TRANSITION', check.reason || 'Transition not allowed.');
    }

    const prevStatus = order.orderStatus;
    if (params.nextStatus === 'shipped' && prevStatus !== 'shipped') {
      for (const item of order.items) {
        const product = await applyMongoSession(
          ProductModel.findById(item.productId).select('manageInventory allowBackorder'),
          session,
        );
        if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product for order item "${item.sku}" no longer exists.`);
        if (product.manageInventory !== false) {
          await applyInventoryMutation(session, {
            productId: item.productId,
            variantId: item.variantId,
            type: 'sale',
            quantity: item.quantity,
            reason: `Shipped order ${order.orderNumber}`,
            referenceId: order.orderNumber,
            actorId: params.actorId,
            actorName: params.actorName,
            allowBackorder: product.allowBackorder,
          });
        } else {
          product.soldCount += item.quantity;
          await product.save({ session });
        }
      }
      order.fulfillmentStatus = 'shipped';
      if (params.courierName) order.courierName = params.courierName;
      if (params.trackingNumber) order.trackingNumber = params.trackingNumber;
    }

    if (params.nextStatus === 'packed') order.fulfillmentStatus = 'packing';
    if (params.nextStatus === 'delivered') {
      order.fulfillmentStatus = 'delivered';
      order.deliveredAt = new Date();
      if (order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid') {
        order.paymentStatus = 'paid';
      }
    }

    if (params.nextStatus === 'cancelled') {
      const prevPaymentStatus = order.paymentStatus;
      if (shouldRestoreStockOnCancel(prevStatus, prevPaymentStatus)) {
        for (const item of order.items) {
          const product = await applyMongoSession(
            ProductModel.findById(item.productId).select('manageInventory'),
            session,
          );
          if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product for order item "${item.sku}" no longer exists.`);
          if (product.manageInventory === false) continue;
          await applyInventoryMutation(session, {
            productId: item.productId,
            variantId: item.variantId,
            type: 'release',
            quantity: item.quantity,
            reason: params.reason || `Cancelled by staff (${order.orderNumber})`,
            referenceId: order.orderNumber,
            actorId: params.actorId,
            actorName: params.actorName,
          });
        }
      }
      order.fulfillmentStatus = 'cancelled';
      order.cancellationReason = params.reason || 'Cancelled by operations team';
      if (prevPaymentStatus === 'paid') {
        order.paymentStatus = 'refund_pending';
        await PaymentTransactionModel.updateMany(
          { orderId: order._id, status: 'paid' },
          { $set: { status: 'refund_pending' } },
          { session },
        );
      } else if (prevPaymentStatus === 'pending') {
        order.paymentStatus = 'cancelled';
      }
      if (order.cancellationRequest && order.cancellationRequest.status === 'pending') {
        const now = new Date();
        order.cancellationRequest.status = 'approved';
        order.cancellationRequest.reviewedBy = params.actorId as typeof order.cancellationRequest.reviewedBy;
        order.cancellationRequest.reviewedByName = params.actorName;
        order.cancellationRequest.reviewedAt = now;
        order.cancellationRequest.adminNotes = params.reason || 'Approved via direct order cancellation';
        if (!Array.isArray(order.cancellationHistory)) order.cancellationHistory = [];
        order.cancellationHistory.push({
          action: 'approved',
          actorId: params.actorId as typeof order.cancellationHistory[0]['actorId'],
          actorName: params.actorName,
          reason: order.cancellationRequest.reason,
          adminNotes: params.reason || 'Approved via direct order cancellation',
          timestamp: now,
        });
      } else {
        const now = new Date();
        if (!Array.isArray(order.cancellationHistory)) order.cancellationHistory = [];
        order.cancellationHistory.push({
          action: 'admin_cancel',
          actorId: params.actorId as typeof order.cancellationHistory[0]['actorId'],
          actorName: params.actorName,
          reason: params.reason || 'Cancelled by operations team',
          timestamp: now,
        });
      }
    }

    order.orderStatus = params.nextStatus;
    order.statusHistory.push({
      fromStatus: prevStatus,
      toStatus: params.nextStatus,
      actorId: params.actorId as typeof order.statusHistory[0]['actorId'],
      actorName: params.actorName,
      reason: params.reason,
      timestamp: new Date(),
    });
    await order.save({ session });
    return {
      order: { ...order.toObject(), id: String(order._id) },
      prevStatus,
      orderNumber: order.orderNumber,
    };
  });
  invalidateAdminOrderCaches();
  return {
    order: result.order,
    prevStatus: result.prevStatus,
    orderNumber: result.orderNumber,
  };
}

export async function updateOrderPaymentStatusAdmin(params: {
  id: string;
  paymentStatus: PaymentStatus;
  note?: string;
  actorName: string;
}) {
  if (!mongoose.isValidObjectId(params.id)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const result = await withInventoryTransaction(async (session) => {
    const order = await applyMongoSession(OrderModel.findById(params.id), session);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');

    if (order.paymentMethod !== 'cod' && params.paymentStatus === 'paid') {
      const verifiedTx = await applyMongoSession(
        PaymentTransactionModel.findOne({
          orderId: order._id,
          status: 'paid',
          duplicatePayment: { $ne: true },
          reconciliationRequired: { $ne: true },
        }).lean(),
        session,
      );
      if (!verifiedTx) {
        throw new AppError(
          400,
          'ONLINE_PAYMENT_UNVERIFIED',
          'Online payments cannot be manually marked as Paid without a verified gateway transaction.',
        );
      }
    }

    const prevPaymentStatus = order.paymentStatus;
    if (
      ['refund_pending', 'partially_refunded', 'refunded'].includes(params.paymentStatus) &&
      !['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(prevPaymentStatus)
    ) {
      throw new AppError(
        400,
        'REFUND_NOT_ELIGIBLE',
        `Cannot mark order payment as "${params.paymentStatus}" when current status is "${prevPaymentStatus}".`,
      );
    }

    if (
      order.paymentMethod !== 'cod' &&
      ['refunded', 'partially_refunded'].includes(params.paymentStatus)
    ) {
      const completedGatewayRefundTx =
        order.paymentMethod === 'nagad'
          ? null
          : await applyMongoSession(
              PaymentTransactionModel.findOne({
                orderId: order._id,
                status: params.paymentStatus,
              }).lean(),
              session,
            );
      if (!completedGatewayRefundTx) {
        throw new AppError(
          400,
          'GATEWAY_REFUND_REQUIRED',
          'Online gateway refunds must be executed through the Payments Console and confirmed by the provider. A note or portal reference alone cannot confirm settlement.',
        );
      }
    }

    order.paymentStatus = params.paymentStatus;
    order.staffNotes.push({
      note: params.note?.trim() || `Payment status updated from ${prevPaymentStatus} to ${params.paymentStatus}`,
      actorName: params.actorName,
      timestamp: new Date(),
    });
    await order.save({ session });

    if (params.paymentStatus === 'refund_pending') {
      await PaymentTransactionModel.updateMany(
        { orderId: order._id, status: 'paid' },
        { $set: { status: 'refund_pending' } },
        { session },
      );
    } else if (params.paymentStatus === 'refunded' && order.paymentMethod === 'cod') {
      await PaymentTransactionModel.updateMany(
        { orderId: order._id, provider: 'cod', status: { $in: ['paid', 'refund_pending'] } },
        { $set: { status: 'refunded', refundedAmount: order.total } },
        { session },
      );
    }
    return {
      order: { ...order.toObject(), id: String(order._id) },
      prevPaymentStatus,
      orderNumber: order.orderNumber,
    };
  });
  invalidateAdminOrderCaches();
  return {
    order: result.order,
    prevPaymentStatus: result.prevPaymentStatus,
    orderNumber: result.orderNumber,
  };
}

export async function addOrderNoteAdmin(id: string, note: string, actorName: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const order = await OrderModel.findById(id);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  order.staffNotes.push({ note, actorName, timestamp: new Date() });
  await order.save();
  invalidateAdminOrderCaches();
  return { ...order.toObject(), id: String(order._id) };
}

export async function listReturnsAdmin() {
  const returns = await ReturnRequestModel.find().sort({ createdAt: -1 }).lean();
  return returns.map((r) => ({ ...r, id: String(r._id) }));
}

const RETURN_TRANSITIONS: Record<string, string[]> = {
  requested: ['approved', 'rejected', 'received'],
  approved: ['received', 'rejected', 'refunded'],
  received: ['refunded', 'rejected'],
  rejected: [],
  refunded: [],
};

export async function updateReturnAdmin(params: {
  id: string;
  status: 'approved' | 'rejected' | 'received' | 'refunded';
  inspectionNotes?: string;
  restockEligible: boolean;
  actorId: unknown;
  actorName: string;
}) {
  if (!mongoose.isValidObjectId(params.id)) {
    throw new AppError(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  }
  if (params.status === 'refunded') {
    const current = await ReturnRequestModel.findById(params.id).select('orderId orderNumber refundAmount');
    if (!current) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    const currentOrder = await OrderModel.findById(current.orderId).select('paymentMethod');
    const paidOnlineTx = await PaymentTransactionModel.findOne({
      orderId: current.orderId,
      provider: { $ne: 'cod' },
      status: { $in: ['paid', 'refund_pending', 'partially_refunded'] },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (paidOnlineTx) {
      await refundPaymentTransactionAdmin({
        idOrTranId: String(paidOnlineTx._id),
        amount: Number(current.refundAmount || paidOnlineTx.amount),
        reason: params.inspectionNotes || `Return approved & refunded (${current.orderNumber})`,
        actor: {
          _id: params.actorId as never,
          name: params.actorName,
          role: 'admin',
        } as unknown as NonNullable<Parameters<typeof recordAuditLog>[0]['actor']>,
      });
    } else if (currentOrder?.paymentMethod !== 'cod') {
      throw new AppError(
        409,
        'ONLINE_REFUND_TRANSACTION_NOT_FOUND',
        'No eligible online payment transaction is available for this return refund.',
      );
    }
  }

  const result = await withInventoryTransaction(async (session) => {
    const ret = await applyMongoSession(ReturnRequestModel.findById(params.id), session);
    if (!ret) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return request not found.');
    const allowedNext = RETURN_TRANSITIONS[ret.status] || [];
    if (!allowedNext.includes(params.status)) {
      throw new AppError(
        400,
        'INVALID_RETURN_TRANSITION',
        `Cannot transition return claim from "${ret.status}" to "${params.status}".`,
      );
    }

    ret.status = params.status;
    if (params.inspectionNotes) ret.inspectionNotes = params.inspectionNotes;
    ret.handledBy = params.actorId as typeof ret.handledBy;

    if ((params.status === 'received' || params.status === 'refunded') && params.restockEligible && !ret.restocked) {
      let anyRestocked = false;
      for (const item of ret.items) {
        const product = await applyMongoSession(
          ProductModel.findById(item.productId).select('manageInventory variants.sku'),
          session,
        );
        if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product for return item "${item.sku}" no longer exists.`);
        if (product.manageInventory === false) continue;
        const variant = product.variants.find((candidate: IProductVariant) => candidate.sku === item.sku);
        await applyInventoryMutation(session, {
          productId: item.productId,
          variantId: variant?._id || null,
          type: 'return',
          delta: item.quantity,
          reason: `Restocked after return inspection (${ret.orderNumber})`,
          referenceId: ret.orderNumber,
          actorId: params.actorId,
          actorName: params.actorName,
        });
        anyRestocked = true;
      }
      if (anyRestocked) ret.restocked = true;
    }

    if (params.status === 'rejected') {
      await OrderModel.updateOne(
        { _id: ret.orderId, orderStatus: 'return_requested' },
        {
          $set: { orderStatus: 'delivered' },
          $push: {
            statusHistory: {
              fromStatus: 'return_requested',
              toStatus: 'delivered',
              actorId: params.actorId,
              actorName: params.actorName,
              reason: params.inspectionNotes || 'Return request declined',
              timestamp: new Date(),
            },
          },
        },
        { session },
      );
    }

    if (params.status === 'refunded') {
      await OrderModel.updateOne(
        { _id: ret.orderId },
        {
          $set: { orderStatus: 'returned', paymentStatus: 'refunded', fulfillmentStatus: 'returned' },
          $push: {
            statusHistory: {
              fromStatus: 'return_requested',
              toStatus: 'returned',
              actorId: params.actorId,
              actorName: params.actorName,
              reason: params.inspectionNotes || 'Return verified and refunded',
              timestamp: new Date(),
            },
          },
        },
        { session },
      );
      await PaymentTransactionModel.updateMany(
        { orderId: ret.orderId, provider: 'cod', status: { $in: ['paid', 'refund_pending'] } },
        { $set: { status: 'refunded', refundedAmount: ret.refundAmount } },
        { session },
      );
    }

    await ret.save({ session });
    return {
      returnRequest: { ...ret.toObject(), id: String(ret._id) },
      orderNumber: ret.orderNumber,
    };
  });
  return result;
}

export async function listPaymentTransactionsAdmin(params: {
  q?: string;
  status?: string;
  provider?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
} = {}) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 25));
  const filter: Record<string, unknown> = {};

  if (params.status) filter.status = params.status;
  if (params.provider) filter.provider = params.provider;
  if (params.paymentMethod) filter.paymentMethod = params.paymentMethod;

  if (params.dateFrom || params.dateTo) {
    const createdAtFilter: Record<string, Date> = {};
    if (params.dateFrom) {
      const d = new Date(params.dateFrom);
      if (!Number.isNaN(d.getTime())) createdAtFilter.$gte = d;
    }
    if (params.dateTo) {
      const d = new Date(params.dateTo);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAtFilter.$lte = d;
      }
    }
    if (Object.keys(createdAtFilter).length > 0) filter.createdAt = createdAtFilter;
  }

  if (params.q) {
    const regex = new RegExp(params.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { orderNumber: regex },
      { transactionId: regex },
      { gatewayPaymentId: regex },
      { gatewayTransactionId: regex },
      { bankTransactionId: regex },
      { customerName: regex },
      { customerEmail: regex },
    ];
  }

  const [total, rawTxs, aggStats, codPendingAgg] = await Promise.all([
    PaymentTransactionModel.countDocuments(filter),
    PaymentTransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentTransactionModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          volume: { $sum: '$amount' },
          refundedVolume: { $sum: { $ifNull: ['$refundedAmount', 0] } },
        },
      },
    ]),
    OrderModel.aggregate([
      { $match: { paymentMethod: 'cod', paymentStatus: 'unpaid', orderStatus: { $ne: 'cancelled' } } },
      { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$total' } } },
    ]),
  ]);

  let totalCount = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let refundedCount = 0;
  let paidVolume = 0;
  let refundedVolume = 0;

  for (const row of aggStats) {
    const c = Number(row.count || 0);
    const v = Number(row.volume || 0);
    const rv = Number(row.refundedVolume || 0);
    totalCount += c;
    refundedVolume += rv;
    if (row._id === 'paid' || row._id === 'partially_refunded') {
      paidCount += c;
      paidVolume += v;
    } else if (row._id === 'refunded') {
      refundedCount += c;
    } else if (row._id === 'initiated' || row._id === 'pending' || row._id === 'authorized') {
      pendingCount += c;
    } else if (row._id === 'failed' || row._id === 'cancelled' || row._id === 'expired') {
      failedCount += c;
    }
  }

  return {
    transactions: rawTxs.map((t) => serializePaymentTransaction(t as unknown as Record<string, unknown>)),
    summary: {
      totalCount,
      paidCount,
      pendingCount,
      failedCount,
      refundedCount,
      paidVolume,
      refundedVolume,
      codPendingCount: Number(codPendingAgg[0]?.count || 0),
      codPendingVolume: Number(codPendingAgg[0]?.volume || 0),
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getPaymentTransactionDetailAdmin(idOrTranId: string) {
  const query = mongoose.isValidObjectId(idOrTranId)
    ? { _id: idOrTranId }
    : { transactionId: idOrTranId };
  const tx = await PaymentTransactionModel.findOne(query).lean();
  if (!tx) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Payment transaction not found.');

  const order = await OrderModel.findById(tx.orderId)
    .select('orderNumber orderStatus paymentStatus paymentMethod total subtotal discount shippingCharge customerName customerEmail customerPhone shippingAddress createdAt')
    .lean();

  return {
    transaction: serializePaymentTransaction(tx as unknown as Record<string, unknown>),
    order: order ? { ...order, id: String(order._id) } : null,
  };
}

export async function getPaymentAnalyticsAdmin(days = 30) {
  const windowDays = Math.min(365, Math.max(1, days));
  const isDbConnected = mongoose.connection.readyState === 1;
  const cacheKey = `payment-analytics:${windowDays}`;
  if (isDbConnected) {
    const cached = adminCache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;
  }

  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [byProvider, byMethod, dailySeries, codOrdersAgg] = await Promise.all([
    PaymentTransactionModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$provider',
          totalCount: { $sum: 1 },
          paidCount: {
            $sum: { $cond: [{ $in: ['$status', ['paid', 'partially_refunded', 'refunded']] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled', 'expired']] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $in: ['$status', ['initiated', 'pending', 'authorized']] }, 1, 0] },
          },
          paidVolume: {
            $sum: { $cond: [{ $in: ['$status', ['paid', 'partially_refunded']] }, '$amount', 0] },
          },
          refundedVolume: { $sum: { $ifNull: ['$refundedAmount', 0] } },
        },
      },
      { $sort: { paidVolume: -1 } },
    ]),
    OrderModel.aggregate([
      { $match: { createdAt: { $gte: since }, orderStatus: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$paymentMethod',
          ordersCount: { $sum: 1 },
          grossVolume: { $sum: '$total' },
          paidVolume: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$total', 0] },
          },
        },
      },
      { $sort: { grossVolume: -1 } },
    ]),
    PaymentTransactionModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          attempts: { $sum: 1 },
          paidCount: {
            $sum: { $cond: [{ $in: ['$status', ['paid', 'partially_refunded']] }, 1, 0] },
          },
          paidVolume: {
            $sum: { $cond: [{ $in: ['$status', ['paid', 'partially_refunded']] }, '$amount', 0] },
          },
          refundedVolume: { $sum: { $ifNull: ['$refundedAmount', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    OrderModel.aggregate([
      { $match: { createdAt: { $gte: since }, paymentMethod: 'cod', orderStatus: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          volume: { $sum: '$total' },
        },
      },
    ]),
  ]);

  const result = {
    days: windowDays,
    byProvider: byProvider.map((p) => ({
      provider: String(p._id || 'unknown'),
      totalCount: Number(p.totalCount || 0),
      paidCount: Number(p.paidCount || 0),
      failedCount: Number(p.failedCount || 0),
      pendingCount: Number(p.pendingCount || 0),
      paidVolume: Number(p.paidVolume || 0),
      refundedVolume: Number(p.refundedVolume || 0),
      successRate:
        Number(p.totalCount || 0) > 0
          ? Number(((Number(p.paidCount || 0) / Number(p.totalCount || 0)) * 100).toFixed(1))
          : 0,
    })),
    byMethod: byMethod.map((m) => ({
      paymentMethod: String(m._id || 'unknown'),
      ordersCount: Number(m.ordersCount || 0),
      grossVolume: Number(m.grossVolume || 0),
      paidVolume: Number(m.paidVolume || 0),
    })),
    dailySeries: dailySeries.map((d) => ({
      date: String(d._id),
      attempts: Number(d.attempts || 0),
      paidCount: Number(d.paidCount || 0),
      paidVolume: Number(d.paidVolume || 0),
      refundedVolume: Number(d.refundedVolume || 0),
    })),
    codBreakdown: codOrdersAgg.map((c) => ({
      status: String(c._id),
      count: Number(c.count || 0),
      volume: Number(c.volume || 0),
    })),
  };
  if (isDbConnected) {
    adminCache.set(cacheKey, result, 30_000);
  }
  return result;
}

export async function listCancellationRequestsAdmin(params: {
  page: number;
  limit: number;
  status: string;
  q: string;
}) {
  const filter: Record<string, unknown> = {
    cancellationRequest: { $ne: null },
  };
  if (params.status && ['pending', 'approved', 'rejected'].includes(params.status)) {
    filter['cancellationRequest.status'] = params.status;
  } else {
    filter['cancellationRequest.status'] = { $in: ['pending', 'approved', 'rejected'] };
  }
  if (params.q) {
    const regex = new RegExp(params.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { orderNumber: regex },
      { customerName: regex },
      { customerEmail: regex },
      { customerPhone: regex },
      { 'cancellationRequest.reason': regex },
    ];
  }

  const [total, pendingCount, approvedCount, rejectedCount, orders] = await Promise.all([
    OrderModel.countDocuments(filter),
    OrderModel.countDocuments({ 'cancellationRequest.status': 'pending' }),
    OrderModel.countDocuments({ 'cancellationRequest.status': 'approved' }),
    OrderModel.countDocuments({ 'cancellationRequest.status': 'rejected' }),
    OrderModel.find(filter)
      .sort({ 'cancellationRequest.requestedAt': -1, createdAt: -1 })
      .skip((params.page - 1) * params.limit)
      .limit(params.limit)
      .lean(),
  ]);

  return {
    requests: orders.map((o) => ({
      ...o,
      id: String(o._id),
    })),
    counts: {
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      all: pendingCount + approvedCount + rejectedCount,
    },
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

export async function reviewCancellationRequestAdmin(params: {
  orderId: string;
  action: 'approve' | 'reject';
  adminNotes?: string;
  actorId: unknown;
  actorName: string;
}) {
  if (!mongoose.isValidObjectId(params.orderId)) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }

  const result = await withInventoryTransaction(async (session) => {
    const order = await applyMongoSession(OrderModel.findById(params.orderId), session);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (!order.cancellationRequest || order.cancellationRequest.status !== 'pending') {
      throw new AppError(409, 'NO_PENDING_CANCELLATION', 'This order does not have a pending cancellation request.');
    }

    const now = new Date();
    const prevStatus = order.orderStatus;
    const cancellationReason = order.cancellationRequest.reason;
    if (params.action === 'approve') {
      if (['shipped', 'delivered', 'cancelled', 'returned'].includes(prevStatus)) {
        throw new AppError(
          409,
          'CANNOT_APPROVE_AFTER_DISPATCH',
          `Order in "${prevStatus}" status cannot be cancelled via request approval.`,
        );
      }

      const previousPaymentStatus = order.paymentStatus;
      if (shouldRestoreStockOnCancel(prevStatus, previousPaymentStatus)) {
        for (const item of order.items) {
          const product = await applyMongoSession(
            ProductModel.findById(item.productId).select('manageInventory'),
            session,
          );
          if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product for order item "${item.sku}" no longer exists.`);
          if (product.manageInventory === false) continue;
          await applyInventoryMutation(session, {
            productId: item.productId,
            variantId: item.variantId,
            type: 'release',
            quantity: item.quantity,
            reason: `Cancellation request approved (${order.orderNumber})`,
            referenceId: order.orderNumber,
            actorId: params.actorId,
            actorName: params.actorName,
          });
        }
      }

      if (previousPaymentStatus === 'paid') {
        order.paymentStatus = 'refund_pending';
        await PaymentTransactionModel.updateMany(
          { orderId: order._id, status: 'paid' },
          { $set: { status: 'refund_pending' } },
          { session },
        );
      } else if (previousPaymentStatus === 'pending') {
        order.paymentStatus = 'cancelled';
      }
      order.orderStatus = 'cancelled';
      order.fulfillmentStatus = 'cancelled';
      order.cancellationReason = cancellationReason;
      order.cancellationRequest.status = 'approved';
      order.cancellationRequest.reviewedBy = params.actorId as typeof order.cancellationRequest.reviewedBy;
      order.cancellationRequest.reviewedByName = params.actorName;
      order.cancellationRequest.reviewedAt = now;
      order.cancellationRequest.adminNotes = params.adminNotes || '';
      order.statusHistory.push({
        fromStatus: prevStatus,
        toStatus: 'cancelled',
        actorId: params.actorId as typeof order.statusHistory[0]['actorId'],
        actorName: params.actorName,
        reason: `Cancellation request approved: ${cancellationReason}`,
        timestamp: now,
      });
      order.cancellationHistory.push({
        action: 'approved',
        actorId: params.actorId as typeof order.cancellationHistory[0]['actorId'],
        actorName: params.actorName,
        reason: cancellationReason,
        adminNotes: params.adminNotes || '',
        timestamp: now,
      });
    } else {
      order.cancellationRequest.status = 'rejected';
      order.cancellationRequest.reviewedBy = params.actorId as typeof order.cancellationRequest.reviewedBy;
      order.cancellationRequest.reviewedByName = params.actorName;
      order.cancellationRequest.reviewedAt = now;
      order.cancellationRequest.adminNotes = params.adminNotes || '';
      order.cancellationHistory.push({
        action: 'rejected',
        actorId: params.actorId as typeof order.cancellationHistory[0]['actorId'],
        actorName: params.actorName,
        reason: cancellationReason,
        adminNotes: params.adminNotes || '',
        timestamp: now,
      });
    }

    await order.save({ session });
    return {
      order: { ...order.toObject(), id: String(order._id) },
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      customerName: order.customerName,
      action: params.action,
    };
  });

  dispatchTransactionalEmailInBackground(
    {
      to: result.customerEmail,
      template:
        params.action === 'approve' ? 'order_cancellation_approved' : 'order_cancellation_rejected',
      idempotencyKey: `cancel-review:${result.orderNumber}:${params.action}`,
      subject:
        params.action === 'approve'
          ? `OnnoRupbd — Order ${result.orderNumber} Cancellation Approved`
          : `OnnoRupbd — Cancellation Request Update (${result.orderNumber})`,
      html:
        params.action === 'approve'
          ? `<p>Hello ${result.customerName},</p><p>Your cancellation request for order <strong>${result.orderNumber}</strong> has been approved.</p>${params.adminNotes ? `<p>Note: ${params.adminNotes}</p>` : ''}`
          : `<p>Hello ${result.customerName},</p><p>Your cancellation request for order <strong>${result.orderNumber}</strong> could not be approved.</p>${params.adminNotes ? `<p>Operations Note: ${params.adminNotes}</p>` : ''}`,
    },
    `order ${result.orderNumber}`,
  );

  invalidateAdminOrderCaches();
  return {
    order: result.order,
    orderNumber: result.orderNumber,
    action: result.action,
  };
}

