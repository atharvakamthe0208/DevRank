import type { Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireAdmin } from '../src/middleware/authenticate.js';
import { createAdminRouter } from '../src/routes/admin.js';
import type { AuthContext } from '../src/types/auth.js';

const adminAuth: AuthContext = {
  userId: '10000000-0000-4000-8000-000000000001', email: 'admin@example.com', emailConfirmed: true, accessToken: 'verified-token',
  profile: { id: '10000000-0000-4000-8000-000000000001', display_name: 'Project Owner', role: 'admin', approval_status: 'approved' },
};
const applicationId = '20000000-0000-4000-8000-000000000001';

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> }; handle: RequestHandler };

function routeHandler(router: ReturnType<typeof createAdminRouter>, path: string, method: string, handlerIndex = -1) {
  const route = (router.stack as unknown as RouteLayer[]).find((layer) => layer.route?.path === path && layer.route.methods[method]);
  if (!route?.route) throw new Error(`Missing ${method.toUpperCase()} ${path} route`);
  return route.route.stack.at(handlerIndex)?.handle ?? (() => { throw new Error(`Missing handler for ${method} ${path}`); })();
}

async function invoke(handler: RequestHandler, fields: Partial<Request>) {
  let status = 200;
  let body: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; finish(); return this; },
    headersSent: false,
  } as unknown as Response;
  let resolveResult!: (result: { status: number; body: unknown }) => void;
  const result = new Promise<{ status: number; body: unknown }>((resolve) => { resolveResult = resolve; });
  function finish() { resolveResult({ status, body }); }
  handler(fields as Request, response, (error) => {
    if (error) {
      const failure = typeof error === 'object' && error !== null ? error as { statusCode?: number; code?: string; message?: string; details?: unknown } : {};
      status = failure.statusCode ?? 500;
      body = failure.code ? { error: { code: failure.code, message: failure.message, ...(failure.details === undefined ? {} : { details: failure.details }) } } : error;
      finish();
    }
  });
  return result;
}

function adminRouter(rpc: ReturnType<typeof vi.fn>) {
  const client = { rpc };
  return createAdminRouter(vi.fn() as unknown as RequestHandler, requireAdmin, (() => client) as never);
}

