import {
  candidateIdParamsSchema,
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
    submit: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const input = request.body as CandidatePlatformSubmission;
      response.status(201).json(await repository.submit(authContext(request), id, input));
    }),
  };
}
