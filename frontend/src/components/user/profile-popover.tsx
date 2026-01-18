'use client';

import Link from 'next/link';
import { Barcode, LogOut, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useBilling } from '@/contexts/BillingContext';
import { useSignOut } from '@/hooks/use-sign-out';
import { getUserInitials } from '@/lib/utils/user';
import { cn } from '@/lib/utils';

/**
 * Segmented Progress Bar Component
 * Renders a technical-looking progress bar made of individual segments
 */
function SegmentedProgress({ value, max = 100, segments = 40, color = 'bg-emerald-500' }: { value: number; max?: number; segments?: number; color?: string }) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const activeSegments = Math.ceil((percentage / 100) * segments);

  return (
    <div className="flex gap-[2px] w-full h-2 overflow-hidden">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 rounded-[1px] transition-all duration-300",
            i < activeSegments ? color : "bg-zinc-900"
          )}
        />
      ))}
    </div>
  );
}

/**
 * Header section with user info in a technical layout
 */
export function ProfileHeader({ user }: { user: { imageUrl?: string; fullName?: string | null; firstName?: string | null; email?: string } }) {
  const displayName = user.fullName || user.firstName || user.email?.split('@')[0] || 'User';
  const displayEmail = user.email || 'No email';
  const { planName } = useBilling();

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
      <Avatar className="h-9 w-9 border border-zinc-700 rounded-md">
        <AvatarImage src={user.imageUrl} alt={displayName} />
        <AvatarFallback className="bg-zinc-900 text-zinc-400 text-xs font-mono rounded-md">
          {getUserInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-white truncate font-mono tracking-tight">{displayName}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono font-bold uppercase">{planName || 'Free'}</span>
        </div>
        <span className="text-[10px] text-zinc-500 truncate font-mono">{displayEmail}</span>
      </div>
      <div className="ml-auto">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
      </div>
    </div>
  );
}

/**
 * Usage stats with "Credit Usage" aesthetic
 */
export function ProfileUsage() {
  const {
    creditsRemaining,
    rawCreditsTotal,
    rawCreditsRemaining,
    planName,
    deploymentsUsed,
    deploymentsTotal,
    isLoading: billingLoading,
  } = useBilling();

  const total = rawCreditsTotal || 100;
  const remaining = rawCreditsRemaining || 0;
  const used = total - remaining;
  const percentage = total > 0 ? (used / total) * 100 : 0;

  // Calculate daily refills for free users
  const isFreeUser = planName?.toLowerCase() === 'free' || !planName;
  const maxRefills = 4;
  const creditsPerRefill = 5;
  const refillsUsed = Math.min(Math.ceil(used / creditsPerRefill), maxRefills);

  return (
    <div className="px-4 py-3 space-y-4">
      {/* Credit Usage Visualization */}
      <div className="space-y-2">
        <div className="flex justify-between items-start">
          <div className="flex flex-col items-start">
            <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mb-0.5">Usage</span>
            <span className="text-xl font-bold text-white tabular-nums tracking-tighter">
              {percentage.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col items-end text-right">
             <span className="text-[9px] text-zinc-500 font-mono mb-0.5 tracking-wider uppercase">Left</span>
             <span className="text-xl font-bold text-white tabular-nums tracking-tighter">
               {billingLoading ? '...' : (creditsRemaining !== undefined ? (creditsRemaining >= 1000 ? `${(creditsRemaining / 1000).toFixed(1)}K` : creditsRemaining.toFixed(0)) : '0')}
             </span>
          </div>
        </div>

        <div className="relative pt-1">
          <SegmentedProgress value={used} max={total} color="bg-amber-500" segments={40} />
        </div>
      </div>

      {/* Secondary Stats - Stacked Vertically for Full Width */}
      <div className="space-y-3 pt-1">
        {/* Deployments */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-[9px] font-mono">
            <span className="text-zinc-500 uppercase tracking-wider">Deployments</span>
            <span className="text-zinc-300">{deploymentsUsed}/{deploymentsTotal}</span>
          </div>
          <SegmentedProgress value={deploymentsUsed || 0} max={deploymentsTotal || 1} segments={40} color="bg-emerald-500" />
        </div>

        {/* Refills / Daily Usage */}
        {isFreeUser && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[9px] font-mono">
              <span className="text-zinc-500 uppercase tracking-wider">Refills</span>
              <span className="text-zinc-300">{refillsUsed}/{maxRefills}</span>
            </div>
            <SegmentedProgress value={refillsUsed} max={maxRefills} segments={40} color="bg-blue-500" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Action buttons grid
 */
export function ProfileActions() {
  const { signOut } = useSignOut();

  return (
    <div className="grid grid-cols-2 gap-px bg-zinc-800 border-t border-zinc-800">
      <Link href="/settings/account" className="group relative bg-zinc-950 hover:bg-zinc-900 transition-colors p-2 flex flex-col items-center justify-center gap-1.5 text-center h-14">
        <User className="h-3.5 w-3.5 text-zinc-600 group-hover:text-white transition-colors" />
        <span className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 group-hover:text-white transition-colors leading-tight">Profile</span>
      </Link>

      <button
        onClick={signOut}
        className="group relative bg-zinc-950 hover:bg-zinc-900 transition-colors p-2 flex flex-col items-center justify-center gap-1.5 text-center h-14"
      >
        <LogOut className="h-3.5 w-3.5 text-zinc-600 group-hover:text-red-400 transition-colors" />
        <span className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 group-hover:text-red-400 transition-colors leading-tight">Logout</span>
      </button>
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
 */
export function ProfileDropdown({ user }: ProfileDropdownProps) {
  const displayName = user.fullName || user.firstName || user.email?.split('@')[0] || 'User';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 w-8 rounded-md border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 transition-all flex items-center justify-center overflow-hidden group">
          <Avatar className="h-full w-full rounded-none">
            <AvatarImage src={user.imageUrl} alt={displayName} />
            <AvatarFallback className="bg-zinc-900 text-zinc-400 text-xs font-mono">
              {getUserInitials(displayName)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-80 p-0 rounded-none bg-zinc-950 border border-zinc-800 shadow-2xl font-mono"
        align="end"
        sideOffset={8}
      >
        <ProfileHeader user={user} />
        <ProfileUsage />
        <ProfileActions />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Re-export individual components for compatibility if they are used standalone elsewhere
export function ProfilePlanHeader() {
  const { planName } = useBilling();
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2">
        <Barcode className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[10px] font-mono font-bold text-white uppercase tracking-wide">
          {planName || 'Standard'}
        </span>
      </div>
      <Link
        href="/settings/account"
        className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 hover:text-white transition-colors"
      >
        Manage
      </Link>
    </div>
  );
}

export function ProfileStats() {
  // Re-use the main usage component content
  return <ProfileUsage />;
}

export function ProfileLogoutButton() {
  const { signOut } = useSignOut();
  return (
    <div className="p-1 border-t border-zinc-800 bg-zinc-950">
      <DropdownMenuItem asChild className="cursor-pointer focus:bg-zinc-900 rounded-none">
        <button
          onClick={signOut}
          className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[10px] font-mono uppercase tracking-wide text-zinc-400 hover:text-red-400 transition-colors"
        >
          <LogOut className="h-3 w-3" />
          <span>Logout</span>
        </button>
      </DropdownMenuItem>
    </div>
  );
}
