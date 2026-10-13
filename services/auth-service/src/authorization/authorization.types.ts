import type { RoleName } from './roles.js';

/**
 * Authenticated principal contract attached to an HTTP request by an upstream
 * authentication mechanism (e.g. access-token verification guard or session middleware).
 *
 * Security Boundary:
 * This principal MUST be populated only from trusted, server-verified tokens or
 * database queries. Never construct or trust an AuthenticatedPrincipal based on
 * untrusted client headers, query parameters, or request bodies.
 */
export interface AuthenticatedPrincipal {
  /** Unique user identifier (UUID) */
  id: string;
  /** Normalized email address */
  email: string;
  /** Verified set of canonical roles assigned to the user */
  roles: RoleName[];
  /** Optional session identifier if authenticated via an active session */
  sessionId?: string;
  /** Cryptographic provenance flag indicating creation by trusted AccessTokenGuard */
  authVerified?: boolean;
  /** Extensible dictionary for custom validated claims */
  [key: string]: unknown;
}

/**
 * Type contract for an HTTP request that may carry an authenticated principal.
 */
export interface AuthenticatedRequest {
  /**
   * The authenticated principal, set exclusively by server-side authentication guards.
   * If undefined on a protected route, authorization guards MUST reject with 401 Unauthorized.
   */
  user?: AuthenticatedPrincipal;
  [key: string]: unknown;
}
