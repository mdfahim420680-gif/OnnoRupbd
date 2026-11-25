import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
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
import { apiRequest } from '../../../services/api';
import { peekAdminQuery } from '../../../lib/adminQueryCache';
import { cachedApiRequest, useDebouncedValue } from '../../../lib/useAdminQuery';
import { useAppDispatch, useAppSelector } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import { hasPermission } from '../../../lib/rbac';
import type { CustomerGroupRecord, CustomerRecord } from '../../../types/commerce';
import { useSeoMeta } from '../../../lib/useSeoMeta';
import { UserAvatar } from '../../../components/ui/UserAvatar';

export function CustomersListPage() {
  useSeoMeta({ title: 'Registered Users & Customers | OnnoRupbd Admin', noIndex: true });
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.auth.user);
  const canManageStaff = Boolean(
    currentUser && hasPermission(currentUser.role, 'staff.manage', currentUser.customPermissions),
  );

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('customer');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'lastLogin'>('newest');
  const [page, setPage] = useState(1);

  const buildCustomersPath = useCallback(() => {
    const qs = new URLSearchParams();
    if (debouncedSearch.trim()) qs.set('q', debouncedSearch.trim());
    if (statusFilter) qs.set('status', statusFilter);
    if (groupFilter) qs.set('groupId', groupFilter);
    if (verifiedFilter) qs.set('isVerified', verifiedFilter);
    if (providerFilter) qs.set('provider', providerFilter);
    if (roleFilter) qs.set('role', roleFilter);
    qs.set('sortBy', sortBy);
    qs.set('page', String(page));
    qs.set('limit', '25');
    return `/api/admin/customers?${qs.toString()}`;
  }, [debouncedSearch, statusFilter, groupFilter, verifiedFilter, providerFilter, roleFilter, sortBy, page]);

  type CustomersResponse = {
    ok: true;
    customers: CustomerRecord[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
  type GroupsResponse = { ok: true; groups: CustomerGroupRecord[] };

  const initialCustCache = peekAdminQuery<CustomersResponse>(buildCustomersPath());
  const initialGrpCache = peekAdminQuery<GroupsResponse>('/api/admin/customer-groups');

  const [customers, setCustomers] = useState<CustomerRecord[]>(initialCustCache?.data.customers || []);
  const [groups, setGroups] = useState<CustomerGroupRecord[]>(initialGrpCache?.data.groups || []);
  const [pagination, setPagination] = useState(
    initialCustCache?.data.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 },
  );
  const [loading, setLoading] = useState(!initialCustCache);
  const [error, setError] = useState<string | null>(null);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    let active = true;
    cachedApiRequest<GroupsResponse>('/api/admin/customer-groups', { staleTimeMs: 120_000 })
      .then((res) => {
        if (active) setGroups(res.groups || []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(
    async (forceRefresh = false) => {
      const path = buildCustomersPath();
      const cached = forceRefresh ? null : peekAdminQuery<CustomersResponse>(path);
      if (cached) {
        setCustomers(cached.data.customers || []);
        if (cached.data.pagination) setPagination(cached.data.pagination);
        setLoading(false);
        if (cached.isFresh) return;
      } else {
        setLoading(true);
      }

      setError(null);
      const epoch = ++requestEpochRef.current;
      try {
        const custRes = await cachedApiRequest<CustomersResponse>(path, {
          staleTimeMs: 25_000,
          forceRefresh,
        });
        if (epoch !== requestEpochRef.current) return;
        setCustomers(custRes.customers || []);
        if (custRes.pagination) setPagination(custRes.pagination);
      } catch (err) {
        if (epoch === requestEpochRef.current && !cached) {
          setError(err instanceof Error ? err.message : 'Unable to load registered users.');
        }
      } finally {
        if (epoch === requestEpochRef.current) {
          setLoading(false);
        }
      }
    },
    [buildCustomersPath],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const handleToggleStatus = async (c: CustomerRecord) => {
    const next = c.status === 'suspended' ? 'active' : 'suspended';
    try {
      await apiRequest(`/api/admin/customers/${c.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      dispatch(showToast({ variant: 'success', message: `${c.name} is now ${next}.` }));
      load(true);
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Status update failed.' }));
    }
  };

  return (
    <AdminLayout>
      <PermissionGuard permission="customers.view">
        <div className="space-y-4 max-w-[1440px] mx-auto">
          <AdminPageHeader
            title="Registered Users & Customers"
            subtitle="Inspect customer profiles, verification status, authentication providers, registration dates, and account controls."
            breadcrumbs={[{ label: 'Customer' }, { label: 'All Customers' }]}
            actions={
              <Link
                to="/admin/customer-groups"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-3.5 py-2 text-xs font-semibold"
              >
                Manage Customer Groups
              </Link>
            }
          />

          <SearchFilterBar
            searchValue={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="Search name, email, or phone..."
            filters={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by user role"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="all">All Roles</option>
                  <option value="customer">Customers</option>
                  <option value="admin">Admins</option>
                  <option value="order_manager">Order Managers</option>
                  <option value="customer_support">Customer Support</option>
                </select>
                <select
                  value={verifiedFilter}
                  onChange={(e) => {
                    setVerifiedFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by email verification"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="">All Verification</option>
                  <option value="true">Verified</option>
                  <option value="false">Unverified</option>
                </select>
                <select
                  value={providerFilter}
                  onChange={(e) => {
                    setProviderFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by auth provider"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="">All Providers</option>
                  <option value="local">Email / Password</option>
                  <option value="google">Google</option>
                  <option value="facebook">Facebook</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by account status"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
                <select
                  value={groupFilter}
                  onChange={(e) => {
                    setGroupFilter(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Filter by customer group"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="">All Groups</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as typeof sortBy);
                    setPage(1);
                  }}
                  aria-label="Sort users"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                >
                  <option value="newest">Newest Registered</option>
                  <option value="oldest">Oldest Registered</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="lastLogin">Recent Login</option>
                </select>
              </div>
            }
          />

          {error && <ErrorBanner message={error} onRetry={() => load(true)} />}

          <DataTable<CustomerRecord>
            rows={customers}
            rowKey={(c) => c.id}
            loading={loading}
            pagination={pagination}
            onPageChange={setPage}
            emptyState={
              <EmptyStateCard
                icon={<Users className="h-6 w-6" />}
                title="No users found"
                description="Registered storefront accounts matching your filter criteria will appear here."
              />
            }
            columns={[
              {
                key: 'customer',
                header: 'User',
                render: (c) => (
                  <div className="flex items-center gap-2.5">
                    <UserAvatar user={c} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link to={`/admin/customers/${c.id}`} className="font-semibold text-[#101B35] dark:text-white hover:text-[#145CFF] truncate">
                          {c.name}
                        </Link>
                        {c.role && c.role !== 'customer' && (
                          <StatusBadge label={c.role.replace(/_/g, ' ')} tone="indigo" />
                        )}
                      </div>
                      <div className="text-[11px] text-[#64748B] truncate">
                        {c.email}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'provider',
                header: 'Origin & Linked',
                render: (c) => {
                  const origin = c.initialAuthProvider || c.authProvider || 'local';
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge
                        label={origin === 'google' ? 'Google' : origin === 'facebook' ? 'Facebook' : 'Email'}
                        tone={origin === 'google' || origin === 'facebook' ? 'blue' : 'slate'}
                      />
                      {c.linkedProviders?.google && origin !== 'google' && (
                        <StatusBadge label="+Google" tone="indigo" />
                      )}
                      {c.linkedProviders?.facebook && origin !== 'facebook' && (
                        <StatusBadge label="+Facebook" tone="indigo" />
                      )}
                      {c.linkedProviders?.local && origin !== 'local' && (
                        <StatusBadge label="+Email" tone="slate" />
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'verified',
                header: 'Verification',
                render: (c) => (
                  <StatusBadge
                    label={c.isVerified ? 'Verified' : 'Unverified'}
                    tone={c.isVerified ? 'emerald' : 'amber'}
                  />
                ),
              },
              {
                key: 'registered',
                header: 'Registered',
                render: (c) => (
                  <span className="font-mono-tabular text-xs text-[#64748B]">
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}
                  </span>
                ),
              },
              {
                key: 'orders',
                header: 'Orders / Spend',
                render: (c) => (
                  <div className="font-mono-tabular text-xs">
                    <span className="font-semibold text-[#101B35] dark:text-white">{c.orderCount}</span>
                    <span className="mx-1 text-slate-400">·</span>
                    <span className="font-bold text-[#145CFF]">৳{(c.totalSpent || 0).toLocaleString('en-IN')}</span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (c) => <StatusBadge label={c.status || 'active'} tone={statusToTone(c.status || 'active')} />,
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (c) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <Link
                      to={`/admin/customers/${c.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E4EAF5] dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-[#101B35] dark:text-slate-200 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5 text-[#145CFF]" /> Profile
                    </Link>
                    {c.role !== 'super_admin' &&
                      c.id !== currentUser?.id &&
                      (c.role === 'customer' || !c.role || canManageStaff) && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(c)}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                            c.status === 'suspended'
                              ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                          }`}
                        >
                          {c.status === 'suspended' ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5" /> Activate
                            </>
                          ) : (
                            <>
                              <ShieldAlert className="h-3.5 w-3.5" /> Suspend
                            </>
                          )}
                        </button>
                      )}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
