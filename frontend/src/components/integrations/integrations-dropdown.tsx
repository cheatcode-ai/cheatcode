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

type TriggerVariant = 'gradient' | 'button';

interface IntegrationsDropdownProps {
  /**
   * Which trigger style to use
   * - 'gradient': Uses HoverBorderGradient (for homepage navbar)
   * - 'button': Uses regular Button (for thread header)
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
  const { mcpProfiles, activeCount, isLoading } = useMCPProfilesWithToggle(enabled);

  const TriggerContent = (
    <>
      <Zap className="w-3 h-3 mr-1.5 text-green-400" />
      Integrations
      {activeCount > 0 && (
        <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-xs">
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
        className="w-80 rounded-2xl ring-1 ring-white/10 bg-gray-950/95 backdrop-blur-md shadow-xl border-0 p-0"
        align="end"
        sideOffset={8}
      >
        <div className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Integrations</h4>
          <p className="text-sm text-muted-foreground">
            Connect and enable tools for your dashboard chats. Manage all integrations in settings.
          </p>

          <Button asChild className="w-full h-9 bg-white text-black hover:bg-white/90">
            <a href="/settings/integrations" className="flex items-center justify-center gap-2">
              <Zap className="h-4 w-4 text-green-500" />
              Manage Integrations
            </a>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
