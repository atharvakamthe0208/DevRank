import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { isCorsOriginAllowed } from './config/cors-policy.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { healthController } from './controllers/health.js';
import { apiRouter } from './routes/index.js';
import { candidatesRouter } from './routes/candidates.js';
import { githubRouter } from './routes/github.js';

export const app = express();
app.disable('x-powered-by');
app.use(cors({
  origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin, env.NODE_ENV, env.WEB_ORIGIN) ? origin : false),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/github', githubRouter);
// Keep the original scaffold health path available while clients move to /api/health.
app.get('/health', healthController);
app.use(notFoundHandler);
app.use(errorHandler);
