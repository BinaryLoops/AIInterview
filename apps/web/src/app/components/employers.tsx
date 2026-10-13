'use client';

import React from 'react';
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@repo/ui-kit';

interface EmployersProps {
  onOpenAccessModal: (title: string, role?: 'candidate' | 'employer') => void;
}

export function Employers({ onOpenAccessModal }: EmployersProps) {
  const employerFeatures = [
    {
      id: 'calibrated-rubrics',
      title: 'Standardized Role Rubrics',
      description:
        'Establish clear, repeatable evaluation criteria calibrated for each engineering level and discipline. Ensure candidates are assessed consistently across all interviewing loops.',
      bullets: [
        'Seniority-specific rubrics from Associate (L3) to Staff/Principal (L6+)',
        'Explicit evaluation dimensions for architecture, state, and edge cases',
        'Customizable competencies aligned with your engineering organization',
      ],
      icon: (
        <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      tag: 'Role Calibration',
    },
    {
      id: 'bias-mitigated',
      title: 'Objective, Bias-Mitigated Screening',
      description:
        'Eliminate subjective impressions and interviewer fatigue. Every candidate receives consistent questioning and objective evaluation based purely on demonstrable skill.',
      bullets: [
        'Standardized conversational prompts with uniform evaluation standards',
        'Transparent scoring criteria that remove pedigree or demographic bias',
        'Auditable scoring matrices for equitable hiring committee decisions',
      ],
      icon: (
        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
        </svg>
      ),
      tag: 'Objective Scoring',
    },
    {
      id: 'candidate-packages',
      title: 'Structured Candidate Summaries',
      description:
        'Receive comprehensive technical dossiers before team on-sites. Review how candidates tackle trade-offs, solve edge cases, and articulate complex concepts.',
      bullets: [
        'Executive summaries with clear competency strengths and areas of caution',
        'Verifiable code execution metrics, test pass rates, and complexity scores',
        'Granular transcripts with annotated interviewer observations',
      ],
      icon: (
        <svg className="h-6 w-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      tag: 'High-Signal Reporting',
    },
    {
      id: 'pipeline-efficiency',
      title: 'Streamlined Interview Pipelines',
      description:
        'Save hundreds of senior engineering hours spent on repetitive first-round screens. Empower your teams to focus their time exclusively on high-signal final interviews.',
      bullets: [
        'Accelerate time-to-decision for active candidate pipelines',
        'Provide consistent candidate experiences regardless of time zone',
        'Deliver prompt, respectful feedback to every applicant automatically',
      ],
      icon: (
        <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tag: 'Hiring Velocity',
    },
  ];

  return (
    <section id="for-employers" className="py-20 sm:py-28 bg-slate-50 border-b border-slate-200/80 scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="neutral" className="uppercase font-semibold tracking-wider text-[11px]">
            For Hiring Teams
          </Badge>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Standardized, Objective Evaluations for Engineering Teams
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-slate-600">
            Reduce screening fatigue and standardize candidate assessments across your organization.
            Evaluate engineers on clear, criteria-based rubrics rather than subjective impressions.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
          {employerFeatures.map((item) => (
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
            onClick={() => onOpenAccessModal('Employer Evaluation Workflows', 'employer')}
          >
            Request Employer Early Access
          </Button>
        </div>
      </div>
    </section>
  );
}
