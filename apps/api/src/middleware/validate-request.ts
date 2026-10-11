import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from './http-error.js';

function validationError(issues: Array<{ path: PropertyKey[]; message: string }>): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', 'Request data is invalid', issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  })));
}

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      next(validationError(result.error.issues));
      return;
    }
    request.params = result.data as typeof request.params;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      next(validationError(result.error.issues));
      return;
    }
    request.query = result.data as typeof request.query;
    next();
  };
}
