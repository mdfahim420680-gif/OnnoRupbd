export type GlobalPopupStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired';

export type GlobalPopupCampaignType =
  | 'product_launch'
  | 'flash_sale'
  | 'seasonal'
  | 'clearance'
  | 'bundle'
  | 'announcement';

export type GlobalPopupCtaAction =
  | 'add_to_cart'
  | 'view_product'
  | 'internal_page'
  | 'external_url';

export type GlobalPopupPricingMode = 'product_auto' | 'campaign_special';

export type GlobalPopupTargetingMode = 'global' | 'selected';

export type GlobalPopupDeviceKind = 'desktop' | 'tablet' | 'mobile';

export type GlobalPopupAnimationStyle = 'scale_fade' | 'slide_up' | 'zoom_spring' | 'none';

export type GlobalPopupShadowStrength = 'soft' | 'medium' | 'dramatic';

export type GlobalPopupImageFit = 'contain' | 'cover';

export type GlobalPopupImagePosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

export type GlobalPopupCountdownFormat = 'dhms' | 'hms' | 'compact';

export interface GlobalPopupFeatureItem {
  id: string;
  icon: string;
  title: string;
  description?: string;
  visible: boolean;
  sortOrder: number;
}

export interface GlobalPopupBenefitItem {
  id: string;
  icon: string;
  label: string;
  visible: boolean;
  sortOrder: number;
}

export interface GlobalPopupDesignConfig {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  borderRadiusPx: number;
  maxWidthPx: number;
  fontFamily: 'inter_jakarta' | 'jakarta' | 'inter' | 'system';
  shadowStrength: GlobalPopupShadowStrength;
  overlayOpacity: number;
  backdropBlurPx: number;
  animationStyle: GlobalPopupAnimationStyle;
}

export interface GlobalPopupContentConfig {
  offerBadgeText: string;
  offerBadgeIcon: string;
  showOfferBadge: boolean;
  tagline: string;
  mainHeading: string;
  highlightedHeading: string;
  description: string;
  discountText: string;
  discountPercent: number | null;
  showDiscountBadge: boolean;
  ctaLabel: string;
  ctaAction: GlobalPopupCtaAction;
  ctaDestination: string;
}

export interface GlobalPopupMediaConfig {
  desktopImageUrl: string;
  desktopImagePublicId: string;
  mobileImageUrl: string;
  mobileImagePublicId: string;
  imageAlt: string;
  imagePosition: GlobalPopupImagePosition;
  imageFit: GlobalPopupImageFit;
}

export interface GlobalPopupPricingConfig {
  mode: GlobalPopupPricingMode;
  specialPrice: number | null;
  originalPriceOverride: number | null;
  showOriginalPrice: boolean;
  showDiscountBadge: boolean;
  currencySymbol: string;
}

export interface GlobalPopupCountdownConfig {
  enabled: boolean;
  expiresAt: string | null;
  format: GlobalPopupCountdownFormat;
  label: string;
}

export interface GlobalPopupTargetingConfig {
  mode: GlobalPopupTargetingMode;
  selectedRoutes: string[];
  excludedRoutes: string[];
  showOnDesktop: boolean;
  showOnMobile: boolean;
  sessionFrequency: 'once_per_session';
}

export interface GlobalPopupLinkedProductSummary {
  id: string;
  name: string;
  slug: string;
  sku: string;
  imageUrl: string;
  basePrice: number;
  salePrice: number | null;
  currentPrice: number;
  originalPrice: number | null;
  discountPercent: number;
  availableStock: number;
  manageInventory: boolean;
  allowBackorder: boolean;
  hasVariants: boolean;
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    options: Record<string, string>;
    currentPrice: number;
    originalPrice: number | null;
    availableStock: number;
    imageUrl: string;
    isActive: boolean;
  }>;
  status: string;
}

export interface GlobalPopupAnalytics {
  impressions: number;
  clicks: number;
  ctr: number;
  lastImpressionAt: string | null;
  lastClickAt: string | null;
}

