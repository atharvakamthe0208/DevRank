import { githubProfileQuerySchema } from '@devrank/contracts';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { githubAdapter } from '../services/github-adapter.js';

export function createGitHubController(adapter = githubAdapter): RequestHandler {
  return asyncHandler(async (request, response) => {
    const { profile } = githubProfileQuerySchema.parse(request.query);
    response.json(await adapter.getProfile(profile));
  });
}
