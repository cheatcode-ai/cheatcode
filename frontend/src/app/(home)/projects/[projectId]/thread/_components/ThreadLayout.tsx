import React from 'react';

interface ThreadLayoutProps {
  children: React.ReactNode;
}

// Simplified layout component - just a basic wrapper now
export function ThreadLayout({ children }: ThreadLayoutProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {children}
    </div>
  );
} 
 