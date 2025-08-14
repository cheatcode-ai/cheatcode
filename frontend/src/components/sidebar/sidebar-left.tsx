'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bot, Menu, Plus, X } from 'lucide-react';
import { useUser } from '@clerk/nextjs';

import { CheatcodeLogo } from '@/components/sidebar/cheatcode-logo';
import { NavProjects } from '@/components/sidebar/nav-projects';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuButton,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '../ui/badge';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

export function SidebarLeft({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { user } = useUser();
  const { setOpen, openMobile, setOpenMobile, state, isMobile } = useSidebar();
  const pathname = usePathname();

  // Handle click outside to close sidebar
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (state === 'expanded' && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (state === 'expanded') {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [state, setOpen]);



  // Handle CMD+B keyboard shortcut
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(state === 'collapsed');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, setOpen]);

  return (
    <>
      {/* Backdrop */}
      {state === 'expanded' && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          onClick={() => setOpen(false)}
        />
      )}
      
      <Sidebar
        ref={sidebarRef}
        collapsible="offcanvas"
        className={`fixed left-0 top-0 h-full border-r-0 bg-background/95 backdrop-blur-sm [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] transition-transform duration-200 ease-in-out ${
          state === 'expanded' ? 'translate-x-0 shadow-2xl z-50' : '-translate-x-full z-50'
        }`}
        style={{ width: '256px' }}
        {...props}
      >
        <SidebarHeader className="px-2 pt-6 pb-2">
          <div className="flex h-[40px] items-center px-1 relative">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex items-center hover:bg-accent rounded-md p-1 transition-colors"
              title="Home"
            >
              <Image
                src="/logo-white.png"
                alt="Cheatcode Logo"
                width={140}
                height={22}
                priority
              />
            </Link>
            {state !== 'collapsed' && (
              <div className="ml-2 transition-all duration-200 ease-in-out whitespace-nowrap">
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-8 w-8"
                title="Close sidebar"
              >
                <X className="h-4 w-4" />
              </Button>
              {isMobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setOpenMobile(true)}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent"
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Open menu</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
          <SidebarGroup>
            <Link href="/">
              <SidebarMenuButton>
                <Plus className="h-4 w-4 mr-2" />
                <span className="flex items-center justify-between w-full">
                  New Project
                </span>
              </SidebarMenuButton>
            </Link>


          </SidebarGroup>
          <NavProjects />
        </SidebarContent>
        <SidebarFooter>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
