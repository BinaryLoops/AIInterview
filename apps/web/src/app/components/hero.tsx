'use client';

import React, { useState } from 'react';
import { Badge, Button } from '@repo/ui-kit';

interface HeroProps {
  onOpenAccessModal: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Hero({ onOpenAccessModal }: HeroProps) {
  const [activeTab, setActiveTab] = useState<'candidate' | 'employer'>('candidate');

  return (
    <section className="relative overflow-hidden pt-12 pb-16 sm:pt-16 sm:pb-24 lg:pb-28 bg-gradient-to-b from-white via-slate-50 to-slate-100/60 border-b border-slate-200/80">
      {/* Subtle background ambient grid */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-70" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Main hero messaging */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50/90 px-3.5 py-1 text-xs font-semibold text-brand-800 shadow-xs backdrop-blur-xs">
            <span>Intelligent Interview Preparation &amp; Assessment</span>
          </div>

          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl sm:leading-[1.14]">
            Master Technical Interviews.{' '}
            <span className="bg-gradient-to-r from-brand-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Standardize Hiring.
            </span>
          </h1>

          <p className="mt-5 text-base sm:text-lg leading-relaxed text-slate-600">
            AREP helps candidates prepare for real-world engineering interviews through adaptive AI practice
            and tailored roadmaps, while enabling hiring teams to evaluate technical talent through structured,
            bias-free rubrics.
          </p>

          {/* Primary CTA entry points */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#for-candidates">
              <Button variant="primary" size="lg" className="shadow-md shadow-brand-500/15">
                Explore Candidate Prep
              </Button>
            </a>
            <a href="#for-employers">
              <Button variant="outline" size="lg" className="bg-white/90">
                Explore Employer Workflows
              </Button>
            </a>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => onOpenAccessModal('Request Platform Early Access')}
              className="text-slate-700 hover:text-brand-600"
            >
              Request Early Access →
            </Button>
          </div>

          {/* Value highlights */}
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 text-left">
            <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-xs">
              <p className="text-xs font-semibold text-slate-500">Conversational AI</p>
              <p className="text-sm font-bold text-slate-900">Dynamic Follow-Ups</p>
            </div>
            <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-xs">
              <p className="text-xs font-semibold text-slate-500">Coding Practice</p>
              <p className="text-sm font-bold text-slate-900">Multi-Language Tests</p>
            </div>
            <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-xs">
              <p className="text-xs font-semibold text-slate-500">Targeted Feedback</p>
              <p className="text-sm font-bold text-slate-900">Structured Rubrics</p>
            </div>
            <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 shadow-xs">
              <p className="text-xs font-semibold text-slate-500">Hiring Standard</p>
              <p className="text-sm font-bold text-slate-900">Objective Calibration</p>
            </div>
          </div>
        </div>

        {/* Dual-Perspective Product Showcase */}
        <div className="mt-14 scroll-mt-24">
          <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 overflow-hidden">
            {/* Perspective Switcher */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('candidate')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === 'candidate'
                      ? 'bg-white text-brand-700 shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Candidate Practice Experience
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('employer')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === 'employer'
                      ? 'bg-white text-brand-700 shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Employer Evaluation Scorecard
                </button>
              </div>

              <Badge variant="outline" className="hidden sm:inline-flex text-[11px] text-slate-500 border-slate-300">
                Product Interface Preview
              </Badge>
            </div>

            {/* Candidate Practice Content */}
            {activeTab === 'candidate' && (
              <div className="p-5 sm:p-7 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
                        Interactive Mock Interview
                      </span>
                      <Badge variant="neutral">Senior Backend Engineer Track</Badge>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">
                      System Design: High-Throughput Event Ingestion &amp; Idempotency
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    <span>Real-Time Feedback Active</span>
                  </div>
                </div>

                {/* Simulated Conversation Flow */}
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80">
                    <p className="text-xs font-bold text-brand-700">AREP AI Interviewer</p>
                    <p className="mt-1 text-slate-800 leading-relaxed text-xs sm:text-sm">
                      &quot;In your design, you mentioned using Redis to deduplicate webhook events before persisting to the database. How do you handle a scenario where the Redis cluster experiences a failover during high peak load?&quot;
                    </p>
                  </div>

                  <div className="rounded-xl bg-brand-50/40 p-4 border border-brand-200/70">
                    <p className="text-xs font-bold text-slate-900">Your Response (Voice / Text)</p>
                    <p className="mt-1 text-slate-800 leading-relaxed text-xs sm:text-sm">
                      &quot;I treat Redis as a low-latency optimization rather than the single source of truth. At the persistence layer, each event record has a unique idempotency key with an enforced database constraint, ensuring exactly-once processing even during cache partition.&quot;
                    </p>
                  </div>
                </div>

                {/* Rubric Feedback Snippet */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-emerald-200/60">
                    <span className="text-xs font-bold text-emerald-900">
                      Feedback: Failure Domain &amp; State Consistency
                    </span>
                    <span className="text-xs font-bold text-emerald-800 font-mono">Proficient</span>
                  </div>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    Strong demonstration of defense-in-depth principles. You correctly identified that cache failure must not compromise transactional guarantees.
                  </p>
                </div>
              </div>
            )}

            {/* Employer Evaluation Content */}
            {activeTab === 'employer' && (
              <div className="p-5 sm:p-7 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-700">
                        Structured Candidate Scorecard
                      </span>
                      <Badge variant="neutral">Level 5 Technical Screen</Badge>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">
                      Objective Competency Assessment Summary
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="text-xs font-bold">
                      Recommendation: Advance to Panel
                    </Badge>
                  </div>
                </div>

                {/* Competency Matrix */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                    <p className="text-xs font-bold text-slate-700">Problem Decomposition</p>
                    <p className="text-lg font-black text-slate-900 mt-1">Strong</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Broke down ambiguous requirements methodically before choosing technologies.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                    <p className="text-xs font-bold text-slate-700">Trade-Off Analysis</p>
                    <p className="text-lg font-black text-slate-900 mt-1">Consistent</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Proactively discussed latency vs. consistency trade-offs without prompting.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                    <p className="text-xs font-bold text-slate-700">Coding Correctness</p>
                    <p className="text-lg font-black text-slate-900 mt-1">Exemplary</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Passed all test suites including concurrent stress scenarios.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Interviewer Benefit:</span> Replaces unstructured impressions with standardized, reproducible evidence for hiring committees.
                </div>
              </div>
            )}

            {/* Specimen Disclaimer */}
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-xs text-slate-500">
              Representative interface preview. Live accounts will connect directly to candidate and employer portals.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
