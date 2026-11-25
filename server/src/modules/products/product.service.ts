import mongoose, { type ClientSession } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { ProductModel, type IProductVariant } from './product.model';
import { CategoryModel, BrandModel } from '../categories/category.model';
import { AttributeGroupModel, ProductAttributePresetModel } from '../cms/cms.model';
import { InventoryMovementModel } from '../inventory/inventoryMovement.model';
import { applyInventoryMutation, applyMongoSession, withInventoryTransaction } from '../inventory/inventoryTransaction';
import { OrderModel } from '../orders/order.model';
import { AppError } from '../../middleware/error.middleware';
import { assertValidObjectId, escapeCsvCell } from '../../middleware/security.middleware';
import {
  adminCache,
  invalidateAdminAttributeCaches,
  invalidateAdminProductCaches,
  invalidatePublicCatalogCaches,
} from '../../utils/ttlCache';
import { buildCategoryAncestryPath, enrichProductPricing } from './productCatalogHelpers';
import {
  normalizeAttributeOptions,
  resolveAttributesForCategories,
  slugifyAttributeCode,
  syncLegacyAttributesMap,
  validateAttributeValue,
  type ProductAttributeDefinition,
} from '../../../../src/lib/productAttributes';
import { inferColorHex } from '../../../../src/lib/variantEngine';
import type { z } from 'zod';
import type {
  answerQuestionSchema,
  attributeGroupSchema,
  attributePresetSchema,
  bulkActionSchema,
  bulkImportSchema,
} from './product.validation';
import { bulkImportRowSchema, productSchema } from './product.validation';

function mapAttributeDoc(doc: Record<string, unknown>, usageCount = 0): ProductAttributeDefinition & {
  id: string;
  _id?: string;
  usageCount: number;
} {
  const options = normalizeAttributeOptions(
    Array.isArray(doc.options) ? (doc.options as Array<Record<string, unknown>>) : [],
    Array.isArray(doc.values) ? (doc.values as string[]) : [],
  );
  return {
    id: String(doc._id),
    _id: String(doc._id),
    name: String(doc.name || ''),
    code: String(doc.code || ''),
    description: doc.description ? String(doc.description) : '',
    group: String(doc.group || 'general'),
    groupId: doc.groupId ? String(doc.groupId) : null,
    groupName: doc.groupName ? String(doc.groupName) : undefined,
    inputType: (doc.inputType as ProductAttributeDefinition['inputType']) || 'single_select',
    unit: doc.unit ? String(doc.unit) : '',
    scope: (doc.scope as ProductAttributeDefinition['scope']) || 'global',
    categoryIds: Array.isArray(doc.categoryIds) ? doc.categoryIds.map(String) : [],
    productIds: Array.isArray(doc.productIds) ? doc.productIds.map(String) : [],
    values: options.map((o) => o.label),
    options,
    defaultValue: doc.defaultValue ?? null,
    validationRules: (doc.validationRules as ProductAttributeDefinition['validationRules']) || {},
    sortOrder: Number(doc.sortOrder || 0),
    isRequired: Boolean(doc.isRequired),
    isVisibleToCustomers: doc.isVisibleToCustomers !== false,
    showOnProductDetails: doc.showOnProductDetails !== false,
    isFilterable: Boolean(doc.isFilterable),
    isSearchable: doc.isSearchable !== false,
    isComparable: Boolean(doc.isComparable),
    isActive: doc.isActive !== false,
    usageCount,
  };
}

function withSession<T>(query: T, session?: ClientSession): T {
  return session ? applyMongoSession(query, session) : query;
}

function normalizedSkuKeys(sku: string, variants: Array<{ sku: string }>): string[] {
  return Array.from(new Set([sku, ...variants.map((variant) => variant.sku)].map((value) => value.trim().toUpperCase())));
}

