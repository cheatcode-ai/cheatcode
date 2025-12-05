'use client';

import { Navbar } from '@/components/home/sections/navbar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { SidebarLeft } from '@/components/sidebar/sidebar-left';
import { useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DeleteOperationProvider } from '@/contexts/DeleteOperationContext';
import { BillingProvider } from '@/contexts/BillingContext';
import { useAccounts } from '@/hooks/use-accounts';
import { Loader2 } from 'lucide-react';
import { MaintenancePage } from '@/components/maintenance/maintenance-page';
import { StatusOverlay } from '@/components/ui/status-overlay';
import type { IMaintenanceNotice } from '@/lib/edge-flags';
import { MaintenanceNotice } from './_components/maintenance-notice';
import { MaintenanceBanner } from './_components/maintenance-banner';
import { useApiHealth } from '@/hooks/react-query/usage/use-health';

interface HomeLayoutProps {
  children: React.ReactNode;
  maintenanceNotice?: IMaintenanceNotice;
}

export default function HomeLayout({
  children,
  maintenanceNotice,
}: HomeLayoutProps) {
  const { user, isLoaded } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const pathname = usePathname();

  // TODO: Implement maintenance notice fetching from API or server component
  const [currentMaintenanceNotice] = useState<IMaintenanceNotice>({ enabled: false });
  const { data: accounts } = useAccounts();
  const personalAccount = accounts?.find((account) => account.personal_account);



  // Enhanced: Smart API Health Monitoring with React Query
  const { data: healthData, isLoading: isCheckingHealth, isError: isApiUnhealthy } = useApiHealth();
  const isApiHealthy = healthData?.status === 'ok' && !isApiUnhealthy;

  // Check if we're on a thread page (hide home navbar on thread pages)
  const isThreadPage = pathname?.includes('/projects/') && pathname?.includes('/thread/');

  // Ensure we only render after hydration to prevent SSR/client mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);


  // Listen for sidebar toggle events from navbar
  useEffect(() => {
    const handleToggleSidebar = () => {
      setSidebarOpen(prev => !prev);
    };

    window.addEventListener('toggleHomeSidebar', handleToggleSidebar);
    return () => window.removeEventListener('toggleHomeSidebar', handleToggleSidebar);
  }, []);

  // Enhanced: Smart Maintenance System
  if (currentMaintenanceNotice.enabled) {
    const now = new Date();
    const startTime = currentMaintenanceNotice.startTime;
    const endTime = currentMaintenanceNotice.endTime;

    // If maintenance period has started, show maintenance page
    if (now > startTime) {
      return (
        <div className="w-screen h-screen flex items-center justify-center">
          <div className="max-w-xl">
            <MaintenanceNotice endTime={endTime.toISOString()} />
          </div>
        </div>
      );
    }
  }

  // Enhanced: Maintenance banner for upcoming maintenance
  let maintenanceBanner: React.ReactNode | null = null;
  if (currentMaintenanceNotice.enabled) {
    maintenanceBanner = (
      <MaintenanceBanner
        startTime={currentMaintenanceNotice.startTime.toISOString()}
        endTime={currentMaintenanceNotice.endTime.toISOString()}
      />
    );
  }

  // Enhanced: Show loading state while checking auth or health
  if (!isClient || !isLoaded || isCheckingHealth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Enhanced: Show maintenance page if API is not healthy
  if (!isApiHealthy) {
    return <MaintenancePage />;
  }

  // Enhanced: Graceful degradation - Don't render anything if not authenticated
  if (!user) {
    return (
      <BillingProvider>
        <div
          className="w-full relative min-h-screen"
          style={!isThreadPage ? {
            backgroundImage: 'linear-gradient( 156.2deg,  rgba(0,0,0,1) 14.8%, rgba(32,104,177,1) 68.1%, rgba(222,229,237,1) 129% )'
          } : {
            backgroundColor: '#0a0a0a'
          }}
        >
          {!isThreadPage && <Navbar sidebarOpen={false} />}
          <div className={isThreadPage ? "pt-0" : "pt-6"}>
            {children}
          </div>
          {!isThreadPage && (
            <footer className="w-full py-6 text-center text-xs text-white/70">
              Built by <a href="https://jigyansurout.com/" target="_blank" rel="noreferrer" className="no-underline hover:text-white">Jigyansu Rout</a>
            </footer>
          )}
        </div>
      </BillingProvider>
    );
  }

  // Authenticated user - show enhanced layout with all features
  return (
    <DeleteOperationProvider>
      <BillingProvider>
        <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SidebarLeft />
        <SidebarInset>
          {/* Enhanced: Maintenance banner */}
          {maintenanceBanner}

          <div
            className="w-full relative min-h-screen"
            style={!isThreadPage ? {
              backgroundImage: 'linear-gradient( 156.2deg,  rgba(0,0,0,1) 14.8%, rgba(32,104,177,1) 68.1%, rgba(222,229,237,1) 129% )'
            } : {
              backgroundColor: '#0a0a0a'
            }}
          >
            {!isThreadPage && <Navbar sidebarOpen={sidebarOpen} />}
            <div className={isThreadPage ? "pt-0" : "pt-6"}>
              {children}
            </div>
            {!isThreadPage && (
              <footer className="w-full py-6 text-center text-xs text-white/70">
                Built by <a href="https://jigyansurout.com/" target="_blank" rel="noreferrer" className="no-underline hover:text-white">Jigyansu Rout</a>
              </footer>
            )}
          </div>
        </SidebarInset>

        {/* Enhanced: Status overlay for deletion operations and async tasks */}
        <StatusOverlay />
      </SidebarProvider>
      </BillingProvider>
    </DeleteOperationProvider>
  );
}