export interface GlobalPopupCampaign {
  id: string;
  name: string;
  slug: string;
  description: string;
  campaignType: GlobalPopupCampaignType;
  status: GlobalPopupStatus;
  effectiveStatus: GlobalPopupStatus;
  enabled: boolean;
  autoDisplay: boolean;
  priority: number;
  displayDelaySeconds: number;
  startAt: string | null;
  endAt: string | null;
  archived: boolean;
  targeting: GlobalPopupTargetingConfig;
  design: GlobalPopupDesignConfig;
  content: GlobalPopupContentConfig;
  media: GlobalPopupMediaConfig;
  features: GlobalPopupFeatureItem[];
  pricing: GlobalPopupPricingConfig;
  countdown: GlobalPopupCountdownConfig;
  benefits: GlobalPopupBenefitItem[];
  linkedProductId: string | null;
  linkedProduct: GlobalPopupLinkedProductSummary | null;
  analytics: GlobalPopupAnalytics;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalPopupPublicCampaign {
  id: string;
  name: string;
  slug: string;
  campaignType: GlobalPopupCampaignType;
  priority: number;
  displayDelaySeconds: number;
  startAt: string | null;
  endAt: string | null;
  targeting: GlobalPopupTargetingConfig;
  design: GlobalPopupDesignConfig;
  content: GlobalPopupContentConfig;
  media: GlobalPopupMediaConfig;
  features: GlobalPopupFeatureItem[];
  pricing: GlobalPopupPricingConfig;
  countdown: GlobalPopupCountdownConfig;
  benefits: GlobalPopupBenefitItem[];
  linkedProduct: GlobalPopupLinkedProductSummary | null;
}

export interface GlobalPopupKpiSummary {
  totalCampaigns: number;
  activeCampaigns: number;
  scheduledCampaigns: number;
  pausedCampaigns: number;
  expiredCampaigns: number;
  draftCampaigns: number;
  totalImpressions: number;
  totalClicks: number;
  clickThroughRate: number;
}

export const DEFAULT_EXCLUDED_ROUTES = [
  '/admin',
  '/checkout',
  '/order-success',
  '/checkout/success',
  '/login',
  '/signin',
  '/register',
  '/signup',
  '/forgot-password',
  '/verify-email',
  '/reset-password',
];

export const DEFAULT_POPUP_FEATURES: GlobalPopupFeatureItem[] = [
  { id: 'feat-1', icon: 'heart-pulse', title: 'Heart Rate Monitoring', description: '', visible: true, sortOrder: 0 },
  { id: 'feat-2', icon: 'activity', title: '100+ Sports Modes', description: '', visible: true, sortOrder: 1 },
  { id: 'feat-3', icon: 'droplets', title: '5ATM Waterproof', description: '', visible: true, sortOrder: 2 },
  { id: 'feat-4', icon: 'bell-ring', title: 'Smart Notifications', description: '', visible: true, sortOrder: 3 },
  { id: 'feat-5', icon: 'battery-charging', title: 'Up to 14 Days Battery Life', description: '', visible: true, sortOrder: 4 },
  { id: 'feat-6', icon: 'moon', title: 'Sleep Tracking', description: '', visible: true, sortOrder: 5 },
];

export const DEFAULT_POPUP_BENEFITS: GlobalPopupBenefitItem[] = [
  { id: 'ben-1', icon: 'shield-check', label: '1 Year Warranty', visible: true, sortOrder: 0 },
  { id: 'ben-2', icon: 'truck', label: 'Free Home Delivery', visible: true, sortOrder: 1 },
  { id: 'ben-3', icon: 'rotate-ccw', label: 'Easy 30 Days Return', visible: true, sortOrder: 2 },
  { id: 'ben-4', icon: 'headphones', label: '24/7 Customer Support', visible: true, sortOrder: 3 },
];

export const DEFAULT_POPUP_DESIGN: GlobalPopupDesignConfig = {
  primaryColor: '#145CFF',
  secondaryColor: '#0B3DC7',
  backgroundColor: '#FFFFFF',
  surfaceColor: '#F4F6FA',
  textColor: '#15213B',
  accentColor: '#FFE14D',
  gradientFrom: '#145CFF',
  gradientTo: '#0938B8',
  borderRadiusPx: 30,
  maxWidthPx: 1420,
  fontFamily: 'inter_jakarta',
  shadowStrength: 'dramatic',
  overlayOpacity: 0.58,
  backdropBlurPx: 10,
  animationStyle: 'scale_fade',
};

export interface GlobalPopupEditorInput {
  name: string;
  slug: string;
  description: string;
  campaignType: GlobalPopupCampaignType;
  status: GlobalPopupStatus;
  enabled: boolean;
  autoDisplay: boolean;
  priority: number;
  displayDelaySeconds: number;
  startAt: string | null;
  endAt: string | null;
  archived: boolean;
  targeting: GlobalPopupTargetingConfig;
  design: GlobalPopupDesignConfig;
  content: GlobalPopupContentConfig;
  media: GlobalPopupMediaConfig;
  features: GlobalPopupFeatureItem[];
  pricing: GlobalPopupPricingConfig;
  countdown: GlobalPopupCountdownConfig;
  benefits: GlobalPopupBenefitItem[];
  linkedProductId: string | null;
}

export function createDefaultGlobalPopupDraft(overrides?: Partial<GlobalPopupEditorInput>): GlobalPopupEditorInput {
  const defaultEndIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    name: 'Next-Gen Smart Watch Launch',
    slug: 'next-gen-smart-watch-launch',
    description: '',
    campaignType: 'product_launch',
    status: 'draft',
    enabled: true,
    autoDisplay: true,
    priority: 10,
    displayDelaySeconds: 20,
    startAt: null,
    endAt: defaultEndIso,
    archived: false,
    targeting: {
      mode: 'global',
      selectedRoutes: [],
      excludedRoutes: [...DEFAULT_EXCLUDED_ROUTES],
      showOnDesktop: true,
      showOnMobile: true,
      sessionFrequency: 'once_per_session',
    },
    design: { ...DEFAULT_POPUP_DESIGN },
    content: {
      offerBadgeText: 'Limited Time Offer',
      offerBadgeIcon: 'flame',
      showOfferBadge: true,
      tagline: 'SMARTER • HEALTHIER • STYLISH',
      mainHeading: 'Next-Gen',
      highlightedHeading: 'Smart Watch',
      description: 'Track your health, stay connected, and live smarter every day.',
      discountText: 'UP TO 50% OFF',
      discountPercent: 50,
      showDiscountBadge: true,
      ctaLabel: 'Add to Cart',
      ctaAction: 'add_to_cart',
      ctaDestination: '/shop',
    },
    media: {
      desktopImageUrl: '/src/assets/images/promo_smartwatch_1794832026084.jpg',
      desktopImagePublicId: '',
      mobileImageUrl: '',
      mobileImagePublicId: '',
      imageAlt: 'Next-Gen Smart Watch Showcase',
      imagePosition: 'center',
      imageFit: 'contain',
    },
    features: DEFAULT_POPUP_FEATURES.map((f) => ({ ...f })),
    pricing: {
      mode: 'product_auto',
      specialPrice: null,
      originalPriceOverride: null,
      showOriginalPrice: true,
      showDiscountBadge: true,
      currencySymbol: '৳',
    },
    countdown: {
      enabled: true,
      expiresAt: defaultEndIso,
      format: 'dhms',
      label: 'Offer Ends In:',
    },
    benefits: DEFAULT_POPUP_BENEFITS.map((b) => ({ ...b })),
    linkedProductId: null,
    ...overrides,
  };
}

