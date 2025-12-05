'use client';

import { Icons } from '@/components/home/icons';
import { NavMenu } from '@/components/home/nav-menu';

import { siteConfig } from '@/lib/home';
import { cn } from '@/lib/utils';
import { Menu, X, User, Settings, LogOut, Zap, Loader2 } from 'lucide-react';
import type { SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { useUser, useAuth } from '@clerk/nextjs';
import { buttonVariants, Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useModal } from '@/hooks/use-modal-store';

// Consolidated components and utilities
import { IntegrationsDropdown } from '@/components/integrations/integrations-dropdown';
import { ProfileDropdown } from '@/components/user/profile-popover';
import { useSignOut } from '@/hooks/use-sign-out';
import { getUserInitials } from '@/lib/utils/user';
import { useMCPProfilesWithToggle, type MCPCredentialProfile } from '@/hooks/react-query/composio';

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// Custom Discord icon SVG
// Custom LinkedIn icon SVG
function LinkedInIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 50 50" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M9 4c-2.75 0-5 2.25-5 5v32c0 2.75 2.25 5 5 5h32c2.75 0 5-2.25 5-5V9c0-2.75-2.25-5-5-5H9zm0 2h32c1.668 0 3 1.332 3 3v32c0 1.668-1.332 3-3 3H9c-1.668 0-3-1.332-3-3V9c0-1.668 1.332-3 3-3zm5 5.012c-1.095 0-2.081.327-2.811.941C10.459 12.567 10 13.484 10 14.467c0 1.867 1.62 3.322 3.68 3.466.01 0 .315.053.32.053 2.273 0 3.988-1.593 3.988-3.522 0-1.953-1.694-3.455-3.884-3.455zM11 19a1 1 0 0 0-1 1v19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V20a1 1 0 0 0-1-1h-6zm9 0a1 1 0 0 0-1 1v19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-10c0-.83.226-1.655.625-2.195.399-.54.902-.864 1.858-.847.985.017 1.507.355 1.901.885.394.53.615 1.325.615 2.158v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V28.262c0-2.962-.877-5.308-2.381-6.895C36.116 19.78 34.025 19 31.813 19c-2.102 0-3.701.705-4.813 1.424V20a1 1 0 0 0-1-1h-6z" />
    </svg>
  );
}

// Custom X (Twitter) icon SVG
function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 30 30" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M26.37 26l-8.795-12.822.015.012L25.52 4h-2.65l-6.46 7.48L11.28 4H4.33l8.211 11.971-.001-.001L3.88 26h2.65l7.182-8.322L19.42 26h6.95zM10.23 6l12.34 18h-2.1L8.12 6h2.11z" />
    </svg>
  );
}

function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.444.864-.608 1.249-1.844-.276-3.68-.276-5.486 0-.164-.401-.418-.874-.629-1.249a.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.032.027C2.042 9.043 1.196 13.58 1.49 18.057a.082.082 0 00.031.056 19.964 19.964 0 006.029 3.058.078.078 0 00.084-.027c.464-.638.875-1.31 1.226-2.017a.076.076 0 00-.041-.105 13.138 13.138 0 01-1.873-.892.077.077 0 01-.008-.128c.125-.094.25-.192.368-.291a.074.074 0 01.077-.01c3.927 1.793 8.18 1.793 12.061 0a.075.075 0 01.078.01c.119.099.243.198.368.291a.077.077 0 01-.006.128 12.64 12.64 0 01-1.874.891.075.075 0 00-.04.106c.36.704.771 1.376 1.225 2.014a.075.075 0 00.084.028 19.922 19.922 0 006.03-3.06.077.077 0 00.03-.055c.5-5.177-.838-9.673-3.548-13.66a.061.061 0 00-.03-.026zM8.02 15.331c-1.183 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.173 1.095 2.156 2.418 0 1.334-.955 2.419-2.156 2.419zm7.974 0c-1.183 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.173 1.095 2.156 2.418 0 1.334-.946 2.419-2.156 2.419z" />
    </svg>
  );
}

const drawerVariants = {
  hidden: { opacity: 0, y: 100 },
  visible: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: {
      type: 'spring' as const,
      damping: 15,
      stiffness: 200,
      staggerChildren: 0.03,
    },
  },
  exit: {
    opacity: 0,
    y: 100,
    transition: { duration: 0.1 },
  },
};

const drawerMenuContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const drawerMenuVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export function Navbar({ sidebarOpen = false }: { sidebarOpen?: boolean }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');

  const [mounted, setMounted] = useState(false);
  const { user, isLoaded } = useUser();
  const { signOut } = useSignOut();

  // Use consolidated MCP profiles hook
  const {
    mcpProfiles,
    activeCount,
    isLoading: isMcpLoading,
    toggleIntegration,
    isUpdatingProfile,
  } = useMCPProfilesWithToggle(mounted && isLoaded && !!user);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const sections = siteConfig.nav.links.map((item) =>
        item.href.substring(1),
      );

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 150 && rect.bottom >= 150) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleDrawer = () => setIsDrawerOpen((prev) => !prev);
  const handleOverlayClick = () => setIsDrawerOpen(false);

  const logoSrc = '/logo-white.png';

  // Hide entire navbar when sidebar is open for authenticated users
  if (user && sidebarOpen) {
    return null;
  }

  return (
    <header className="relative z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-[56px] items-center justify-between">
          {!sidebarOpen && (
            // Show consistent layout during hydration to prevent mismatch
            !mounted || !isLoaded ? (
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src={logoSrc}
                  alt="Cheatcode Logo"
                  width={140}
                  height={22}
                  priority
                />
              </Link>
            ) : user ? (
              <button 
                onClick={() => {
                  // Toggle sidebar if user is authenticated
                  const event = new CustomEvent('toggleHomeSidebar');
                  window.dispatchEvent(event);
                }}
                className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                title="Toggle sidebar"
              >
                <Menu className="h-5 w-5 text-white" />
                <Image
                  src={logoSrc}
                  alt="Cheatcode Logo"
                  width={140}
                  height={22}
                  priority
                /> 
              </button>
            ) : (
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src={logoSrc}
                  alt="Cheatcode Logo"
                  width={140}
                  height={22}
                  priority
                /> 
              </Link>
            )
          )}

          <NavMenu />

          <div className="flex flex-row items-center gap-1 md:gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-x-2">
                <Link href={siteConfig.links.linkedin} target='_blank' rel='noreferrer'>
                    <div
                    className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                        'w-9 px-0',
                    )}
                    >
                    <LinkedInIcon className='h-4 w-4' />
                    <span className='sr-only'>LinkedIn</span>
                    </div>
                </Link>
                <Link href={siteConfig.links.twitter} target='_blank' rel='noreferrer'>
                    <div
                    className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                        'w-9 px-0',
                    )}
                    >
                    <XIcon className='h-4 w-4' />
                    <span className='sr-only'>X</span>
                    </div>
                </Link>
                <Link href={siteConfig.links.discord} target='_blank' rel='noreferrer'>
                    <div
                    className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                        'w-9 px-0',
                    )}
                    >
                    <DiscordIcon className='h-4 w-4' />
                    <span className='sr-only'>Discord</span>
                    </div>
                </Link>
            </div>

            <div className="flex items-center space-x-3">
              {mounted && isLoaded && user ? (
                <div className="hidden md:flex items-center space-x-2">
                  <IntegrationsDropdown triggerVariant="gradient" enabled={mounted && isLoaded && !!user} />
                  <ProfileDropdown
                    user={{
                      imageUrl: user.imageUrl,
                      fullName: user.fullName,
                      firstName: user.firstName,
                      email: user.emailAddresses[0]?.emailAddress,
                    }}
                  />
                </div>
                              ) : mounted && isLoaded ? (
                <div className="hidden md:flex items-center space-x-2">
                  <button
                    className="h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-primary hover:text-primary/80 transition-colors w-fit px-4"
                    onClick={() => {
                      const { onOpen } = useModal.getState();
                      onOpen('signIn');
                    }}
                  >
                    Login
                  </button>
                  <button
                    className="bg-secondary h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-primary-foreground dark:text-secondary-foreground w-fit px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12] hover:bg-secondary/80 transition-all"
                    onClick={() => {
                      const { onOpen } = useModal.getState();
                      onOpen('signUp');
                    }}
                  >
                    Sign up
                  </button>
                </div>
              ) : null}
            </div>
            
            <button
              className="md:hidden border border-border size-8 rounded-md cursor-pointer flex items-center justify-center"
              onClick={toggleDrawer}
            >
              {isDrawerOpen ? (
                <X size={20} />
              ) : (
                <Menu size={20} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={overlayVariants}
              transition={{ duration: 0.2 }}
              onClick={handleOverlayClick}
            />

            <motion.div
              className="fixed inset-x-0 w-[95%] mx-auto bottom-3 bg-background border border-border p-4 rounded-xl shadow-lg"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={drawerVariants}
            >
              {/* Mobile menu content */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <Link href="/" className="flex items-center gap-3">
                    <Image
                      src={logoSrc}
                      alt="Cheatcode Logo"
                      width={120}
                      height={22}
                      priority
                    />
                    <span className="font-medium text-primary text-sm">
                      / cheatcode
                    </span>
                  </Link>
                  <button
                    onClick={toggleDrawer}
                    className="border border-border rounded-md p-1 cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>

                <motion.ul
                  className="flex flex-col text-sm mb-4 border border-border rounded-md"
                  variants={drawerMenuContainerVariants}
                >
                  <AnimatePresence>
                    {siteConfig.nav.links.map((item) => (
                      <motion.li
                        key={item.id}
                        className="p-2.5 border-b border-border last:border-b-0"
                        variants={drawerMenuVariants}
                      >
                        <a
                          href={item.href}
                          onClick={(e) => {
                            e.preventDefault();
                            const element = document.getElementById(
                              item.href.substring(1),
                            );
                            element?.scrollIntoView({ behavior: 'smooth' });
                            setIsDrawerOpen(false);
                          }}
                          className={`underline-offset-4 hover:text-primary/80 transition-colors ${
                            activeSection === item.href.substring(1)
                              ? 'text-primary font-medium'
                              : 'text-primary/60'
                          }`}
                        >
                          {item.name}
                        </a>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  {mounted && isLoaded && user ? (
                    <div className="flex flex-col gap-2">
                      <div className="bg-secondary h-auto flex flex-col text-sm font-normal tracking-wide rounded-lg text-primary-foreground dark:text-secondary-foreground w-full p-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12]">
                        <div className="flex items-center gap-2 mb-3">
                          <Zap className="w-4 h-4" />
                          <span className="font-medium">Integrations</span>
                          {mcpProfiles.filter(p => p.is_default_for_dashboard).length > 0 && (
                            <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-xs">
                              {mcpProfiles.filter(p => p.is_default_for_dashboard).length}
                            </Badge>
                          )}
                        </div>
                        
                        {isMcpLoading ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs text-muted-foreground">Loading integrations...</span>
                          </div>
                        ) : mcpProfiles.length === 0 ? (
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground mb-2">
                              No integrations configured yet.
                            </p>
                            <Button variant="outline" size="sm" asChild>
                              <a href="/settings/integrations" onClick={() => setIsDrawerOpen(false)}>Configure Integrations</a>
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {mcpProfiles.slice(0, 3).map((profile) => (
                              <div key={profile.profile_id} className="flex items-center justify-between p-2 rounded-md bg-background/10">
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="font-medium text-xs truncate">{profile.display_name}</span>
                                  <span className="text-[10px] text-muted-foreground truncate">{profile.mcp_qualified_name}</span>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    profile.is_default_for_dashboard 
                                      ? 'bg-green-400 shadow-[0_0_6px_theme(colors.green.400),0_0_12px_theme(colors.green.400/0.8),0_0_18px_theme(colors.green.400/0.6)]' 
                                      : 'bg-gray-400 shadow-[0_0_4px_theme(colors.gray.400),0_0_8px_theme(colors.gray.400/0.6),0_0_12px_theme(colors.gray.400/0.4)]'
                                  }`} />
                                  <Switch
                                    checked={profile.is_default_for_dashboard}
                                    onCheckedChange={() => toggleIntegration(profile.profile_id, profile.is_default_for_dashboard)}
                                    disabled={isUpdatingProfile(profile.profile_id) || !profile.is_active}
                                  />
                                </div>
                              </div>
                            ))}
                            
                            {mcpProfiles.length > 3 && (
                              <p className="text-xs text-muted-foreground text-center">
                                +{mcpProfiles.length - 3} more
                              </p>
                            )}
                            
                            <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                              <a href="/settings/integrations" onClick={() => setIsDrawerOpen(false)}>Manage Integrations</a>
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 p-3 border border-border rounded-md">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={user.imageUrl} alt={user.fullName || 'User'} />
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm font-semibold">
                            {getUserInitials(user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'U')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0 flex-1">
                          <p className="text-sm font-medium leading-none truncate">
                            {user.fullName || user.firstName || 'User'}
                          </p>
                          <p className="text-xs leading-none text-muted-foreground mt-1 truncate">
                            {user.emailAddresses[0]?.emailAddress || ''}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-1">
                        <Link
                          href="/"
                          onClick={() => setIsDrawerOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                        >
                          <User className="h-4 w-4" />
                          <span>Home</span>
                        </Link>
                        <Link
                          href="/settings"
                          onClick={() => setIsDrawerOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                        >
                          <Settings className="h-4 w-4" />
                          <span>Settings</span>
                        </Link>
                        <button
                          onClick={() => {
                            signOut();
                            setIsDrawerOpen(false);
                          }}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left w-full"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>Sign out</span>
                        </button>
                      </div>
                    </div>
                  ) : mounted && isLoaded ? (
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => {
                          const { onOpen } = useModal.getState();
                          onOpen('signIn');
                          setIsDrawerOpen(false);
                        }}
                        className="h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-primary hover:text-primary/80 transition-colors w-full px-4 border border-border"
                      >
                        Login
                      </button>
                      <button
                        onClick={() => {
                          const { onOpen } = useModal.getState();
                          onOpen('signUp');
                          setIsDrawerOpen(false);
                        }}
                        className="bg-secondary h-8 flex items-center justify-center text-sm font-normal tracking-wide rounded-full text-primary-foreground dark:text-secondary-foreground w-full px-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] border border-white/[0.12] hover:bg-secondary/80 transition-all ease-out active:scale-95"
                      >
                        Sign up
                      </button>
                    </div>
                  ) : null}

                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  ); 
}
