import {
  candidateBulkImportResponseSchema,
  candidateImportPreviewResponseSchema,
  candidateSchema,
  type CandidateBulkImportResponse,
  type CandidateCreateInput,
  type CandidateImportPreviewResponse,
  type CandidateImportRows,
  type CandidateListQuery,
  type CandidateUpdateInput,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import type { AuthContext } from '../types/auth.js';

const candidateColumns = 'id,full_name,email,github_username,leetcode_username,hackerrank_username,created_at,updated_at';

type CandidateRow = {
  id: string;
  full_name: string;
  email: string | null;
  github_username: string | null;
  leetcode_username: string | null;
  hackerrank_username: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateList = { items: ReturnType<typeof candidateSchema.parse>[]; page: number; pageSize: number; total: number };

export interface CandidateRepository {
  create(auth: AuthContext, input: CandidateCreateInput): Promise<ReturnType<typeof candidateSchema.parse>>;
  previewImport(auth: AuthContext, rows: CandidateImportRows['rows']): Promise<CandidateImportPreviewResponse>;
  bulkImport(auth: AuthContext, rows: CandidateImportRows['rows'], idempotencyKey: string, skipDuplicates: boolean): Promise<CandidateBulkImportResponse>;
  list(auth: AuthContext, query: CandidateListQuery): Promise<CandidateList>;
  get(auth: AuthContext, id: string): Promise<ReturnType<typeof candidateSchema.parse>>;
  update(auth: AuthContext, id: string, input: CandidateUpdateInput): Promise<ReturnType<typeof candidateSchema.parse>>;
  delete(auth: AuthContext, id: string): Promise<void>;
}

function toCandidate(row: CandidateRow): ReturnType<typeof candidateSchema.parse> {
  const result = candidateSchema.safeParse({
    id: row.id,
    name: row.full_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.github_username ? { githubUsername: row.github_username } : {}),
    ...(row.leetcode_username ? { leetcodeUsername: row.leetcode_username } : {}),
    ...(row.hackerrank_username ? { hackerrankUsername: row.hackerrank_username } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!result.success) {
    const allowedFields = new Set(['id', 'name', 'email', 'githubUsername', 'leetcodeUsername', 'hackerrankUsername', 'createdAt', 'updatedAt']);
    console.error('Candidate database row validation failed', {
      schema: 'candidateSchema',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map((part) => typeof part === 'string' && allowedFields.has(part) ? part : '[field]').join('.'),
        code: /^[a-z0-9_]{1,40}$/i.test(issue.code) ? issue.code : 'unknown',
      })),
    });
    throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Candidate data could not be processed');
  }
  return result.data;
}

type DatabaseCategory =
  | 'network_dns_tls'
  | 'invalid_credentials'
  | 'constraint'
  | 'permission_or_rls'
  | 'schema'
  | 'postgrest_other'
  | 'connection_or_unknown';
type DatabaseDiagnostic = { category: DatabaseCategory; code?: string; httpStatus?: number };
type DatabaseFailureSource = 'supabase_response' | 'thrown_exception';

function safeErrorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'non_error_throw';
  const rawName = 'name' in error && typeof error.name === 'string'
    ? error.name
    : error instanceof Error
      ? error.constructor.name
      : undefined;
  return rawName && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(rawName)
    ? rawName
    : error instanceof Error ? 'Error' : 'structured_error';
}

/** Return only non-sensitive database metadata. Never log provider messages or request data. */
export function candidateDatabaseDiagnostic(error: unknown): DatabaseDiagnostic {
  const chain: object[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null && !chain.includes(current); depth++) {
    chain.push(current);
    current = 'cause' in current ? current.cause : undefined;
  }

  const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z0-9_]{1,32}$/i.test(value) ? value : undefined;
  const code = chain.map((item) => 'code' in item ? safeCode(item.code) : undefined).find(Boolean);
  const statusValue = chain.map((item) => {
    if ('status' in item && typeof item.status === 'number') return item.status;
    if ('statusCode' in item && typeof item.statusCode === 'number') return item.statusCode;
    if ('response' in item && typeof item.response === 'object' && item.response !== null && 'status' in item.response && typeof item.response.status === 'number') return item.response.status;
    return undefined;
  }).find((status) => status !== undefined);
  const httpStatus = statusValue !== undefined && statusValue >= 100 && statusValue <= 599 ? statusValue : undefined;
  const diagnostic = (category: DatabaseCategory): DatabaseDiagnostic => ({
    category,
    ...(code ? { code } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  });

  const networkCodes = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  ]);
  if (chain.some((item) => {
    const currentCode = 'code' in item ? safeCode(item.code) : undefined;
    return Boolean(currentCode && (
      networkCodes.has(currentCode)
      || currentCode.startsWith('ERR_TLS_')
      || currentCode.startsWith('ERR_SSL_')
      || currentCode.startsWith('CERT_')
    ));
  })) return diagnostic('network_dns_tls');
  if (httpStatus === 401 || code === 'PGRST301' || code?.toLowerCase().includes('invalid_api_key')) return diagnostic('invalid_credentials');
  if (httpStatus === 403 || code === '42501') return diagnostic('permission_or_rls');
  if (code === '23503' || code === '23505' || code === '23514' || code === '23502') return diagnostic('constraint');
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return diagnostic('schema');
  if (code?.startsWith('PGRST') || httpStatus !== undefined) return diagnostic('postgrest_other');
  return diagnostic('connection_or_unknown');
}

