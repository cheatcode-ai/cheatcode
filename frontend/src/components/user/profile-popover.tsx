'use client';

/**
 * Profile Popover Components - Reusable user profile dropdown content
 * Consolidated from navbar.tsx and thread-site-header.tsx
 */

import Link from 'next/link';
import { Barcode, ExternalLink, Info, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useBilling } from '@/contexts/BillingContext';
import { useSignOut } from '@/hooks/use-sign-out';
import { getUserInitials } from '@/lib/utils/user';

/**
 * Plan header section showing current plan and manage link
 */
export function ProfilePlanHeader() {
  const { planName } = useBilling();

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80 bg-gradient-to-b from-white/5 to-transparent rounded-t-2xl">
      <div className="flex items-center gap-1.5">
        <Barcode className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-white">
          {planName || 'Free'}
        </span>
      </div>
      <Link
        href="/settings/billing"
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
      >
        Manage
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

/**
 * Account stats section showing credits, refills, and deployments
 */
export function ProfileStats() {
  const {
    creditsRemaining,
    rawCreditsTotal,
    rawCreditsRemaining,
    planName,
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage,
    isLoading: billingLoading,
  } = useBilling();

  // Calculate daily refills for free users
  const isFreeUser = planName?.toLowerCase() === 'free' || !planName;
  const maxRefills = 4;
  const creditsPerRefill = 5;
  const creditsUsed = (rawCreditsTotal || 0) - (rawCreditsRemaining || 0);
  const refillsUsed = Math.min(Math.ceil(creditsUsed / creditsPerRefill), maxRefills);
  const refillsProgressPercentage = (refillsUsed / maxRefills) * 100;

  return (
    <TooltipProvider>
      <div className="p-3 space-y-3">
        {/* Credits */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300">Credits</span>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ring-1 ring-white/15 bg-transparent">
            <span className="text-sm font-semibold text-gray-100 tabular-nums">
              {!billingLoading && creditsRemaining !== undefined
                ? creditsRemaining >= 1000
                  ? `${(creditsRemaining / 1000).toFixed(2)}K`
                  : creditsRemaining.toFixed(0)
                : '--'}
            </span>
            <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_0_2px_rgba(34,197,94,0.35)]"></div>
          </div>
        </div>

        {/* Daily Refills - Only for Free users with valid data */}
        {isFreeUser && !billingLoading && rawCreditsTotal !== undefined && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-300">Daily refills</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-gray-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">You get up to 4 refills each month. Each refill is 5 credits for the day.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="text-sm font-medium text-white">
                {refillsUsed}/{maxRefills}
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-white/10 rounded-full h-[3px]">
              <div
                className="bg-green-500 h-[3px] rounded-full transition-all duration-300 shadow-[0_0_6px_1px_rgba(34,197,94,0.35)]"
                style={{ width: `${refillsProgressPercentage}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Deployments */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Deployments</span>
            <span className="text-sm font-medium text-white">
              {billingLoading ? '--' : `${deploymentsUsed || 0}/${deploymentsTotal || 0}`}
            </span>
          </div>
          {/* Progress Bar */}
          <div className="w-full bg-white/10 rounded-full h-[3px]">
            <div
              className="bg-green-500 h-[3px] rounded-full transition-all duration-300 shadow-[0_0_6px_1px_rgba(34,197,94,0.35)]"
              style={{ width: `${deploymentUsagePercentage || 0}%` }}
            ></div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Logout button section
 */
export function ProfileLogoutButton() {
  const { signOut } = useSignOut();

  return (
    <div className="border-t border-gray-800 px-1 py-0.5">
      <DropdownMenuItem asChild className="cursor-pointer">
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-2 py-1 text-left text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </DropdownMenuItem>
    </div>
  );
}

interface ProfileDropdownProps {
  user: {
    imageUrl?: string;
    fullName?: string | null;
    firstName?: string | null;
    email?: string;
  };
}

/**
 * Complete profile dropdown component
 * Combines avatar trigger with plan header, stats, and logout
 */
export function ProfileDropdown({ user }: ProfileDropdownProps) {
  const displayName = user.fullName || user.firstName || user.email?.split('@')[0] || 'User';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 w-8 rounded-full hover:opacity-80 transition-opacity">
          <Avatar className="h-8 w-8 border border-white/[0.12]">
            <AvatarImage src={user.imageUrl} alt={displayName} />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
              {getUserInitials(displayName)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-2xl ring-1 ring-white/10 bg-gray-900/95 backdrop-blur-md shadow-xl border-0"
        align="end"
        sideOffset={8}
      >
        <ProfilePlanHeader />
        <ProfileStats />
        <ProfileLogoutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
