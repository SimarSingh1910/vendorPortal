/**
 * Cross-cutting types shared between the API and the web client.
 *
 * Domain entity contracts (User, Clinic, ExpenseHead, Submission, ...) will be
 * added alongside the Prisma schema in a later step. For now this holds the
 * primitives that the scaffolding needs — health responses and the JWT claim
 * shape that RBAC will rely on.
 */

import type { UserRole } from './enums';

/** Response from the API health endpoint. */
export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string; // ISO-8601, UTC
}

/**
 * Decoded JWT access-token claims.
 * `clinicIds` scopes clinic-bound roles; empty/undefined for Finance roles.
 */
export interface JwtClaims {
  sub: string; // user id
  email: string;
  role: UserRole;
  clinicIds?: string[];
}

/** Authenticated user identity returned to the client on login/refresh. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  clinicIds: string[];
}

/** Token pair issued by /auth/login and /auth/refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Response body for /auth/login and /auth/refresh. */
export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}

/** Standard error envelope returned by the API. */
export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
