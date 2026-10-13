/**
 * Canonical application roles matching the Role Prisma model.
 * Seeded roles: CANDIDATE, RECRUITER, COMPANY_HR, MODERATOR, ADMIN, SUPER_ADMIN
 */
export const RoleName = {
  CANDIDATE: 'CANDIDATE',
  RECRUITER: 'RECRUITER',
  COMPANY_HR: 'COMPANY_HR',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type RoleName = (typeof RoleName)[keyof typeof RoleName];

/**
 * Array of all canonical role names.
 */
export const CANONICAL_ROLES: readonly RoleName[] = Object.values(RoleName);

/**
 * Type guard verifying if a value is a valid canonical RoleName.
 */
export function isRoleName(role: unknown): role is RoleName {
  return typeof role === 'string' && (CANONICAL_ROLES as readonly string[]).includes(role);
}

/**
 * Verified authenticated principal attached by upstream authentication guards/middleware.
 */
export interface AuthenticatedPrincipal {
  /** Unique user ID (UUID) */
  id: string;
  /** User email address */
  email: string;
  /** Verified array of canonical roles assigned to the user */
  roles: RoleName[];
  /** Optional session identifier if authenticated via an active session */
  sessionId?: string;
  /** Cryptographic provenance flag indicating creation by trusted AccessTokenGuard */
  authVerified?: boolean;
  /** Additional optional metadata */
  [key: string]: unknown;
}

/**
 * Request contract representing an authenticated HTTP request.
 */
export interface AuthenticatedRequest {
  user?: AuthenticatedPrincipal;
  [key: string]: unknown;
}
