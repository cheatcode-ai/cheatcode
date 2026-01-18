'use client';

import { useState, memo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ComposioRegistry } from './composio-registry';
import { useComposioProfiles, useUpdateCompositoDashboardDefault, useDeleteComposioProfile } from '@/hooks/react-query/composio';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'motion/react';

function CompositoDashboardManagerComponent() {
  const [activeTab, setActiveTab] = useState<'Browse' | 'Connected'>('Browse');
  const { data: profiles = [], isLoading } = useComposioProfiles();
  const updateDashboardDefault = useUpdateCompositoDashboardDefault();
  const deleteProfile = useDeleteComposioProfile();

  const handleToggle = async (profileId: string, currentValue: boolean) => {
    try {
      await updateDashboardDefault.mutateAsync({ profileId, enabled: !currentValue });
      toast.success('Updated');
    } catch { toast.error('Failed'); }
  };

  const handleDelete = async (profileId: string) => {
    try {
        await deleteProfile.mutateAsync(profileId);
    } catch { toast.error('Failed'); }
  };

  if (isLoading) return <div className="p-12"><Skeleton className="h-12 w-full max-w-lg mx-auto bg-zinc-900" /></div>;

  return (
    <div className="text-zinc-200">
      <div className="max-w-5xl mx-auto">

        <div className="flex flex-col items-center mb-10 space-y-6">
            <h1 className="text-2xl font-medium tracking-tight text-white">Integrations</h1>
            
            <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-full border border-zinc-800/50 backdrop-blur-sm">
                {(['Browse', 'Connected'] as const).map((tab) => (
                    <button 
                        key={tab} 
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "relative px-6 py-2 text-sm font-medium transition-colors rounded-full z-10",
                            activeTab === tab 
                                ? "text-black dark:text-black" 
                                : "text-zinc-500 hover:text-zinc-300"
                        )}
                    >
                        {activeTab === tab && (
                            <motion.div 
                                layoutId="activeTabIntegrations"
                                className="absolute inset-0 bg-white rounded-full z-[-1]"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                        {tab}
                        {tab === 'Connected' && profiles.length > 0 && (
                            <span className={cn("ml-2 text-[10px]", activeTab === tab ? "text-black/60" : "text-zinc-600")}>
                                {profiles.length}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>

        <AnimatePresence mode="wait">
            {activeTab === 'Browse' && (
                <motion.div 
                    key="browse"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4 }}
                >
                    <ComposioRegistry />
                </motion.div>
            )}

            {activeTab === 'Connected' && (
                <motion.div 
                    key="connected"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                    {profiles.map((p: any) => (
                        <div key={p.profile_id} className="group relative bg-zinc-900 border border-zinc-800/50 rounded-3xl p-6 hover:bg-zinc-800 transition-all">
                            <div className="flex justify-between items-start mb-6">
                                <div className="h-10 w-10 rounded-xl bg-zinc-900 flex items-center justify-center font-bold text-zinc-500">
                                    {p.display_name?.charAt(0)}
                                </div>
                                <Switch 
                                    checked={p.is_default_for_dashboard}
                                    onCheckedChange={() => handleToggle(p.profile_id, p.is_default_for_dashboard)}
                                    className="data-[state=checked]:bg-white"
                                />
                            </div>
                            
                            <div className="font-medium text-zinc-200 mb-1">{p.display_name}</div>
                            <div className="text-xs text-zinc-500 mb-6 flex items-center gap-2">
                                <span className={cn("w-1.5 h-1.5 rounded-full", p.is_connected ? "bg-emerald-500" : "bg-red-500")} />
                                {p.is_connected ? 'Active' : 'Disconnected'}
                            </div>

                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => handleDelete(p.profile_id)}
                                className="w-full h-8 text-xs text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            >
                                <Trash2 className="w-3 h-3 mr-2" />
                                Remove
                            </Button>
                        </div>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export const CredentialsPageClient = memo(CompositoDashboardManagerComponent);
export const CompositoDashboardManager = memo(CompositoDashboardManagerComponent);