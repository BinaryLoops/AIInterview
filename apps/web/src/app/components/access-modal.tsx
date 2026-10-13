'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@repo/ui-kit';

export interface AccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  defaultRole?: 'candidate' | 'employer';
}

export function AccessModal({
  isOpen,
  onClose,
  title = 'Platform Early Access',
  defaultRole = 'candidate',
}: AccessModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [role, setRole] = useState<'candidate' | 'employer'>(defaultRole);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setRole(defaultRole);
    setSubmitted(false);
    setEmail('');
  }, [isOpen, defaultRole]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-slate-900 shadow-2xl transition-all"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-brand-600" />
            <span className="text-xs font-semibold tracking-wider uppercase text-brand-700">
              AREP Platform Notice
            </span>
          </div>
          <Badge variant="neutral" className="text-xs">
            Preview Phase
          </Badge>
        </div>

        <div className="mt-5 space-y-4">
          <h2 id="modal-title" className="text-xl font-bold tracking-tight text-slate-900">
            {title}
          </h2>

          <p id="modal-description" className="text-sm leading-relaxed text-slate-600">
            AREP is currently in private preview. We are actively refining our conversational
            technical practice sessions and structured hiring rubrics ahead of public deployment.
          </p>

          {submitted ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-900">
              <div className="flex items-start gap-2.5">
                <svg className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="text-sm font-semibold">Thank you for your interest!</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    We will notify <span className="font-semibold">{email}</span> as soon as{' '}
                    {role === 'candidate' ? 'candidate practice' : 'employer evaluation'} onboarding opens.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  I am interested as a:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('candidate')}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      role === 'candidate'
                        ? 'border-brand-600 bg-brand-50/80 text-brand-800 ring-1 ring-brand-600'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Candidate (Interview Prep)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('employer')}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      role === 'employer'
                        ? 'border-brand-600 bg-brand-50/80 text-brand-800 ring-1 ring-brand-600'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Employer (Hiring Workflows)
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="access-email" className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address for Early Access
                </label>
                <input
                  id="access-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com or personal email"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full justify-center"
              >
                Notify Me When Access Opens
              </Button>
            </form>
          )}

          <div className="pt-2 text-xs text-slate-500">
            Account registration and login flows will connect directly to the platform upon official release.
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-100 pt-4">
          <Button
            ref={closeButtonRef}
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
