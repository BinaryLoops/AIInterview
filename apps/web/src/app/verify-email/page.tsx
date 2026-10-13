'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@repo/ui-kit';
import { AuthLayout } from '../components/auth-layout';
import { apiClient, ApiError } from '../../lib/api-client';

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const defaultEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(defaultEmail);
  const [otp, setOtp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const validate = (): boolean => {
    setErrorMessage(null);
    setErrorDetails([]);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email)) {
      setErrorMessage('Please enter a valid email address.');
      return false;
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      setErrorMessage('Verification code must be exactly 6 digits.');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setErrorDetails([]);

    try {
      const response = await apiClient.verifyEmail({
        email: email.trim(),
        otp: otp.trim(),
      });

      setSuccessMessage(
        response.message || 'Email successfully verified! You can now sign in.'
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        setErrorDetails(err.details);
      } else {
        setErrorMessage('Unable to connect to verification service. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Success banner */}
      {successMessage ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-sm text-emerald-900 leading-relaxed"
        >
          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <p className="font-bold text-emerald-900">Email Verified Successfully</p>
              <p className="mt-1 text-slate-700 text-xs">{successMessage}</p>
              <div className="mt-4">
                <Link href="/sign-in">
                  <Button variant="primary" size="md">
                    Proceed to Sign In
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Server / Validation Error Alert */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-xs text-rose-900 leading-relaxed"
            >
              <div className="flex items-start gap-2.5">
                <svg
                  className="h-5 w-5 text-rose-600 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="font-bold">Verification Failed</p>
                  <p className="mt-0.5 text-slate-700">{errorMessage}</p>
                  {errorDetails.length > 1 && (
                    <ul className="mt-1.5 list-disc list-inside text-rose-700 space-y-0.5">
                      {errorDetails.map((detail, idx) => (
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
              <label htmlFor="verify-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Account Email Address <span className="text-rose-500">*</span>
              </label>
              <input
                id="verify-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {/* OTP Code */}
            <div>
              <label htmlFor="verify-otp" className="block text-xs font-semibold text-slate-700 mb-1">
                Six-Digit Verification Code <span className="text-rose-500">*</span>
              </label>
              <input
                id="verify-otp"
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
                }}
                placeholder="123456"
                className="w-full tracking-widest text-center font-mono font-bold text-lg rounded-lg border border-slate-300 px-3.5 py-2.5 text-slate-900 placeholder:text-slate-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Enter the 6-digit code delivered to your registered email inbox. Valid for 10 minutes.
              </p>
            </div>

            {/* Resend Capability Note */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Didn&apos;t receive a code?</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                Note: A dedicated OTP resend endpoint is not currently implemented in the backend service. If your 6-digit code expires or was not received, please restart registration or use password recovery.
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
                {isSubmitting ? 'Verifying Code...' : 'Verify Email'}
              </Button>
            </div>
          </form>

          <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100 flex items-center justify-center gap-4">
            <Link href="/sign-in" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
              ← Back to Sign in
            </Link>
            <span className="text-slate-300">•</span>
            <Link href="/sign-up" className="font-semibold text-slate-600 hover:text-brand-600 hover:underline">
              Create an account
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthLayout
      heading="Verify your email"
      subheading="Enter the six-digit verification code sent to your inbox to activate your AREP account."
    >
      <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading verification form...</div>}>
        <VerifyEmailForm />
      </Suspense>
    </AuthLayout>
  );
}
