'use client';

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import {
  apiClient,
  type AuthSessionUser,
  type LoginPayload,
  type LoginResponse,
  type RegisterPayload,
  type RegisterResponse,
  type ResetPasswordPayload,
  type ResetPasswordResponse,
  type VerifyEmailPayload,
  type VerifyEmailResponse,
  type VerifyLoginOtpPayload,
  type VerifyLoginOtpResponse,
  type ForgotPasswordPayload,
  type ForgotPasswordResponse,
  getInMemoryAccessToken,
} from './api-client';

export interface AuthContextType {
  user: AuthSessionUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginStep1: (payload: LoginPayload) => Promise<LoginResponse>;
  loginStep2: (payload: VerifyLoginOtpPayload) => Promise<VerifyLoginOtpResponse>;
  verifyEmail: (payload: VerifyEmailPayload) => Promise<VerifyEmailResponse>;
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  forgotPassword: (payload: ForgotPasswordPayload) => Promise<ForgotPasswordResponse>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<ResetPasswordResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseJwtClaims(token: string): AuthSessionUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    if (parsed.sub && parsed.email) {
      return {
        id: parsed.sub,
        email: parsed.email,
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      };
    }
  } catch {
    // Malformed token or unparseable
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Restore session from HttpOnly cookie on initial client mount
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const res = await apiClient.refresh();
        if (!isMounted) return;

        const resolvedUser = res.user ?? parseJwtClaims(res.accessToken);
        setUser(resolvedUser);
        setAccessToken(res.accessToken);
      } catch {
        // No active session or cookie expired
        if (!isMounted) return;
        setUser(null);
        setAccessToken(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const loginStep1 = async (payload: LoginPayload): Promise<LoginResponse> => {
    return apiClient.login(payload);
  };

  const loginStep2 = async (
    payload: VerifyLoginOtpPayload
  ): Promise<VerifyLoginOtpResponse> => {
    const result = await apiClient.verifyLoginOtp(payload);
    setUser(result.user);
    setAccessToken(result.accessToken);
    return result;
  };

  const verifyEmail = async (
    payload: VerifyEmailPayload
  ): Promise<VerifyEmailResponse> => {
    return apiClient.verifyEmail(payload);
  };

  const register = async (payload: RegisterPayload): Promise<RegisterResponse> => {
    return apiClient.register(payload);
  };

  const forgotPassword = async (
    payload: ForgotPasswordPayload
  ): Promise<ForgotPasswordResponse> => {
    return apiClient.forgotPassword(payload);
  };

  const resetPassword = async (
    payload: ResetPasswordPayload
  ): Promise<ResetPasswordResponse> => {
    return apiClient.resetPassword(payload);
  };

  const logout = async (): Promise<void> => {
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
      setAccessToken(null);
    }
  };

  const refreshSession = async (): Promise<boolean> => {
    try {
      const res = await apiClient.refresh();
      const resolvedUser = res.user ?? parseJwtClaims(res.accessToken);
      setUser(resolvedUser);
      setAccessToken(res.accessToken);
      return true;
    } catch {
      setUser(null);
      setAccessToken(null);
      return false;
    }
  };

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      accessToken,
      isAuthenticated: !!user && !!accessToken,
      isLoading,
      loginStep1,
      loginStep2,
      verifyEmail,
      register,
      forgotPassword,
      resetPassword,
      logout,
      refreshSession,
    }),
    [user, accessToken, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
