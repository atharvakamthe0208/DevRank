import { Router } from 'express';
import { createGitHubController } from '../controllers/github-controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateQuery } from '../middleware/validate-request.js';
import { githubProfileQuerySchema } from '@devrank/contracts';

export function createGitHubRouter(controller = createGitHubController(), authMiddleware = authenticate) {
  const router = Router();
  router.use(authMiddleware);
  router.get('/', validateQuery(githubProfileQuerySchema), controller);
  return router;
}

export const githubRouter = createGitHubRouter();
