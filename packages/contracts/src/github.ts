import { z } from 'zod';

export const githubProfileQuerySchema = z.object({
  profile: z.string().trim().min(1).max(255),
}).strict();

export const githubRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  private: z.boolean(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string().url(),
  description: z.string().nullable(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  language: z.string().nullable(),
  updated_at: z.string().datetime(),
});

export const githubProfileResponseSchema = z.object({
  username: z.string(),
  profileUrl: z.string().url(),
  publicRepositoryCount: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  repositories: z.array(z.object({
    id: z.number().int().nonnegative(),
    name: z.string(),
    fullName: z.string(),
    url: z.string().url(),
    description: z.string().nullable(),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    primaryLanguage: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })),
  repositoriesReturned: z.number().int().nonnegative(),
  repositoriesTruncated: z.boolean(),
}).strict();

export type GitHubProfileResponse = z.infer<typeof githubProfileResponseSchema>;
