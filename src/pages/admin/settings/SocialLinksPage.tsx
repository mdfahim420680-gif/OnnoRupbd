import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Globe, Plus, Save, Trash2 } from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import { AdminPageHeader, ErrorBanner, LoadingCards } from '../../../components/admin/ui';
import { useAdminSettings } from './useAdminSettings';
import { useSeoMeta } from '../../../lib/useSeoMeta';

export function SocialLinksPage() {
  useSeoMeta({ title: 'Social Media & Contact Links | OnnoRupbd Admin', noIndex: true });
  const { config, loading, saving, error, load, savePatch } = useAdminSettings();

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  type SocialLink = {
    id?: string;
    platform: 'facebook' | 'youtube' | 'x' | 'instagram' | 'linkedin' | 'tiktok' | 'whatsapp' | 'telegram' | 'messenger' | 'pinterest' | 'other';
    label: string;
    url: string;
    enabled: boolean;
    displayOrder: number;
  };
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);

  const platformOptions: Array<{ value: SocialLink['platform']; label: string }> = [
    { value: 'facebook', label: 'Facebook' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'x', label: 'X (Twitter)' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'messenger', label: 'Messenger' },
    { value: 'pinterest', label: 'Pinterest' },
    { value: 'other', label: 'Other' },
  ];

  useEffect(() => {
    const c = config?.contactInfo;
    if (!c) return;
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setAddress(c.address || '');
    if (Array.isArray(c.socialLinks) && c.socialLinks.length > 0) {
      setSocialLinks(c.socialLinks.map((link, index) => ({
        ...link,
        enabled: link.enabled !== false,
        displayOrder: Number.isFinite(link.displayOrder) ? link.displayOrder : index,
      })).sort((a, b) => a.displayOrder - b.displayOrder));
    } else {
      setSocialLinks([
        ['facebook', 'Facebook', c.facebookUrl],
        ['youtube', 'YouTube', c.youtubeUrl],
        ['x', 'X (Twitter)', c.xUrl],
        ['instagram', 'Instagram', c.instagramUrl],
        ['linkedin', 'LinkedIn', c.linkedinUrl],
        ['tiktok', 'TikTok', c.tiktokUrl],
        ['whatsapp', 'WhatsApp', c.whatsappUrl],
        ['messenger', 'Messenger', c.messengerUrl],
      ].flatMap(([platform, label, url], index) => url ? [{
        id: `legacy-${platform}`,
        platform: platform as SocialLink['platform'],
        label: String(label),
        url: String(url),
        enabled: true,
        displayOrder: index,
      }] : []));
    }
  }, [config]);

  const normalizeLinks = (links: SocialLink[]) =>
    links.map((link, displayOrder) => ({ ...link, displayOrder }));

  const updateSocialLink = (id: string, patch: Partial<SocialLink>) => {
    setSocialLinks((links) => normalizeLinks(
      links.map((link) => link.id === id ? { ...link, ...patch } : link),
    ));
  };

  const addSocialLink = () => {
    setSocialLinks((links) => normalizeLinks([
      ...links,
      {
        id: `social-${Date.now()}-${links.length}`,
        platform: 'facebook',
        label: 'Facebook',
        url: '',
        enabled: true,
        displayOrder: links.length,
      },
    ]));
  };

  const removeSocialLink = (id: string) => {
    setSocialLinks((links) => normalizeLinks(links.filter((link) => link.id !== id)));
  };

  const moveSocialLink = (id: string, direction: -1 | 1) => {
    setSocialLinks((links) => {
      const index = links.findIndex((link) => link.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= links.length) return links;
      const reordered = [...links];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, moved);
      return normalizeLinks(reordered);
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const normalizedLinks = normalizeLinks(socialLinks);
    await savePatch(
      {
        contactInfo: {
          phone,
          email,
          address,
          socialLinks: normalizedLinks,
        },
      },
      'Contact & social links updated.',
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('novara:navigation-updated'));
    }
  };

  return (
    <AdminLayout>
      <PermissionGuard permission="cms.manage">
        <div className="space-y-5 max-w-[960px] mx-auto">
          <AdminPageHeader
            title="Social Media & Contact Links"
            subtitle="Manage storefront contact channels, Dhaka showroom address, and official social network URLs."
            breadcrumbs={[{ label: 'Website Management' }, { label: 'Social Media Links' }]}
          />

          {error && <ErrorBanner message={error} onRetry={load} />}
          {loading ? (
            <LoadingCards count={2} />
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-6 shadow-xs space-y-5"
            >
              <div className="flex items-center gap-2 text-sm font-bold">
                <Globe className="h-4 w-4 text-[#145CFF]" /> Public Contact & Social Channels
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Hotline Phone</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+880 1700-000000"
                    className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Public Support Email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="support@onnorupbd.com"
                    className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold">Showroom / Office Address</label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 text-xs"
                  />
                </div>
              </div>

              <div className="border-t border-[#E4EAF5] pt-5 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold">Social Media Links</h3>
                    <p className="mt-1 text-xs text-slate-500">Add, enable, reorder, update, or remove public social icons.</p>
                  </div>
                  <button type="button" onClick={addSocialLink} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#DCE5F7] px-3 text-xs font-semibold text-[#145CFF] hover:bg-[#F4F7FF]">
                    <Plus className="h-3.5 w-3.5" /> Add Link
                  </button>
                </div>
                <div className="space-y-3">
                  {socialLinks.map((link, index) => (
                    <div key={link.id || `social-${index}`} className="grid items-end gap-3 rounded-xl border border-[#E4EAF5] p-3 dark:border-slate-800 sm:grid-cols-[150px_130px_minmax(0,1fr)_80px_auto]">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold">Platform</label>
                        <select value={link.platform} onChange={(e) => {
                          const platform = e.target.value as SocialLink['platform'];
                          const option = platformOptions.find((item) => item.value === platform);
                          updateSocialLink(link.id || '', { platform, label: option?.label || 'Social Link' });
                        }} className="h-9 w-full rounded-lg border border-[#E4EAF5] bg-[#F4F7FF] px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                          {platformOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold">Accessible label</label>
                        <input value={link.label} onChange={(e) => updateSocialLink(link.id || '', { label: e.target.value })} className="h-9 w-full rounded-lg border border-[#E4EAF5] bg-[#F4F7FF] px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold">Profile URL</label>
                        <input type="url" value={link.url} onChange={(e) => updateSocialLink(link.id || '', { url: e.target.value })} placeholder="https://..." className="h-9 w-full rounded-lg border border-[#E4EAF5] bg-[#F4F7FF] px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                      </div>
                      <label className="flex h-9 items-center gap-2 text-xs">
                        <input type="checkbox" checked={link.enabled} onChange={(e) => updateSocialLink(link.id || '', { enabled: e.target.checked })} />
                        Enabled
                      </label>
                      <div className="flex h-9 items-center gap-1">
                        <button type="button" title="Move up" onClick={() => moveSocialLink(link.id || '', -1)} disabled={index === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Move down" onClick={() => moveSocialLink(link.id || '', 1)} disabled={index === socialLinks.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" title="Delete" onClick={() => removeSocialLink(link.id || '')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                  {socialLinks.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-500">No social media links configured.</p>}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#145CFF] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#0E47D9] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Social Links'}
                </button>
              </div>
            </form>
          )}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
