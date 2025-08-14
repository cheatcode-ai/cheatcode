'use client';

import { useEffect, useState } from 'react';
import { HeroSection } from '@/components/home/sections/hero-section';
import { ModalProviders } from '@/providers/modal-providers';

export default function Home() {
  return (
    <>
      <ModalProviders />
      <main className="flex flex-col items-center justify-center min-h-screen w-full">
        <div className="w-full">
          <HeroSection />
        </div>
      </main>
    </>
  );
}
