import mongoose from 'mongoose';
import { OrderModel } from '../orders/order.model';
import { ProductModel } from '../products/product.model';
import { UserModel } from '../users/user.model';
import { ReviewModel } from '../reviews/review.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { WishlistModel } from '../cart/cart.model';
import { AuditLogModel, SiteVisitModel, SupportEnquiryModel } from '../support/support.model';
import { PaymentTransactionModel } from '../orders/order.model';
import { calculateFinancialSummary, money, sumCompletedRefunds } from '../../../../src/lib/financialAnalytics';
import { getReportingDateKey, getReportingMonthKey } from '../../../../src/lib/reportingDate';
import { env } from '../../config/env';
import { adminCache, adminSingleFlight } from '../../utils/ttlCache';

function calcTrendPct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function buildDailyBuckets(days: number, now: Date): Array<{ key: string; label: string; date: Date }> {
  const buckets: Array<{ key: string; label: string; date: Date }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = getReportingDateKey(d, env.STORE_TIMEZONE);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    buckets.push({ key, label, date: d });
  }
  return buckets;
}

function getProductAvailableStock(p: {
  hasVariants?: boolean;
  variants?: Array<{ isActive?: boolean; stockOnHand?: number; reservedStock?: number }>;
  stockOnHand?: number;
  reservedStock?: number;
}): number {
  if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
    return p.variants
      .filter((v) => v.isActive !== false)
      .reduce((sum, v) => sum + Math.max(0, Number(v.stockOnHand || 0) - Number(v.reservedStock || 0)), 0);
  }
  return Math.max(0, Number(p.stockOnHand || 0) - Number(p.reservedStock || 0));
}

function isProductLowStock(p: {
  manageInventory?: boolean;
  hasVariants?: boolean;
  variants?: Array<{ isActive?: boolean; stockOnHand?: number; reservedStock?: number; lowStockThreshold?: number }>;
  stockOnHand?: number;
  reservedStock?: number;
  lowStockThreshold?: number;
}): boolean {
  if (p.manageInventory === false) return false;
  const fallbackThreshold = Number(p.lowStockThreshold ?? 5);
  if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
    const activeVariants = p.variants.filter((v) => v.isActive !== false);
    if (activeVariants.length === 0) return false;
    return activeVariants.some(
      (v) => Math.max(0, Number(v.stockOnHand || 0) - Number(v.reservedStock || 0)) <= Number(v.lowStockThreshold ?? fallbackThreshold),
    );
  }
  return getProductAvailableStock(p) <= fallbackThreshold;
}

export function resolveOriginalRegistrationProvider(user: {
  initialAuthProvider?: string | null;
  authProvider?: string | null;
}): 'local' | 'google' | 'facebook' {
  const raw = user.initialAuthProvider || user.authProvider || 'local';
  if (raw === 'google') return 'google';
  if (raw === 'facebook') return 'facebook';
  return 'local';
}

export function aggregateProviderRegistrationsPure(
  users: Array<{
    initialAuthProvider?: string | null;
    authProvider?: string | null;
    isVerified?: boolean;
    oauthProviders?: { googleId?: string; facebookId?: string } | null;
    hasPassword?: boolean;
    createdAt?: Date | string;
  }>,
  days = 30,
  now = new Date(),
) {
  let localUsers = 0;
  let googleUsers = 0;
  let facebookUsers = 0;
  let verifiedUsers = 0;
  let multiLinkedUsers = 0;

  const buckets = buildDailyBuckets(days, now);
  const trendMap = new Map<string, { local: number; google: number; facebook: number; total: number }>();
  for (const b of buckets) {
    trendMap.set(b.key, { local: 0, google: 0, facebook: 0, total: 0 });
  }

  for (const u of users) {
    const origin = resolveOriginalRegistrationProvider(u);
    if (origin === 'google') googleUsers += 1;
    else if (origin === 'facebook') facebookUsers += 1;
    else localUsers += 1;

    if (u.isVerified) verifiedUsers += 1;

    const methodCount =
      (origin === 'local' || u.hasPassword ? 1 : 0) +
      (u.oauthProviders?.googleId ? 1 : 0) +
      (u.oauthProviders?.facebookId ? 1 : 0);
    if (methodCount >= 2) multiLinkedUsers += 1;

    if (u.createdAt) {
      const key = getReportingDateKey(u.createdAt, env.STORE_TIMEZONE);
      const bucket = trendMap.get(key);
      if (bucket) {
        bucket[origin] += 1;
        bucket.total += 1;
      }
    }
  }

  const totalRegisteredUsers = localUsers + googleUsers + facebookUsers;
  const denom = Math.max(1, totalRegisteredUsers);

  return {
    summary: {
      totalRegisteredUsers,
      localUsers,
      googleUsers,
      facebookUsers,
      localSharePct: totalRegisteredUsers > 0 ? Number(((localUsers / denom) * 100).toFixed(1)) : 0,
      googleSharePct: totalRegisteredUsers > 0 ? Number(((googleUsers / denom) * 100).toFixed(1)) : 0,
      facebookSharePct: totalRegisteredUsers > 0 ? Number(((facebookUsers / denom) * 100).toFixed(1)) : 0,
      multiLinkedUsers,
      verifiedUsers,
    },
    dailyTrends: buckets.map((b) => {
      const counts = trendMap.get(b.key) || { local: 0, google: 0, facebook: 0, total: 0 };
      return {
        date: b.key,
        label: b.label,
        ...counts,
      };
    }),
  };
}

interface TrackedStockProduct {
  _id: unknown;
  name: string;
  sku: string;
  stockOnHand?: number;
  reservedStock?: number;
  lowStockThreshold?: number;
  manageInventory?: boolean;
  hasVariants?: boolean;
  variants?: Array<{ isActive?: boolean; stockOnHand?: number; reservedStock?: number; lowStockThreshold?: number }>;
  images?: Array<{ url?: string }>;
}

async function getTrackedLowStockProducts(isLiveDb: boolean): Promise<TrackedStockProduct[]> {
  if (isLiveDb) {
    const cached = adminCache.get<TrackedStockProduct[]>('low-stock');
    if (cached) return cached;
    return adminSingleFlight.run('low-stock', async () => {
      const again = adminCache.get<TrackedStockProduct[]>('low-stock');
      if (again) return again;
      const rows = (await ProductModel.find({ status: 'published', manageInventory: { $ne: false } })
        .select('name sku stockOnHand reservedStock lowStockThreshold manageInventory hasVariants variants images')
        .lean()) as TrackedStockProduct[];
      adminCache.set('low-stock', rows, 15_000);
      return rows;
    });
  }
  return (await ProductModel.find({ status: 'published', manageInventory: { $ne: false } })
    .select('name sku stockOnHand reservedStock lowStockThreshold manageInventory hasVariants variants images')
    .lean()) as TrackedStockProduct[];
}

