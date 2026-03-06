'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MenuBar } from '@/components/ui/menu-bar';
import { User, SquareAsterisk, Zap } from 'lucide-react';

export function SettingsMenuBar() {
  const pathname = usePathname();
  const router = useRouter();

  // Menu items configuration - memoized to avoid recreating on every render
  const menuItems = useMemo(
    () => [
      {
        icon: User,
        label: 'Account',
        href: '/settings/account',
        gradient:
          'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.06) 50%, rgba(29,78,216,0) 100%)',
        iconColor: 'text-blue-500',
      },
      {
        icon: Zap,
        label: 'Integrations',
        href: '/settings/integrations',
        gradient:
          'radial-gradient(circle, rgba(234,179,8,0.15) 0%, rgba(202,138,4,0.06) 50%, rgba(161,98,7,0) 100%)',
        iconColor: 'text-yellow-500',
      },
      {
        icon: SquareAsterisk,
        label: 'Bring Your Own Key (BYOK)',
        href: '/settings/byok',
        gradient:
          'radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.06) 50%, rgba(185,28,28,0) 100%)',
        iconColor: 'text-red-500',
      },
    ],
    [],
  );

  // Derive active item from pathname during render - no useState/useEffect needed
  const activeItem = pathname.includes('/settings/byok')
    ? 'Bring Your Own Key (BYOK)'
    : pathname.includes('/settings/integrations')
      ? 'Integrations'
      : 'Account';

  // Handle menu item clicks
  const handleItemClick = (label: string) => {
    const item = menuItems.find((item) => item.label === label);
    if (item) {
      router.push(item.href);
    }
  };

  return (
    <MenuBar
      items={menuItems.map((item) => ({
        ...item,
        onHover: () => {},
      }))}
      activeItem={activeItem}
      onItemClick={handleItemClick}
    />
  );
}
