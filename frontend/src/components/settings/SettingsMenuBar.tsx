'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MenuBar } from '@/components/ui/menu-bar';
import { User, SquareAsterisk, Zap } from 'lucide-react';


interface SettingsMenuBarProps {
  initialActiveItem?: string;
}

export function SettingsMenuBar({ initialActiveItem = 'Account' }: SettingsMenuBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeItem, setActiveItem] = useState(initialActiveItem);

  // Menu items configuration - memoized to avoid dependency warnings
  const menuItems = useMemo(() => [
    {
      icon: User,
      label: 'Account',
      href: '/settings/account',
      gradient: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.06) 50%, rgba(29,78,216,0) 100%)',
      iconColor: 'text-blue-500',
    },
    {
      icon: Zap,
      label: 'Integrations',
      href: '/settings/integrations',
      gradient: 'radial-gradient(circle, rgba(234,179,8,0.15) 0%, rgba(202,138,4,0.06) 50%, rgba(161,98,7,0) 100%)',
      iconColor: 'text-yellow-500',
    },
    {
      icon: SquareAsterisk,
      label: 'Bring Your Own Key (BYOK)',
      href: '/settings/byok',
      gradient: 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.06) 50%, rgba(185,28,28,0) 100%)',
      iconColor: 'text-red-500',
    },
  ], []);

  // Update active item based on pathname
  useEffect(() => {
    if (pathname.includes('/settings/byok')) {
      setActiveItem('Bring Your Own Key (BYOK)');
    } else if (pathname.includes('/settings/integrations')) {
      setActiveItem('Integrations');
    } else {
      setActiveItem('Account');
    }
  }, [pathname]);

  // Handle menu item clicks
  const handleItemClick = (label: string) => {
    // Optimistically update UI first
    setActiveItem(label);
    
    // Find the corresponding menu item
    const item = menuItems.find(item => item.label === label);
    if (item) {
      // Navigate to the new route
      router.push(item.href);
    }
  };

  // Prefetching DISABLED for better button responsiveness
  const handleItemHover = (_label: string) => {
    // No prefetching to avoid conflicts
  };

  return (
    <MenuBar
      items={menuItems.map(item => ({
        ...item,
        onHover: () => handleItemHover(item.label),
      }))}
      activeItem={activeItem}
      onItemClick={handleItemClick}
    />
  );
}
