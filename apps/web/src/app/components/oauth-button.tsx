'use client';

import React, { useState } from 'react';

interface OAuthButtonProps {
  action: 'Sign in' | 'Sign up';
}

export function OAuthButton({ action }: OAuthButtonProps) {
  const [showNotice, setShowNotice] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setShowNotice(true)}
        aria-describedby="oauth-status-desc"
        className="w-full relative flex items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors cursor-pointer"
      >
        {/* Google SVG icon */}
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>Continue with Google</span>
        <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          Coming Soon
        </span>
      </button>

      <p id="oauth-status-desc" className="sr-only">
        Google OAuth integration is currently in development and unavailable.
      </p>

      {showNotice && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 animate-fade-in flex items-start justify-between gap-2"
        >
          <div className="flex items-start gap-2">
            <svg className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Google OAuth integration is in progress. Please use email and password for now.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowNotice(false)}
            className="text-amber-700 hover:text-amber-900 font-bold px-1"
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
