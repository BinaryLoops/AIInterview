'use client';

import React from 'react';
import { Button } from '@repo/ui-kit';

interface CtaProps {
  onOpenAccessModal: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Cta({ onOpenAccessModal }: CtaProps) {
  return (
    <section className="py-20 sm:py-28 bg-slate-900 text-white relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="mx-auto max-w-3xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/80 px-3.5 py-1 text-xs font-semibold text-slate-300">
            <span>Join the Next Generation of Technical Interviewing</span>
          </div>

          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            Ready to Take the Guesswork Out of Technical Interviews?
          </h2>

          <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto">
            Experience structured practice that builds genuine confidence, or introduce consistent,
            high-signal evaluation to your hiring team.
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Button
              variant="primary"
              size="lg"
              onClick={() => onOpenAccessModal('Candidate Interview Preparation', 'candidate')}
              className="bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-500/20"
            >
              Get Started as Candidate
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => onOpenAccessModal('Employer Evaluation Workflows', 'employer')}
              className="border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              Get Started as Employer
            </Button>
          </div>

          <p className="text-xs text-slate-400 pt-2">
            Private preview active. Onboarding invites are sent as platform batches expand.
          </p>
        </div>
      </div>
    </section>
  );
}
