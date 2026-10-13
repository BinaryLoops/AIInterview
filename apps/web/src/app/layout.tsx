import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth-context';

export const metadata: Metadata = {
  title: 'AREP — AI Interview Preparation & Hiring Platform',
  description:
    'Master engineering interviews with adaptive AI practice and personalized study roadmaps. Standardize technical hiring with structured, objective candidate evaluation rubrics.',
  keywords: [
    'AI interview practice',
    'coding assessments',
    'technical interview prep',
    'hiring evaluation',
    'candidate rubrics',
    'engineering interviews',
  ],
  authors: [{ name: 'AREP Platform' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900 antialiased selection:bg-brand-500 selection:text-white">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
