/**
 * Canonical application roles matching the Role Prisma model.
 * Seeded roles: CANDIDATE, RECRUITER, COMPANY_HR, MODERATOR, ADMIN, SUPER_ADMIN
 *
 * All role-based authorization checks in the application must reference these
 * canonical values rather than ad-hoc string literals.
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
 * Readonly array of all canonical role names.
 */
export const CANONICAL_ROLES: readonly RoleName[] = Object.values(RoleName);

/**
 * Type guard verifying if an unknown value is a valid canonical RoleName.
 */
export function isRoleName(role: unknown): role is RoleName {
  return typeof role === 'string' && (CANONICAL_ROLES as readonly string[]).includes(role);
}
