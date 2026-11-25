import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Eye,
  Monitor,
  Package,
  Plus,
  Save,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  X,
} from 'lucide-react';
import { CloudinaryImageField } from '../../../components/admin/CloudinaryImageField';
import { ResilientImage } from '../../../components/ui/ResilientImage';
import { GlobalPromotionalPopupModal } from '../../../components/promotional/GlobalPromotionalPopupModal';
import { POPUP_ICON_OPTIONS, renderPopupIcon } from '../../../components/promotional/popupIcons';
import {
  createDefaultGlobalPopupDraft,
  slugifyCampaignName,
  type GlobalPopupBenefitItem,
  type GlobalPopupCampaign,
  type GlobalPopupCampaignType,
  type GlobalPopupCountdownFormat,
  type GlobalPopupCtaAction,
  type GlobalPopupEditorInput,
  type GlobalPopupFeatureItem,
  type GlobalPopupImageFit,
  type GlobalPopupImagePosition,
  type GlobalPopupLinkedProductSummary,
  type GlobalPopupPricingMode,
  type GlobalPopupPublicCampaign,
  type GlobalPopupShadowStrength,
  type GlobalPopupStatus,
} from '../../../lib/globalPromotionalPopup';
import { toLocalDateTimeInputValue } from '../../../lib/dateTime';
import { apiRequest } from '../../../services/api';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';

type EditorTabKey =
  | 'general'
  | 'design'
  | 'content'
  | 'media'
  | 'pricing'
  | 'countdown'
  | 'targeting'
  | 'advanced';

const EDITOR_TABS: Array<{ key: EditorTabKey; label: string }> = [
  { key: 'general', label: 'A. General' },
  { key: 'design', label: 'B. Design' },
  { key: 'content', label: 'C. Content' },
  { key: 'media', label: 'D. Product & Media' },
  { key: 'pricing', label: 'E. Pricing' },
  { key: 'countdown', label: 'F. Countdown' },
  { key: 'targeting', label: 'G. Display Rules' },
  { key: 'advanced', label: 'H. Advanced' },
];

interface AdminProductSearchRow {
  id: string;
  _id?: string;
  name: string;
  slug: string;
  sku: string;
  basePrice: number;
  salePrice?: number | null;
  currentPrice?: number;
  originalPrice?: number | null;
  discountPercent?: number;
  availableStock?: number;
  manageInventory?: boolean;
  allowBackorder?: boolean;
  hasVariants?: boolean;
  variants?: Array<{
    _id?: string;
    id?: string;
    sku: string;
    title: string;
    options?: Record<string, string>;
    price?: number | null;
    salePrice?: number | null;
    stockOnHand?: number;
    reservedStock?: number;
    imageUrl?: string;
    isActive?: boolean;
  }>;
  images?: Array<{ url: string }>;
  status?: string;
}

interface GlobalPopupCampaignEditorProps {
  initialCampaign: GlobalPopupCampaign | null;
  onCancel: () => void;
  onSaved: (saved: GlobalPopupCampaign) => void;
  onDuplicate?: (id: string) => void;
}

function mapCampaignToEditorInput(c: GlobalPopupCampaign): GlobalPopupEditorInput {
  return {
    name: c.name,
    slug: c.slug,
    description: c.description || '',
    campaignType: c.campaignType,
    status: c.status === 'expired' ? 'paused' : c.status,
    enabled: c.enabled,
    autoDisplay: c.autoDisplay,
    priority: c.priority,
    displayDelaySeconds: c.displayDelaySeconds,
    startAt: c.startAt,
    endAt: c.endAt,
    archived: c.archived,
    targeting: {
      mode: c.targeting.mode,
      selectedRoutes: [...c.targeting.selectedRoutes],
      excludedRoutes: [...c.targeting.excludedRoutes],
      showOnDesktop: c.targeting.showOnDesktop,
      showOnMobile: c.targeting.showOnMobile,
      sessionFrequency: 'once_per_session',
    },
    design: { ...c.design },
    content: { ...c.content },
    media: { ...c.media },
    features: c.features.map((f) => ({ ...f })),
    pricing: { ...c.pricing },
    countdown: { ...c.countdown },
    benefits: c.benefits.map((b) => ({ ...b })),
    linkedProductId: c.linkedProductId,
  };
}

