import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../../middleware/error.middleware';
import { ProductModel, type IProductVariant } from '../products/product.model';
import { InventoryMovementModel, type IInventoryMovement } from './inventoryMovement.model';

type StockMutationType = 'adjustment' | 'reserve' | 'release' | 'sale' | 'return';

interface StockMutationParams {
  productId: string | mongoose.Types.ObjectId;
  variantId?: string | mongoose.Types.ObjectId | null;
  type: StockMutationType;
  delta?: number;
  quantity?: number;
  reason: string;
  referenceId?: string;
  actorId?: unknown;
  actorName?: string;
  allowBackorder?: boolean;
  idempotencyKey?: string;
  requirePublished?: boolean;
  requireActiveVariant?: boolean;
  skipFinalReload?: boolean;
}

interface StockMutationResult {
  product: InstanceType<typeof ProductModel>;
  movement: IInventoryMovement;
  alreadyApplied: boolean;
}

function isTransactionUnsupported(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number; message?: string };
  return (
    candidate.code === 20 ||
    candidate.code === 303 ||
    /transaction numbers are only allowed|transactions are not supported/i.test(candidate.message || '')
  );
}

export async function withInventoryTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      throw new AppError(
        503,
        'TRANSACTIONS_UNAVAILABLE',
        'This operation requires MongoDB transactions, but the connected deployment does not support them.',
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export function inventoryMovementIdempotencyObjectId(key: string): mongoose.Types.ObjectId {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hash);
}

export function applyMongoSession<T>(query: T, session: ClientSession): T {
  if (typeof query === 'object' && query !== null && 'session' in query) {
    const candidate = query as { session?: (currentSession: ClientSession) => unknown };
    if (typeof candidate.session === 'function') candidate.session(session);
  }
  return query;
}

function expectedDelta(params: StockMutationParams, quantity: number): number {
  if (params.type === 'adjustment') {
    if (!Number.isInteger(params.delta) || params.delta === 0) {
      throw new AppError(400, 'INVALID_STOCK_ADJUSTMENT', 'Stock adjustment delta must be a non-zero integer.');
    }
    return params.delta!;
  }
  return params.type === 'reserve' || params.type === 'sale' ? -quantity : quantity;
}

function buildFilter(params: StockMutationParams, productId: mongoose.Types.ObjectId, variantId: mongoose.Types.ObjectId | null, quantity: number, delta: number) {
  const filter: Record<string, unknown> = { _id: productId };
  if (params.requirePublished) filter.status = 'published';
  if (variantId) {
    filter.variants = { $elemMatch: { _id: variantId } };
    const conditions: unknown[] = [
      { $eq: [{ $toString: '$$variant._id' }, String(variantId)] },
    ];
    if (params.requireActiveVariant) conditions.push({ $ne: ['$$variant.isActive', false] });

    if (params.type === 'adjustment') {
      conditions.push({
        $gte: [
          { $add: [{ $ifNull: ['$$variant.stockOnHand', 0] }, delta] },
          { $ifNull: ['$$variant.reservedStock', 0] },
        ],
      });
    } else if (params.type === 'reserve' && !params.allowBackorder) {
      conditions.push({
        $gte: [
          { $subtract: ['$$variant.stockOnHand', { $ifNull: ['$$variant.reservedStock', 0] }] },
          quantity,
        ],
      });
    } else if (params.type === 'release') {
      conditions.push({ $gte: ['$$variant.reservedStock', quantity] });
    } else if (params.type === 'sale') {
      conditions.push({ $gte: ['$$variant.reservedStock', quantity] });
      if (!params.allowBackorder) conditions.push({ $gte: ['$$variant.stockOnHand', quantity] });
    }

    filter.$expr = {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ['$variants', []] },
              as: 'variant',
              cond: { $and: conditions },
            },
          },
        },
        0,
      ],
    };
  } else if (params.type === 'adjustment') {
    filter.$expr = {
      $gte: [
        { $add: [{ $ifNull: ['$stockOnHand', 0] }, delta] },
        { $ifNull: ['$reservedStock', 0] },
      ],
    };
  } else if (params.type === 'reserve' && !params.allowBackorder) {
    filter.$expr = {
      $gte: [{ $subtract: ['$stockOnHand', '$reservedStock'] }, quantity],
    };
  } else if (params.type === 'release') {
    filter.reservedStock = { $gte: quantity };
  } else if (params.type === 'sale') {
    filter.reservedStock = { $gte: quantity };
    if (!params.allowBackorder) filter.stockOnHand = { $gte: quantity };
  }
  return filter;
}

