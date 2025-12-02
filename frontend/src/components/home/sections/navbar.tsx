'use client';

import { Icons } from '@/components/home/icons';
import { NavMenu } from '@/components/home/nav-menu';

import { siteConfig } from '@/lib/home';
import { cn } from '@/lib/utils';
import { Link as LinkIcon, Menu, X, Github, User, Settings, LogOut, ChevronUp, Zap, Loader2, Info, ChevronDown, ExternalLink, Barcode } from 'lucide-react';
import type { SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { useUser, useClerk, useAuth } from '@clerk/nextjs';
import { buttonVariants, Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClerkBackendApi } from '@/lib/api-client';
import { toast } from 'sonner';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { useModal } from '@/hooks/use-modal-store';
import { useBilling } from '@/contexts/BillingContext';

interface MCPCredentialProfile {
  profile_id: string;
  mcp_qualified_name: string;
  display_name: string;
  is_default_for_dashboard: boolean;
  is_active: boolean;
}

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
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [isUpdatingIntegration, setIsUpdatingIntegration] = useState<string | null>(null);
  
  // Get billing information for the profile popover
  const { 
    creditsRemaining, 
    creditsTotal, 
    planName,
    rawCreditsTotal, 
    rawCreditsRemaining,
    isLoading: billingLoading,
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage
  } = useBilling();

  // Calculate daily refills for free users (same logic as DailyRefillsMeter)
  const isFreeUser = planName?.toLowerCase() === 'free' || !planName;
  const maxRefills = 4;
  const creditsPerRefill = 5;
  const creditsUsed = (rawCreditsTotal || 0) - (rawCreditsRemaining || 0);
  const refillsUsed = Math.min(Math.ceil(creditsUsed / creditsPerRefill), maxRefills);
  const refillsRemaining = maxRefills - refillsUsed;
  const refillsProgressPercentage = (refillsUsed / maxRefills) * 100;

  const handleSignOut = async () => {
    await signOut({ redirectUrl: '/' });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Fetch MCP credential profiles
  const { data: mcpProfilesData = [], isLoading: isMcpLoading } = useQuery({
    queryKey: ['mcp-credential-profiles'],
    queryFn: async () => {
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get('/composio/profiles');
      // API returns { success: true, profiles: [...], count: X }
      const profiles = response.data?.profiles;
      return Array.isArray(profiles) ? profiles : [];
    },
    enabled: mounted && isLoaded && !!user,
  });

  // Ensure mcpProfiles is always an array
  const mcpProfiles = Array.isArray(mcpProfilesData) ? mcpProfilesData : [];

  // Update integration toggle mutation
  const updateIntegrationMutation = useMutation({
    mutationFn: async ({ profileId, isDefault }: { profileId: string; isDefault: boolean }) => {
      const apiClient = createClerkBackendApi(getToken);
      await apiClient.put(`/composio/profiles/${profileId}`, {
        is_default_for_dashboard: isDefault
      });
      return { profileId, isDefault };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['mcp-credential-profiles'], (old: MCPCredentialProfile[]) => {
        return old?.map(profile => 
          profile.profile_id === data.profileId 
            ? { ...profile, is_default_for_dashboard: data.isDefault }
            : profile
        ) || [];
      });
      const action = data.isDefault ? 'enabled' : 'disabled';
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} integration for chats`);
    },
    onError: (error) => {
      console.error('Error updating integration:', error);
      toast.error('Failed to update integration setting');
    },
    onSettled: () => {
      setIsUpdatingIntegration(null);
    }
  });

  const handleIntegrationToggle = async (profileId: string, currentValue: boolean) => {
    setIsUpdatingIntegration(profileId);
    await updateIntegrationMutation.mutateAsync({ 
      profileId, 
      isDefault: !currentValue 
    });
  };

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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <HoverBorderGradient
                        containerClassName=""
                        className="h-8 flex items-center justify-center text-sm font-normal tracking-wide text-white w-fit px-3"
                        duration={2}
                      >
                        <Zap className="w-3 h-3 mr-1.5" />
                        Integrations
                        {mcpProfiles.filter(p => p.is_default_for_dashboard).length > 0 && (
                          <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-xs">
                            {mcpProfiles.filter(p => p.is_default_for_dashboard).length}
                          </Badge>
                        )}
                      </HoverBorderGradient>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-80 rounded-2xl ring-1 ring-white/10 bg-gray-950/95 backdrop-blur-md shadow-xl border-0 p-0"
                      align="end"
                      sideOffset={8}
                    >
                      <div className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold text-white">Integrations</h4>
                        <p className="text-sm text-muted-foreground">
                          Connect and enable tools for your dashboard chats. Manage all integrations in settings.
                        </p>

                        <Button asChild className="w-full h-9 bg-white text-black hover:bg-white/90">
                          <a href="/settings/integrations" className="flex items-center justify-center gap-2">
                            <Zap className="h-4 w-4 text-green-500" />
                            Manage Integrations
                          </a>
                        </Button>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-8 w-8 rounded-full hover:opacity-80 transition-opacity"
                      >
                        <Avatar className="h-8 w-8 border border-white/[0.12]">
                          <AvatarImage src={user.imageUrl} alt={user.fullName || 'User'} />
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
                            {getInitials(user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'U')}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-64 rounded-2xl ring-1 ring-white/10 bg-gray-900/95 backdrop-blur-md shadow-xl border-0"
                      align="end"
                      sideOffset={8}
                    >
                      {/* Plan Header */}
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

                      {/* Account Stats */}
                      <TooltipProvider>
                        <div className="p-3 space-y-3">
                        {/* Credits */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-300">Credits</span>
                          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ring-1 ring-white/15 bg-transparent">
                            <span className="text-sm font-semibold text-gray-100 tabular-nums">
                              {!billingLoading && creditsRemaining !== undefined ? 
                                (creditsRemaining >= 1000 ? 
                                  `${(creditsRemaining / 1000).toFixed(2)}K` : 
                                  creditsRemaining.toFixed(0)
                                ) : 
                                '--'
                              }
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
                                {!billingLoading && rawCreditsTotal !== undefined ?
                                  `${refillsUsed}/${maxRefills}` :
                                  '--'
                                }
                              </span>
                            </div>
                            {/* Progress Bar */}
                              <div className="w-full bg-white/10 rounded-full h-[3px]">
                                <div 
                                  className="bg-green-500 h-[3px] rounded-full transition-all duration-300 shadow-[0_0_6px_1px_rgba(34,197,94,0.35)]" 
                                style={{ 
                                  width: !billingLoading && rawCreditsTotal !== undefined ? 
                                    `${refillsProgressPercentage}%` : 
                                    '0%' 
                                }}
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

                      {/* Logout */}
                      <div className="border-t border-gray-800 px-1 py-0.5">
                        <DropdownMenuItem asChild className="cursor-pointer">
                          <button
                            onClick={handleSignOut}
                            className="flex items-center gap-2 w-full px-2 py-1 text-left text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                          >
                            <LogOut className="h-4 w-4" />
                            <span>Log out</span>
                          </button>
                        </DropdownMenuItem>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                                    onCheckedChange={() => handleIntegrationToggle(profile.profile_id, profile.is_default_for_dashboard)}
                                    disabled={isUpdatingIntegration === profile.profile_id || !profile.is_active}
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
                            {getInitials(user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'U')}
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
                            handleSignOut();
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
