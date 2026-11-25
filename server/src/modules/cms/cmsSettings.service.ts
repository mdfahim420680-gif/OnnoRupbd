import mongoose from 'mongoose';
import type { z } from 'zod';
import { BlogPostModel, CmsPageModel, FaqModel, HomepageConfigModel } from './cms.model';
import { SupportEnquiryModel } from '../support/support.model';
import { AppError } from '../../middleware/error.middleware';
import {
  adminCache,
  invalidateAdminCaches,
  invalidatePublicCatalogCaches,
  invalidateSecurityPolicyCache,
} from '../../utils/ttlCache';
import type { blogSchema, cmsPageSchema, faqSchema, homepageConfigPatchSchema } from './cmsSettings.validation';

export async function ensureHomepageConfig() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Record<string, unknown>>('cms:config');
    if (cached) return cached as unknown as ReturnType<typeof HomepageConfigModel.findOneAndUpdate>;
  }

  const config = await HomepageConfigModel.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  if (isDbConnected && config) {
    adminCache.set('cms:config', config, 30_000);
  }
  return config;
}

export async function updateHomepageConfigAdmin(patch: z.infer<typeof homepageConfigPatchSchema>) {
  const updated = await HomepageConfigModel.findOneAndUpdate(
    { key: 'main' },
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  invalidateAdminCaches('cms:');
  invalidateSecurityPolicyCache();
  invalidatePublicCatalogCaches();
  return updated;
}

export async function listCmsPagesAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Array<Record<string, unknown>>>('cms:pages');
    if (cached) return cached;
  }
  const pages = await CmsPageModel.find().sort({ slug: 1 }).lean();
  const result = pages.map((p) => ({ ...p, id: String(p._id) }));
  if (isDbConnected) adminCache.set('cms:pages', result, 30_000);
  return result;
}

export async function createCmsPageAdmin(input: z.infer<typeof cmsPageSchema>) {
  const page = await CmsPageModel.create(input);
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...page.toObject(), id: String(page._id) };
}

export async function updateCmsPageAdmin(id: string, input: z.infer<typeof cmsPageSchema>) {
  const updated = await CmsPageModel.findByIdAndUpdate(id, { $set: input }, { new: true });
  if (!updated) throw new AppError(404, 'PAGE_NOT_FOUND', 'CMS page not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...updated.toObject(), id: String(updated._id) };
}

export async function deleteCmsPageAdmin(id: string) {
  const deleted = await CmsPageModel.findByIdAndDelete(id);
  if (!deleted) throw new AppError(404, 'PAGE_NOT_FOUND', 'CMS page not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { deleted: true };
}

export async function listFaqsAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Array<Record<string, unknown>>>('cms:faqs');
    if (cached) return cached;
  }
  const faqs = await FaqModel.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  const result = faqs.map((f) => ({ ...f, id: String(f._id) }));
  if (isDbConnected) adminCache.set('cms:faqs', result, 30_000);
  return result;
}

export async function createFaqAdmin(input: z.infer<typeof faqSchema>) {
  const faq = await FaqModel.create(input);
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...faq.toObject(), id: String(faq._id) };
}

export async function updateFaqAdmin(id: string, input: z.infer<typeof faqSchema>) {
  const updated = await FaqModel.findByIdAndUpdate(id, { $set: input }, { new: true });
  if (!updated) throw new AppError(404, 'FAQ_NOT_FOUND', 'FAQ not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...updated.toObject(), id: String(updated._id) };
}

export async function deleteFaqAdmin(id: string) {
  const deleted = await FaqModel.findByIdAndDelete(id);
  if (!deleted) throw new AppError(404, 'FAQ_NOT_FOUND', 'FAQ not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { deleted: true };
}

export async function listBlogsAdmin() {
  const isDbConnected = mongoose.connection.readyState === 1;
  if (isDbConnected) {
    const cached = adminCache.get<Array<Record<string, unknown>>>('cms:blogs');
    if (cached) return cached;
  }
  const posts = await BlogPostModel.find().sort({ createdAt: -1 }).lean();
  const result = posts.map((p) => ({ ...p, id: String(p._id) }));
  if (isDbConnected) adminCache.set('cms:blogs', result, 30_000);
  return result;
}

export async function createBlogAdmin(input: z.infer<typeof blogSchema>) {
  const post = await BlogPostModel.create({
    ...input,
    publishedAt: input.isPublished ? new Date() : null,
  });
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...post.toObject(), id: String(post._id) };
}

export async function updateBlogAdmin(id: string, input: z.infer<typeof blogSchema>) {
  const updated = await BlogPostModel.findByIdAndUpdate(
    id,
    { $set: { ...input, publishedAt: input.isPublished ? new Date() : null } },
    { new: true },
  );
  if (!updated) throw new AppError(404, 'BLOG_NOT_FOUND', 'Blog post not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { ...updated.toObject(), id: String(updated._id) };
}

export async function deleteBlogAdmin(id: string) {
  const deleted = await BlogPostModel.findByIdAndDelete(id);
  if (!deleted) throw new AppError(404, 'BLOG_NOT_FOUND', 'Blog post not found.');
  invalidateAdminCaches('cms:');
  invalidatePublicCatalogCaches();
  return { deleted: true };
}

export async function listSupportEnquiriesAdmin() {
  const enquiries = await SupportEnquiryModel.find().sort({ createdAt: -1 }).limit(100).lean();
  return enquiries.map((e) => ({ ...e, id: String(e._id) }));
}

export async function updateSupportEnquiryAdmin(params: {
  id: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  internalNote?: string;
  actorName: string;
}) {
  const enquiry = await SupportEnquiryModel.findById(params.id);
  if (!enquiry) throw new AppError(404, 'ENQUIRY_NOT_FOUND', 'Enquiry not found.');
  enquiry.status = params.status;
  if (params.internalNote) {
    enquiry.internalNotes.push({ note: params.internalNote, actorName: params.actorName, timestamp: new Date() });
  }
  await enquiry.save();
  invalidateAdminCaches('overview:');
  invalidateAdminCaches('notifications');
  return { ...enquiry.toObject(), id: String(enquiry._id) };
}
