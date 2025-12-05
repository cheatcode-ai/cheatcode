'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAvailableModelsQuery } from '@/hooks/react-query/models';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  className?: string;
}

// Provider logo component using CDN URLs from API
const ProviderLogo = ({
  logoUrl,
  provider,
  className
}: {
  logoUrl?: string;
  provider: string;
  className?: string
}) => {
  if (!logoUrl) {
    return <Bot className={cn(className, 'text-gray-500')} />;
  }

  return (
    <Image
      src={logoUrl}
      alt={`${provider} logo`}
      width={16}
      height={16}
      className={cn('object-contain', className)}
      unoptimized // Using external CDN
    />
  );
};

export function ModelSelector({
  value,
  onChange,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const { data, isLoading } = useAvailableModelsQuery();

  const models = data?.models || [];
  const defaultModelId = data?.default_model_id || 'claude-sonnet-4.5';

  // Use provided value or default
  const selectedValue = value || defaultModelId;

  // Find selected model for display
  const selectedModel = models.find((m) => m.id === selectedValue);

  if (isLoading || models.length === 0) {
    return (
      <div className={cn('flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground', className)}>
        <Bot className="h-3.5 w-3.5" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <Select value={selectedValue} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          'h-7 w-auto gap-1.5 border-none bg-transparent px-2 py-1 text-xs shadow-none hover:bg-muted/50 focus:ring-0 focus-visible:ring-0',
          className
        )}
        size="sm"
      >
        <SelectValue>
          <div className="flex items-center gap-1.5">
            <ProviderLogo
              logoUrl={selectedModel?.logo_url}
              provider={selectedModel?.provider || ''}
              className="h-3.5 w-3.5"
            />
            <span className="font-medium">{selectedModel?.name || 'Select Model'}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[200px]">
        {models.map((model) => (
          <SelectItem
            key={model.id}
            value={model.id}
            className="cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ProviderLogo
                logoUrl={model.logo_url}
                provider={model.provider}
                className="h-4 w-4"
              />
              <div className="flex flex-col">
                <span className="font-medium">{model.name}</span>
                <span className="text-xs text-muted-foreground">
                  {model.description}
                </span>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
