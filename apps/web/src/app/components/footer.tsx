'use client';

import React from 'react';
import Link from 'next/link';

interface FooterProps {
  onOpenAccessModal?: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Footer({ onOpenAccessModal }: FooterProps) {
  return (
    <footer className="border-t border-slate-200 bg-white text-slate-600 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-12 border-b border-slate-200">
          {/* Brand Col */}
          <div className="space-y-4 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm">
                A
              </div>
              <span className="text-xl font-black text-slate-900 tracking-tight">AREP</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              AI Interview Preparation &amp; Hiring Platform. Empowering candidates with realistic practice
              and enabling hiring teams with structured, objective talent evaluation.
            </p>
          </div>

          {/* Product links */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              For Candidates
            </p>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="/#for-candidates" className="hover:text-brand-600 transition-colors">
                  Conversational Practice
                </a>
              </li>
              <li>
                <a href="/#for-candidates" className="hover:text-brand-600 transition-colors">
                  In-Browser Coding
                </a>
              </li>
              <li>
                <a href="/#for-candidates" className="hover:text-brand-600 transition-colors">
                  Personalized Roadmaps
                </a>
              </li>
              <li>
                <Link href="/sign-up" className="hover:text-brand-600 transition-colors font-medium">
                  Create Candidate Account
                </Link>
              </li>
              <li>
                <Link href="/sign-in" className="hover:text-brand-600 transition-colors font-medium">
                  Candidate Sign In
                </Link>
              </li>
            </ul>
          </div>

          {/* Employer links */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              For Employers
            </p>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="/#for-employers" className="hover:text-brand-600 transition-colors">
                  Structured Role Rubrics
                </a>
              </li>
              <li>
                <a href="/#for-employers" className="hover:text-brand-600 transition-colors">
                  Objective Assessments
                </a>
              </li>
              <li>
                <a href="/#for-employers" className="hover:text-brand-600 transition-colors">
                  Candidate Dossiers
                </a>
              </li>
              <li>
                <Link href="/sign-up" className="hover:text-brand-600 transition-colors font-medium">
                  Employer Registration
                </Link>
              </li>
            </ul>
          </div>

          {/* Platform Standards */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Platform &amp; Trust
            </p>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="/#features" className="hover:text-brand-600 transition-colors">
                  Platform Features
                </a>
              </li>
              <li>
                <a href="/#how-it-works" className="hover:text-brand-600 transition-colors">
                  How AREP Works
                </a>
              </li>
              <li>
                <a href="/#trust" className="hover:text-brand-600 transition-colors">
                  Evaluation Fairness &amp; Privacy
                </a>
              </li>
              <li>
                <Link href="/forgot-password" className="hover:text-brand-600 transition-colors">
                  Password Reset Support
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} AREP Platform. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span>Privacy &amp; Data Protection</span>
            <span>Terms of Service</span>
            <span>Accessibility</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
