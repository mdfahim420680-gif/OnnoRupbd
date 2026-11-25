import { Router } from 'express';
import { requireDatabase } from '../../database/connection';
import { authenticateRequired, requirePermission } from '../../middleware/auth.middleware';
import {
  createGlobalPopupController,
  deleteGlobalPopupController,
  duplicateGlobalPopupController,
  getGlobalPopupController,
  listGlobalPopupsController,
  updateGlobalPopupController,
  updateGlobalPopupStatusController,
} from './globalPopup.controller';

const router = Router();
router.use(requireDatabase, authenticateRequired);

router.get('/global-promotional-popups', requirePermission('marketing.manage'), listGlobalPopupsController);
router.get('/global-promotional-popups/:id', requirePermission('marketing.manage'), getGlobalPopupController);
router.post('/global-promotional-popups', requirePermission('marketing.manage'), createGlobalPopupController);
router.put('/global-promotional-popups/:id', requirePermission('marketing.manage'), updateGlobalPopupController);
router.patch('/global-promotional-popups/:id/status', requirePermission('marketing.manage'), updateGlobalPopupStatusController);
router.post('/global-promotional-popups/:id/duplicate', requirePermission('marketing.manage'), duplicateGlobalPopupController);
router.delete('/global-promotional-popups/:id', requirePermission('marketing.manage'), deleteGlobalPopupController);

export default router;
