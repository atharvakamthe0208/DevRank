import { Router } from 'express';
import { createEvaluationController } from '../controllers/evaluation-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateParams } from '../middleware/validate-request.js';
import { evaluationIdParamsSchema } from '@devrank/contracts';

export function createEvaluationsRouter(controller = createEvaluationController(), authMiddleware = authenticate) {
  const router = Router();
  router.use(authMiddleware, requireApprovedRecruiter);
  router.get('/:id', validateParams(evaluationIdParamsSchema), controller.get);
  return router;
}
export const evaluationsRouter = createEvaluationsRouter();
