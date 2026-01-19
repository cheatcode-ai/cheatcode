'use client';

import React from 'react';
import { motion } from 'motion/react';
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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.3,
              delay: index * 0.03,
              ease: "easeOut"
            }}
          >
            <button
              className="w-fit h-fit px-4 py-2.5 rounded-none border border-white/5 bg-[#09090b] shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-[#121212] hover:border-white/10 text-[11px] font-mono font-medium tracking-wider text-zinc-400 hover:text-white transition-all cursor-pointer group"
              onClick={() => onSelectPrompt && onSelectPrompt(prompt.query)}
            >
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-all duration-300 grayscale group-hover:grayscale-0 scale-90 group-hover:scale-100">
                  {prompt.icon}
                </div>
                <span className="whitespace-nowrap uppercase">{prompt.title}</span>
              </div>
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}; 