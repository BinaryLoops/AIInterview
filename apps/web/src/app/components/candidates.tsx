'use client';

import React from 'react';
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@repo/ui-kit';

interface CandidatesProps {
  onOpenAccessModal: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Candidates({ onOpenAccessModal }: CandidatesProps) {
  const candidateFeatures = [
    {
      id: 'conversational-prep',
      title: 'Adaptive Multi-Turn Practice',
      description:
        'Engage in dynamic conversational technical screens. The AI interviewer actively listens to your explanations, probes your architectural trade-offs, and asks relevant follow-up questions.',
      bullets: [
        'Dynamic follow-up questions tailored to your spoken or written answers',
        'Realistic behavioral interviews aligned with structured S.T.A.R. criteria',
        'Scenarios for systems design, distributed architectures, and API design',
      ],
      icon: (
        <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
      tag: 'Interview Simulation',
    },
    {
      id: 'coding-assessment',
      title: 'Interactive Code Assessments',
      description:
        'Write, execute, and profile your algorithmic solutions in a clean browser editor. Test your logic against public and hidden boundary cases.',
      bullets: [
        'Multi-language support including TypeScript, Python, Go, Java, and C++',
        'Automated test suites evaluating correctness and edge cases',
        'Empirical time and space complexity feedback on your solution',
      ],
      icon: (
        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      tag: 'Practical Coding',
    },
    {
      id: 'personalized-roadmaps',
      title: 'Personalized Preparation Roadmaps',
      description:
        'Stop guessing what to study next. AREP analyzes your mock interview results to identify conceptual blind spots and recommend targeted study modules.',
      bullets: [
        'Skill progression trees mapped to specific seniority levels (Junior to Staff)',
        'Targeted drill recommendations focusing on your identified growth areas',
        'Milestone tracking to measure your readiness trajectory before real interviews',
      ],
      icon: (
        <svg className="h-6 w-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
      tag: 'Adaptive Learning',
    },
    {
      id: 'actionable-insights',
      title: 'Objective Performance Insights',
      description:
        'Receive clear, criteria-based evaluation summaries after each session. Understand how interviewers evaluate your technical depth, structure, and communication.',
      bullets: [
        'Detailed breakdowns across design reasoning, code rigor, and articulation',
        'Line-by-line feedback highlighting what went well and where to improve',
        'Consistent scoring rubrics aligned with top tech hiring standards',
      ],
      icon: (
        <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tag: 'Targeted Feedback',
    },
  ];

  return (
    <section id="for-candidates" className="py-20 sm:py-28 bg-white border-b border-slate-200/80 scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="neutral" className="uppercase font-semibold tracking-wider text-[11px]">
            Candidate Preparation
          </Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Everything You Need to Interview with Confidence
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">
            Go beyond memorizing static interview questions. Practice with dynamic, conversational sessions
            that simulate real engineering panels, pinpoint your weak spots, and accelerate your preparation.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
          {candidateFeatures.map((item) => (
            <Card
              key={item.id}
              className="group border border-slate-200/90 hover:border-brand-300 hover:shadow-lg transition-all duration-200 bg-white"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5 shadow-xs group-hover:bg-brand-50/50 group-hover:border-brand-200 transition-colors">
                    {item.icon}
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-slate-500">
                    {item.tag}
                  </Badge>
                </div>
                <CardTitle className="text-xl font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                  {item.title}
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 leading-relaxed mt-2">
                  {item.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-2 border-t border-slate-100">
                <ul className="space-y-2 text-xs text-slate-700">
                  {item.bullets.map((bullet, idx) => (
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

        <div className="mt-12 text-center">
          <Button
            variant="primary"
            size="md"
            onClick={() => onOpenAccessModal('Candidate Interview Preparation', 'candidate')}
          >
            Request Candidate Early Access
          </Button>
        </div>
      </div>
    </section>
  );
}
