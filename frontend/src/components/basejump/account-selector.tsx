'use client';

import { ComponentPropsWithoutRef, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { useAccounts } from '@/hooks/use-accounts';

type PopoverTriggerProps = ComponentPropsWithoutRef<typeof PopoverTrigger>;

type SelectedAccount = NonNullable<ReturnType<typeof useAccounts>['data']>[0];

interface AccountSelectorProps extends PopoverTriggerProps {
  accountId: string;
  placeholder?: string;
  onAccountSelected?: (account: SelectedAccount) => void;
}

export function AccountSelector({
  className,
  accountId,
  onAccountSelected,
  placeholder = 'Select an account...',
}: AccountSelectorProps) {
  const [open, setOpen] = useState(false);

  const { data: accounts } = useAccounts();

  const { personalAccount, selectedAccount } = useMemo(() => {
    const personalAccount = accounts?.find(
      (account) => account.personal_account,
    );
    const selectedAccount = accounts?.find(
      (account) => account.account_id === accountId,
    );

    return {
      personalAccount,
      selectedAccount,
    };
  }, [accounts, accountId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Select an account"
          className={cn(
            'w-full flex items-center gap-2 h-9 pl-3 pr-2 rounded-md justify-between border border-subtle dark:border-white/10 bg-transparent hover:bg-hover-bg text-foreground/90',
            className,
          )}
        >
          <span className="truncate max-w-[180px]">
            {selectedAccount?.name || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground/50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0 border-subtle dark:border-white/10 bg-card-bg dark:bg-background-secondary rounded-xl shadow-custom">
        <Command className="rounded-xl overflow-hidden bg-card-bg dark:bg-background-secondary border-0">
          <CommandInput
            placeholder="Search account..."
            className="h-9 bg-transparent border-0 text-foreground/90 placeholder:text-foreground/50"
          />
          <CommandList className="border-0 bg-card-bg dark:bg-background-secondary">
            <CommandEmpty className="text-foreground/70 text-sm py-6">
              No account found.
            </CommandEmpty>
            <CommandGroup
              heading="Personal"
              className="text-xs font-medium text-foreground/70 bg-card-bg dark:bg-background-secondary"
            >
              {personalAccount && (
                <CommandItem
                  key={personalAccount.account_id}
                  onSelect={() => {
                    if (onAccountSelected) {
                      onAccountSelected(personalAccount);
                    }
                    setOpen(false);
                  }}
                  className="text-sm rounded-md bg-card-bg dark:bg-background-secondary hover:!bg-[#f1eee7] dark:hover:!bg-[#141413] aria-selected:!bg-[#f1eee7] dark:aria-selected:!bg-[#141413] text-foreground/90"
                >
                  {personalAccount.name}
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4 text-primary',
                      selectedAccount?.account_id === personalAccount.account_id
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                  />
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
