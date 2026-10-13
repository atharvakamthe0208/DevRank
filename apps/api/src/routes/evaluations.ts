import { Router } from 'express';
import { aiAnalysisRequestSchema, evaluationIdParamsSchema, evaluationRunRequestSchema } from '@devrank/contracts';
import { createEvaluationController } from '../controllers/evaluation-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { validateParams } from '../middleware/validate-request.js';

export function createEvaluationsRouter(controller = createEvaluationController(), authMiddleware = authenticate, approvalMiddleware = requireApprovedRecruiter) {
  const router = Router();
  router.use(authMiddleware, approvalMiddleware);
  router.get('/roles', controller.listRoles);
  router.post('/', validateBody(evaluationRunRequestSchema), controller.run);
  router.get('/:id', validateParams(evaluationIdParamsSchema), controller.get);
  router.post('/:id/ai-analysis', validateParams(evaluationIdParamsSchema), validateBody(aiAnalysisRequestSchema), controller.analyze);
  return router;
}
export const evaluationsRouter = createEvaluationsRouter();
