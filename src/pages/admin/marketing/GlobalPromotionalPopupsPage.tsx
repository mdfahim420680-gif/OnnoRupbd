import { useCallback, useMemo, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  Layers,
  MousePointerClick,
  Pause,
  Percent,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import {
  AdminPageHeader,
  DataTable,
  EmptyStateCard,
  ErrorBanner,
  SearchFilterBar,
  StatusBadge,
  statusToTone,
} from '../../../components/admin/ui';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { ResilientImage } from '../../../components/ui/ResilientImage';
import { GlobalPromotionalPopupModal } from '../../../components/promotional/GlobalPromotionalPopupModal';
import { GlobalPopupCampaignEditor } from './GlobalPopupCampaignEditor';
import {
  type GlobalPopupCampaign,
  type GlobalPopupKpiSummary,
  type GlobalPopupPublicCampaign,
} from '../../../lib/globalPromotionalPopup';
import { apiRequest } from '../../../services/api';
import { peekAdminQuery } from '../../../lib/adminQueryCache';
import { cachedApiRequest, useDebouncedValue } from '../../../lib/useAdminQuery';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import { useSeoMeta } from '../../../lib/useSeoMeta';

function formatCampaignDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCampaignDateFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type GlobalPopupListPayload = {
  ok: true;
  campaigns: GlobalPopupCampaign[];
  summary: GlobalPopupKpiSummary;
};

const EMPTY_SUMMARY: GlobalPopupKpiSummary = {
  totalCampaigns: 0,
  activeCampaigns: 0,
  scheduledCampaigns: 0,
  pausedCampaigns: 0,
  expiredCampaigns: 0,
  draftCampaigns: 0,
  totalImpressions: 0,
  totalClicks: 0,
  clickThroughRate: 0,
};

function buildPopupsPath(search: string, statusFilter: string, typeFilter: string): string {
  const qs = new URLSearchParams();
  if (search.trim()) qs.set('q', search.trim());
  if (statusFilter) qs.set('status', statusFilter);
  if (typeFilter) qs.set('type', typeFilter);
  const query = qs.toString();
  return query ? `/api/admin/global-promotional-popups?${query}` : '/api/admin/global-promotional-popups';
}

function toPublicPreviewCampaign(c: GlobalPopupCampaign): GlobalPopupPublicCampaign {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    campaignType: c.campaignType,
    priority: c.priority,
    displayDelaySeconds: c.displayDelaySeconds,
    startAt: c.startAt,
    endAt: c.endAt,
    targeting: c.targeting,
    design: c.design,
    content: c.content,
    media: c.media,
    features: c.features,
    pricing: c.pricing,
    countdown: c.countdown,
    benefits: c.benefits,
    linkedProduct: c.linkedProduct,
  };
}

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  product_launch: 'Product Launch',
  flash_sale: 'Flash Sale',
  seasonal: 'Seasonal',
  clearance: 'Clearance',
  bundle: 'Bundle',
  announcement: 'Announcement',
};