export function slugifyCampaignName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export function sanitizePlainText(value: string, maxLen = 400): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function isUnsafeUrlScheme(raw: string): boolean {
  const normalized = raw.replace(/[\s\u0000-\u001F]+/g, '').toLowerCase();
  return (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('file:')
  );
}

export function sanitizeCtaDestination(
  rawUrl: string,
  action: GlobalPopupCtaAction,
): { valid: boolean; value: string; reason?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (action === 'add_to_cart' || action === 'view_product') {
    if (!trimmed) return { valid: true, value: '/shop' };
  }
  if (!trimmed) {
    return { valid: false, value: '', reason: 'CTA destination is required for page or link actions.' };
  }
  if (isUnsafeUrlScheme(trimmed)) {
    return { valid: false, value: '', reason: 'Unsafe URL scheme is not allowed.' };
  }
  if (action === 'internal_page') {
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return { valid: false, value: '', reason: 'Internal page destination must be a relative route starting with /.' };
    }
    return { valid: true, value: trimmed };
  }
  if (action === 'external_url') {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { valid: false, value: '', reason: 'External URL must use http:// or https://.' };
      }
      return { valid: true, value: parsed.toString() };
    } catch {
      return { valid: false, value: '', reason: 'External URL is invalid.' };
    }
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { valid: true, value: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return { valid: true, value: parsed.toString() };
    }
  } catch {
    // Fall through
  }
  return { valid: false, value: '', reason: 'Destination must be an internal path (/) or valid HTTP/HTTPS URL.' };
}

