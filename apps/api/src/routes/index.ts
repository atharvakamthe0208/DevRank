import { Router } from 'express';
import { healthController } from '../controllers/health.js';
import { authenticate } from '../middleware/authenticate.js';
import { adminRouter } from './admin.js';

export const apiRouter = Router();
apiRouter.get('/health', healthController);
apiRouter.get('/auth/me', authenticate, (request, response) => {
  const auth = request.auth!;
  response.json({ user: { id: auth.userId, email: auth.email }, profile: auth.profile, emailConfirmed: auth.emailConfirmed });
});
apiRouter.use('/admin', adminRouter);
