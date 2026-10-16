import {
  aiAnalysisResponseSchema,
  candidateIdParamsSchema,
  evaluationIdParamsSchema,
  evaluationRequestSchema,
  evaluationRunRequestSchema,
  persistedEvaluationSchema,
} from '@devrank/contracts';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { aiAnalysisService, type AiAnalysisService } from '../modules/ai/index.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createEvaluationController(repository: EvaluationRepository = evaluationRepository, aiService: AiAnalysisService = aiAnalysisService) {
  return {
    listRoles: asyncHandler(async (_request, response) => { response.json(repository.listRoles()); }),
    listRoleProfiles: asyncHandler(async (request, response) => { response.json(await repository.listRoleProfiles(authContext(request))); }),
    run: asyncHandler(async (request, response) => {
      const input = evaluationRunRequestSchema.parse(request.body);
      response.status(201).json(await repository.run(authContext(request), input));
    }),
    create: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      const input = evaluationRequestSchema.parse(request.body);
      response.status(201).json(persistedEvaluationSchema.parse(await repository.create(authContext(request), id, input)));
    }),
    listForCandidate: asyncHandler(async (request, response) => {
      const { id } = candidateIdParamsSchema.parse(request.params);
      response.json(await repository.listForCandidate(authContext(request), id));
    }),
    get: asyncHandler(async (request, response) => {
      const { id } = evaluationIdParamsSchema.parse(request.params);
      response.json(persistedEvaluationSchema.parse(await repository.get(authContext(request), id)));
    }),
    analyze: asyncHandler(async (request, response) => {
      const { id } = evaluationIdParamsSchema.parse(request.params);
      const evaluation = persistedEvaluationSchema.parse(await repository.get(authContext(request), id));
      if (evaluation.status === 'insufficient_evidence' || evaluation.result.overallScore === undefined || evaluation.result.evidence.length === 0) {
        response.json(aiAnalysisResponseSchema.parse({ status: 'insufficient_evidence', evaluation, analysis: null }));
        return;
      }
      const analysis = await aiService.analyze(evaluation);
      response.json(aiAnalysisResponseSchema.parse({ status: 'completed', evaluation, analysis }));
    }),
  };
}