function mapAdminProductToSummary(p: AdminProductSearchRow): GlobalPopupLinkedProductSummary {
  const base = Number(p.basePrice || 0);
  const sale = p.salePrice != null && p.salePrice > 0 && p.salePrice < base ? Number(p.salePrice) : null;
  const current = Number(p.currentPrice ?? sale ?? base);
  const orig = current < base ? base : null;
  const pct = orig ? Math.round(((orig - current) / orig) * 100) : 0;

  return {
    id: String(p.id || p._id),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    imageUrl: p.images?.[0]?.url || '',
    basePrice: base,
    salePrice: sale,
    currentPrice: current,
    originalPrice: orig,
    discountPercent: pct,
    availableStock: Number(p.availableStock ?? 10),
    manageInventory: p.manageInventory !== false,
    allowBackorder: Boolean(p.allowBackorder),
    hasVariants: Boolean(p.hasVariants) && Array.isArray(p.variants) && p.variants.length > 0,
    variants: (p.variants || [])
      .filter((v) => v.isActive !== false)
      .map((v) => ({
        id: String(v.id || v._id || ''),
        sku: v.sku || p.sku,
        title: v.title,
        options: v.options || {},
        currentPrice: Number(v.salePrice ?? v.price ?? current),
        originalPrice: orig,
        availableStock: Math.max(0, Number(v.stockOnHand ?? 10) - Number(v.reservedStock ?? 0)),
        imageUrl: v.imageUrl || p.images?.[0]?.url || '',
        isActive: v.isActive !== false,
      })),
    status: p.status || 'published',
  };
}

