import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ExternalLink, Eye, Loader2, ShoppingCart, X } from 'lucide-react';
import {
  calculateCountdownParts,
  formatDiscountBadgeLines,
  resolveCampaignPricingDisplay,
  sanitizeCtaDestination,
  type GlobalPopupPublicCampaign,
} from '../../lib/globalPromotionalPopup';
import { formatStoreCurrency } from '../../lib/dateTime';
import { ResilientImage } from '../ui/ResilientImage';
import { renderPopupIcon } from './popupIcons';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { addToCartAsync, openCartDrawer } from '../../features/cart/cartSlice';
import { showToast } from '../../features/notifications/toastSlice';

export interface GlobalPromotionalPopupModalProps {
  campaign: GlobalPopupPublicCampaign;
  open: boolean;
  onClose: () => void;
  mode?: 'live' | 'preview';
  previewInline?: boolean;
  previewViewport?: 'desktop' | 'tablet' | 'mobile';
  serverNow?: string | null;
  onTrackClick?: (campaignId: string) => void;
}

const IMAGE_POSITION_CLASSES: Record<string, string> = {
  center: 'object-center',
  top: 'object-top',
  bottom: 'object-bottom',
  left: 'object-left',
  right: 'object-right',
};

const FONT_FAMILY_STYLE: Record<string, string> = {
  inter_jakarta: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
  jakarta: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  system: 'system-ui, -apple-system, sans-serif',
};

const SHADOW_BOX: Record<string, string> = {
  soft: '0 20px 45px -16px rgba(15, 29, 58, 0.22)',
  medium: '0 28px 65px -14px rgba(10, 26, 62, 0.34)',
  dramatic: '0 36px 90px -12px rgba(7, 22, 58, 0.48), 0 0 0 1px rgba(255,255,255,0.22)',
};

