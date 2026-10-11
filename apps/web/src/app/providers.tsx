import type { PropsWithChildren } from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';

// Add shared providers here as the application needs them.
export function Providers({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}
