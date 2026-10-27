import { describe, expect, it } from 'vitest';
import { recruiterProfileUpdateSchema } from '../src/recruiter-profile.js';

const valid = {
  displayName: 'Priya Sharma', phoneNumber: '+1 (206) 555-0134', companyName: 'Northwind',
  jobTitle: 'Talent Partner', companyWebsite: 'https://northwind.example',
  locationCity: 'Seattle', locationCountry: 'United States',
};

describe('recruiter profile update contract', () => {
  it('accepts validated personal and professional profile details', () => {
    expect(recruiterProfileUpdateSchema.parse(valid)).toEqual(valid);
  });

  it('normalizes blank optional fields to null', () => {
    expect(recruiterProfileUpdateSchema.parse({ ...valid, phoneNumber: ' ', companyName: '', jobTitle: '', companyWebsite: '', locationCity: '', locationCountry: '' })).toMatchObject({
      phoneNumber: null, companyName: null, jobTitle: null, companyWebsite: null, locationCity: null, locationCountry: null,
    });
  });

  it.each([
    { phoneNumber: 'call-me' },
    { companyWebsite: 'http://insecure.example' },
    { role: 'admin' },
    { approval_status: 'approved' },
    { userId: 'another-user' },
  ])('rejects invalid formats or protected profile fields: %o', (override) => {
    expect(recruiterProfileUpdateSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
