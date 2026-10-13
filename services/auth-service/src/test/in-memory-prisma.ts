import { randomUUID } from 'node:crypto';
import { AccountStatus, OtpPurpose, OtpState, SecurityEventType } from '@prisma/client';

export interface StoredUser {
  id: string;
  email: string;
  mobileNumber: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredRole {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface StoredUserRole {
  id: string;
  userId: string;
  roleId: string;
  assignedAt: Date;
  assignedBy: string | null;
}

export interface StoredOtpChallenge {
  id: string;
  userId: string | null;
  identifier: string;
  purpose: OtpPurpose;
  verifierHash: string;
  expiresAt: Date;
  attemptCount: number;
  maxAttempts: number;
  state: OtpState;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredAuthSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredPasswordHistory {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: Date;
}

export interface StoredSecurityEvent {
  id: string;
  eventType: SecurityEventType;
  userId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  metadata: any;
  occurredAt: Date;
}

/**
 * High-fidelity in-memory Prisma store for HTTP-level integration testing.
 * Accurately models relations, constraints, and transactions without requiring
 * external PostgreSQL infrastructure when unavailable.
 */
export class InMemoryPrismaService {
  users = new Map<string, StoredUser>();
  roles = new Map<string, StoredRole>();
  userRoles = new Map<string, StoredUserRole>();
  otpChallenges = new Map<string, StoredOtpChallenge>();
  authSessions = new Map<string, StoredAuthSession>();
  passwordHistories = new Map<string, StoredPasswordHistory>();
  securityEvents = new Map<string, StoredSecurityEvent>();

  constructor() {
    this.seedRoles();
  }

  seedRoles(): void {
    const defaultRoles = [
      'CANDIDATE',
      'RECRUITER',
      'COMPANY_HR',
      'MODERATOR',
      'ADMIN',
      'SUPER_ADMIN',
    ];
    for (const name of defaultRoles) {
      if (!Array.from(this.roles.values()).some((r) => r.name === name)) {
        const id = randomUUID();
        this.roles.set(id, {
          id,
          name,
          description: `Standard ${name} role`,
          createdAt: new Date(),
        });
      }
    }
  }

  reset(): void {
    this.users.clear();
    this.roles.clear();
    this.userRoles.clear();
    this.otpChallenges.clear();
    this.authSessions.clear();
    this.passwordHistories.clear();
    this.securityEvents.clear();
    this.seedRoles();
  }

  async $connect(): Promise<void> {}
  async $disconnect(): Promise<void> {}

  async $transaction<T>(arg: any): Promise<T> {
    if (typeof arg === 'function') {
      return arg(this);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg) as any;
    }
    return Promise.resolve() as any;
  }

  user = {
    findFirst: async (args?: { where?: any; select?: any }) => {
      const users = Array.from(this.users.values());
      const where = args?.where;
      if (!where) return users[0] || null;

      const found = users.find((u) => {
        if (where.OR && Array.isArray(where.OR)) {
          return where.OR.some((condition: any) => {
            if (condition.email && u.email === condition.email.toLowerCase()) return true;
            if (condition.mobileNumber && u.mobileNumber === condition.mobileNumber) return true;
            return false;
          });
        }
        if (where.email && u.email !== where.email.toLowerCase()) return false;
        if (where.id && u.id !== where.id) return false;
        return true;
      });

      return found ? this.formatUser(found, args?.select) : null;
    },

    findUnique: async (args: { where: { email?: string; id?: string }; select?: any }) => {
      const { email, id } = args.where;
      let found: StoredUser | undefined;

      if (id) {
        found = this.users.get(id);
      } else if (email) {
        found = Array.from(this.users.values()).find(
          (u) => u.email === email.toLowerCase(),
        );
      }

      return found ? this.formatUser(found, args.select) : null;
    },

    create: async (args: { data: any; select?: any }) => {
      const data = args.data;
      const id = data.id || randomUUID();
      const user: StoredUser = {
        id,
        email: data.email.toLowerCase(),
        mobileNumber: data.mobileNumber || null,
        passwordHash: data.passwordHash || null,
        emailVerified: data.emailVerified ?? false,
        accountStatus: data.accountStatus || AccountStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.set(id, user);
      return this.formatUser(user, args.select);
    },

    update: async (args: { where: { id?: string; email?: string }; data: any; select?: any }) => {
      const user = await this.user.findUnique({ where: args.where });
      if (!user) throw new Error('User not found');
      const stored = this.users.get(user.id)!;

      Object.assign(stored, args.data, { updatedAt: new Date() });
      return this.formatUser(stored, args.select);
    },
  };

  role = {
    upsert: async (args: { where: { name: string }; create: any; update: any }) => {
      const existing = Array.from(this.roles.values()).find(
        (r) => r.name === args.where.name,
      );
      if (existing) return existing;

      const id = randomUUID();
      const created: StoredRole = {
        id,
        name: args.create.name,
        description: args.create.description || null,
        createdAt: new Date(),
      };
      this.roles.set(id, created);
      return created;
    },

    findUnique: async (args: { where: { name: string } }) => {
      return (
        Array.from(this.roles.values()).find((r) => r.name === args.where.name) || null
      );
    },
  };

  userRole = {
    create: async (args: { data: any }) => {
      const id = randomUUID();
      const record: StoredUserRole = {
        id,
        userId: args.data.userId,
        roleId: args.data.roleId,
        assignedAt: new Date(),
        assignedBy: args.data.assignedBy || null,
      };
      this.userRoles.set(id, record);
      return record;
    },

    findUnique: async (args: {
      where: {
        userId_roleId?: { userId: string; roleId: string };
        uq_user_role?: { userId: string; roleId: string };
      };
    }) => {
      const pair = args.where.uq_user_role || args.where.userId_roleId;
      const { userId, roleId } = pair || {};
      if (!userId || !roleId) return null;
      return (
        Array.from(this.userRoles.values()).find(
          (ur) => ur.userId === userId && ur.roleId === roleId,
        ) || null
      );
    },

    delete: async (args: {
      where: {
        userId_roleId?: { userId: string; roleId: string };
        uq_user_role?: { userId: string; roleId: string };
      };
    }) => {
      const pair = args.where.uq_user_role || args.where.userId_roleId;
      const { userId, roleId } = pair || {};
      const found = Array.from(this.userRoles.values()).find(
        (ur) => ur.userId === userId && ur.roleId === roleId,
      );
      if (found) {
        this.userRoles.delete(found.id);
      }
      return found || null;
    },

    findMany: async (args?: { where?: { userId?: string } }) => {
      const all = Array.from(this.userRoles.values());
      if (args?.where?.userId) {
        return all.filter((ur) => ur.userId === args.where!.userId);
      }
      return all;
    },
  };


  otpChallenge = {
    create: async (args: { data: any }) => {
      const id = randomUUID();
      const challenge: StoredOtpChallenge = {
        id,
        userId: args.data.userId || null,
        identifier: args.data.identifier.toLowerCase(),
        purpose: args.data.purpose,
        verifierHash: args.data.verifierHash,
        expiresAt: args.data.expiresAt,
        attemptCount: args.data.attemptCount || 0,
        maxAttempts: args.data.maxAttempts || 5,
        state: args.data.state || OtpState.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.otpChallenges.set(id, challenge);
      return challenge;
    },

    findFirst: async (args: { where: any; orderBy?: any }) => {
      const { id, identifier, purpose, state } = args.where;
      const challenges = Array.from(this.otpChallenges.values())
        .filter((c) => {
          if (id && c.id !== id) return false;
          if (identifier && c.identifier !== identifier.toLowerCase()) return false;
          if (purpose && c.purpose !== purpose) return false;
          if (state && c.state !== state) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return challenges[0] || null;
    },

    update: async (args: { where: { id: string }; data: any }) => {
      const challenge = this.otpChallenges.get(args.where.id);
      if (!challenge) throw new Error('OtpChallenge not found');
      if (args.data.attemptCount?.increment) {
        challenge.attemptCount += args.data.attemptCount.increment;
      }
      const dataToApply = { ...args.data };
      delete dataToApply.attemptCount;
      Object.assign(challenge, dataToApply, { updatedAt: new Date() });
      return challenge;
    },

    updateMany: async (args: { where: any; data: any }) => {
      const { id, identifier, purpose, state, expiresAt, attemptCount } = args.where;
      let count = 0;
      for (const challenge of this.otpChallenges.values()) {
        if (id && challenge.id !== id) continue;
        if (identifier && challenge.identifier !== identifier.toLowerCase()) continue;
        if (purpose && challenge.purpose !== purpose) continue;
        if (state && challenge.state !== state) continue;
        if (expiresAt?.gt && challenge.expiresAt <= expiresAt.gt) continue;
        if (attemptCount?.lt && challenge.attemptCount >= attemptCount.lt) continue;

        if (args.data.attemptCount?.increment) {
          challenge.attemptCount += args.data.attemptCount.increment;
        }
        const dataToApply = { ...args.data };
        delete dataToApply.attemptCount;
        Object.assign(challenge, dataToApply, { updatedAt: new Date() });
        count++;
      }
      return { count };
    },
  };

  authSession = {
    create: async (args: { data: any }) => {
      const id = args.data.id || randomUUID();
      const session: StoredAuthSession = {
        id,
        userId: args.data.userId,
        refreshTokenHash: args.data.refreshTokenHash,
        expiresAt: args.data.expiresAt,
        revokedAt: args.data.revokedAt || null,
        userAgent: args.data.userAgent || null,
        ipAddress: args.data.ipAddress || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.authSessions.set(id, session);
      return session;
    },

    findUnique: async (args: { where: { id: string } }) => {
      return this.authSessions.get(args.where.id) || null;
    },

    update: async (args: { where: { id: string }; data: any }) => {
      const session = this.authSessions.get(args.where.id);
      if (!session) throw new Error('Session not found');
      Object.assign(session, args.data, { updatedAt: new Date() });
      return session;
    },

    updateMany: async (args: {
      where: { userId?: string; id?: string; revokedAt?: any; refreshTokenHash?: string };
      data: any;
    }) => {
      let count = 0;
      for (const session of this.authSessions.values()) {
        if (args.where.userId && session.userId !== args.where.userId) continue;
        if (args.where.id && session.id !== args.where.id) continue;
        if (args.where.revokedAt === null && session.revokedAt !== null) continue;
        if (args.where.refreshTokenHash && session.refreshTokenHash !== args.where.refreshTokenHash) continue;
        Object.assign(session, args.data, { updatedAt: new Date() });
        count++;
      }
      return { count };
    },
  };

  passwordHistory = {
    create: async (args: { data: any }) => {
      const id = randomUUID();
      const record: StoredPasswordHistory = {
        id,
        userId: args.data.userId,
        passwordHash: args.data.passwordHash,
        createdAt: new Date(),
      };
      this.passwordHistories.set(id, record);
      return record;
    },

    findMany: async (args: {
      where: { userId: string };
      orderBy?: any;
      skip?: number;
      take?: number;
      select?: any;
    }) => {
      // Map preserves insertion order; reverse gives newest-first order
      let records = Array.from(this.passwordHistories.values())
        .filter((r) => r.userId === args.where.userId)
        .reverse();

      if (args.skip && args.skip > 0) {
        records = records.slice(args.skip);
      }
      if (args.take && args.take > 0) {
        records = records.slice(0, args.take);
      }
      return records;
    },

    deleteMany: async (args: { where: { id?: { in: string[] } } }) => {
      let count = 0;
      if (args.where.id?.in) {
        for (const id of args.where.id.in) {
          if (this.passwordHistories.delete(id)) count++;
        }
      }
      return { count };
    },
  };

  securityEvent = {
    create: async (args: { data: any }) => {
      const id = randomUUID();
      const event: StoredSecurityEvent = {
        id,
        eventType: args.data.eventType,
        userId: args.data.userId || null,
        sessionId: args.data.sessionId || null,
        ipAddress: args.data.ipAddress || null,
        metadata: args.data.metadata || null,
        occurredAt: new Date(),
      };
      this.securityEvents.set(id, event);
      return event;
    },
  };

  private formatUser(user: StoredUser, select?: any): any {
    if (!select) return { ...user };

    const result: any = {};
    if (select.id) result.id = user.id;
    if (select.email) result.email = user.email;
    if (select.mobileNumber) result.mobileNumber = user.mobileNumber;
    if (select.passwordHash) result.passwordHash = user.passwordHash;
    if (select.emailVerified !== undefined) result.emailVerified = user.emailVerified;
    if (select.accountStatus) result.accountStatus = user.accountStatus;
    if (select.createdAt) result.createdAt = user.createdAt;
    if (select.updatedAt) result.updatedAt = user.updatedAt;

    if (select.userRoles) {
      const assigned = Array.from(this.userRoles.values()).filter(
        (ur) => ur.userId === user.id,
      );
      result.userRoles = assigned.map((ur) => {
        const role = this.roles.get(ur.roleId);
        return {
          role: {
            name: role ? role.name : 'CANDIDATE',
          },
        };
      });
    }

    return result;
  }
}
