import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import multer from 'multer';
import { Router, type RequestHandler } from 'express';
import { createScreeningController } from '../controllers/screening-controller.js';
import { authenticate, requireApprovedRecruiter } from '../middleware/authenticate.js';
import { HttpError } from '../middleware/http-error.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 20;
type UploadRequest = Express.Request & { screeningTempDir?: string };

const upload = multer({
  storage: multer.diskStorage({
    destination: (request, _file, callback) => callback(null, (request as UploadRequest).screeningTempDir!),
    filename: (_request, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES, fields: 2, parts: MAX_FILES + 2 },
  // Let the controller mark an unsupported file failed without rejecting valid
  // files included in the same bounded multipart upload.
  fileFilter: (_request, _file, callback) => callback(null, true),
});

function uploadError(error: unknown): HttpError {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return new HttpError(413, 'RESUME_TOO_LARGE', 'Each resume must be 10 MB or smaller.');
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT') return new HttpError(400, 'TOO_MANY_RESUMES', `A screening session can include at most ${MAX_FILES} resumes.`);
    if (error.code === 'LIMIT_FIELD_COUNT' || error.code === 'LIMIT_FIELD_VALUE') return new HttpError(400, 'INVALID_SCREENING_FIELDS', 'The screening form contains invalid fields.');
  }
  return error instanceof HttpError ? error : new HttpError(400, 'INVALID_MULTIPART_REQUEST', 'The uploaded resume form could not be read.');
}

const parseUpload: RequestHandler = (request, response, next) => {
  void mkdtemp(join(tmpdir(), 'devrank-screening-')).then((directory) => {
    (request as UploadRequest).screeningTempDir = directory;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void rm(directory, { recursive: true, force: true }).catch(() => undefined);
    };
    response.once('finish', cleanup);
    response.once('close', cleanup);
    upload.array('resumes', MAX_FILES)(request, response, (error: unknown) => {
      if (error) { cleanup(); next(uploadError(error)); return; }
      next();
    });
  }).catch(() => next(new HttpError(500, 'UPLOAD_TEMP_UNAVAILABLE', 'The API could not prepare secure temporary upload storage.')));
};

export function createScreeningsRouter(
  authMiddleware: RequestHandler = authenticate,
  approvalMiddleware: RequestHandler = requireApprovedRecruiter,
  controller = createScreeningController(),
) {
  const router = Router();
  router.post('/', authMiddleware, approvalMiddleware, parseUpload, controller.submit);
  router.get('/:id', authMiddleware, approvalMiddleware, controller.get);
  router.get('/:id/ranking', authMiddleware, approvalMiddleware, controller.ranking);
  router.post('/:id/resumes/:resumeId/retry', authMiddleware, approvalMiddleware, controller.retry);
  router.post('/:id/compare', authMiddleware, approvalMiddleware, controller.compare);
  router.post('/:id/report', authMiddleware, approvalMiddleware, controller.report);
  return router;
}

export const screeningsRouter = createScreeningsRouter();

