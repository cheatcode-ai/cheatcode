'use client';

import * as React from 'react';
import { useAvailableModelsQuery } from '@/hooks/react-query/models';
import type { AvailableModel } from '@/lib/api/models';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import {
  Check,
  ChevronDown,
  DollarSign,
  Bot
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  className?: string;
}

const ProviderLogo = ({
  logoUrl,
  provider,
  className,
}: {
  logoUrl?: string;
  provider: string;
  className?: string;
}) => {
  if (!logoUrl) {
    return <Bot className={cn(className, 'text-zinc-600')} />;
  }

  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      <Image
        src={logoUrl}
        alt={`${provider} logo`}
        width={14}
        height={14}
        className="object-contain opacity-80 group-hover:opacity-100 transition-opacity"
        unoptimized
      />
    </div>
  );
};

const cleanModelName = (name: string) => {
  if (name.includes(': ')) {
    return name.split(': ')[1];
  }
  return name;
};

const getPricingIndicator = (model: AvailableModel) => {
  const input = model.cost_input_per_1k || 0;
  const output = model.cost_output_per_1k || 0;
  const total = input + output;
  
  if (total === 0) return null;
  
  const iconClass = "h-[10px] w-[10px] transition-colors";
  const tier = total <= 0.005 ? 1 : total <= 0.02 ? 2 : 3;
  
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: 3 }).map((_, i) => (
        <DollarSign 
          key={i} 
          className={cn(
            iconClass, 
            i < tier ? "text-zinc-500 group-hover:text-zinc-300" : "text-zinc-800"
          )} 
        />
      ))}
    </div>
  );
};

export function ModelSelector({
  value,
  onChange,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedProvider, setSelectedProvider] = React.useState<string | null>(null);

  const { data, isLoading } = useAvailableModelsQuery();
  const models = data?.models || [];
  const defaultModelId = data?.default_model_id || models[0]?.id || '';
  const selectedValue = value || defaultModelId;
  const selectedModel = models.find((m) => m.id === selectedValue);

  const providers = Array.from(new Set(models.map(m => m.provider))).filter(Boolean);

  const filteredModels = selectedProvider ? models.filter(m => m.provider === selectedProvider) : models;

  if (isLoading || models.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 px-3 h-10 text-[10px] font-mono uppercase tracking-widest text-zinc-500 animate-pulse', className)}>
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          className={cn(
            'flex items-center justify-between h-10 w-auto gap-2.5 rounded-none border-none bg-transparent px-3 text-[10px] font-mono uppercase tracking-widest text-zinc-400 hover:text-white transition-all focus:outline-none focus:ring-0',
            className,
          )}
        >
          <div className="flex items-center gap-2">
            {selectedModel && (
              <ProviderLogo
                logoUrl={selectedModel.logo_url}
                provider={selectedModel.provider}
                className="h-3.5 w-3.5 shrink-0"
              />
            )}
            <span className="truncate max-w-[240px]">
              {selectedModel ? cleanModelName(selectedModel.name) : 'SELECT MODEL'}
            </span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[420px] p-0 rounded-none bg-[#121212] border border-white/10 shadow-2xl font-mono uppercase tracking-widest flex flex-col overflow-hidden" 
        style={{ maxHeight: 'calc(var(--radix-popover-content-available-height) - 10px)' }}
        align="end"
        sideOffset={8}
      >
        <Command className="bg-transparent border-none flex flex-col h-full min-h-0">
          <div className="flex-none">
            <CommandInput 
              placeholder="SEARCH MODELS..." 
              className="text-[10px] uppercase tracking-widest bg-transparent border-none focus:ring-0 placeholder:text-zinc-600" 
            />
            
            {providers.length > 0 && (
              <div className="flex flex-col border-b border-white/10">
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <button
                    onClick={() => setSelectedProvider(null)}
                    className={cn(
                      "px-2.5 py-1 text-[9px] uppercase tracking-widest transition-colors rounded-none",
                      !selectedProvider ? "text-white bg-white/10" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                    )}
                  >
                    All
                  </button>
                  {providers.map(p => {
                    const modelWithLogo = models.find(m => m.provider === p && m.logo_url);
                    return (
                      <button
                        key={p}
                        onClick={() => setSelectedProvider(p === selectedProvider ? null : p)}
                        title={p}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 transition-colors rounded-none shrink-0",
                          p === selectedProvider ? "bg-white/10" : "hover:bg-white/5 opacity-50 hover:opacity-100"
                        )}
                      >
                        <ProviderLogo logoUrl={modelWithLogo?.logo_url} provider={p} className="h-3.5 w-3.5" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <CommandList className="max-h-[350px] overflow-y-auto min-h-0 flex-1">
            <CommandEmpty className="py-6 text-center text-[10px] uppercase tracking-widest text-zinc-500">No models found.</CommandEmpty>
            <CommandGroup>
              {filteredModels.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.provider}`}
                  onSelect={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                  onPointerUp={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                  className="cursor-pointer rounded-none aria-selected:bg-white/5 aria-selected:text-white px-3 py-2.5 mb-0 transition-all group data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                >
                  <div className="flex items-center justify-between w-full gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProviderLogo
                        logoUrl={model.logo_url}
                        provider={model.provider}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 group-aria-selected:text-zinc-200 transition-colors truncate">
                        {cleanModelName(model.name)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {getPricingIndicator(model)}
                      <Check className={cn("h-3.5 w-3.5 transition-opacity text-white shrink-0", selectedValue === model.id ? "opacity-100" : "opacity-0")} />
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
