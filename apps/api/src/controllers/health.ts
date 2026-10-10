import type { RequestHandler } from 'express';

export const healthController: RequestHandler = (_request, response) => {
  response.json({ status: 'ok' });
};
