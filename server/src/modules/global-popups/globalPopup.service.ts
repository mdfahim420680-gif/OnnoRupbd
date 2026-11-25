import mongoose from 'mongoose';
import { GlobalPromotionalPopupModel } from './globalPopup.model';
import type { GlobalPopupValidatedInput } from './globalPopup.validation';
import { ProductModel } from '../products/product.model';
import { enrichProductPricing, resolveVariantImageUrl } from '../products/productCatalogHelpers';
import { computeAvailableStock } from '../../../../src/lib/orderStateMachine';
import { resolveEffectiveUnitPrice } from '../../../../src/lib/pricingEngine';
import {
  calculateCtrPercent,
  computeEffectiveCampaignStatus,
  pickWinningCampaign,
  type GlobalPopupCampaign,
  type GlobalPopupDeviceKind,
  type GlobalPopupKpiSummary,
  type GlobalPopupLinkedProductSummary,
  type GlobalPopupPublicCampaign,
  type GlobalPopupStatus,
} from '../../../../src/lib/globalPromotionalPopup';
import { AppError } from '../../middleware/error.middleware';
import { storefrontCache } from '../../utils/ttlCache';
import { isDatabaseReady } from '../../database/connection';

const LINKED_PRODUCT_SELECT =
  'name slug sku images basePrice salePrice flashSalePrice flashSaleStartsAt flashSaleEndsAt stockOnHand reservedStock manageInventory allowBackorder hasVariants variants status';

function invalidateGlobalPopupCaches() {
  storefrontCache.invalidatePrefix('storefront:global-popup');
}

function mapLinkedProductSummary(
  prodRaw: Record<string, unknown> | null | undefined,
  campaignSpecialPrice?: number | null,
): GlobalPopupLinkedProductSummary | null {
  if (!prodRaw || !prodRaw._id) return null;
  const enriched = enrichProductPricing(
    campaignSpecialPrice && campaignSpecialPrice > 0
      ? { ...prodRaw, campaignSpecialPrice }
      : prodRaw,
  ) as Record<string, unknown>;

  const rawVariants = Array.isArray(prodRaw.variants) ? prodRaw.variants : [];
  const activeVariants = rawVariants
    .filter((v: { isActive?: boolean }) => v.isActive !== false)
    .map((v: Record<string, unknown>) => {
      const vPricing = resolveEffectiveUnitPrice({
        basePrice: Number(v.price ?? prodRaw.basePrice ?? 0),
        salePrice: (v.salePrice as number | null | undefined) ?? (prodRaw.salePrice as number | null | undefined) ?? null,
        flashSalePrice: prodRaw.flashSalePrice as number | null | undefined,
        flashSaleStartsAt: prodRaw.flashSaleStartsAt as string | Date | null | undefined,
        flashSaleEndsAt: prodRaw.flashSaleEndsAt as string | Date | null | undefined,
        campaignSpecialPrice,
      });
      return {
        id: String(v._id),
        sku: String(v.sku || prodRaw.sku || ''),
        title: String(v.title || 'Default'),
        options:
          v.options instanceof Map
            ? Object.fromEntries(v.options.entries())
            : ((v.options as Record<string, string>) || {}),
        currentPrice: vPricing.currentPrice,
        originalPrice: vPricing.originalPrice,
        availableStock:
          prodRaw.manageInventory === false || Boolean(prodRaw.allowBackorder)
            ? Math.max(computeAvailableStock(Number(v.stockOnHand || 0), Number(v.reservedStock || 0)), 99)
            : computeAvailableStock(Number(v.stockOnHand || 0), Number(v.reservedStock || 0)),
        imageUrl: resolveVariantImageUrl(
          v as Parameters<typeof resolveVariantImageUrl>[0],
          prodRaw as Parameters<typeof resolveVariantImageUrl>[1],
        ),
        isActive: v.isActive !== false,
      };
    });

  const firstImage = Array.isArray(prodRaw.images)
    ? (prodRaw.images[0] as { url?: string } | undefined)?.url || ''
    : '';

  return {
    id: String(prodRaw._id),
    name: String(prodRaw.name || ''),
    slug: String(prodRaw.slug || ''),
    sku: String(prodRaw.sku || ''),
    imageUrl: firstImage,
    basePrice: Number(prodRaw.basePrice || 0),
    salePrice: prodRaw.salePrice != null ? Number(prodRaw.salePrice) : null,
    currentPrice: Number(enriched.currentPrice || 0),
    originalPrice: enriched.originalPrice != null ? Number(enriched.originalPrice) : null,
    discountPercent: Number(enriched.discountPercent || 0),
    availableStock: Number(enriched.availableStock || 0),
    manageInventory: prodRaw.manageInventory !== false,
    allowBackorder: Boolean(prodRaw.allowBackorder),
    hasVariants: Boolean(prodRaw.hasVariants) && activeVariants.length > 0,
    variants: activeVariants,
    status: String(prodRaw.status || 'draft'),
  };
}

