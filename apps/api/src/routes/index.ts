import { Router } from 'express';
import { healthController } from '../controllers/health.js';

export const apiRouter = Router();
apiRouter.get('/health', healthController);
