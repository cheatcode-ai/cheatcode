'use client';

import { motion } from 'motion/react';
import Image from 'next/image';

interface ThreadSkeletonProps {
    isSidePanelOpen?: boolean;
    showHeader?: boolean;
    messageCount?: number;
}

export function ThreadSkeleton({
    isSidePanelOpen: _isSidePanelOpen = false,
    showHeader: _showHeader = true,
    messageCount: _messageCount = 3,
}: ThreadSkeletonProps) {
    return (
        <div className="fixed inset-0 z-50 flex h-screen w-full flex-col items-center justify-center bg-zinc-950 font-mono">
            <div className="relative flex flex-col items-center justify-center">
                {/* Logo with pulsing effect */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="relative z-10"
                >
                    <div className="relative h-20 w-20">
                        <Image
                            src="/cheatcode-symbol.png"
                            alt="Cheatcode"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>
                </motion.div>

                {/* Glow effect behind logo - subtle pulse */}
                <motion.div
                    animate={{
                        scale: [1, 1.2, 1],
                        opacity: [0.1, 0.2, 0.1],
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-40 w-40 rounded-full bg-purple-500/20 blur-[50px]"
                />

                {/* Text */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="mt-8 flex flex-col items-center gap-3"
                >
                    <h2 className="text-lg font-medium text-zinc-200">Spinning up your project</h2>
                    
                    {/* Loading dots */}
                    <div className="flex gap-1.5">
                        {[0, 1, 2].map((i) => (
                            <motion.div
                                key={i}
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{
                                    duration: 1.5,
                                    repeat: Infinity,
                                    delay: i * 0.2,
                                    ease: "easeInOut",
                                }}
                                className="h-1.5 w-1.5 rounded-full bg-purple-500"
                            />
                        ))}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
