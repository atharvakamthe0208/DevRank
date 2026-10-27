import { Router } from 'express';
import { healthController } from '../controllers/health.js';
import { authenticate, isMissingRecruiterProfileDetailsSchema } from '../middleware/authenticate.js';
import { adminRouter } from './admin.js';
import { getSupabaseClient } from '../config/supabase.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../middleware/http-error.js';
import { validateBody } from '../middleware/validate-body.js';
import { recruiterProfileUpdateSchema, type RecruiterProfileUpdate } from '@devrank/contracts';

type RecruiterProfile = NonNullable<NonNullable<import('../types/auth.js').AuthContext['profile']>>;
type ProfileUpdater = (accessToken: string, userId: string, update: RecruiterProfileUpdate) => Promise<RecruiterProfile>;

const updateRecruiterProfile: ProfileUpdater = async (accessToken, userId, update) => {
  let client;
  try { client = getSupabaseClient(accessToken); }
  catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter profile storage is not configured'); }
  const { data, error } = await client.from('profiles')
    .update({
      display_name: update.displayName,
      phone_number: update.phoneNumber,
      company_name: update.companyName,
      job_title: update.jobTitle,
      company_website: update.companyWebsite,
      location_city: update.locationCity,
      location_country: update.locationCountry,
    })
    .eq('id', userId)
    .select('id,display_name,phone_number,company_name,job_title,company_website,location_city,location_country,role,approval_status')
    .maybeSingle();
  if (error) {
    if (isMissingRecruiterProfileDetailsSchema(error)) {
      throw new HttpError(503, 'PROFILE_SCHEMA_MIGRATION_REQUIRED', 'Recruiter profile details are not available yet. Apply the recruiter profile details migration, then restart the API.');
    }
    if (error.code === '42501') throw new HttpError(403, 'PROFILE_UPDATE_FORBIDDEN', 'Your recruiter profile could not be updated');
    throw new HttpError(503, 'PROFILE_UPDATE_UNAVAILABLE', 'Recruiter profile could not be saved right now');
  }
  if (!data) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Your recruiter profile could not be found');
  return data as RecruiterProfile;
};

export function createApiRouter(authMiddleware = authenticate, profileUpdater: ProfileUpdater = updateRecruiterProfile) {
  const router = Router();
  router.get('/health', healthController);
  router.get('/auth/me', authMiddleware, (request, response) => {
    const auth = request.auth!;
    response.json({ user: { id: auth.userId, email: auth.email }, profile: auth.profile, emailConfirmed: auth.emailConfirmed });
  });
  router.patch('/auth/me', authMiddleware, validateBody(recruiterProfileUpdateSchema), asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const profile = await profileUpdater(auth.accessToken, auth.userId, request.body);
    response.json({ user: { id: auth.userId, email: auth.email }, profile, emailConfirmed: auth.emailConfirmed });
  }));
  router.use('/admin', adminRouter);
  return router;
}

export const apiRouter = createApiRouter();
