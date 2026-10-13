/**
 * Typed API client for the AREP Web frontend connecting to the NestJS auth-service.
 *
 * Security Architecture:
 * 1. Access tokens are held exclusively in JavaScript memory and NEVER written
 *    to localStorage, sessionStorage, or client-side document.cookies.
 * 2. Refresh tokens are managed exclusively by the browser as HttpOnly, SameSite=Lax cookies
 *    and are completely inaccessible to browser JavaScript.
 * 3. All cookie-authenticated operations use `credentials: 'include'`.
 * 4. Token expiration triggers a single refresh attempt with loop prevention.
 * 5. Safe retry policy: Only safe requests (GET, HEAD) or explicitly designated operations
 *    are automatically retried following a token refresh to prevent duplicate state mutations.
 */

export const AUTH_API_BASE_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost:3001';

/**
 * Standardized API Error representation.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details: string[];

  constructor(message: string, statusCode: number, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// DTO & Response Contracts
// ---------------------------------------------------------------------------

export interface RegisterPayload {
  fullName: string;
  email: string;
  mobileNumber?: string;
  password: string;
  passwordConfirmation: string;
  termsAccepted: boolean;
}

export interface RegisterResponse {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string | null;
  emailVerified: boolean;
  accountStatus: string;
  createdAt: string;
  emailDelivery: {
    sent: boolean;
    message: string;
  };
}

export interface VerifyEmailPayload {
  email: string;
  otp: string;
}

export interface VerifyEmailResponse {
  success: boolean;
  message: string;
  email: string;
  emailVerified: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  authenticated: false;
  nextStep: 'VERIFY_LOGIN_OTP';
  email: string;
  message: string;
  otpDelivery: {
    sent: boolean;
    message: string;
  };
}

export interface VerifyLoginOtpPayload {
  email: string;
  otp: string;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  roles: string[];
}

export interface VerifyLoginOtpResponse {
  success: boolean;
  message: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  session: {
    id: string;
    expiresAt: string;
  };
  user: AuthSessionUser;
}

export interface RefreshResponse {
  success: boolean;
  message: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  session: {
    id: string;
    expiresAt: string;
  };
  user?: AuthSessionUser;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
  revoked?: boolean;
  sessionId?: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

export interface ResetPasswordPayload {
  email: string;
  otp: string;
  newPassword: string;
  passwordConfirmation: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// In-Memory Token Management
// ---------------------------------------------------------------------------

let inMemoryAccessToken: string | null = null;

export function getInMemoryAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setInMemoryAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

// ---------------------------------------------------------------------------
// Error Parser Helper
// ---------------------------------------------------------------------------

interface BackendErrorPayload {
  statusCode?: number;
  error?: string | string[];
  message?: string | string[];
  path?: string;
}

function parseBackendError(status: number, data: unknown): ApiError {
  let message = 'An unexpected error occurred. Please try again.';
  const details: string[] = [];

  if (data && typeof data === 'object') {
    const payload = data as BackendErrorPayload;
    if (Array.isArray(payload.error)) {
      payload.error.forEach((e) => details.push(String(e)));
      message = details.join(' ');
    } else if (typeof payload.error === 'string') {
      details.push(payload.error);
      message = payload.error;
    } else if (Array.isArray(payload.message)) {
      payload.message.forEach((m) => details.push(String(m)));
      message = details.join(' ');
    } else if (typeof payload.message === 'string') {
      details.push(payload.message);
      message = payload.message;
    }
  }

  if (status === 429) {
    message = 'Too many requests. Please wait a moment before trying again.';
  } else if (status === 503) {
    message = 'Service temporarily unavailable. Please try again shortly.';
  } else if (status >= 500) {
    message = 'A server error occurred. Please try again later.';
    details.length = 0;
    details.push(message);
  }

  return new ApiError(message, status, details.length > 0 ? details : [message]);
}

// ---------------------------------------------------------------------------
// Core HTTP Request Handler
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${AUTH_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Ensures HttpOnly cookies are attached across origins
  });

  if (!response.ok) {
    let errorData: unknown = null;
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON error payload
    }
    throw parseBackendError(response.status, errorData);
  }

  // Handle empty bodies (e.g. 204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Authentication API Endpoints
// ---------------------------------------------------------------------------

export const apiClient = {
  /**
   * Register a new candidate account.
   */
  async register(payload: RegisterPayload): Promise<RegisterResponse> {
    return request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
        passwordConfirmation: payload.passwordConfirmation,
        termsAccepted: payload.termsAccepted,
        ...(payload.mobileNumber?.trim()
          ? { mobileNumber: payload.mobileNumber.trim() }
          : {}),
      }),
    });
  },

  /**
   * Verify candidate email using six-digit OTP.
   */
  async verifyEmail(payload: VerifyEmailPayload): Promise<VerifyEmailResponse> {
    return request<VerifyEmailResponse>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        otp: payload.otp.trim(),
      }),
    });
  },

  /**
   * Step 1 Login: Authenticate email and password.
   * Returns nextStep: 'VERIFY_LOGIN_OTP' upon valid credentials.
   */
  async login(payload: LoginPayload): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        password: payload.password,
      }),
    });
  },

  /**
   * Step 2 Login: Complete authentication by verifying 6-digit login OTP.
   * Delivers access token in JSON body and sets HttpOnly refresh cookie.
   */
  async verifyLoginOtp(payload: VerifyLoginOtpPayload): Promise<VerifyLoginOtpResponse> {
    const result = await request<VerifyLoginOtpResponse>('/auth/verify-login-otp', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        otp: payload.otp.trim(),
      }),
    });

    if (result.accessToken) {
      setInMemoryAccessToken(result.accessToken);
    }
    return result;
  },

  /**
   * Refresh session using HttpOnly refresh cookie.
   * Rotates refresh token and issues new access token.
   * Cookie-only: No request body workaround needed.
   */
  async refresh(): Promise<RefreshResponse> {
    const result = await request<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result.accessToken) {
      setInMemoryAccessToken(result.accessToken);
    }
    return result;
  },

  /**
   * Logout current session: invalidates session and clears HttpOnly refresh cookie.
   * Cookie-only: No request body workaround needed.
   */
  async logout(): Promise<LogoutResponse> {
    try {
      const result = await request<LogoutResponse>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return {
        success: result.success ?? (result as any).revoked ?? true,
        message: result.message ?? 'Logged out successfully.',
        revoked: result.revoked ?? result.success ?? true,
        sessionId: result.sessionId,
      };
    } finally {
      setInMemoryAccessToken(null);
    }
  },

  /**
   * Request password reset instructions (OTP) for an email.
   */
  async forgotPassword(payload: ForgotPasswordPayload): Promise<ForgotPasswordResponse> {
    return request<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
      }),
    });
  },

  /**
   * Complete password reset using OTP and new password.
   */
  async resetPassword(payload: ResetPasswordPayload): Promise<ResetPasswordResponse> {
    return request<ResetPasswordResponse>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        otp: payload.otp.trim(),
        newPassword: payload.newPassword,
        passwordConfirmation: payload.passwordConfirmation,
      }),
    });
  },

  /**
   * Authenticated request helper with automatic 1-time token refresh on 401.
   * Strictly enforces safe-retry policy: only safe HTTP methods (GET, HEAD)
   * or requests with `safeToRetry: true` are replayed automatically.
   */
  async fetchWithAuth<T>(
    endpoint: string,
    options: RequestInit & { safeToRetry?: boolean } = {}
  ): Promise<T> {
    const { safeToRetry, ...fetchOptions } = options;
    const token = getInMemoryAccessToken();

    const headers = new Headers(fetchOptions.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    try {
      return await request<T>(endpoint, {
        ...fetchOptions,
        headers,
      });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401 && !refreshInProgress) {
        const method = (fetchOptions.method || 'GET').toUpperCase();
        const isSafeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

        // Attempt single-use refresh
        let refreshed: RefreshResponse | null = null;
        try {
          refreshInProgress = true;
          refreshed = await this.refresh();
        } catch {
          // Refresh failed - session expired
          setInMemoryAccessToken(null);
          throw new ApiError('Session expired. Please sign in again.', 401);
        } finally {
          refreshInProgress = false;
        }

        // Retry policy check
        if (isSafeMethod || safeToRetry) {
          const retryHeaders = new Headers(fetchOptions.headers || {});
          if (refreshed?.accessToken) {
            retryHeaders.set('Authorization', `Bearer ${refreshed.accessToken}`);
          }
          return await request<T>(endpoint, {
            ...fetchOptions,
            headers: retryHeaders,
          });
        }

        // Unsafe method without explicit safeToRetry policy
        throw new ApiError(
          'Your session was refreshed. Please re-submit your action.',
          409
        );
      }

      throw err;
    }
  },
};

let refreshInProgress = false;
