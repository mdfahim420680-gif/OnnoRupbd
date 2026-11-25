import type { Response, NextFunction } from 'express';
import { z } from 'zod';
import { isKnownPermission } from '../../../../src/lib/rbac';
import { recordAuditLog, type AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ROLE_PERMISSIONS } from '../../../../src/lib/rbac';
import {
  createStaffAdmin,
  deleteStaffAdmin,
  getSystemHealthDiagnostics,
  listAuditLogsAdmin,
  listStaffAdmin,
  listSystemLogsAdmin,
  resetStaffPasswordAdmin,
  updateStaffAdmin,
} from './system.service';

export function getRolesController(_req: AuthenticatedRequest, res: Response) {
  sendSuccess(res, { roles: ROLE_PERMISSIONS });
}

export async function listStaffController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await listStaffAdmin({
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 25),
      q: String(req.query.q || ''),
      role: String(req.query.role || 'all'),
      status: String(req.query.status || 'all'),
    });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function createStaffController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.string().trim().email().toLowerCase(),
        password: z.string().min(8).max(128),
        role: z.enum([
          'admin',
          'order_manager',
          'inventory_manager',
          'catalog_manager',
          'customer_support',
          'finance_accounts',
        ]),
        customPermissions: z.array(z.string()).default([]),
      })
      .refine((value) => value.customPermissions.every(isKnownPermission), {
        message: 'customPermissions contains an unknown permission identifier.',
        path: ['customPermissions'],
      })
      .parse(req.body);
    const staff = await createStaffAdmin(parsed);
    await recordAuditLog({
      actor: req.user,
      action: 'staff.create',
      resourceType: 'User',
      resourceId: staff.id,
      summary: `Created staff member ${staff.email} with role ${staff.role}`,
    });
    sendCreated(res, { staff });
  } catch (err) {
    next(err);
  }
}

export async function updateStaffController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const parsed = z
      .object({
        role: z.enum([
          'super_admin',
          'admin',
          'order_manager',
          'inventory_manager',
          'catalog_manager',
          'customer_support',
          'finance_accounts',
        ]),
        status: z.enum(['active', 'suspended']),
        customPermissions: z.array(z.string()).optional(),
      })
      .refine((value) => !value.customPermissions || value.customPermissions.every(isKnownPermission), {
        message: 'customPermissions contains an unknown permission identifier.',
        path: ['customPermissions'],
      })
      .parse(req.body);
    const staff = await updateStaffAdmin({
      id: req.params.id,
      actorId: String(req.user!._id),
      role: parsed.role,
      status: parsed.status,
      customPermissions: parsed.customPermissions,
    });
    await recordAuditLog({
      actor: req.user,
      action: 'staff.role_update',
      resourceType: 'User',
      resourceId: staff.id,
      summary: `Updated staff ${staff.email} -> role=${staff.role}, status=${staff.status}`,
    });
    sendSuccess(res, { staff });
  } catch (err) {
    next(err);
  }
}

export async function deleteStaffController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { id, email } = await deleteStaffAdmin(req.params.id, String(req.user!._id));
    await recordAuditLog({
      actor: req.user,
      action: 'staff.delete',
      resourceType: 'User',
      resourceId: id,
      summary: `Deleted staff member ${email}`,
    });
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function resetStaffPasswordController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const parsed = z.object({ password: z.string().min(8).max(128) }).parse(req.body);
    const result = await resetStaffPasswordAdmin({ id: req.params.id, password: parsed.password });
    await recordAuditLog({
      actor: req.user,
      action: 'staff.password_reset',
      resourceType: 'User',
      resourceId: result.id,
      summary: `Reset password and revoked sessions for staff member ${result.email}`,
    });
    sendSuccess(res, { reset: true });
  } catch (err) {
    next(err);
  }
}

export async function listAuditLogsController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await listAuditLogsAdmin({
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 25),
      q: String(req.query.q || ''),
      actor: String(req.query.actor || ''),
      action: String(req.query.action || ''),
      resourceType: String(req.query.resourceType || ''),
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
    });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function listSystemLogsController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const type = String(req.query.type || 'all');
    const data = await listSystemLogsAdmin(type, {
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 25),
      q: String(req.query.q || ''),
      level: String(req.query.level || ''),
    });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function systemHealthController(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const health = await getSystemHealthDiagnostics();
    sendSuccess(res, health);
  } catch (err) {
    next(err);
  }
}
