import {
  hackerRankSubmissionSchema,
  leetCodeSubmissionSchema,
  type CandidatePlatformSubmission,
} from '@devrank/contracts';

export type PlatformFormFields = {
  handle: string;
  availability: 'available' | 'unavailable' | 'not_provided';
  statistics: Record<string, string>;
};

export type PlatformFormResult =
  | { success: true; data: CandidatePlatformSubmission }
  | { success: false; errors: Record<string, string> };

const metricKeys = {
  leetcode: ['problemsSolved', 'easySolved', 'mediumSolved', 'hardSolved'],
  hackerrank: ['points', 'badges', 'certificates'],
} as const;

export function validatePlatformForm(
  platform: 'leetcode' | 'hackerrank',
  fields: PlatformFormFields,
): PlatformFormResult {
  const statistics: Record<string, number> = {};
  if (fields.availability === 'available') {
    for (const key of metricKeys[platform]) {
      const raw = fields.statistics[key]?.trim();
      if (raw !== undefined && raw !== '') statistics[key] = Number(raw);
    }
  }

  const submission = {
    platform,
    handle: fields.handle.trim(),
    availability: fields.availability,
    ...(Object.keys(statistics).length > 0 ? { statistics } : {}),
  };
  const schema = platform === 'leetcode' ? leetCodeSubmissionSchema : hackerRankSubmissionSchema;
  const result = schema.safeParse(submission);
  if (result.success) return { success: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || 'form';
    errors[field] ??= issue.message;
  }
  return { success: false, errors };
}
