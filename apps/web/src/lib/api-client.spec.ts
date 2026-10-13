import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiClient,
  ApiError,
  getInMemoryAccessToken,
  setInMemoryAccessToken,
  AUTH_API_BASE_URL,
} from './api-client.ts';

// Save original global fetch
const originalFetch = globalThis.fetch;

describe('AREP Web Auth API Client', () => {
  beforeEach(() => {
    setInMemoryAccessToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setInMemoryAccessToken(null);
  });

  it('configures a safe default API base URL', () => {
    assert.ok(AUTH_API_BASE_URL);
    assert.match(AUTH_API_BASE_URL, /^https?:\/\//);
  });

  describe('apiClient.register', () => {
    it('submits registration with explicit terms acceptance', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method || 'GET';
        requestedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            id: 'user-uuid-1',
            email: 'test@example.com',
            fullName: 'Test Candidate',
            mobileNumber: '+1 555-0123',
            emailVerified: false,
            accountStatus: 'ACTIVE',
            createdAt: new Date().toISOString(),
            emailDelivery: { sent: true, message: 'OTP sent' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.register({
        fullName: 'Test Candidate',
        email: 'Test@example.com',
        mobileNumber: '+1 555-0123',
        password: 'Password1234!@#$',
        passwordConfirmation: 'Password1234!@#$',
        termsAccepted: true,
      });

      assert.equal(requestedUrl, `${AUTH_API_BASE_URL}/auth/register`);
      assert.equal(requestedMethod, 'POST');
      assert.equal(requestedBody.fullName, 'Test Candidate');
      assert.equal(requestedBody.email, 'test@example.com'); // normalized lowercase
      assert.equal(requestedBody.termsAccepted, true);
      assert.equal(requestedBody.mobileNumber, '+1 555-0123');
      assert.equal(result.id, 'user-uuid-1');
      assert.equal(result.emailVerified, false);
    });

    it('parses server-side validation error arrays accessibly into ApiError', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 400,
            error: [
              'Password must be at least 12 characters long.',
              'Terms of Service must be accepted.',
            ],
            path: '/auth/register',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.register({
            fullName: 'Short',
            email: 'test@example.com',
            password: 'short',
            passwordConfirmation: 'short',
            termsAccepted: false,
          });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.details.length, 2);
          assert.match(err.message, /Password must be at least 12/);
          return true;
        }
      );
    });
  });

  describe('apiClient.verifyEmail', () => {
    it('submits 6-digit numeric OTP to verify-email endpoint', async () => {
      let requestedUrl = '';
      let requestedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Email address successfully verified.',
            email: 'test@example.com',
            emailVerified: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.verifyEmail({
        email: 'TEST@example.com',
        otp: '654321',
      });

      assert.equal(requestedUrl, `${AUTH_API_BASE_URL}/auth/verify-email`);
      assert.equal(requestedBody.email, 'test@example.com');
      assert.equal(requestedBody.otp, '654321');
      assert.equal(result.success, true);
      assert.equal(result.emailVerified, true);
    });
  });

  describe('apiClient.login (Step 1)', () => {
    it('initiates login challenge and requires OTP next step', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            authenticated: false,
            nextStep: 'VERIFY_LOGIN_OTP',
            email: 't***@example.com',
            message: 'A 6-digit login verification code has been dispatched.',
            otpDelivery: { sent: true, message: 'Dispatched via SMTP' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.login({
        email: 'test@example.com',
        password: 'Password1234!@#$',
      });

      assert.equal(result.authenticated, false);
      assert.equal(result.nextStep, 'VERIFY_LOGIN_OTP');
      assert.equal(getInMemoryAccessToken(), null); // Access token NOT granted at step 1
    });
  });

  describe('apiClient.verifyLoginOtp (Step 2)', () => {
    it('completes login, sets access token in memory only, and uses credentials: include', async () => {
      let credentialsUsed = '';

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        credentialsUsed = init?.credentials || '';

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Authentication successful.',
            accessToken: 'mock-jwt-access-token',
            tokenType: 'Bearer',
            expiresIn: 900,
            session: {
              id: 'sess-uuid-1',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
            user: {
              id: 'user-uuid-1',
              email: 'test@example.com',
              roles: ['CANDIDATE'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.verifyLoginOtp({
        email: 'test@example.com',
        otp: '123456',
      });

      assert.equal(credentialsUsed, 'include');
      assert.equal(result.accessToken, 'mock-jwt-access-token');
      assert.equal(getInMemoryAccessToken(), 'mock-jwt-access-token');
    });
  });

  describe('apiClient.refresh', () => {
    it('calls /auth/refresh using cookie alone without dummy refreshToken body', async () => {
      let capturedBody: any = null;
      let credentialsUsed = '';

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        credentialsUsed = init?.credentials || '';
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Session refreshed',
            accessToken: 'new-refreshed-token',
            tokenType: 'Bearer',
            expiresIn: 900,
            session: { id: 'sess-new', expiresAt: new Date().toISOString() },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.refresh();
      assert.equal(credentialsUsed, 'include');
      assert.deepEqual(capturedBody, {});
      assert.equal(result.accessToken, 'new-refreshed-token');
      assert.equal(getInMemoryAccessToken(), 'new-refreshed-token');
    });
  });

  describe('apiClient.logout', () => {
    it('calls /auth/logout using cookie alone without body workaround, and clears in-memory access token', async () => {
      setInMemoryAccessToken('active-token-before-logout');
      assert.equal(getInMemoryAccessToken(), 'active-token-before-logout');
      let capturedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ revoked: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await apiClient.logout();
      assert.equal(result.revoked, true);
      assert.equal(getInMemoryAccessToken(), null);
      assert.deepEqual(capturedBody, {});
    });
  });

  describe('apiClient.fetchWithAuth', () => {
    it('attaches Bearer access token from memory', async () => {
      setInMemoryAccessToken('valid-bearer-token');
      let authHeader = '';

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        authHeader = headers.get('Authorization') || '';
        return new Response(JSON.stringify({ protectedData: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const data = await apiClient.fetchWithAuth<{ protectedData: boolean }>('/api/protected');
      assert.equal(authHeader, 'Bearer valid-bearer-token');
      assert.equal(data.protectedData, true);
    });

    it('refreshes token once on 401 and replays safe GET requests', async () => {
      setInMemoryAccessToken('expired-bearer-token');
      let requestCount = 0;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        requestCount++;

        // First call to /api/protected fails with 401
        if (urlStr.endsWith('/api/protected') && requestCount === 1) {
          return new Response(
            JSON.stringify({ statusCode: 401, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Call to /auth/refresh succeeds
        if (urlStr.endsWith('/auth/refresh')) {
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Refreshed',
              accessToken: 'refreshed-new-token',
              tokenType: 'Bearer',
              expiresIn: 900,
              session: { id: 'sess-2', expiresAt: new Date().toISOString() },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Replayed call to /api/protected succeeds with new token
        if (urlStr.endsWith('/api/protected') && requestCount === 3) {
          const headers = new Headers(init?.headers);
          assert.equal(headers.get('Authorization'), 'Bearer refreshed-new-token');
          return new Response(JSON.stringify({ data: 'refreshed-success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('Not Found', { status: 404 });
      };

      const result = await apiClient.fetchWithAuth<{ data: string }>('/api/protected', {
        method: 'GET',
      });

      assert.equal(result.data, 'refreshed-success');
      assert.equal(getInMemoryAccessToken(), 'refreshed-new-token');
    });

    it('refuses to automatically replay unsafe POST requests without safeToRetry policy', async () => {
      setInMemoryAccessToken('expired-token');

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.endsWith('/api/mutate')) {
          return new Response(
            JSON.stringify({ statusCode: 401, error: 'Token expired' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.endsWith('/auth/refresh')) {
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Refreshed',
              accessToken: 'new-token',
              tokenType: 'Bearer',
              expiresIn: 900,
              session: { id: 's', expiresAt: new Date().toISOString() },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      await assert.rejects(
        async () => {
          await apiClient.fetchWithAuth('/api/mutate', {
            method: 'POST',
            body: JSON.stringify({ amount: 100 }),
            // safeToRetry NOT provided -> should NOT replay unsafe mutating request
          });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /session was refreshed/i);
          return true;
        }
      );

      // Access token was still refreshed in memory for next manual action
      assert.equal(getInMemoryAccessToken(), 'new-token');
    });
  });

  describe('apiClient.forgotPassword & resetPassword', () => {
    it('submits forgot-password request with neutral response', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'If the provided email address exists, reset instructions have been dispatched.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await apiClient.forgotPassword({ email: 'user@example.com' });
      assert.equal(res.success, true);
      assert.match(res.message, /reset instructions have been dispatched/);
    });

    it('submits reset-password with OTP, password, and confirmation', async () => {
      let requestedBody: any = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Password has been successfully updated.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const res = await apiClient.resetPassword({
        email: 'user@example.com',
        otp: '123456',
        newPassword: 'BrandNewPassword123!',
        passwordConfirmation: 'BrandNewPassword123!',
      });

      assert.equal(requestedBody.email, 'user@example.com');
      assert.equal(requestedBody.otp, '123456');
      assert.equal(requestedBody.newPassword, 'BrandNewPassword123!');
      assert.equal(requestedBody.passwordConfirmation, 'BrandNewPassword123!');
      assert.equal(res.success, true);
    });
  });

  describe('HTTP Status Code Error Parsing & Sanitization', () => {
    it('handles 400 Bad Request with single or multiple validation messages', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 400,
            message: ['Email address is invalid.', 'Password is too weak.'],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'bad-email', password: '123' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /Email address is invalid/);
          assert.equal(err.details.length, 2);
          return true;
        }
      );
    });

    it('handles 401 Unauthorized for invalid credentials or expired sessions', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 401,
            error: 'Invalid email or password.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'valid@example.com', password: 'WrongPassword123!' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.message, 'Invalid email or password.');
          return true;
        }
      );
    });

    it('handles 403 Forbidden on CSRF origin checks without exposing internals', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 403,
            error: 'CSRF check failed: untrusted request origin.',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.refresh();
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /CSRF check failed/);
          return true;
        }
      );
    });

    it('handles 409 Conflict for duplicate email registration', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 409,
            error: 'An account with this email address already exists.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.register({
            fullName: 'Duplicate User',
            email: 'exists@example.com',
            password: 'ValidPassword123!',
            passwordConfirmation: 'ValidPassword123!',
            termsAccepted: true,
          });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /already exists/);
          return true;
        }
      );
    });

    it('handles 429 Too Many Requests with standardized rate limit guidance', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 429,
            error: 'ThrottlerException: Too Many Requests',
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'test@example.com', password: 'Password123!' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 429);
          assert.equal(err.message, 'Too many requests. Please wait a moment before trying again.');
          return true;
        }
      );
    });

    it('handles 500 Internal Server Error by masking raw stack traces and internal details', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 500,
            error: 'QueryFailedError: connection to postgres:5432 timed out at line 204 in pool.js',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'test@example.com', password: 'Password123!' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 500);
          assert.equal(err.message, 'A server error occurred. Please try again later.');
          assert.doesNotMatch(err.message, /postgres/i);
          assert.doesNotMatch(err.message, /pool\.js/i);
          return true;
        }
      );
    });

    it('handles 503 Service Unavailable with friendly retry message', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            statusCode: 503,
            error: 'Service Unavailable',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'test@example.com', password: 'Password123!' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 503);
          assert.equal(err.message, 'Service temporarily unavailable. Please try again shortly.');
          return true;
        }
      );
    });

    it('gracefully handles non-JSON HTML error responses (e.g. 502 Bad Gateway from reverse proxy)', async () => {
      globalThis.fetch = async () => {
        return new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        });
      };

      await assert.rejects(
        async () => {
          await apiClient.login({ email: 'test@example.com', password: 'Password123!' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 502);
          assert.equal(err.message, 'A server error occurred. Please try again later.');
          return true;
        }
      );
    });
  });

  describe('Contract Normalization & Lifecycle Invariants', () => {
    it('normalizes backend RevokeSessionResult { success: true, message: "..." } in logout', async () => {
      setInMemoryAccessToken('active-token-to-clear');

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Logged out successfully.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.logout();
      assert.equal(result.success, true);
      assert.equal(result.revoked, true);
      assert.equal(result.message, 'Logged out successfully.');
      assert.equal(getInMemoryAccessToken(), null);
    });

    it('clears in-memory access token even when logout HTTP call fails', async () => {
      setInMemoryAccessToken('token-before-failed-logout');

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ statusCode: 500, error: 'Database error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await apiClient.logout();
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          return true;
        }
      );

      // Memory token MUST be wiped even on server failure
      assert.equal(getInMemoryAccessToken(), null);
    });

    it('handles registration email delivery failure without false claims of successful dispatch', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            id: 'user-created-123',
            email: 'candidate@example.com',
            fullName: 'Jane Candidate',
            mobileNumber: null,
            emailVerified: false,
            accountStatus: 'ACTIVE',
            createdAt: new Date().toISOString(),
            emailDelivery: {
              sent: false,
              message: 'SMTP transport unavailable: verification code will need to be requested once email service is restored.',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.register({
        fullName: 'Jane Candidate',
        email: 'candidate@example.com',
        password: 'Password123!@#',
        passwordConfirmation: 'Password123!@#',
        termsAccepted: true,
      });

      assert.equal(result.emailDelivery.sent, false);
      assert.match(result.emailDelivery.message, /SMTP transport unavailable/);
      assert.equal(result.emailVerified, false);
    });

    it('handles login OTP delivery failure without issuing tokens or claiming successful dispatch', async () => {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            authenticated: false,
            nextStep: 'VERIFY_LOGIN_OTP',
            email: 'j***@example.com',
            message: 'Credentials valid, but email verification code could not be dispatched.',
            otpDelivery: {
              sent: false,
              message: 'SMTP service temporarily unreachable.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await apiClient.login({
        email: 'jane@example.com',
        password: 'ValidPassword123!',
      });

      assert.equal(result.authenticated, false);
      assert.equal(result.nextStep, 'VERIFY_LOGIN_OTP');
      assert.equal(result.otpDelivery.sent, false);
      assert.equal(getInMemoryAccessToken(), null);
    });

    it('clears in-memory token and throws Session expired when fetchWithAuth refresh fails', async () => {
      setInMemoryAccessToken('stale-token');

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.endsWith('/api/data')) {
          return new Response(
            JSON.stringify({ statusCode: 401, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.endsWith('/auth/refresh')) {
          return new Response(
            JSON.stringify({ statusCode: 401, error: 'Session revoked' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      await assert.rejects(
        async () => {
          await apiClient.fetchWithAuth('/api/data', { method: 'GET' });
        },
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.message, 'Session expired. Please sign in again.');
          return true;
        }
      );

      assert.equal(getInMemoryAccessToken(), null);
    });
  });
});
