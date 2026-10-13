import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import * as argon2 from 'argon2';
import { PasswordHashingService } from './password-hashing.service.js';

describe('PasswordHashingService', () => {
  let service: PasswordHashingService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PasswordHashingService],
    }).compile();

    service = moduleRef.get(PasswordHashingService);
  });

  describe('configuration parameters', () => {
    it('configures Argon2id with OWASP-aligned parameters', () => {
      const opts = service.argon2Options;
      expect(opts.type).toBe(argon2.argon2id);
      expect(opts.memoryCost).toBe(65_536);
      expect(opts.timeCost).toBe(3);
      expect(opts.parallelism).toBe(1);
      expect(opts.hashLength).toBe(32);
      expect(opts.raw).toBe(false);
    });
  });

  describe('hashing', () => {
    it('produces a valid Argon2id PHC-formatted string', async () => {
      const hash = await service.hash('SecretCandidatePassword123!');
      expect(typeof hash).toBe('string');
      // Verify PHC string begins with $argon2id$ and contains standard fields
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=\d+,p=\d+,t=\d+\$/);
    });

    it('generates unique salts across multiple hashes of the same password', async () => {
      const password = 'IdenticalPasswordToHash123!';
      const hash1 = await service.hash(password);
      const hash2 = await service.hash(password);

      expect(hash1).not.toBe(hash2);
      expect(hash1.startsWith('$argon2id$')).toBe(true);
      expect(hash2.startsWith('$argon2id$')).toBe(true);
    });
  });

  describe('verification', () => {
    it('returns true when candidate password matches stored hash', async () => {
      const password = 'CorrectPasswordToVerify123!';
      const hash = await service.hash(password);

      const isValid = await service.verify(hash, password);
      expect(isValid).toBe(true);
    });

    it('returns false when candidate password does not match stored hash', async () => {
      const password = 'CorrectPasswordToVerify123!';
      const wrongPassword = 'WrongPasswordAttempt456!';
      const hash = await service.hash(password);

      const isValid = await service.verify(hash, wrongPassword);
      expect(isValid).toBe(false);
    });

    it('returns false and does not throw on malformed hash string', async () => {
      const malformedHashes = [
        'not-a-valid-phc-hash',
        '$argon2id$invalid_formatting',
        '$unknown$v=19$m=65536,t=3,p=1$junk',
        '',
      ];

      for (const badHash of malformedHashes) {
        const result = await service.verify(badHash, 'AnyCandidatePassword123!');
        expect(result).toBe(false);
      }
    });
  });
});
