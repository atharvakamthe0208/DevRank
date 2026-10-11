import { Router } from 'express';
import { candidateCreateSchema, candidateIdParamsSchema, candidateListQuerySchema, candidateUpdateSchema } from '@devrank/contracts';
import { createCandidateController } from '../controllers/candidate-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { validateParams, validateQuery } from '../middleware/validate-request.js';

export function createCandidatesRouter(
  controller = createCandidateController(),
  authMiddleware = authenticate,
  recruiterMiddleware = requireApprovedRecruiter,
) {
  const router = Router();
  router.use(authMiddleware, recruiterMiddleware);
  router.get('/', validateQuery(candidateListQuerySchema), controller.list);
  router.post('/', validateBody(candidateCreateSchema), controller.create);
  router.get('/:id', validateParams(candidateIdParamsSchema), controller.get);
  router.patch('/:id', validateParams(candidateIdParamsSchema), validateBody(candidateUpdateSchema), controller.update);
  router.delete('/:id', validateParams(candidateIdParamsSchema), controller.archive);
  return router;
}

export const candidatesRouter = createCandidatesRouter();
