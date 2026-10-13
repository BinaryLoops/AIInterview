import { Injectable } from '@nestjs/common';
import { COMMON_PASSWORDS } from './common-passwords.js';

/**
 * Structured result of a single password-policy check.
 * Suitable for a future UI checklist — never includes the actual password.
 */
export interface PasswordPolicyViolation {
  /** Machine-readable rule identifier. */
  rule: string;
  /** Human-readable description of the requirement. */
  message: string;
}

/**
 * Result of password-policy validation.
 */
export interface PasswordPolicyResult {
  /** `true` when the password satisfies all policy rules. */
  valid: boolean;
  /** One entry per violated rule. Empty when `valid` is `true`. */
  violations: PasswordPolicyViolation[];
}

// ─── Policy constants ────────────────────────────────────────────────────────

const MIN_LENGTH = 12;

// ─── Character-class regexes ─────────────────────────────────────────────────

const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /[0-9]/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

/**
 * Injectable service that validates a candidate password against the
 * auth-service password policy.
 *
 * ## Policy rules
 * 1. Minimum 12 characters.
 * 2. At least one uppercase letter (A-Z).
 * 3. At least one lowercase letter (a-z).
 * 4. At least one digit (0-9).
 * 5. At least one special character (anything not in A-Z, a-z, 0-9).
 * 6. Must not appear in the common-password denylist (case-insensitive check).
 *
 * The password is validated as-is — never trimmed, lowercased, or otherwise
 * transformed before validation or downstream hashing.
 *
 * The supplied password value is **never** included in returned errors or logs.
 */
@Injectable()
export class PasswordPolicyService {
  /**
   * Validate a candidate password.
   *
   * @returns A structured result with per-rule violations.
   */
  validate(password: string): PasswordPolicyResult {
    const violations: PasswordPolicyViolation[] = [];

    if (password.length < MIN_LENGTH) {
      violations.push({
        rule: 'min_length',
        message: `Password must be at least ${MIN_LENGTH} characters long.`,
      });
    }

    if (!HAS_UPPERCASE.test(password)) {
      violations.push({
        rule: 'uppercase',
        message: 'Password must contain at least one uppercase letter.',
      });
    }

    if (!HAS_LOWERCASE.test(password)) {
      violations.push({
        rule: 'lowercase',
        message: 'Password must contain at least one lowercase letter.',
      });
    }

    if (!HAS_DIGIT.test(password)) {
      violations.push({
        rule: 'digit',
        message: 'Password must contain at least one digit.',
      });
    }

    if (!HAS_SPECIAL.test(password)) {
      violations.push({
        rule: 'special',
        message: 'Password must contain at least one special character.',
      });
    }

    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      violations.push({
        rule: 'common_password',
        message: 'Password is too common and easily guessed.',
      });
    }

    return { valid: violations.length === 0, violations };
  }
}
