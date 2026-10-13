'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@repo/ui-kit';
import { AuthLayout } from '../components/auth-layout';
import { apiClient, ApiError } from '../../lib/api-client';

interface ResetFormErrors {
  email?: string;
  otp?: string;
  newPassword?: string;
  passwordConfirmation?: string;
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const defaultEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(defaultEmail);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [errors, setErrors] = useState<ResetFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorDetails, setServerErrorDetails] = useState<string[]>([]);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Password policy checks
  const hasMinLength = newPassword.length >= 12;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

  const checksPassed = [
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecial,
  ].filter(Boolean).length;

  const getStrengthLabel = () => {
    if (newPassword.length === 0) return { label: 'None', color: 'bg-slate-200 text-slate-500' };
    if (checksPassed <= 2) return { label: 'Weak', color: 'bg-rose-500 text-white' };
    if (checksPassed <= 3) return { label: 'Fair', color: 'bg-amber-500 text-white' };
    if (checksPassed <= 4) return { label: 'Good', color: 'bg-indigo-500 text-white' };
    return { label: 'Strong', color: 'bg-emerald-500 text-white' };
  };

  const strength = getStrengthLabel();

  const validate = (): boolean => {
    const newErrors: ResetFormErrors = {};

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      newErrors.otp = 'Verification code must be exactly 6 digits.';
    }

    if (checksPassed < 5) {
      newErrors.newPassword = 'New password must fulfill all password policy requirements.';
    }

    if (newPassword !== passwordConfirmation) {
      newErrors.passwordConfirmation = 'Passwords do not match.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setServerErrorDetails([]);

    const isValid = validate();
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const response = await apiClient.resetPassword({
        email: email.trim(),
        otp: otp.trim(),
        newPassword,
        passwordConfirmation,
      });

      // Crucial requirement: Do not claim reset succeeded unless API explicitly confirms success
      if (response.success) {
        setResetSuccess(true);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setServerErrorDetails(err.details);
      } else {
        setServerError('Network error connecting to password reset service. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (resetSuccess) {
    return (
      <div
        role="status"
        className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-sm text-emerald-900 leading-relaxed animate-fade-in"
      >
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div>
            <p className="font-bold text-base text-emerald-900">Password Reset Confirmed</p>
            <p className="mt-1 text-slate-700 text-xs leading-relaxed">
              Your password has been successfully updated. All previous sessions have been terminated for security. You can now sign in with your new password.
            </p>
            <div className="mt-4">
              <Link href="/sign-in">
                <Button variant="primary" size="md">
                  Proceed to Sign In →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
              <p className="font-bold">Reset Failed</p>
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

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Email Address */}
        <div>
          <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-700 mb-1">
            Account Email Address <span className="text-rose-500">*</span>
          </label>
          <input
            id="reset-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'reset-email-error' : undefined}
            placeholder="you@example.com"
            className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
              errors.email
                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
            }`}
          />
          {errors.email && (
            <p id="reset-email-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
              {errors.email}
            </p>
          )}
        </div>

        {/* 6-Digit OTP */}
        <div>
          <label htmlFor="reset-otp" className="block text-xs font-semibold text-slate-700 mb-1">
            Six-Digit Verification Code <span className="text-rose-500">*</span>
          </label>
          <input
            id="reset-otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtp(cleaned);
              if (errors.otp) setErrors((prev) => ({ ...prev, otp: undefined }));
            }}
            aria-invalid={!!errors.otp}
            aria-describedby={errors.otp ? 'reset-otp-error' : undefined}
            placeholder="123456"
            className={`w-full tracking-widest text-center font-mono font-bold text-lg rounded-lg border px-3.5 py-2.5 text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 ${
              errors.otp
                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
            }`}
          />
          {errors.otp && (
            <p id="reset-otp-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
              {errors.otp}
            </p>
          )}
        </div>

        {/* New Password */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="newPassword" className="text-xs font-semibold text-slate-700">
              New Password <span className="text-rose-500">*</span>
            </label>
            {newPassword.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">Strength:</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${strength.color}`}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>
          <div className="relative">
            <input
              id="newPassword"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (errors.newPassword) setErrors((prev) => ({ ...prev, newPassword: undefined }));
              }}
              aria-invalid={!!errors.newPassword}
              aria-describedby="password-policy-checklist"
              placeholder="At least 12 characters"
              className={`w-full rounded-lg border px-3.5 py-2.5 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                errors.newPassword
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs font-medium focus:outline-none"
              aria-label={showPassword ? 'Hide new password' : 'Show new password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.newPassword && (
            <p role="alert" className="mt-1 text-xs text-rose-600 font-medium">
              {errors.newPassword}
            </p>
          )}

          {/* Password Policy Checklist */}
          <div
            id="password-policy-checklist"
            className="mt-2.5 rounded-lg border border-slate-200/90 bg-slate-50 p-3 text-xs space-y-1.5"
          >
            <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
              Password Requirements
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
              <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-700' : 'text-slate-500'}`}>
                <span>{hasMinLength ? '✓' : '○'}</span>
                <span>At least 12 characters</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasUppercase ? 'text-emerald-700' : 'text-slate-500'}`}>
                <span>{hasUppercase ? '✓' : '○'}</span>
                <span>Uppercase letter (A-Z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasLowercase ? 'text-emerald-700' : 'text-slate-500'}`}>
                <span>{hasLowercase ? '✓' : '○'}</span>
                <span>Lowercase letter (a-z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-700' : 'text-slate-500'}`}>
                <span>{hasNumber ? '✓' : '○'}</span>
                <span>Number (0-9)</span>
              </div>
              <div className={`flex items-center gap-1.5 sm:col-span-2 ${hasSpecial ? 'text-emerald-700' : 'text-slate-500'}`}>
                <span>{hasSpecial ? '✓' : '○'}</span>
                <span>Special character (!@#$%^&amp;*)</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-200">
              Backend validation and password history checks are authoritative. Reusing your previous password will be rejected by the server.
            </p>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="passwordConfirmation" className="block text-xs font-semibold text-slate-700 mb-1">
            Confirm New Password <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <input
              id="passwordConfirmation"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(e) => {
                setPasswordConfirmation(e.target.value);
                if (errors.passwordConfirmation)
                  setErrors((prev) => ({ ...prev, passwordConfirmation: undefined }));
              }}
              aria-invalid={!!errors.passwordConfirmation}
              aria-describedby={errors.passwordConfirmation ? 'passwordConfirmation-error' : undefined}
              placeholder="Re-enter your new password"
              className={`w-full rounded-lg border px-3.5 py-2.5 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                errors.passwordConfirmation
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 text-xs font-medium focus:outline-none"
              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
            >
              {showConfirmPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.passwordConfirmation && (
            <p id="passwordConfirmation-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
              {errors.passwordConfirmation}
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
            {isSubmitting ? 'Updating Password...' : 'Reset Password'}
          </Button>
        </div>
      </form>

      <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100 flex items-center justify-center gap-4">
        <Link href="/sign-in" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
          ← Back to Sign in
        </Link>
        <span className="text-slate-300">•</span>
        <Link href="/forgot-password" className="font-semibold text-slate-600 hover:text-brand-600 hover:underline">
          Resend code
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      heading="Create a new password"
      subheading="Enter the six-digit code sent to your email and select a strong, secure new password."
    >
      <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading reset form...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
