'use client';

import React from 'react';
import { Badge, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@repo/ui-kit';

export function Features() {
  const featureList = [
    {
      id: 'mock-interviews',
      title: 'Conversational Interview Practice',
      description:
        'Practice with realistic, multi-turn AI dialogues that mirror modern engineering interviews. The interviewer asks follow-ups, explores your reasoning, and tests edge-case awareness.',
      bullets: [
        'Dynamic follow-ups that challenge your architecture choices',
        'Structured behavioral prompts aligned with standard industry rubrics',
        'Scenarios covering distributed systems, web architectures, and algorithms',
      ],
      icon: (
        <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      tag: 'Adaptive Practice',
    },
    {
      id: 'coding-eval',
      title: 'Real-Time Coding Assessments',
      description:
        'Solve algorithmic, systems, and debugging challenges directly in your browser. Verify your solutions against comprehensive test suites and complexity metrics.',
      bullets: [
        'Support for TypeScript, Python, Go, Java, and C++',
        'Automated test suites evaluating correctness and boundary conditions',
        'Practical feedback on execution efficiency and algorithmic complexity',
      ],
      icon: (
        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      tag: 'Live Coding',
    },
    {
      id: 'adaptive-roadmaps',
      title: 'Personalized Study Roadmaps',
      description:
        'Turn practice results into focused preparation plans. AREP pinpoints your specific conceptual weak points and recommends high-yield drills to accelerate your progress.',
      bullets: [
        'Clear skill roadmaps aligned with engineering levels from Junior to Staff',
        'Curated drill recommendations addressing your identified blind spots',
        'Measurable readiness tracking to build confidence ahead of real loops',
      ],
      icon: (
        <svg className="h-6 w-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
      tag: 'Targeted Prep',
    },
    {
      id: 'objective-rubrics',
      title: 'Criteria-Based Evaluation Rubrics',
      description:
        'Ensure fairness and clarity with structured competency models. Both candidates and hiring teams benefit from reproducible, criteria-driven scoring matrices.',
      bullets: [
        'Multi-dimensional scoring across design, implementation, and communication',
        'Level-calibrated benchmarks providing realistic readiness feedback',
        'Consistent evaluation criteria eliminating subjective reviewer bias',
      ],
      icon: (
        <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      tag: 'Fair Evaluation',
    },
  ];

  return (
    <section id="features" className="py-20 sm:py-28 bg-white border-b border-slate-200/80 scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="neutral" className="uppercase font-semibold tracking-wider text-[11px]">
            Platform Features
          </Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            A Complete Platform for Technical Interview Success
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">
            AREP connects realistic candidate preparation with objective hiring evaluation,
            creating a shared standard for technical excellence and fairness.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
          {featureList.map((feature) => (
            <Card
              key={feature.id}
              className="group border border-slate-200/90 hover:border-brand-300 hover:shadow-lg transition-all duration-200 bg-white"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5 shadow-xs group-hover:bg-brand-50/50 group-hover:border-brand-200 transition-colors">
                    {feature.icon}
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-slate-500">
                    {feature.tag}
                  </Badge>
                </div>
                <CardTitle className="text-xl font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                  {feature.title}
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 leading-relaxed mt-2">
                  {feature.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-2 border-t border-slate-100">
                <ul className="space-y-2 text-xs text-slate-700">
                  {feature.bullets.map((bullet, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">
                        ✓
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
