import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import { AdminPageHeader, ErrorBanner } from '../../../components/admin/ui';
import { DynamicBannerBuilder } from '../../../components/admin/banners/DynamicBannerBuilder';
import { peekAdminQuery } from '../../../lib/adminQueryCache';
import { cachedApiRequest } from '../../../lib/useAdminQuery';
import type { BannerRecord } from '../../../types/commerce';
import { useSeoMeta } from '../../../lib/useSeoMeta';

export function BannerFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  useSeoMeta({
    title: `${isEditing ? 'Edit' : 'Create'} Dynamic Banner | OnnoRupbd Admin`,
    noIndex: true,
  });

  const navigate = useNavigate();
  const bannerCacheKey = id ? `/api/admin/banners/${id}` : null;
  const initialBannerCache = bannerCacheKey
    ? peekAdminQuery<{ ok: true; banner: BannerRecord }>(bannerCacheKey)
    : null;

  const [loading, setLoading] = useState(() => (isEditing ? !initialBannerCache : false));
  const [error, setError] = useState<string | null>(null);
  const [initialBanner, setInitialBanner] = useState<BannerRecord | null>(() => initialBannerCache?.data.banner ?? null);

  useEffect(() => {
    if (!id || !bannerCacheKey) {
      setLoading(false);
      setInitialBanner(null);
      return;
    }
    let cancelled = false;
    if (!peekAdminQuery(bannerCacheKey)) {
      setLoading(true);
    }
    setError(null);
    cachedApiRequest<{ ok: true; banner: BannerRecord }>(bannerCacheKey, { staleTimeMs: 30_000 })
      .then((res) => {
        if (!cancelled) setInitialBanner(res.banner);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load banner.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, bannerCacheKey]);

  return (
    <AdminLayout>
      <PermissionGuard permission="cms.manage">
        <div className="space-y-4 max-w-[1320px] mx-auto">
          <AdminPageHeader
            title={isEditing ? 'Edit Dynamic Banner' : 'Create Dynamic Banner'}
            subtitle="Design layered backgrounds, typography, interactive buttons, and responsive grid placement."
            breadcrumbs={[
              { label: 'Marketing' },
              { label: 'Dynamic Banners', to: '/admin/banners' },
              { label: isEditing ? 'Edit' : 'Create' },
            ]}
            actions={
              <Link
                to="/admin/banners"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] bg-white px-3.5 py-2 text-xs font-semibold text-[#0A1F44] hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Banners
              </Link>
            }
          />

          {error && <ErrorBanner message={error} />}

          {loading ? (
            <div className="h-96 animate-pulse rounded-3xl border border-[#E4EAF5] bg-white" />
          ) : (
            <DynamicBannerBuilder
              initialBanner={initialBanner}
              bannerId={id || null}
              onClose={() => navigate('/admin/banners')}
              onSaved={() => navigate('/admin/banners')}
            />
          )}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
