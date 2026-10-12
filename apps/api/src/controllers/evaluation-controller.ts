import { evaluationRunRequestSchema } from '@devrank/contracts';
import type { Request } from 'express';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { HttpError } from '../middleware/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createEvaluationController(repository: EvaluationRepository = evaluationRepository) {
  return {
    listRoles: asyncHandler(async (_request, response) => {
      response.json(repository.listRoles());
    }),
    run: asyncHandler(async (request, response) => {
      const input = evaluationRunRequestSchema.parse(request.body);
      response.json(await repository.run(authContext(request), input));
    }),
  };
}