export function isSafeMediaUrl(url: string): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed) return true;
  if (isUnsafeUrlScheme(trimmed)) return false;
  if (trimmed.startsWith('/src/assets/') || trimmed.startsWith('/assets/')) return true;
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeRoutePath(pathname: string): string {
  const noQuery = String(pathname || '/').split('?')[0].split('#')[0].trim().toLowerCase();
  if (!noQuery || noQuery === '/') return '/';
  const collapsed = noQuery.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
}

function matchesRoutePattern(routePath: string, patternRaw: string): boolean {
  const normalizedRoute = normalizeRoutePath(routePath);
  const pattern = normalizeRoutePath(patternRaw);
  if (pattern === '/') return normalizedRoute === '/';
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return normalizedRoute === prefix || normalizedRoute.startsWith(`${prefix}/`);
  }
  return normalizedRoute === pattern || normalizedRoute.startsWith(`${pattern}/`);
}

export function isRouteEligible(
  pathname: string,
  targeting?: Partial<GlobalPopupTargetingConfig> | null,
): boolean {
  const normalizedPath = normalizeRoutePath(pathname);

  // Never allow customer promotional popups inside Admin dashboard
  if (normalizedPath === '/admin' || normalizedPath.startsWith('/admin/')) {
    return false;
  }

  const excluded = Array.isArray(targeting?.excludedRoutes) && targeting.excludedRoutes.length > 0
    ? targeting.excludedRoutes
    : DEFAULT_EXCLUDED_ROUTES;

  if (excluded.some((pattern) => Boolean(pattern?.trim()) && matchesRoutePattern(normalizedPath, pattern))) {
    return false;
  }

  if (targeting?.mode === 'selected') {
    const selected = Array.isArray(targeting.selectedRoutes) ? targeting.selectedRoutes.filter((r) => Boolean(r?.trim())) : [];
    if (selected.length === 0) return false;
    return selected.some((pattern) => matchesRoutePattern(normalizedPath, pattern));
  }

  return true;
}

export function detectDeviceKind(viewportWidth: number): GlobalPopupDeviceKind {
  if (viewportWidth < 768) return 'mobile';
  if (viewportWidth < 1024) return 'tablet';
  return 'desktop';
}

export function isDeviceEligible(
  deviceKind: GlobalPopupDeviceKind,
  targeting?: Partial<GlobalPopupTargetingConfig> | null,
): boolean {
  if (deviceKind === 'mobile') {
    return targeting?.showOnMobile !== false;
  }
  return targeting?.showOnDesktop !== false;
}

export interface CampaignEligibilityCandidate {
  id: string;
  status: GlobalPopupStatus;
  enabled: boolean;
  autoDisplay?: boolean;
  archived?: boolean;
  priority: number;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  targeting?: Partial<GlobalPopupTargetingConfig> | null;
  updatedAt?: string | Date | null;
}