function serializeAdminCampaign(doc: Record<string, unknown>, now = new Date()): GlobalPopupCampaign {
  const id = String(doc._id);
  const status = (doc.status as GlobalPopupStatus) || 'draft';
  const enabled = Boolean(doc.enabled);
  const archived = Boolean(doc.archived);
  const startAt = doc.startAt ? new Date(String(doc.startAt)).toISOString() : null;
  const endAt = doc.endAt ? new Date(String(doc.endAt)).toISOString() : null;
  const effectiveStatus = computeEffectiveCampaignStatus(
    { status, enabled, archived, startAt, endAt },
    now,
  );

  const rawPricing = (doc.pricing as Record<string, unknown> | undefined) || {};
  const specialPrice =
    rawPricing.mode === 'campaign_special' && rawPricing.specialPrice != null
      ? Number(rawPricing.specialPrice)
      : null;

  const populatedProd =
    doc.linkedProduct && typeof doc.linkedProduct === 'object' && '_id' in doc.linkedProduct
      ? (doc.linkedProduct as Record<string, unknown>)
      : null;

  const linkedProductId = populatedProd
    ? String(populatedProd._id)
    : doc.linkedProduct
      ? String(doc.linkedProduct)
      : null;

  const analyticsRaw = (doc.analytics as Record<string, unknown> | undefined) || {};
  const impressions = Math.max(0, Number(analyticsRaw.impressions || 0));
  const clicks = Math.max(0, Number(analyticsRaw.clicks || 0));

  const countdownRaw = (doc.countdown as Record<string, unknown> | undefined) || {};

  return {
    id,
    name: String(doc.name || ''),
    slug: String(doc.slug || ''),
    description: String(doc.description || ''),
    campaignType: (doc.campaignType as GlobalPopupCampaign['campaignType']) || 'product_launch',
    status,
    effectiveStatus,
    enabled,
    autoDisplay: doc.autoDisplay !== false,
    priority: Number(doc.priority ?? 10),
    displayDelaySeconds: Number(doc.displayDelaySeconds ?? 20),
    startAt,
    endAt,
    archived,
    targeting: {
      mode: ((doc.targeting as Record<string, unknown>)?.mode as 'global' | 'selected') || 'global',
      selectedRoutes: Array.isArray((doc.targeting as Record<string, unknown>)?.selectedRoutes)
        ? ((doc.targeting as Record<string, unknown>).selectedRoutes as string[])
        : [],
      excludedRoutes: Array.isArray((doc.targeting as Record<string, unknown>)?.excludedRoutes)
        ? ((doc.targeting as Record<string, unknown>).excludedRoutes as string[])
        : [],
      showOnDesktop: (doc.targeting as Record<string, unknown>)?.showOnDesktop !== false,
      showOnMobile: (doc.targeting as Record<string, unknown>)?.showOnMobile !== false,
      sessionFrequency: 'once_per_session',
    },
    design: doc.design as GlobalPopupCampaign['design'],
    content: doc.content as GlobalPopupCampaign['content'],
    media: doc.media as GlobalPopupCampaign['media'],
    features: Array.isArray(doc.features) ? (doc.features as GlobalPopupCampaign['features']) : [],
    pricing: {
      mode: (rawPricing.mode as 'product_auto' | 'campaign_special') || 'product_auto',
      specialPrice: rawPricing.specialPrice != null ? Number(rawPricing.specialPrice) : null,
      originalPriceOverride:
        rawPricing.originalPriceOverride != null ? Number(rawPricing.originalPriceOverride) : null,
      showOriginalPrice: rawPricing.showOriginalPrice !== false,
      showDiscountBadge: rawPricing.showDiscountBadge !== false,
      currencySymbol: String(rawPricing.currencySymbol || '৳'),
    },
    countdown: {
      enabled: countdownRaw.enabled !== false,
      expiresAt: countdownRaw.expiresAt ? new Date(String(countdownRaw.expiresAt)).toISOString() : endAt,
      format: (countdownRaw.format as 'dhms' | 'hms' | 'compact') || 'dhms',
      label: String(countdownRaw.label || 'Offer Ends In:'),
    },
    benefits: Array.isArray(doc.benefits) ? (doc.benefits as GlobalPopupCampaign['benefits']) : [],
    linkedProductId,
    linkedProduct: mapLinkedProductSummary(populatedProd, specialPrice),
    analytics: {
      impressions,
      clicks,
      ctr: calculateCtrPercent(clicks, impressions),
      lastImpressionAt: analyticsRaw.lastImpressionAt
        ? new Date(String(analyticsRaw.lastImpressionAt)).toISOString()
        : null,
      lastClickAt: analyticsRaw.lastClickAt
        ? new Date(String(analyticsRaw.lastClickAt)).toISOString()
        : null,
    },
    createdAt: doc.createdAt ? new Date(String(doc.createdAt)).toISOString() : now.toISOString(),
    updatedAt: doc.updatedAt ? new Date(String(doc.updatedAt)).toISOString() : now.toISOString(),
  };
}

