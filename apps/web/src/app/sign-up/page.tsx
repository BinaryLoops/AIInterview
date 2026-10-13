'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@repo/ui-kit';
import { AuthLayout } from '../components/auth-layout';
import { OAuthButton } from '../components/oauth-button';
import { apiClient, ApiError, type RegisterResponse } from '../../lib/api-client';

interface FormErrors {
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
}

export default function SignUpPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorDetails, setServerErrorDetails] = useState<string[]>([]);
  const [registrationSuccess, setRegistrationSuccess] = useState<RegisterResponse | null>(null);

  // Password policy checks
  const hasMinLength = password.length >= 12;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const checksPassed = [
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecial,
  ].filter(Boolean).length;

  const getStrengthLabel = () => {
    if (password.length === 0) return { label: 'None', color: 'bg-slate-200 text-slate-500' };
    if (checksPassed <= 2) return { label: 'Weak', color: 'bg-rose-500 text-white' };
    if (checksPassed <= 3) return { label: 'Fair', color: 'bg-amber-500 text-white' };
    if (checksPassed <= 4) return { label: 'Good', color: 'bg-indigo-500 text-white' };
    return { label: 'Strong', color: 'bg-emerald-500 text-white' };
  };

  const strength = getStrengthLabel();

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!fullName.trim() || fullName.trim().length < 2) {
      newErrors.fullName = 'Please enter your full name (at least 2 characters).';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    const phoneRegex = /^\+?[0-9\s-]{7,15}$/;
    if (phone.trim() && !phoneRegex.test(phone)) {
      newErrors.phone = 'Please enter a valid phone number (e.g. +1 555-0123).';
    }

    if (checksPassed < 5) {
      newErrors.password = 'Password does not meet all requirement criteria.';
    }

    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.';
    }

    if (!agreeTerms) {
      newErrors.terms = 'You must accept the Terms of Service and Privacy Policy to register.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setServerErrorDetails([]);
    setRegistrationSuccess(null);

    const isValid = validate();
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      const result = await apiClient.register({
        fullName: fullName.trim(),
        email: email.trim(),
        mobileNumber: phone.trim() ? phone.trim() : undefined,
        password,
        passwordConfirmation: confirmPassword,
        termsAccepted: agreeTerms,
      });

      setRegistrationSuccess(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setServerErrorDetails(err.details);
      } else {
        setServerError('Network error connecting to registration service. Please verify your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      heading="Create your candidate account"
      subheading="Prepare for engineering interviews with adaptive AI simulations and structured roadmaps."
    >
      <div className="space-y-6">
        {/* Success Card */}
        {registrationSuccess ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-sm text-emerald-900 leading-relaxed animate-fade-in"
          >
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-bold text-base text-emerald-900">Account Created Successfully!</p>
                <p className="mt-1 text-slate-700 text-xs">
                  A verification code has been dispatched to <span className="font-semibold text-slate-900">{registrationSuccess.email}</span>.
                </p>
                {!registrationSuccess.emailDelivery.sent && (
                  <p className="mt-2 text-amber-800 text-[11px] bg-amber-50 p-2 rounded border border-amber-200">
                    Notice: {registrationSuccess.emailDelivery.message}
                  </p>
                )}
                <div className="mt-4 flex gap-3">
                  <Link href={`/verify-email?email=${encodeURIComponent(registrationSuccess.email)}`}>
                    <Button variant="primary" size="md">
                      Enter Verification Code →
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Google OAuth entry point */}
            <OAuthButton action="Sign up" />

            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative bg-white px-3 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Or register with email
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
                    <p className="font-bold">Registration Error</p>
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
          {/* Full Name */}
          <div>
            <label htmlFor="fullName" className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="fullName"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
              }}
              aria-invalid={!!errors.fullName}
              aria-describedby={errors.fullName ? 'fullName-error' : undefined}
              placeholder="e.g. Alex Morgan"
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                errors.fullName
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
              }`}
            />
            {errors.fullName && (
              <p id="fullName-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                {errors.fullName}
              </p>
            )}
          </div>

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
              placeholder="alex@example.com"
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

          {/* Mobile Number */}
          <div>
            <label htmlFor="phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Mobile Number <span className="text-rose-500">*</span>
            </label>
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }));
              }}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'phone-error' : undefined}
              placeholder="+1 555-0123"
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                errors.phone
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/20'
              }`}
            />
            {errors.phone && (
              <p id="phone-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                {errors.phone}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="password" className="text-xs font-semibold text-slate-700">
                Password <span className="text-rose-500">*</span>
              </label>
              {password.length > 0 && (
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
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                }}
                aria-invalid={!!errors.password}
                aria-describedby="password-policy-list"
                placeholder="At least 12 characters"
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
              <p role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                {errors.password}
              </p>
            )}

            {/* Password Policy Checklist */}
            <div
              id="password-policy-list"
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
                Client-side validation verifies formatting. Additional server-side validation and breach checks are performed during account processing.
              </p>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm Password <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                }}
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
                placeholder="Re-enter your password"
                className={`w-full rounded-lg border px-3.5 py-2.5 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                  errors.confirmPassword
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
            {errors.confirmPassword && (
              <p id="confirmPassword-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                {errors.confirmPassword}
              </p>
            )}
          </div>

          {/* Terms Agreement Checkbox */}
          <div className="pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={agreeTerms}
                onChange={(e) => {
                  setAgreeTerms(e.target.checked);
                  if (errors.terms) setErrors((prev) => ({ ...prev, terms: undefined }));
                }}
                aria-invalid={!!errors.terms}
                aria-describedby={errors.terms ? 'terms-error' : undefined}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs text-slate-600 leading-snug">
                I agree to the{' '}
                <a href="#" className="font-semibold text-brand-600 hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="#" className="font-semibold text-brand-600 hover:underline">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
            {errors.terms && (
              <p id="terms-error" role="alert" className="mt-1 text-xs text-rose-600 font-medium">
                {errors.terms}
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
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        </form>

        <div className="pt-2 text-center text-xs text-slate-600 border-t border-slate-100">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-bold text-brand-600 hover:text-brand-700 hover:underline">
            Sign in
          </Link>
        </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
