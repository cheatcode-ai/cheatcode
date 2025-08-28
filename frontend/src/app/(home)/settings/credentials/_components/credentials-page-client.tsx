'use client';

import React, { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { PipedreamDashboardManager } from './pipedream-dashboard-manager';
import { useRouter } from 'next/navigation';

function CredentialsPageClientComponent() {
  const router = useRouter();

  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardContent className="p-0">
        <PipedreamDashboardManager />
      </CardContent>
    </Card>
  );
}

export const CredentialsPageClient = memo(CredentialsPageClientComponent);