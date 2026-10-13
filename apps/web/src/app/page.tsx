'use client';

import React, { useState } from 'react';
import { Navbar } from './components/navbar';
import { Hero } from './components/hero';
import { Candidates } from './components/candidates';
import { Employers } from './components/employers';
import { Features } from './components/features';
import { HowItWorks } from './components/how-it-works';
import { Trust } from './components/trust';
import { Cta } from './components/cta';
import { Footer } from './components/footer';
import { AccessModal } from './components/access-modal';

export default function LandingPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('Platform Early Access');
  const [modalRole, setModalRole] = useState<'candidate' | 'employer'>('candidate');

  const handleOpenModal = (title: string, role: 'candidate' | 'employer' = 'candidate') => {
    setModalTitle(title);
    setModalRole(role);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Accessible skip link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Navigation Header */}
      <Navbar onOpenAccessModal={handleOpenModal} />

      {/* Main Content Landmark */}
      <main id="main-content" className="flex-1">
        <Hero onOpenAccessModal={handleOpenModal} />
        <Candidates onOpenAccessModal={handleOpenModal} />
        <Employers onOpenAccessModal={handleOpenModal} />
        <Features />
        <HowItWorks />
        <Trust />
        <Cta onOpenAccessModal={handleOpenModal} />
      </main>

      {/* Footer */}
      <Footer onOpenAccessModal={handleOpenModal} />

      {/* Early Access & Transparency Modal */}
      <AccessModal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        title={modalTitle}
        defaultRole={modalRole}
      />
    </div>
  );
}