export async function listProductsAdmin(params: {
  page: number;
  limit: number;
  q: string;
  status: string;
  categoryId: string;
}) {
  const { page, limit, q, status, categoryId } = params;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (categoryId) {
    assertValidObjectId(categoryId, 'category');
    filter.$or = [{ categoryId }, { subCategoryId: categoryId }];
  }
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const searchCond = [{ name: regex }, { sku: regex }, { brandName: regex }, { slug: regex }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or as unknown[] }, { $or: searchCond }];
      delete filter.$or;
    } else {
      filter.$or = searchCond;
    }
  }

  const [total, products] = await Promise.all([
    ProductModel.countDocuments(filter),
    ProductModel.find(filter)
      .select('name nameBn slug sku brandName brandId categoryId subCategoryId images basePrice salePrice flashSalePrice flashSaleStartsAt flashSaleEndsAt hasVariants variants stockOnHand reservedStock lowStockThreshold manageInventory allowBackorder status soldCount ratingAverage reviewCount createdAt updatedAt')
      .populate('categoryId', 'name slug')
      .populate('subCategoryId', 'name slug')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    products: products.map((p) => enrichProductPricing(p as unknown as Record<string, unknown>)),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getProductByIdAdmin(id: string) {
  const validId = assertValidObjectId(id, 'product');
  const product = await ProductModel.findById(validId)
    .populate('categoryId', 'name nameBn slug')
    .populate('subCategoryId', 'name nameBn slug')
    .populate('brandId', 'name slug logoUrl')
    .lean();
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

  const recentMovements = await InventoryMovementModel.find({ productId: product._id })
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  return {
    product: enrichProductPricing(product as unknown as Record<string, unknown>),
    movements: recentMovements.map((m) => ({ ...m, id: String(m._id) })),
  };
}

async function normalizeAndValidateProductPayload(
  parsed: z.infer<typeof productSchema>,
  existingProductId?: string,
  session?: ClientSession,
) {
  const allCategories = await withSession(CategoryModel.find(), session).lean();
  const category = allCategories.find((c) => String(c._id) === parsed.categoryId);
  if (!category) throw new AppError(400, 'INVALID_CATEGORY', 'Selected category does not exist.');

  if (parsed.subCategoryId) {
    const subCat = allCategories.find((c) => String(c._id) === parsed.subCategoryId);
    if (!subCat) throw new AppError(400, 'INVALID_SUBCATEGORY', 'Selected subcategory does not exist.');
    if (String(subCat.parentId || '') !== String(category._id)) {
      throw new AppError(400, 'CATEGORY_SUBCATEGORY_MISMATCH', 'The selected subcategory does not belong to the selected category.');
    }
  }

  let brandName = parsed.brandName || '';
  if (parsed.brandId) {
    if (!mongoose.Types.ObjectId.isValid(parsed.brandId)) {
      throw new AppError(400, 'INVALID_BRAND', 'Selected brand does not exist.');
    }
    const brand = await withSession(BrandModel.findById(parsed.brandId), session).lean();
    if (!brand) throw new AppError(400, 'INVALID_BRAND', 'Selected brand does not exist.');
    brandName = brand.name;
  }

  const categoryPath = buildCategoryAncestryPath({
    categoryId: String(category._id),
    subCategoryId: parsed.subCategoryId || null,
    allCategories,
  });

  const sanitizedVariants = parsed.hasVariants ? parsed.variants : [];
  const skuKeys = normalizedSkuKeys(parsed.sku, sanitizedVariants);
  const duplicateFilter: Record<string, unknown> = {
    $or: [{ sku: { $in: skuKeys } }, { 'variants.sku': { $in: skuKeys } }, { skuKeys: { $in: skuKeys } }],
  };
  if (existingProductId) duplicateFilter._id = { $ne: existingProductId };
  const conflictProduct = await withSession(
    ProductModel.findOne(duplicateFilter).select('_id name sku skuKeys variants.sku'),
    session,
  ).lean();
  if (conflictProduct) {
    const existingSkus = [
      conflictProduct.sku,
      ...(conflictProduct.skuKeys || []),
      ...(conflictProduct.variants || []).map((variant: { sku: string }) => variant.sku),
    ];
    const matchedSku = skuKeys.find((sku) => existingSkus.includes(sku)) || skuKeys[0];
    throw new AppError(
      409,
      'DUPLICATE_SKU',
      `SKU "${matchedSku}" is already used by product "${conflictProduct.name}".`,
    );
  }

  const slugFilter: Record<string, unknown> = { slug: parsed.slug };
  if (existingProductId) slugFilter._id = { $ne: existingProductId };
  const slugConflict = await withSession(ProductModel.findOne(slugFilter).select('_id name'), session).lean();
  if (slugConflict) {
    throw new AppError(409, 'DUPLICATE_SLUG', `Product URL "${parsed.slug}" is already used by "${slugConflict.name}".`);
  }

  // Validate against applicable active category/global attribute definitions
  const rawPresets = await withSession(ProductAttributePresetModel.find({ isActive: true }), session).lean();
  const mappedPresets = rawPresets.map((d) => mapAttributeDoc(d as unknown as Record<string, unknown>));
  const applicableAttributes = resolveAttributesForCategories(
    mappedPresets,
    parsed.categoryId,
    parsed.subCategoryId || null,
    existingProductId || null,
  );
  const presetByCode = new Map(mappedPresets.map((p) => [p.code.toLowerCase(), p]));

  const normalizedAttributeValues = (parsed.attributeValues || []).map((entry) => {
    const def = entry.attributeId
      ? mappedPresets.find((p) => p.id === entry.attributeId)
      : presetByCode.get(entry.code.toLowerCase());
    const resolvedType = (entry.inputType as ProductAttributeDefinition['inputType']) || def?.inputType || 'short_text';
    let resolvedColorHex = entry.colorHex || '';
    if (!resolvedColorHex && resolvedType === 'color') {
      const valStr = String(entry.value ?? '').trim();
      const matchedOpt = (def?.options || []).find(
        (o) =>
          o.label.toLowerCase() === valStr.toLowerCase() ||
          o.value.toLowerCase() === valStr.toLowerCase(),
      );
      resolvedColorHex = matchedOpt?.colorHex || inferColorHex(valStr) || '';
    }
    return {
      attributeId: entry.attributeId || def?.id || null,
      code: slugifyAttributeCode(entry.code),
      name: entry.name || def?.name || entry.code,
      groupName: entry.groupName || def?.groupName || def?.group || 'General',
      inputType: resolvedType,
      value: entry.value ?? '',
      unit: entry.unit || def?.unit || '',
      colorHex: resolvedColorHex,
      sortOrder: entry.sortOrder ?? def?.sortOrder ?? 0,
      isVisibleToCustomers:
        entry.isVisibleToCustomers !== undefined
          ? entry.isVisibleToCustomers
          : def?.isVisibleToCustomers !== false,
      showOnProductDetails:
        entry.showOnProductDetails !== undefined
          ? entry.showOnProductDetails
          : def?.showOnProductDetails !== false,
      isFilterable: entry.isFilterable ?? def?.isFilterable ?? false,
      isSearchable: entry.isSearchable ?? def?.isSearchable ?? false,
      isComparable: entry.isComparable ?? def?.isComparable ?? false,
    };
  });

  // Validate values + enforce required fields when publishing
  const entryMap = new Map(normalizedAttributeValues.map((e) => [e.code.toLowerCase(), e]));
  for (const def of applicableAttributes) {
    const submitted = entryMap.get(def.code.toLowerCase());
    const val = submitted ? submitted.value : undefined;
    if (def.isRequired && parsed.status === 'published') {
      const check = validateAttributeValue(def, val);
      if (!check.valid) {
        throw new AppError(400, 'ATTRIBUTE_VALIDATION_ERROR', check.error || `${def.name} is required.`);
      }
    } else if (submitted && val !== undefined && val !== '' && val !== null) {
      const check = validateAttributeValue({ ...def, isRequired: false }, val);
      if (!check.valid) {
        throw new AppError(400, 'ATTRIBUTE_VALIDATION_ERROR', check.error || `Invalid value for ${def.name}.`);
      }
    }
  }

  const mergedLegacyAttributes = syncLegacyAttributesMap(
    normalizedAttributeValues,
    parsed.attributes || {},
  );

  return {
    ...parsed,
    brandId: parsed.brandId || null,
    subCategoryId: parsed.subCategoryId || null,
    brandName,
    categoryPath,
    variants: sanitizedVariants,
    skuKeys,
    attributeValues: normalizedAttributeValues,
    attributes: mergedLegacyAttributes,
  };
}

type InventoryActor = { actorId?: unknown; actorName?: string };

async function createProductInTransaction(
  parsed: z.infer<typeof productSchema>,
  session: ClientSession,
  actor: InventoryActor = {},
): Promise<string> {
  const payload = await normalizeAndValidateProductPayload(parsed, undefined, session);
  const openingBaseStock = payload.stockOnHand;
  const openingVariantStocks = payload.variants.map((variant) => variant.stockOnHand || 0);
  payload.stockOnHand = 0;
  payload.variants = payload.variants.map((variant) => ({
    ...variant,
    stockOnHand: 0,
    reservedStock: 0,
  }));
  const created = new ProductModel(payload);
  await created.save({ session });

  if (openingBaseStock > 0) {
    await applyInventoryMutation(session, {
      productId: created._id,
      type: 'adjustment',
      delta: openingBaseStock,
      reason: 'Opening stock on product creation',
      referenceId: String(created._id),
      actorId: actor.actorId,
      actorName: actor.actorName,
    });
  }
  for (let index = 0; index < openingVariantStocks.length; index += 1) {
    const openingStock = openingVariantStocks[index];
    const variant = created.variants[index];
    if (openingStock > 0 && variant) {
      await applyInventoryMutation(session, {
        productId: created._id,
        variantId: variant._id,
        type: 'adjustment',
        delta: openingStock,
        reason: 'Opening stock on product creation',
        referenceId: String(created._id),
        actorId: actor.actorId,
        actorName: actor.actorName,
      });
    }
  }
  return String(created._id);
}

export async function createProductAdmin(parsed: z.infer<typeof productSchema>, actor: InventoryActor = {}) {
  const productId = await withInventoryTransaction((session) =>
    createProductInTransaction(parsed, session, actor),
  );
  invalidatePublicCatalogCaches();
  invalidateAdminProductCaches();
  const populated = await ProductModel.findById(productId)
    .populate('categoryId', 'name nameBn slug')
    .populate('subCategoryId', 'name nameBn slug')
    .populate('brandId', 'name slug logoUrl')
    .lean();

  return enrichProductPricing(
    populated as unknown as Record<string, unknown>,
  );
}

export async function updateProductAdmin(
  id: string,
  parsed: z.infer<typeof productSchema>,
  actor: InventoryActor = {},
) {
  const validId = assertValidObjectId(id, 'product');
  const { priceChanged, sku, name } = await withInventoryTransaction(async (session) => {
    const existing = (await applyMongoSession(ProductModel.findById(validId), session)) as InstanceType<
      typeof ProductModel
    > | null;
    if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

    const payload = await normalizeAndValidateProductPayload(parsed, validId, session);
    const priceChanged = existing.basePrice !== parsed.basePrice || existing.salePrice !== parsed.salePrice;
    const oldBaseStock = existing.stockOnHand;
    const oldVariants = new Map<string, { stockOnHand: number; reservedStock: number }>();
    existing.variants.forEach((variant: IProductVariant) => {
      oldVariants.set(String(variant._id), {
        stockOnHand: variant.stockOnHand,
        reservedStock: variant.reservedStock,
      });
    });
    const desiredBaseStock = payload.stockOnHand;
    if (desiredBaseStock < existing.reservedStock) {
      throw new AppError(409, 'STOCK_BELOW_RESERVED', 'On-hand stock cannot be lower than reserved stock.');
    }

    const desiredVariantStocks = payload.variants.map((variant) => variant.stockOnHand || 0);
    const seenVariantIds = new Set<string>();
    payload.variants = payload.variants.map((variant, index) => {
      if (!variant._id) return { ...variant, stockOnHand: 0, reservedStock: 0 };
      if (!mongoose.Types.ObjectId.isValid(variant._id)) {
        throw new AppError(400, 'INVALID_VARIANT_ID', 'A submitted variant identifier is invalid.');
      }
      const variantId = String(variant._id);
      const existingStock = oldVariants.get(variantId);
      if (!existingStock || seenVariantIds.has(variantId)) {
        throw new AppError(400, 'INVALID_VARIANT_ID', 'A submitted variant does not belong to this product.');
      }
      seenVariantIds.add(variantId);
      if (desiredVariantStocks[index] < existingStock.reservedStock) {
        throw new AppError(409, 'STOCK_BELOW_RESERVED', `Variant ${variant.sku} stock cannot be lower than reserved stock.`);
      }
      return {
        ...variant,
        stockOnHand: existingStock.stockOnHand,
        reservedStock: existingStock.reservedStock,
      };
    });

    const removedVariants = existing.variants.filter(
      (variant: IProductVariant) => !seenVariantIds.has(String(variant._id)),
    );
    if (removedVariants.length > 0) {
      const removedIds = removedVariants.map((variant: IProductVariant) => variant._id);
      const [orderReferences, movementReferences] = await Promise.all([
        OrderModel.countDocuments({
          items: { $elemMatch: { productId: existing._id, variantId: { $in: removedIds } } },
        }).session(session),
        InventoryMovementModel.countDocuments({
          productId: existing._id,
          variantId: { $in: removedIds },
        }).session(session),
      ]);
      if (orderReferences > 0 || movementReferences > 0) {
        throw new AppError(
          409,
          'VARIANT_HAS_HISTORY',
          'A variant referenced by an order or inventory movement cannot be removed.',
        );
      }
      if (removedVariants.some((variant: IProductVariant) => variant.stockOnHand > 0 || variant.reservedStock > 0)) {
        throw new AppError(409, 'VARIANT_HAS_STOCK', 'A variant with on-hand or reserved stock cannot be removed.');
      }
    }

    Object.assign(existing, {
      ...payload,
      stockOnHand: oldBaseStock,
    });
    await existing.save({ session });

    const baseDelta = desiredBaseStock - oldBaseStock;
    if (baseDelta !== 0) {
      await applyInventoryMutation(session, {
        productId: existing._id,
        type: 'adjustment',
        delta: baseDelta,
        reason: 'Stock changed in product edit',
        referenceId: String(existing._id),
        actorId: actor.actorId,
        actorName: actor.actorName,
      });
    }
    for (let index = 0; index < desiredVariantStocks.length; index += 1) {
      const variant = existing.variants[index];
      if (!variant) continue;
      const previousStock = oldVariants.get(String(variant._id))?.stockOnHand || 0;
      const delta = desiredVariantStocks[index] - previousStock;
      if (delta !== 0) {
        await applyInventoryMutation(session, {
          productId: existing._id,
          variantId: variant._id,
          type: 'adjustment',
          delta,
          reason: 'Stock changed in product edit',
          referenceId: String(existing._id),
          actorId: actor.actorId,
          actorName: actor.actorName,
        });
      }
    }
    return { priceChanged, sku: existing.sku, name: existing.name };
  });
  invalidatePublicCatalogCaches();
  invalidateAdminProductCaches();

  const updated = await ProductModel.findById(validId);
  if (!updated) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const populated = await ProductModel.findById(validId)
    .populate('categoryId', 'name nameBn slug')
    .populate('subCategoryId', 'name nameBn slug')
    .populate('brandId', 'name slug logoUrl')
    .lean();

  return {
    product: enrichProductPricing(
      populated as unknown as Record<string, unknown>,
    ),
    priceChanged,
    sku,
    name,
    id: String(updated._id),
  };
}

export async function updateProductStatusAdmin(id: string, status: 'draft' | 'published' | 'archived') {
  const validId = assertValidObjectId(id, 'product');
  const product = await ProductModel.findById(validId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

  if (status === 'published') {
    const rawPresets = await ProductAttributePresetModel.find({ isActive: true, isRequired: true }).lean();
    const mappedRequired = rawPresets.map((d) => mapAttributeDoc(d as unknown as Record<string, unknown>));
    const applicableRequired = resolveAttributesForCategories(
      mappedRequired,
      product.categoryId ? String(product.categoryId) : '',
      product.subCategoryId ? String(product.subCategoryId) : null,
      String(product._id),
    );
    const entryMap = new Map(
      (product.attributeValues || []).map((e: { code?: string; value?: unknown }) => [
        String(e.code || '').toLowerCase(),
        e.value,
      ]),
    );
    for (const def of applicableRequired) {
      const check = validateAttributeValue(def, entryMap.get(def.code.toLowerCase()));
      if (!check.valid) {
        throw new AppError(400, 'ATTRIBUTE_VALIDATION_ERROR', check.error || `${def.name} is required.`);
      }
    }
  }

  const prevStatus = product.status;
  product.status = status;
  await product.save();
  invalidatePublicCatalogCaches();
  invalidateAdminProductCaches();

  return {
    product: enrichProductPricing(product.toObject({ flattenMaps: true }) as unknown as Record<string, unknown>),
    prevStatus,
    sku: product.sku,
    name: product.name,
    id: String(product._id),
  };
}

export async function deleteProductAdmin(id: string, permanent: boolean) {
  const validId = assertValidObjectId(id, 'product');
  const product = await ProductModel.findById(validId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

  if (permanent) {
    const referencedOrders = await OrderModel.countDocuments({ 'items.productId': product._id });
    if (referencedOrders > 0) {
      throw new AppError(
        409,
        'PRODUCT_HAS_ORDERS',
        `Cannot permanently delete product linked to ${referencedOrders} historical orders. Archive it instead.`,
      );
    }
    const [referencedMovements, hasStock] = await Promise.all([
      InventoryMovementModel.countDocuments({ productId: product._id }),
      ProductModel.exists({
        _id: product._id,
        $or: [
          { stockOnHand: { $gt: 0 } },
          { reservedStock: { $gt: 0 } },
          { 'variants.stockOnHand': { $gt: 0 } },
          { 'variants.reservedStock': { $gt: 0 } },
        ],
      }),
    ]);
    if (referencedMovements > 0 || hasStock) {
      throw new AppError(
        409,
        referencedMovements > 0 ? 'PRODUCT_HAS_INVENTORY_HISTORY' : 'PRODUCT_HAS_STOCK',
        referencedMovements > 0
          ? 'Cannot permanently delete a product with inventory movement history. Archive it instead.'
          : 'Cannot permanently delete a product with on-hand or reserved stock. Adjust inventory first.',
      );
    }
    const summary = { id: String(product._id), name: product.name, sku: product.sku };
    await product.deleteOne();
    invalidatePublicCatalogCaches();
    invalidateAdminProductCaches();
    return { deleted: true, archived: false, ...summary };
  }

  product.status = 'archived';
  await product.save();
  invalidatePublicCatalogCaches();
  invalidateAdminProductCaches();
  return { deleted: false, archived: true, id: String(product._id), name: product.name, sku: product.sku };
}

export async function duplicateProductAdmin(id: string, actor: InventoryActor = {}) {
  const sourceProduct = await ProductModel.findById(id);
  if (!sourceProduct) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const src = sourceProduct.toObject({ flattenMaps: true });

  const suffix = randomBytes(4).toString('hex').toUpperCase();
  const source = src as unknown as Record<string, unknown>;
  const sourceVariants: Array<Record<string, unknown>> = Array.isArray(src.variants)
    ? (src.variants as unknown as Array<Record<string, unknown>>)
    : [];
  const sourceAttributeValues: Array<Record<string, unknown>> = Array.isArray(src.attributeValues)
    ? (src.attributeValues as unknown as Array<Record<string, unknown>>)
    : [];
  const parsed = productSchema.parse({
    ...source,
    categoryId: String(src.categoryId),
    subCategoryId: src.subCategoryId ? String(src.subCategoryId) : null,
    brandId: src.brandId ? String(src.brandId) : null,
    name: `${src.name} (Copy)`,
    slug: `${src.slug.slice(0, 180)}-copy-${suffix.toLowerCase()}`,
    sku: `${src.sku.slice(0, 48)}-${suffix}`,
    status: 'draft',
    stockOnHand: 0,
    variants: sourceVariants.map((variant, index) => {
      const sourceVariant = variant as Record<string, unknown>;
      return {
        ...sourceVariant,
        _id: undefined,
        sku: `${String(sourceVariant.sku || '').slice(0, 48)}-${suffix}-${index + 1}`,
        stockOnHand: 0,
      };
    }),
    flashSaleStartsAt: src.flashSaleStartsAt ? new Date(src.flashSaleStartsAt).toISOString() : null,
    flashSaleEndsAt: src.flashSaleEndsAt ? new Date(src.flashSaleEndsAt).toISOString() : null,
    attributeValues: sourceAttributeValues.map((entry) => ({
      ...entry,
      attributeId: entry.attributeId ? String(entry.attributeId) : null,
    })),
  });
  const duplicated = (await createProductAdmin(parsed, actor)) as unknown as Record<string, unknown>;

  return {
    product: duplicated,
    sourceName: src.name,
    sku: String(duplicated.sku),
    id: String(duplicated.id || duplicated._id),
  };
}

export async function exportProductsCsv() {
  const products = await ProductModel.find({ status: { $ne: 'archived' } }).populate('categoryId', 'slug').lean();
  const header = 'sku,name,slug,categorySlug,brandName,basePrice,salePrice,stockOnHand,status,description';
  const rows = products.map((p) =>
    [
      escapeCsvCell(p.sku),
      escapeCsvCell(p.name),
      escapeCsvCell(p.slug),
      escapeCsvCell((p.categoryId as unknown as { slug?: string })?.slug || 'general'),
      escapeCsvCell(p.brandName || ''),
      p.basePrice,
      p.salePrice ?? '',
      p.stockOnHand,
      p.status,
      escapeCsvCell(p.description),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

export async function bulkImportProductsAdmin(
  input: z.infer<typeof bulkImportSchema>,
  actor: InventoryActor = {},
) {
  const categories = await CategoryModel.find().lean();
  const catSlugMap = new Map(categories.map((category) => [category.slug.toLowerCase(), category]));
  const brands = await BrandModel.find().lean();
  const brandNameMap = new Map(brands.map((brand) => [brand.name.trim().toLowerCase(), brand]));

  const errors: Array<{ row: number; sku: string; error: string }> = [];
  const seenSkus = new Set<string>();
  const seenSlugs = new Set<string>();
  let insertedCount = 0;

  for (let index = 0; index < input.rows.length; index += 1) {
    const rawRow = input.rows[index];
    const sourceRow =
      typeof rawRow === 'object' && rawRow !== null && 'sourceRow' in rawRow &&
      Number.isInteger((rawRow as { sourceRow?: unknown }).sourceRow)
        ? Number((rawRow as { sourceRow: number }).sourceRow)
        : index + 1;
    const rawSku =
      typeof rawRow === 'object' && rawRow !== null && 'sku' in rawRow
        ? String((rawRow as { sku?: unknown }).sku || '')
        : '';
    const parsedRow = bulkImportRowSchema.safeParse(rawRow);
    if (!parsedRow.success) {
      errors.push({
        row: sourceRow,
        sku: rawSku,
        error: parsedRow.error.issues[0]?.message || 'Invalid product row.',
      });
      continue;
    }

    const row = parsedRow.data;
    const rowNumber = row.sourceRow || sourceRow;
    if (seenSkus.has(row.sku)) {
      errors.push({ row: rowNumber, sku: row.sku, error: 'Duplicate SKU inside CSV file.' });
      continue;
    }
    seenSkus.add(row.sku);
    if (seenSlugs.has(row.slug)) {
      errors.push({ row: rowNumber, sku: row.sku, error: 'Duplicate product URL inside CSV file.' });
      continue;
    }
    seenSlugs.add(row.slug);

    const cat = catSlugMap.get(row.categorySlug.toLowerCase());
    if (!cat) {
      errors.push({ row: rowNumber, sku: row.sku, error: `Category slug "${row.categorySlug}" not found.` });
      continue;
    }

    const brandName = row.brandName?.trim() || '';
    const brand = brandName ? brandNameMap.get(brandName.toLowerCase()) : undefined;
    if (brandName && !brand) {
      errors.push({ row: rowNumber, sku: row.sku, error: `Brand "${brandName}" not found.` });
      continue;
    }

    const parsedProduct = productSchema.safeParse({
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      categoryId: String(cat._id),
      brandId: brand ? String(brand._id) : null,
      brandName: brand?.name || '',
      basePrice: row.basePrice,
      salePrice: row.salePrice ?? null,
      stockOnHand: row.stockOnHand,
      status: row.status,
      description: row.description,
    });
    if (!parsedProduct.success) {
      errors.push({
        row: rowNumber,
        sku: row.sku,
        error: parsedProduct.error.issues[0]?.message || 'Invalid product row.',
      });
      continue;
    }

    try {
      await withInventoryTransaction((session) =>
        createProductInTransaction(parsedProduct.data, session, actor),
      );
      insertedCount += 1;
    } catch (error) {
      if (error instanceof AppError && error.statusCode >= 500) throw error;
      if (error instanceof AppError) {
        errors.push({ row: rowNumber, sku: row.sku, error: error.message });
        continue;
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        errors.push({
          row: rowNumber,
          sku: row.sku,
          error: 'Product SKU or URL conflicts with an existing catalog record.',
        });
        continue;
      }
      throw error;
    }
  }

  if (insertedCount > 0) {
    invalidatePublicCatalogCaches();
    invalidateAdminProductCaches();
  }
  return { importedCount: insertedCount, errors };
}

export async function bulkProductActionAdmin(parsed: z.infer<typeof bulkActionSchema>) {
  let modifiedCount = 0;
  if (parsed.action === 'delete') {
    const [linked, movementProductIds, products] = await Promise.all([
      OrderModel.distinct('items.productId', { 'items.productId': { $in: parsed.ids } }),
      InventoryMovementModel.distinct('productId', { productId: { $in: parsed.ids } }),
      ProductModel.find({ _id: { $in: parsed.ids } }).select('_id stockOnHand reservedStock variants').lean(),
    ]);
    const protectedIds = new Set([...linked, ...movementProductIds].map(String));
    products.forEach((product) => {
      if (
        product.stockOnHand > 0 ||
        product.reservedStock > 0 ||
        (product.variants || []).some((variant: IProductVariant) => variant.stockOnHand > 0 || variant.reservedStock > 0)
      ) {
        protectedIds.add(String(product._id));
      }
    });
    const deletableIds = parsed.ids.filter((id) => !protectedIds.has(id));
    const archiveIds = parsed.ids.filter((id) => protectedIds.has(id));
    if (deletableIds.length > 0) {
      const delRes = await ProductModel.deleteMany({ _id: { $in: deletableIds } });
      modifiedCount += delRes.deletedCount || 0;
    }
    if (archiveIds.length > 0) {
      const arcRes = await ProductModel.updateMany({ _id: { $in: archiveIds } }, { $set: { status: 'archived' } });
      modifiedCount += arcRes.modifiedCount || 0;
    }
  } else if (parsed.action === 'publish') {
    const rawPresets = await ProductAttributePresetModel.find({ isActive: true, isRequired: true }).lean();
    const mappedRequired = rawPresets.map((d) => mapAttributeDoc(d as unknown as Record<string, unknown>));
    if (mappedRequired.length > 0) {
      const products = await ProductModel.find({ _id: { $in: parsed.ids } })
        .select('name categoryId subCategoryId attributeValues')
        .lean();
      for (const product of products) {
        const applicableRequired = resolveAttributesForCategories(
          mappedRequired,
          product.categoryId ? String(product.categoryId) : '',
          product.subCategoryId ? String(product.subCategoryId) : null,
          String(product._id),
        );
        const entryMap = new Map(
          (product.attributeValues || []).map((e: { code?: string; value?: unknown }) => [
            String(e.code || '').toLowerCase(),
            e.value,
          ]),
        );
        for (const def of applicableRequired) {
          const check = validateAttributeValue(def, entryMap.get(def.code.toLowerCase()));
          if (!check.valid) {
            throw new AppError(
              400,
              'ATTRIBUTE_VALIDATION_ERROR',
              `Cannot bulk-publish "${product.name}": ${check.error || `${def.name} is required.`}`,
            );
          }
        }
      }
    }
    const resUpdate = await ProductModel.updateMany(
      { _id: { $in: parsed.ids } },
      { $set: { status: 'published' } },
    );
    modifiedCount = resUpdate.modifiedCount || 0;
  } else {
    const statusMap: Record<string, 'published' | 'draft' | 'archived'> = {
      publish: 'published',
      draft: 'draft',
      archive: 'archived',
    };
    const resUpdate = await ProductModel.updateMany(
      { _id: { $in: parsed.ids } },
      { $set: { status: statusMap[parsed.action] } },
    );
    modifiedCount = resUpdate.modifiedCount || 0;
  }
  invalidatePublicCatalogCaches();
  invalidateAdminProductCaches();
  return { modifiedCount };
}

// ============================================================
// Attribute Groups CRUD
// ============================================================

export async function listAttributeGroupsAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Array<Record<string, unknown>>>('attr-groups');
    if (cached) return cached;
  }

  const [groups, attrs] = await Promise.all([
    AttributeGroupModel.find().sort({ sortOrder: 1, name: 1 }).lean(),
    ProductAttributePresetModel.find().select('groupId group').lean(),
  ]);
  const countsByGroupId = new Map<string, number>();
  for (const a of attrs) {
    if (a.groupId) {
      const key = String(a.groupId);
      countsByGroupId.set(key, (countsByGroupId.get(key) || 0) + 1);
    }
  }
  const result = groups.map((g) => ({
    ...g,
    id: String(g._id),
    attributeCount: countsByGroupId.get(String(g._id)) || 0,
  }));
  if (isDbConnected) {
    adminCache.set('attr-groups', result, 30_000);
  }
  return result;
}

export async function createAttributeGroupAdmin(parsed: z.infer<typeof attributeGroupSchema>) {
  const slug = slugifyAttributeCode(parsed.slug || parsed.name);
  const exists = await AttributeGroupModel.findOne({ $or: [{ slug }, { name: parsed.name }] }).lean();
  if (exists) {
    throw new AppError(409, 'DUPLICATE_ATTRIBUTE_GROUP', `Attribute group "${parsed.name}" already exists.`);
  }
  const group = await AttributeGroupModel.create({
    ...parsed,
    slug,
  });
  invalidateAdminAttributeCaches();
  return { ...group.toObject(), id: String(group._id), attributeCount: 0 };
}

export async function updateAttributeGroupAdmin(id: string, parsed: z.infer<typeof attributeGroupSchema>) {
  const slug = slugifyAttributeCode(parsed.slug || parsed.name);
  const updated = await AttributeGroupModel.findByIdAndUpdate(
    id,
    { $set: { ...parsed, slug } },
    { new: true },
  );
  if (!updated) throw new AppError(404, 'ATTRIBUTE_GROUP_NOT_FOUND', 'Attribute group not found.');
  await ProductAttributePresetModel.updateMany(
    { groupId: updated._id },
    { $set: { groupName: updated.name, group: updated.slug } },
  );
  const groupAttrs = await ProductAttributePresetModel.find({ groupId: updated._id })
    .select('_id code')
    .lean();
  if (groupAttrs.length > 0) {
    const attrIds = groupAttrs.map((a) => a._id);
    const attrCodes = groupAttrs.map((a) => String(a.code || '').toLowerCase()).filter(Boolean);
    await ProductModel.updateMany(
      {
        $or: [
          { 'attributeValues.attributeId': { $in: attrIds } },
          { 'attributeValues.code': { $in: attrCodes } },
        ],
      },
      { $set: { 'attributeValues.$[elem].groupName': updated.name } },
      {
        arrayFilters: [
          {
            $or: [
              { 'elem.attributeId': { $in: attrIds } },
              { 'elem.code': { $in: attrCodes } },
            ],
          },
        ],
      },
    );
  }
  invalidateAdminAttributeCaches();
  return { ...updated.toObject(), id: String(updated._id) };
}

export async function deleteAttributeGroupAdmin(id: string) {
  const group = await AttributeGroupModel.findById(id);
  if (!group) throw new AppError(404, 'ATTRIBUTE_GROUP_NOT_FOUND', 'Attribute group not found.');
  await ProductAttributePresetModel.updateMany(
    { groupId: group._id },
    { $set: { groupId: null, groupName: 'General', group: 'general' } },
  );
  await group.deleteOne();
  invalidateAdminAttributeCaches();
  return { deleted: true };
}

// ============================================================
// Dynamic Attributes CRUD
// ============================================================

async function buildAttributeUsageCountMap(): Promise<Map<string, number>> {
  const counts = await ProductModel.aggregate([
    { $unwind: '$attributeValues' },
    { $group: { _id: { $toLower: '$attributeValues.code' }, count: { $sum: 1 } } },
  ]);
  const map = new Map<string, number>();
  for (const row of counts) {
    if (row._id) map.set(String(row._id), Number(row.count || 0));
  }
  return map;
}

async function normalizeAttributeWritePayload(parsed: z.infer<typeof attributePresetSchema>) {
  const code = slugifyAttributeCode(parsed.code || parsed.name);
  if (!code) {
    throw new AppError(400, 'INVALID_ATTRIBUTE_CODE', 'Attribute code must contain letters or numbers.');
  }

  let resolvedGroupId: mongoose.Types.ObjectId | null = null;
  let resolvedGroupSlug = parsed.group || 'general';
  let resolvedGroupName = parsed.groupName || '';

  if (parsed.groupId && mongoose.Types.ObjectId.isValid(parsed.groupId)) {
    const grp = await AttributeGroupModel.findById(parsed.groupId).lean();
    if (grp) {
      resolvedGroupId = grp._id as mongoose.Types.ObjectId;
      resolvedGroupSlug = grp.slug;
      resolvedGroupName = grp.name;
    }
  }

  const options = normalizeAttributeOptions(parsed.options || [], parsed.values || []);
  const values = options.map((o) => o.label);
  const rawCategoryIds = parsed.scope === 'category' ? parsed.categoryIds || [] : [];
  if (rawCategoryIds.some((categoryId) => !mongoose.Types.ObjectId.isValid(categoryId))) {
    throw new AppError(400, 'INVALID_ATTRIBUTE_CATEGORY', 'One or more selected category identifiers are invalid.');
  }
  const categoryIds = Array.from(new Set(rawCategoryIds));
  if (categoryIds.length > 0) {
    const linkedCategories = await CategoryModel.countDocuments({ _id: { $in: categoryIds } });
    if (linkedCategories !== categoryIds.length) {
      throw new AppError(400, 'INVALID_ATTRIBUTE_CATEGORY', 'One or more selected categories no longer exist.');
    }
  }
  const rawProductIds = parsed.scope === 'product' ? parsed.productIds || [] : [];
  if (rawProductIds.some((productId) => !mongoose.Types.ObjectId.isValid(productId))) {
    throw new AppError(400, 'INVALID_ATTRIBUTE_PRODUCT', 'One or more selected product identifiers are invalid.');
  }
  const productIds = Array.from(new Set(rawProductIds));
  if (parsed.scope === 'product' && productIds.length === 0) {
    throw new AppError(400, 'PRODUCT_SCOPE_REQUIRED', 'Select at least one product for a product-scoped attribute.');
  }
  if (productIds.length > 0) {
    const linkedProducts = await ProductModel.countDocuments({ _id: { $in: productIds } });
    if (linkedProducts !== productIds.length) {
      throw new AppError(400, 'INVALID_ATTRIBUTE_PRODUCT', 'One or more selected products no longer exist.');
    }
  }

  return {
    name: parsed.name.trim(),
    code,
    description: parsed.description || '',
    group: resolvedGroupSlug,
    groupId: resolvedGroupId,
    groupName: resolvedGroupName || resolvedGroupSlug,
    inputType: parsed.inputType,
    unit: parsed.unit || '',
    scope: parsed.scope,
    categoryIds,
    productIds,
    options,
    values,
    defaultValue: parsed.defaultValue ?? null,
    validationRules: parsed.validationRules || {},
    sortOrder: parsed.sortOrder ?? 0,
    isRequired: Boolean(parsed.isRequired),
    isVisibleToCustomers: parsed.isVisibleToCustomers !== false,
    showOnProductDetails: parsed.showOnProductDetails !== false,
    isFilterable: Boolean(parsed.isFilterable),
    isSearchable: parsed.isSearchable !== false,
    isComparable: Boolean(parsed.isComparable),
    isActive: parsed.isActive !== false,
  };
}

export async function listAttributesAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<ReturnType<typeof mapAttributeDoc>[]>('attrs');
    if (cached) return cached;
  }

  const [attributes, usageMap] = await Promise.all([
    ProductAttributePresetModel.find().sort({ sortOrder: 1, group: 1, name: 1 }).lean(),
    buildAttributeUsageCountMap(),
  ]);
  const result = attributes.map((a) =>
    mapAttributeDoc(
      a as unknown as Record<string, unknown>,
      usageMap.get(String(a.code || '').toLowerCase()) || 0,
    ),
  );
  if (isDbConnected) {
    adminCache.set('attrs', result, 30_000);
  }
  return result;
}

export async function getAttributesByCategoryAdmin(categoryId?: string, subCategoryId?: string, productId?: string) {
  const raw = await ProductAttributePresetModel.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const mapped = raw.map((d) => mapAttributeDoc(d as unknown as Record<string, unknown>));
  return resolveAttributesForCategories(mapped, categoryId, subCategoryId, productId);
}

export async function createAttributeAdmin(parsed: z.infer<typeof attributePresetSchema>) {
  const payload = await normalizeAttributeWritePayload(parsed);
  const existing = await ProductAttributePresetModel.findOne({ code: payload.code }).lean();
  if (existing) {
    throw new AppError(409, 'DUPLICATE_ATTRIBUTE_CODE', `Attribute code "${payload.code}" already exists.`);
  }
  const attr = await ProductAttributePresetModel.create(payload);
  invalidateAdminAttributeCaches();
  return mapAttributeDoc(attr.toObject() as unknown as Record<string, unknown>, 0);
}

export async function updateAttributeAdmin(id: string, parsed: z.infer<typeof attributePresetSchema>) {
  const existingAttr = await ProductAttributePresetModel.findById(id).lean();
  if (!existingAttr) throw new AppError(404, 'ATTRIBUTE_NOT_FOUND', 'Attribute preset not found.');

  const payload = await normalizeAttributeWritePayload(parsed);
  const duplicate = await ProductAttributePresetModel.findOne({
    code: payload.code,
    _id: { $ne: id },
  }).lean();
  if (duplicate) {
    throw new AppError(409, 'DUPLICATE_ATTRIBUTE_CODE', `Attribute code "${payload.code}" already exists.`);
  }
  const updated = await ProductAttributePresetModel.findByIdAndUpdate(id, { $set: payload }, { new: true });
  if (!updated) throw new AppError(404, 'ATTRIBUTE_NOT_FOUND', 'Attribute preset not found.');

  const oldCode = String(existingAttr.code || '').toLowerCase();
  const matchOr: Record<string, unknown>[] = [{ attributeId: updated._id }];
  const filterOr: Record<string, unknown>[] = [{ 'elem.attributeId': updated._id }];
  if (oldCode) {
    matchOr.push({ code: oldCode });
    filterOr.push({ 'elem.code': oldCode });
  }
  await ProductModel.updateMany(
    {
      $or: matchOr.map((cond) =>
        Object.fromEntries(Object.entries(cond).map(([k, v]) => [`attributeValues.${k}`, v])),
      ),
    },
    {
      $set: {
        'attributeValues.$[elem].attributeId': updated._id,
        'attributeValues.$[elem].code': updated.code,
        'attributeValues.$[elem].name': updated.name,
        'attributeValues.$[elem].groupName': updated.groupName || updated.group || 'General',
        'attributeValues.$[elem].unit': updated.unit || '',
        'attributeValues.$[elem].sortOrder': updated.sortOrder ?? 0,
        'attributeValues.$[elem].isVisibleToCustomers':
          updated.isActive === false ? false : updated.isVisibleToCustomers !== false,
        'attributeValues.$[elem].showOnProductDetails':
          updated.isActive === false ? false : updated.showOnProductDetails !== false,
        'attributeValues.$[elem].isFilterable': Boolean(updated.isFilterable),
        'attributeValues.$[elem].isSearchable': updated.isSearchable !== false,
        'attributeValues.$[elem].isComparable': Boolean(updated.isComparable),
      },
    },
    { arrayFilters: [{ $or: filterOr }] },
  );

  invalidateAdminAttributeCaches();
  return mapAttributeDoc(updated.toObject() as unknown as Record<string, unknown>);
}

export async function deleteAttributeAdmin(id: string) {
  const deleted = await ProductAttributePresetModel.findByIdAndDelete(id);
  if (!deleted) throw new AppError(404, 'ATTRIBUTE_NOT_FOUND', 'Attribute preset not found.');
  await ProductModel.updateMany(
    { 'attributeValues.attributeId': deleted._id },
    { $set: { 'attributeValues.$[elem].attributeId': null } },
    { arrayFilters: [{ 'elem.attributeId': deleted._id }] },
  );
  invalidateAdminAttributeCaches();
  return { deleted: true };
}

// ============================================================
// Product Q&A Moderation
// ============================================================

export async function answerProductQuestionAdmin(
  productId: string,
  questionId: string,
  parsed: z.infer<typeof answerQuestionSchema>,
  actorName: string,
) {
  const product = await ProductModel.findById(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

  const q = (product.questions || []).find((item: { _id?: unknown }) => String(item._id) === questionId);
  if (!q) throw new AppError(404, 'QUESTION_NOT_FOUND', 'Customer question not found.');

  q.answer = parsed.answer;
  q.answeredBy = actorName || 'Store Support';
  q.answeredAt = new Date();
  q.isPublished = parsed.isPublished;
  await product.save();

  return {
    question: {
      id: String(q._id),
      question: q.question,
      answer: q.answer,
      askedBy: q.userName,
      answeredBy: q.answeredBy,
      answeredAt: q.answeredAt,
      isPublished: q.isPublished,
      createdAt: q.createdAt,
    },
  };
}

export async function deleteProductQuestionAdmin(productId: string, questionId: string) {
  const product = await ProductModel.findById(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

  product.questions = (product.questions || []).filter((item: { _id?: unknown }) => String(item._id) !== questionId);
  await product.save();
  return { deleted: true };
}
