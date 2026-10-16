import { Router } from 'express';
import {
  candidateCreateSchema,
  candidateIdParamsSchema,
  candidateListQuerySchema,
  candidatePlatformSubmissionSchema,
  candidateUpdateSchema,
  githubSyncRequestSchema,
  leetCodeSyncRequestSchema,
} from '@devrank/contracts';
import { createCandidateController } from '../controllers/candidate-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { validateParams, validateQuery } from '../middleware/validate-request.js';
import { createCandidatePlatformController } from '../controllers/candidate-platform-controller.js';
import { createEvaluationController } from '../controllers/evaluation-controller.js';
import { evaluationRequestSchema } from '@devrank/contracts';

export function createCandidatesRouter(
  controller = createCandidateController(),
  authMiddleware = authenticate,
  platformController = createCandidatePlatformController(),
  evaluationController = createEvaluationController(),
) {
  const router = Router();
  router.use(authMiddleware, requireApprovedRecruiter);
  router.get('/', validateQuery(candidateListQuerySchema), controller.list);
  router.post('/', validateBody(candidateCreateSchema), controller.create);
  router.post(
    '/:id/evaluations',
    validateParams(candidateIdParamsSchema),
    validateBody(evaluationRequestSchema),
    evaluationController.create,
  );
  router.get('/:id/evaluations', validateParams(candidateIdParamsSchema), evaluationController.listForCandidate);
  router.post(
    '/:id/platform-data',
    validateParams(candidateIdParamsSchema),
    validateBody(candidatePlatformSubmissionSchema),
    platformController.submit,
  );
  router.get('/:id/platform-data', validateParams(candidateIdParamsSchema), platformController.getLatest);
  router.post(
    '/:id/platform-data/github-sync',
    validateParams(candidateIdParamsSchema),
    validateBody(githubSyncRequestSchema),
    platformController.syncGitHub,
  );
  router.post(
    '/:id/platform-data/leetcode-sync',
    validateParams(candidateIdParamsSchema),
    validateBody(leetCodeSyncRequestSchema),
    platformController.syncLeetCode,
  );
  router.get('/:id', validateParams(candidateIdParamsSchema), controller.get);
  router.patch('/:id', validateParams(candidateIdParamsSchema), validateBody(candidateUpdateSchema), controller.update);
  router.delete('/:id', validateParams(candidateIdParamsSchema), controller.archive);
  return router;
}

export const candidatesRouter = createCandidatesRouter();
