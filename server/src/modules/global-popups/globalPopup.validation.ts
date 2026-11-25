import mongoose from 'mongoose';
import { z } from 'zod';
import {
  DEFAULT_EXCLUDED_ROUTES,
  isSafeMediaUrl,
  sanitizeCtaDestination,
  sanitizePlainText,
  slugifyCampaignName,
} from '../../../../src/lib/globalPromotionalPopup';

const safeColorSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .refine(
    (v) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^rgb(a)?\([0-9\s.,%]+\)$/i.test(v),
    'Color must be a valid Hex or RGB(A) color value.',
  );

const safeImageUrlSchema = z
  .string()
  .trim()
  .max(800)
  .refine((v) => !v.toLowerCase().startsWith('data:'), 'Base64 images are not allowed in MongoDB. Upload via Cloudinary or use a valid HTTPS URL.')
  .refine((v) => isSafeMediaUrl(v), 'Media URL must be a valid HTTPS/HTTP URL or relative asset path.');

const nullableObjectIdSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((v) => !v || mongoose.isValidObjectId(v), 'Invalid linked product identifier.');

const optionalDateStringSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), 'Invalid date/time format.');

const featureItemSchema = z.object({
  id: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(50).default('sparkles'),
  title: z.string().trim().min(1).max(90).transform((v) => sanitizePlainText(v, 90)),
  description: z.string().trim().max(160).optional().default('').transform((v) => sanitizePlainText(v, 160)),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(200).default(0),
});

const benefitItemSchema = z.object({
  id: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(50).default('shield-check'),
  label: z.string().trim().min(1).max(80).transform((v) => sanitizePlainText(v, 80)),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(200).default(0),
});

