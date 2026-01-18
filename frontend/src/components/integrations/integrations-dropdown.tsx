'use client';

/**
 * IntegrationsDropdown - Reusable dropdown for managing integrations
 * Consolidated from navbar.tsx and thread-site-header.tsx
 */

import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMCPProfilesWithToggle } from '@/hooks/react-query/composio';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button';
import { cn } from '@/lib/utils';
import { threadStyles } from '@/lib/theme/thread-colors';

type TriggerVariant = 'gradient' | 'button' | 'ghost';

interface IntegrationsDropdownProps {
  /**
   * Which trigger style to use
   * - 'gradient': Uses HoverBorderGradient (for homepage navbar)
   * - 'button': Uses regular Button (for thread header)
   * - 'ghost': Uses ghost Button (for transparent thread header)
   */
  triggerVariant?: TriggerVariant;
  /**
   * Whether the dropdown is mounted/enabled
   */
  enabled?: boolean;
}

export function IntegrationsDropdown({
  triggerVariant = 'button',
  enabled = true,
}: IntegrationsDropdownProps) {
  const { mcpProfiles: _mcpProfiles, activeCount, isLoading: _isLoading } = useMCPProfilesWithToggle(enabled);

  const TriggerContent = (
    <>
      <Zap className="w-3 h-3 mr-2 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
      <span className="text-[11px] font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-wider">Integrations</span>
      {activeCount > 0 && (
        <Badge variant="secondary" className="ml-2 h-4 min-w-[16px] px-1 text-[9px] rounded-sm bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono group-hover:border-zinc-600 transition-colors flex items-center justify-center">
          {activeCount}
        </Badge>
      )}
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {triggerVariant === 'gradient' ? (
          <HoverBorderGradient
            containerClassName=""
            className="h-8 flex items-center justify-center text-sm font-normal tracking-wide text-white w-fit px-3"
            duration={2}
          >
            {TriggerContent}
          </HoverBorderGradient>
        ) : triggerVariant === 'ghost' ? (
          <button
            className={cn(
              "h-8 pl-2.5 pr-3 flex items-center justify-center rounded-md transition-all group shadow-sm",
              threadStyles.buttonOutline
            )}
          >
            {TriggerContent}
          </button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-3 text-xs bg-muted hover:bg-muted/80"
          >
            {TriggerContent}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-80 rounded-lg bg-popover shadow-2xl border border-zinc-800 p-0 font-mono"
        align="end"
        sideOffset={8}
      >
        <div className="p-5 space-y-4">
          <div>
            <h4 className="text-xs font-medium text-white uppercase tracking-wide mb-1.5">Integrations</h4>
            <p className="text-[10px] text-zinc-500 leading-normal">
              Connect and enable tools for your dashboard chats.
            </p>
          </div>

          <LiquidMetalButton href="/settings/integrations" className="w-full h-8 no-underline">
            <Zap className="h-3 w-3 text-zinc-300 group-hover:text-white transition-colors" />
            <span className="whitespace-nowrap text-zinc-300 group-hover:text-white transition-colors">MANAGE INTEGRATIONS</span>
          </LiquidMetalButton>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
