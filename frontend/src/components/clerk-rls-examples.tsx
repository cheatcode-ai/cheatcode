/**
 * Example RLS Policies for Clerk + Supabase Integration
 * 
 * Based on the official Supabase documentation for Clerk integration:
 * https://supabase.com/docs/guides/auth/third-party/clerk
 */

// Example 1: Check user organization role
export const organizationRolePolicy = `
create policy "Only organization admins can insert in table"
on secured_table
for insert
to authenticated
with check (
  (((select auth.jwt()->>'org_role') = 'org:admin') or ((select auth.jwt()->'o'->>'rol') = 'admin'))
    and
  (organization_id = (select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')))
);
`;

// Example 2: Check user has passed second factor verification
export const secondFactorVerificationPolicy = `
create policy "Only users that have passed second factor verification can read from table"
on secured_table
as restrictive
for select
to authenticated
using (
  ((select auth.jwt()->'fva'->>1) != '-1')
);
`;

// Example 3: Basic authenticated user policy
export const basicAuthenticatedPolicy = `
create policy "Authenticated users can access their own data"
on user_data
for all
to authenticated
using (
  user_id = (select auth.jwt()->>'sub')
);
`;

// Example React component showing how to use Clerk with Supabase
export const ClerkSupabaseExample = () => {
  // This is just a documentation component - not meant to be rendered
  return null;
};

/**
 * Available JWT Claims from Clerk:
 * 
 * - sub: User ID
 * - email: User's email
 * - org_id: Organization ID
 * - org_role: Organization role (e.g., 'org:admin', 'org:member')
 * - o: Organization object with nested properties
 * - fva: Factor verification age array
 * - role: Should be set to 'authenticated' for Supabase integration
 * 
 * For more details, see Clerk's documentation on JWT claims:
 * https://clerk.com/docs/backend-requests/resources/session-tokens
 */ 