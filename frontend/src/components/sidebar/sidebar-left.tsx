'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Plus, X } from 'lucide-react';

import { NavProjects } from '@/components/sidebar/nav-projects';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

import { Button } from '@/components/ui/button';

export function SidebarLeft({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { setOpen, state, isMobile } = useSidebar();

  // Handle click outside to close sidebar
  const sidebarRef = React.useRef<HTMLDivElement>(null);

  // Consolidated event handlers - single useEffect for better performance
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (state === 'expanded' && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(state === 'collapsed');
      }
    };

    // Only add click listener when expanded
    if (state === 'expanded') {
      document.addEventListener('mousedown', handleClickOutside);
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state, setOpen]);

  return (
    <>
      {/* Backdrop */}
      {state === 'expanded' && (
        <div 
          className="fixed inset-0 bg-background/20 backdrop-blur-sm z-40"
          onClick={() => setOpen(false)}
        />
      )}
      
      <Sidebar
        ref={sidebarRef}
        collapsible="offcanvas"
        className={`fixed left-0 top-0 h-full border-r border-zinc-800 bg-zinc-950 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] transition-transform duration-300 ease-in-out ${
          state === 'expanded' ? 'translate-x-0 z-50' : '-translate-x-full z-50'
        }`}
        style={{ width: '256px' }}
        {...props}
      >
        {/* Header Cell */}
        <SidebarHeader className="h-16 border-b border-zinc-800 px-5 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex w-full items-center justify-center relative">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex items-center transition-opacity hover:opacity-80"
              title="Home"
            >
              <Image
                src="/logo-white.png"
                alt="Cheatcode Logo"
                width={110}
                height={20}
                className="invert dark:invert-0"
                priority
              />
            </Link>
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-900 absolute right-0"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent className="flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none'] p-0">
          {/* New Project Control Cell */}
          <div className="p-4 border-b border-zinc-800 flex justify-center">
            <Link href="/" className="w-full max-w-[200px]">
              <button 
                className="group relative w-full flex items-center justify-center gap-2 bg-white text-zinc-950 hover:bg-zinc-200 transition-all duration-200 py-2 px-3 text-xs font-bold tracking-widest uppercase shadow-sm border border-transparent rounded-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Project</span>
              </button>
            </Link>
          </div>
          
          <div className="flex-1">
            <NavProjects />
          </div>
        </SidebarContent>
        
        {/* Footer Cell */}
        <SidebarFooter className="border-t border-zinc-800 p-4 bg-zinc-950">
          {/* Footer content */}
        </SidebarFooter>
        <SidebarRail className="hover:after:bg-zinc-800" />
      </Sidebar>
    </>
  );
}
