import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface ThreadSkeletonProps {
    isSidePanelOpen?: boolean;
    showHeader?: boolean;
    messageCount?: number;
}

export function ThreadSkeleton({
    isSidePanelOpen = false,
    showHeader = true,
    messageCount = 3,
}: ThreadSkeletonProps) {
    return (
        <div className="flex h-screen">
            <div
                className={`flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-in-out`}
            >
                {/* Skeleton Header */}
                {showHeader && (
                    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                        <div className="flex h-14 items-center gap-4 px-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="h-6 w-6 rounded-full" />
                                    <Skeleton className="h-5 w-40" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-8 w-8 rounded-full" />
                                <Skeleton className="h-8 w-8 rounded-full" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Skeleton Chat Messages */}
                <div className="flex-1 overflow-y-auto px-6 py-4 pb-[5.5rem]">
                    <div className="mx-auto max-w-3xl space-y-6">
                        {/* Generate multiple message skeletons based on messageCount */}
                        {Array.from({ length: messageCount }).map((_, index) => (
                            <React.Fragment key={index}>
                                {/* User message - every other message */}
                                {index % 2 === 0 ? (
                                    <div className="flex justify-end">
                                        <div className="max-w-[85%] rounded-lg bg-primary/10 px-4 py-3">
                                            <div className="space-y-2">
                                                <Skeleton className="h-4 w-48" />
                                                <Skeleton className="h-4 w-32" />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* Assistant response with tool usage */
                                    <div>
                                        <div className="flex items-start gap-3">
                                            <Skeleton className="flex-shrink-0 w-5 h-5 mt-2 rounded-full" />
                                            <div className="flex-1 space-y-2">
                                                <div className="max-w-[90%] w-full rounded-lg bg-muted px-4 py-3">
                                                    <div className="space-y-3">
                                                        <div>
                                                            <Skeleton className="h-4 w-full max-w-[360px] mb-2" />
                                                            <Skeleton className="h-4 w-full max-w-[320px] mb-2" />
                                                            <Skeleton className="h-4 w-full max-w-[290px]" />
                                                        </div>

                                                        {/* Tool call button skeleton */}
                                                        {index % 3 === 1 && (
                                                            <div className="py-1">
                                                                <Skeleton className="h-6 w-32 rounded-md" />
                                                            </div>
                                                        )}

                                                        {index % 3 === 1 && (
                                                            <div>
                                                                <Skeleton className="h-4 w-full max-w-[340px] mb-2" />
                                                                <Skeleton className="h-4 w-full max-w-[280px]" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        ))}

                        {/* Assistant thinking state */}
                        <div>
                            <div className="flex items-start gap-3">
                                <Skeleton className="flex-shrink-0 w-5 h-5 mt-2 rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-1.5 py-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-gray-400/50 animate-pulse" />
                                        <div className="h-1.5 w-1.5 rounded-full bg-gray-400/50 animate-pulse delay-150" />
                                        <div className="h-1.5 w-1.5 rounded-full bg-gray-400/50 animate-pulse delay-300" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Skeleton Side Panel (closed state) */}
            {isSidePanelOpen && (
                <div className="hidden sm:block">
                    <div className="h-screen w-[450px] border-l">
                        <div className="p-4">
                            <Skeleton className="h-8 w-32 mb-4" />
                            <Skeleton className="h-20 w-full rounded-md mb-4" />
                            <Skeleton className="h-40 w-full rounded-md" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}