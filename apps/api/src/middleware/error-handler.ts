import type { ErrorRequestHandler } from 'express';
import { apiErrorSchema } from '@devrank/contracts';
import { env } from '../config/env.js';
import { HttpError } from './http-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    const retryAfterSeconds = error.details && typeof error.details === 'object'
      ? (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
    if (error.code === 'AI_RATE_LIMITED' && typeof retryAfterSeconds === 'number' && Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }
    response.status(error.statusCode).json(apiErrorSchema.parse({
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    }));
    return;
  }

  const isMalformedJson = error instanceof SyntaxError && 'body' in error;
  if (isMalformedJson) {
    response.status(400).json(apiErrorSchema.parse({
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
    }));
    return;
  }

  const parserStatus = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (parserStatus === 413) {
    response.status(413).json(apiErrorSchema.parse({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 1 MB limit' },
    }));
    return;
  }

  // Do not send exception messages, credentials, or stack traces to API clients.
  response.status(500).json(apiErrorSchema.parse({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : 'An unexpected error occurred',
    },
  }));
};
