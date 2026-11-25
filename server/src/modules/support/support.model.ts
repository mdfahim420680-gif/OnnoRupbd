import mongoose, { Schema, type Document } from 'mongoose';

export interface ISupportEnquiry extends Document {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  orderNumber?: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assignedTo?: mongoose.Types.ObjectId | null;
  internalNotes: Array<{ note: string; actorName: string; timestamp: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

const SupportEnquirySchema = new Schema<ISupportEnquiry>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 24 },
    subject: { type: String, required: true, trim: true, maxlength: 140 },
    orderNumber: { type: String, trim: true, maxlength: 40 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    internalNotes: {
      type: [
        {
          note: { type: String, required: true },
          actorName: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const SupportEnquiryModel =
  mongoose.models.SupportEnquiry || mongoose.model<ISupportEnquiry>('SupportEnquiry', SupportEnquirySchema);

export interface INewsletterSubscription extends Document {
  email: string;
  status: 'subscribed' | 'unsubscribed';
  consentRecordedAt: Date;
  unsubscribedAt?: Date | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const NewsletterSubscriptionSchema = new Schema<INewsletterSubscription>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['subscribed', 'unsubscribed'], default: 'subscribed' },
    consentRecordedAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date, default: null },
    source: { type: String, default: 'homepage_newsletter' },
  },
  { timestamps: true },
);

export const NewsletterSubscriptionModel =
  mongoose.models.NewsletterSubscription ||
  mongoose.model<INewsletterSubscription>('NewsletterSubscription', NewsletterSubscriptionSchema);

export interface IAuditLog extends Document {
  actorId?: mongoose.Types.ObjectId | null;
  actorName: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true, index: true },
    resourceId: { type: String },
    summary: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String, maxlength: 80 },
    userAgent: { type: String, maxlength: 500 },
    requestId: { type: String, maxlength: 64 },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuditLogModel = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorName: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, createdAt: -1 });

export interface INotificationRecord extends Document {
  to: string;
  channel: 'email';
  template: string;
  subject: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped_unconfigured';
  providerId?: string;
  error?: string;
  createdAt: Date;
}

const NotificationRecordSchema = new Schema<INotificationRecord>(
  {
    to: { type: String, required: true, index: true },
    channel: { type: String, enum: ['email'], default: 'email' },
    template: { type: String, required: true },
    subject: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped_unconfigured'],
      default: 'queued',
    },
    providerId: { type: String },
    error: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const NotificationRecordModel =
  mongoose.models.NotificationRecord || mongoose.model<INotificationRecord>('NotificationRecord', NotificationRecordSchema);

export interface ISearchAnalytics extends Document {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  createdAt: Date;
}

const SearchAnalyticsSchema = new Schema<ISearchAnalytics>(
  {
    query: { type: String, required: true },
    normalizedQuery: { type: String, required: true, index: true },
    resultCount: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SearchAnalyticsModel =
  mongoose.models.SearchAnalytics || mongoose.model<ISearchAnalytics>('SearchAnalytics', SearchAnalyticsSchema);

export interface ISiteVisit extends Document {
  sessionKey: string;
  path: string;
  referrer?: string;
  userAgent?: string;
  createdAt: Date;
}

const SiteVisitSchema = new Schema<ISiteVisit>(
  {
    sessionKey: { type: String, required: true, index: true },
    path: { type: String, required: true, default: '/' },
    referrer: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

SiteVisitSchema.index({ createdAt: -1 });

export const SiteVisitModel =
  mongoose.models.SiteVisit || mongoose.model<ISiteVisit>('SiteVisit', SiteVisitSchema);

export interface ISystemLog extends Document {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  source: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  errorName?: string;
  createdAt: Date;
}

const SystemLogSchema = new Schema<ISystemLog>(
  {
    level: { type: String, enum: ['debug', 'info', 'warn', 'error', 'fatal'], default: 'info', index: true },
    source: { type: String, required: true, index: true },
    message: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
    requestId: { type: String, maxlength: 64, index: true },
    errorName: { type: String, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

SystemLogSchema.index({ createdAt: -1 });

export const SystemLogModel =
  mongoose.models.SystemLog || mongoose.model<ISystemLog>('SystemLog', SystemLogSchema);

