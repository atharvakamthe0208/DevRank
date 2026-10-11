import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

// Resolve the API's own env file from this module, not from the caller's CWD.
// Shell-provided environment values still take precedence over values in .env.
loadDotEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

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

export const env = parseEnv(process.env);