export function GlobalPopupCampaignEditor({
  initialCampaign,
  onCancel,
  onSaved,
  onDuplicate,
}: GlobalPopupCampaignEditorProps) {
  const dispatch = useAppDispatch();
  const isEditing = Boolean(initialCampaign?.id);

  const [activeTab, setActiveTab] = useState<EditorTabKey>('general');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [modalPreviewOpen, setModalPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slugLocked, setSlugLocked] = useState(Boolean(initialCampaign?.id));

  const [form, setForm] = useState<GlobalPopupEditorInput>(() =>
    initialCampaign ? mapCampaignToEditorInput(initialCampaign) : createDefaultGlobalPopupDraft(),
  );
  const [linkedProductPreview, setLinkedProductPreview] = useState<GlobalPopupLinkedProductSummary | null>(
    () => initialCampaign?.linkedProduct || null,
  );

  // Product picker search state
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<AdminProductSearchRow[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  const [selectedRoutesText, setSelectedRoutesText] = useState(() =>
    (initialCampaign?.targeting.selectedRoutes || []).join('\n'),
  );
  const [excludedRoutesText, setExcludedRoutesText] = useState(() =>
    (initialCampaign ? initialCampaign.targeting.excludedRoutes : form.targeting.excludedRoutes).join('\n'),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchingProducts(true);
      const qs = new URLSearchParams({ limit: '10', status: 'published' });
      if (productQuery.trim()) qs.set('q', productQuery.trim());
      apiRequest<{ ok: true; products: AdminProductSearchRow[] }>(`/api/admin/products?${qs.toString()}`)
        .then((res) => setProductResults(res.products || []))
        .catch(() => setProductResults([]))
        .finally(() => setSearchingProducts(false));
    }, 240);
    return () => window.clearTimeout(timer);
  }, [productQuery]);

  const previewCampaignObject: GlobalPopupPublicCampaign = useMemo(
    () => ({
      id: initialCampaign?.id || 'preview-draft',
      name: form.name || 'Preview Campaign',
      slug: form.slug || 'preview-campaign',
      campaignType: form.campaignType,
      priority: form.priority,
      displayDelaySeconds: form.displayDelaySeconds,
      startAt: form.startAt,
      endAt: form.endAt,
      targeting: form.targeting,
      design: form.design,
      content: form.content,
      media: form.media,
      features: form.features,
      pricing: form.pricing,
      countdown: form.countdown,
      benefits: form.benefits,
      linkedProduct: linkedProductPreview,
    }),
    [initialCampaign?.id, form, linkedProductPreview],
  );

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.mainHeading.trim()) {
      dispatch(showToast({ variant: 'error', message: 'Campaign name and main heading are required.' }));
      return;
    }

    setSaving(true);
    try {
      const payload: GlobalPopupEditorInput = {
        ...form,
        targeting: {
          ...form.targeting,
          selectedRoutes: selectedRoutesText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          excludedRoutes: excludedRoutesText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };

      const res = isEditing && initialCampaign
        ? await apiRequest<{ ok: true; campaign: GlobalPopupCampaign }>(
            `/api/admin/global-promotional-popups/${initialCampaign.id}`,
            { method: 'PUT', body: JSON.stringify(payload) },
          )
        : await apiRequest<{ ok: true; campaign: GlobalPopupCampaign }>(
            '/api/admin/global-promotional-popups',
            { method: 'POST', body: JSON.stringify(payload) },
          );

      dispatch(
        showToast({
          variant: 'success',
          message: isEditing ? 'Global promotional popup updated.' : 'Global promotional popup created.',
        }),
      );
      onSaved(res.campaign);
    } catch (err) {
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Unable to save campaign.',
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const addFeatureItem = () => {
    setForm((prev) => ({
      ...prev,
      features: [
        ...prev.features,
        {
          id: `feat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          icon: 'sparkles',
          title: 'New Product Feature',
          description: '',
          visible: true,
          sortOrder: prev.features.length,
        },
      ],
    }));
  };

  const updateFeatureItem = (index: number, patch: Partial<GlobalPopupFeatureItem>) => {
    setForm((prev) => {
      const next = prev.features.slice();
      next[index] = { ...next[index], ...patch };
      return { ...prev, features: next };
    });
  };

  const moveFeatureItem = (index: number, direction: -1 | 1) => {
    setForm((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.features.length) return prev;
      const next = prev.features.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return {
        ...prev,
        features: next.map((f, idx) => ({ ...f, sortOrder: idx })),
      };
    });
  };

  const removeFeatureItem = (index: number) => {
    setForm((prev) => ({
      ...prev,
      features: prev.features
        .filter((_, idx) => idx !== index)
        .map((f, idx) => ({ ...f, sortOrder: idx })),
    }));
  };

  const addBenefitItem = () => {
    setForm((prev) => ({
      ...prev,
      benefits: [
        ...prev.benefits,
        {
          id: `ben-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          icon: 'shield-check',
          label: 'Premium Guarantee',
          visible: true,
          sortOrder: prev.benefits.length,
        },
      ],
    }));
  };

  const updateBenefitItem = (index: number, patch: Partial<GlobalPopupBenefitItem>) => {
    setForm((prev) => {
      const next = prev.benefits.slice();
      next[index] = { ...next[index], ...patch };
      return { ...prev, benefits: next };
    });
  };

  const moveBenefitItem = (index: number, direction: -1 | 1) => {
    setForm((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.benefits.length) return prev;
      const next = prev.benefits.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return {
        ...prev,
        benefits: next.map((b, idx) => ({ ...b, sortOrder: idx })),
      };
    });
  };

  const removeBenefitItem = (index: number) => {
    setForm((prev) => ({
      ...prev,
      benefits: prev.benefits
        .filter((_, idx) => idx !== index)
        .map((b, idx) => ({ ...b, sortOrder: idx })),
    }));
  };

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] px-4 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Campaigns
          </button>
          <div>
            <h2 className="text-sm font-bold text-[#101B35] dark:text-white">
              {isEditing ? `Edit: ${initialCampaign?.name}` : 'Create Global Promotional Popup'}
            </h2>
            <p className="text-[11px] text-slate-500">
              All changes reflect immediately in the live preview panel using the exact storefront modal component.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModalPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#145CFF]/30 bg-[#EEF4FF] px-3.5 py-2 text-xs font-semibold text-[#145CFF] hover:bg-[#E0ECFF]"
          >
            <Eye className="h-3.5 w-3.5" /> Preview Modal (Instant)
          </button>
          {isEditing && initialCampaign && onDuplicate && (
            <button
              type="button"
              onClick={() => onDuplicate(initialCampaign.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] dark:border-slate-700 px-3.5 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0E47D9] disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Campaign'}</span>
          </button>
        </div>
      </div>

      {/* Main Split: Campaign Editor Form + Live Preview Panel */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* LEFT: Sectioned Editor Controls (Sections A - H) */}
        <div className="xl:col-span-5 rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] shadow-xs overflow-hidden flex flex-col">
          {/* Section Navigation Pills */}
          <div className="flex flex-wrap gap-1 border-b border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/70 p-2.5">
            {EDITOR_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#145CFF] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4 overflow-y-auto max-h-[760px]">
            {/* SECTION A: GENERAL SETTINGS */}
            {activeTab === 'general' && (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">Campaign Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        name: val,
                        slug: slugLocked ? prev.slug : slugifyCampaignName(val),
                      }));
                    }}
                    className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Campaign Slug</label>
                    <input
                      value={form.slug}
                      onChange={(e) => {
                        setSlugLocked(true);
                        setForm((prev) => ({ ...prev, slug: slugifyCampaignName(e.target.value) }));
                      }}
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Campaign Type</label>
                    <select
                      value={form.campaignType}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, campaignType: e.target.value as GlobalPopupCampaignType }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    >
                      <option value="product_launch">Product Launch</option>
                      <option value="flash_sale">Flash Sale</option>
                      <option value="seasonal">Seasonal Offer</option>
                      <option value="clearance">Clearance Deal</option>
                      <option value="bundle">Bundle Promotion</option>
                      <option value="announcement">Announcement</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Internal Admin Description</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Internal campaign notes (never exposed publicly)"
                    className="w-full rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 p-2.5 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as GlobalPopupStatus }))}
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    >
                      <option value="draft">Draft</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Display Delay (sec)</label>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={form.displayDelaySeconds}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          displayDelaySeconds: Math.max(0, Math.min(600, Number(e.target.value || 0))),
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Priority</label>
                    <input
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value || 0) }))}
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Start Date & Time</label>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeInputValue(form.startAt)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          startAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">End Date & Time</label>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeInputValue(form.endAt)}
                      onChange={(e) => {
                        const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
                        setForm((prev) => ({
                          ...prev,
                          endAt: iso,
                          countdown: {
                            ...prev.countdown,
                            expiresAt: prev.countdown.expiresAt || iso,
                          },
                        }));
                      }}
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-900 px-3 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                    />
                    <span>Campaign Enabled</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.autoDisplay}
                      onChange={(e) => setForm((prev) => ({ ...prev, autoDisplay: e.target.checked }))}
                    />
                    <span>Automatic Display After Delay</span>
                  </label>
                </div>
              </div>
            )}

            {/* SECTION B: DESIGN SETTINGS */}
            {activeTab === 'design' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(
                    [
                      ['primaryColor', 'Primary Color'],
                      ['secondaryColor', 'Secondary Color'],
                      ['backgroundColor', 'Modal Background'],
                      ['surfaceColor', 'Card Surface'],
                      ['textColor', 'Text Color'],
                      ['accentColor', 'Badge Accent'],
                      ['gradientFrom', 'Gradient Start'],
                      ['gradientTo', 'Gradient End'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] font-semibold mb-1">{label}</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={form.design[field]}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              design: { ...prev.design, [field]: e.target.value },
                            }))
                          }
                          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
                        />
                        <input
                          value={form.design[field]}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              design: { ...prev.design, [field]: e.target.value },
                            }))
                          }
                          className="h-8 min-w-0 flex-1 rounded-lg border border-[#E4EAF5] bg-[#F8FAFF] px-2 text-[11px] font-mono-tabular"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Border Radius ({form.design.borderRadiusPx}px)
                    </label>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      value={form.design.borderRadiusPx}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: { ...prev.design, borderRadiusPx: Number(e.target.value) },
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Modal Max Width ({form.design.maxWidthPx}px)
                    </label>
                    <input
                      type="range"
                      min={760}
                      max={1560}
                      step={20}
                      value={form.design.maxWidthPx}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: { ...prev.design, maxWidthPx: Number(e.target.value) },
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Overlay Opacity ({Math.round(form.design.overlayOpacity * 100)}%)
                    </label>
                    <input
                      type="range"
                      min={0.15}
                      max={0.85}
                      step={0.05}
                      value={form.design.overlayOpacity}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: { ...prev.design, overlayOpacity: Number(e.target.value) },
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Backdrop Blur ({form.design.backdropBlurPx}px)
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={24}
                      value={form.design.backdropBlurPx}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: { ...prev.design, backdropBlurPx: Number(e.target.value) },
                        }))
                      }
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Typography</label>
                    <select
                      value={form.design.fontFamily}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: {
                            ...prev.design,
                            fontFamily: e.target.value as GlobalPopupEditorInput['design']['fontFamily'],
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      <option value="inter_jakarta">Plus Jakarta + Inter</option>
                      <option value="jakarta">Plus Jakarta Sans</option>
                      <option value="inter">Inter</option>
                      <option value="system">System UI</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Shadow Depth</label>
                    <select
                      value={form.design.shadowStrength}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: {
                            ...prev.design,
                            shadowStrength: e.target.value as GlobalPopupShadowStrength,
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      <option value="soft">Soft</option>
                      <option value="medium">Medium</option>
                      <option value="dramatic">Dramatic Commercial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Entrance Animation</label>
                    <select
                      value={form.design.animationStyle}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          design: {
                            ...prev.design,
                            animationStyle: e.target.value as GlobalPopupEditorInput['design']['animationStyle'],
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      <option value="scale_fade">Scale + Fade</option>
                      <option value="slide_up">Slide Up</option>
                      <option value="zoom_spring">Zoom Spring</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION C: CONTENT EDITOR */}
            {activeTab === 'content' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1">Offer Pill Badge Text</label>
                    <input
                      value={form.content.offerBadgeText}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, offerBadgeText: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Badge Icon</label>
                    <select
                      value={form.content.offerBadgeIcon}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, offerBadgeIcon: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      {POPUP_ICON_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Uppercase Tagline</label>
                  <input
                    value={form.content.tagline}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        content: { ...prev.content, tagline: e.target.value },
                      }))
                    }
                    className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Main Headline (Line 1) *</label>
                    <input
                      value={form.content.mainHeading}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, mainHeading: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Highlighted Headline (Line 2)</label>
                    <input
                      value={form.content.highlightedHeading}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, highlightedHeading: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Short Description</label>
                  <textarea
                    rows={2}
                    value={form.content.description}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        content: { ...prev.content, description: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-2.5 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Discount Text</label>
                    <input
                      value={form.content.discountText}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, discountText: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Discount %</label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={form.content.discountPercent ?? ''}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: {
                            ...prev.content,
                            discountPercent: e.target.value ? Number(e.target.value) : null,
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-2 h-9 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.content.showDiscountBadge}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          content: { ...prev.content, showDiscountBadge: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Circle Badge</span>
                  </label>
                </div>

                {/* CTA Controls */}
                <div className="rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-3 space-y-2.5">
                  <div className="text-xs font-bold text-[#101B35]">CTA Button Configuration</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Button Label *</label>
                      <input
                        value={form.content.ctaLabel}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            content: { ...prev.content, ctaLabel: e.target.value },
                          }))
                        }
                        className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-white px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">CTA Action</label>
                      <select
                        value={form.content.ctaAction}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            content: { ...prev.content, ctaAction: e.target.value as GlobalPopupCtaAction },
                          }))
                        }
                        className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-white px-2.5 text-xs"
                      >
                        <option value="add_to_cart">Add Linked Product to Cart</option>
                        <option value="view_product">View Linked Product</option>
                        <option value="internal_page">Open Internal Storefront Page</option>
                        <option value="external_url">Open External HTTPS URL</option>
                      </select>
                    </div>
                  </div>
                  {(form.content.ctaAction === 'internal_page' || form.content.ctaAction === 'external_url') && (
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Destination URL</label>
                      <input
                        value={form.content.ctaDestination}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            content: { ...prev.content, ctaDestination: e.target.value },
                          }))
                        }
                        placeholder={
                          form.content.ctaAction === 'internal_page' ? '/offers' : 'https://example.com/offer'
                        }
                        className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-white px-3 text-xs"
                      />
                    </div>
                  )}
                </div>

                {/* Feature Grid Editor (Add / Edit / Delete / Reorder) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#101B35]">
                      Feature Items ({form.features.length})
                    </span>
                    <button
                      type="button"
                      onClick={addFeatureItem}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#EEF4FF] px-2.5 py-1 text-[11px] font-semibold text-[#145CFF] hover:bg-[#DCE8FF]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Feature
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.features.map((feat, idx) => (
                      <div
                        key={feat.id}
                        className="rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-2.5 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E6EEFF] text-[#145CFF]">
                            {renderPopupIcon(feat.icon, 'h-3.5 w-3.5')}
                          </span>
                          <select
                            value={feat.icon}
                            onChange={(e) => updateFeatureItem(idx, { icon: e.target.value })}
                            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px]"
                          >
                            {POPUP_ICON_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <input
                            value={feat.title}
                            onChange={(e) => updateFeatureItem(idx, { title: e.target.value })}
                            placeholder="Feature title"
                            className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => moveFeatureItem(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Move feature up"
                            className="p-1 text-slate-500 hover:text-[#145CFF] disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveFeatureItem(idx, 1)}
                            disabled={idx === form.features.length - 1}
                            aria-label="Move feature down"
                            className="p-1 text-slate-500 hover:text-[#145CFF] disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFeatureItem(idx)}
                            aria-label="Delete feature"
                            className="p-1 text-rose-500 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            value={feat.description || ''}
                            onChange={(e) => updateFeatureItem(idx, { description: e.target.value })}
                            placeholder="Optional short description"
                            className="h-7 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px]"
                          />
                          <label className="flex items-center gap-1 text-[11px] font-medium">
                            <input
                              type="checkbox"
                              checked={feat.visible}
                              onChange={(e) => updateFeatureItem(idx, { visible: e.target.checked })}
                            />
                            <span>Visible</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Service Benefits Strip Editor */}
                <div className="space-y-2 pt-2 border-t border-[#E4EAF5]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#101B35]">
                      Bottom Service Benefits ({form.benefits.length})
                    </span>
                    <button
                      type="button"
                      onClick={addBenefitItem}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#EEF4FF] px-2.5 py-1 text-[11px] font-semibold text-[#145CFF]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Benefit
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.benefits.map((ben, idx) => (
                      <div key={ben.id} className="flex items-center gap-2 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-2">
                        <select
                          value={ben.icon}
                          onChange={(e) => updateBenefitItem(idx, { icon: e.target.value })}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11px]"
                        >
                          {POPUP_ICON_OPTIONS.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={ben.label}
                          onChange={(e) => updateBenefitItem(idx, { label: e.target.value })}
                          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
                        />
                        <label className="flex items-center gap-1 text-[11px]">
                          <input
                            type="checkbox"
                            checked={ben.visible}
                            onChange={(e) => updateBenefitItem(idx, { visible: e.target.checked })}
                          />
                          <span>On</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => moveBenefitItem(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBenefitItem(idx, 1)}
                          disabled={idx === form.benefits.length - 1}
                          className="p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBenefitItem(idx)}
                          className="p-1 text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION D: PRODUCT & MEDIA SETTINGS */}
            {activeTab === 'media' && (
              <div className="space-y-4">
                {/* Linked Product Picker */}
                <div className="rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#101B35]">Linked Product</span>
                    {form.linkedProductId && (
                      <button
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, linkedProductId: null }));
                          setLinkedProductPreview(null);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline"
                      >
                        <X className="h-3 w-3" /> Unlink Product
                      </button>
                    )}
                  </div>

                  {linkedProductPreview ? (
                    <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white p-2.5">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200">
                        <ResilientImage
                          src={linkedProductPreview.imageUrl}
                          alt={linkedProductPreview.name}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-[#101B35]">{linkedProductPreview.name}</div>
                        <div className="text-[11px] text-slate-500">
                          SKU: {linkedProductPreview.sku} • ৳{linkedProductPreview.currentPrice.toLocaleString('en-IN')} • Stock:{' '}
                          {linkedProductPreview.availableStock}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-500">
                      <Package className="h-4 w-4" />
                      <span>Search and link a published product below for Add to Cart & live pricing.</span>
                    </div>
                  )}

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Search catalog product by name or SKU..."
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs"
                    />
                  </div>

                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {searchingProducts && productResults.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-slate-500">Searching products...</div>
                    ) : productResults.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-slate-500">
                        No catalog products available (verify MongoDB connection).
                      </div>
                    ) : (
                      productResults.map((p) => {
                        const pid = String(p.id || p._id);
                        const selected = form.linkedProductId === pid;
                        return (
                          <button
                            key={pid}
                            type="button"
                            onClick={() => {
                              const summary = mapAdminProductToSummary(p);
                              setForm((prev) => ({
                                ...prev,
                                linkedProductId: pid,
                                media: {
                                  ...prev.media,
                                  desktopImageUrl: prev.media.desktopImageUrl || summary.imageUrl,
                                  imageAlt: prev.media.imageAlt || summary.name,
                                },
                              }));
                              setLinkedProductPreview(summary);
                            }}
                            className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                              selected
                                ? 'border-[#145CFF] bg-[#EEF4FF]'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <span className="truncate font-semibold">{p.name}</span>
                            <span className="shrink-0 font-mono-tabular text-[11px] text-slate-600">
                              ৳{Number(p.currentPrice ?? p.basePrice ?? 0).toLocaleString('en-IN')}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Cloudinary Desktop & Mobile Showcase Uploads */}
                <CloudinaryImageField
                  label="Desktop Product Showcase Image"
                  folder="global-popups"
                  value={form.media.desktopImageUrl}
                  onChange={(url, publicId) =>
                    setForm((prev) => ({
                      ...prev,
                      media: {
                        ...prev.media,
                        desktopImageUrl: url,
                        desktopImagePublicId: url ? (publicId ?? prev.media.desktopImagePublicId) : '',
                      },
                    }))
                  }
                  helperText="Upload transparent studio PNG/WebP via Cloudinary or select a bundled asset."
                />

                <CloudinaryImageField
                  label="Mobile Product Showcase Image (Optional)"
                  folder="global-popups"
                  value={form.media.mobileImageUrl}
                  onChange={(url, publicId) =>
                    setForm((prev) => ({
                      ...prev,
                      media: {
                        ...prev.media,
                        mobileImageUrl: url,
                        mobileImagePublicId: url ? (publicId ?? prev.media.mobileImagePublicId) : '',
                      },
                    }))
                  }
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Image Alt Text</label>
                    <input
                      value={form.media.imageAlt}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          media: { ...prev.media, imageAlt: e.target.value },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Image Fit</label>
                    <select
                      value={form.media.imageFit}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          media: { ...prev.media, imageFit: e.target.value as GlobalPopupImageFit },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      <option value="contain">Contain (Recommended)</option>
                      <option value="cover">Cover</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Image Position</label>
                    <select
                      value={form.media.imagePosition}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          media: { ...prev.media, imagePosition: e.target.value as GlobalPopupImagePosition },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-2.5 text-xs"
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION E: PRICING SETTINGS */}
            {activeTab === 'pricing' && (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">Pricing Mode</label>
                  <select
                    value={form.pricing.mode}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        pricing: { ...prev.pricing, mode: e.target.value as GlobalPopupPricingMode },
                      }))
                    }
                    className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                  >
                    <option value="product_auto">Automatic Linked Product Pricing</option>
                    <option value="campaign_special">Campaign Special Price (Backend-Enforced)</option>
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Special promotional prices are authoritatively validated and applied server-side across Cart, Checkout Quote, and Order Creation.
                  </p>
                </div>

                {form.pricing.mode === 'campaign_special' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">Special Promotional Price *</label>
                    <input
                      type="number"
                      min={1}
                      value={form.pricing.specialPrice ?? ''}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pricing: {
                            ...prev.pricing,
                            specialPrice: e.target.value ? Number(e.target.value) : null,
                          },
                        }))
                      }
                      placeholder="e.g. 6999"
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Original Price Override (Optional)</label>
                    <input
                      type="number"
                      min={0}
                      value={form.pricing.originalPriceOverride ?? ''}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pricing: {
                            ...prev.pricing,
                            originalPriceOverride: e.target.value ? Number(e.target.value) : null,
                          },
                        }))
                      }
                      placeholder="Auto from product if blank"
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Currency Symbol</label>
                    <input
                      value={form.pricing.currencySymbol}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pricing: { ...prev.pricing, currencySymbol: e.target.value || '৳' },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.pricing.showOriginalPrice}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pricing: { ...prev.pricing, showOriginalPrice: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Original Strikethrough Price</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.pricing.showDiscountBadge}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pricing: { ...prev.pricing, showDiscountBadge: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Discount Badge</span>
                  </label>
                </div>
              </div>
            )}

            {/* SECTION F: COUNTDOWN SETTINGS */}
            {activeTab === 'countdown' && (
              <div className="space-y-3.5">
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={form.countdown.enabled}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        countdown: { ...prev.countdown, enabled: e.target.checked },
                      }))
                    }
                  />
                  <span>Enable Real Server-Synced Countdown Timer</span>
                </label>

                <div>
                  <label className="block text-xs font-semibold mb-1">Countdown Label</label>
                  <input
                    value={form.countdown.label}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        countdown: { ...prev.countdown, label: e.target.value },
                      }))
                    }
                    className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Expiration Timestamp</label>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeInputValue(form.countdown.expiresAt || form.endAt)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          countdown: {
                            ...prev.countdown,
                            expiresAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Timer Format</label>
                    <select
                      value={form.countdown.format}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          countdown: {
                            ...prev.countdown,
                            format: e.target.value as GlobalPopupCountdownFormat,
                          },
                        }))
                      }
                      className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                    >
                      <option value="dhms">Days : Hours : Mins : Secs</option>
                      <option value="hms">Total Hours : Mins : Secs</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION G: DISPLAY RULES */}
            {activeTab === 'targeting' && (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1">Route Targeting Mode</label>
                  <select
                    value={form.targeting.mode}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        targeting: {
                          ...prev.targeting,
                          mode: e.target.value as GlobalPopupEditorInput['targeting']['mode'],
                        },
                      }))
                    }
                    className="w-full h-9 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 text-xs"
                  >
                    <option value="global">Global Storefront (All Public Pages Except Exclusions)</option>
                    <option value="selected">Only Selected Routes</option>
                  </select>
                </div>

                {form.targeting.mode === 'selected' && (
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Selected Routes (One path per line, supports /* wildcard)
                    </label>
                    <textarea
                      rows={3}
                      value={selectedRoutesText}
                      onChange={(e) => setSelectedRoutesText(e.target.value)}
                      placeholder={'/\n/shop\n/category/*\n/offers'}
                      className="w-full rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-2.5 font-mono-tabular text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Excluded Routes (Checkout, Order Success, Auth, Admin remain excluded)
                  </label>
                  <textarea
                    rows={4}
                    value={excludedRoutesText}
                    onChange={(e) => setExcludedRoutesText(e.target.value)}
                    className="w-full rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-2.5 font-mono-tabular text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 py-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.targeting.showOnDesktop}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          targeting: { ...prev.targeting, showOnDesktop: e.target.checked },
                        }))
                      }
                    />
                    <span>Show on Desktop & Tablet</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] px-3 py-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.targeting.showOnMobile}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          targeting: { ...prev.targeting, showOnMobile: e.target.checked },
                        }))
                      }
                    />
                    <span>Show on Mobile Devices</span>
                  </label>
                </div>

                <div className="rounded-xl border border-blue-200 bg-[#EEF4FF] p-3 text-[11px] text-[#101B35]">
                  <strong>Session Frequency:</strong> Enforced via <code className="font-mono-tabular">sessionStorage</code> — displays once per browser tab session after {form.displayDelaySeconds}s, remains dismissed on reload, and never opens on Admin routes.
                </div>
              </div>
            )}

            {/* SECTION H: ADVANCED SETTINGS */}
            {activeTab === 'advanced' && (
              <div className="space-y-3.5">
                <label className="flex items-center gap-2 rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-3 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={form.archived}
                    onChange={(e) => setForm((prev) => ({ ...prev, archived: e.target.checked }))}
                  />
                  <span>Archive Campaign (Hides from storefront and default active table)</span>
                </label>

                <div className="rounded-xl border border-[#E4EAF5] bg-[#F8FAFF] p-3.5 space-y-2 text-xs">
                  <div className="font-bold text-[#101B35]">Quick Actions</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setModalPreviewOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#145CFF] px-3 py-1.5 font-semibold text-white"
                    >
                      <Eye className="h-3.5 w-3.5" /> Open Instant Modal Preview
                    </button>
                    {isEditing && initialCampaign && onDuplicate && (
                      <button
                        type="button"
                        onClick={() => onDuplicate(initialCampaign.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate Campaign
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: REAL-TIME LIVE PREVIEW SYSTEM */}
        <div className="xl:col-span-7 rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-[#EDF2FA] dark:bg-slate-900 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#15213B] dark:text-white">
                Live Storefront Modal Preview
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Uses the exact storefront modal component. No impressions counted or session state altered.
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => setPreviewViewport('desktop')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  previewViewport === 'desktop'
                    ? 'bg-[#145CFF] text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" /> Desktop
              </button>
              <button
                type="button"
                onClick={() => setPreviewViewport('tablet')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  previewViewport === 'tablet'
                    ? 'bg-[#145CFF] text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Tablet className="h-3.5 w-3.5" /> Tablet
              </button>
              <button
                type="button"
                onClick={() => setPreviewViewport('mobile')}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  previewViewport === 'mobile'
                    ? 'bg-[#145CFF] text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" /> Mobile
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-900/10 p-3 sm:p-4">
            <div className="mx-auto flex justify-center">
              <GlobalPromotionalPopupModal
                campaign={previewCampaignObject}
                open
                mode="preview"
                previewInline
                previewViewport={previewViewport}
                onClose={() =>
                  dispatch(
                    showToast({
                      variant: 'info',
                      message: 'Close button tested (preview mode does not dismiss).',
                    }),
                  )
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Instant Fullscreen Modal Preview (Bypasses 20s delay, no impression/session mutation) */}
      <GlobalPromotionalPopupModal
        campaign={previewCampaignObject}
        open={modalPreviewOpen}
        mode="preview"
        onClose={() => setModalPreviewOpen(false)}
      />
    </div>
  );
}