function serializePublicCampaign(adminView: GlobalPopupCampaign): GlobalPopupPublicCampaign {
  return {
    id: adminView.id,
    name: adminView.name,
    slug: adminView.slug,
    campaignType: adminView.campaignType,
    priority: adminView.priority,
    displayDelaySeconds: adminView.displayDelaySeconds,
    startAt: adminView.startAt,
    endAt: adminView.endAt,
    targeting: adminView.targeting,
    design: adminView.design,
    content: adminView.content,
    media: adminView.media,
    features: adminView.features,
    pricing: adminView.pricing,
    countdown: adminView.countdown,
    benefits: adminView.benefits,
    linkedProduct: adminView.linkedProduct,
  };
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  const clean = baseSlug || `promo-${Date.now()}`;
  const existsFilter: Record<string, unknown> = { slug: clean };
  if (excludeId) existsFilter._id = { $ne: excludeId };
  const conflict = await GlobalPromotionalPopupModel.findOne(existsFilter).select('_id').lean();
  if (!conflict) return clean;
  return `${clean}-${Math.random().toString(36).slice(2, 6)}`;
}

async function verifyLinkedProductExists(linkedProductId: string | null | undefined): Promise<string | null> {
  if (!linkedProductId) return null;
  if (!mongoose.isValidObjectId(linkedProductId)) {
    throw new AppError(400, 'INVALID_PRODUCT_ID', 'Invalid linked product ID.');
  }
  const prod = await ProductModel.findById(linkedProductId).select('_id status').lean();
  if (!prod) {
    throw new AppError(404, 'LINKED_PRODUCT_NOT_FOUND', 'Linked product could not be found.');
  }
  return String(prod._id);
}

