import {
  candidateIdParamsSchema,
  githubSyncRequestSchema,
  type CandidatePlatformSubmission,
} from '@devrank/contracts';
import type { Request } from 'express';
import { candidatePlatformRepository, type CandidatePlatformRepository } from '../repositories/candidate-platform-repository.js';
import { HttpError } from '../middleware/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createCandidatePlatformController(repository: CandidatePlatformRepository = candidatePlatformRepository) {
  return {
    getLatest: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      response.json(await repository.getLatest(authContext(request), id));
    }),
    submit: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const input = request.body as CandidatePlatformSubmission;
      response.status(201).json(await repository.submit(authContext(request), id, input));
    }),
    syncGitHub: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const { profile } = githubSyncRequestSchema.parse(request.body);
      response.status(201).json(await repository.syncGitHub(authContext(request), id, profile));
    }),
  };
}
