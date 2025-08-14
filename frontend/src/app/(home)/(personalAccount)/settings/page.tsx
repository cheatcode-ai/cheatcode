import { redirect } from 'next/navigation';

export default async function PersonalAccountSettingsPage() {
  // Redirect to billing tab by default
  redirect('/settings/billing');
}
