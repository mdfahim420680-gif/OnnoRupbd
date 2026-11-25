import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Package,
  Plus,
  Trash2,
  Upload,
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
import { ConfirmDialog, Modal } from '../../../components/ui/Modal';
import { ResilientImage } from '../../../components/ui/ResilientImage';
import { ApiError, apiRequest, downloadAuthenticatedFile } from '../../../services/api';
import { peekAdminQuery } from '../../../lib/adminQueryCache';
import { cachedApiRequest, useDebouncedValue } from '../../../lib/useAdminQuery';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import type { CategoryItem, ProductItem } from '../../../types/commerce';
import { useSeoMeta } from '../../../lib/useSeoMeta';
import { parseCsvRows } from '../../../lib/csv';

function slugify(val: string) {
  return val
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ProductsListPage() {
  useSeoMeta({ title: 'All Products | OnnoRupbd Admin', noIndex: true });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);

  const buildProductsPath = useCallback(() => {
    const qs = new URLSearchParams();
    if (debouncedSearch.trim()) qs.set('q', debouncedSearch.trim());
    if (statusFilter) qs.set('status', statusFilter);
    if (categoryFilter) qs.set('categoryId', categoryFilter);
    qs.set('page', String(page));
    qs.set('limit', '20');
    return `/api/admin/products?${qs.toString()}`;
  }, [debouncedSearch, statusFilter, categoryFilter, page]);

  type ProductsResponse = {
    ok: true;
    products: ProductItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
  type CategoriesResponse = { ok: true; categories: CategoryItem[] };

  const initialProdCache = peekAdminQuery<ProductsResponse>(buildProductsPath());
  const initialCatCache = peekAdminQuery<CategoriesResponse>('/api/admin/categories');

  const [products, setProducts] = useState<ProductItem[]>(initialProdCache?.data.products || []);
  const [categories, setCategories] = useState<CategoryItem[]>(initialCatCache?.data.categories || []);
  const [pagination, setPagination] = useState(
    initialProdCache?.data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
  );
  const [loading, setLoading] = useState(!initialProdCache);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ item: ProductItem; permanent: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvInput, setCsvInput] = useState('');
  const [csvResult, setCsvResult] = useState<{
    importedCount: number;
    errors: Array<{ row: number; sku: string; error: string }>;
  } | null>(null);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    let active = true;
    cachedApiRequest<CategoriesResponse>('/api/admin/categories', { staleTimeMs: 120_000 })
      .then((res) => {
        if (active) setCategories(res.categories || []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const loadData = useCallback(
    async (forceRefresh = false) => {
      const productsPath = buildProductsPath();
      const cached = forceRefresh ? null : peekAdminQuery<ProductsResponse>(productsPath);
      if (cached) {
        setProducts(cached.data.products || []);
        if (cached.data.pagination) setPagination(cached.data.pagination);
        setLoading(false);
        if (cached.isFresh) return;
      } else {
        setLoading(true);
      }

      setError(null);
      const epoch = ++requestEpochRef.current;
      try {
        const prodRes = await cachedApiRequest<ProductsResponse>(productsPath, {
          staleTimeMs: 30_000,
          forceRefresh,
        });
        if (epoch !== requestEpochRef.current) return;
        setProducts(prodRes.products || []);
        if (prodRes.pagination) setPagination(prodRes.pagination);
      } catch (err) {
        if (epoch === requestEpochRef.current && !cached) {
          setError(err instanceof Error ? err.message : 'Unable to load products.');
        }
      } finally {
        if (epoch === requestEpochRef.current) {
          setLoading(false);
        }
      }
    },
    [buildProductsPath],
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const handleTogglePublish = async (p: ProductItem) => {
    const nextStatus = p.status === 'published' ? 'draft' : 'published';
    setTogglingId(p.id);
    try {
      await apiRequest(`/api/admin/products/${p.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      dispatch(
        showToast({
          variant: 'success',
          message:
            nextStatus === 'published'
              ? `"${p.name}" published to storefront.`
              : `"${p.name}" moved to draft.`,
        }),
      );
      loadData(true);
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Status update failed.' }));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDuplicate = async (p: ProductItem) => {
    try {
      const res = await apiRequest<{ ok: true; product: ProductItem }>(`/api/admin/products/${p.id}/duplicate`, {
        method: 'POST',
      });
      dispatch(showToast({ variant: 'success', message: `Duplicated "${p.name}" as draft.` }));
      if (res.product?.id) {
        navigate(`/admin/products/${res.product.id}/edit`);
      } else {
        loadData(true);
      }
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Duplicate failed.' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(
        `/api/admin/products/${deleteTarget.item.id}?permanent=${deleteTarget.permanent ? 'true' : 'false'}`,
        { method: 'DELETE' },
      );
      dispatch(
        showToast({
          variant: 'info',
          message: deleteTarget.permanent
            ? `Permanently deleted "${deleteTarget.item.name}".`
            : `Archived "${deleteTarget.item.name}".`,
        }),
      );
      setDeleteTarget(null);
      loadData(true);
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Action failed.' }));
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkAction = async (action: 'publish' | 'draft' | 'archive' | 'delete') => {
    if (selectedIds.length === 0) return;
    try {
      const res = await apiRequest<{ ok: true; modifiedCount: number }>('/api/admin/products/bulk/action', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds, action }),
      });
      dispatch(showToast({ variant: 'success', message: `Bulk ${action} applied to ${res.modifiedCount} items.` }));
      setSelectedIds([]);
      loadData(true);
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Bulk action failed.' }));
    }
  };

  const handleCsvImport = async (e: FormEvent) => {
    e.preventDefault();
    setCsvResult(null);
    let records: string[][];
    try {
      records = parseCsvRows(csvInput.replace(/^\uFEFF/, ''));
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Invalid CSV format.' }));
      return;
    }
    if (records.length < 2) {
      dispatch(showToast({ variant: 'warning', message: 'Paste a header row and at least one product row.' }));
      return;
    }
    const header = records[0].map((cell) => cell.trim().toLowerCase());
    const requiredHeaders = ['sku', 'name', 'categoryslug', 'baseprice', 'stockonhand'];
    const missingHeaders = requiredHeaders.filter((key) => !header.includes(key));
    if (missingHeaders.length > 0) {
      dispatch(
        showToast({
          variant: 'error',
          message: `CSV is missing required columns: ${missingHeaders.join(', ')}.`,
        }),
      );
      return;
    }
    const localErrors: Array<{ row: number; sku: string; error: string }> = [];
    const rows = records.slice(1).flatMap((cols, index) => {
      const sourceRow = index + 2;
      const value = (name: string) => {
        const columnIndex = header.indexOf(name);
        return columnIndex >= 0 ? (cols[columnIndex] || '').trim() : '';
      };
      if (cols.length > header.length && cols.slice(header.length).some((cell) => cell.trim())) {
        localErrors.push({
          row: sourceRow,
          sku: value('sku'),
          error: 'Row contains more columns than the CSV header.',
        });
        return [];
      }
      const name = value('name');
      const basePrice = value('baseprice');
      const stockOnHand = value('stockonhand');
      return [{
        sourceRow,
        sku: value('sku'),
        name,
        slug: value('slug') || slugify(name),
        categorySlug: value('categoryslug'),
        brandName: value('brandname'),
        basePrice: basePrice ? Number(basePrice) : Number.NaN,
        salePrice: value('saleprice') ? Number(value('saleprice')) : null,
        stockOnHand: stockOnHand ? Number(stockOnHand) : 0,
        status: value('status') || 'draft',
        description: value('description') || `${name || 'Product'} imported via bulk CSV`,
      }];
    });
    if (rows.length === 0) {
      setCsvResult({ importedCount: 0, errors: localErrors });
      return;
    }
    try {
      const res = await apiRequest<{
        ok: boolean;
        importedCount: number;
        errors: Array<{ row: number; sku: string; error: string }>;
      }>('/api/admin/products/bulk/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setCsvResult({ importedCount: res.importedCount, errors: [...localErrors, ...(res.errors || [])] });
      if (res.importedCount > 0) {
        dispatch(showToast({ variant: 'success', message: `Imported ${res.importedCount} products.` }));
        loadData(true);
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        typeof err.details === 'object' &&
        err.details !== null &&
        'errors' in err.details &&
        Array.isArray(err.details.errors)
      ) {
        setCsvResult({ importedCount: 0, errors: [...localErrors, ...err.details.errors] });
        return;
      }
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'CSV import failed.' }));
    }
  };

  return (
    <AdminLayout>
      <PermissionGuard permission="catalog.view">
        <div className="space-y-4 max-w-[1440px] mx-auto">
          <AdminPageHeader
            title="All Products"
            subtitle="Manage store SKUs, pricing, inventory levels, merchandising flags, and CSV bulk sync."
            breadcrumbs={[{ label: 'Product Management' }, { label: 'All Products' }]}
            actions={
              <>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await downloadAuthenticatedFile('/api/admin/products/bulk/export', 'onnorupbd-products.csv');
                    } catch (err) {
                      dispatch(
                        showToast({
                          variant: 'error',
                          message: err instanceof Error ? err.message : 'Unable to export CSV.',
                        }),
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-3.5 py-2 text-xs font-semibold text-[#101B35] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCsvResult(null);
                    setCsvModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-3.5 py-2 text-xs font-semibold text-[#101B35] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Upload className="h-3.5 w-3.5" /> Import CSV
                </button>
                <Link
                  to="/admin/products/new"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0E47D9]"
                >
                  <Plus className="h-4 w-4" /> Add Product
                </Link>
              </>
            }
          />

          <SearchFilterBar
            searchValue={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="Search product name, SKU, slug, or brand..."
            filters={
              <>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by category"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs text-[#101B35] dark:text-slate-100"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by status"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs text-[#101B35] dark:text-slate-100"
                >
                  <option value="">All Statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </>
            }
          />

          {error && <ErrorBanner message={error} onRetry={() => loadData(true)} />}

          <DataTable<ProductItem>
            rows={products}
            rowKey={(p) => p.id}
            loading={loading}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            pagination={pagination}
            onPageChange={setPage}
            bulkActions={
              <>
                <button
                  type="button"
                  onClick={() => handleBulkAction('publish')}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                >
                  Publish Selected
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction('draft')}
                  className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
                >
                  Move to Draft
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction('archive')}
                  className="rounded-lg bg-slate-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction('delete')}
                  className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                >
                  Delete Safe
                </button>
              </>
            }
            emptyState={
              <EmptyStateCard
                icon={<Package className="h-6 w-6" />}
                title="No products found"
                description="Add your first product or adjust your search/status filters."
                action={
                  <Link
                    to="/admin/products/new"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Plus className="h-4 w-4" /> Add Product
                  </Link>
                }
              />
            }
            columns={[
              {
                key: 'product',
                header: 'Product',
                render: (p) => {
                  const catName = typeof p.categoryId === 'object' ? p.categoryId?.name : '';
                  return (
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900">
                        <ResilientImage src={p.images?.[0]?.url} alt={p.name} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <Link
                          to={`/admin/products/${p.id}`}
                          className="font-semibold text-[#101B35] dark:text-white hover:text-[#145CFF] line-clamp-1"
                        >
                          {p.name}
                        </Link>
                        <div className="text-[11px] text-[#64748B] dark:text-slate-400">
                          <span className="font-mono-tabular">{p.sku}</span>
                          {catName ? ` · ${catName}` : ''}
                          {p.brandName ? ` · ${p.brandName}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                },
              },
              {
                key: 'price',
                header: 'Pricing',
                render: (p) => (
                  <div>
                    <div className="font-mono-tabular font-bold text-[#101B35] dark:text-white">
                      ৳{(p.currentPrice ?? p.salePrice ?? p.basePrice).toLocaleString('en-IN')}
                    </div>
                    {p.salePrice != null && p.salePrice < p.basePrice && (
                      <div className="font-mono-tabular text-[11px] text-slate-400 line-through">
                        ৳{p.basePrice.toLocaleString('en-IN')}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'stock',
                header: 'Stock',
                render: (p) => {
                  const totalStock =
                    p.hasVariants && p.variants?.length
                      ? p.variants.reduce((sum, v) => sum + Number(v.stockOnHand || 0), 0)
                      : Number(p.stockOnHand || 0);
                  const low = totalStock <= (p.lowStockThreshold || 5);
                  return (
                    <div>
                      <span
                        className={`font-mono-tabular font-semibold ${
                          totalStock === 0 ? 'text-rose-600' : low ? 'text-amber-600' : 'text-emerald-600'
                        }`}
                      >
                        {totalStock} units
                      </span>
                      {p.hasVariants && (
                        <div className="text-[10.5px] text-slate-400">{p.variants?.length || 0} variants</div>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (p) => <StatusBadge label={p.status} tone={statusToTone(p.status)} />,
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (p) => (
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/admin/products/${p.id}`}
                      title="View product details"
                      className="rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      type="button"
                      disabled={togglingId === p.id}
                      onClick={() => handleTogglePublish(p)}
                      title={p.status === 'published' ? 'Unpublish to Draft' : 'Publish Live'}
                      className="rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {p.status === 'published' ? <EyeOff className="h-3.5 w-3.5 text-amber-500" /> : <Eye className="h-3.5 w-3.5 text-emerald-600" />}
                    </button>
                    <Link
                      to={`/admin/products/${p.id}/edit`}
                      title="Edit product"
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E4EAF5] dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-[#101B35] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-[#145CFF]" /> Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(p)}
                      title="Duplicate as draft"
                      className="rounded-lg border border-[#E4EAF5] dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ item: p, permanent: p.status === 'archived' })}
                      title={p.status === 'archived' ? 'Permanently delete' : 'Archive product'}
                      className="rounded-lg border border-rose-200 dark:border-rose-900/50 p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ),
              },
            ]}
          />

          <ConfirmDialog
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            onConfirm={handleDeleteConfirm}
            title={deleteTarget?.permanent ? 'Delete Product Permanently' : 'Archive Product'}
            message={
              deleteTarget?.permanent
                ? `Permanently delete "${deleteTarget.item.name}"? Products linked to historical orders cannot be permanently deleted.`
                : `Archive "${deleteTarget?.item.name}"? It will be hidden from the public storefront immediately.`
            }
            confirmLabel={deleteTarget?.permanent ? 'Delete Permanently' : 'Archive'}
            destructive
            loading={deleting}
          />

          <Modal open={csvModalOpen} onClose={() => setCsvModalOpen(false)} title="Bulk CSV Product Import" size="lg">
            <form onSubmit={handleCsvImport} className="space-y-4">
              <p className="text-xs text-[#64748B] dark:text-slate-400">
                Paste CSV rows with columns:{' '}
                <code className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px]">
                  sku,name,slug,categorySlug,brandName,basePrice,salePrice,stockOnHand,status,description
                </code>
              </p>
              <textarea
                rows={7}
                value={csvInput}
                onChange={(e) => setCsvInput(e.target.value)}
                placeholder={`sku,name,slug,categorySlug,brandName,basePrice,salePrice,stockOnHand,status,description\nONN-USB-01,OnnoRupbd 65W GaN Charger,onnorupbd-65w-gan-charger,electronics,OnnoRupbd,2450,1990,40,published,Fast multi-port GaN USB-C wall adapter`}
                className="w-full rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 p-3 font-mono-tabular text-xs text-[#101B35] dark:text-slate-100"
              />
              {csvResult && (
                <div className="rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 p-3 text-xs">
                  <p className="font-semibold text-emerald-600">Imported: {csvResult.importedCount} products</p>
                  {csvResult.errors.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-rose-600 space-y-1">
                      {csvResult.errors.map((err, i) => (
                        <li key={i}>
                          Row {err.row} ({err.sku}): {err.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="rounded-xl border border-[#E4EAF5] dark:border-slate-700 px-4 py-2 text-xs font-semibold text-[#101B35] dark:text-slate-200"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#145CFF] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0E47D9]"
                >
                  Import Rows
                </button>
              </div>
            </form>
          </Modal>
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