export async function listGlobalPopups(params: {
  q?: string;
  status?: string;
  type?: string;
  includeArchived?: boolean;
}): Promise<{ campaigns: GlobalPopupCampaign[]; summary: GlobalPopupKpiSummary }> {
  const now = new Date();
  const baseFilter: Record<string, unknown> = {};
  if (!params.includeArchived) {
    baseFilter.archived = { $ne: true };
  }
  if (params.type) {
    baseFilter.campaignType = params.type;
  }
  if (params.q && params.q.trim()) {
    const regex = new RegExp(params.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    baseFilter.$or = [
      { name: regex },
      { slug: regex },
      { 'content.mainHeading': regex },
      { 'content.highlightedHeading': regex },
    ];
  }

  const allDocs = await GlobalPromotionalPopupModel.find(
    params.includeArchived ? {} : { archived: { $ne: true } },
  )
    .populate('linkedProduct', LINKED_PRODUCT_SELECT)
    .sort({ priority: -1, updatedAt: -1 })
    .lean();

  const allSerialized = allDocs.map((d) => serializeAdminCampaign(d as unknown as Record<string, unknown>, now));

  const summary: GlobalPopupKpiSummary = {
    totalCampaigns: allSerialized.length,
    activeCampaigns: allSerialized.filter((c) => c.effectiveStatus === 'active').length,
    scheduledCampaigns: allSerialized.filter((c) => c.effectiveStatus === 'scheduled').length,
    pausedCampaigns: allSerialized.filter((c) => c.effectiveStatus === 'paused').length,
    expiredCampaigns: allSerialized.filter((c) => c.effectiveStatus === 'expired').length,
    draftCampaigns: allSerialized.filter((c) => c.effectiveStatus === 'draft').length,
    totalImpressions: allSerialized.reduce((sum, c) => sum + c.analytics.impressions, 0),
    totalClicks: allSerialized.reduce((sum, c) => sum + c.analytics.clicks, 0),
    clickThroughRate: 0,
  };
  summary.clickThroughRate = calculateCtrPercent(summary.totalClicks, summary.totalImpressions);

  const filteredDocs =
    Object.keys(baseFilter).length > 1 || params.q || params.type
      ? await GlobalPromotionalPopupModel.find(baseFilter)
          .populate('linkedProduct', LINKED_PRODUCT_SELECT)
          .sort({ priority: -1, updatedAt: -1 })
          .lean()
      : allDocs;

  let campaigns = filteredDocs.map((d) => serializeAdminCampaign(d as unknown as Record<string, unknown>, now));
  if (params.status) {
    campaigns = campaigns.filter((c) => c.effectiveStatus === params.status);
  }

  return { campaigns, summary };
}

export async function getGlobalPopupById(id: string): Promise<GlobalPopupCampaign> {
  const doc = await GlobalPromotionalPopupModel.findById(id)
    .populate('linkedProduct', LINKED_PRODUCT_SELECT)
    .lean();
  if (!doc) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Global promotional popup campaign not found.');
  }
  return serializeAdminCampaign(doc as unknown as Record<string, unknown>);
}

export async function createGlobalPopup(
  input: GlobalPopupValidatedInput,
  actorId?: unknown,
): Promise<GlobalPopupCampaign> {
  const verifiedProductId = await verifyLinkedProductExists(input.linkedProductId);
  const uniqueSlug = await ensureUniqueSlug(input.slug);

  const created = await GlobalPromotionalPopupModel.create({
    name: input.name,
    slug: uniqueSlug,
    description: input.description,
    campaignType: input.campaignType,
    status: input.status,
    enabled: input.enabled,
    autoDisplay: input.autoDisplay,
    priority: input.priority,
    displayDelaySeconds: input.displayDelaySeconds,
    startAt: input.startAt ? new Date(input.startAt) : null,
    endAt: input.endAt ? new Date(input.endAt) : null,
    archived: input.archived,
    targeting: input.targeting,
    design: input.design,
    content: input.content,
    media: input.media,
    features: input.features,
    pricing: input.pricing,
    countdown: {
      ...input.countdown,
      expiresAt: input.countdown.expiresAt
        ? new Date(input.countdown.expiresAt)
        : input.endAt
          ? new Date(input.endAt)
          : null,
    },
    benefits: input.benefits,
    linkedProduct: verifiedProductId,
    createdBy: actorId || null,
    updatedBy: actorId || null,
  });

  invalidateGlobalPopupCaches();
  return getGlobalPopupById(String(created._id));
}

