import { Router } from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../config/supabase.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../middleware/http-error.js';
import { authenticate, requireAdmin } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';

const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
const uuidSchema = z.string().uuid();

function mapRpcError(code: string | undefined): HttpError {
  if (code === '42501') return new HttpError(403, 'FORBIDDEN', 'Administrator access is required');
  if (code === 'P0002') return new HttpError(404, 'APPLICATION_NOT_FOUND', 'That pending recruiter application was not found');
  if (code === '22023') return new HttpError(400, 'VALIDATION_ERROR', 'The recruiter decision is invalid');
  return new HttpError(503, 'APPROVAL_SERVICE_UNAVAILABLE', 'Recruiter approvals are temporarily unavailable');
}

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/recruiters', asyncHandler(async (request, response) => {
  const rawStatus = request.query.status;
  const status = rawStatus === undefined || rawStatus === 'all' ? null : rawStatus;
  if (status !== null && (typeof status !== 'string' || !['pending', 'approved', 'rejected'].includes(status))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Status must be pending, approved, rejected, or all');
  }
  let client;
  try { client = getSupabaseClient(request.auth!.accessToken); }
  catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter approvals are not configured'); }
  const { data, error } = await client.rpc('list_recruiter_applications', { p_status: status });
  if (error) throw mapRpcError(error.code);
  response.json({ recruiters: data ?? [] });
}));

adminRouter.patch('/recruiters/:id/decision', validateBody(decisionSchema), asyncHandler(async (request, response) => {
  const parsedId = uuidSchema.safeParse(request.params.id);
  if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Recruiter ID is invalid');
  let client;
  try { client = getSupabaseClient(request.auth!.accessToken); }
  catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter approvals are not configured'); }
  const { data, error } = await client.rpc('decide_recruiter_application', {
    p_user_id: parsedId.data,
    p_decision: request.body.decision,
  });
  if (error) throw mapRpcError(error.code);
  response.json({ updated: Boolean(data), status: request.body.decision });
}));
