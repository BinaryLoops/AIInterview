import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT, jwtVerify, errors } from 'jose';
import { randomUUID } from 'node:crypto';
import { AccountStatus } from '@prisma/client';
import { AuthConfigService } from '../config/auth-config.service.js';
import { RedisService } from '../database/redis.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { isRoleName, type RoleName } from '../authorization/roles.js';
import type { AuthenticatedPrincipal } from '../authorization/authorization.types.js';
import type {
  AccessTokenClaims,
  AccountState,
  GenerateAccessTokenParams,
  GeneratedAccessToken,
} from './token.types.js';

/**
 * TokenService manages cryptographic signing and verification of short-lived
 * JWT access tokens using the industry-standard `jose` library, as well as
 * stateful revocation and account lifecycle tracking.
 *
 * ## Security & Revocation Guarantees:
 * 1. Cryptographic Integrity: Signed using HMAC-SHA256 (HS256) with validated key entropy.
 * 2. Explicit Verification: Strict validation of signature, expiry, issuer, and audience.
 * 3. Short-Lived Revocation Epochs: Revoked users or sessions are tracked with an issued-at epoch.
 *    Any token issued before or at the revocation timestamp is rejected mid-lifetime.
 * 4. Multi-Tiered Performance Caching:
 *    - L1 In-Memory Cache (5s TTL, 0ms latency): Eliminates database/Redis load on high-frequency requests.
 *    - L2 Redis Cache (60s TTL, <1ms latency): Scalable distributed state across multiple service instances.
 *    - L3 PostgreSQL DB: Authoritative source of truth for account status and assigned roles.
 * 5. Explicit Fallback: When Redis is disabled or fails, the service securely falls back to
 *    process-local bounded in-memory stores and DB queries, preventing unrestricted authorization bypasses.
 * 6. Zero Client Trust: Access tokens are generated exclusively on the server after
 *    trusted verification (e.g., login OTP or session rotation).
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  /**
   * Process-local bounded store for user-level revocations (fallback & 0ms fast path).
   * Maps userId -> revokedAtSeconds.
   */
  private readonly localRevokedUsers = new Map<string, number>();

  /**
   * Process-local bounded store for session-level revocations (fallback & 0ms fast path).
   * Maps sessionId -> revokedAtSeconds.
   */
  private readonly localRevokedSessions = new Map<string, number>();

  /**
   * Process-local bounded L1 cache for account lifecycle state.
   * Maps userId -> { status: AccountStatus; roles: RoleName[]; cachedAt: number }.
   */
  private readonly localAccountState = new Map<
    string,
    { status: AccountStatus; roles: RoleName[]; cachedAt: number }
  >();

  /** L1 cache time-to-live in milliseconds (5 seconds) */
  private readonly L1_CACHE_TTL_MS = 5000;

  constructor(
    private readonly configService: AuthConfigService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /**
   * Prunes expired entries from in-memory maps if capacity exceeds threshold.
   */
  private pruneExpiredLocalEntries(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const maxTtl = this.configService.jwt.expiresInSeconds;

    if (this.localRevokedUsers.size > 1000) {
      for (const [userId, revokedAt] of this.localRevokedUsers.entries()) {
        if (nowSeconds - revokedAt > maxTtl) {
          this.localRevokedUsers.delete(userId);
        }
      }
    }

    if (this.localRevokedSessions.size > 1000) {
      for (const [sessionId, revokedAt] of this.localRevokedSessions.entries()) {
        if (nowSeconds - revokedAt > maxTtl) {
          this.localRevokedSessions.delete(sessionId);
        }
      }
    }

    if (this.localAccountState.size > 1000) {
      const nowMs = Date.now();
      for (const [userId, entry] of this.localAccountState.entries()) {
        if (nowMs - entry.cachedAt > this.L1_CACHE_TTL_MS) {
          this.localAccountState.delete(userId);
        }
      }
    }
  }


  /**
   * Returns the encoded secret key as Uint8Array for jose web-crypto operations.
   */
  private getSecretKey(): Uint8Array {
    return new TextEncoder().encode(this.configService.jwt.secret);
  }

  /**
   * Issues a cryptographically signed, short-lived JWT access token.
   */
  async generateAccessToken(params: GenerateAccessTokenParams): Promise<GeneratedAccessToken> {
    const { jwt: jwtConfig } = this.configService;
    const jti = randomUUID();
    const key = this.getSecretKey();

    const currentEpoch = Math.floor(Date.now() / 1000);
    let lastRevokedEpoch = this.localRevokedUsers.get(params.userId) ?? 0;

    // In distributed mode, check Redis to discover revocations originating from other instances
    if (this.configService.snapshot.redis.enabled && this.redisService) {
      const client = this.redisService.getClient();
      if (client) {
        try {
          const redisRevokedVal = await client.get(`auth:revoked:user:${params.userId}`);
          if (redisRevokedVal) {
            const redisRevokedAt = parseInt(redisRevokedVal, 10);
            if (!isNaN(redisRevokedAt)) {
              lastRevokedEpoch = Math.max(lastRevokedEpoch, redisRevokedAt);
              this.localRevokedUsers.set(params.userId, lastRevokedEpoch);
            }
          }
        } catch (error) {
          this.logger.warn(`Could not read distributed revocation epoch for user ${params.userId}: ${error}`);
        }
      }
    }

    const nowSeconds = Math.max(currentEpoch, lastRevokedEpoch + 1);
    const expSeconds = nowSeconds + jwtConfig.expiresInSeconds;

    const signedToken = await new SignJWT({
      email: params.email,
      roles: params.roles,
      sid: params.sessionId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(params.userId)
      .setIssuer(jwtConfig.issuer)
      .setAudience(jwtConfig.audience)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expSeconds)
      .setJti(jti)
      .sign(key);

    const claims: AccessTokenClaims = {
      sub: params.userId,
      email: params.email,
      roles: params.roles,
      sid: params.sessionId,
      jti,
      iss: jwtConfig.issuer,
      aud: jwtConfig.audience,
      iat: nowSeconds,
      exp: expSeconds,
    };

    return {
      token: signedToken,
      tokenType: 'Bearer',
      expiresIn: jwtConfig.expiresInSeconds,
      claims,
    };
  }

  /**
   * Cryptographically verifies a bearer access token and returns its validated claims.
   * Throws UnauthorizedException on any verification or claim failure.
   */
  async verifyAccessToken(rawToken: string): Promise<AccessTokenClaims> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Missing or invalid access token format.');
    }

    const { jwt: jwtConfig } = this.configService;
    const key = this.getSecretKey();

    try {
      const { payload } = await jwtVerify(rawToken, key, {
        algorithms: ['HS256'],
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });

      // Validate required claims presence and types
      const sub = payload.sub;
      const email = payload.email;
      const roles = payload.roles;
      const sid = payload.sid;

      if (!sub || typeof sub !== 'string' || sub.trim().length === 0) {
        throw new UnauthorizedException('Invalid access token subject.');
      }
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        throw new UnauthorizedException('Invalid access token email.');
      }
      if (!Array.isArray(roles) || roles.length === 0 || !roles.every(isRoleName)) {
        throw new UnauthorizedException('Invalid or non-canonical roles in access token.');
      }
      if (!sid || typeof sid !== 'string' || sid.trim().length === 0) {
        throw new UnauthorizedException('Invalid access token session binding.');
      }
      if (typeof payload.iat !== 'number' || payload.iat <= 0) {
        throw new UnauthorizedException('Invalid access token issued-at timestamp.');
      }
      if (typeof payload.exp !== 'number' || payload.exp <= 0) {
        throw new UnauthorizedException('Invalid access token expiration timestamp.');
      }

      return {
        sub,
        email,
        roles: roles as RoleName[],
        sid,
        jti: typeof payload.jti === 'string' ? payload.jti : '',
        iss: typeof payload.iss === 'string' ? payload.iss : jwtConfig.issuer,
        aud: typeof payload.aud === 'string' ? payload.aud : jwtConfig.audience,
        iat: payload.iat,
        exp: payload.exp,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error instanceof errors.JWTExpired) {
        this.logger.debug('Access token rejected: token has expired.');
        throw new UnauthorizedException('Access token has expired.');
      }

      if (error instanceof errors.JWSSignatureVerificationFailed) {
        this.logger.warn('Access token rejected: signature verification failed.');
        throw new UnauthorizedException('Invalid access token signature.');
      }

      if (error instanceof errors.JWTClaimValidationFailed) {
        this.logger.warn(`Access token rejected: claim validation failed (${error.claim}).`);
        throw new UnauthorizedException('Invalid access token claims.');
      }

      if (
        error instanceof errors.JOSENotSupported ||
        (error as any)?.code === 'ERR_JOSE_NOT_SUPPORTED' ||
        (error as any)?.code === 'ERR_JWS_UNSUPPORTED_ALGORITHM'
      ) {
        this.logger.warn('Access token rejected: unsupported or non-whitelisted algorithm.');
        throw new UnauthorizedException('Invalid access token algorithm.');
      }

      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Access token verification failed: ${msg}`);
      throw new UnauthorizedException('Invalid access token.');
    }
  }

  /**
   * Revokes all active access tokens for a user by setting a revocation epoch.
   * Any token issued before or at this timestamp will be rejected by AccessTokenGuard.
   *
   * Writes to Redis with TTL equal to the JWT expiration duration (900s) and syncs
   * to local memory for fallback / sub-millisecond evaluation.
   */
  async revokeUserTokens(userId: string, reason?: string): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.localRevokedUsers.set(userId, nowSeconds);
    this.localAccountState.delete(userId);
    this.pruneExpiredLocalEntries();

    this.logger.log(
      `Revoking access tokens for user ${userId} at epoch ${nowSeconds} (reason: ${reason ?? 'unspecified'})`,
    );

    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService?.getClient();
      if (!client) {
        this.logger.error(`Redis enabled but client unavailable to revoke tokens for user ${userId}.`);
        throw new ServiceUnavailableException(
          'Distributed cache unavailable. Cannot replicate user token revocation across instances.',
        );
      }
      try {
        const ttl = this.configService.jwt.expiresInSeconds;
        await client.set(`auth:revoked:user:${userId}`, String(nowSeconds), { EX: ttl });
        await client.del(`auth:account_state:${userId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Redis error setting user token revocation for ${userId}: ${msg}`);
        throw new ServiceUnavailableException(
          'Failed to replicate user token revocation to distributed cache.',
        );
      }
    }
  }

  /**
   * Revokes tokens bound to a specific session (e.g. upon single-device logout).
   */
  async revokeSessionToken(sessionId: string, reason?: string): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.localRevokedSessions.set(sessionId, nowSeconds);
    this.pruneExpiredLocalEntries();

    this.logger.log(
      `Revoking session tokens for session ${sessionId} at epoch ${nowSeconds} (reason: ${reason ?? 'unspecified'})`,
    );

    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService?.getClient();
      if (!client) {
        this.logger.error(`Redis enabled but client unavailable to revoke session token ${sessionId}.`);
        throw new ServiceUnavailableException(
          'Distributed cache unavailable. Cannot replicate session token revocation across instances.',
        );
      }
      try {
        const ttl = this.configService.jwt.expiresInSeconds;
        await client.set(`auth:revoked:session:${sessionId}`, String(nowSeconds), { EX: ttl });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Redis error setting session token revocation for ${sessionId}: ${msg}`);
        throw new ServiceUnavailableException(
          'Failed to replicate session token revocation to distributed cache.',
        );
      }
    }
  }

  /**
   * Checks whether an access token is revoked based on its subject, session, and issued-at epoch.
   *
   * Fast path: In-memory lookup (0ms) for revocations originating in this process.
   * Distributed path: Redis mGet (<1ms) across all instances.
   * Fail-Closed Policy: If Redis is enabled but unavailable/unreachable, un-cached tokens
   * fail closed (throw ServiceUnavailableException) to prevent unauthorized access across instances.
   */
  async isTokenRevoked(userId: string, sessionId: string, issuedAt: number): Promise<boolean> {
    // 1. Check local in-memory store (fast path for same-instance revocations)
    const localUserRevokedAt = this.localRevokedUsers.get(userId);
    if (localUserRevokedAt !== undefined && issuedAt <= localUserRevokedAt) {
      return true;
    }

    const localSessionRevokedAt = this.localRevokedSessions.get(sessionId);
    if (localSessionRevokedAt !== undefined && issuedAt <= localSessionRevokedAt) {
      return true;
    }

    // 2. Check Redis if enabled
    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService?.getClient();
      if (!client) {
        this.logger.error(
          `Redis enabled but client unavailable during isTokenRevoked for user ${userId}. Failing closed.`,
        );
        throw new ServiceUnavailableException(
          'Authentication revocation registry is unavailable. Protected requests cannot be verified.',
        );
      }

      try {
        const [userRevokedVal, sessionRevokedVal] = await client.mGet([
          `auth:revoked:user:${userId}`,
          `auth:revoked:session:${sessionId}`,
        ]);

        if (userRevokedVal) {
          const userRevokedAt = parseInt(userRevokedVal, 10);
          if (!isNaN(userRevokedAt) && issuedAt <= userRevokedAt) {
            this.localRevokedUsers.set(userId, userRevokedAt);
            this.localAccountState.delete(userId); // Immediately invalidate local stale cache
            return true;
          }
        }

        if (sessionRevokedVal) {
          const sessionRevokedAt = parseInt(sessionRevokedVal, 10);
          if (!isNaN(sessionRevokedAt) && issuedAt <= sessionRevokedAt) {
            this.localRevokedSessions.set(sessionId, sessionRevokedAt);
            return true;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Redis error in isTokenRevoked for ${userId}: ${msg} – failing closed to prevent unauthorized access`,
        );
        throw new ServiceUnavailableException(
          'Authentication revocation registry is unavailable. Protected requests cannot be verified.',
        );
      }
    }

    return false;
  }

  /**
   * Retrieves current account state (status and active roles) with multi-tiered caching:
   * 1. Single-instance mode (redis.enabled === false): L1 process-local memory cache (5s TTL, 0ms latency).
   * 2. Distributed mode (redis.enabled === true): Redis shared cache (L2, 60s TTL, <1ms latency) queried directly
   *    so that deletions on one instance are immediately visible on all other instances.
   * 3. L3 Database lookup: Authoritative PostgreSQL lookup on cache miss or Redis failure.
   */
  async getAccountState(userId: string): Promise<AccountState> {
    const nowMs = Date.now();

    // 1. In single-instance mode (redis.enabled === false), use L1 local memory cache (5s TTL)
    if (!this.configService.snapshot.redis.enabled) {
      const l1 = this.localAccountState.get(userId);
      if (l1 && nowMs - l1.cachedAt < this.L1_CACHE_TTL_MS) {
        return { status: l1.status, roles: l1.roles };
      }
    } else {
      // 2. In distributed mode (redis.enabled === true), check Redis shared cache (L2) directly.
      // This ensures immediate cross-instance consistency: when another instance deletes the Redis key,
      // this instance immediately misses the cache and reloads authoritative state from PostgreSQL.
      const client = this.redisService?.getClient();
      if (client) {
        try {
          const cachedJson = await client.get(`auth:account_state:${userId}`);
          if (cachedJson) {
            const parsed = JSON.parse(cachedJson) as AccountState;
            return parsed;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Redis error reading account state for ${userId}: ${msg} – using DB fallback`);
        }
      }
    }

    // 3. L3 Database lookup (if PrismaService is available)
    if (this.prisma) {
      let dbUser: {
        accountStatus: AccountStatus;
        userRoles: { role: { name: string } }[];
      } | null = null;

      try {
        dbUser = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            accountStatus: true,
            userRoles: {
              select: {
                role: {
                  select: { name: true },
                },
              },
            },
          },
        });
      } catch (dbError) {
        const msg = dbError instanceof Error ? dbError.message : String(dbError);
        this.logger.error(`Database error looking up account state for ${userId}: ${msg}`);
        throw new UnauthorizedException('Authentication verification failed due to database error.');
      }

      if (!dbUser) {
        throw new UnauthorizedException('Account not found.');
      }

      const roles = dbUser.userRoles
        .map((ur) => ur.role.name)
        .filter(isRoleName) as RoleName[];

      const state: AccountState = {
        status: dbUser.accountStatus,
        roles,
      };

      // Populate local memory cache if Redis is disabled
      if (!this.configService.snapshot.redis.enabled) {
        this.localAccountState.set(userId, { ...state, cachedAt: nowMs });
      }

      // Populate L2 Redis cache (60s TTL) if Redis is enabled
      if (this.configService.snapshot.redis.enabled && this.redisService) {
        const client = this.redisService.getClient();
        if (client) {
          try {
            await client.set(`auth:account_state:${userId}`, JSON.stringify(state), { EX: 60 });
          } catch { /* best effort cache population */ }
        }
      }

      return state;
    }

    // Fallback if no database service (e.g. standalone test mock)
    return { status: AccountStatus.ACTIVE, roles: [] };
  }

  /**
   * Evicts cached account state for a user across L1 and L2 caches.
   */
  async invalidateAccountState(userId: string): Promise<void> {
    this.localAccountState.delete(userId);

    if (this.configService.snapshot.redis.enabled) {
      const client = this.redisService?.getClient();
      if (!client) {
        this.logger.error(`Redis enabled but client unavailable to invalidate account state for ${userId}.`);
        throw new ServiceUnavailableException(
          'Distributed cache unavailable. Cannot invalidate account state across instances.',
        );
      }
      try {
        await client.del(`auth:account_state:${userId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Redis error deleting account state for ${userId}: ${msg}`);
        throw new ServiceUnavailableException(
          'Failed to invalidate account state in distributed cache.',
        );
      }
    }
  }

  /**
   * Maps validated access token claims to an AuthenticatedPrincipal.
   * If `effectiveRoles` is provided (from current account state), it overrides
   * potentially stale roles embedded in the token payload.
   * Sets `authVerified: true` to indicate provenance from the trusted authentication guard.
   */
  toPrincipal(claims: AccessTokenClaims, effectiveRoles?: RoleName[]): AuthenticatedPrincipal {
    return {
      id: claims.sub,
      email: claims.email,
      roles: effectiveRoles && effectiveRoles.length > 0 ? effectiveRoles : claims.roles,
      sessionId: claims.sid,
      authVerified: true,
    };
  }
}

