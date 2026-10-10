import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from './http-error.js';

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      next(new HttpError(400, 'VALIDATION_ERROR', 'Request body is invalid', details));
      return;
    }

    request.body = result.data;
    next();
  };
}
