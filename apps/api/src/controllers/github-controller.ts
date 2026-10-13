import { githubProfileQuerySchema, githubProfileResponseSchema } from '@devrank/contracts';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { githubAdapter } from '../services/github-adapter.js';
import { HttpError } from '../middleware/http-error.js';

export function createGitHubController(adapter = githubAdapter): RequestHandler {
  return asyncHandler(async (request, response) => {
    const { profile } = githubProfileQuerySchema.parse(request.query);
    const result = githubProfileResponseSchema.safeParse(await adapter.getProfile(profile));
    if (!result.success) throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid profile response');
    response.json(result.data);
  });
}