export async function getAdminOverviewData(days: number, revRange: string): Promise<Awaited<ReturnType<typeof computeAdminOverviewData>>> {
  const isLiveDb = mongoose.connection.readyState === 1;
  const cacheKey = `overview:${days}:${revRange}`;
  if (isLiveDb) {
    const cached = adminCache.get<Awaited<ReturnType<typeof computeAdminOverviewData>>>(cacheKey);
    if (cached) return cached;
    return adminSingleFlight.run(cacheKey, async () => {
      const cachedAgain = adminCache.get<Awaited<ReturnType<typeof computeAdminOverviewData>>>(cacheKey);
      if (cachedAgain) return cachedAgain;
      const overviewResult = await computeAdminOverviewData(days, revRange, true);
      adminCache.set(cacheKey, overviewResult, 15_000);
      return overviewResult;
    });
  }
  return computeAdminOverviewData(days, revRange, false);
}

async function computeAdminOverviewData(days: number, revRange: string, isLiveDb: boolean) {

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);

  const revDays = revRange === 'week' ? 7 : revRange === 'year' ? 365 : 30;
  const revSince = new Date(now.getTime() - revDays * 24 * 60 * 60 * 1000);
  const prevRevSince = new Date(revSince.getTime() - revDays * 24 * 60 * 60 * 1000);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const multiLinkedUserFilter = {
    $or: [
      {
        'oauthProviders.googleId': { $exists: true, $type: 'string' },
        'oauthProviders.facebookId': { $exists: true, $type: 'string' },
      },
      {
        initialAuthProvider: 'local',
        $or: [
          { 'oauthProviders.googleId': { $exists: true, $type: 'string' } },
          { 'oauthProviders.facebookId': { $exists: true, $type: 'string' } },
        ],
      },
      {
        initialAuthProvider: { $in: ['google', 'facebook'] },
        passwordHash: { $exists: true, $type: 'string', $ne: '' },
      },
    ],
  };

  const userStatsPromise = isLiveDb
    ? UserModel.aggregate([
        {
          $facet: {
            allCustomers: [{ $match: { role: 'customer' } }, { $count: 'count' }],
            prevCustomers: [{ $match: { role: 'customer', createdAt: { $gte: prevSince, $lt: since } } }, { $count: 'count' }],
            totalUsers: [{ $count: 'count' }],
            newToday: [{ $match: { createdAt: { $gte: startOfToday } } }, { $count: 'count' }],
            newWeek: [{ $match: { createdAt: { $gte: startOfWeek } } }, { $count: 'count' }],
            newMonth: [{ $match: { createdAt: { $gte: startOfMonth } } }, { $count: 'count' }],
            verified: [{ $match: { isVerified: true } }, { $count: 'count' }],
            unverified: [{ $match: { isVerified: { $ne: true } } }, { $count: 'count' }],
            active: [{ $match: { status: 'active' } }, { $count: 'count' }],
            disabled: [{ $match: { status: 'suspended' } }, { $count: 'count' }],
            providers: [
              {
                $project: {
                  originProvider: { $ifNull: ['$initialAuthProvider', { $ifNull: ['$authProvider', 'local'] }] },
                },
              },
              { $group: { _id: '$originProvider', count: { $sum: 1 } } },
            ],
            multiLinked: [{ $match: multiLinkedUserFilter }, { $count: 'count' }],
            customersWindowDaily: [
              { $match: { role: 'customer', createdAt: { $gte: since } } },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.STORE_TIMEZONE } },
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]).then((rows) => {
        const doc = (rows[0] || {}) as Record<string, Array<{ _id?: string; count?: number }>>;
        const pick = (key: string) => Number(doc[key]?.[0]?.count || 0);
        const customersWindowDaily = doc.customersWindowDaily || [];
        const customersWindowCount = customersWindowDaily.reduce((sum, row) => sum + Number(row.count || 0), 0);
        return {
          allCustomersCount: pick('allCustomers'),
          prevCustomersCount: pick('prevCustomers'),
          totalUsersCount: pick('totalUsers'),
          newUsersTodayCount: pick('newToday'),
          newUsersWeekCount: pick('newWeek'),
          newUsersMonthCount: pick('newMonth'),
          verifiedUsersCount: pick('verified'),
          unverifiedUsersCount: pick('unverified'),
          activeUsersCount: pick('active'),
          disabledUsersCount: pick('disabled'),
          providerCountsRaw: doc.providers || [],
          multiLinkedUsersCount: pick('multiLinked'),
          customersWindowDaily,
          customersWindowCount,
        };
      })
    : Promise.all([
        UserModel.countDocuments({ role: 'customer' }),
        UserModel.countDocuments({ role: 'customer', createdAt: { $gte: prevSince, $lt: since } }),
        UserModel.countDocuments(),
        UserModel.countDocuments({ createdAt: { $gte: startOfToday } }),
        UserModel.countDocuments({ createdAt: { $gte: startOfWeek } }),
        UserModel.countDocuments({ createdAt: { $gte: startOfMonth } }),
        UserModel.countDocuments({ isVerified: true }),
        UserModel.countDocuments({ isVerified: { $ne: true } }),
        UserModel.countDocuments({ status: 'active' }),
        UserModel.countDocuments({ status: 'suspended' }),
        UserModel.aggregate([
          {
            $project: {
              originProvider: { $ifNull: ['$initialAuthProvider', { $ifNull: ['$authProvider', 'local'] }] },
            },
          },
          { $group: { _id: '$originProvider', count: { $sum: 1 } } },
        ]),
        UserModel.countDocuments(multiLinkedUserFilter),
      ]).then(
        ([
          allCustomersCount,
          prevCustomersCount,
          totalUsersCount,
          newUsersTodayCount,
          newUsersWeekCount,
          newUsersMonthCount,
          verifiedUsersCount,
          unverifiedUsersCount,
          activeUsersCount,
          disabledUsersCount,
          providerCountsRaw,
          multiLinkedUsersCount,
        ]) => ({
          allCustomersCount,
          prevCustomersCount,
          totalUsersCount,
          newUsersTodayCount,
          newUsersWeekCount,
          newUsersMonthCount,
          verifiedUsersCount,
          unverifiedUsersCount,
          activeUsersCount,
          disabledUsersCount,
          providerCountsRaw,
          multiLinkedUsersCount,
          customersWindowDaily: null as Array<{ _id?: string; count?: number }> | null,
          customersWindowCount: null as number | null,
        }),
      );

  const reuseWindowOrders = isLiveDb && days === revDays;

  const [
    ordersInWindow,
    prevOrdersInWindow,
    allOrdersCountRaw,
    userStatsFacet,
    customersInWindowRaw,
    activeProductsCount,
    totalReviewsCount,
    pendingReviewsCount,
    visitorsInWindow,
    prevVisitorsCount,
    dailyVisits,
    pendingOrdersCountRaw,
    trackedPublishedProducts,
    recentOrders,
    topProductsRaw,
    recentAudit,
    statusCountsRaw,
    cmsConfig,
    openEnquiriesCount,
    revOrdersQueryRaw,
    prevRevOrdersAggQueryRaw,
    revTransactionsRaw,
    prevRevTransactionsRaw,
  ] = await Promise.all([
    OrderModel.find({ createdAt: { $gte: since } }).select('total orderStatus paymentStatus paymentMethod createdAt').lean(),
    OrderModel.find({ createdAt: { $gte: prevSince, $lt: since } })
      .select('total orderStatus paymentStatus paymentMethod createdAt')
      .lean(),
    isLiveDb ? Promise.resolve<number | null>(null) : OrderModel.countDocuments(),
    userStatsPromise,
    isLiveDb
      ? Promise.resolve<Array<{ createdAt: Date | string }>>([])
      : UserModel.find({ role: 'customer', createdAt: { $gte: since } }).select('createdAt').lean(),
    ProductModel.countDocuments({ status: 'published' }),
    ReviewModel.countDocuments(),
    ReviewModel.countDocuments({ status: 'pending' }),
    SiteVisitModel.countDocuments({ createdAt: { $gte: since } }),
    SiteVisitModel.countDocuments({ createdAt: { $gte: prevSince, $lt: since } }),
    SiteVisitModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.STORE_TIMEZONE } }, count: { $sum: 1 } } },
    ]),
    isLiveDb
      ? Promise.resolve<number | null>(null)
      : OrderModel.countDocuments({ orderStatus: { $in: ['pending', 'confirmed', 'processing', 'packed'] } }),
    getTrackedLowStockProducts(isLiveDb),
    OrderModel.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .select('orderNumber customerName customerEmail total orderStatus paymentStatus createdAt')
      .lean(),
    ProductModel.find({ status: 'published' })
      .sort({ soldCount: -1, ratingAverage: -1 })
      .limit(5)
      .select('name slug sku soldCount stockOnHand reservedStock hasVariants variants basePrice salePrice images')
      .lean(),
    AuditLogModel.find().sort({ createdAt: -1 }).limit(10).lean(),
    OrderModel.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
    HomepageConfigModel.findOne({ key: 'main' }).select('contactInfo footerSettings maintenanceMode').lean(),
    SupportEnquiryModel.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    reuseWindowOrders
      ? Promise.resolve(null)
      : OrderModel.find({
          createdAt: { $gte: revSince },
          orderStatus: { $nin: ['cancelled', 'returned'] },
          paymentStatus: { $nin: ['failed', 'cancelled', 'expired'] },
        })
          .select('total orderStatus paymentStatus createdAt')
          .lean(),
    reuseWindowOrders
      ? Promise.resolve(null)
      : OrderModel.aggregate([
          {
            $match: {
              createdAt: { $gte: prevRevSince, $lt: revSince },
              orderStatus: { $nin: ['cancelled', 'returned'] },
              paymentStatus: { $nin: ['failed', 'cancelled', 'expired'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
    isLiveDb ? PaymentTransactionModel.find({
      createdAt: { $gte: revSince },
    }).select('orderId status duplicatePayment reconciliationRequired amount verifiedAmount refundedAmount refunds').lean() : Promise.resolve([]),
    isLiveDb ? PaymentTransactionModel.find({
      createdAt: { $gte: prevRevSince, $lt: revSince },
    }).select('orderId status duplicatePayment reconciliationRequired amount verifiedAmount refundedAmount refunds').lean() : Promise.resolve([]),
  ]);

  const statusMap = new Map<string, number>();
  let totalOrdersFromStatus = 0;
  for (const row of statusCountsRaw) {
    const count = Number(row.count || 0);
    statusMap.set(String(row._id), count);
    totalOrdersFromStatus += count;
  }
  const allOrdersCount = allOrdersCountRaw ?? totalOrdersFromStatus;
  const pendingOrdersCount =
    pendingOrdersCountRaw ??
    ((statusMap.get('pending') || 0) +
      (statusMap.get('confirmed') || 0) +
      (statusMap.get('processing') || 0) +
      (statusMap.get('packed') || 0));

  const isRecognizedRevOrder = (o: { orderStatus?: string; paymentStatus?: string }) =>
    o.orderStatus !== 'cancelled' &&
    o.orderStatus !== 'returned' &&
    !['failed', 'cancelled', 'expired'].includes(String(o.paymentStatus || ''));

  const revOrdersRaw = revOrdersQueryRaw ?? ordersInWindow.filter(isRecognizedRevOrder);
  const prevRevOrdersTotalGross = prevRevOrdersAggQueryRaw
    ? Number(prevRevOrdersAggQueryRaw[0]?.total || 0)
    : prevOrdersInWindow.filter(isRecognizedRevOrder).reduce((sum, o) => sum + Number(o.total || 0), 0);

  const {
    allCustomersCount,
    prevCustomersCount,
    totalUsersCount,
    newUsersTodayCount,
    newUsersWeekCount,
    newUsersMonthCount,
    verifiedUsersCount,
    unverifiedUsersCount,
    activeUsersCount,
    disabledUsersCount,
    providerCountsRaw,
    multiLinkedUsersCount,
    customersWindowDaily,
    customersWindowCount,
  } = userStatsFacet;
  const prevOrdersCount = prevOrdersInWindow.length;

  const providerCountMap = new Map<string, number>();
  for (const row of providerCountsRaw) {
    providerCountMap.set(String(row._id || 'local'), Number(row.count || 0));
  }

  const allLowStockProducts = trackedPublishedProducts
    .filter((p) => isProductLowStock(p))
    .map((p) => ({
      ...p,
      availableStock: getProductAvailableStock(p),
    }));
  const lowStockProducts = allLowStockProducts.slice(0, 12);
  const outOfStockCount = trackedPublishedProducts.filter((p) => getProductAvailableStock(p) <= 0).length;

  let cancelledCount = 0;
  let returnedCount = 0;
  let paidTotal = 0;
  let codPendingTotal = 0;

  const unpaidFailedSet = new Set(['failed', 'cancelled', 'expired']);
  for (const o of ordersInWindow) {
    if (o.orderStatus === 'cancelled') cancelledCount += 1;
    if (o.orderStatus === 'returned' || o.orderStatus === 'return_requested') returnedCount += 1;
    if (o.paymentStatus === 'paid') paidTotal += o.total;
    if (o.paymentMethod === 'cod' && o.paymentStatus === 'unpaid' && o.orderStatus !== 'cancelled') {
      codPendingTotal += o.total;
    }
  }

  const financialWindow = calculateFinancialSummary(ordersInWindow, revTransactionsRaw);
  const grossSales = financialWindow.grossOrderValue;
  const netSales = financialWindow.netSales;
  const successfulRefunds = financialWindow.successfulRefunds;
  const collectedCash = financialWindow.collectedCash;
  const outstandingPayments = financialWindow.outstandingPayments;
  const activeOrderCount = ordersInWindow.filter(
    (o) =>
      o.orderStatus !== 'cancelled' &&
      o.orderStatus !== 'returned' &&
      !unpaidFailedSet.has(String(o.paymentStatus || '')),
  ).length;
  const avgOrderValue = activeOrderCount > 0 ? Math.round(netSales / activeOrderCount) : 0;
  const prevRevenue = calculateFinancialSummary(prevOrdersInWindow, prevRevTransactionsRaw).netSales;
  const prevRevRefunds = prevRevTransactionsRaw.reduce(
    (sum: number, transaction: { status?: string; duplicatePayment?: boolean; reconciliationRequired?: boolean; refundedAmount?: number; refunds?: unknown[] }) =>
      sum + (transaction.status === 'paid' || transaction.status === 'partially_refunded' || transaction.status === 'refunded'
        ? sumCompletedRefunds(transaction as never)
        : 0),
    0,
  );
  const prevRevOverviewTotal = money(Math.max(0, prevRevOrdersTotalGross - prevRevRefunds));

  const completedTotal = statusMap.get('delivered') || 0;
  const pendingTotal =
    (statusMap.get('pending') || 0) +
    (statusMap.get('confirmed') || 0) +
    (statusMap.get('processing') || 0) +
    (statusMap.get('packed') || 0) +
    (statusMap.get('shipped') || 0);
  const cancelledAllTotal = statusMap.get('cancelled') || 0;
  const refundedAllTotal = (statusMap.get('returned') || 0) + (statusMap.get('return_requested') || 0);
  const donutDenom = Math.max(1, completedTotal + pendingTotal + cancelledAllTotal + refundedAllTotal);

  const orderStatusBreakdown = {
    totalOrders: allOrdersCount,
    segments: [
      { key: 'completed', label: 'Completed', count: completedTotal, percent: allOrdersCount > 0 ? Number(((completedTotal / donutDenom) * 100).toFixed(1)) : 0, color: '#145CFF' },
      { key: 'pending', label: 'Pending', count: pendingTotal, percent: allOrdersCount > 0 ? Number(((pendingTotal / donutDenom) * 100).toFixed(1)) : 0, color: '#F59E0B' },
      { key: 'cancelled', label: 'Cancelled', count: cancelledAllTotal, percent: allOrdersCount > 0 ? Number(((cancelledAllTotal / donutDenom) * 100).toFixed(1)) : 0, color: '#EF4444' },
      { key: 'refunded', label: 'Refunded', count: refundedAllTotal, percent: allOrdersCount > 0 ? Number(((refundedAllTotal / donutDenom) * 100).toFixed(1)) : 0, color: '#CBD5E1' },
    ],
  };

  const buckets = buildDailyBuckets(days, now);
  const orderDaySales = new Map<string, { revenue: number; orders: number }>();
  const refundByOrderId = new Map<string, number>();
  for (const transaction of revTransactionsRaw) {
    if (transaction.duplicatePayment || transaction.reconciliationRequired) continue;
    const key = String(transaction.orderId || '');
    if (key) {
      refundByOrderId.set(key, (refundByOrderId.get(key) || 0) + sumCompletedRefunds(transaction));
    }
  }
  for (const o of ordersInWindow) {
    const k = getReportingDateKey(o.createdAt, env.STORE_TIMEZONE);
    const cur = orderDaySales.get(k) || { revenue: 0, orders: 0 };
    cur.orders += 1;
    const financial = calculateFinancialSummary([o], []);
    cur.revenue += Math.max(0, financial.netSales - (refundByOrderId.get(String(o._id)) || 0));
    orderDaySales.set(k, cur);
  }

  const custDayCounts = new Map<string, number>();
  if (customersWindowDaily) {
    for (const row of customersWindowDaily) {
      if (row._id) {
        custDayCounts.set(String(row._id), Number(row.count || 0));
      }
    }
  } else {
    for (const c of customersInWindowRaw) {
      const k = getReportingDateKey(c.createdAt, env.STORE_TIMEZONE);
      custDayCounts.set(k, (custDayCounts.get(k) || 0) + 1);
    }
  }
  const customersInWindowLength = customersWindowCount ?? customersInWindowRaw.length;

  const visitDayMap = new Map<string, number>();
  for (const v of dailyVisits) {
    visitDayMap.set(String(v._id), Number(v.count || 0));
  }

  const salesSeries = buckets.map((b) => {
    const oData = orderDaySales.get(b.key) || { revenue: 0, orders: 0 };
    return {
      date: b.key,
      label: b.label,
      revenue: oData.revenue,
      orders: oData.orders,
      customers: custDayCounts.get(b.key) || 0,
      visitors: visitDayMap.get(b.key) || 0,
    };
  });

  let revenueSeries: Array<{ label: string; revenue: number; orders: number }> = [];
  let revenueOverviewTotal = 0;
  if (revRange === 'year') {
    const monthBuckets = new Map<string, { label: string; revenue: number; orders: number }>();
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = getReportingMonthKey(d, env.STORE_TIMEZONE);
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      monthBuckets.set(key, { label, revenue: 0, orders: 0 });
    }
    for (const o of revOrdersRaw) {
      const d = new Date(o.createdAt);
      const key = getReportingMonthKey(d, env.STORE_TIMEZONE);
      const bucket = monthBuckets.get(key);
      if (bucket) {
        const net = calculateFinancialSummary([o], []);
        bucket.revenue += Math.max(0, net.netSales - (refundByOrderId.get(String(o._id)) || 0));
        bucket.orders += 1;
      }
      const net = calculateFinancialSummary([o], []);
      revenueOverviewTotal += Math.max(0, net.netSales - (refundByOrderId.get(String(o._id)) || 0));
    }
    revenueSeries = Array.from(monthBuckets.values());
  } else {
    const barDays = revRange === 'week' ? 7 : 30;
    const barBuckets = buildDailyBuckets(barDays, now);
    const dayMap = new Map<string, { revenue: number; orders: number }>();
    for (const o of revOrdersRaw) {
      const key = getReportingDateKey(o.createdAt, env.STORE_TIMEZONE);
      const cur = dayMap.get(key) || { revenue: 0, orders: 0 };
      const net = calculateFinancialSummary([o], []);
      const recognized = Math.max(0, net.netSales - (refundByOrderId.get(String(o._id)) || 0));
      cur.revenue += recognized;
      cur.orders += 1;
      dayMap.set(key, cur);
      revenueOverviewTotal += recognized;
    }
    revenueSeries = barBuckets.map((b) => ({
      label: b.label,
      revenue: dayMap.get(b.key)?.revenue || 0,
      orders: dayMap.get(b.key)?.orders || 0,
    }));
  }

  const sparkSlice = salesSeries.slice(-10);

  const overviewResult = {
    periodDays: days,
    userStats: {
      totalUsers: totalUsersCount,
      totalCustomers: allCustomersCount,
      newToday: newUsersTodayCount,
      newThisWeek: newUsersWeekCount,
      newThisMonth: newUsersMonthCount,
      verifiedUsers: verifiedUsersCount,
      unverifiedUsers: unverifiedUsersCount,
      activeUsers: activeUsersCount,
      disabledUsers: disabledUsersCount,
      providerBreakdown: {
        local: providerCountMap.get('local') || 0,
        google: providerCountMap.get('google') || 0,
        facebook: providerCountMap.get('facebook') || 0,
        multiLinked: multiLinkedUsersCount,
      },
    },
    metrics: {
      grossSales,
      netSales,
      orderCount: ordersInWindow.length,
      totalOrdersAllTime: allOrdersCount,
      ordersTrendPct: calcTrendPct(ordersInWindow.length, prevOrdersCount),
      totalCustomers: allCustomersCount,
      customersTrendPct: calcTrendPct(customersInWindowLength, prevCustomersCount),
      revenueTrendPct: calcTrendPct(netSales, prevRevenue),
      activeProducts: activeProductsCount,
      visitors30d: visitorsInWindow,
      visitorsTrendPct: calcTrendPct(visitorsInWindow, prevVisitorsCount),
      pendingReviews: pendingReviewsCount,
      totalReviews: totalReviewsCount,
      activeOrderCount,
      avgOrderValue,
      pendingOrders: pendingOrdersCount,
      lowStockCount: allLowStockProducts.length,
      outOfStockCount,
      cancelledCount,
      returnedCount,
      paidTotal,
      codPendingTotal,
      successfulRefunds,
      collectedCash,
      outstandingPayments,
      openEnquiriesCount,
    },
    sparklines: {
      orders: sparkSlice.map((s) => s.orders),
      customers: sparkSlice.map((s) => s.customers),
      revenue: sparkSlice.map((s) => s.revenue),
      products: sparkSlice.map(() => activeProductsCount),
      visitors: sparkSlice.map((s) => s.visitors),
      reviews: sparkSlice.map(() => pendingReviewsCount),
    },
    salesSeries,
    orderStatusBreakdown,
    recentOrders: recentOrders.map((o) => ({ ...o, id: String(o._id) })),
    revenueOverview: {
      total: revenueOverviewTotal,
      trendPct: calcTrendPct(revenueOverviewTotal, prevRevOverviewTotal),
      range: revRange,
      series: revenueSeries,
    },
    topProducts: topProductsRaw.map((p) => ({
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      soldCount: p.soldCount || 0,
      availableStock: getProductAvailableStock(p),
      price: p.salePrice ?? p.basePrice,
      imageUrl: p.images?.[0]?.url || '',
    })),
    footerSummary: {
      contactInfo: cmsConfig?.contactInfo || {},
      copyrightText: cmsConfig?.footerSettings?.copyrightText || '© 2026 OnnoRupbd. All Rights Reserved.',
      storeStatus: cmsConfig?.maintenanceMode?.enabled ? 'maintenance' : cmsConfig?.footerSettings?.storeStatus || 'live',
    },
    lowStockProducts,
    recentAudit,
  };

  return overviewResult;
}

export async function searchAdminEntities(q: string) {
  if (q.length < 2) {
    return { products: [], orders: [], customers: [] };
  }
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [products, orders, customers] = await Promise.all([
    ProductModel.find({ $or: [{ name: regex }, { sku: regex }, { brandName: regex }] })
      .select('name sku basePrice salePrice status images')
      .limit(5)
      .lean(),
    OrderModel.find({ $or: [{ orderNumber: regex }, { customerName: regex }, { customerEmail: regex }, { customerPhone: regex }] })
      .select('orderNumber customerName total orderStatus createdAt')
      .limit(5)
      .lean(),
    UserModel.find({ role: 'customer', $or: [{ name: regex }, { email: regex }, { phone: regex }] })
      .select('name email phone status')
      .limit(5)
      .lean(),
  ]);

  return {
    products: products.map((p) => ({ id: String(p._id), name: p.name, sku: p.sku, status: p.status, price: p.salePrice ?? p.basePrice, imageUrl: p.images?.[0]?.url || '' })),
    orders: orders.map((o) => ({ id: String(o._id), orderNumber: o.orderNumber, customerName: o.customerName, total: o.total, status: o.orderStatus })),
    customers: customers.map((c) => ({ id: String(c._id), name: c.name, email: c.email, phone: c.phone || '', status: c.status })),
  };
}

export async function getAdminNotificationsFeed() {
  const isLiveDb = mongoose.connection.readyState === 1;
  if (isLiveDb) {
    const cached = adminCache.get<{ unreadCount: number; items: unknown[] }>('notifications');
    if (cached) return cached;
    return adminSingleFlight.run('notifications', async () => {
      const again = adminCache.get<{ unreadCount: number; items: unknown[] }>('notifications');
      if (again) return again;
      const payload = await computeAdminNotificationsFeed(true);
      adminCache.set('notifications', payload, 15_000);
      return payload;
    });
  }
  return computeAdminNotificationsFeed(false);
}

interface RecentCancellationRow {
  _id: unknown;
  orderNumber: string;
  customerName: string;
  cancellationReason?: string;
  cancellationHistory?: Array<{
    action: 'direct_cancel' | 'admin_cancel' | 'requested' | 'approved' | 'rejected';
    reason?: string;
    timestamp: Date | string;
  }>;
}

export function deriveRecentCancellationAlertsPure(
  orders: RecentCancellationRow[],
  now = new Date(),
  retentionMs = 7 * 24 * 60 * 60 * 1000,
) {
  const cutoffMs = now.getTime() - retentionMs;
  const alerts: Array<{
    id: string;
    type: 'order';
    title: string;
    subtitle: string;
    link: string;
    createdAt: Date;
  }> = [];

  for (const order of orders) {
    const relevant = (order.cancellationHistory || [])
      .filter((event) => event.action === 'direct_cancel' || event.action === 'admin_cancel' || event.action === 'approved')
      .map((event) => ({ event, timestamp: new Date(event.timestamp) }))
      .filter(({ timestamp }) => !Number.isNaN(timestamp.getTime()) && timestamp.getTime() >= cutoffMs)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    if (!relevant) continue;
    const { event, timestamp } = relevant;
    const reason = event.reason || order.cancellationReason || 'No cancellation reason provided';
    const title =
      event.action === 'direct_cancel'
        ? `Order Cancelled by Customer #${order.orderNumber}`
        : event.action === 'admin_cancel'
          ? `Order Cancelled by Admin #${order.orderNumber}`
          : `Cancellation Approved #${order.orderNumber}`;

    alerts.push({
      id: `can-complete-${String(order._id)}-${event.action}`,
      type: 'order',
      title,
      subtitle: `${order.customerName} · ${reason}`,
      link: `/admin/orders/${String(order._id)}`,
      createdAt: timestamp,
    });
  }

  return alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function computeAdminNotificationsFeed(isLiveDb: boolean) {
  const recentCancellationCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [pendingOrders, pendingCancellations, recentCompletedCancellations, trackedProducts, pendingReviews, openEnquiries] = await Promise.all([
    OrderModel.find({ orderStatus: 'pending' }).sort({ createdAt: -1 }).limit(5).select('orderNumber customerName total createdAt').lean(),
    OrderModel.find({ 'cancellationRequest.status': 'pending' })
      .sort({ 'cancellationRequest.requestedAt': -1 })
      .limit(5)
      .select('orderNumber customerName cancellationRequest createdAt')
      .lean(),
    OrderModel.find({
      orderStatus: 'cancelled',
      cancellationHistory: {
        $elemMatch: {
          action: { $in: ['direct_cancel', 'admin_cancel', 'approved'] },
          timestamp: { $gte: recentCancellationCutoff },
        },
      },
    })
      .sort({ updatedAt: -1 })
      .limit(20)
      .select('orderNumber customerName cancellationReason cancellationHistory updatedAt')
      .lean(),
    getTrackedLowStockProducts(isLiveDb),
    ReviewModel.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(5).select('userName rating title createdAt').lean(),
    SupportEnquiryModel.find({ status: 'open' }).sort({ createdAt: -1 }).limit(5).select('name subject createdAt').lean(),
  ]);

  const lowStockProducts = trackedProducts.filter((p) => isProductLowStock(p)).slice(0, 5);
  const completedCancellationAlerts = deriveRecentCancellationAlertsPure(
    recentCompletedCancellations as RecentCancellationRow[],
  );

  const items = [
    ...pendingCancellations.map((o) => ({
      id: `can-${String(o._id)}`,
      type: 'order',
      title: `Cancellation Request #${o.orderNumber}`,
      subtitle: `${o.customerName} · ${o.cancellationRequest?.reason || 'Requested cancellation'}`,
      link: `/admin/orders/${String(o._id)}`,
      createdAt: o.cancellationRequest?.requestedAt || o.createdAt,
    })),
    ...pendingOrders.map((o) => ({
      id: `ord-${String(o._id)}`,
      type: 'order',
      title: `New Pending Order #${o.orderNumber}`,
      subtitle: `${o.customerName} · ৳${o.total.toLocaleString()}`,
      link: `/admin/orders/${String(o._id)}`,
      createdAt: o.createdAt,
    })),
    ...completedCancellationAlerts,
    ...lowStockProducts.map((p) => ({
      id: `stk-${String(p._id)}`,
      type: 'stock',
      title: `Low Stock: ${p.name}`,
      subtitle: `SKU ${p.sku} · ${getProductAvailableStock(p)} available`,
      link: '/admin/inventory',
      createdAt: new Date(),
    })),
    ...pendingReviews.map((r) => ({
      id: `rev-${String(r._id)}`,
      type: 'review',
      title: `Pending Review (${r.rating}/5)`,
      subtitle: `${r.userName} · ${r.title || 'Customer feedback'}`,
      link: `/admin/reviews/${String(r._id)}`,
      createdAt: r.createdAt,
    })),
    ...openEnquiries.map((e) => ({
      id: `sup-${String(e._id)}`,
      type: 'support',
      title: `Open Enquiry: ${e.subject}`,
      subtitle: `From ${e.name}`,
      link: '/admin/support',
      createdAt: e.createdAt,
    })),
  ];

  const visibleItems = items.slice(0, 12);
  return { unreadCount: visibleItems.length, items: visibleItems };
}

export async function getWishlistAnalyticsAdmin(): Promise<Awaited<ReturnType<typeof computeWishlistAnalyticsAdmin>>> {
  const isLiveDb = mongoose.connection.readyState === 1;
  if (isLiveDb) {
    const cached = adminCache.get<Awaited<ReturnType<typeof computeWishlistAnalyticsAdmin>>>('wishlist');
    if (cached) return cached;
    return adminSingleFlight.run('wishlist', async () => {
      const again = adminCache.get<Awaited<ReturnType<typeof computeWishlistAnalyticsAdmin>>>('wishlist');
      if (again) return again;
      const payload = await computeWishlistAnalyticsAdmin();
      adminCache.set('wishlist', payload, 30_000);
      return payload;
    });
  }
  return computeWishlistAnalyticsAdmin();
}

async function computeWishlistAnalyticsAdmin() {

  const [wishlistCountAgg, topWishlistedAgg] = await Promise.all([
    WishlistModel.aggregate([
      {
        $group: {
          _id: null,
          totalWishlists: { $sum: { $cond: [{ $gt: [{ $size: '$productIds' }, 0] }, 1, 0] } },
          totalSavedItems: { $sum: { $size: '$productIds' } },
        },
      },
    ]),
    WishlistModel.aggregate([
      { $unwind: '$productIds' },
      { $group: { _id: '$productIds', wishlistCount: { $sum: 1 } } },
      { $sort: { wishlistCount: -1 } },
      { $limit: 12 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: { $toString: '$_id' },
          wishlistCount: 1,
          name: '$product.name',
          slug: '$product.slug',
          sku: '$product.sku',
          basePrice: '$product.basePrice',
          salePrice: '$product.salePrice',
          stockOnHand: '$product.stockOnHand',
          reservedStock: '$product.reservedStock',
          hasVariants: '$product.hasVariants',
          variants: '$product.variants',
          imageUrl: { $ifNull: [{ $arrayElemAt: ['$product.images.url', 0] }, ''] },
        },
      },
    ]),
  ]);

  const summary = wishlistCountAgg[0] || { totalWishlists: 0, totalSavedItems: 0 };
  const payload = {
    totalActiveWishlists: Number(summary.totalWishlists || 0),
    totalSavedItems: Number(summary.totalSavedItems || 0),
    topWishlistedProducts: topWishlistedAgg.map((item) => ({
      id: String(item.productId),
      name: item.name,
      slug: item.slug,
      sku: item.sku,
      wishlistCount: Number(item.wishlistCount || 0),
      price: item.salePrice ?? item.basePrice,
      availableStock: getProductAvailableStock(item),
      imageUrl: item.imageUrl || '',
    })),
  };
  return payload;
}

export async function getUserAuthenticationStatsAdmin(params?: { days?: number; from?: string; to?: string }) {
  const days = Math.min(365, Math.max(7, Number(params?.days || 30)));
  const dateFilter: Record<string, unknown> = {};
  if (params?.from || params?.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.$gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    dateFilter.createdAt = range;
  }

  const users = await UserModel.find(dateFilter)
    .select('initialAuthProvider authProvider isVerified oauthProviders createdAt +passwordHash')
    .lean();

  return aggregateProviderRegistrationsPure(
    users.map((u) => ({
      initialAuthProvider: u.initialAuthProvider,
      authProvider: u.authProvider,
      isVerified: u.isVerified,
      oauthProviders: u.oauthProviders,
      hasPassword: Boolean((u as { passwordHash?: string }).passwordHash),
      createdAt: u.createdAt,
    })),
    days,
  );
}

export async function getUserRegistrationTrendsAdmin(params?: { days?: number; from?: string; to?: string }) {
  const stats = await getUserAuthenticationStatsAdmin(params);
  return {
    days: Math.min(365, Math.max(7, Number(params?.days || 30))),
    summary: stats.summary,
    dailyTrends: stats.dailyTrends,
  };
}

export async function getUserProviderBreakdownAdmin(params: {
  provider?: string;
  q?: string;
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}) {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(5, Number(params.limit || 20)));
  const filter: Record<string, unknown> = {};

  if (params.provider === 'google') {
    filter.$or = [
      { initialAuthProvider: 'google' },
      { initialAuthProvider: { $exists: false }, authProvider: 'google' },
    ];
  } else if (params.provider === 'facebook') {
    filter.$or = [
      { initialAuthProvider: 'facebook' },
      { initialAuthProvider: { $exists: false }, authProvider: 'facebook' },
    ];
  } else if (params.provider === 'local') {
    filter.$or = [
      { initialAuthProvider: 'local' },
      { initialAuthProvider: { $exists: false }, authProvider: { $in: ['local', null] } },
    ];
  }

  if (params.from || params.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.$gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    filter.createdAt = range;
  }

  if (params.q?.trim()) {
    const regex = new RegExp(params.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const searchClause = [{ name: regex }, { email: regex }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchClause }];
      delete filter.$or;
    } else {
      filter.$or = searchClause;
    }
  }

  const [total, users] = await Promise.all([
    UserModel.countDocuments(filter),
    UserModel.find(filter)
      .select('name email role status isVerified initialAuthProvider authProvider oauthProviders createdAt lastLoginAt +passwordHash')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    users: users.map((u) => {
      const initialProvider = resolveOriginalRegistrationProvider(u);
      const pwHash = (u as { passwordHash?: string }).passwordHash;
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        isVerified: u.isVerified,
        initialAuthProvider: initialProvider,
        linkedProviders: {
          local: initialProvider === 'local' || Boolean(pwHash),
          google: Boolean(u.oauthProviders?.googleId),
          facebook: Boolean(u.oauthProviders?.facebookId),
        },
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getAnalyticsReport(days: number): Promise<Awaited<ReturnType<typeof computeAnalyticsReport>>> {
  const isLiveDb = mongoose.connection.readyState === 1;
  const cacheKey = `report:${days}`;
  if (isLiveDb) {
    const cached = adminCache.get<Awaited<ReturnType<typeof computeAnalyticsReport>>>(cacheKey);
    if (cached) return cached;
    return adminSingleFlight.run(cacheKey, async () => {
      const again = adminCache.get<Awaited<ReturnType<typeof computeAnalyticsReport>>>(cacheKey);
      if (again) return again;
      const reportPayload = await computeAnalyticsReport(days);
      adminCache.set(cacheKey, reportPayload, 30_000);
      return reportPayload;
    });
  }
  return computeAnalyticsReport(days);
}

async function computeAnalyticsReport(days: number) {

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [ordersByPayment, ordersByDivision, topProducts, topCustomers, inventorySummary, dailyRevenue, wishlistSummary, authAnalytics, refundsForReportRaw] = await Promise.all([
    OrderModel.aggregate([
      { $match: { createdAt: { $gte: since }, paymentStatus: { $nin: ['failed', 'cancelled', 'expired'] } } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
    OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          orderStatus: { $nin: ['cancelled', 'returned'] },
          paymentStatus: { $in: ['paid', 'refund_pending', 'partially_refunded', 'refunded'] },
        },
      },
      { $group: { _id: '$shippingAddress.division', count: { $sum: 1 }, total: { $sum: '$total' } } },
      { $sort: { total: -1 } },
    ]),
    OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          orderStatus: { $nin: ['cancelled', 'returned', 'return_requested'] },
          paymentStatus: { $nin: ['failed', 'cancelled', 'expired', 'unpaid', 'initiated', 'pending', 'authorized'] },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.name' },
          sku: { $first: '$items.sku' },
          soldCount: { $sum: '$items.quantity' },
          revenueEstimate: { $sum: '$items.lineTotal' },
          variantIds: { $addToSet: '$items.variantId' },
        },
      },
      { $sort: { soldCount: -1, revenueEstimate: -1 } },
      { $limit: 15 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          sku: 1,
          soldCount: 1,
          revenueEstimate: 1,
          variantIds: 1,
          availableStock: {
            $ifNull: ['$product.stockOnHand', 0],
          },
          ratingAverage: { $ifNull: ['$product.ratingAverage', 0] },
          hasVariants: '$product.hasVariants',
          variants: '$product.variants',
        },
      },
    ]),
    OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          orderStatus: { $nin: ['cancelled', 'returned', 'return_requested'] },
          paymentStatus: { $in: ['paid', 'refund_pending', 'partially_refunded', 'refunded'] },
        },
      },
      { $group: { _id: '$userId', customerName: { $first: '$customerName' }, customerEmail: { $first: '$customerEmail' }, orderCount: { $sum: 1 }, totalSpent: { $sum: '$total' }, lastOrderAt: { $max: '$createdAt' } } },
      { $sort: { totalSpent: -1 } },
      { $limit: 15 },
    ]),
    ProductModel.aggregate([
      { $match: { status: { $ne: 'archived' } } },
      {
        $addFields: {
          _effectiveStock: {
            $cond: [
              { $and: ['$hasVariants', { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] }] },
              {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: { $ifNull: ['$variants', []] },
                        as: 'variant',
                        cond: { $ne: ['$$variant.isActive', false] },
                      },
                    },
                    as: 'variant',
                    in: {
                      $max: [
                        0,
                        {
                          $subtract: [
                            { $ifNull: ['$$variant.stockOnHand', 0] },
                            { $ifNull: ['$$variant.reservedStock', 0] },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
              { $max: [0, { $subtract: ['$stockOnHand', { $ifNull: ['$reservedStock', 0] }] }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalUnits: { $sum: '$_effectiveStock' },
          stockValue: { $sum: { $multiply: ['$_effectiveStock', '$costPrice'] } },
          retailStockValue: { $sum: { $multiply: ['$_effectiveStock', '$basePrice'] } },
          unknownCostProducts: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$_effectiveStock', 0] }, { $lte: ['$costPrice', 0] }] }, 1, 0],
            },
          },
        },
      },
    ]),
    OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          orderStatus: { $nin: ['cancelled', 'returned'] },
          paymentStatus: { $nin: ['failed', 'cancelled', 'expired'] },
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.STORE_TIMEZONE } }, orders: { $sum: 1 }, revenue: { $sum: '$total' }, discount: { $sum: '$discount' } } },
      { $sort: { _id: 1 } },
    ]),
    getWishlistAnalyticsAdmin(),
    getUserAuthenticationStatsAdmin({ days }),
    mongoose.connection.readyState === 1 ? PaymentTransactionModel.find({
      createdAt: { $gte: since },
    }).select('orderId status duplicatePayment reconciliationRequired amount verifiedAmount refundedAmount refunds').lean() : Promise.resolve([]),
  ]);

  const refundByCompletedDate = new Map<string, number>();
  for (const transaction of refundsForReportRaw) {
    if (transaction.duplicatePayment || transaction.reconciliationRequired) continue;
    for (const refund of Array.isArray(transaction.refunds) ? transaction.refunds : []) {
      if (refund.status !== 'completed') continue;
      const completedAt = refund.completedAt ? new Date(refund.completedAt) : null;
      if (!completedAt || Number.isNaN(completedAt.getTime())) continue;
      const key = getReportingDateKey(completedAt, env.STORE_TIMEZONE);
      refundByCompletedDate.set(key, (refundByCompletedDate.get(key) || 0) + money(refund.amount));
    }
  }
  const adjustedDailyRevenue = dailyRevenue.map((row) => ({
    ...row,
    revenue: money(Math.max(0, Number(row.revenue || 0) - (refundByCompletedDate.get(String(row._id)) || 0))),
  }));
  const refundByOrderReport = new Map<string, number>();
  for (const transaction of refundsForReportRaw) {
    if (transaction.duplicatePayment || transaction.reconciliationRequired) continue;
    const orderId = String(transaction.orderId || '');
    if (!orderId) continue;
    refundByOrderReport.set(
      orderId,
      sumCompletedRefunds(transaction),
    );
  }
  const adjustedTopCustomers = topCustomers.map((customer) => ({
    ...customer,
  }));

  const reportPayload = {
    days,
    ordersByPayment,
    ordersByDivision,
    topProducts: topProducts.map((p) => ({
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      soldCount: p.soldCount,
      availableStock: p.hasVariants
        ? (p.variants || [])
            .filter((variant: { isActive?: boolean }) => variant.isActive !== false)
            .reduce(
              (sum: number, variant: { stockOnHand?: number; reservedStock?: number }) =>
                sum + Math.max(0, Number(variant.stockOnHand || 0) - Number(variant.reservedStock || 0)),
              0,
            )
        : Math.max(0, Number(p.availableStock || 0)),
      revenueEstimate: money(p.revenueEstimate),
      ratingAverage: p.ratingAverage,
    })),
    topCustomers,
    inventorySummary,
    dailyRevenue: adjustedDailyRevenue,
    wishlistSummary,
    authAnalytics,
  };
  return reportPayload;
}

