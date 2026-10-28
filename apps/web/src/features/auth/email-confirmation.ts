/** Build the confirmation callback for the origin currently serving the app. */
export function emailConfirmationRedirectTo(origin: string): string {
  return new URL('/auth/callback', origin).toString();
}
