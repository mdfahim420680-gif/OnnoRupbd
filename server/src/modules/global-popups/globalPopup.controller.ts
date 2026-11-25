import type { Response, NextFunction } from 'express';
import { globalPopupInputSchema, globalPopupStatusSchema } from './globalPopup.validation';
import {
  createGlobalPopup,
  deleteGlobalPopup,
  duplicateGlobalPopup,
  getGlobalPopupById,
  listGlobalPopups,
  setGlobalPopupStatus,
  updateGlobalPopup,
} from './globalPopup.service';
import { recordAuditLog, type AuthenticatedRequest } from '../../middleware/auth.middleware';
import { assertValidObjectId } from '../../middleware/security.middleware';

export async function listGlobalPopupsController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const type = String(req.query.type || '').trim();
    const includeArchived = String(req.query.archived || '') === 'true';

    const data = await listGlobalPopups({ q, status, type, includeArchived });
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
}

export async function getGlobalPopupController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = assertValidObjectId(req.params.id, 'global promotional popup');
    const campaign = await getGlobalPopupById(id);
    res.json({ ok: true, campaign });
  } catch (err) {
    next(err);
  }
}

export async function createGlobalPopupController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const parsed = globalPopupInputSchema.parse(req.body);
    const campaign = await createGlobalPopup(parsed, req.user?._id);
    await recordAuditLog({
      actor: req.user,
      action: 'global_popup.create',
      resourceType: 'GlobalPromotionalPopup',
      resourceId: campaign.id,
      summary: `Created global promotional popup: ${campaign.name}`,
    });
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    next(err);
  }
}

export async function updateGlobalPopupController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = assertValidObjectId(req.params.id, 'global promotional popup');
    const parsed = globalPopupInputSchema.parse(req.body);
    const campaign = await updateGlobalPopup(id, parsed, req.user?._id);
    await recordAuditLog({
      actor: req.user,
      action: 'global_popup.update',
      resourceType: 'GlobalPromotionalPopup',
      resourceId: id,
      summary: `Updated global promotional popup: ${campaign.name}`,
    });
    res.json({ ok: true, campaign });
  } catch (err) {
    next(err);
  }
}

export async function updateGlobalPopupStatusController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = assertValidObjectId(req.params.id, 'global promotional popup');
    const parsed = globalPopupStatusSchema.parse(req.body);
    const campaign = await setGlobalPopupStatus(id, parsed, req.user?._id);
    await recordAuditLog({
      actor: req.user,
      action: 'global_popup.status',
      resourceType: 'GlobalPromotionalPopup',
      resourceId: id,
      summary: `Set global promotional popup "${campaign.name}" status=${campaign.status} enabled=${campaign.enabled}`,
    });
    res.json({ ok: true, campaign });
  } catch (err) {
    next(err);
  }
}

export async function duplicateGlobalPopupController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = assertValidObjectId(req.params.id, 'global promotional popup');
    const campaign = await duplicateGlobalPopup(id, req.user?._id);
    await recordAuditLog({
      actor: req.user,
      action: 'global_popup.duplicate',
      resourceType: 'GlobalPromotionalPopup',
      resourceId: campaign.id,
      summary: `Duplicated global promotional popup ${id} as "${campaign.name}"`,
    });
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    next(err);
  }
}

export async function deleteGlobalPopupController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = assertValidObjectId(req.params.id, 'global promotional popup');
    const deleted = await deleteGlobalPopup(id);
    await recordAuditLog({
      actor: req.user,
      action: 'global_popup.delete',
      resourceType: 'GlobalPromotionalPopup',
      resourceId: id,
      summary: `Deleted global promotional popup ${id}`,
    });
    res.json({ ok: true, ...deleted });
  } catch (err) {
    next(err);
  }
}
