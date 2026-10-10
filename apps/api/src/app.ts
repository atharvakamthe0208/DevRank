import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { healthController } from './controllers/health.js';
import { apiRouter } from './routes/index.js';

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);
// Keep the original scaffold health path available while clients move to /api/health.
app.get('/health', healthController);
app.use(notFoundHandler);
app.use(errorHandler);
