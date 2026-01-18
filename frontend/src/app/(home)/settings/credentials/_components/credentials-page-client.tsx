'use client';

import { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CompositoDashboardManager } from '@/components/integrations/composio';

function CredentialsPageClientComponent() {
  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardContent className="p-0">
        <CompositoDashboardManager />
      </CardContent>
    </Card>
  );
}

export const CredentialsPageClient = memo(CredentialsPageClientComponent);