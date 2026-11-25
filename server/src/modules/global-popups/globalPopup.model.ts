import mongoose, { Schema, type Document } from 'mongoose';
import type {
  GlobalPopupAnimationStyle,
  GlobalPopupCampaignType,
  GlobalPopupCountdownFormat,
  GlobalPopupCtaAction,
  GlobalPopupImageFit,
  GlobalPopupImagePosition,
  GlobalPopupPricingMode,
  GlobalPopupShadowStrength,
  GlobalPopupStatus,
  GlobalPopupTargetingMode,
} from '../../../../src/lib/globalPromotionalPopup';

export interface IGlobalPromotionalPopup extends Document {
  name: string;
  slug: string;
  description: string;
  campaignType: GlobalPopupCampaignType;
  status: GlobalPopupStatus;
  enabled: boolean;
  autoDisplay: boolean;
  priority: number;
  displayDelaySeconds: number;
  startAt: Date | null;
  endAt: Date | null;
  archived: boolean;
  targeting: {
    mode: GlobalPopupTargetingMode;
    selectedRoutes: string[];
    excludedRoutes: string[];
    showOnDesktop: boolean;
    showOnMobile: boolean;
    sessionFrequency: 'once_per_session';
  };
  design: {
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
  };
  content: {
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
  };
  media: {
    desktopImageUrl: string;
    desktopImagePublicId: string;
    mobileImageUrl: string;
    mobileImagePublicId: string;
    imageAlt: string;
    imagePosition: GlobalPopupImagePosition;
    imageFit: GlobalPopupImageFit;
  };
  features: Array<{
    id: string;
    icon: string;
    title: string;
    description?: string;
    visible: boolean;
    sortOrder: number;
  }>;
  pricing: {
    mode: GlobalPopupPricingMode;
    specialPrice: number | null;
    originalPriceOverride: number | null;
    showOriginalPrice: boolean;
    showDiscountBadge: boolean;
    currencySymbol: string;
  };
  countdown: {
    enabled: boolean;
    expiresAt: Date | null;
    format: GlobalPopupCountdownFormat;
    label: string;
  };
  benefits: Array<{
    id: string;
    icon: string;
    label: string;
    visible: boolean;
    sortOrder: number;
  }>;
  linkedProduct: mongoose.Types.ObjectId | null;
  analytics: {
    impressions: number;
    clicks: number;
    lastImpressionAt: Date | null;
    lastClickAt: Date | null;
  };
  createdBy: mongoose.Types.ObjectId | null;
  updatedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const FeatureItemSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 60 },
    icon: { type: String, required: true, default: 'sparkles', maxlength: 50 },
    title: { type: String, required: true, trim: true, maxlength: 90 },
    description: { type: String, trim: true, default: '', maxlength: 160 },
    visible: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const BenefitItemSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 60 },
    icon: { type: String, required: true, default: 'shield-check', maxlength: 50 },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    visible: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const GlobalPromotionalPopupSchema = new Schema<IGlobalPromotionalPopup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 120, index: true },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    campaignType: {
      type: String,
      enum: ['product_launch', 'flash_sale', 'seasonal', 'clearance', 'bundle', 'announcement'],
      default: 'product_launch',
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'active', 'paused', 'expired'],
      default: 'draft',
      index: true,
    },
    enabled: { type: Boolean, default: true, index: true },
    autoDisplay: { type: Boolean, default: true },
    priority: { type: Number, default: 10, min: -1000, max: 10000, index: true },
    displayDelaySeconds: { type: Number, default: 20, min: 0, max: 600 },
    startAt: { type: Date, default: null, index: true },
    endAt: { type: Date, default: null, index: true },
    archived: { type: Boolean, default: false, index: true },
    targeting: {
      mode: { type: String, enum: ['global', 'selected'], default: 'global' },
      selectedRoutes: [{ type: String, trim: true, maxlength: 160 }],
      excludedRoutes: [{ type: String, trim: true, maxlength: 160 }],
      showOnDesktop: { type: Boolean, default: true },
      showOnMobile: { type: Boolean, default: true },
      sessionFrequency: { type: String, enum: ['once_per_session'], default: 'once_per_session' },
    },
    design: {
      primaryColor: { type: String, default: '#145CFF', maxlength: 32 },
      secondaryColor: { type: String, default: '#0B3DC7', maxlength: 32 },
      backgroundColor: { type: String, default: '#FFFFFF', maxlength: 32 },
      surfaceColor: { type: String, default: '#F4F6FA', maxlength: 32 },
      textColor: { type: String, default: '#15213B', maxlength: 32 },
      accentColor: { type: String, default: '#FFE14D', maxlength: 32 },
      gradientFrom: { type: String, default: '#145CFF', maxlength: 32 },
      gradientTo: { type: String, default: '#0938B8', maxlength: 32 },
      borderRadiusPx: { type: Number, default: 30, min: 8, max: 48 },
      maxWidthPx: { type: Number, default: 1420, min: 640, max: 1600 },
      fontFamily: { type: String, enum: ['inter_jakarta', 'jakarta', 'inter', 'system'], default: 'inter_jakarta' },
      shadowStrength: { type: String, enum: ['soft', 'medium', 'dramatic'], default: 'dramatic' },
      overlayOpacity: { type: Number, default: 0.58, min: 0.1, max: 0.9 },
      backdropBlurPx: { type: Number, default: 10, min: 0, max: 32 },
      animationStyle: { type: String, enum: ['scale_fade', 'slide_up', 'zoom_spring', 'none'], default: 'scale_fade' },
    },
    content: {
      offerBadgeText: { type: String, trim: true, default: 'Limited Time Offer', maxlength: 60 },
      offerBadgeIcon: { type: String, trim: true, default: 'flame', maxlength: 40 },
      showOfferBadge: { type: Boolean, default: true },
      tagline: { type: String, trim: true, default: 'SMARTER • HEALTHIER • STYLISH', maxlength: 120 },
      mainHeading: { type: String, trim: true, default: 'Next-Gen', maxlength: 120 },
      highlightedHeading: { type: String, trim: true, default: 'Smart Watch', maxlength: 120 },
      description: { type: String, trim: true, default: '', maxlength: 400 },
      discountText: { type: String, trim: true, default: 'UP TO 50% OFF', maxlength: 60 },
      discountPercent: { type: Number, min: 0, max: 99, default: 50 },
      showDiscountBadge: { type: Boolean, default: true },
      ctaLabel: { type: String, trim: true, default: 'Add to Cart', maxlength: 60 },
      ctaAction: {
        type: String,
        enum: ['add_to_cart', 'view_product', 'internal_page', 'external_url'],
        default: 'add_to_cart',
      },
      ctaDestination: { type: String, trim: true, default: '/shop', maxlength: 500 },
    },
    media: {
      desktopImageUrl: { type: String, trim: true, default: '', maxlength: 800 },
      desktopImagePublicId: { type: String, trim: true, default: '', maxlength: 240 },
      mobileImageUrl: { type: String, trim: true, default: '', maxlength: 800 },
      mobileImagePublicId: { type: String, trim: true, default: '', maxlength: 240 },
      imageAlt: { type: String, trim: true, default: 'Featured Product Showcase', maxlength: 200 },
      imagePosition: { type: String, enum: ['center', 'top', 'bottom', 'left', 'right'], default: 'center' },
      imageFit: { type: String, enum: ['contain', 'cover'], default: 'contain' },
    },
    features: { type: [FeatureItemSchema], default: [] },
    pricing: {
      mode: { type: String, enum: ['product_auto', 'campaign_special'], default: 'product_auto' },
      specialPrice: { type: Number, min: 0, default: null },
      originalPriceOverride: { type: Number, min: 0, default: null },
      showOriginalPrice: { type: Boolean, default: true },
      showDiscountBadge: { type: Boolean, default: true },
      currencySymbol: { type: String, trim: true, default: '৳', maxlength: 8 },
    },
    countdown: {
      enabled: { type: Boolean, default: true },
      expiresAt: { type: Date, default: null },
      format: { type: String, enum: ['dhms', 'hms', 'compact'], default: 'dhms' },
      label: { type: String, trim: true, default: 'Offer Ends In:', maxlength: 60 },
    },
    benefits: { type: [BenefitItemSchema], default: [] },
    linkedProduct: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    analytics: {
      impressions: { type: Number, default: 0, min: 0 },
      clicks: { type: Number, default: 0, min: 0 },
      lastImpressionAt: { type: Date, default: null },
      lastClickAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

GlobalPromotionalPopupSchema.index({ archived: 1, enabled: 1, status: 1, priority: -1, updatedAt: -1 });
GlobalPromotionalPopupSchema.index({ startAt: 1, endAt: 1 });

export const GlobalPromotionalPopupModel =
  mongoose.models.GlobalPromotionalPopup ||
  mongoose.model<IGlobalPromotionalPopup>('GlobalPromotionalPopup', GlobalPromotionalPopupSchema);
