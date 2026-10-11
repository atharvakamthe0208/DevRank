import { Router } from 'express';
import { healthController } from '../controllers/health.js';
import { authenticate } from '../middleware/authenticate.js';
import { adminRouter } from './admin.js';

export function createApiRouter(authMiddleware = authenticate) {
  const router = Router();
  router.get('/health', healthController);
  router.get('/auth/me', authMiddleware, (request, response) => {
    const auth = request.auth!;
    response.json({ user: { id: auth.userId, email: auth.email }, profile: auth.profile, emailConfirmed: auth.emailConfirmed });
  });
  router.use('/admin', adminRouter);
  return router;
}

export const apiRouter = createApiRouter();
