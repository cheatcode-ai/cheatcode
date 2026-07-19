-- Contract only after the lease-aware Worker release is serving every claim.
drop index if exists public.v2_provider_keys_revalidation_idx;
