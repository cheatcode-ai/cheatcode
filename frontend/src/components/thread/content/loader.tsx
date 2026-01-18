'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheatcodeLogo } from '@/components/sidebar/cheatcode-logo';

const items = [
    { id: 1, content: "Analyzing architecture..." },
    { id: 2, content: "Synthesizing logic..." },
    { id: 3, content: "Crafting components..." },
    { id: 4, content: "Optimizing structure..." },
    { id: 5, content: "Generating artifacts..." },
    { id: 6, content: "Polishing implementation..." },
  ];

export const AgentLoader = () => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((state) => {
        if (state >= items.length - 1) return 0;
        return state + 1;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex py-2 items-center w-full font-mono">
      <div className="flex items-center justify-center h-4 w-4">
        <CheatcodeLogo size={14} className="text-zinc-500 animate-pulse" />
      </div>
      <div className="relative h-4 ml-3 flex items-center">
            <AnimatePresence mode="wait">
            <motion.div
                key={items[index].id}
                initial={{ y: 5, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -5, opacity: 0 }}
                transition={{ ease: "easeInOut", duration: 0.2 }}
                className="absolute left-0 whitespace-nowrap"
            >
                <div className="text-[11px] text-zinc-500">{items[index].content}</div>
            </motion.div>
            </AnimatePresence>
      </div>
    </div>
  );
};