export async function updateGlobalPopup(
  id: string,
  input: GlobalPopupValidatedInput,
  actorId?: unknown,
): Promise<GlobalPopupCampaign> {
  const existing = await GlobalPromotionalPopupModel.findById(id);
  if (!existing) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Global promotional popup campaign not found.');
  }

  const verifiedProductId = await verifyLinkedProductExists(input.linkedProductId);
  const uniqueSlug = await ensureUniqueSlug(input.slug, id);

  existing.set({
    name: input.name,
    slug: uniqueSlug,
    description: input.description,
    campaignType: input.campaignType,
    status: input.status,
    enabled: input.enabled,
    autoDisplay: input.autoDisplay,
    priority: input.priority,
    displayDelaySeconds: input.displayDelaySeconds,
    startAt: input.startAt ? new Date(input.startAt) : null,
    endAt: input.endAt ? new Date(input.endAt) : null,
    archived: input.archived,
    targeting: input.targeting,
    design: input.design,
    content: input.content,
    media: input.media,
    features: input.features,
    pricing: input.pricing,
    countdown: {
      ...input.countdown,
      expiresAt: input.countdown.expiresAt
        ? new Date(input.countdown.expiresAt)
        : input.endAt
          ? new Date(input.endAt)
          : null,
    },
    benefits: input.benefits,
    linkedProduct: verifiedProductId,
    updatedBy: actorId || existing.updatedBy,
  });

  await existing.save();
  invalidateGlobalPopupCaches();
  return getGlobalPopupById(id);
}

export async function setGlobalPopupStatus(
  id: string,
  params: { status: 'draft' | 'scheduled' | 'active' | 'paused'; enabled?: boolean },
  actorId?: unknown,
): Promise<GlobalPopupCampaign> {
  const doc = await GlobalPromotionalPopupModel.findById(id);
  if (!doc) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Global promotional popup campaign not found.');
  }

  if (params.status === 'active' && doc.endAt && new Date(doc.endAt).getTime() <= Date.now()) {
    throw new AppError(
      400,
      'CAMPAIGN_EXPIRED',
      'Cannot activate a campaign whose end date/time is already in the past. Update the end date first.',
    );
  }

  doc.status = params.status;
  if (params.enabled !== undefined) {
    doc.enabled = params.enabled;
  } else if (params.status === 'active') {
    doc.enabled = true;
  } else if (params.status === 'paused') {
    doc.enabled = false;
  }
  doc.updatedBy = (actorId as typeof doc.updatedBy) || doc.updatedBy;
  await doc.save();

  invalidateGlobalPopupCaches();
  return getGlobalPopupById(id);
}

export async function duplicateGlobalPopup(id: string, actorId?: unknown): Promise<GlobalPopupCampaign> {
  const source = await GlobalPromotionalPopupModel.findById(id).lean();
  if (!source) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Global promotional popup campaign not found.');
  }

  const copyName = `${source.name} (Copy)`.slice(0, 140);
  const copySlug = await ensureUniqueSlug(`${source.slug}-copy`);

  const created = await GlobalPromotionalPopupModel.create({
    name: copyName,
    slug: copySlug,
    description: source.description || '',
    campaignType: source.campaignType,
    status: 'draft',
    enabled: false,
    autoDisplay: source.autoDisplay !== false,
    priority: source.priority,
    displayDelaySeconds: source.displayDelaySeconds,
    startAt: source.startAt || null,
    endAt: source.endAt || null,
    archived: false,
    targeting: source.targeting,
    design: source.design,
    content: source.content,
    media: source.media,
    features: source.features || [],
    pricing: source.pricing,
    countdown: source.countdown,
    benefits: source.benefits || [],
    linkedProduct: source.linkedProduct || null,
    analytics: {
      impressions: 0,
      clicks: 0,
      lastImpressionAt: null,
      lastClickAt: null,
    },
    createdBy: actorId || null,
    updatedBy: actorId || null,
  });

  invalidateGlobalPopupCaches();
  return getGlobalPopupById(String(created._id));
}

export async function deleteGlobalPopup(id: string): Promise<{ id: string }> {
  const deleted = await GlobalPromotionalPopupModel.findByIdAndDelete(id);
  if (!deleted) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Global promotional popup campaign not found.');
  }
  invalidateGlobalPopupCaches();
  return { id };
}