export function computeEffectiveCampaignStatus(
  campaign: Pick<CampaignEligibilityCandidate, 'status' | 'enabled' | 'archived' | 'startAt' | 'endAt'>,
  now: Date = new Date(),
): GlobalPopupStatus {
  if (campaign.archived) return 'paused';
  if (campaign.status === 'draft') return 'draft';
  if (campaign.status === 'paused' || !campaign.enabled) return 'paused';

  const nowMs = now.getTime();
  if (campaign.endAt) {
    const endMs = new Date(campaign.endAt).getTime();
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return 'expired';
    }
  }
  if (campaign.startAt) {
    const startMs = new Date(campaign.startAt).getTime();
    if (!Number.isNaN(startMs) && nowMs < startMs) {
      return 'scheduled';
    }
  }
  return 'active';
}

export function isCampaignCurrentlyEligible(
  campaign: CampaignEligibilityCandidate,
  context: {
    now?: Date;
    pathname?: string;
    deviceKind?: GlobalPopupDeviceKind;
    requireAutoDisplay?: boolean;
  } = {},
): boolean {
  const now = context.now ?? new Date();
  if (campaign.archived) return false;
  if (!campaign.enabled) return false;
  if (context.requireAutoDisplay && campaign.autoDisplay === false) return false;

  const effectiveStatus = computeEffectiveCampaignStatus(campaign, now);
  if (effectiveStatus !== 'active') return false;

  if (context.pathname !== undefined && !isRouteEligible(context.pathname, campaign.targeting)) {
    return false;
  }
  if (context.deviceKind !== undefined && !isDeviceEligible(context.deviceKind, campaign.targeting)) {
    return false;
  }
  return true;
}

/**
 * Deterministic selection:
 * 1. Eligible only
 * 2. Higher priority wins
 * 3. More recently updated wins tie-break
 * 4. Lexicographically smaller ID breaks remaining ties deterministically
 */
export function pickWinningCampaign<T extends CampaignEligibilityCandidate>(
  campaigns: T[],
  context: {
    now?: Date;
    pathname?: string;
    deviceKind?: GlobalPopupDeviceKind;
    requireAutoDisplay?: boolean;
  } = {},
): T | null {
  const eligible = campaigns.filter((c) => isCampaignCurrentlyEligible(c, context));
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    const updatedDiff = bUpdated - aUpdated;
    if (updatedDiff !== 0) return updatedDiff;

    return String(a.id).localeCompare(String(b.id));
  });

  return eligible[0];
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  totalMs: number;
}

export function calculateCountdownParts(
  expiresAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): CountdownParts {
  if (!expiresAt) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, totalMs: 0 };
  }
  const targetMs = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(targetMs)) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, totalMs: 0 };
  }
  const diffMs = Math.max(0, targetMs - nowMs);
  if (diffMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, totalMs: 0 };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, isExpired: false, totalMs: diffMs };
}

export interface ResolvedCampaignPricing {
  originalPrice: number | null;
  promoPrice: number | null;
  savingsAmount: number;
  savingsPercent: number;
  currencySymbol: string;
  hasPriceBlock: boolean;
}