export async function exportSalesCsv() {
  const orders = await OrderModel.find().sort({ createdAt: -1 }).limit(1000).lean();
  const transactions = await PaymentTransactionModel.find({
    orderId: { $in: orders.map((order) => order._id) },
  }).select('orderId refundedAmount refunds status duplicatePayment reconciliationRequired').lean();
  const refundByOrder = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.duplicatePayment || transaction.reconciliationRequired) continue;
    refundByOrder.set(
      String(transaction.orderId),
      sumCompletedRefunds(transaction),
    );
  }
  const header = 'orderNumber,date,customerName,customerPhone,division,paymentMethod,paymentStatus,orderStatus,subtotal,discount,shippingCharge,total,successfulRefund,netSales';
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = orders.map((o) => {
    const successfulRefund = refundByOrder.get(String(o._id)) || 0;
    const netSales = calculateFinancialSummary([o], []).netSales - successfulRefund;
    return [
      esc(o.orderNumber),
      esc(new Date(o.createdAt).toISOString()),
      esc(o.customerName),
      esc(o.customerPhone),
      esc(o.shippingAddress?.division || ''),
      esc(o.paymentMethod),
      esc(o.paymentStatus),
      esc(o.orderStatus),
      o.subtotal,
      o.discount,
      o.shippingCharge,
      o.total,
      successfulRefund,
      money(Math.max(0, netSales)),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