export function GlobalPromotionalPopupsPage() {
  useSeoMeta({ title: 'Global Promotional Popup | OnnoRupbd Admin', noIndex: true });
  const dispatch = useAppDispatch();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const initialCached = peekAdminQuery<GlobalPopupListPayload>(buildPopupsPath('', '', ''));
  const [campaigns, setCampaigns] = useState<GlobalPopupCampaign[]>(() => initialCached?.data.campaigns || []);
  const [summary, setSummary] = useState<GlobalPopupKpiSummary>(() => initialCached?.data.summary || EMPTY_SUMMARY);
  const [loading, setLoading] = useState(!initialCached);
  const [error, setError] = useState<string | null>(null);

  // Editor & preview states
  const [editorMode, setEditorMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingCampaign, setEditingCampaign] = useState<GlobalPopupCampaign | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<GlobalPopupCampaign | null>(null);

  // Row mutations
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalPopupCampaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCampaigns = useCallback(
    async (forceRefresh = false) => {
      const path = buildPopupsPath(debouncedSearch, statusFilter, typeFilter);
      const cached = !forceRefresh ? peekAdminQuery<GlobalPopupListPayload>(path) : null;
      if (cached) {
        setCampaigns(cached.data.campaigns || []);
        setSummary(cached.data.summary || EMPTY_SUMMARY);
        setLoading(false);
        if (cached.isFresh) return;
      } else {
        setLoading(true);
      }

      setError(null);
      try {
        const res = await cachedApiRequest<GlobalPopupListPayload>(path, { staleTimeMs: 30_000, forceRefresh });
        setCampaigns(res.campaigns || []);
        setSummary(res.summary || EMPTY_SUMMARY);
      } catch (err) {
        if (!cached) {
          setError(err instanceof Error ? err.message : 'Unable to load global promotional popup campaigns.');
        }
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, statusFilter, typeFilter],
  );

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleOpenCreate = () => {
    setEditingCampaign(null);
    setEditorMode('create');
  };

  const handleOpenEdit = async (row: GlobalPopupCampaign) => {
    setLoadingDetailId(row.id);
    try {
      const res = await apiRequest<{ ok: true; campaign: GlobalPopupCampaign }>(
        `/api/admin/global-promotional-popups/${row.id}`,
      );
      setEditingCampaign(res.campaign || row);
      setEditorMode('edit');
    } catch {
      setEditingCampaign(row);
      setEditorMode('edit');
    } finally {
      setLoadingDetailId(null);
    }
  };

  const handleToggleStatus = async (row: GlobalPopupCampaign) => {
    const nextActive = !(row.effectiveStatus === 'active' || (row.enabled && row.status === 'active'));
    setTogglingId(row.id);
    try {
      await apiRequest(`/api/admin/global-promotional-popups/${row.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextActive ? 'active' : 'paused',
          enabled: nextActive,
        }),
      });
      dispatch(
        showToast({
          variant: 'success',
          message: nextActive ? `"${row.name}" activated globally.` : `"${row.name}" paused.`,
        }),
      );
      await loadCampaigns(true);
    } catch (err) {
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Unable to update campaign status.',
        }),
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    try {
      const res = await apiRequest<{ ok: true; campaign: GlobalPopupCampaign }>(
        `/api/admin/global-promotional-popups/${id}/duplicate`,
        { method: 'POST' },
      );
      dispatch(showToast({ variant: 'success', message: `Duplicated as "${res.campaign.name}".` }));
      if (editorMode !== 'list') {
        setEditingCampaign(res.campaign);
        setEditorMode('edit');
      }
      await loadCampaigns(true);
    } catch (err) {
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Unable to duplicate campaign.',
        }),
      );
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/admin/global-promotional-popups/${deleteTarget.id}`, { method: 'DELETE' });
      dispatch(showToast({ variant: 'success', message: `Deleted "${deleteTarget.name}".` }));
      setDeleteTarget(null);
      await loadCampaigns(true);
    } catch (err) {
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Unable to delete campaign.',
        }),
      );
    } finally {
      setDeleting(false);
    }
  };

  const kpiCards = useMemo(
    () => [
      {
        label: 'Total Campaigns',
        value: summary.totalCampaigns.toLocaleString(),
        icon: Layers,
        tone: 'text-[#145CFF] bg-blue-50 dark:bg-blue-950/40',
      },
      {
        label: 'Active Now',
        value: summary.activeCampaigns.toLocaleString(),
        icon: CheckCircle2,
        tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
      },
      {
        label: 'Scheduled / Paused / Expired',
        value: `${summary.scheduledCampaigns} / ${summary.pausedCampaigns} / ${summary.expiredCampaigns}`,
        icon: CalendarClock,
        tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
      },
      {
        label: 'Total Impressions',
        value: summary.totalImpressions.toLocaleString(),
        icon: Eye,
        tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40',
      },
      {
        label: 'Total Clicks',
        value: summary.totalClicks.toLocaleString(),
        icon: MousePointerClick,
        tone: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40',
      },
      {
        label: 'Click-Through Rate',
        value: `${summary.clickThroughRate.toFixed(2)}%`,
        icon: Percent,
        tone: 'text-violet-600 bg-violet-50 dark:bg-violet-950/40',
      },
    ],
    [summary],
  );

  return (
    <AdminLayout>
      <PermissionGuard permission="marketing.manage">
        <div className="space-y-5 max-w-[1520px] mx-auto">
          <AdminPageHeader
            title="Global Promotional Popup"
            subtitle="Manage scheduled high-converting promotional modals, countdown timers, product-linked pricing, and CTR analytics."
            breadcrumbs={[{ label: 'Marketing' }, { label: 'Global Promotional Popup' }]}
            actions={
              editorMode === 'list' ? (
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0E47D9]"
                >
                  <Plus className="h-4 w-4" /> Create Campaign
                </button>
              ) : undefined
            }
          />

          {editorMode !== 'list' ? (
            <GlobalPopupCampaignEditor
              key={editingCampaign?.id || 'create-new'}
              initialCampaign={editingCampaign}
              onCancel={() => {
                setEditorMode('list');
                setEditingCampaign(null);
              }}
              onSaved={() => {
                setEditorMode('list');
                setEditingCampaign(null);
                void loadCampaigns(true);
              }}
              onDuplicate={handleDuplicate}
            />
          ) : (
            <>
              {/* KPI Metrics Strip */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {kpiCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.label}
                      className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {card.label}
                        </span>
                        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${card.tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="mt-2 font-mono-tabular text-xl font-bold text-[#101B35] dark:text-white">
                        {card.value}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Search & Filters */}
              <SearchFilterBar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search campaign name, slug, or headline..."
                filters={
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Filter by status"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                    >
                      <option value="">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="paused">Paused</option>
                      <option value="draft">Draft</option>
                      <option value="expired">Expired</option>
                    </select>
                    <select
                      aria-label="Filter by campaign type"
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                    >
                      <option value="">All Campaign Types</option>
                      <option value="product_launch">Product Launch</option>
                      <option value="flash_sale">Flash Sale</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="clearance">Clearance</option>
                      <option value="bundle">Bundle</option>
                      <option value="announcement">Announcement</option>
                    </select>
                  </div>
                }
              />

              {error && <ErrorBanner message={error} onRetry={() => void loadCampaigns(true)} />}

              {/* Campaign Listing Table */}
              <DataTable<GlobalPopupCampaign>
                rows={campaigns}
                rowKey={(c) => c.id}
                loading={loading}
                emptyState={
                  <EmptyStateCard
                    icon={<Sparkles className="h-6 w-6" />}
                    title="No global promotional popups yet"
                    description="Launch a high-impact global promotional modal with live countdown, dynamic product pricing, and automatic CTR tracking."
                    action={
                      <button
                        type="button"
                        onClick={handleOpenCreate}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0E47D9]"
                      >
                        <Plus className="h-4 w-4" /> Create First Campaign
                      </button>
                    }
                  />
                }
                columns={[
                  {
                    key: 'name',
                    header: 'Campaign',
                    render: (c) => (
                      <div className="max-w-[165px]">
                        <div className="font-semibold text-[#101B35] dark:text-white truncate">{c.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          P{c.priority} · {c.displayDelaySeconds}s
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'preview',
                    header: 'Preview',
                    render: (c) => (
                      <div className="flex items-center gap-2 max-w-[165px]">
                        <div
                          className="h-9 w-11 shrink-0 overflow-hidden rounded-lg border border-[#E4EAF5] dark:border-slate-700"
                          style={{ backgroundColor: c.design.surfaceColor || '#EFF4FF' }}
                        >
                          <ResilientImage
                            src={c.media.desktopImageUrl || c.linkedProduct?.imageUrl || ''}
                            alt={c.media.imageAlt || c.name}
                            loading="eager"
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#101B35] dark:text-slate-100 truncate">
                            {c.content.mainHeading}
                          </div>
                          <div className="text-[11px] text-[#145CFF] font-semibold truncate">
                            {c.content.discountPercent ? `${c.content.discountPercent}% OFF` : c.content.offerBadgeText}
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (c) => (
                      <StatusBadge
                        label={CAMPAIGN_TYPE_LABELS[c.campaignType] || c.campaignType}
                        tone="indigo"
                      />
                    ),
                  },
                  {
                    key: 'linkedProduct',
                    header: 'Product',
                    render: (c) =>
                      c.linkedProduct ? (
                        <div className="max-w-[135px]">
                          <div className="text-xs font-semibold text-[#101B35] dark:text-white truncate">
                            {c.linkedProduct.name}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono-tabular truncate">
                            {c.linkedProduct.sku}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Standalone</span>
                      ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (c) => (
                      <StatusBadge
                        label={c.effectiveStatus}
                        tone={
                          c.effectiveStatus === 'scheduled'
                            ? 'blue'
                            : c.effectiveStatus === 'expired'
                              ? 'rose'
                              : statusToTone(c.effectiveStatus)
                        }
                      />
                    ),
                  },
                  {
                    key: 'startAt',
                    header: 'Start',
                    render: (c) => (
                      <span
                        title={c.startAt ? formatCampaignDateFull(c.startAt) : 'Immediate'}
                        className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap"
                      >
                        {c.startAt ? formatCampaignDate(c.startAt) : 'Immediate'}
                      </span>
                    ),
                  },
                  {
                    key: 'endAt',
                    header: 'End',
                    render: (c) => (
                      <span
                        title={c.endAt ? formatCampaignDateFull(c.endAt) : 'Ongoing'}
                        className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap"
                      >
                        {c.endAt ? formatCampaignDate(c.endAt) : 'Ongoing'}
                      </span>
                    ),
                  },
                  {
                    key: 'impressions',
                    header: 'Impr.',
                    align: 'right',
                    render: (c) => (
                      <span className="font-mono-tabular text-xs font-semibold text-[#101B35] dark:text-slate-100">
                        {c.analytics.impressions.toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'clicks',
                    header: 'Clicks / CTR',
                    align: 'right',
                    render: (c) => (
                      <div className="font-mono-tabular text-right">
                        <div className="text-xs font-semibold text-[#101B35] dark:text-slate-100">
                          {c.analytics.clicks.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-500">{c.analytics.ctr.toFixed(1)}%</div>
                      </div>
                    ),
                  },
                  {
                    key: 'actions',
                    header: 'Actions',
                    align: 'right',
                    render: (c) => {
                      const isLiveActive = c.effectiveStatus === 'active';
                      return (
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setPreviewCampaign(c)}
                            aria-label={`Preview ${c.name}`}
                            title="Preview popup"
                            className="inline-flex items-center justify-center rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Eye className="h-3.5 w-3.5 text-[#145CFF]" />
                          </button>
                          <button
                            type="button"
                            disabled={loadingDetailId === c.id}
                            onClick={() => void handleOpenEdit(c)}
                            aria-label={`Edit ${c.name}`}
                            title="Edit campaign"
                            className="inline-flex items-center justify-center rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5 text-[#145CFF]" />
                          </button>
                          <button
                            type="button"
                            disabled={duplicatingId === c.id}
                            onClick={() => void handleDuplicate(c.id)}
                            aria-label={`Duplicate ${c.name}`}
                            title="Duplicate campaign"
                            className="inline-flex items-center justify-center rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={togglingId === c.id}
                            onClick={() => void handleToggleStatus(c)}
                            aria-label={isLiveActive ? `Pause ${c.name}` : `Activate ${c.name}`}
                            title={isLiveActive ? 'Pause campaign' : 'Activate campaign'}
                            className={`inline-flex items-center justify-center rounded-lg border p-1.5 ${
                              isLiveActive
                                ? 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-300'
                            }`}
                          >
                            {isLiveActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            aria-label={`Delete ${c.name}`}
                            title="Delete campaign"
                            className="inline-flex items-center justify-center rounded-lg border border-rose-200 dark:border-rose-900/50 p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    },
                  },
                ]}
              />

              {/* Delete Confirmation Dialog */}
              <ConfirmDialog
                open={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleConfirmDelete}
                title="Delete Promotional Popup Campaign"
                message={`Delete "${deleteTarget?.name}"? All impressions and click statistics for this campaign will be permanently removed.`}
                confirmLabel="Delete Campaign"
                destructive
                loading={deleting}
              />

              {/* Instant Modal Preview */}
              {previewCampaign && (
                <GlobalPromotionalPopupModal
                  campaign={toPublicPreviewCampaign(previewCampaign)}
                  open={Boolean(previewCampaign)}
                  onClose={() => setPreviewCampaign(null)}
                  mode="preview"
                />
              )}
            </>
          )}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
