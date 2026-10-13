import {
  candidateIdParamsSchema,
  evaluationIdParamsSchema,
  evaluationRequestSchema,
  evaluationRunRequestSchema,
  persistedEvaluationSchema,
} from '@devrank/contracts';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createEvaluationController(repository: EvaluationRepository = evaluationRepository) {
  return {
    listRoles: asyncHandler(async (_request, response) => { response.json(repository.listRoles()); }),
    run: asyncHandler(async (request, response) => {
      const input = evaluationRunRequestSchema.parse(request.body);
      response.status(201).json(await repository.run(authContext(request), input));
    }),
    create: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const input = evaluationRequestSchema.parse(request.body);
      response.status(201).json(persistedEvaluationSchema.parse(await repository.create(authContext(request), id, input)));
    }),
    get: asyncHandler(async (request, response) => {
      const { id } = evaluationIdParamsSchema.parse(request.params);
      response.json(persistedEvaluationSchema.parse(await repository.get(authContext(request), id)));
    }),
  };
}
