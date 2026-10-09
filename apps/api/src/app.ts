import cors from 'cors';
import express from 'express';
import { apiErrorSchema } from '@devrank/contracts';
import { env } from './config/env.js';

export const app = express();
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json());
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.use((_request, response) => response.status(404).json(apiErrorSchema.parse({
  error: { code: 'NOT_FOUND', message: 'Route not found' },
})));
