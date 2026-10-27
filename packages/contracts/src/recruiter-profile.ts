import { z } from 'zod';

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(max).nullable(),
);

const optionalPhone = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(32).nullable().refine(
    (value) => value === null || /^\+?[0-9][0-9\s().-]{5,30}$/.test(value) && value.replace(/\D/g, '').length >= 7,
    'Enter a valid phone number or leave it blank.',
  ),
);
const optionalWebsite = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(2048).nullable().refine((value) => {
    if (value === null) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }, 'Enter a valid HTTPS company website or leave it blank.'),
);

export const recruiterProfileDetailsSchema = z.object({
  phone_number: optionalText(32),
  company_name: optionalText(150),
  job_title: optionalText(150),
  company_website: z.string().url().nullable(),
  location_city: optionalText(100),
  location_country: optionalText(100),
});

export const recruiterProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  phoneNumber: optionalPhone,
  companyName: optionalText(150),
  jobTitle: optionalText(150),
  companyWebsite: optionalWebsite,
  locationCity: optionalText(100),
  locationCountry: optionalText(100),
}).strict();

export type RecruiterProfileDetails = z.infer<typeof recruiterProfileDetailsSchema>;
export type RecruiterProfileUpdate = z.infer<typeof recruiterProfileUpdateSchema>;
