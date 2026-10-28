import { Router } from 'express';
import { candidateComparisonSchema, providerRankingQuerySchema, rankingQuerySchema } from '@devrank/contracts';
import { createInsightsController } from '../controllers/insights-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { validateQuery } from '../middleware/validate-request.js';

export function createInsightsRouter(controller = createInsightsController(), authMiddleware = authenticate, approvalMiddleware = requireApprovedRecruiter) {
  const router = Router();
  router.get('/dashboard', authMiddleware, approvalMiddleware, controller.dashboard);
  router.post('/comparisons', authMiddleware, approvalMiddleware, validateBody(candidateComparisonSchema), controller.compare);
  router.get('/rankings', authMiddleware, approvalMiddleware, validateQuery(rankingQuerySchema), controller.ranking);
  router.get('/rankings/github-leetcode', authMiddleware, approvalMiddleware, validateQuery(providerRankingQuerySchema), controller.providerRanking);
  return router;
}

export const insightsRouter = createInsightsRouter();
