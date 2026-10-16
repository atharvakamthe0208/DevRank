import { Router } from 'express';
import { createGitHubController } from '../controllers/github-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { validateQuery } from '../middleware/validate-request.js';
import { githubProfileQuerySchema } from '@devrank/contracts';

export function createGitHubRouter(controller = createGitHubController(), authMiddleware = authenticate, approvalMiddleware = requireApprovedRecruiter) {
  const router = Router();
  router.get('/', authMiddleware, approvalMiddleware, validateQuery(githubProfileQuerySchema), controller);
  return router;
}

export const githubRouter = createGitHubRouter();
