'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { ChevronUp, Settings, User, LogOut } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useSignOut } from '@/hooks/use-sign-out';
import { getUserInitials } from '@/lib/utils/user';

interface NavUserProps {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
}

export function NavUser({ user }: NavUserProps) {
  const { state } = useSidebar();
  const { signOut } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full h-auto p-2 justify-start gap-3 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            state === "collapsed" && "justify-center p-2"
          )}
        >
          <Avatar className="h-8 w-8 border-2 border-sidebar-border">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-semibold">
              {getUserInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          {state !== "collapsed" && (
            <div className="flex flex-1 flex-col items-start text-left min-w-0">
              <div className="text-sm font-medium text-sidebar-foreground truncate w-full">
                {user.name}
              </div>
              <div className="text-xs text-sidebar-foreground/70 truncate w-full">
                {user.email}
              </div>
            </div>
          )}
          {state !== "collapsed" && (
            <ChevronUp className="h-4 w-4 text-sidebar-foreground/50 ml-auto" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 border border-sidebar-border bg-sidebar shadow-lg rounded-lg"
        align="end"
        sideOffset={8}
        forceMount
      >
        <DropdownMenuLabel className="font-normal p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border-2 border-sidebar-border">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-semibold">
                {getUserInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-medium leading-none text-sidebar-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs leading-none text-sidebar-foreground/70 mt-1 truncate">
                {user.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        
        <DropdownMenuGroup className="p-1">
          <DropdownMenuItem asChild className="rounded-md cursor-pointer">
            <Link href="/" className="flex items-center gap-2 px-2 py-2">
              <User className="h-4 w-4" />
              <span>Home</span>
            </Link>
          </DropdownMenuItem>
          
          <DropdownMenuItem asChild className="rounded-md cursor-pointer">
            <Link href="/settings" className="flex items-center gap-2 px-2 py-2">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        
        <DropdownMenuSeparator className="border-sidebar-border" />
        
        <div className="p-1">
          <DropdownMenuItem asChild className="rounded-md cursor-pointer">
            <button
              onClick={signOut}
              className="flex items-center gap-2 w-full px-2 py-2 text-left"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 