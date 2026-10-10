import {
  candidateIdParamsSchema,
  candidateListQuerySchema,
  type CandidateListQuery,
} from '@devrank/contracts';
import type { Request, Response } from 'express';
import { candidateRepository, type CandidateRepository } from '../repositories/candidate-repository.js';
import { HttpError } from '../middleware/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

function candidateId(request: Request): string {
  return candidateIdParamsSchema.parse(request.params).id;
}

function listQuery(request: Request): CandidateListQuery {
  return candidateListQuerySchema.parse(request.query);
}

export function createCandidateController(repository: CandidateRepository = candidateRepository) {
  return {
    list: asyncHandler(async (request, response) => {
      response.json(await repository.list(authContext(request), listQuery(request)));
    }),
    create: asyncHandler(async (request, response) => {
      response.status(201).json(await repository.create(authContext(request), request.body));
    }),
    get: asyncHandler(async (request, response) => {
      response.json(await repository.get(authContext(request), candidateId(request)));
    }),
    update: asyncHandler(async (request, response) => {
      response.json(await repository.update(authContext(request), candidateId(request), request.body));
    }),
    archive: asyncHandler(async (request, response) => {
      await repository.archive(authContext(request), candidateId(request));
      response.status(204).end();
    }),
  };
}
