import { candidateSchema, type CandidateCreateInput, type CandidateListQuery, type CandidateUpdateInput } from '@devrank/contracts';
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
  list(auth: AuthContext, query: CandidateListQuery): Promise<CandidateList>;
  get(auth: AuthContext, id: string): Promise<ReturnType<typeof candidateSchema.parse>>;
  update(auth: AuthContext, id: string, input: CandidateUpdateInput): Promise<ReturnType<typeof candidateSchema.parse>>;
  archive(auth: AuthContext, id: string): Promise<void>;
}

function toCandidate(row: CandidateRow): ReturnType<typeof candidateSchema.parse> {
  return candidateSchema.parse({
    id: row.id,
    name: row.full_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.github_username ? { githubUsername: row.github_username } : {}),
    ...(row.leetcode_username ? { leetcodeUsername: row.leetcode_username } : {}),
    ...(row.hackerrank_username ? { hackerrankUsername: row.hackerrank_username } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function databaseError(error: unknown, operation: string): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    throw new HttpError(409, 'CONFLICT', 'A conflicting candidate record already exists');
  }
  throw new HttpError(503, 'DATABASE_UNAVAILABLE', `Unable to ${operation} right now`);
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
      if (error) return databaseError(error, 'create the candidate');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'create the candidate');
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
      if (error) return databaseError(error, 'list candidates');
      return {
        items: (data as CandidateRow[]).map(toCandidate),
        page: query.page,
        pageSize: query.pageSize,
        total: count ?? 0,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'list candidates');
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
      if (error) return databaseError(error, 'retrieve the candidate');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'retrieve the candidate');
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
      if (error) return databaseError(error, 'update the candidate');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return toCandidate(data as CandidateRow);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'update the candidate');
    }
  },

  async archive(auth, id) {
    try {
      const { data, error } = await clientFor(auth)
        .from('candidates')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', auth.userId)
        .is('archived_at', null)
        .select('id')
        .maybeSingle();
      if (error) return databaseError(error, 'delete the candidate');
      if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return databaseError(error, 'delete the candidate');
    }
  },
};
