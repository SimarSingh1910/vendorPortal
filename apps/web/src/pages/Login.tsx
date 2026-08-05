import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate } from 'react-router-dom';
import { CircleAlert, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PortalTab } from '@portal/shared';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/apiError';
import { useAuthStore } from '@/store/auth.store';
import { useAuthActions } from '@/auth/useAuthActions';
import { roleHome } from '@/auth/roles';
import hclLogo from '@/assets/hcl-healthcare-logo.png';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

/**
 * The portal tabs, now load-bearing: the active one is sent with the credentials
 * and the API rejects an account that isn't entitled to it, so a clinic user
 * cannot sign in on Corporate or vice versa. FINANCE_ADMIN belongs to both and
 * passes on either — which tab they pick decides where they land.
 *
 * The tab is a HINT, not the security boundary: the server re-derives entitlement
 * from the account's own role, so nothing is trusted from the client here.
 */
const PORTAL_TABS = [
  { key: PortalTab.CORPORATE, label: 'Corporate' },
  { key: PortalTab.CLINIC, label: 'Clinic' },
] as const;

export function Login() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { login } = useAuthActions();

  const [activeTab, setActiveTab] = useState<PortalTab>(PortalTab.CORPORATE);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in → go to the role home instead of showing the form.
  if (status === 'authenticated' && user) {
    return <Navigate to={roleHome(user.role)} replace />;
  }

  const onSubmit = handleSubmit((values) => login.mutate({ ...values, portal: activeTab }));

  const fieldClass = (invalid: boolean) =>
    cn('h-11 bg-background pl-10', invalid && 'border-destructive');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-[400px] overflow-hidden rounded-2xl shadow-lg">
        {/* (1) Portal tab strip — picks which portal the credentials are checked against. */}
        <div role="tablist" aria-label="Portal" className="flex border-b border-border">
          {PORTAL_TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(tab.key);
                  // Drop a stale "wrong portal" banner — switching tabs is exactly
                  // the fix it asked for, so leaving it up would read as a failure
                  // of the attempt they haven't made yet.
                  login.reset();
                }}
                className={cn(
                  '-mb-px flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {/* (2) HCL Healthcare lockup. */}
          <img
            src={hclLogo}
            alt="HCL Healthcare — Making Corporate India Healthier"
            className="mx-auto my-6 w-[200px]"
          />

          {/* (3) Title + (4) subtitle. */}
          <h1 className="text-center text-2xl font-bold text-foreground">Staff Portal</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Cost Provisions · HCL Healthcare
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {/* (5) Error banner — same condition/text as before, restyled. */}
            {login.isError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md bg-error px-3 py-3 text-sm text-error-foreground"
              >
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                {/* The API answers a wrong-portal sign-in with a specific reason
                    (naming the tab to use); anything else stays the deliberately
                    generic credentials message, which must not hint at whether
                    the address exists. */}
                <span>{apiErrorMessage(login.error, 'Invalid email or password.')}</span>
              </div>
            )}

            {/* (6) Email — the app authenticates by email; label/validation unchanged. */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-semibold text-foreground">
                Email
              </Label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  className={fieldClass(!!errors.email)}
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            {/* (7) Password — leading lock + trailing show/hide toggle (client-only). */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={cn(fieldClass(!!errors.password), 'pr-10')}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* (8) Sign in — handler, label and loading/disabled states unchanged. */}
            <Button type="submit" className="h-11 w-full" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {/* (9) Footer. */}
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            Secured with encryption
          </p>
        </div>
      </Card>
    </div>
  );
}
