'use client';

import React from 'react';
import { Badge } from '@repo/ui-kit';

export function Trust() {
  const principles = [
    {
      title: 'Objective Evaluation Criteria',
      description:
        'Every candidate assessment is anchored in explicit competency rubrics rather than arbitrary impressions. Technical problem-solving, architectural trade-offs, and communication are evaluated uniformly.',
      icon: (
        <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: 'Candidate Privacy & Data Ownership',
      description:
        'Your preparation data belongs to you. Candidate practice sessions, transcripts, and personal roadmaps are strictly private and never shared with employers without explicit candidate consent.',
      icon: (
        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    {
      title: 'Calibrated Industry Standards',
      description:
        'Practice questions and evaluation rubrics reflect real-world engineering responsibilities. Benchmarks are tailored to seniority levels, helping engineers prepare for genuine interview panel expectations.',
      icon: (
        <svg className="h-6 w-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="trust" className="py-20 sm:py-28 bg-white border-b border-slate-200/80 scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="neutral" className="uppercase font-semibold tracking-wider text-[11px]">
            Trust &amp; Principles
          </Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Built for Fairness, Transparency, and Trust
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">
            We believe technical interviews and candidate evaluations must be objective, equitable,
            and respectful of everyone&apos;s time.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8">
          {principles.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-50 p-3 shadow-xs mb-4">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold text-slate-900 leading-snug">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Commitment Banner */}
        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center sm:text-left">
            <h4 className="text-base font-bold text-slate-900">
              Our Core Commitment to Fair Hiring
            </h4>
            <p className="text-sm text-slate-600">
              AREP aims to eliminate bias from technical recruiting while helping every engineer reach their full potential.
            </p>
          </div>
          <div className="shrink-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Criteria-Based Evaluation
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
