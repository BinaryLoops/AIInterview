import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from './roles.guard.js';
import { RoleName } from './roles.js';
import { REQUIRE_ROLES_KEY } from './roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ALLOW_ANY_ROLE_KEY } from './allow-any-role.decorator.js';
import type { AuthenticatedPrincipal, AuthenticatedRequest } from './authorization.types.js';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createMockContext = (
    request: AuthenticatedRequest,
    metadata: {
      isPublic?: boolean;
      roles?: unknown;
      allowAnyRole?: boolean;
    } = {},
  ): ExecutionContext => {
    const handler = () => {};
    const targetClass = class {};

    // Mock Reflector.getAllAndOverride behavior
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === IS_PUBLIC_KEY) return metadata.isPublic as any;
      if (key === REQUIRE_ROLES_KEY) return metadata.roles as any;
      if (key === ALLOW_ANY_ROLE_KEY) return metadata.allowAnyRole as any;
      return undefined;
    });

    if (request.user && request.user.authVerified === undefined) {
      request.user.authVerified = true;
    }

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
    guard = new RolesGuard(reflector);
  });

  describe('1. Unauthenticated requests (401)', () => {
    it('throws UnauthorizedException on protected route when request.user is missing', () => {
      const context = createMockContext({}, { roles: [RoleName.ADMIN] });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        'Authentication required to access this resource.',
      );
    });

    it('throws UnauthorizedException when request.user is null', () => {
      const context = createMockContext({ user: undefined }, { roles: [RoleName.CANDIDATE] });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user object lacks an id', () => {
      const context = createMockContext(
        { user: { email: 'user@example.com', roles: [RoleName.CANDIDATE] } as unknown as AuthenticatedPrincipal },
        { roles: [RoleName.CANDIDATE] },
      );

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when request.user was not verified by trusted authentication layer (authVerified is false)', () => {
      const context = createMockContext(
        {
          user: {
            id: 'unverified-user-id',
            email: 'unverified@example.com',
            roles: [RoleName.ADMIN],
            authVerified: false,
          },
        },
        { roles: [RoleName.ADMIN] },
      );

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        'Authentication required to access this resource.',
      );
    });
  });

  describe('2. AllowAnyRole behavior', () => {
    it('permits access when route has allowAnyRole and user has a canonical role', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'user-id',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE],
        authVerified: true,
      };
      const context = createMockContext({ user: principal }, { allowAnyRole: true });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects access when route has allowAnyRole but user has empty roles', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'user-id',
        email: 'user@example.com',
        roles: [],
        authVerified: true,
      };
      const context = createMockContext({ user: principal }, { allowAnyRole: true });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('3. Role matching and authorization (403 vs Allow)', () => {
    it('permits access when user has the exact required role', () => {
      const principal: AuthenticatedPrincipal = {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@example.com',
        roles: [RoleName.ADMIN],
      };
      const context = createMockContext({ user: principal }, { roles: [RoleName.ADMIN] });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws ForbiddenException when user lacks the required role', () => {
      const principal: AuthenticatedPrincipal = {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'candidate@example.com',
        roles: [RoleName.CANDIDATE],
      };
      const context = createMockContext({ user: principal }, { roles: [RoleName.ADMIN] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Access denied: you do not have permission to access this resource.',
      );
    });

    it('throws ForbiddenException when user has an empty roles list', () => {
      const principal: AuthenticatedPrincipal = {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'empty@example.com',
        roles: [],
      };
      const context = createMockContext({ user: principal }, { roles: [RoleName.CANDIDATE] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('3. Multiple allowed roles behavior', () => {
    const multiRoleConfig = [RoleName.ADMIN, RoleName.MODERATOR];

    it('permits access when user has the first allowed role', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'admin-uuid',
        email: 'admin@example.com',
        roles: [RoleName.ADMIN],
      };
      const context = createMockContext({ user: principal }, { roles: multiRoleConfig });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('permits access when user has the second allowed role', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'mod-uuid',
        email: 'mod@example.com',
        roles: [RoleName.MODERATOR],
      };
      const context = createMockContext({ user: principal }, { roles: multiRoleConfig });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('permits access when user possesses multiple roles including one allowed role', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'multi-role-user',
        email: 'user@example.com',
        roles: [RoleName.CANDIDATE, RoleName.MODERATOR],
      };
      const context = createMockContext({ user: principal }, { roles: multiRoleConfig });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects with 403 when user has none of the multiple allowed roles', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'candidate-uuid',
        email: 'cand@example.com',
        roles: [RoleName.CANDIDATE],
      };
      const context = createMockContext({ user: principal }, { roles: multiRoleConfig });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('4. Public-route behavior (@Public)', () => {
    it('permits access to @Public routes even without an authenticated principal', () => {
      const context = createMockContext({}, { isPublic: true });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('permits access to @Public routes when user is present regardless of roles', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'cand-uuid',
        email: 'cand@example.com',
        roles: [RoleName.CANDIDATE],
      };
      const context = createMockContext({ user: principal }, { isPublic: true, roles: [RoleName.ADMIN] });

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('5. Client-supplied roles and IDs cannot grant access (Zero Client Trust)', () => {
    it('ignores client-supplied role headers, query parameters, and body when principal is missing', () => {
      const spoofedRequest = {
        headers: {
          'x-user-role': 'ADMIN',
          'x-user-id': 'spoofed-id',
          authorization: 'Bearer spoofed.token',
        },
        body: { role: 'ADMIN', roles: ['ADMIN'], userId: 'spoofed-id' },
        query: { role: 'ADMIN', roles: 'ADMIN' },
        // Notice: NO request.user attached by server-side authentication
      };

      const context = createMockContext(spoofedRequest, { roles: [RoleName.ADMIN] });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('ignores client-supplied role headers when request.user has insufficient role', () => {
      const spoofedRequest = {
        headers: {
          'x-user-role': 'SUPER_ADMIN',
          role: 'ADMIN',
        },
        body: { roles: ['ADMIN', 'SUPER_ADMIN'] },
        user: {
          id: 'genuine-candidate-id',
          email: 'genuine@example.com',
          roles: [RoleName.CANDIDATE],
        },
      };

      const context = createMockContext(spoofedRequest, { roles: [RoleName.ADMIN] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('6. Malformed or missing role metadata fails safely', () => {
    const validPrincipal: AuthenticatedPrincipal = {
      id: 'valid-id',
      email: 'valid@example.com',
      roles: [RoleName.ADMIN],
    };

    it('denies access with 403 when role metadata is undefined on a protected route', () => {
      const context = createMockContext({ user: validPrincipal }, { roles: undefined });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'Access denied: route authorization configuration is missing or malformed.',
      );
    });

    it('denies access with 403 when role metadata is an empty array', () => {
      const context = createMockContext({ user: validPrincipal }, { roles: [] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('denies access with 403 when role metadata contains unknown non-canonical role strings', () => {
      const context = createMockContext({ user: validPrincipal }, { roles: ['NON_EXISTENT_ROLE'] });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('denies access with 403 when role metadata is not an array (e.g. object or number)', () => {
      const context = createMockContext({ user: validPrincipal }, { roles: 12345 });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('7. NestJS Dependency Injection and Decorator Reflection', () => {
    it('resolves RolesGuard cleanly through NestJS TestingModule with Reflector', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [RolesGuard, Reflector],
      }).compile();

      const injectedGuard = module.get<RolesGuard>(RolesGuard);
      const injectedReflector = module.get<Reflector>(Reflector);

      expect(injectedGuard).toBeDefined();
      expect(injectedReflector).toBeDefined();
      expect(injectedGuard).toBeInstanceOf(RolesGuard);
    });

    it('inherits class-level @RequireRoles metadata when handler has no override', () => {
      const realReflector = new Reflector();
      const realGuard = new RolesGuard(realReflector);

      // Define a test class with class-level metadata
      class AdminController {}
      Reflect.defineMetadata(REQUIRE_ROLES_KEY, [RoleName.ADMIN], AdminController);

      const handler = () => {};

      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              id: 'admin-id',
              email: 'admin@example.com',
              roles: [RoleName.ADMIN],
              authVerified: true,
            },
          }),
        }),
        getHandler: () => handler,
        getClass: () => AdminController,
      } as unknown as ExecutionContext;

      expect(realGuard.canActivate(mockExecutionContext)).toBe(true);
    });

    it('allows handler-level @Public to override class-level @RequireRoles', () => {
      const realReflector = new Reflector();
      const realGuard = new RolesGuard(realReflector);

      class ProtectedController {}
      Reflect.defineMetadata(REQUIRE_ROLES_KEY, [RoleName.ADMIN], ProtectedController);

      const publicHandler = () => {};
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);

      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            // Unauthenticated
          }),
        }),
        getHandler: () => publicHandler,
        getClass: () => ProtectedController,
      } as unknown as ExecutionContext;

      expect(realGuard.canActivate(mockExecutionContext)).toBe(true);
    });
  });
});
