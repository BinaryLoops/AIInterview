import type { RoleName } from '../authorization/roles.js';
import type { AccountStatus } from '@prisma/client';

/**
 * Validated account state snapshot for authorization enforcement.
 */
export interface AccountState {
  status: AccountStatus;
  roles: RoleName[];
}

/**
 * Verified claims payload embedded within a signed JWT access token.
 */
export interface AccessTokenClaims {
  /** Subject: unique user UUID */
  sub: string;
  /** Normalized email address */
  email: string;
  /** Verified set of canonical roles */
  roles: RoleName[];
  /** Session ID binding this access token to an active AuthSession record */
  sid: string;
  /** Unique JWT token identifier */
  jti: string;
  /** Issuer claim */
  iss: string;
  /** Audience claim */
  aud: string;
  /** Issued-at unix epoch seconds */
  iat: number;
  /** Expiration unix epoch seconds */
  exp: number;
  /** Extensible custom claims */
  [key: string]: unknown;
}

/**
 * Parameters required to generate a signed access token.
 */
export interface GenerateAccessTokenParams {
  userId: string;
  email: string;
  roles: RoleName[];
  sessionId: string;
}

/**
 * Result returned upon successful access token generation.
 */
export interface GeneratedAccessToken {
  token: string;
  tokenType: 'Bearer';
  expiresIn: number;
  claims: AccessTokenClaims;
}
