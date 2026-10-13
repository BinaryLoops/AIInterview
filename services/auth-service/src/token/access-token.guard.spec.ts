import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenGuard } from './access-token.guard.js';
import { TokenService } from './token.service.js';
import { IS_PUBLIC_KEY } from '../authorization/public.decorator.js';
import { RoleName } from '../authorization/roles.js';
import type { AuthenticatedRequest } from '../authorization/authorization.types.js';

describe('AccessTokenGuard', () => {
  let guard: AccessTokenGuard;
  let reflector: Reflector;
  let mockTokenService: any;

  const createMockContext = (
    request: AuthenticatedRequest,
    isPublic = false,
  ): ExecutionContext => {
    const handler = () => {};
    const targetClass = class {};

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === IS_PUBLIC_KEY) return isPublic as any;
      return undefined;
    });

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => handler,
      getClass: () => targetClass,
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    mockTokenService = {
      verifyAccessToken: vi.fn(),
      toPrincipal: vi.fn(),
      isTokenRevoked: vi.fn().mockResolvedValue(false),
      getAccountState: vi.fn().mockResolvedValue({ status: 'ACTIVE', roles: [RoleName.CANDIDATE] }),
    };
    guard = new AccessTokenGuard(reflector, mockTokenService as TokenService);
  });


  describe('Public Routes (@Public)', () => {
    it('permits access to @Public routes without an Authorization header', async () => {
      const context = createMockContext({ headers: {} }, true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('permits access to @Public routes even if an invalid token is provided', async () => {
      const context = createMockContext({ headers: { authorization: 'Bearer invalid.token' } }, true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Protected Routes - Missing or Malformed Headers', () => {
    it('rejects requests with missing Authorization header with 401', async () => {
      const context = createMockContext({ headers: {} }, false);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing or malformed Authorization header.',
      );
    });

    it('rejects requests with non-Bearer authentication schemes (e.g. Basic)', async () => {
      const context = createMockContext(
        { headers: { authorization: 'Basic dXNlcjpwYXNz' } },
        false,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Authorization header must use format: Bearer <token>.',
      );
    });

    it('rejects requests with Bearer keyword but no token payload', async () => {
      const context = createMockContext({ headers: { authorization: 'Bearer ' } }, false);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Refresh Token Misuse Prevention', () => {
    it('explicitly rejects refresh tokens presented as bearer access tokens with 401', async () => {
      const compoundRefreshToken = '33333333-3333-4333-8333-333333333333.mockRandomSecret12345678901234567890';
      const context = createMockContext(
        { headers: { authorization: `Bearer ${compoundRefreshToken}` } },
        false,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Refresh tokens cannot be used as bearer access tokens.',
      );
      expect(mockTokenService.verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('Valid Bearer Access Token Verification', () => {
    it('verifies valid token, attaches AuthenticatedPrincipal to request.user, and permits access', async () => {
      const validJwt = 'header.payload.signature';
      const mockClaims = {
        sub: 'user-uuid-1',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'session-uuid-1',
        jti: 'jti-1',
        iss: 'arep-auth-service',
        aud: 'arep-api',
        iat: 1000,
        exp: 1900,
      };
      const mockPrincipal = {
        id: 'user-uuid-1',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: 'session-uuid-1',
        authVerified: true,
      };

      mockTokenService.verifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockTokenService.toPrincipal.mockReturnValueOnce(mockPrincipal);

      const request: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${validJwt}` },
      };
      const context = createMockContext(request, false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockTokenService.verifyAccessToken).toHaveBeenCalledWith(validJwt);
      expect(request.user).toEqual(mockPrincipal);
      expect(request.user?.authVerified).toBe(true);
    });

    it('rejects expired or invalid signature tokens by propagating UnauthorizedException', async () => {
      mockTokenService.verifyAccessToken.mockRejectedValue(
        new UnauthorizedException('Access token has expired.'),
      );

      const context = createMockContext(
        { headers: { authorization: 'Bearer expired.jwt.token' } },
        false,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Access token has expired.');
    });
  });

  describe('Zero Client Trust', () => {
    it('ignores client-supplied role or user headers', async () => {
      const validJwt = 'valid.jwt.token';
      const mockClaims = {
        sub: 'genuine-user-id',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sid: 'sess-1',
        jti: 'jti-1',
        iss: 'arep-auth-service',
        aud: 'arep-api',
        iat: 1000,
        exp: 1900,
      };

      mockTokenService.verifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockTokenService.toPrincipal.mockReturnValueOnce({
        id: 'genuine-user-id',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        sessionId: 'sess-1',
        authVerified: true,
      });

      const request: AuthenticatedRequest = {
        headers: {
          authorization: `Bearer ${validJwt}`,
          'x-user-role': 'SUPER_ADMIN',
          'x-user-id': 'spoofed-admin-id',
        },
        body: { role: 'SUPER_ADMIN' },
        query: { role: 'SUPER_ADMIN' },
      };
      const context = createMockContext(request, false);

      await guard.canActivate(context);

      // Principal must strictly derive from token claims, not spoofed client headers
      expect(request.user?.id).toBe('genuine-user-id');
      expect(request.user?.roles).toEqual([RoleName.CANDIDATE]);
    });
  });

  describe('Revocation & Account-State Enforcement', () => {
    const validJwt = 'valid.jwt.token';
    const mockClaims = {
      sub: 'target-user-id',
      email: 'target@example.com',
      roles: [RoleName.CANDIDATE],
      sid: 'target-session-id',
      jti: 'jti-1',
      iss: 'arep-auth-service',
      aud: 'arep-api',
      iat: 1000,
      exp: 1900,
    };

    it('rejects access tokens revoked via user or session revocation epoch with 401', async () => {
      mockTokenService.verifyAccessToken.mockResolvedValue(mockClaims);
      mockTokenService.isTokenRevoked.mockResolvedValue(true);

      const context = createMockContext({
        headers: { authorization: `Bearer ${validJwt}` },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Session or credentials have been revoked. Please sign in again.',
      );
      expect(mockTokenService.toPrincipal).not.toHaveBeenCalled();
    });

    it('rejects access tokens for suspended accounts with 401', async () => {
      mockTokenService.verifyAccessToken.mockResolvedValue(mockClaims);
      mockTokenService.isTokenRevoked.mockResolvedValue(false);
      mockTokenService.getAccountState.mockResolvedValue({
        status: 'SUSPENDED',
        roles: [RoleName.CANDIDATE],
      });

      const context = createMockContext({
        headers: { authorization: `Bearer ${validJwt}` },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Account is suspended. Please contact support.',
      );
      expect(mockTokenService.toPrincipal).not.toHaveBeenCalled();
    });

    it('rejects access tokens for deactivated accounts with 401', async () => {
      mockTokenService.verifyAccessToken.mockResolvedValue(mockClaims);
      mockTokenService.isTokenRevoked.mockResolvedValue(false);
      mockTokenService.getAccountState.mockResolvedValue({
        status: 'DEACTIVATED',
        roles: [RoleName.CANDIDATE],
      });

      const context = createMockContext({
        headers: { authorization: `Bearer ${validJwt}` },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Account is deactivated. Please contact support.',
      );
      expect(mockTokenService.toPrincipal).not.toHaveBeenCalled();
    });


    it('synchronizes principal roles when user roles have been updated/revoked', async () => {
      const claimsWithOldRole = {
        ...mockClaims,
        roles: [RoleName.ADMIN, RoleName.CANDIDATE],
      };
      mockTokenService.verifyAccessToken.mockResolvedValueOnce(claimsWithOldRole);
      mockTokenService.isTokenRevoked.mockResolvedValueOnce(false);
      // Live account state only has CANDIDATE (ADMIN was revoked)
      mockTokenService.getAccountState.mockResolvedValueOnce({
        status: 'ACTIVE',
        roles: [RoleName.CANDIDATE],
      });
      mockTokenService.toPrincipal.mockImplementation((claims: any, roles: any) => ({
        id: claims.sub,
        email: claims.email,
        roles: roles,
        sessionId: claims.sid,
        authVerified: true,
      }));

      const request: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${validJwt}` },
      };
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockTokenService.toPrincipal).toHaveBeenCalledWith(
        claimsWithOldRole,
        [RoleName.CANDIDATE],
      );
      expect(request.user?.roles).toEqual([RoleName.CANDIDATE]);
      expect(request.user?.roles).not.toContain(RoleName.ADMIN);
    });

    it('permits valid unaffected active users without disruption', async () => {
      mockTokenService.verifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockTokenService.isTokenRevoked.mockResolvedValueOnce(false);
      mockTokenService.getAccountState.mockResolvedValueOnce({
        status: 'ACTIVE',
        roles: [RoleName.CANDIDATE],
      });
      mockTokenService.toPrincipal.mockReturnValueOnce({
        id: mockClaims.sub,
        email: mockClaims.email,
        roles: [RoleName.CANDIDATE],
        sessionId: mockClaims.sid,
        authVerified: true,
      });

      const request: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${validJwt}` },
      };
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(request.user?.id).toBe(mockClaims.sub);
      expect(request.user?.authVerified).toBe(true);
    });
  });
});

