import { persistedEvaluationSchema, candidateIdParamsSchema, evaluationIdParamsSchema } from '@devrank/contracts';
import type { Request, Response } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { asyncHandler } from '../utils/async-handler.js';

export function createEvaluationController(repository: EvaluationRepository = evaluationRepository) {
  const authContext = (request: Request) => {
    if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
    return request.auth;
  };
  return {
    listForCandidate: asyncHandler(async (request, response: Response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      response.json(await repository.listForCandidate(authContext(request), id));
    }),
    listRoleProfiles: asyncHandler(async (request, response: Response) => {
      response.json(await repository.listRoleProfiles(authContext(request)));
    }),
    create: asyncHandler(async (request, response: Response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const saved = await repository.create(authContext(request), id, request.body);
      response.status(201).json(persistedEvaluationSchema.parse(saved));
    }),
    get: asyncHandler(async (request, response: Response) => {
      const { id } = evaluationIdParamsSchema.parse(request.params);
      response.json(persistedEvaluationSchema.parse(await repository.get(authContext(request), id)));
    }),
  };
}
