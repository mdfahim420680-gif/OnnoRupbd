import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../../services/api';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import { peekAdminQuery, setAdminQueryData } from '../../../lib/adminQueryCache';
import { cachedApiRequest } from '../../../lib/useAdminQuery';

import type { AuthSettingsConfig } from '../../../lib/authValidation';
import type { ProductTrustHighlightItem } from '../../../types/commerce';

export interface OAuthCallbackCatalog {
  activeOrigin: string;
  devOrigin: string;
  sharedOrigin: string;
  google: {
    activeCallbackUrl: string;
    devCallbackUrl: string;
    sharedCallbackUrl: string;
  };
  facebook: {
    activeCallbackUrl: string;
    devCallbackUrl: string;
    sharedCallbackUrl: string;
  };
}

export interface AdminSettingsConfig {
  storeInfo?: {
    storeName?: string;
    tagline?: string;
    description?: string;
    logoUrl?: string;
    faviconUrl?: string;
    supportPhone?: string;
    supportEmail?: string;
  };
  currencySettings?: {
    code?: string;
    symbol?: string;
    position?: 'prefix' | 'suffix';
  };
  announcementBar?: {
    enabled?: boolean;
    text?: string;
    linkText?: string;
    linkUrl?: string;
  };
  headerSettings?: {
    showSearch?: boolean;
    showWishlist?: boolean;
    showCategoryMenu?: boolean;
    stickyHeader?: boolean;
    specialOfferLabel?: string;
    specialOfferUrl?: string;
    searchPlaceholder?: {
      phrases: Array<{
        text: string;
        enabled: boolean;
        displayOrder: number;
      }>;
      typingSpeed: number;
      deletingSpeed: number;
      phrasePause: number;
      transitionPause: number;
      animationEnabled: boolean;
    };
  };
  footerSettings?: {
    description?: string;
    tagline?: string;
    copyrightText?: string;
    storeStatus?: 'live' | 'maintenance';
    columns?: Array<{ title: string; links: Array<{ label: string; url: string }> }>;
  };
  contactInfo?: {
    phone?: string;
    email?: string;
    address?: string;
    socialLinks?: Array<{
      id?: string;
      platform: 'facebook' | 'youtube' | 'x' | 'instagram' | 'linkedin' | 'tiktok' | 'whatsapp' | 'telegram' | 'messenger' | 'pinterest' | 'other';
      label: string;
      url: string;
      enabled: boolean;
      displayOrder: number;
    }>;
    whatsappUrl?: string;
    messengerUrl?: string;
    instagramUrl?: string;
    linkedinUrl?: string;
    facebookUrl?: string;
    youtubeUrl?: string;
    xUrl?: string;
    tiktokUrl?: string;
  };
  seoDefaults?: {
    siteName?: string;
    defaultTitle?: string;
    defaultDescription?: string;
  };
  paymentMethods?: {
    codEnabled?: boolean;
    sslcommerzEnabled?: boolean;
    bkashEnabled?: boolean;
    nagadEnabled?: boolean;
    cardEnabled?: boolean;
    codMaxAmount?: number;
    codInstructions?: string;
  };
  shippingSettings?: {
    dhakaMetroCharge?: number;
    dhakaSuburbCharge?: number;
    nationwideCharge?: number;
    freeShippingThreshold?: number;
    expressSurcharge?: number;
  };
  deliveryZones?: Array<{
    name: string;
    divisions: string[];
    charge: number;
    freeAbove: number;
    estimatedDays: string;
    isActive: boolean;
  }>;
  deliveryOptions?: Array<{
    code: string;
    name: string;
    description: string;
    estimatedTime: string;
    methodType: 'standard' | 'express';
    surcharge: number;
    freeShippingEligible: boolean;
    isActive: boolean;
    sortOrder: number;
    divisions?: string[];
  }>;
  taxSettings?: {
    enabled?: boolean;
    label?: string;
    ratePercent?: number;
    inclusive?: boolean;
  };
  emailSettings?: {
    senderName?: string;
    senderEmail?: string;
    replyTo?: string;
    orderConfirmationSubject?: string;
    shippingUpdateSubject?: string;
  };
  notificationSettings?: {
    lowStockAlert?: boolean;
    newOrderAlert?: boolean;
    newReviewAlert?: boolean;
    newEnquiryAlert?: boolean;
    lowStockThresholdDefault?: number;
  };
  securitySettings?: {
    requireEmailVerification?: boolean;
    sessionTimeoutHours?: number;
    maxLoginAttempts?: number;
    maintenanceBypassAdmin?: boolean;
  };
  maintenanceMode?: {
    enabled?: boolean;
    title?: string;
    message?: string;
  };
  productTrustHighlights?: ProductTrustHighlightItem[];
  authSettings?: Partial<AuthSettingsConfig>;
}

interface SettingsResponsePayload {
  ok: true;
  config: AdminSettingsConfig;
  integrations?: Record<string, boolean>;
  oauthCallbacks?: OAuthCallbackCatalog;
  authWarnings?: string[];
}

const ADMIN_SETTINGS_ENDPOINT = '/api/admin/settings';

export function useAdminSettings() {
  const dispatch = useAppDispatch();
  const initialCached = peekAdminQuery<SettingsResponsePayload>(ADMIN_SETTINGS_ENDPOINT);

  const [config, setConfig] = useState<AdminSettingsConfig | null>(initialCached?.data.config || null);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>(initialCached?.data.integrations || {});
  const [oauthCallbacks, setOauthCallbacks] = useState<OAuthCallbackCatalog | null>(
    initialCached?.data.oauthCallbacks || null,
  );
  const [authWarnings, setAuthWarnings] = useState<string[]>(initialCached?.data.authWarnings || []);
  const [loading, setLoading] = useState(!initialCached);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    const cached = forceRefresh ? null : peekAdminQuery<SettingsResponsePayload>(ADMIN_SETTINGS_ENDPOINT);
    if (cached) {
      setConfig(cached.data.config || {});
      setIntegrations(cached.data.integrations || {});
      setOauthCallbacks(cached.data.oauthCallbacks || null);
      setAuthWarnings(cached.data.authWarnings || []);
      setLoading(false);
      if (cached.isFresh) return;
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await cachedApiRequest<SettingsResponsePayload>(ADMIN_SETTINGS_ENDPOINT, {
        staleTimeMs: 120_000,
        forceRefresh,
      });
      setConfig(res.config || {});
      setIntegrations(res.integrations || {});
      setOauthCallbacks(res.oauthCallbacks || null);
      setAuthWarnings(res.authWarnings || []);
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : 'Unable to load store settings.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const savePatch = async (patch: Partial<AdminSettingsConfig>, successMessage = 'Settings saved successfully.') => {
    setSaving(true);
    try {
      const res = await apiRequest<{ ok: true; config: AdminSettingsConfig }>(ADMIN_SETTINGS_ENDPOINT, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setConfig(res.config);
      setAdminQueryData<SettingsResponsePayload>(
        ADMIN_SETTINGS_ENDPOINT,
        {
          ok: true,
          config: res.config,
          integrations,
          oauthCallbacks: oauthCallbacks || undefined,
          authWarnings,
        },
        { staleTimeMs: 120_000 },
      );
      dispatch(showToast({ variant: 'success', message: successMessage }));
      return true;
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Save failed.' }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { config, integrations, oauthCallbacks, authWarnings, loading, saving, error, load: () => load(true), savePatch };
}
