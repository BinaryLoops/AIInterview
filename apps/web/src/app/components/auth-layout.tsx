import React from 'react';
import Link from 'next/link';

interface AuthLayoutProps {
  children: React.ReactNode;
  heading: string;
  subheading: string;
}

export function AuthLayout({ children, heading, subheading }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 text-slate-900">
      {/* Top mini-bar */}
      <header className="border-b border-slate-200/80 bg-white px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-brand-700 via-brand-600 to-indigo-600 text-white font-bold text-sm shadow-xs">
              A
            </div>
            <div className="flex flex-col">
              <span className="text-base font-black tracking-tight text-slate-900">AREP</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 -mt-1">
                Interview Platform
              </span>
            </div>
          </Link>

          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-2 py-1 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Home</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center py-10 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left panel: Product Value Proposition (visible on lg+) */}
          <div className="hidden lg:flex lg:col-span-5 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-8 shadow-xs">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
                <span>Next-Gen Technical Interviewing</span>
              </div>

              <h2 className="mt-6 text-2xl font-bold tracking-tight text-slate-900 leading-snug">
                Prepare with Realism. Evaluate with Objectivity.
              </h2>

              <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                AREP is built for software engineers preparing for high-stakes interviews and engineering teams seeking structured, bias-free candidate evaluations.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-brand-50 p-1.5 text-brand-600">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Adaptive Mock Interviews</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Multi-turn dialogues that probe trade-offs and edge cases.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-indigo-50 p-1.5 text-indigo-600">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Live Coding Assessments</h3>
                    <p className="text-xs text-slate-500 mt-0.5">In-browser execution with comprehensive test harnesses.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-emerald-50 p-1.5 text-emerald-600">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Criteria-Based Rubrics</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Objective scoring matrices eliminating reviewer bias.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Privacy &amp; Data Protected</span>
              <span className="font-semibold text-brand-700">Enterprise Standards</span>
            </div>
          </div>

          {/* Right panel: Form Card */}
          <div className="lg:col-span-7 w-full max-w-xl mx-auto">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{heading}</h1>
                <p className="mt-1.5 text-sm text-slate-600">{subheading}</p>
              </div>

              {children}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
        <p>© {new Date().getFullYear()} AREP Platform. All rights reserved.</p>
      </footer>
    </div>
  );
}