describe('admin recruiter-management API', () => {
  it('mounts authentication and administrator authorization before its API routes', () => {
    const authMiddleware = vi.fn() as unknown as RequestHandler;
    const router = createAdminRouter(authMiddleware, requireAdmin, (() => ({ rpc: vi.fn() })) as never);
    const middleware = (router.stack as unknown as RouteLayer[]).filter((layer) => !layer.route);
    expect(middleware).toHaveLength(2);
    expect(middleware[0].handle).toBe(authMiddleware);
    expect(middleware[1].handle).toBe(requireAdmin);
    expect((router.stack as unknown as RouteLayer[]).find((layer) => layer.route)?.route?.path).toBe('/recruiters');
  });

  it('denies unauthenticated, non-admin, pending, and unconfirmed callers', () => {
    for (const auth of [
      null,
      { ...adminAuth, profile: { ...adminAuth.profile!, role: 'recruiter' as const } },
      { ...adminAuth, profile: { ...adminAuth.profile!, approval_status: 'pending' as const } },
      { ...adminAuth, emailConfirmed: false },
    ]) {
      const request = { auth } as unknown as Request;
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();
      requireAdmin(request, response, next);
      expect(response.status).toHaveBeenCalledWith(auth ? 403 : 401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('lists all recruiter states through the existing administrator-only RPC', async () => {
    const recruiters = [{ user_id: applicationId, email: 'new@example.com', display_name: 'New Recruiter', registered_at: '2026-10-19T10:00:00Z', approval_status: 'pending' }];
    const rpc = vi.fn().mockResolvedValue({ data: recruiters, error: null });
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters', 'get'), {
      query: { status: 'all' }, auth: adminAuth,
    });
    expect(result).toEqual({ status: 200, body: { recruiters } });
    expect(rpc).toHaveBeenCalledWith('list_recruiter_applications', { p_status: null });
  });

  it('returns validated profile details through the administrator-only details RPC', async () => {
    const details = {
      profile: {
        userId: applicationId, email: 'recruiter@example.com', displayName: 'Recruiter', phoneNumber: null,
        companyName: null, jobTitle: null, companyWebsite: null, locationCity: null, locationCountry: null,
        role: 'recruiter', approvalStatus: 'approved', emailConfirmed: true,
        registeredAt: '2026-10-19T10:00:00+00:00', profileUpdatedAt: '2026-10-20T10:00:00+00:00',
        lastApprovalDecision: { status: 'approved', decidedAt: '2026-10-20T10:00:00+00:00', decidedByUserId: adminAuth.userId },
      },
      stats: {
        totalEvaluations: 4, completedEvaluations: 2, inProgressEvaluations: 1, distinctCandidatesEvaluated: 2,
        resumeScreeningsInitiated: 3, completedResumeScreenings: 2, averageCompletedEvaluationScore: 74.5,
        recentActivityCount30Days: 5,
      },
      recentActivity: [{ id: 'evaluation:record-1', type: 'evaluation_created', occurredAt: '2026-10-20T10:00:00+00:00', summary: 'Evaluation created' }],
    };
    const rpc = vi.fn().mockResolvedValue({ data: details, error: null });
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/details', 'get'), {
      params: { id: applicationId }, auth: adminAuth,
    });
    expect(result).toEqual({ status: 200, body: { details } });
    expect(rpc).toHaveBeenCalledWith('get_admin_recruiter_details', { p_user_id: applicationId });
  });

  it('rejects malformed recruiter IDs before calling the details RPC', async () => {
    const rpc = vi.fn();
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/details', 'get'), {
      params: { id: 'not-a-uuid' }, auth: adminAuth,
    });
    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed database detail data without exposing it', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: { profile: { email: 'not-an-email', phoneNumber: 17 }, privateField: 'sensitive' }, error: null });
    try {
      const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/details', 'get'), {
        params: { id: applicationId }, auth: adminAuth,
      });
      expect(result).toMatchObject({ status: 503, body: { error: { code: 'RECRUITER_DETAILS_UNAVAILABLE' } } });
      expect(JSON.stringify(result.body)).not.toContain('sensitive');
      expect(diagnostic).toHaveBeenCalledWith('[admin-recruiter-details] RPC response contract validation failed', {
        issueCodes: expect.arrayContaining(['invalid_type', 'invalid_string']),
        issuePaths: expect.arrayContaining(['profile.email', 'profile.phoneNumber']),
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive');
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('logs only the safe RPC-resolution category and database code when the details function is unavailable', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {
      code: 'PGRST202', message: 'private recruiter email and schema details', details: 'sensitive database text',
    } });
    try {
      const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/details', 'get'), {
        params: { id: applicationId }, auth: adminAuth,
      });
      expect(result).toMatchObject({ status: 503, body: { error: { code: 'RECRUITER_DETAILS_UNAVAILABLE' } } });
      expect(diagnostic).toHaveBeenCalledWith('[admin-recruiter-details] RPC failed', {
        failureCategory: 'rpc_resolution', errorCode: 'PGRST202',
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private recruiter');
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive database text');
      expect(rpc).toHaveBeenCalledWith('get_admin_recruiter_details', { p_user_id: applicationId });
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('maps forbidden and missing recruiter details without exposing RPC messages', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'internal detail' } });
    const handler = routeHandler(adminRouter(rpc), '/recruiters/:id/details', 'get');
    const forbidden = await invoke(handler, { params: { id: applicationId }, auth: adminAuth });
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(forbidden.body)).not.toContain('internal detail');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'internal detail' } });
    const missing = await invoke(handler, { params: { id: applicationId }, auth: adminAuth });
    expect(missing).toMatchObject({ status: 404, body: { error: { code: 'RECRUITER_NOT_FOUND' } } });
  });

  it.each(['approved', 'rejected'] as const)('sends a %s decision to the database guard', async (decision) => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/decision', 'patch', -1), {
      params: { id: applicationId }, body: { decision }, auth: adminAuth,
    });
    expect(result).toEqual({ status: 200, body: { updated: true, status: decision } });
    expect(rpc).toHaveBeenCalledWith('decide_recruiter_application', { p_user_id: applicationId, p_decision: decision });
  });

  it('does not report success when an eligible pending row was not updated', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters/:id/decision', 'patch'), {
      params: { id: applicationId }, body: { decision: 'approved' }, auth: adminAuth,
    });
    expect(result).toEqual({ status: 404, body: { error: { code: 'APPLICATION_NOT_FOUND', message: 'That pending recruiter application was not found' } } });
  });

  it('maps concurrent and already-decided attempts to a safe conflict outcome', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0002' } });
    const handler = routeHandler(adminRouter(rpc), '/recruiters/:id/decision', 'patch');
    const result = await invoke(handler, { params: { id: applicationId }, body: { decision: 'approved' }, auth: adminAuth });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'APPLICATION_NOT_FOUND' } });
  });

  it('rejects unsupported filters, malformed IDs, and invalid decisions', async () => {
    const rpc = vi.fn();
    const router = adminRouter(rpc);
    const badFilter = await invoke(routeHandler(router, '/recruiters', 'get'), { query: { status: 'suspended' }, auth: adminAuth });
    expect(badFilter.status).toBe(400);
    const badId = await invoke(routeHandler(router, '/recruiters/:id/decision', 'patch'), { params: { id: 'not-a-uuid' }, body: { decision: 'approved' }, auth: adminAuth });
    expect(badId.status).toBe(400);
    const invalidBody = await invoke(routeHandler(router, '/recruiters/:id/decision', 'patch', 0), { params: { id: applicationId }, body: { decision: 'suspended' }, auth: adminAuth });
    expect(invalidBody.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps database failures without exposing database details', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '08006', message: 'private connection detail' } });
    const result = await invoke(routeHandler(adminRouter(rpc), '/recruiters', 'get'), { query: {}, auth: adminAuth });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('private connection detail');
    expect(result.body).toMatchObject({ error: { code: 'APPROVAL_SERVICE_UNAVAILABLE' } });
  });
});
