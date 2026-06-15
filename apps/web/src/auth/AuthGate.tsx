import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useBootstrap } from '@/auth/useBootstrap';

/**
 * Runs the one-shot session bootstrap and gates all rendering until it resolves,
 * so we never flash the login page for a user who has a live refresh session.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  useBootstrap();
  const status = useAuthStore((s) => s.status);

  if (status === 'pending') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