function padTwo(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function GlobalPromotionalPopupModal({
  campaign,
  open,
  onClose,
  mode = 'live',
  previewInline = false,
  previewViewport = 'desktop',
  serverNow,
  onTrackClick,
}: GlobalPromotionalPopupModalProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((s) => s.auth);
  const currencyCfg = useAppSelector((s) => s.storefront.settings?.currencySettings);
  const headingId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Synchronize countdown against server clock offset when available
  const serverOffsetMs = useMemo(() => {
    if (!serverNow) return 0;
    const parsed = Date.parse(serverNow);
    return Number.isNaN(parsed) ? 0 : parsed - Date.now();
  }, [serverNow]);

  const targetExpiry = campaign.countdown.expiresAt || campaign.endAt;
  const [nowMs, setNowMs] = useState<number>(() => Date.now() + serverOffsetMs);
  const [addingToCart, setAddingToCart] = useState(false);

  const activeVariants = useMemo(
    () => (campaign.linkedProduct?.variants || []).filter((v) => v.isActive !== false),
    [campaign.linkedProduct],
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    const firstInStock = activeVariants.find((v) => v.availableStock > 0);
    return firstInStock?.id || activeVariants[0]?.id || null;
  });

  useEffect(() => {
    if (activeVariants.length === 0) {
      setSelectedVariantId(null);
      return;
    }
    const stillValid = activeVariants.some((v) => v.id === selectedVariantId);
    if (!stillValid) {
      const firstInStock = activeVariants.find((v) => v.availableStock > 0);
      setSelectedVariantId(firstInStock?.id || activeVariants[0]?.id || null);
    }
  }, [activeVariants, selectedVariantId]);

  useEffect(() => {
    if (!open || !campaign.countdown.enabled || !targetExpiry) return;
    setNowMs(Date.now() + serverOffsetMs);
    const interval = window.setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [open, campaign.countdown.enabled, targetExpiry, serverOffsetMs]);

  // Scroll locking, Escape key, and focus management (only when rendered as overlay dialog)
  useEffect(() => {
    if (!open || previewInline) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      prevFocusRef.current?.focus?.();
    };
  }, [open, previewInline]);

  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    if (previewInline || typeof window === 'undefined') return;
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [previewInline]);

  if (!open) return null;

  const design = campaign.design;
  const content = campaign.content;
  const media = campaign.media;

  const isForcedMobile = previewInline && previewViewport === 'mobile';
  const isForcedTablet = previewInline && previewViewport === 'tablet';
  const useMobileAsset = isForcedMobile || (!previewInline && isMobileViewport);
  const showcaseImageUrl =
    (useMobileAsset && media.mobileImageUrl ? media.mobileImageUrl : media.desktopImageUrl) ||
    campaign.linkedProduct?.imageUrl ||
    '';

  const visibleFeatures = [...(campaign.features || [])]
    .filter((f) => f.visible !== false && f.title?.trim())
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));

  const visibleBenefits = [...(campaign.benefits || [])]
    .filter((b) => b.visible !== false && b.label?.trim())
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));

  const selectedVariant = selectedVariantId
    ? activeVariants.find((v) => v.id === selectedVariantId) || null
    : null;

  const pricingDisplay = resolveCampaignPricingDisplay(campaign.pricing, campaign.linkedProduct);
  const currencySymbol = campaign.pricing.currencySymbol || currencyCfg?.symbol || '৳';
  const activeCurrencyFmt = { symbol: currencySymbol, position: currencyCfg?.position || 'prefix' };

  const countdown = calculateCountdownParts(targetExpiry, nowMs);
  const badgeLines = formatDiscountBadgeLines(content.discountText, content.discountPercent);
  const showDiscountCircle =
    content.showDiscountBadge !== false && campaign.pricing.showDiscountBadge !== false;

  const linkedProd = campaign.linkedProduct;
  const unlimitedOrBackorder = linkedProd
    ? linkedProd.manageInventory === false || linkedProd.allowBackorder
    : false;
  const effectiveStock = selectedVariant
    ? unlimitedOrBackorder
      ? Math.max(selectedVariant.availableStock, 99)
      : selectedVariant.availableStock
    : linkedProd
      ? unlimitedOrBackorder
        ? Math.max(linkedProd.availableStock, 99)
        : linkedProd.availableStock
      : 0;
  const isProductOutOfStock =
    content.ctaAction === 'add_to_cart' && Boolean(linkedProd) && !unlimitedOrBackorder && effectiveStock <= 0;

  const ctaSanitized = sanitizeCtaDestination(content.ctaDestination, content.ctaAction);

  const handleCtaClick = async () => {
    if (mode === 'preview') {
      dispatch(
        showToast({
          variant: 'info',
          message: `Preview CTA triggered (${content.ctaAction.replace(/_/g, ' ')}) — no cart mutation or analytics recorded.`,
        }),
      );
      return;
    }

    onTrackClick?.(campaign.id);

    if (content.ctaAction === 'add_to_cart') {
      if (!linkedProd) {
        dispatch(showToast({ variant: 'error', message: 'Promotional product is currently unavailable.' }));
        return;
      }
      if (isProductOutOfStock) {
        dispatch(showToast({ variant: 'warning', message: 'This promotional item is currently out of stock.' }));
        return;
      }
      if (linkedProd.hasVariants && !selectedVariant) {
        dispatch(showToast({ variant: 'warning', message: 'Please choose an option before adding to cart.' }));
        return;
      }

      setAddingToCart(true);
      try {
        const unitPrice =
          campaign.pricing.mode === 'campaign_special' && pricingDisplay.promoPrice
            ? pricingDisplay.promoPrice
            : selectedVariant?.currentPrice ?? linkedProd.currentPrice;

        const res = await dispatch(
          addToCartAsync({
            isAuthenticated: Boolean(user),
            mode: 'idempotent',
            item: {
              productId: linkedProd.id,
              variantId: selectedVariant?.id ?? null,
              slug: linkedProd.slug,
              name: linkedProd.name,
              shortDescription: content.description || '',
              sku: selectedVariant?.sku || linkedProd.sku,
              variantTitle: selectedVariant?.title || null,
              imageUrl: selectedVariant?.imageUrl || linkedProd.imageUrl || showcaseImageUrl,
              unitPrice,
              originalPrice: pricingDisplay.originalPrice,
              discountPercent: pricingDisplay.savingsPercent || linkedProd.discountPercent,
              quantity: 1,
              availableStock: effectiveStock,
              isAvailable: true,
              selected: true,
            },
          }),
        );

        if (addToCartAsync.fulfilled.match(res)) {
          dispatch(
            showToast({
              variant: 'success',
              message: `${linkedProd.name} added to your cart!`,
            }),
          );
          onClose();
          dispatch(openCartDrawer());
        } else {
          dispatch(
            showToast({
              variant: 'error',
              message: String(res.payload || 'Unable to add promotional product to cart.'),
            }),
          );
        }
      } finally {
        setAddingToCart(false);
      }
      return;
    }

    if (content.ctaAction === 'view_product' && linkedProd) {
      onClose();
      navigate(`/product/${linkedProd.slug}`);
      return;
    }

    if (content.ctaAction === 'internal_page' && ctaSanitized.valid) {
      onClose();
      navigate(ctaSanitized.value);
    }
  };

  const animClass =
    design.animationStyle === 'none'
      ? ''
      : design.animationStyle === 'slide_up'
        ? 'animate-[gppSlideUp_340ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none'
        : design.animationStyle === 'zoom_spring'
          ? 'animate-[gppZoomSpring_380ms_cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:animate-none'
          : 'animate-[gppScaleFade_320ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none';

  const cardWidthClass = previewInline
    ? isForcedMobile
      ? 'w-full max-w-[380px]'
      : isForcedTablet
        ? 'w-full max-w-[740px]'
        : 'w-full'
    : 'w-[94vw] md:w-[95vw]';

  const modalContent = (
    <div
      ref={panelRef}
      role={previewInline ? 'region' : 'dialog'}
      aria-modal={previewInline ? undefined : true}
      aria-labelledby={headingId}
      aria-describedby={content.description ? descId : undefined}
      style={{
        maxWidth: previewInline ? undefined : `${Math.min(1600, Math.max(640, design.maxWidthPx || 1420))}px`,
        borderRadius: `${Math.min(48, Math.max(8, design.borderRadiusPx || 30))}px`,
        backgroundColor: design.backgroundColor || '#FFFFFF',
        color: design.textColor || '#15213B',
        fontFamily: FONT_FAMILY_STYLE[design.fontFamily || 'inter_jakarta'],
        boxShadow: SHADOW_BOX[design.shadowStrength || 'dramatic'],
      }}
      className={`relative mx-auto overflow-hidden border border-blue-100/80 transition-all ${cardWidthClass} ${animClass} ${
        previewInline ? '' : 'max-h-[92dvh] overflow-y-auto'
      }`}
    >
      {/* Decorative Ambient Background Gradients */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-20 blur-3xl"
        style={{
          background: `radial-gradient(circle, ${design.gradientFrom || '#145CFF'} 0%, transparent 70%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full opacity-15 blur-3xl"
        style={{
          background: `radial-gradient(circle, ${design.primaryColor || '#145CFF'} 0%, transparent 70%)`,
        }}
      />

      {/* Close Button */}
      <button
        ref={closeBtnRef}
        type="button"
        onClick={onClose}
        aria-label="Close promotional popup"
        className="absolute right-3.5 top-3.5 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 text-[#15213B] shadow-md backdrop-blur-xs transition-all hover:scale-105 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145CFF] sm:right-5 sm:top-5 sm:h-10 sm:w-10"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Main Content Body */}
      <div
        className={`relative z-10 ${
          isForcedMobile
            ? 'px-5 pb-5 pt-6'
            : isForcedTablet
              ? 'px-6 pb-6 pt-7'
              : 'px-5 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-7 lg:px-10 lg:pb-7 lg:pt-8'
        }`}
      >
        {/* Two-Column Upper Showcase Grid */}
        <div
          className={`grid items-center gap-6 ${
            isForcedMobile
              ? 'grid-cols-1'
              : isForcedTablet
                ? 'grid-cols-12 gap-5'
                : 'grid-cols-1 md:grid-cols-12 md:gap-7 lg:gap-8'
          }`}
        >
          {/* LEFT COLUMN: Offer Badge, Headings, Description, 2x3 Feature Grid */}
          <div
            className={
              isForcedMobile
                ? 'order-2 space-y-4'
                : isForcedTablet
                  ? 'col-span-7 space-y-4'
                  : 'order-2 space-y-4 md:order-1 md:col-span-7 lg:space-y-5'
            }
          >
            {/* Top-Left Offer Badge */}
            {content.showOfferBadge !== false && content.offerBadgeText && (
              <div>
                <span
                  style={{
                    background: `linear-gradient(135deg, ${design.gradientFrom || '#145CFF'} 0%, ${
                      design.gradientTo || '#0938B8'
                    } 100%)`,
                  }}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wide text-white shadow-md shadow-blue-600/25 sm:text-[13px]"
                >
                  <span className="flex h-4 w-4 items-center justify-center text-[#FFE14D]">
                    {renderPopupIcon(content.offerBadgeIcon || 'flame', 'h-4 w-4')}
                  </span>
                  <span>{content.offerBadgeText}</span>
                </span>
              </div>
            )}

            {/* Tagline & Two-Line Headline */}
            <div className="space-y-2">
              {content.tagline && (
                <p
                  style={{ color: design.primaryColor || '#145CFF' }}
                  className="text-[11px] font-bold uppercase tracking-[0.22em] sm:text-xs"
                >
                  {content.tagline}
                </p>
              )}

              <h2
                id={headingId}
                className={`font-extrabold tracking-tight leading-[1.06] ${
                  isForcedMobile
                    ? 'text-2xl'
                    : isForcedTablet
                      ? 'text-3xl'
                      : 'text-3xl sm:text-4xl lg:text-[44px]'
                }`}
              >
                <span className="block" style={{ color: design.textColor || '#15213B' }}>
                  {content.mainHeading}
                </span>
                {content.highlightedHeading && (
                  <span className="block" style={{ color: design.primaryColor || '#145CFF' }}>
                    {content.highlightedHeading}
                  </span>
                )}
              </h2>

              {content.description && (
                <p
                  id={descId}
                  className="max-w-xl text-sm leading-relaxed text-slate-600 sm:text-[15px]"
                >
                  {content.description}
                </p>
              )}
            </div>

            {/* 6-Item 2x3 Product Feature Grid */}
            {visibleFeatures.length > 0 && (
              <div
                className={`grid gap-2.5 pt-1 ${
                  isForcedMobile
                    ? 'grid-cols-1'
                    : 'grid-cols-1 sm:grid-cols-2'
                }`}
              >
                {visibleFeatures.map((feat) => (
                  <div
                    key={feat.id}
                    style={{ backgroundColor: design.surfaceColor || '#F4F6FA' }}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200/70 px-3.5 py-2.5 transition-colors hover:border-blue-200"
                  >
                    <span
                      style={{ color: design.primaryColor || '#145CFF' }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E6EEFF] shadow-xs"
                    >
                      {renderPopupIcon(feat.icon, 'h-4 w-4')}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold leading-snug text-[#15213B]">
                        {feat.title}
                      </div>
                      {feat.description && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                          {feat.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Commercial Product Showcase + Scalloped Discount Badge */}
          <div
            className={`relative flex items-center justify-center ${
              isForcedMobile
                ? 'order-1 min-h-[210px] pt-7'
                : isForcedTablet
                  ? 'col-span-5 min-h-[260px]'
                  : 'order-1 mt-6 min-h-[220px] sm:min-h-[270px] md:order-2 md:col-span-5 md:mt-0 md:min-h-[320px] lg:min-h-[350px]'
            }`}
          >
            {/* Blue Circular Geometric Backdrop + Glossy Pedestal */}
            <div className="relative flex h-full w-full items-center justify-center">
              <div
                aria-hidden="true"
                style={{
                  background: `radial-gradient(circle at 45% 40%, ${design.primaryColor || '#145CFF'}24 0%, ${
                    design.primaryColor || '#145CFF'
                  }0D 58%, transparent 74%)`,
                }}
                className="absolute aspect-square w-[86%] max-w-[400px] rounded-full border border-blue-200/70"
              />
              <div
                aria-hidden="true"
                style={{
                  borderColor: `${design.primaryColor || '#145CFF'}25`,
                }}
                className="pointer-events-none absolute aspect-square w-[70%] max-w-[330px] rounded-full border-2 border-dashed"
              />

              {/* Glossy Blue-and-White Pedestal Reflection */}
              <div
                aria-hidden="true"
                style={{
                  background: `linear-gradient(180deg, rgba(255,255,255,0.92) 0%, ${
                    design.primaryColor || '#145CFF'
                  }24 100%)`,
                }}
                className="pointer-events-none absolute bottom-3 h-8 w-[76%] max-w-[320px] rounded-[100%] border border-blue-200/70 shadow-lg shadow-blue-500/15"
              />

              {/* Product Visual */}
              <div
                className={`relative z-10 flex items-center justify-center overflow-hidden ${
                  isForcedMobile
                    ? 'h-[190px] w-[230px]'
                    : isForcedTablet
                      ? 'h-[240px] w-[250px]'
                      : 'h-[200px] w-[240px] sm:h-[250px] sm:w-[290px] md:h-[270px] md:w-[290px] lg:h-[320px] lg:w-[360px]'
                }`}
              >
                <ResilientImage
                  src={showcaseImageUrl}
                  alt={media.imageAlt || content.mainHeading}
                  loading="eager"
                  className={`h-full w-full drop-shadow-[0_24px_32px_rgba(12,35,96,0.24)] transition-transform duration-300 ${
                    media.imageFit === 'cover' ? 'object-cover rounded-3xl' : 'object-contain'
                  } ${IMAGE_POSITION_CLASSES[media.imagePosition || 'center'] || 'object-center'}`}
                  fallbackClassName="flex h-full w-full items-center justify-center rounded-3xl bg-blue-50/70 text-[#145CFF]"
                />
              </div>

              {/* Upper-Right Circular / Scalloped Discount Badge */}
              {showDiscountCircle && (
                <div
                  aria-label={`${badgeLines.topLabel} ${badgeLines.percentText} ${badgeLines.bottomLabel}`}
                  style={{
                    background: `linear-gradient(145deg, ${design.gradientFrom || '#145CFF'} 0%, ${
                      design.gradientTo || '#0938B8'
                    } 100%)`,
                    boxShadow: `0 16px 34px -6px ${design.primaryColor || '#145CFF'}80`,
                  }}
                  className={`absolute z-20 flex flex-col items-center justify-center rounded-full border-4 border-white/95 text-center ring-2 ring-blue-300/60 ${
                    isForcedMobile
                      ? 'right-2 top-2 h-20 w-20'
                      : 'right-2 top-2 h-22 w-22 md:right-2 md:top-3 lg:right-3 lg:top-2 lg:h-26 lg:w-26'
                  }`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/95 sm:text-[10px]">
                    {badgeLines.topLabel}
                  </span>
                  <span
                    style={{ color: design.accentColor || '#FFE14D' }}
                    className="font-mono-tabular text-xl font-black leading-none sm:text-2xl"
                  >
                    {badgeLines.percentText}
                  </span>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-white sm:text-[11px]">
                    {badgeLines.bottomLabel}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* HORIZONTAL BOTTOM OFFER, COUNTDOWN & PRICING BAR */}
        <div
          style={{ backgroundColor: design.surfaceColor || '#F4F6FA' }}
          className={`mt-5 flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/85 p-4 shadow-inner sm:p-5 ${
            isForcedMobile ? '' : 'md:flex-row md:flex-wrap md:items-center'
          }`}
        >
          {/* Countdown Timer */}
          {campaign.countdown.enabled && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#15213B]">
                {campaign.countdown.label || 'Offer Ends In:'}
              </span>
              <div className="flex items-center gap-1.5 sm:gap-2" aria-live="off">
                {campaign.countdown.format === 'dhms' && (
                  <CountdownUnitBlock
                    value={padTwo(countdown.days)}
                    label="Days"
                    primaryColor={design.primaryColor}
                  />
                )}
                <CountdownUnitBlock
                  value={padTwo(
                    campaign.countdown.format === 'dhms'
                      ? countdown.hours
                      : countdown.days * 24 + countdown.hours,
                  )}
                  label="Hours"
                  primaryColor={design.primaryColor}
                />
                <CountdownUnitBlock
                  value={padTwo(countdown.minutes)}
                  label="Mins"
                  primaryColor={design.primaryColor}
                />
                <CountdownUnitBlock
                  value={padTwo(countdown.seconds)}
                  label="Secs"
                  primaryColor={design.primaryColor}
                />
              </div>
              {countdown.isExpired && (
                <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                  Ended
                </span>
              )}
            </div>
          )}

          {/* Dynamic Pricing & Variant + Gradient CTA Button */}
          <div
            className={`flex flex-col gap-3 ${
              isForcedMobile ? '' : 'sm:flex-row sm:items-center sm:justify-end sm:gap-5 lg:ml-auto'
            }`}
          >
            {pricingDisplay.hasPriceBlock && (
              <div className="flex flex-wrap items-baseline gap-2.5 sm:justify-end">
                {pricingDisplay.originalPrice != null && (
                  <div className="flex flex-col">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Original Price
                    </span>
                    <span className="font-mono-tabular text-sm font-semibold text-slate-400 line-through sm:text-base">
                      {formatStoreCurrency(pricingDisplay.originalPrice, activeCurrencyFmt)}
                    </span>
                  </div>
                )}

                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Offer Price
                  </span>
                  <span
                    style={{ color: design.primaryColor || '#145CFF' }}
                    className="font-mono-tabular text-2xl font-black tracking-tight sm:text-[28px]"
                  >
                    {formatStoreCurrency(pricingDisplay.promoPrice || 0, activeCurrencyFmt)}
                  </span>
                </div>

                {pricingDisplay.savingsAmount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-800">
                    Save {formatStoreCurrency(pricingDisplay.savingsAmount, activeCurrencyFmt)}
                  </span>
                )}
              </div>
            )}

            {/* Variant Selector (when linked product has active variants & CTA adds to cart) */}
            {content.ctaAction === 'add_to_cart' && activeVariants.length > 0 && (
              <div className="min-w-[135px]">
                <label className="sr-only" htmlFor={`${headingId}-variant`}>
                  Select product variant
                </label>
                <select
                  id={`${headingId}-variant`}
                  value={selectedVariantId || ''}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#15213B] focus:border-[#145CFF] focus:outline-none"
                >
                  {activeVariants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.availableStock <= 0 && !unlimitedOrBackorder}>
                      {v.title} {v.availableStock <= 0 && !unlimitedOrBackorder ? '(Out of Stock)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* CTA Action Control */}
            {content.ctaAction === 'external_url' && mode === 'live' && ctaSanitized.valid ? (
              <a
                href={ctaSanitized.value}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onTrackClick?.(campaign.id)}
                style={{
                  background: `linear-gradient(135deg, ${design.gradientFrom || '#145CFF'} 0%, ${
                    design.gradientTo || '#0938B8'
                  } 100%)`,
                }}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition-all hover:brightness-110 active:scale-[0.98] sm:px-7 sm:text-[15px]"
              >
                <span>{content.ctaLabel}</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <button
                type="button"
                disabled={addingToCart || isProductOutOfStock}
                onClick={handleCtaClick}
                style={{
                  background: isProductOutOfStock
                    ? '#94A3B8'
                    : `linear-gradient(135deg, ${design.gradientFrom || '#145CFF'} 0%, ${
                        design.gradientTo || '#0938B8'
                      } 100%)`,
                }}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 text-sm font-bold text-white shadow-lg shadow-blue-600/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 sm:px-7 sm:text-[15px]"
              >
                {addingToCart ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : content.ctaAction === 'add_to_cart' ? (
                  <ShoppingCart className="h-4 w-4" />
                ) : content.ctaAction === 'view_product' ? (
                  <Eye className="h-4 w-4" />
                ) : null}
                <span>
                  {addingToCart
                    ? 'Adding...'
                    : isProductOutOfStock
                      ? 'Out of Stock'
                      : content.ctaLabel || 'Add to Cart'}
                </span>
                {!addingToCart && !isProductOutOfStock && <ArrowRight className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {/* BOTTOM SERVICE BENEFITS STRIP */}
        {visibleBenefits.length > 0 && (
          <div
            className={`mt-4 rounded-2xl border border-blue-100 bg-[#EDF3FF]/90 px-3 py-3 ${
              isForcedMobile
                ? 'grid grid-cols-2 gap-2.5'
                : 'grid grid-cols-2 gap-3 md:flex md:items-center md:justify-between md:divide-x md:divide-blue-200/80'
            }`}
          >
            {visibleBenefits.map((benefit) => (
              <div
                key={benefit.id}
                className="flex flex-1 items-center justify-center gap-2 px-2 py-0.5 text-center"
              >
                <span style={{ color: design.primaryColor || '#145CFF' }} className="shrink-0">
                  {renderPopupIcon(benefit.icon, 'h-4 w-4')}
                </span>
                <span className="text-xs font-bold text-[#15213B] sm:text-[13px]">{benefit.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (previewInline) {
    return modalContent;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4"
      style={{
        backgroundColor: `rgba(7, 17, 42, ${Math.min(0.9, Math.max(0.1, design.overlayOpacity ?? 0.58))})`,
        backdropFilter: `blur(${Math.min(32, Math.max(0, design.backdropBlurPx ?? 10))}px)`,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <style>{`
        @keyframes gppScaleFade {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes gppSlideUp {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes gppZoomSpring {
          0% { opacity: 0; transform: scale(0.88); }
          70% { opacity: 1; transform: scale(1.015); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {modalContent}
    </div>,
    document.body,
  );
}

function CountdownUnitBlock({
  value,
  label,
  primaryColor,
}: {
  value: string;
  label: string;
  primaryColor?: string;
}) {
  return (
    <div className="flex min-w-[44px] flex-col items-center rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-xs sm:min-w-[52px]">
      <span
        style={{ color: primaryColor || '#145CFF' }}
        className="font-mono-tabular text-sm font-black leading-none sm:text-base"
      >
        {value}
      </span>
      <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
    </div>
  );
}