function buildUpdate(params: StockMutationParams, variantId: mongoose.Types.ObjectId | null, quantity: number, delta: number) {
  const prefix = variantId ? 'variants.$.' : '';
  const increment: Record<string, number> = {};
  if (params.type === 'adjustment' || params.type === 'return') {
    increment[`${prefix}stockOnHand`] = delta;
  } else if (params.type === 'reserve') {
    increment[`${prefix}reservedStock`] = quantity;
  } else if (params.type === 'release') {
    increment[`${prefix}reservedStock`] = -quantity;
  } else if (params.type === 'sale') {
    increment[`${prefix}stockOnHand`] = -quantity;
    increment[`${prefix}reservedStock`] = -quantity;
    increment.soldCount = quantity;
  }
  return { $inc: increment };
}

export async function applyInventoryMutation(
  session: ClientSession,
  params: StockMutationParams,
): Promise<StockMutationResult> {
  const productId = new mongoose.Types.ObjectId(String(params.productId));
  const variantId = params.variantId ? new mongoose.Types.ObjectId(String(params.variantId)) : null;
  const quantity =
    params.type === 'adjustment'
      ? Math.abs(params.delta || 0)
      : params.type === 'return'
        ? Number(params.delta)
        : Number(params.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError(400, 'INVALID_STOCK_QUANTITY', 'Stock mutation quantity must be a positive integer.');
  }
  const delta = expectedDelta(params, quantity);
  const movementId = params.idempotencyKey
    ? inventoryMovementIdempotencyObjectId(params.idempotencyKey)
    : undefined;

  if (movementId) {
    const existingMovement = await applyMongoSession(InventoryMovementModel.findById(movementId).lean(), session);
    if (existingMovement) {
      const sameOperation =
        String(existingMovement.productId) === String(productId) &&
        String(existingMovement.variantId || '') === String(variantId || '') &&
        existingMovement.type === params.type &&
        existingMovement.delta === delta &&
        existingMovement.reason === params.reason;
      if (!sameOperation) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different stock operation.');
      }
      const product = await applyMongoSession(ProductModel.findById(productId), session);
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      return { product, movement: existingMovement, alreadyApplied: true };
    }
  }

  const before = await ProductModel.findOneAndUpdate(
    buildFilter(params, productId, variantId, quantity, delta),
    buildUpdate(params, variantId, quantity, delta),
    { new: false, session, runValidators: true },
  );
  if (!before) {
    const productExists = await applyMongoSession(ProductModel.exists({ _id: productId }), session);
    if (!productExists) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    if (variantId) {
      const variantExists = await applyMongoSession(ProductModel.exists({ _id: productId, 'variants._id': variantId }), session);
      if (!variantExists) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found.');
    }
    const code = params.type === 'release' || params.type === 'sale' ? 'RESERVATION_NOT_FOUND' : 'INSUFFICIENT_STOCK';
    throw new AppError(409, code, 'The requested stock operation no longer matches the current inventory state.');
  }

  const beforeVariant = variantId
    ? before.variants.find((variant: IProductVariant) => String(variant._id) === String(variantId))
    : null;
  if (variantId && !beforeVariant) {
    throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found.');
  }
  const previousStockOnHand = Number(beforeVariant?.stockOnHand ?? before.stockOnHand ?? 0);
  const previousReserved = Number(beforeVariant?.reservedStock ?? before.reservedStock ?? 0);
  const newStockOnHand =
    params.type === 'adjustment' || params.type === 'return'
      ? previousStockOnHand + delta
      : params.type === 'sale'
        ? previousStockOnHand - quantity
        : previousStockOnHand;
  const newReserved =
    params.type === 'reserve'
      ? previousReserved + quantity
      : params.type === 'release' || params.type === 'sale'
        ? previousReserved - quantity
        : previousReserved;
  const movement = new InventoryMovementModel({
    ...(movementId ? { _id: movementId } : {}),
    productId,
    variantId,
    sku: beforeVariant?.sku || before.sku,
    productName: beforeVariant ? `${before.name} (${beforeVariant.title})` : before.name,
    type: params.type,
    delta,
    previousStockOnHand,
    newStockOnHand,
    previousReserved,
    newReserved,
    reason: params.reason,
    referenceId: params.referenceId,
    actorId: params.actorId || null,
    actorName: params.actorName,
  });
  await movement.save({ session });

  if (params.skipFinalReload) {
    return { product: before, movement, alreadyApplied: false };
  }

  const product = await applyMongoSession(ProductModel.findById(productId), session);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  return { product, movement, alreadyApplied: false };
}
