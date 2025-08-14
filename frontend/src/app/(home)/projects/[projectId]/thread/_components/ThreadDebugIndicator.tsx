import React from 'react';
import { useLayout } from '../_contexts/LayoutContext';

export function ThreadDebugIndicator() {
  const { debugMode } = useLayout();

  if (!debugMode) return null;

  return (
    <div className="fixed top-16 right-4 bg-amber-500 text-black text-xs px-2 py-1 rounded-md shadow-md z-50">
      Debug Mode
    </div>
  );
}