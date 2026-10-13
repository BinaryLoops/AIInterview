/**
 * Types and interfaces for the AuthSession lifecycle.
 */

export interface CreateSessionParams {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  sessionId: string;
  rawRefreshToken: string;
  expiresAt: Date;
  userId: string;
}

export interface RotatedSession {
  sessionId: string;
  rawRefreshToken: string;
  expiresAt: Date;
  userId: string;
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

export interface RevokeSessionResult {
  success: boolean;
  message: string;
}
