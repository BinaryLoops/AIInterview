'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@repo/ui-kit';
import { useAuth } from '../../lib/auth-context';

interface NavbarProps {
  onOpenAccessModal?: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Navbar({ onOpenAccessModal }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand logo & tagline */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="group flex items-center gap-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-700 via-brand-600 to-indigo-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-black tracking-tight text-slate-900 group-hover:text-brand-600 transition-colors">
                AREP
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 -mt-1">
                Interview &amp; Hiring Platform
              </span>
            </div>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a
            href="/#for-candidates"
            className="hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
          >
            For Candidates
          </a>
          <a
            href="/#for-employers"
            className="hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
          >
            For Employers
          </a>
          <a
            href="/#features"
            className="hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
          >
            Features
          </a>
          <a
            href="/#how-it-works"
            className="hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
          >
            How It Works
          </a>
          <a
            href="/#trust"
            className="hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded px-1"
          >
            Fairness &amp; Trust
          </a>
        </nav>

        {/* Desktop Action Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end text-xs">
                <span className="font-semibold text-slate-800">{user?.email}</span>
                <span className="text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.2 rounded border border-brand-200">
                  {user?.roles?.[0] || 'Candidate'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logout()}
                className="text-slate-700 hover:text-rose-600"
              >
                Sign Out
              </Button>
            </div>
          ) : (
            <>
              <Link href="/sign-in">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-700 hover:text-brand-600"
                >
                  Sign In
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button
                  variant="primary"
                  size="sm"
                >
                  Get Started
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-controls="mobile-menu"
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div id="mobile-menu" className="border-b border-slate-200 bg-white px-4 pt-3 pb-5 md:hidden space-y-3">
          <div className="space-y-1">
            <a
              href="/#for-candidates"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              For Candidates
            </a>
            <a
              href="/#for-employers"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              For Employers
            </a>
            <a
              href="/#features"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              Platform Features
            </a>
            <a
              href="/#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              How It Works
            </a>
            <a
              href="/#trust"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600"
            >
              Fairness &amp; Trust
            </a>
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-col gap-2">
            {isAuthenticated ? (
              <div className="flex flex-col gap-2">
                <div className="px-3 py-1.5 text-xs bg-slate-50 rounded-lg">
                  <div className="font-semibold text-slate-800">{user?.email}</div>
                  <div className="text-[10px] uppercase font-bold text-brand-700 mt-0.5">
                    Role: {user?.roles?.[0] || 'Candidate'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="w-full justify-center text-rose-600"
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full"
                >
                  <Button
                    variant="outline"
                    size="md"
                    className="w-full justify-center"
                  >
                    Sign In
                  </Button>
                </Link>
                <Link
                  href="/sign-up"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full"
                >
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full justify-center"
                  >
                    Get Started
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