function databaseError(error: unknown, operation: string, failureSource: DatabaseFailureSource): never {
  const diagnostic = candidateDatabaseDiagnostic(error);
  // Provider errors can contain SQL, identifiers, or submitted values. Log only safe metadata.
  console.error('Candidate database operation failed', {
    operation,
    failureSource,
    errorName: safeErrorName(error),
    ...diagnostic,
  });
  if (diagnostic.code === '23505') {
    throw new HttpError(409, 'CONFLICT', 'A conflicting candidate record already exists');
  }
  throw new HttpError(503, 'DATABASE_UNAVAILABLE', `Unable to ${operation} right now`);
}

function checkedImportResult<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ code: string }> } } }, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error('Candidate import database response validation failed', {
      operation,
      issueCodes: parsed.error.issues.map((issue) => /^[a-z0-9_]{1,40}$/i.test(issue.code) ? issue.code : 'unknown'),
    });
    throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Candidate import results could not be processed');
  }
  return parsed.data;
}

function clientFor(auth: AuthContext) {
  try {
    return getSupabaseClient(auth.accessToken);
  } catch {
    throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Candidate storage is not configured');
  }
}

export const candidateRepository: CandidateRepository = {
  async create(auth, input) {
    try {
      const { data, error } = await clientFor(auth)
        .from('candidates')
        .insert({
          owner_id: auth.userId,
          full_name: input.name,
          email: input.email ?? null,
          github_username: input.githubUsername ?? null,
          leetcode_username: input.leetcodeUsername ?? null,
          hackerrank_username: input.hackerrankUsername ?? null,
        })
        .select(candidateColumns)
        .single();
      if (error) return databaseError(error, 'create the candidate', 'supabase_response');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'create the candidate', 'thrown_exception');
    }
  },

  async previewImport(auth, rows) {
    try {
      const { data, error } = await clientFor(auth).rpc('candidate_bulk_import', {
        p_rows: rows,
        p_idempotency_key: null,
        p_skip_duplicates: true,
        p_preview: true,
      });
      if (error) return databaseError(error, 'preview candidate import', 'supabase_response');
      const result = checkedImportResult(candidateImportPreviewResponseSchema, data, 'preview candidate import');
      if (result.rows.length !== rows.length) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Candidate import preview could not be processed');
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'preview candidate import', 'thrown_exception');
    }
  },

  async bulkImport(auth, rows, idempotencyKey, skipDuplicates) {
    try {
      const { data, error } = await clientFor(auth).rpc('candidate_bulk_import', {
        p_rows: rows,
        p_idempotency_key: idempotencyKey,
        p_skip_duplicates: skipDuplicates,
        p_preview: false,
      });
      if (error) {
        if (error.code === '22023') throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This import retry key was already used with different rows or duplicate settings. Review the candidates list before starting a new import.');
        return databaseError(error, 'import candidates', 'supabase_response');
      }
      const result = checkedImportResult(candidateBulkImportResponseSchema, data, 'import candidates');
      if (result.results.length !== rows.length) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Candidate import results could not be processed');
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'import candidates', 'thrown_exception');
    }
  },

  async list(auth, query) {
    try {
      const offset = (query.page - 1) * query.pageSize;
      const { data, error, count } = await clientFor(auth)
        .from('candidates')
        .select(candidateColumns, { count: 'exact' })
        .eq('owner_id', auth.userId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + query.pageSize - 1);
      if (error) return databaseError(error, 'list candidates', 'supabase_response');
      return {
        items: (data as CandidateRow[]).map(toCandidate),
        page: query.page,
        pageSize: query.pageSize,
        total: count ?? 0,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'list candidates', 'thrown_exception');
    }
  },

  async get(auth, id) {
    try {
      const { data, error } = await clientFor(auth)
        .from('candidates')
        .select(candidateColumns)
        .eq('id', id)
        .eq('owner_id', auth.userId)
        .is('archived_at', null)
        .maybeSingle();
      if (error) return databaseError(error, 'retrieve the candidate', 'supabase_response');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'retrieve the candidate', 'thrown_exception');
    }
  },

  async update(auth, id, input) {
    const values: Record<string, string | null> = {};
    if (input.name !== undefined) values.full_name = input.name;
    if (input.email !== undefined) values.email = input.email;
    if (input.githubUsername !== undefined) values.github_username = input.githubUsername;
    if (input.leetcodeUsername !== undefined) values.leetcode_username = input.leetcodeUsername;
    if (input.hackerrankUsername !== undefined) values.hackerrank_username = input.hackerrankUsername;

    try {
      const { data, error } = await clientFor(auth)
        .from('candidates')
        .update(values)
        .eq('id', id)
        .eq('owner_id', auth.userId)
        .is('archived_at', null)
        .select(candidateColumns)
        .maybeSingle();
      if (error) return databaseError(error, 'update the candidate', 'supabase_response');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'update the candidate', 'thrown_exception');
    }
  },

  async delete(auth, id) {
    try {
      const { data, error } = await clientFor(auth)
        .rpc('delete_candidate_and_data', { p_candidate_id: id });
      if (error) return databaseError(error, 'delete the candidate', 'supabase_response');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'delete the candidate', 'thrown_exception');
    }
  },
};
