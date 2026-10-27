import { Router, type RequestHandler } from 'express';
import { googleDriveResumeScreenRequestSchema } from '@devrank/contracts';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { createGoogleDriveController } from '../modules/google-drive/controller.js';
import { validateBody } from '../middleware/validate-body.js';

export function createGoogleDriveRouter(
  authMiddleware: RequestHandler = authenticate,
  approvalMiddleware: RequestHandler = requireApprovedRecruiter,
  controller = createGoogleDriveController(),
) {
  const router = Router();
  router.get('/callback', controller.callback);
  router.use(authMiddleware, approvalMiddleware);
  router.get('/status', controller.status);
  router.post('/connect', controller.connect);
  router.delete('/connection', controller.disconnect);
  router.post('/screen', validateBody(googleDriveResumeScreenRequestSchema), controller.screen);
  return router;
}

export const googleDriveRouter = createGoogleDriveRouter();
