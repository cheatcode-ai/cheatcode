-- Production installs pgvector in `extensions`, so remove the two remaining
-- V1 search functions against their actual argument type identities.
drop function if exists public.match_components(
  extensions.vector,
  double precision,
  integer
) restrict;

drop function if exists public.match_mobile_components(
  extensions.vector,
  double precision,
  integer
) restrict;
