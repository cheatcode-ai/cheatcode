-- The protected V1 cleanup resolved visible vector arguments as `vector`, not
-- `public.vector`, and therefore left these two exact legacy functions behind.
-- Drop only the audited V1 signatures; RESTRICT preserves the cleanup boundary.
drop function if exists public.match_components(
  public.vector,
  double precision,
  integer
) restrict;

drop function if exists public.match_mobile_components(
  public.vector,
  double precision,
  integer
) restrict;
