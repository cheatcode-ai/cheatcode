'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Check, Plus } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useComposioToolkits } from '@/hooks/react-query/composio';
import { useComposioProfiles } from '@/hooks/react-query/composio/use-composio-profiles';
import { ComposioConnectButton } from './composio-connect-button';
import { toast } from 'sonner';
import type { ComposioToolkit } from '@/types/composio-profiles';
import { cn } from '@/lib/utils';

export const ComposioRegistry: React.FC = () => {
  const [search, setSearch] = useState('');
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [selectedToolkit, setSelectedToolkit] = useState<ComposioToolkit | null>(null);

  const { data: toolkitsData, isLoading, refetch } = useComposioToolkits({ search: search || undefined });
  const { data: profiles } = useComposioProfiles();

  const handleSearch = (value: string) => setSearch(value);
  const handleSearchSubmit = (e: React.FormEvent) => { e.preventDefault(); refetch(); };

  const handleConnectToolkit = (toolkit: ComposioToolkit) => {
    setSelectedToolkit(toolkit);
    setShowConnectDialog(true);
  };

  const handleConnectSuccess = () => {
    setShowConnectDialog(false);
    setSelectedToolkit(null);
    toast.success('Connected!');
  };

  const ToolkitCard = ({ toolkit }: { toolkit: ComposioToolkit }) => {
    const isConnected = profiles?.some(p => p.toolkit_slug === toolkit.slug && p.is_active);

    return (
      <button 
        onClick={() => !isConnected && handleConnectToolkit(toolkit)}
        disabled={isConnected}
        className={cn(
            "group flex flex-col items-center p-6 rounded-3xl transition-all duration-300",
            "bg-zinc-900 hover:bg-zinc-800 border border-zinc-800/50 hover:border-zinc-700/50",
            isConnected && "opacity-60 cursor-default"
        )}
      >
        <div className="h-12 w-12 rounded-2xl bg-zinc-900 flex items-center justify-center mb-4 text-lg font-bold text-zinc-500 shadow-sm overflow-hidden">
            {toolkit.icon_url ? (
                <img src={toolkit.icon_url} alt="" className="w-7 h-7 object-contain" />
            ) : (
                toolkit.name.charAt(0)
            )}
        </div>
        
        <div className="text-sm font-medium text-zinc-200 mb-1">{toolkit.name}</div>
        <div className="text-xs text-zinc-600 line-clamp-1">{toolkit.categories[0] || 'Integration'}</div>

        <div className={cn(
            "mt-4 h-8 px-4 rounded-full flex items-center justify-center text-xs font-medium transition-all w-full",
            isConnected 
                ? "bg-emerald-500/10 text-emerald-500" 
                : "bg-zinc-800 text-zinc-400 group-hover:bg-white group-hover:text-black"
        )}>
            {isConnected ? <Check className="w-3 h-3 mr-1.5" /> : <Plus className="w-3 h-3 mr-1.5" />}
            {isConnected ? 'Added' : 'Connect'}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-10">
      <form onSubmit={handleSearchSubmit} className="max-w-md mx-auto">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 h-4 w-4" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-12 pr-12 h-12 bg-zinc-900/50 border-zinc-800/50 rounded-full text-zinc-200 placeholder:text-zinc-600 focus:bg-zinc-900 focus:ring-1 focus:ring-zinc-700 transition-all text-center"
          />
        </div>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-20 text-zinc-600"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {toolkitsData?.toolkits?.map((t: ComposioToolkit) => <ToolkitCard key={t.slug} toolkit={t} />)}
        </div>
      )}

      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-200 sm:max-w-[425px]">
          {selectedToolkit && (
            <ComposioConnectButton
              toolkit={selectedToolkit}
              onSuccess={handleConnectSuccess}
              onCancel={() => setShowConnectDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};