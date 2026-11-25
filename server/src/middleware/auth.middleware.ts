import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/env';
import { isDatabaseReady } from '../database/connection';
import { UserModel, type IUser } from '../modules/users/user.model';
import { AuthSessionModel } from '../modules/auth/authIdentity.model';
import { AuditLogModel } from '../modules/support/support.model';
import { adminAuthCache, invalidateAdminAuthCaches } from '../utils/ttlCache';
import { hasPermission, type Permission, type RoleName } from '../../../src/lib/rbac';

const AUTH_SNAPSHOT_TTL_MS = 10_000;

interface CachedAuthSnapshot {
  user: IUser;
  sessionExpiresAtMs: number | null;
  lastSeenSyncedAtMs: number;
}

export function invalidateAuthCacheForUser(userId?: string): void {
  invalidateAdminAuthCaches(userId);
}

export interface AuthJwtPayload {
  userId: string;
  role: RoleName;
  email: string;
  sid?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  sessionId?: string;
}

export function signAuthToken(
  user: { _id: unknown; role: RoleName; email: string },
  options?: { sessionId?: string; sessionTimeoutHours?: number },
): string {
  const payload: AuthJwtPayload = {
    userId: String(user._id),
    role: user.role,
    email: user.email,
    ...(options?.sessionId ? { sid: options.sessionId } : {}),
  };
  const hours = Math.min(720, Math.max(1, Number(options?.sessionTimeoutHours || 168)));
  return jwt.sign(payload, getJwtSecret(), { expiresIn: `${hours}h` });
}

function extractToken(req: Request): string | null {
  if (req.cookies && req.cookies.novara_token) {
    return String(req.cookies.novara_token);
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

async function verifyActiveSessionIfTracked(sid?: string): Promise<{ valid: boolean; expiresAtMs: number | null }> {
  if (!sid || !isDatabaseReady()) return { valid: true, expiresAtMs: null };
  try {
    const session = await AuthSessionModel.findOne({ sessionId: sid }).select('revokedAt expiresAt lastSeenAt').lean();
    if (!session) return { valid: true, expiresAtMs: null };
    if (session.revokedAt) return { valid: false, expiresAtMs: null };
    const expiresAtMs = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
    if (expiresAtMs && expiresAtMs <= Date.now()) return { valid: false, expiresAtMs };
    const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeenMs > 5 * 60 * 1000) {
      await AuthSessionModel.updateOne({ sessionId: sid }, { $set: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return { valid: true, expiresAtMs };
  } catch {
    return { valid: true, expiresAtMs: null };
  }
}

async function resolveAuthenticatedSnapshot(
  decoded: AuthJwtPayload,
): Promise<{ status: 'ok'; user: IUser } | { status: 'revoked' | 'not_found' | 'suspended' }> {
  const dbReady = isDatabaseReady();
  const cacheKey = `auth:${decoded.userId}:${decoded.sid || 'nosid'}`;

  if (dbReady) {
    const cached = adminAuthCache.get<CachedAuthSnapshot>(cacheKey);
    if (cached) {
      if (cached.sessionExpiresAtMs && cached.sessionExpiresAtMs <= Date.now()) {
        adminAuthCache.invalidatePrefix(cacheKey);
      } else {
        if (decoded.sid && Date.now() - cached.lastSeenSyncedAtMs > 5 * 60 * 1000) {
          cached.lastSeenSyncedAtMs = Date.now();
          AuthSessionModel.updateOne({ sessionId: decoded.sid }, { $set: { lastSeenAt: new Date() } }).catch(
            () => undefined,
          );
        }
        return { status: 'ok', user: cached.user };
      }
    }
  }

  const [sessionState, user] = await Promise.all([
    verifyActiveSessionIfTracked(decoded.sid),
    UserModel.findById(decoded.userId),
  ]);

  if (!sessionState.valid) {
    return { status: 'revoked' };
  }
  if (!user) {
    return { status: 'not_found' };
  }
  if (user.status !== 'active') {
    return { status: 'suspended' };
  }

  if (dbReady) {
    adminAuthCache.set<CachedAuthSnapshot>(
      cacheKey,
      {
        user,
        sessionExpiresAtMs: sessionState.expiresAtMs,
        lastSeenSyncedAtMs: Date.now(),
      },
      AUTH_SNAPSHOT_TTL_MS,
    );
  }

  return { status: 'ok', user };
}

export async function authenticateOptional(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }
    const decoded = jwt.verify(token, getJwtSecret()) as AuthJwtPayload;
    const resolved = await resolveAuthenticatedSnapshot(decoded);
    if (resolved.status === 'ok') {
      req.user = resolved.user;
      req.sessionId = decoded.sid;
    }
  } catch {
    // Invalid or expired optional token simply leaves req.user undefined
  }
  next();
}

export async function authenticateRequired(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required. Please sign in.' });
      return;
    }
    const decoded = jwt.verify(token, getJwtSecret()) as AuthJwtPayload;
    const resolved = await resolveAuthenticatedSnapshot(decoded);
    if (resolved.status !== 'ok') {
      if (resolved.status === 'revoked') {
        res.status(401).json({ ok: false, code: 'SESSION_REVOKED', error: 'Your session has been revoked or expired. Please sign in again.' });
        return;
      }
      if (resolved.status === 'not_found') {
        res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Account not found. Please sign in again.' });
        return;
      }
      res.status(403).json({ ok: false, code: 'ACCOUNT_SUSPENDED', error: 'This account has been suspended.' });
      return;
    }
    req.user = resolved.user;
    req.sessionId = decoded.sid;
    next();
  } catch {
    res.status(401).json({ ok: false, code: 'INVALID_TOKEN', error: 'Session expired or invalid. Please sign in again.' });
  }
}

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Authentication required.' });
      return;
    }
    if (!hasPermission(req.user.role, permission, req.user.customPermissions)) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        error: `Insufficient permissions. Required permission: ${permission}`,
      });
      return;
    }
    next();
  };
}

export async function recordAuditLog(params: {
  actor?: IUser | null;
  actorName?: string;
  actorRole?: string;
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
}): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: params.actor?._id ?? null,
      actorName: params.actor?.name || params.actorName || 'System',
      actorRole: params.actor?.role || params.actorRole || 'system',
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      summary: params.summary,
      metadata: params.metadata,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent?.slice(0, 500),
      requestId: params.requestId?.slice(0, 64),
      before: params.before,
      after: params.after,
    });
  } catch (err) {
    console.error('[NOVARA AUDIT] Failed to write audit log:', err);
  }
}
