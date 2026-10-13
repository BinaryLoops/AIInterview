/**
 * Common-password denylist.
 *
 * A small, clearly documented local denylist of easily guessed passwords.
 * All entries are stored in lowercase for case-insensitive comparison.
 * Extend this list as needed — no network calls are made.
 *
 * Sources:
 * - NCSC "Top 100 most common passwords" (subset)
 * - OWASP testing guide common credential list (subset)
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'password1234',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'letmein',
  'welcome',
  'welcome1',
  'admin',
  'admin123',
  'administrator',
  'login',
  'abc123',
  'monkey',
  'master',
  'dragon',
  'trustno1',
  'baseball',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'charlie',
  'shadow',
  'michael',
  'superman',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'changeme',
  'changeme123',
  'default',
  'guest',
  'test',
  'test123',
  'root',
  'toor',
  'access',
  'hello',
  'hello123',
  'letmein123',
  'master123',
  'whatever',
  'qazwsx',
]);
