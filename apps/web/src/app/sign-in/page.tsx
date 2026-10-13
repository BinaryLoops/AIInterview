'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui-kit';
import { AuthLayout } from '../components/auth-layout';
import { OAuthButton } from '../components/oauth-button';
import { apiClient, ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';

interface SignInErrors {
  email?: string;
  password?: string;
  otp?: string;
}

export default function SignInPage() {
  const router = useRouter();
  const { refreshSession } = useAuth();

  // Two-step flow state: 'credentials' -> 'otp'
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [challengeMessage, setChallengeMessage] = useState('');
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);

  const [errors, setErrors] = useState<SignInErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorDetails, setServerErrorDetails] = useState<string[]>([]);

  const validateCredentials = (): boolean => {
    const newErrors: SignInErrors = {};

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      newErrors.password = 'Please enter your password.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateOtp = (): boolean => {
    const newErrors: SignInErrors = {};

    if (!/^\d{6}$/.test(otp.trim())) {
      newErrors.otp = 'Verification code must be exactly 6 digits.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setServerErrorDetails([]);
    setDeliveryWarning(null);

    const isValid = validateCredentials();
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const response = await apiClient.login({
        email: email.trim(),
        password,
      });

      // Crucial security requirement: Do not treat password validation as successful authentication!
      if (response.nextStep === 'VERIFY_LOGIN_OTP') {
        setMaskedEmail(response.email);
        setChallengeMessage(response.message);
        if (!response.otpDelivery?.sent) {
          setDeliveryWarning(
            `Notice: OTP delivery could not be sent (${response.otpDelivery?.message || 'SMTP inactive'}).`
          );
        }
        setStep('otp');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setServerErrorDetails(err.details);
      } else {
        setServerError('Unable to connect to authentication service. Please check your network.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setServerErrorDetails([]);

    const isValid = validateOtp();
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      // Completes authentication: issues in-memory access token and HttpOnly refresh cookie
      await apiClient.verifyLoginOtp({
        email: email.trim(),
        otp: otp.trim(),
      });

      // Synchronize in-memory auth context
      await refreshSession();

      // Redirect upon successful two-step authentication
      router.push('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setServerErrorDetails(err.details);
      } else {
        setServerError('Verification failed. Please check your code and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      heading={step === 'credentials' ? 'Welcome back to AREP' : 'Two-Factor Verification'}
      subheading={
        step === 'credentials'
          ? 'Sign in to continue your interview preparation and track your readiness.'
          : 'Enter the six-digit code sent to your registered email to complete authentication.'
      }
    >
      <div className="space-y-6">
        {step === 'credentials' ? (
          <>
            {/* Google OAuth entry point */}
            <OAuthButton action="Sign in" />

            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative bg-white px-3 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Or sign in with email
              </div>
            </div>

            {/* Server Error Alert */}
            {serverError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-xs text-rose-900 leading-relaxed animate-fade-in"
              >
                <div className="flex items-start gap-2.5">
                  <svg className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <p className="font-bold">Authentication Failed</p>
                    <p className="mt-0.5 text-slate-700">{serverError}</p>
                    {serverErrorDetails.length > 1 && (
                      <ul className="mt-1.5 list-disc list-inside text-rose-700 space-y-0.5">
                        {serverErrorDetails.map((detail, idx) => (
                          <li key={idx}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleCredentialsSubmit} noValidate className="space-y-4">
              {/* Email Address */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  placeholder="you@example.com"
                  className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                    errors.email
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
                  }`}
                />
                {errors.email && (
                  <p id="email-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="password" className="text-xs font-semibold text-slate-700">
                    Password <span className="text-rose-500">*</span>
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                    }}
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    placeholder="Enter your password"
                    className={`w-full rounded-lg border px-3.5 py-2.5 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                      errors.password
                        ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                        : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs font-medium focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && (
                  <p id="password-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                    {errors.password}
                  </p>
                )}
              </div>

              {/* Submit button */}
              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full justify-center shadow-md shadow-brand-500/10"
                >
                  {isSubmitting ? 'Verifying Credentials...' : 'Continue to Verification'}
                </Button>
              </div>
            </form>

            <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100">
              Don&apos;t have an account?{' '}
              <Link href="/sign-up" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
                Create an account
              </Link>
            </div>
          </>
        ) : (
          /* Step 2: Login OTP Verification */
          <div className="space-y-5 animate-fade-in">
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-4 text-xs text-brand-900">
              <p className="font-bold text-sm text-brand-950">Security Gate: 6-Digit Login Code</p>
              <p className="mt-1 text-slate-700">
                {challengeMessage || 'A verification code has been dispatched to your email address.'}
              </p>
              {maskedEmail && (
                <p className="mt-1 font-mono font-medium text-slate-800">
                  Target: <span className="font-bold">{maskedEmail}</span>
                </p>
              )}
              {deliveryWarning && (
                <p className="mt-2 text-amber-800 text-[11px] bg-amber-50 p-2 rounded border border-amber-200">
                  {deliveryWarning}
                </p>
              )}
            </div>

            {/* Server Error Alert on OTP */}
            {serverError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-xs text-rose-900 leading-relaxed"
              >
                <div className="flex items-start gap-2.5">
                  <svg className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <p className="font-bold">Code Verification Failed</p>
                    <p className="mt-0.5 text-slate-700">{serverError}</p>
                    {serverErrorDetails.length > 1 && (
                      <ul className="mt-1.5 list-disc list-inside text-rose-700 space-y-0.5">
                        {serverErrorDetails.map((detail, idx) => (
                          <li key={idx}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleOtpSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="login-otp" className="block text-xs font-semibold text-slate-700 mb-1">
                  6-Digit OTP Code <span className="text-rose-500">*</span>
                </label>
                <input
                  id="login-otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setOtp(clean);
                    if (errors.otp) setErrors((prev) => ({ ...prev, otp: undefined }));
                  }}
                  aria-invalid={!!errors.otp}
                  aria-describedby={errors.otp ? 'otp-error' : undefined}
                  placeholder="123456"
                  className={`w-full tracking-widest text-center font-mono font-bold text-lg rounded-lg border px-3.5 py-2.5 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 ${
                    errors.otp
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
                  }`}
                />
                {errors.otp && (
                  <p id="otp-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                    {errors.otp}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-slate-500 text-center">
                  Code expires in 10 minutes.
                </p>
              </div>

              {/* Submit button */}
              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isSubmitting || otp.length !== 6}
                  className="w-full justify-center shadow-md shadow-brand-500/10"
                >
                  {isSubmitting ? 'Authenticating...' : 'Complete Sign In'}
                </Button>
              </div>
            </form>

            <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setOtp('');
                  setServerError(null);
                  setServerErrorDetails([]);
                }}
                className="font-semibold text-slate-600 hover:text-brand-600 hover:underline"
              >
                ← Back to enter password
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
