import { Router } from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../config/supabase.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../middleware/http-error.js';
import { authenticate, requireAdmin } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate-body.js';
import { adminRecruiterDetailsSchema } from '@devrank/contracts';

const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
const uuidSchema = z.string().uuid();

function mapRpcError(code: string | undefined): HttpError {
  if (code === '42501') return new HttpError(403, 'FORBIDDEN', 'Administrator access is required');
  if (code === 'P0002') return new HttpError(404, 'APPLICATION_NOT_FOUND', 'That pending recruiter application was not found');
  if (code === '22023') return new HttpError(400, 'VALIDATION_ERROR', 'The recruiter decision is invalid');
  return new HttpError(503, 'APPROVAL_SERVICE_UNAVAILABLE', 'Recruiter approvals are temporarily unavailable');
}

function mapDetailsRpcError(code: string | undefined): HttpError {
  if (code === '42501') return new HttpError(403, 'FORBIDDEN', 'Administrator access is required');
  if (code === 'P0002') return new HttpError(404, 'RECRUITER_NOT_FOUND', 'Recruiter account could not be found');
  return new HttpError(503, 'RECRUITER_DETAILS_UNAVAILABLE', 'Recruiter details are temporarily unavailable');
}

function detailsRpcFailureCategory(code: string | undefined): string {
  if (code === 'PGRST202' || code === 'PGRST203' || code === '42883') return 'rpc_resolution';
  if (code === '42501') return 'authorization';
  if (code === 'P0002') return 'recruiter_not_found';
  return 'database_error';
}

export function createAdminRouter(
  authMiddleware = authenticate,
  adminMiddleware = requireAdmin,
  clientFactory = getSupabaseClient,
) {
  const router = Router();
  router.use(authMiddleware, adminMiddleware);

  router.get('/recruiters', asyncHandler(async (request, response) => {
    const rawStatus = request.query.status;
    const status = rawStatus === undefined || rawStatus === 'all' ? null : rawStatus;
    if (status !== null && (typeof status !== 'string' || !['pending', 'approved', 'rejected'].includes(status))) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Status must be pending, approved, rejected, or all');
    }
    let client;
    try { client = clientFactory(request.auth!.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter approvals are not configured'); }
    const { data, error } = await client.rpc('list_recruiter_applications', { p_status: status });
    if (error) throw mapRpcError(error.code);
    response.json({ recruiters: data ?? [] });
  }));

  router.get('/recruiters/:id/details', asyncHandler(async (request, response) => {
    const parsedId = uuidSchema.safeParse(request.params.id);
    if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Recruiter ID is invalid');
    let client;
    try { client = clientFactory(request.auth!.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter details are not configured'); }
    const { data, error } = await client.rpc('get_admin_recruiter_details', { p_user_id: parsedId.data });
    if (error) {
      console.error('[admin-recruiter-details] RPC failed', {
        failureCategory: detailsRpcFailureCategory(error.code),
        errorCode: error.code ?? 'unknown',
      });
      throw mapDetailsRpcError(error.code);
    }
    const details = adminRecruiterDetailsSchema.safeParse(data);
    if (!details.success) {
      console.error('[admin-recruiter-details] RPC response contract validation failed', {
        issueCodes: details.error.issues.slice(0, 10).map((issue) => issue.code),
        issuePaths: details.error.issues.slice(0, 10).map((issue) => issue.path.join('.')),
      });
      throw new HttpError(503, 'RECRUITER_DETAILS_UNAVAILABLE', 'Recruiter details are temporarily unavailable');
    }
    response.json({ details: details.data });
  }));

  router.patch('/recruiters/:id/decision', validateBody(decisionSchema), asyncHandler(async (request, response) => {
    const parsedId = uuidSchema.safeParse(request.params.id);
    if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Recruiter ID is invalid');
    let client;
    try { client = clientFactory(request.auth!.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter approvals are not configured'); }
    const { data, error } = await client.rpc('decide_recruiter_application', {
      p_user_id: parsedId.data,
      p_decision: request.body.decision,
    });
    if (error) throw mapRpcError(error.code);
    if (data !== true) throw mapRpcError('P0002');
    response.json({ updated: true, status: request.body.decision });
  }));

  return router;
}

export const adminRouter = createAdminRouter();
