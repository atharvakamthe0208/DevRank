import {
  candidateListResponseSchema,
  candidateSchema,
  type Candidate,
} from '@devrank/contracts';

const allowedPathParts = new Set([
  'items', 'page', 'pageSize', 'total', 'id', 'name', 'email', 'githubUsername',
  'leetcodeUsername', 'hackerrankUsername', 'createdAt', 'updatedAt',
]);

function safeIssues(issues: Array<{ path: PropertyKey[]; code: string }>) {
  return issues.map((issue) => ({
    path: issue.path.map((part) => typeof part === 'number'
      ? '[index]'
      : allowedPathParts.has(String(part)) ? String(part) : '[field]').join('.'),
    code: /^[a-z0-9_]{1,40}$/i.test(issue.code) ? issue.code : 'unknown',
  }));
}

export function parseCandidateApiResponse(value: unknown): Candidate | undefined {
  const result = candidateSchema.safeParse(value);
  if (!result.success) {
    console.error('Candidate API response validation failed', {
      schema: 'candidateSchema',
      issues: safeIssues(result.error.issues),
    });
    return undefined;
  }
  return result.data;
}

export function parseCandidateListApiResponse(value: unknown) {
  const result = candidateListResponseSchema.safeParse(value);
  if (!result.success) {
    console.error('Candidate API response validation failed', {
      schema: 'candidateListResponseSchema',
      issues: safeIssues(result.error.issues),
    });
    return undefined;
  }
  return result.data;
}
