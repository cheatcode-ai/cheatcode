'use client';

/**
 * Composio Tool Selector - Select which tools to enable for a profile.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Loader2, CheckCircle, Circle } from 'lucide-react';
import { useComposioTools, useUpdateComposioEnabledTools } from '@/hooks/react-query/composio';
import { toast } from 'sonner';
import type { ComposioProfile } from '@/types/composio-profiles';

interface ComposioToolSelectorProps {
  toolkitSlug: string;
  profile: ComposioProfile | null;
  onToolsSelected: (selectedTools: string[]) => void;
}

export const ComposioToolSelector: React.FC<ComposioToolSelectorProps> = ({
  toolkitSlug,
  profile,
  onToolsSelected,
}) => {
  const [search, setSearch] = useState('');
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const { data: tools, isLoading, error } = useComposioTools(toolkitSlug, !!toolkitSlug);
  const updateEnabledTools = useUpdateComposioEnabledTools();

  // Initialize selected tools from profile
  useEffect(() => {
    if (profile?.enabled_tools) {
      setSelectedTools(new Set(profile.enabled_tools));
    }
  }, [profile]);

  // Update select all state based on selections
  useEffect(() => {
    if (tools && tools.length > 0) {
      setSelectAll(selectedTools.size === tools.length);
    }
  }, [selectedTools, tools]);

  const filteredTools =
    tools?.filter(
      (tool) =>
        tool.name.toLowerCase().includes(search.toLowerCase()) ||
        (tool.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
    ) || [];

  const handleToggleTool = (toolName: string) => {
    setSelectedTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolName)) {
        newSet.delete(toolName);
      } else {
        newSet.add(toolName);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedTools(new Set());
    } else {
      setSelectedTools(new Set(tools?.map((t) => t.name) || []));
    }
    setSelectAll(!selectAll);
  };

  const handleConfirm = async () => {
    const selectedArray = Array.from(selectedTools);

    if (profile) {
      try {
        await updateEnabledTools.mutateAsync({
          profileId: profile.profile_id,
          enabledTools: selectedArray,
        });
        onToolsSelected(selectedArray);
      } catch (error) {
        toast.error('Failed to update tools');
      }
    } else {
      onToolsSelected(selectedArray);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading tools...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-2">Failed to load tools</div>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Select All */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleSelectAll}>
          {selectAll ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      {/* Selected count */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {selectedTools.size} of {tools?.length || 0} tools selected
        </span>
        {selectedTools.size > 0 && (
          <Badge variant="secondary" className="text-xs">
            {selectedTools.size} selected
          </Badge>
        )}
      </div>

      {/* Tools List */}
      <ScrollArea className="h-[400px] rounded-md border">
        <div className="p-4 space-y-2">
          {filteredTools.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {search ? 'No tools match your search' : 'No tools available'}
            </div>
          ) : (
            filteredTools.map((tool) => (
              <div
                key={tool.name}
                onClick={() => handleToggleTool(tool.name)}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedTools.has(tool.name)
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="pt-0.5">
                  {selectedTools.has(tool.name) ? (
                    <CheckCircle className="h-5 w-5 text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{tool.name}</div>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {tool.description}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Confirm Button */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button variant="outline" onClick={() => onToolsSelected([])}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={selectedTools.size === 0 || updateEnabledTools.isPending}
        >
          {updateEnabledTools.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            `Enable ${selectedTools.size} Tools`
          )}
        </Button>
      </div>
    </div>
  );
};
