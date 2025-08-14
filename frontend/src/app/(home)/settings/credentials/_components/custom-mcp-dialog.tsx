import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Globe, Shield, Loader2 } from 'lucide-react';
import { useCreateCredentialProfile, type CreateCredentialProfileRequest } from '@/hooks/react-query/mcp/use-credential-profiles';
import { toast } from 'sonner';

interface CustomMCPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: any) => void;
}

interface CustomMCPConfig {
  name: string;
  type: 'sse' | 'http' | 'json';
  config: Record<string, string>;
  enabledTools: string[];
}

export function CustomMCPDialog({ open, onOpenChange, onSave }: CustomMCPDialogProps) {
  const [customServerType, setCustomServerType] = useState<'sse' | 'http' | 'json'>('sse');
  const [formData, setFormData] = useState<{
    profile_name: string;
    display_name: string;
    config: Record<string, string>;
    is_default: boolean;
  }>({
    profile_name: '',
    display_name: '',
    config: {},
    is_default: false
  });

  const createProfileMutation = useCreateCredentialProfile();

  useEffect(() => {
    if (open) {
      setCustomServerType('sse');
      setFormData({ 
        profile_name: '', 
        display_name: '', 
        config: {},
        is_default: false
      });
    }
  }, [open]);

  const handleConfigChange = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };

  const handleSubmit = async () => {
    try {
      const qualifiedName = `custom_${customServerType}_${formData.display_name.toLowerCase().replace(/\s+/g, '_')}`;
      
      const config: CustomMCPConfig = {
        name: formData.display_name,
        type: customServerType,
        config: formData.config,
        enabledTools: [] // Will be populated later
      };

      // Call the onSave prop with the configuration
      await onSave(config);
      
    } catch (error: any) {
      toast.error(error.message || 'Failed to create custom MCP connection');
    }
  };

  const isFormValid = () => {
    if (!formData.profile_name.trim() || !formData.display_name.trim()) {
      return false;
    }
    
    if (customServerType === 'json') {
      return !!formData.config.command;
    } else {
      return !!formData.config.url;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Custom MCP Connection</DialogTitle>
          <DialogDescription>
            Configure your own custom MCP server connection for use in dashboard chats
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto flex-1 px-1">
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
            <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
              <Globe className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-medium">Custom MCP Server</h3>
              <p className="text-sm text-muted-foreground">Configure your own MCP server connection</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom_profile_name">Profile Name *</Label>
                <Input
                  id="custom_profile_name"
                  value={formData.profile_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, profile_name: e.target.value }))}
                  placeholder="Enter a profile name (e.g., 'My Custom Server')"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom_display_name">Display Name *</Label>
                <Input
                  id="custom_display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
                  placeholder="Enter a display name for this server"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="server_type">Server Type *</Label>
              <Select value={customServerType} onValueChange={(value: 'sse' | 'http' | 'json') => setCustomServerType(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select server type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="json">JSON/stdio</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose the connection type for your MCP server
              </p>
            </div>

            {customServerType === 'json' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="server_command">Command *</Label>
                  <Input
                    id="server_command"
                    value={formData.config.command || ''}
                    onChange={(e) => handleConfigChange('command', e.target.value)}
                    placeholder="Enter the command to start your MCP server (e.g., 'node server.js')"
                  />
                  <p className="text-xs text-muted-foreground">
                    The command to execute your MCP server
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server_args">Arguments (optional)</Label>
                  <Input
                    id="server_args"
                    value={formData.config.args || ''}
                    onChange={(e) => handleConfigChange('args', e.target.value)}
                    placeholder="Enter command arguments (comma-separated)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Additional arguments for the command (separated by commas)
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="server_url">Server URL *</Label>
                <Input
                  id="server_url"
                  type="url"
                  value={formData.config.url || ''}
                  onChange={(e) => handleConfigChange('url', e.target.value)}
                  placeholder={`Enter your ${customServerType.toUpperCase()} server URL`}
                />
                <p className="text-xs text-muted-foreground">
                  The URL to your custom MCP server endpoint
                </p>
              </div>
            )}

            <Alert>
              <Globe className="h-4 w-4" />
              <AlertDescription>
                This will create a custom MCP server profile that you can use in your agents. 
                Make sure your server is accessible and properly configured.
              </AlertDescription>
            </Alert>

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                Your server configuration will be encrypted and stored securely. You can create multiple profiles for different custom servers.
              </AlertDescription>
            </Alert>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!isFormValid() || createProfileMutation.isPending}
          >
            {createProfileMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              'Create Connection'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 