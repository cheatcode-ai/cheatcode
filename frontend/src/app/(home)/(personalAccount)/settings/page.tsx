import { redirect } from 'next/navigation';

// Force dynamic rendering for consistency with other settings pages
export const dynamic = 'force-dynamic';

export default async function PersonalAccountSettingsPage() {
  // Redirect to account tab by default
  redirect('/settings/account');
}
