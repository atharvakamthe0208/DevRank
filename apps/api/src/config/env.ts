import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
