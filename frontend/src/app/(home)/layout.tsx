'use client';

import { Suspense } from 'react';
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

// Loading fallback for Suspense boundaries
function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

interface HomeLayoutProps {
  children: React.ReactNode;
}

export default function HomeLayout({
  children,
}: HomeLayoutProps) {
  const { user, isLoaded } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const pathname = usePathname();

  // TODO: Implement maintenance notice fetching from API or server component
  const [currentMaintenanceNotice] = useState<IMaintenanceNotice>({ enabled: false });
  useAccounts();



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
  // Note: BillingProvider removed from unauthenticated branch - billing is only needed for authenticated users
  if (!user) {
    return (
      <div
        className={`w-full relative min-h-screen ${!isThreadPage ? 'gradient-home-bg' : 'bg-thread-panel'}`}
      >
        {!isThreadPage && <Navbar sidebarOpen={false} />}
        <div className={isThreadPage ? "pt-0" : "pt-6"}>
          <Suspense fallback={<PageLoadingFallback />}>
            {children}
          </Suspense>
        </div>
        {!isThreadPage && (
          <footer className="w-full py-6 text-center text-xs text-white/70">
            Built by <a href="https://jigyansurout.com/" target="_blank" rel="noreferrer" className="no-underline hover:text-white">Jigyansu Rout</a>
          </footer>
        )}
      </div>
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
            className={`w-full relative min-h-screen ${!isThreadPage ? 'gradient-home-bg' : 'bg-thread-panel'}`}
          >
            {!isThreadPage && <Navbar sidebarOpen={sidebarOpen} />}
            <div className={isThreadPage ? "pt-0" : "pt-6"}>
              <Suspense fallback={<PageLoadingFallback />}>
                {children}
              </Suspense>
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
