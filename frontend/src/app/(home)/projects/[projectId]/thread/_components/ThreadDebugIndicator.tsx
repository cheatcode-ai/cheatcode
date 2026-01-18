import { useLayout } from '../_contexts/LayoutContext';

export function ThreadDebugIndicator() {
  const { debugMode } = useLayout();

  if (!debugMode) return null;

  return (
    <div className="fixed top-16 right-4 bg-amber-500/10 text-amber-500 text-[10px] font-mono font-medium px-2 py-1 z-50 rounded-md border border-amber-500/20 backdrop-blur-sm">
      Debug Mode
    </div>
  );
}