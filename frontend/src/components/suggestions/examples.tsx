'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Codesandbox,
  TrendingUp,
  Heart,
  Palette,
  DollarSign,
  Activity,
  Flame,
  Timer,
  PiggyBank,
} from 'lucide-react';

type PromptExample = {
  title: string;
  query: string;
  icon: React.ReactNode;
};

const webPrompts: PromptExample[] = [
  {
    title: 'AI startup landing page',
    query: 'build a simple AI startup landing page with hero, features, pricing, and waitlist signup',
    icon: <Codesandbox className="text-purple-400" size={16} />,
  },
  {
    title: 'Creative portfolio website',
    query: 'build a simple creative portfolio website with gallery, case studies, and contact form',
    icon: <Palette className="text-pink-400" size={16} />,
  },
  {
    title: 'Crypto trading dashboard',
    query: 'build a simple crypto trading dashboard with live charts and portfolio view',
    icon: <TrendingUp className="text-orange-400" size={16} />,
  },
  {
    title: 'Personal finance tracker',
    query: 'build a simple personal finance tracker with budgets, expenses, and charts',
    icon: <DollarSign className="text-green-400" size={16} />,
  },
  {
    title: 'Mental wellness app',
    query: 'build a simple mental wellness app with mood tracking, meditation, and journal',
    icon: <Heart className="text-green-400" size={16} />,
  },
];

const mobilePrompts: PromptExample[] = [
  {
    title: 'Run Tracker',
    query: 'build a simple run tracker app with start/stop, distance, and run history',
    icon: <Activity className="text-green-400" size={16} />,
  },
  {
    title: 'Calorie Tracker',
    query: 'build a simple calorie tracker with meals, daily targets, and progress',
    icon: <Flame className="text-orange-400" size={16} />,
  },
  {
    title: 'Pomodoro Timer',
    query: 'build a simple pomodoro timer with work/break cycles and stats',
    icon: <Timer className="text-rose-400" size={16} />,
  },
  {
    title: 'Financial management app',
    query: 'build a simple financial management app with budgets, expenses, and charts',
    icon: <PiggyBank className="text-emerald-400" size={16} />,
  },
  {
    title: 'Stocks management app',
    query: 'build a simple stocks management app with watchlist and portfolio',
    icon: <TrendingUp className="text-sky-400" size={16} />,
  },
];

export const Examples = ({
  onSelectPrompt,
  appType = 'web',
}: {
  onSelectPrompt?: (query: string) => void;
  appType?: 'web' | 'mobile';
}) => {
  const allPrompts = appType === 'mobile' ? mobilePrompts : webPrompts;
  return (
    <div className="w-full max-w-4xl mx-auto px-4">
      <div className="flex gap-2 justify-center py-2 flex-wrap">
        {allPrompts.map((prompt, index) => (
          <motion.div
            key={`${prompt.title}-${index}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.3,
              delay: index * 0.03,
              ease: "easeOut"
            }}
          >
            <Button
              variant="ghost"
              className="w-fit h-fit px-3 py-2 rounded-full border border-neutral-800 !bg-black hover:!bg-neutral-900 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onSelectPrompt && onSelectPrompt(prompt.query)}
            >
              <div className="flex items-center gap-2">
                <div className="flex-shrink-0">
                  {React.cloneElement(prompt.icon as React.ReactElement, { size: 14 })}
                </div>
                <span className="whitespace-nowrap">{prompt.title}</span>
              </div>
            </Button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}; 