export async function getEligiblePublicGlobalPopup(params: {
  pathname: string;
  deviceKind: GlobalPopupDeviceKind;
  now?: Date;
}): Promise<{ campaign: GlobalPopupPublicCampaign | null; serverNow: string }> {
  const now = params.now ?? new Date();
  const cacheKey = `storefront:global-popup:${params.deviceKind}:${params.pathname}`;
  const cached = storefrontCache.get<{ campaign: GlobalPopupPublicCampaign | null }>(cacheKey);
  if (cached) {
    return { campaign: cached.campaign, serverNow: now.toISOString() };
  }

  const docs = await GlobalPromotionalPopupModel.find({
    archived: { $ne: true },
    enabled: true,
    autoDisplay: { $ne: false },
    status: { $in: ['active', 'scheduled'] },
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
    ],
  })
    .populate('linkedProduct', LINKED_PRODUCT_SELECT)
    .sort({ priority: -1, updatedAt: -1 })
    .lean();

  const candidates = docs
    .map((d) => serializeAdminCampaign(d as unknown as Record<string, unknown>, now))
    .filter((c) => {
      // If campaign adds/views a product, ensure the linked product exists and is published
      if (
        (c.content.ctaAction === 'add_to_cart' || c.content.ctaAction === 'view_product') &&
        (!c.linkedProduct || c.linkedProduct.status !== 'published')
      ) {
        return false;
      }
      return true;
    });

  const winner = pickWinningCampaign(candidates, {
    now,
    pathname: params.pathname,
    deviceKind: params.deviceKind,
    requireAutoDisplay: true,
  });

  const publicCampaign = winner ? serializePublicCampaign(winner) : null;
  storefrontCache.set(cacheKey, { campaign: publicCampaign }, 15_000);
  return {
    campaign: publicCampaign,
    serverNow: now.toISOString(),
  };
}

export async function recordGlobalPopupInteraction(
  id: string,
  event: 'impression' | 'click',
): Promise<{ ok: boolean }> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(400, 'INVALID_ID', 'Invalid campaign ID.');
  }

  const now = new Date();
  const update =
    event === 'click'
      ? { $inc: { 'analytics.clicks': 1 }, $set: { 'analytics.lastClickAt': now } }
      : { $inc: { 'analytics.impressions': 1 }, $set: { 'analytics.lastImpressionAt': now } };

  const res = await GlobalPromotionalPopupModel.updateOne(
    { _id: id, archived: { $ne: true } },
    update,
  );
  if (res.matchedCount === 0) {
    throw new AppError(404, 'POPUP_CAMPAIGN_NOT_FOUND', 'Campaign not found.');
  }
  return { ok: true };
}

/**
 * Resolves authorized server-side promotional pricing from active, scheduled-eligible
 * Global Promotional Popup campaigns using `pricing.mode === 'campaign_special'`.
 * Cart, checkout quote, order creation, and product detail endpoints invoke this
 * so client prices are never trusted and campaign pricing stays consistent everywhere.
 */
export async function getActiveCampaignSpecialPricesMap(
  productIds?: string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!isDatabaseReady()) return result;

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    enabled: true,
    status: { $in: ['active', 'scheduled'] },
    'pricing.mode': 'campaign_special',
    'pricing.specialPrice': { $gt: 0 },
    linkedProduct: { $ne: null },
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
    ],
  };

  if (productIds && productIds.length > 0) {
    const validIds = productIds.filter((id) => mongoose.isValidObjectId(id));
    if (validIds.length === 0) return result;
    filter.linkedProduct = { $in: validIds };
  }

  try {
    const docs = await GlobalPromotionalPopupModel.find(filter)
      .select('linkedProduct pricing.specialPrice priority updatedAt')
      .sort({ priority: -1, updatedAt: -1 })
      .lean();

    for (const doc of docs) {
      const pid = doc.linkedProduct ? String(doc.linkedProduct) : '';
      const price = Number((doc.pricing as { specialPrice?: number } | undefined)?.specialPrice || 0);
      if (!pid || price <= 0) continue;
      const prev = result.get(pid);
      if (prev === undefined || price < prev) {
        result.set(pid, price);
      }
    }
  } catch {
    // Gracefully fall back when Mongoose connection is mocked or bufferCommands is disabled
    return result;
  }
  return result;
}
