import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { PasswordPolicyService } from './password-policy.service.js';

describe('PasswordPolicyService', () => {
  let service: PasswordPolicyService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PasswordPolicyService],
    }).compile();

    service = moduleRef.get(PasswordPolicyService);
  });

  describe('valid passwords', () => {
    it('accepts a strong password meeting all requirements', () => {
      const result = service.validate('Correct-Horse-Battery-Staple-99!');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('accepts an exactly 12-character strong password', () => {
      const result = service.validate('ValidPass12!');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('accepts passwords with punctuation and symbols as special characters', () => {
      const result = service.validate('Str0ng_Pass#2026');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('length requirement', () => {
    it('flags passwords shorter than 12 characters', () => {
      const result = service.validate('Short1!Aa');
      expect(result.valid).toBe(false);
      const rule = result.violations.find((v) => v.rule === 'min_length');
      expect(rule).toBeDefined();
      expect(rule?.message).toContain('12 characters');
    });

    it('passes length check when exactly 12 characters', () => {
      const result = service.validate('123456789012');
      const lengthViolation = result.violations.find((v) => v.rule === 'min_length');
      expect(lengthViolation).toBeUndefined();
    });
  });

  describe('character class requirements', () => {
    it('flags passwords lacking uppercase letters', () => {
      const result = service.validate('alllowercase123!');
      expect(result.valid).toBe(false);
      expect(result.violations).toContainEqual({
        rule: 'uppercase',
        message: 'Password must contain at least one uppercase letter.',
      });
    });

    it('flags passwords lacking lowercase letters', () => {
      const result = service.validate('ALLUPPERCASE123!');
      expect(result.valid).toBe(false);
      expect(result.violations).toContainEqual({
        rule: 'lowercase',
        message: 'Password must contain at least one lowercase letter.',
      });
    });

    it('flags passwords lacking digits', () => {
      const result = service.validate('NoDigitsHere!Abc');
      expect(result.valid).toBe(false);
      expect(result.violations).toContainEqual({
        rule: 'digit',
        message: 'Password must contain at least one digit.',
      });
    });

    it('flags passwords lacking special characters', () => {
      const result = service.validate('NoSpecialChar123');
      expect(result.valid).toBe(false);
      expect(result.violations).toContainEqual({
        rule: 'special',
        message: 'Password must contain at least one special character.',
      });
    });
  });

  describe('common-password denylist', () => {
    it('flags exact match on common password', () => {
      const result = service.validate('password123');
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'common_password')).toBe(true);
    });

    it('flags case-insensitive match on common password', () => {
      const result = service.validate('PASSWORD123');
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'common_password')).toBe(true);
    });

    it('flags mixed-case common password', () => {
      const result = service.validate('PassWord1234');
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'common_password')).toBe(true);
    });

    it('does not flag strong password that contains a common substring', () => {
      const result = service.validate('Xy7!_password_Unbreakable');
      expect(result.violations.some((v) => v.rule === 'common_password')).toBe(false);
    });
  });

  describe('multiple violations and security', () => {
    it('returns all applicable violations simultaneously', () => {
      const result = service.validate('admin');
      expect(result.valid).toBe(false);
      const rules = result.violations.map((v) => v.rule);
      expect(rules).toContain('min_length');
      expect(rules).toContain('uppercase');
      expect(rules).toContain('digit');
      expect(rules).toContain('special');
      expect(rules).toContain('common_password');
    });

    it('never includes the candidate password in violation messages', () => {
      const sensitivePassword = 'SecretCandidatePassword123!';
      const result = service.validate(sensitivePassword);
      for (const violation of result.violations) {
        expect(violation.message).not.toContain(sensitivePassword);
        expect(violation.rule).not.toContain(sensitivePassword);
      }
    });

    it('does not silently trim whitespace before validation', () => {
      // 10 chars + 2 trailing spaces = 12 chars
      // Should not be trimmed and fail length
      const untrimmed = 'Abc1!       ';
      const result = service.validate(untrimmed);
      const lengthViolation = result.violations.find((v) => v.rule === 'min_length');
      expect(lengthViolation).toBeUndefined();
    });
  });
});
