'use client';

import React from 'react';
import { Badge } from '@repo/ui-kit';

export function HowItWorks() {
  const steps = [
    {
      step: '01',
      title: 'Select Role & Focus',
      subtitle: 'Targeted preparation tracks',
      description:
        'Choose your engineering specialization (e.g., Backend, Frontend, Distributed Systems) and target seniority level. AREP tailors questions and evaluation criteria to your specific target.',
    },
    {
      step: '02',
      title: 'Practice in Real Time',
      subtitle: 'Conversational & coding challenges',
      description:
        'Participate in dynamic technical screens. The AI interviewer actively engages with your explanations, probes your architectural decisions, and evaluates code logic against realistic scenarios.',
    },
    {
      step: '03',
      title: 'Review Structured Insights',
      subtitle: 'Criteria-based feedback',
      description:
        'Examine detailed feedback after each session. Understand your performance across system design reasoning, code efficiency, edge-case coverage, and technical communication.',
    },
    {
      step: '04',
      title: 'Iterate & Track Progress',
      subtitle: 'Personalized practice roadmaps',
      description:
        'Close conceptual blind spots with recommended drills and exercises. Monitor your readiness trajectory over time so you know when you are fully prepared for real interviews.',
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-28 bg-slate-50 border-b border-slate-200/80 scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="neutral" className="uppercase font-semibold tracking-wider text-[11px]">
            Platform Process
          </Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            How AREP Works
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">
            A simple, structured workflow designed to turn practice into measurable interview confidence
            and enable hiring teams to assess candidates fairly.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((item) => (
            <div
              key={item.step}
              className="relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <span className="font-mono text-2xl font-black text-brand-600">
                    {item.step}
                  </span>
                  <Badge variant="outline" className="text-[10px] text-slate-500 font-mono">
                    Step {item.step}
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900 leading-snug">
                  {item.title}
                </h3>
                <p className="text-xs font-semibold text-brand-700 mt-1">
                  {item.subtitle}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>Structured</span>
                <span className="text-emerald-600 font-semibold">✓ Actionable</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
