'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Zap } from 'lucide-react';
import { usePipedreamApi, PipedreamApp } from '@/hooks/react-query/pipedream/utils';

interface PipedreamAppBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectApp: (app: { app_slug: string; app_name: string }) => void;
}

export const PipedreamAppBrowser: React.FC<PipedreamAppBrowserProps> = ({
  open,
  onOpenChange,
  onSelectApp,
}) => {
  const [apps, setApps] = useState<PipedreamApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  const pipedreamApi = usePipedreamApi();

  useEffect(() => {
    if (open) {
      loadApps();
    }
  }, [open]);

  const loadApps = async () => {
    setLoading(true);
    try {
      const response = await pipedreamApi.getApps();
      if (response.success) {
        setApps(response.apps);
      }
    } catch (error) {
      console.error('Failed to load apps:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredApps = apps.filter(app => {
    const matchesSearch = !searchQuery || 
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = !selectedCategory || 
      app.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(
    new Set(apps.map(app => app.category).filter(Boolean))
  ).sort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Select an App to Connect</DialogTitle>
          <DialogDescription>
            Choose an app to create a credential profile for
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <form onSubmit={(e) => {e.preventDefault()}} className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search apps... (e.g., Gmail, Slack, Notion)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
              {searchQuery && (
                <Button 
                  type="submit" 
                  size="sm" 
                  variant="ghost" 
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 px-2"
                >
                  Search
                </Button>
              )}
            </form>
            {selectedCategory && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCategory(null)}
              >
                Clear filter
              </Button>
            )}
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map(category => (
                <Badge
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedCategory(
                    selectedCategory === category ? null : category
                  )}
                >
                  {category}
                </Badge>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pr-4">
                {filteredApps.map(app => (
                  <Button
                    key={app.id}
                    variant="outline"
                    className="h-auto p-4 justify-start"
                    onClick={() => {
                      // Prefer human-readable slug for the backend. Fallback to id if none present.
                      const slug = (app as any).name_slug ?? (app as any).slug ?? app.id;
                      onSelectApp({
                        app_slug: slug,
                        app_name: app.name
                      });
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex items-center gap-3 w-full">
                      {app.logo_url ? (
                        <img
                          src={app.logo_url}
                          alt={app.name}
                          className="w-8 h-8 rounded"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              const icon = document.createElement('div');
                              icon.className = 'w-8 h-8 rounded bg-primary/10 flex items-center justify-center';
                              icon.innerHTML = '<svg class="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14l9 9 10-12-9-9z"/></svg>';
                              parent.insertBefore(icon, target);
                            }
                          }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                          <Zap className="w-4 h-4 text-primary" />
                        </div>
                      )}
                      <div className="text-left flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{app.name}</div>
                        {app.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {app.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
              {filteredApps.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No apps found matching your search
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}; 