export function resolveCampaignPricingDisplay(
  pricing: Partial<GlobalPopupPricingConfig> | null | undefined,
  linkedProduct: GlobalPopupLinkedProductSummary | null | undefined,
): ResolvedCampaignPricing {
  const currencySymbol = pricing?.currencySymbol?.trim() || '৳';
  const mode = pricing?.mode || 'product_auto';

  let promoPrice: number | null = null;
  let originalPrice: number | null = null;

  if (mode === 'campaign_special' && pricing?.specialPrice != null && pricing.specialPrice > 0) {
    promoPrice = Math.round(Number(pricing.specialPrice));
    const candidateOrig =
      pricing.originalPriceOverride != null && pricing.originalPriceOverride > 0
        ? Math.round(Number(pricing.originalPriceOverride))
        : linkedProduct
          ? Math.round(Number(linkedProduct.originalPrice ?? linkedProduct.basePrice ?? 0))
          : null;
    originalPrice = candidateOrig && candidateOrig > promoPrice ? candidateOrig : null;
  } else if (linkedProduct) {
    promoPrice = Math.round(Number(linkedProduct.currentPrice || linkedProduct.basePrice || 0));
    const candidateOrig =
      pricing?.originalPriceOverride != null && pricing.originalPriceOverride > 0
        ? Math.round(Number(pricing.originalPriceOverride))
        : linkedProduct.originalPrice != null
          ? Math.round(Number(linkedProduct.originalPrice))
          : linkedProduct.basePrice > promoPrice
            ? Math.round(Number(linkedProduct.basePrice))
            : null;
    originalPrice = candidateOrig && candidateOrig > promoPrice ? candidateOrig : null;
  } else if (pricing?.specialPrice != null && pricing.specialPrice > 0) {
    promoPrice = Math.round(Number(pricing.specialPrice));
    const candidateOrig =
      pricing.originalPriceOverride != null && pricing.originalPriceOverride > promoPrice
        ? Math.round(Number(pricing.originalPriceOverride))
        : null;
    originalPrice = candidateOrig;
  }

  const savingsAmount =
    promoPrice != null && originalPrice != null && originalPrice > promoPrice
      ? originalPrice - promoPrice
      : 0;
  const savingsPercent =
    savingsAmount > 0 && originalPrice != null && originalPrice > 0
      ? Math.round((savingsAmount / originalPrice) * 100)
      : 0;

  return {
    originalPrice: pricing?.showOriginalPrice === false ? null : originalPrice,
    promoPrice,
    savingsAmount,
    savingsPercent,
    currencySymbol,
    hasPriceBlock: promoPrice != null && promoPrice > 0,
  };
}

export function calculateCtrPercent(clicks: number, impressions: number): number {
  const safeClicks = Math.max(0, Number(clicks) || 0);
  const safeImpressions = Math.max(0, Number(impressions) || 0);
  if (safeImpressions <= 0) return 0;
  return Number(((safeClicks / safeImpressions) * 100).toFixed(2));
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getCampaignSessionKey(campaignId: string, kind: 'shown' | 'dismissed'): string {
  return `novara_gpp_${kind}:${campaignId}`;
}

export function hasCampaignSessionFlag(
  campaignId: string,
  kind: 'shown' | 'dismissed',
  storage?: StorageLike | null,
): boolean {
  if (!campaignId) return false;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!target) return false;
    return target.getItem(getCampaignSessionKey(campaignId, kind)) === '1';
  } catch {
    return false;
  }
}

export function setCampaignSessionFlag(
  campaignId: string,
  kind: 'shown' | 'dismissed',
  storage?: StorageLike | null,
): void {
  if (!campaignId) return;
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!target) return;
    target.setItem(getCampaignSessionKey(campaignId, kind), '1');
  } catch {
    // Fail gracefully if sessionStorage is unavailable or disabled
  }
}

export function formatDiscountBadgeLines(
  discountText: string,
  discountPercent: number | null | undefined,
): { topLabel: string; percentText: string; bottomLabel: string } {
  const cleaned = sanitizePlainText(discountText || '', 40);
  const pctNum = discountPercent != null && Number.isFinite(discountPercent) && discountPercent > 0
    ? Math.round(discountPercent)
    : null;

  if (pctNum !== null) {
    const upper = cleaned.toUpperCase();
    const topLabel = upper.includes('UP TO') ? 'UP TO' : upper.includes('SAVE') ? 'SAVE' : 'UP TO';
    const bottomLabel = upper.includes('OFF') ? 'OFF' : 'OFF';
    return {
      topLabel,
      percentText: `${pctNum}%`,
      bottomLabel,
    };
  }

  const pctMatch = cleaned.match(/^(.+?)\s*(\d+%)\s*(.*)$/i);
  if (pctMatch) {
    return {
      topLabel: pctMatch[1].trim() || 'SAVE',
      percentText: pctMatch[2].trim(),
      bottomLabel: pctMatch[3].trim() || 'OFF',
    };
  }

  return {
    topLabel: 'SPECIAL',
    percentText: cleaned || 'OFFER',
    bottomLabel: 'DEAL',
  };
}
