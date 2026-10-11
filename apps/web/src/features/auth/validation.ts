export const MIN_PASSWORD_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address, such as you@company.com.';
}

export function validatePassword(password: string): string | undefined {
  if (!password) return 'Enter your password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
}

export function validateSignup(fullName: string, email: string, password: string, confirm: string) {
  return {
    fullName: fullName.trim() ? undefined : 'Enter your full name.',
    email: validateEmail(email),
    password: validatePassword(password),
    confirm: confirm === password && confirm ? undefined : 'Passwords do not match.',
  };
}
