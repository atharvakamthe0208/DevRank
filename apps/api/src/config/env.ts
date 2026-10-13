import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

// Resolve the API's own env file from this module, not from the caller's CWD.
// Shell-provided environment values still take precedence over values in .env.
const localEnv = loadDotEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
export function mergeEnvironment(fileValues: Record<string, string | undefined>, inheritedValues: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string | undefined> {
  const merged = { ...fileValues, ...inheritedValues };
  // A blank shell variable is not useful configuration and should not mask a valid workspace .env value.
  for (const [name, value] of Object.entries(fileValues)) {
    if (inheritedValues[name]?.trim() === '') merged[name] = value;
  }
  return merged;
}

const optionalUrl = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalSecret,
  GITHUB_TOKEN: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  GROQ_MODEL: z.string().trim().min(1).max(100).default('openai/gpt-oss-120b'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(12000),
});

export type ApiEnvironment = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): ApiEnvironment {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment configuration (${problems})`);
  }
  return result.data;
}

export const env = parseEnv(mergeEnvironment(localEnv.parsed ?? {}, process.env));
