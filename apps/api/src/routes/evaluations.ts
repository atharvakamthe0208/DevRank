import { Router } from 'express';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { evaluationRunRequestSchema } from '@devrank/contracts';
import { createEvaluationController } from '../controllers/evaluation-controller.js';

export function createEvaluationsRouter(
  controller = createEvaluationController(),
  authMiddleware = authenticate,
  approvalMiddleware = requireApprovedRecruiter,
) {
  const router = Router();
  router.use(authMiddleware, approvalMiddleware);
  router.get('/roles', controller.listRoles);
  router.post('/', validateBody(evaluationRunRequestSchema), controller.run);
  return router;
}

export const evaluationsRouter = createEvaluationsRouter();