export const globalPopupInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Campaign name must be at least 2 characters.').max(140).transform((v) => sanitizePlainText(v, 140)),
    slug: z.string().trim().max(120).optional().default(''),
    description: z.string().trim().max(500).optional().default('').transform((v) => sanitizePlainText(v, 500)),
    campaignType: z
      .enum(['product_launch', 'flash_sale', 'seasonal', 'clearance', 'bundle', 'announcement'])
      .default('product_launch'),
    status: z.enum(['draft', 'scheduled', 'active', 'paused', 'expired']).default('draft'),
    enabled: z.boolean().default(true),
    autoDisplay: z.boolean().default(true),
    priority: z.number().int().min(-1000).max(10000).default(10),
    displayDelaySeconds: z.number().int().min(0).max(600).default(20),
    startAt: optionalDateStringSchema,
    endAt: optionalDateStringSchema,
    archived: z.boolean().default(false),
    targeting: z
      .object({
        mode: z.enum(['global', 'selected']).default('global'),
        selectedRoutes: z.array(z.string().trim().max(160)).max(50).default([]),
        excludedRoutes: z.array(z.string().trim().max(160)).max(50).default(DEFAULT_EXCLUDED_ROUTES),
        showOnDesktop: z.boolean().default(true),
        showOnMobile: z.boolean().default(true),
        sessionFrequency: z.literal('once_per_session').default('once_per_session'),
      })
      .default({
        mode: 'global',
        selectedRoutes: [],
        excludedRoutes: DEFAULT_EXCLUDED_ROUTES,
        showOnDesktop: true,
        showOnMobile: true,
        sessionFrequency: 'once_per_session',
      }),
    design: z.object({
      primaryColor: safeColorSchema.default('#145CFF'),
      secondaryColor: safeColorSchema.default('#0B3DC7'),
      backgroundColor: safeColorSchema.default('#FFFFFF'),
      surfaceColor: safeColorSchema.default('#F4F6FA'),
      textColor: safeColorSchema.default('#15213B'),
      accentColor: safeColorSchema.default('#FFE14D'),
      gradientFrom: safeColorSchema.default('#145CFF'),
      gradientTo: safeColorSchema.default('#0938B8'),
      borderRadiusPx: z.number().int().min(8).max(48).default(30),
      maxWidthPx: z.number().int().min(640).max(1600).default(1420),
      fontFamily: z.enum(['inter_jakarta', 'jakarta', 'inter', 'system']).default('inter_jakarta'),
      shadowStrength: z.enum(['soft', 'medium', 'dramatic']).default('dramatic'),
      overlayOpacity: z.number().min(0.1).max(0.9).default(0.58),
      backdropBlurPx: z.number().int().min(0).max(32).default(10),
      animationStyle: z.enum(['scale_fade', 'slide_up', 'zoom_spring', 'none']).default('scale_fade'),
    }),
    content: z.object({
      offerBadgeText: z.string().trim().max(60).default('Limited Time Offer').transform((v) => sanitizePlainText(v, 60)),
      offerBadgeIcon: z.string().trim().max(40).default('flame'),
      showOfferBadge: z.boolean().default(true),
      tagline: z.string().trim().max(120).default('').transform((v) => sanitizePlainText(v, 120)),
      mainHeading: z.string().trim().min(1, 'Main heading is required.').max(120).transform((v) => sanitizePlainText(v, 120)),
      highlightedHeading: z.string().trim().max(120).default('').transform((v) => sanitizePlainText(v, 120)),
      description: z.string().trim().max(400).default('').transform((v) => sanitizePlainText(v, 400)),
      discountText: z.string().trim().max(60).default('UP TO 50% OFF').transform((v) => sanitizePlainText(v, 60)),
      discountPercent: z.number().min(0).max(99).nullable().optional().default(50),
      showDiscountBadge: z.boolean().default(true),
      ctaLabel: z.string().trim().min(1, 'CTA label is required.').max(60).transform((v) => sanitizePlainText(v, 60)),
      ctaAction: z.enum(['add_to_cart', 'view_product', 'internal_page', 'external_url']).default('add_to_cart'),
      ctaDestination: z.string().trim().max(500).default('/shop'),
    }),
    media: z.object({
      desktopImageUrl: safeImageUrlSchema.default(''),
      desktopImagePublicId: z.string().trim().max(240).optional().default(''),
      mobileImageUrl: safeImageUrlSchema.optional().default(''),
      mobileImagePublicId: z.string().trim().max(240).optional().default(''),
      imageAlt: z.string().trim().max(200).default('Promotional Product Showcase').transform((v) => sanitizePlainText(v, 200)),
      imagePosition: z.enum(['center', 'top', 'bottom', 'left', 'right']).default('center'),
      imageFit: z.enum(['contain', 'cover']).default('contain'),
    }),
    features: z.array(featureItemSchema).max(16).default([]),
    pricing: z.object({
      mode: z.enum(['product_auto', 'campaign_special']).default('product_auto'),
      specialPrice: z.number().min(0).max(100_000_000).nullable().optional().default(null),
      originalPriceOverride: z.number().min(0).max(100_000_000).nullable().optional().default(null),
      showOriginalPrice: z.boolean().default(true),
      showDiscountBadge: z.boolean().default(true),
      currencySymbol: z.string().trim().min(1).max(8).default('৳'),
    }),
    countdown: z.object({
      enabled: z.boolean().default(true),
      expiresAt: optionalDateStringSchema,
      format: z.enum(['dhms', 'hms', 'compact']).default('dhms'),
      label: z.string().trim().max(60).default('Offer Ends In:').transform((v) => sanitizePlainText(v, 60)),
    }),
    benefits: z.array(benefitItemSchema).max(8).default([]),
    linkedProductId: nullableObjectIdSchema.default(null),
  })
  .superRefine((data, ctx) => {
    if (data.startAt && data.endAt) {
      const startMs = new Date(data.startAt).getTime();
      const endMs = new Date(data.endAt).getTime();
      if (endMs <= startMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: 'Campaign end date/time must be later than start date/time.',
        });
      }
    }

    const ctaCheck = sanitizeCtaDestination(data.content.ctaDestination, data.content.ctaAction);
    if (!ctaCheck.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content', 'ctaDestination'],
        message: ctaCheck.reason || 'Invalid CTA destination.',
      });
    }

    if ((data.content.ctaAction === 'add_to_cart' || data.content.ctaAction === 'view_product') && !data.linkedProductId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['linkedProductId'],
        message: 'Linked product is required when CTA action is Add to Cart or View Product.',
      });
    }

    if (data.pricing.mode === 'campaign_special') {
      if (data.pricing.specialPrice == null || data.pricing.specialPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pricing', 'specialPrice'],
          message: 'Special promotional price must be greater than 0 when Campaign Special pricing mode is selected.',
        });
      }
      if (
        data.pricing.originalPriceOverride != null &&
        data.pricing.specialPrice != null &&
        data.pricing.originalPriceOverride > 0 &&
        data.pricing.originalPriceOverride < data.pricing.specialPrice
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pricing', 'originalPriceOverride'],
          message: 'Original price must be greater than or equal to promotional price.',
        });
      }
    }
  })
  .transform((data) => {
    const ctaCheck = sanitizeCtaDestination(data.content.ctaDestination, data.content.ctaAction);
    const derivedSlug = slugifyCampaignName(data.slug || data.name) || `promo-${Date.now()}`;
    return {
      ...data,
      slug: derivedSlug,
      content: {
        ...data.content,
        ctaDestination: ctaCheck.valid ? ctaCheck.value : '/shop',
      },
    };
  });

export const globalPopupStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'active', 'paused']),
  enabled: z.boolean().optional(),
});

export const globalPopupTrackSchema = z.object({
  event: z.enum(['impression', 'click']),
});

export type GlobalPopupValidatedInput = z.infer<typeof globalPopupInputSchema>;
