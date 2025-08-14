import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { type PipedreamTool, usePipedreamApi } from '@/hooks/react-query/pipedream/utils';
import { toast } from 'sonner';
import type { PipedreamProfile } from '@/types/pipedream-profiles';

interface PipedreamToolSelectorProps {
  appSlug: string;
  profile?: PipedreamProfile;
  onToolsSelected: (selectedTools: string[]) => void;
  initialSelectedTools?: string[];
}

export const PipedreamToolSelector: React.FC<PipedreamToolSelectorProps> = ({
  appSlug,
  profile,
  onToolsSelected,
  initialSelectedTools = []
}) => {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(initialSelectedTools));
  const [isLoading, setIsLoading] = useState(true);
  const [tools, setTools] = useState<PipedreamTool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  
  const pipedreamApi = usePipedreamApi();

  const fetchTools = async () => {
    if (!profile) {
      setError('No profile selected');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Discover MCP servers scoped to this credential profile (uses external_user_id)
      const serversResponse = await pipedreamApi.discoverMCPServersForProfile({
        external_user_id: profile.external_user_id,
        app_slug: appSlug,
      });
      const servers = serversResponse.mcp_servers as any[];
      
      // Find the server for this app
      const server = servers.find(s => s.app_slug === appSlug);
      
      if (!server) {
        setError('App not found in connected servers');
        return;
      }

      if (server.status !== 'connected') {
        setError('App is not properly connected');
        return;
      }

      setTools(server.available_tools || []);
      
    } catch (err: any) {
      console.error('Error fetching tools:', err);
      setError(err.message || 'Failed to load tools');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, [profile?.profile_id, appSlug]);

  const handleToolToggle = (toolName: string) => {
    const newSelected = new Set(selectedTools);
    if (newSelected.has(toolName)) {
      newSelected.delete(toolName);
    } else {
      newSelected.add(toolName);
    }
    setSelectedTools(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTools.size === tools.length) {
      setSelectedTools(new Set());
    } else {
      setSelectedTools(new Set(tools.map(tool => tool.name)));
    }
  };

  const handleConfirm = () => {
    const selectedArray = Array.from(selectedTools);
    if (selectedArray.length === 0) {
      toast.error('Please select at least one tool');
      return;
    }
    onToolsSelected(selectedArray);
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    await fetchTools();
    setIsRetrying(false);
  };

  const handleCancel = () => {
    onToolsSelected([]);
  };

  if (isLoading || isRetrying) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-center">
            <p className="font-medium">Loading available tools...</p>
            <p className="text-sm text-muted-foreground mt-1">
              Fetching tools for {profile?.profile_name || appSlug}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <div className="text-red-500 mb-2 font-medium">Failed to load tools</div>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleRetry} disabled={isRetrying}>
            {isRetrying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Try Again
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // No tools available state
  if (tools.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">🔧</div>
        <h3 className="text-base font-medium mb-2">No tools available</h3>
        <p className="text-sm text-muted-foreground mb-4">
          This app doesn't have any MCP tools available yet.
        </p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleRetry} disabled={isRetrying}>
            {isRetrying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Available Tools</h3>
          <p className="text-sm text-muted-foreground">
            Select tools from {profile?.profile_name} ({tools.length} available)
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
          >
            {selectedTools.size === tools.length ? 'Deselect All' : 'Select All'}
          </Button>
        </div>
      </div>

      {/* Tools List */}
      <div className="max-h-64 overflow-y-auto space-y-2">
        {tools.map((tool) => {
          const isSelected = selectedTools.has(tool.name);
          
          return (
            <Card 
              key={tool.name} 
              className={`p-0 cursor-pointer transition-all duration-200 ${
                isSelected ? 'border-primary bg-primary/5' : 'hover:border-border'
              }`}
              onClick={() => handleToolToggle(tool.name)}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onChange={() => handleToolToggle(tool.name)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-sm">{tool.name}</h4>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {tool.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          {selectedTools.size} of {tools.length} tools selected
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selectedTools.size === 0}>
            <Zap className="h-4 w-4" />
            Add {selectedTools.size} Tool{selectedTools.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}; 