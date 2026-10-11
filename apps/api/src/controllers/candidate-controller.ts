import {
  candidateListResponseSchema,
  candidateSchema,
  candidateIdParamsSchema,
  candidateListQuerySchema,
  type CandidateListQuery,
} from '@devrank/contracts';
import type { Request, Response } from 'express';
import { candidateRepository, type CandidateRepository } from '../repositories/candidate-repository.js';
import { HttpError } from '../middleware/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

const candidateResponseFields = new Set([
  'id', 'name', 'email', 'githubUsername', 'leetcodeUsername', 'hackerrankUsername',
  'createdAt', 'updatedAt', 'items', 'page', 'pageSize', 'total',
]);

function invalidCandidateResponse(schema: string, issues: Array<{ path: PropertyKey[]; code: string }>): never {
  console.error('Candidate API response validation failed', {
    schema,
    issues: issues.map((issue) => ({
      path: issue.path.map((part) => typeof part === 'number'
        ? '[index]'
        : candidateResponseFields.has(String(part)) ? String(part) : '[field]').join('.'),
      code: /^[a-z0-9_]{1,40}$/i.test(issue.code) ? issue.code : 'unknown',
    })),
  });
  throw new HttpError(500, 'INVALID_API_RESPONSE', 'Candidate data could not be processed');
}

function checkedCandidate(value: unknown) {
  const result = candidateSchema.safeParse(value);
  if (!result.success) return invalidCandidateResponse('candidateSchema', result.error.issues);
  return result.data;
}

function checkedCandidateList(value: unknown) {
  const result = candidateListResponseSchema.safeParse(value);
  if (!result.success) return invalidCandidateResponse('candidateListResponseSchema', result.error.issues);
  return result.data;
}

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
      response.json(checkedCandidateList(await repository.list(authContext(request), listQuery(request))));
    }),
    create: asyncHandler(async (request, response) => {
      response.status(201).json(checkedCandidate(await repository.create(authContext(request), request.body)));
    }),
    get: asyncHandler(async (request, response) => {
      response.json(checkedCandidate(await repository.get(authContext(request), candidateId(request))));
    }),
    update: asyncHandler(async (request, response) => {
      response.json(checkedCandidate(await repository.update(authContext(request), candidateId(request), request.body)));
    }),
    archive: asyncHandler(async (request, response) => {
      await repository.archive(authContext(request), candidateId(request));
      response.status(204).end();
    }),
  };
}
