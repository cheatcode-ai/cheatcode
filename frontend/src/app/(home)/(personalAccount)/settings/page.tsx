import { redirect } from 'next/navigation';

// Force dynamic rendering for consistency with other settings pages
export const dynamic = 'force-dynamic';

export default async function PersonalAccountSettingsPage() {
  // Redirect to billing tab by default
  redirect('/settings/billing');
}
