import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCountdownParts,
  calculateCtrPercent,
  computeEffectiveCampaignStatus,
  DEFAULT_EXCLUDED_ROUTES,
  formatDiscountBadgeLines,
  hasCampaignSessionFlag,
  isCampaignCurrentlyEligible,
  isDeviceEligible,
  isRouteEligible,
  isSafeMediaUrl,
  pickWinningCampaign,
  resolveCampaignPricingDisplay,
  sanitizeCtaDestination,
  setCampaignSessionFlag,
  type CampaignEligibilityCandidate,
  type GlobalPopupLinkedProductSummary,
} from './globalPromotionalPopup';
import { resolveEffectiveUnitPrice } from './pricingEngine';

describe('globalPromotionalPopup domain logic', () => {
  it('computes effective status across draft, paused, scheduled, expired, and active', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    assert.equal(
      computeEffectiveCampaignStatus({ status: 'draft', enabled: true, startAt: null, endAt: null }, now),
      'draft',
    );
    assert.equal(
      computeEffectiveCampaignStatus({ status: 'active', enabled: false, startAt: null, endAt: null }, now),
      'paused',
    );
    assert.equal(
      computeEffectiveCampaignStatus(
        { status: 'active', enabled: true, startAt: '2026-11-26T00:00:00Z', endAt: null },
        now,
      ),
      'scheduled',
    );
    assert.equal(
      computeEffectiveCampaignStatus(
        { status: 'active', enabled: true, startAt: '2026-11-20T00:00:00Z', endAt: '2026-11-24T23:59:59Z' },
        now,
      ),
      'expired',
    );
    assert.equal(
      computeEffectiveCampaignStatus(
        { status: 'active', enabled: true, startAt: '2026-11-20T00:00:00Z', endAt: '2026-11-30T00:00:00Z' },
        now,
      ),
      'active',
    );
  });

  it('picks deterministic winning eligible campaign by priority, updatedAt, and id', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    const candidates: CampaignEligibilityCandidate[] = [
      {
        id: 'c-expired',
        status: 'active',
        enabled: true,
        priority: 100,
        endAt: '2026-11-24T00:00:00Z',
        updatedAt: '2026-11-25T11:00:00Z',
      },
      {
        id: 'c-paused',
        status: 'paused',
        enabled: false,
        priority: 99,
        updatedAt: '2026-11-25T11:00:00Z',
      },
      {
        id: 'c-low',
        status: 'active',
        enabled: true,
        priority: 5,
        updatedAt: '2026-11-25T11:00:00Z',
      },
      {
        id: 'c-tie-b',
        status: 'active',
        enabled: true,
        priority: 20,
        updatedAt: '2026-11-25T10:00:00Z',
      },
      {
        id: 'c-tie-a',
        status: 'active',
        enabled: true,
        priority: 20,
        updatedAt: '2026-11-25T10:00:00Z',
      },
    ];

    const winner = pickWinningCampaign(candidates, { now, pathname: '/shop', deviceKind: 'desktop' });
    assert.equal(winner?.id, 'c-tie-a');

    const newerWinner = pickWinningCampaign(
      [
        ...candidates,
        {
          id: 'c-tie-newer',
          status: 'active',
          enabled: true,
          priority: 20,
          updatedAt: '2026-11-25T11:30:00Z',
        },
      ],
      { now, pathname: '/shop', deviceKind: 'desktop' },
    );
    assert.equal(newerWinner?.id, 'c-tie-newer');
  });

  it('enforces route exclusions (including /admin and /checkout) and selected route matching', () => {
    assert.equal(isRouteEligible('/admin/marketing/global-promotional-popup', { mode: 'global', excludedRoutes: [] }), false);
    assert.equal(isRouteEligible('/checkout', { mode: 'global', excludedRoutes: DEFAULT_EXCLUDED_ROUTES }), false);
    assert.equal(isRouteEligible('/order-success/123', { mode: 'global', excludedRoutes: DEFAULT_EXCLUDED_ROUTES }), false);
    assert.equal(isRouteEligible('/shop', { mode: 'global', excludedRoutes: DEFAULT_EXCLUDED_ROUTES }), true);
    assert.equal(isRouteEligible('/product/smart-watch', { mode: 'global', excludedRoutes: DEFAULT_EXCLUDED_ROUTES }), true);

    const selectedTargeting = {
      mode: 'selected' as const,
      selectedRoutes: ['/shop', '/category/*'],
      excludedRoutes: DEFAULT_EXCLUDED_ROUTES,
    };
    assert.equal(isRouteEligible('/shop', selectedTargeting), true);
    assert.equal(isRouteEligible('/category/smartwatches', selectedTargeting), true);
    assert.equal(isRouteEligible('/', selectedTargeting), false);
  });

  it('respects desktop and mobile visibility rules', () => {
    assert.equal(isDeviceEligible('desktop', { showOnDesktop: false, showOnMobile: true }), false);
    assert.equal(isDeviceEligible('mobile', { showOnDesktop: false, showOnMobile: true }), true);
    assert.equal(isDeviceEligible('mobile', { showOnDesktop: true, showOnMobile: false }), false);
    assert.equal(
      isCampaignCurrentlyEligible(
        {
          id: 'c1',
          status: 'active',
          enabled: true,
          autoDisplay: false,
          priority: 10,
        },
        { requireAutoDisplay: true },
      ),
      false,
    );
  });

  it('calculates real countdown parts without negative values and stops at zero', () => {
    const nowMs = Date.parse('2026-11-25T12:00:00Z');
    const targetIso = new Date(nowMs + (2 * 86400 + 3 * 3600 + 15 * 60 + 42) * 1000).toISOString();
    const parts = calculateCountdownParts(targetIso, nowMs);
    assert.deepEqual(
      { days: parts.days, hours: parts.hours, minutes: parts.minutes, seconds: parts.seconds, isExpired: parts.isExpired },
      { days: 2, hours: 3, minutes: 15, seconds: 42, isExpired: false },
    );

    const expiredParts = calculateCountdownParts('2026-11-25T11:59:00Z', nowMs);
    assert.deepEqual(
      { days: expiredParts.days, hours: expiredParts.hours, minutes: expiredParts.minutes, seconds: expiredParts.seconds, isExpired: expiredParts.isExpired },
      { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true },
    );
  });

  it('resolves product_auto and campaign_special pricing dynamically', () => {
    const prod: GlobalPopupLinkedProductSummary = {
      id: 'prod-1',
      name: 'NOVARA Smart Watch',
      slug: 'novara-smart-watch',
      sku: 'NVR-SW-1',
      imageUrl: '/src/assets/images/promo_smartwatch_1794832026084.jpg',
      basePrice: 12999,
      salePrice: 8999,
      currentPrice: 8999,
      originalPrice: 12999,
      discountPercent: 31,
      availableStock: 25,
      manageInventory: true,
      allowBackorder: false,
      hasVariants: false,
      variants: [],
      status: 'published',
    };

    const autoRes = resolveCampaignPricingDisplay({ mode: 'product_auto', showOriginalPrice: true, currencySymbol: '৳' }, prod);
    assert.equal(autoRes.originalPrice, 12999);
    assert.equal(autoRes.promoPrice, 8999);
    assert.equal(autoRes.savingsAmount, 4000);

    const specialRes = resolveCampaignPricingDisplay(
      { mode: 'campaign_special', specialPrice: 6999, showOriginalPrice: true, currencySymbol: '৳' },
      prod,
    );
    assert.equal(specialRes.originalPrice, 12999);
    assert.equal(specialRes.promoPrice, 6999);
    assert.equal(specialRes.savingsAmount, 6000);
    assert.equal(specialRes.savingsPercent, 46);
  });

  it('blocks unsafe URL schemes and validates CTA and media URLs', () => {
    assert.equal(sanitizeCtaDestination('javascript:alert(1)', 'external_url').valid, false);
    assert.equal(sanitizeCtaDestination('data:text/html,hi', 'internal_page').valid, false);
    assert.equal(sanitizeCtaDestination('//evil.com/phish', 'internal_page').valid, false);
    assert.equal(sanitizeCtaDestination('/offers', 'internal_page').valid, true);
    assert.equal(sanitizeCtaDestination('https://example.com/promo', 'external_url').valid, true);

    assert.equal(isSafeMediaUrl('data:image/png;base64,AAAA'), false);
    assert.equal(isSafeMediaUrl('https://res.cloudinary.com/demo/image/upload/watch.png'), true);
    assert.equal(isSafeMediaUrl('/src/assets/images/promo_smartwatch_1794832026084.jpg'), true);
  });

  it('tracks sessionStorage state safely even when storage throws', () => {
    const map = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    assert.equal(hasCampaignSessionFlag('camp-1', 'shown', mockStorage), false);
    setCampaignSessionFlag('camp-1', 'shown', mockStorage);
    setCampaignSessionFlag('camp-1', 'dismissed', mockStorage);
    assert.equal(hasCampaignSessionFlag('camp-1', 'shown', mockStorage), true);
    assert.equal(hasCampaignSessionFlag('camp-1', 'dismissed', mockStorage), true);
    assert.equal(hasCampaignSessionFlag('camp-2', 'shown', mockStorage), false);

    const throwingStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    assert.doesNotThrow(() => setCampaignSessionFlag('camp-1', 'shown', throwingStorage));
    assert.equal(hasCampaignSessionFlag('camp-1', 'shown', throwingStorage), false);
  });

  it('computes CTR and discount badge lines accurately', () => {
    assert.equal(calculateCtrPercent(0, 0), 0);
    assert.equal(calculateCtrPercent(25, 1000), 2.5);
    assert.deepEqual(formatDiscountBadgeLines('UP TO 50% OFF', 50), {
      topLabel: 'UP TO',
      percentText: '50%',
      bottomLabel: 'OFF',
    });
  });

  it('enforces campaignSpecialPrice in pricingEngine without ever inflating lower product sale prices', () => {
    const discounted = resolveEffectiveUnitPrice({
      basePrice: 12999,
      salePrice: 8999,
      campaignSpecialPrice: 6999,
    });
    assert.equal(discounted.currentPrice, 6999);
    assert.equal(discounted.originalPrice, 12999);
    assert.equal(discounted.discountPercent, 46);

    const guardHigher = resolveEffectiveUnitPrice({
      basePrice: 12999,
      salePrice: 8999,
      campaignSpecialPrice: 9500,
    });
    assert.equal(guardHigher.currentPrice, 8999);
  });
});
