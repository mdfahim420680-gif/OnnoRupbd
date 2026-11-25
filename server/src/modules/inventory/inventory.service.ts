import { ProductModel } from '../products/product.model';
import { InventoryMovementModel } from './inventoryMovement.model';
import { AppError } from '../../middleware/error.middleware';
import { applyInventoryMutation, withInventoryTransaction } from './inventoryTransaction';
import { invalidateAdminInventoryCaches, invalidatePublicCatalogCaches } from '../../utils/ttlCache';

function computeInventorySummary(p: {
  hasVariants?: boolean;
  variants?: Array<{ isActive?: boolean; stockOnHand?: number; reservedStock?: number; lowStockThreshold?: number }>;
  stockOnHand?: number;
  reservedStock?: number;
  lowStockThreshold?: number;
  manageInventory?: boolean;
}) {
  if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
    const activeVariants = p.variants.filter((v) => v.isActive !== false);
    const pool = activeVariants.length > 0 ? activeVariants : p.variants;
    const stockOnHand = pool.reduce((sum, v) => sum + Number(v.stockOnHand || 0), 0);
    const reservedStock = pool.reduce((sum, v) => sum + Number(v.reservedStock || 0), 0);
    const availableStock = pool.reduce(
      (sum, v) => sum + Math.max(0, Number(v.stockOnHand || 0) - Number(v.reservedStock || 0)),
      0,
    );
    const fallbackThreshold = Number(p.lowStockThreshold ?? 5);
    const hasLowVariant = pool.some(
      (v) => Math.max(0, Number(v.stockOnHand || 0) - Number(v.reservedStock || 0)) <= Number(v.lowStockThreshold ?? fallbackThreshold),
    );
    return { stockOnHand, reservedStock, availableStock, hasLowVariant };
  }
  const stockOnHand = Number(p.stockOnHand || 0);
  const reservedStock = Number(p.reservedStock || 0);
  const availableStock = Math.max(0, stockOnHand - reservedStock);
  return {
    stockOnHand,
    reservedStock,
    availableStock,
    hasLowVariant: availableStock <= Number(p.lowStockThreshold ?? 5),
  };
}

export async function listStockLevels(params: { q?: string; stockFilter?: string; page: number; limit: number }) {
  const { q, stockFilter, page, limit } = params;
  const filter: Record<string, unknown> = { status: { $ne: 'archived' } };
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: regex }, { sku: regex }, { brandName: regex }];
  }
  if (stockFilter === 'out' || stockFilter === 'low') {
    filter.manageInventory = { $ne: false };
    const products = await ProductModel.find(filter)
      .populate('categoryId', 'name slug')
      .select('name sku stockOnHand reservedStock lowStockThreshold manageInventory status hasVariants variants images basePrice salePrice categoryId')
      .sort({ stockOnHand: 1, updatedAt: -1 })
      .lean();

    const mapped = products
      .map((p) => {
        const stats = computeInventorySummary(p);
        return {
          ...p,
          id: String(p._id),
          stockOnHand: stats.stockOnHand,
          reservedStock: stats.reservedStock,
          availableStock: stats.availableStock,
          _hasLowVariant: stats.hasLowVariant,
        };
      })
      .filter((item) => {
        if (stockFilter === 'out') return item.availableStock <= 0;
        const threshold = item.lowStockThreshold ?? 5;
        return item.availableStock <= threshold || item._hasLowVariant;
      })
      .sort((a, b) => a.availableStock - b.availableStock);

    const total = mapped.length;
    const paged = mapped.slice((page - 1) * limit, page * limit).map(({ _hasLowVariant, ...rest }) => {
      void _hasLowVariant;
      return rest;
    });
    return {
      items: paged,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  const [total, products] = await Promise.all([
    ProductModel.countDocuments(filter),
    ProductModel.find(filter)
      .populate('categoryId', 'name slug')
      .select('name sku stockOnHand reservedStock lowStockThreshold manageInventory status hasVariants variants images basePrice salePrice categoryId')
      .sort({ stockOnHand: 1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    items: products.map((p) => {
      const stats = computeInventorySummary(p);
      return {
        ...p,
        id: String(p._id),
        stockOnHand: stats.stockOnHand,
        reservedStock: stats.reservedStock,
        availableStock: stats.availableStock,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function listInventoryMovements(limit = 50, productId?: string) {
  const filter: Record<string, unknown> = {};
  if (productId) filter.productId = productId;
  const movements = await InventoryMovementModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return movements.map((m) => ({ ...m, id: String(m._id) }));
}

export async function adjustInventoryStock(params: {
  productId: string;
  variantId?: string | null;
  delta: number;
  reason: string;
  actorId: unknown;
  actorName: string;
  idempotencyKey?: string;
}) {
  const result = await withInventoryTransaction((session) =>
    applyInventoryMutation(session, {
      productId: params.productId,
      variantId: params.variantId,
      type: 'adjustment',
      delta: params.delta,
      reason: params.reason,
      actorId: params.actorId,
      actorName: params.actorName,
      idempotencyKey: params.idempotencyKey,
    }),
  );
  invalidateAdminInventoryCaches();
  invalidatePublicCatalogCaches();
  return { ...result.product.toObject(), id: String(result.product._id) };
}
