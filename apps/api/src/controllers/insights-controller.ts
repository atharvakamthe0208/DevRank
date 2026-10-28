import { candidateComparisonSchema, providerRankingQuerySchema, rankingQuerySchema } from '@devrank/contracts';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { insightsRepository, type InsightsRepository } from '../repositories/insights-repository.js';
import { asyncHandler } from '../utils/async-handler.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createInsightsController(repository: InsightsRepository = insightsRepository) {
  return {
    dashboard: asyncHandler(async (request, response) => response.json(await repository.dashboard(authContext(request)))),
    compare: asyncHandler(async (request, response) => {
      const input = candidateComparisonSchema.parse(request.body);
      response.json(await repository.compare(authContext(request), input));
    }),
    ranking: asyncHandler(async (request, response) => {
      const input = rankingQuerySchema.parse(request.query);
      response.json(await repository.ranking(authContext(request), input));
    }),
    providerRanking: asyncHandler(async (request, response) => {
      const input = providerRankingQuerySchema.parse(request.query);
      response.json(await repository.providerRanking(authContext(request), input));
    }),
  };
}

export const insightsController = createInsightsController();
