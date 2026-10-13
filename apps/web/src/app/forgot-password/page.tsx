'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@repo/ui-kit';
import { AuthLayout } from '../components/auth-layout';
import { apiClient, ApiError } from '../../lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmittedNotice(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiClient.forgotPassword({
        email: email.trim(),
      });

      // Display generic account-recovery message that does not disclose whether an email exists
      setSubmittedNotice(
        response.message ||
          'If an account is associated with this email address, password reset instructions and a six-digit verification code have been dispatched. Please check your inbox.'
      );
    } catch (err) {
      if (err instanceof ApiError) {
        // Even on error, avoid exposing account existence unless rate-limited
        setError(err.message);
      } else {
        setError('Network failure connecting to password recovery service. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      heading="Reset your password"
      subheading="Enter the email associated with your AREP account to receive password reset instructions."
    >
      <div className="space-y-6">
        {/* Generic Account Recovery Notice upon submission */}
        {submittedNotice ? (
          <div
            role="status"
            className="rounded-xl border border-brand-200 bg-brand-50/90 p-5 text-xs text-brand-950 leading-relaxed animate-fade-in"
          >
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-brand-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <div>
                <p className="font-bold text-sm text-brand-900">Check Your Email</p>
                <p className="mt-1 text-slate-700 leading-relaxed">{submittedNotice}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Privacy notice: To protect user accounts, recovery responses are generic and do not disclose whether an account exists for this email address.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href={`/reset-password?email=${encodeURIComponent(email.trim())}`}>
                    <Button variant="primary" size="md">
                      Enter Reset Code &amp; New Password →
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {error && (
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
                    <p className="font-bold">Request Failed</p>
                    <p className="mt-0.5 text-slate-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
                    if (error) setError(null);
                  }}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'reset-email-error' : undefined}
                  placeholder="you@example.com"
                  className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                    error
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
                  }`}
                />
                {error && (
                  <p id="reset-email-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                    {error}
                  </p>
                )}
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full justify-center shadow-md shadow-brand-500/10"
                >
                  {isSubmitting ? 'Sending Request...' : 'Send Reset Instructions'}
                </Button>
              </div>
            </form>
          </>
        )}

        <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100 flex items-center justify-center gap-4">
          <Link href="/sign-in" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
            ← Back to Sign in
          </Link>
          <span className="text-slate-300">•</span>
          <Link href="/sign-up" className="font-semibold text-slate-600 hover:text-brand-600 hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
