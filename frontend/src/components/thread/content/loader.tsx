import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CircleDotDashed } from 'lucide-react';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';

const items = [
    { id: 1, content: "Initializing AI with questionable confidence..." },
    { id: 2, content: "Parsing your request (third attempt)..." },
    { id: 3, content: "Loading knowledge base... mostly Wikipedia..." },
    { id: 4, content: "Activating reasoning engine (results may vary)..." },
    { id: 5, content: "Building context map with shaky hands..." },
    { id: 6, content: "Configuring response model to sound smart..." },
    { id: 7, content: "Running inference pipeline on hopes and dreams..." },
    { id: 8, content: "Analyzing code patterns I pretend to understand..." },
    { id: 9, content: "Planning solution architecture (fingers crossed)..." },
    { id: 10, content: "Optimizing for 'it works on my machine'..." },
    { id: 11, content: "Synchronizing data flows and my anxiety..." },
    { id: 12, content: "Compiling intelligent output (emphasis on trying)..." },
    { id: 13, content: "Refining predictions with educated guesses..." },
    { id: 14, content: "Structuring response to hide my confusion..." },
    { id: 15, content: "Validating logic with rubber duck debugging..." },
    { id: 16, content: "Finalizing recommendations (please work)..." }
  ];

export const AgentLoader = () => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((state) => {
        if (state >= items.length - 1) return 0;
        return state + 1;
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex py-2 items-center w-full">
      <CircleDotDashed className="h-4 w-4 text-muted-foreground animate-spin" />
            <AnimatePresence>
            <motion.div
                key={items[index].id}
                initial={{ y: 20, opacity: 0, filter: "blur(8px)" }}
                animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: -20, opacity: 0, filter: "blur(8px)" }}
                transition={{ ease: "easeInOut" }}
                style={{ position: "absolute" }}
                className='ml-7'
            >
                <AnimatedShinyText className="text-sm">{items[index].content}</AnimatedShinyText>
            </motion.div>
            </AnimatePresence>
        </div>
  );
};
