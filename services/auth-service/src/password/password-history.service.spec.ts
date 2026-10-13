import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordHashingService } from './password-hashing.service.js';
import {
  PasswordHistoryService,
  PasswordHistoryError,
  PASSWORD_HISTORY_LIMIT,
} from './password-history.service.js';

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('PasswordHistoryService', () => {
  let service: PasswordHistoryService;
  let mockPrisma: any;
  let mockHashingService: {
    verify: ReturnType<typeof vi.fn>;
    hash: ReturnType<typeof vi.fn>;
  };

  const testUserId = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    mockPrisma = {
      passwordHistory: {
        findMany: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };

    mockHashingService = {
      verify: vi.fn(),
      hash: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordHistoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordHashingService, useValue: mockHashingService },
      ],
    }).compile();

    service = moduleRef.get(PasswordHistoryService);
  });

  describe('isPasswordReused', () => {
    it('returns false when user has no existing password history', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([]);

      const reused = await service.isPasswordReused(testUserId, 'NewCandidatePass1!');

      expect(reused).toBe(false);
      expect(mockPrisma.passwordHistory.findMany).toHaveBeenCalledWith({
        where: { userId: testUserId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PASSWORD_HISTORY_LIMIT,
        select: { id: true, passwordHash: true },
      });
      expect(mockHashingService.verify).not.toHaveBeenCalled();
    });

    it('returns true when candidate password matches a recent password hash', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'h1', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash1' },
        { id: 'h2', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash2' },
      ]);

      mockHashingService.verify.mockResolvedValue(true);

      const reused = await service.isPasswordReused(testUserId, 'MatchingCandidatePass1!');

      expect(reused).toBe(true);
      expect(mockHashingService.verify).toHaveBeenCalledTimes(1);
    });

    it('returns false when candidate password matches none of the recent hashes', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'h1', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash1' },
        { id: 'h2', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash2' },
        { id: 'h3', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash3' },
      ]);

      mockHashingService.verify.mockResolvedValue(false);

      const reused = await service.isPasswordReused(testUserId, 'DifferentCandidatePass1!');

      expect(reused).toBe(false);
      expect(mockHashingService.verify).toHaveBeenCalledTimes(3);
    });

    it('verifies sequentially and short-circuits on first match', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'h1', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash1' },
        { id: 'h2', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash2' },
        { id: 'h3', passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$hash3' },
      ]);

      // First hash does not match, second hash matches
      mockHashingService.verify
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const reused = await service.isPasswordReused(testUserId, 'CandidatePassMatchesSecond1!');

      expect(reused).toBe(true);
      // Third hash must not be verified because of short-circuiting
      expect(mockHashingService.verify).toHaveBeenCalledTimes(2);
    });

    it('bounds query to at most the newest five entries', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'h1', passwordHash: 'hash1' },
        { id: 'h2', passwordHash: 'hash2' },
        { id: 'h3', passwordHash: 'hash3' },
        { id: 'h4', passwordHash: 'hash4' },
        { id: 'h5', passwordHash: 'hash5' },
      ]);
      mockHashingService.verify.mockResolvedValue(false);

      const reused = await service.isPasswordReused(testUserId, 'UnmatchedCandidatePass1!');

      expect(reused).toBe(false);
      expect(mockPrisma.passwordHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
      expect(mockHashingService.verify).toHaveBeenCalledTimes(5);
    });

    it('fails closed and throws PasswordHistoryError on database failure', async () => {
      mockPrisma.passwordHistory.findMany.mockRejectedValue(new Error('DB connection refused'));

      await expect(
        service.isPasswordReused(testUserId, 'CandidatePass1!'),
      ).rejects.toThrow(PasswordHistoryError);
    });

    it('fails closed and throws PasswordHistoryError on verification exception', async () => {
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'h1', passwordHash: 'corrupt-hash' },
      ]);
      mockHashingService.verify.mockRejectedValue(new Error('Native error'));

      await expect(
        service.isPasswordReused(testUserId, 'CandidatePass1!'),
      ).rejects.toThrow(PasswordHistoryError);
    });
  });

  describe('recordPasswordHash', () => {
    it('records a new password hash and creates history record', async () => {
      const newHash = '$argon2id$v=19$m=65536,p=1,t=3$newHash';
      const createdRecord = {
        id: 'new-id',
        userId: testUserId,
        passwordHash: newHash,
        createdAt: new Date(),
      };

      mockPrisma.passwordHistory.create.mockResolvedValue(createdRecord);
      mockPrisma.passwordHistory.findMany.mockResolvedValue([]); // no excess

      const result = await service.recordPasswordHash(testUserId, newHash);

      expect(result).toEqual(createdRecord);
      expect(mockPrisma.passwordHistory.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          passwordHash: newHash,
        },
      });
      expect(mockPrisma.passwordHistory.findMany).toHaveBeenCalledWith({
        where: { userId: testUserId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: PASSWORD_HISTORY_LIMIT,
        select: { id: true },
      });
      expect(mockPrisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('prunes excess historical entries to enforce 5-password retention limit', async () => {
      const newHash = '$argon2id$v=19$m=65536,p=1,t=3$newHash';
      const createdRecord = {
        id: 'new-id',
        userId: testUserId,
        passwordHash: newHash,
        createdAt: new Date(),
      };

      mockPrisma.passwordHistory.create.mockResolvedValue(createdRecord);
      // Simulate finding excess records older than the newest 5
      mockPrisma.passwordHistory.findMany.mockResolvedValue([
        { id: 'old-excess-id-1' },
        { id: 'old-excess-id-2' },
      ]);
      mockPrisma.passwordHistory.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.recordPasswordHash(testUserId, newHash);

      expect(result).toEqual(createdRecord);
      expect(mockPrisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['old-excess-id-1', 'old-excess-id-2'] },
        },
      });
    });

    it('propagates PasswordHistoryError when creation fails', async () => {
      mockPrisma.passwordHistory.create.mockRejectedValue(new Error('Insert constraint error'));

      await expect(
        service.recordPasswordHash(testUserId, '$argon2id$somehash'),
      ).rejects.toThrow(PasswordHistoryError);
    });

    it('propagates PasswordHistoryError when pruning query fails', async () => {
      mockPrisma.passwordHistory.create.mockResolvedValue({ id: 'new-id' });
      mockPrisma.passwordHistory.findMany.mockRejectedValue(new Error('Query timeout'));

      await expect(
        service.recordPasswordHash(testUserId, '$argon2id$somehash'),
      ).rejects.toThrow(PasswordHistoryError);
    });
  });
});
