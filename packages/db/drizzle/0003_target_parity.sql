CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
--> statement-breakpoint
-- Cheatcode V2 does not use the Supabase Data API. Revoking public-schema
-- USAGE from its roles is a deliberate tightening from the baseline grant.
-- Supabase-managed grants on the vault schema are intentionally untouched.
DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF pg_catalog.to_regrole(data_api_role) IS NOT NULL THEN
      EXECUTE pg_catalog.format('REVOKE USAGE ON SCHEMA public FROM %I', data_api_role);
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', data_api_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', data_api_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', data_api_role
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  creating_role text;
  data_api_role text;
BEGIN
  -- supabase_admin's default ACLs are Supabase-managed platform state that the
  -- migration role cannot and must not alter; they only affect
  -- supabase_admin-created objects, which this schema never creates.
  FOREACH creating_role IN ARRAY ARRAY['postgres']
  LOOP
    IF pg_catalog.to_regrole(creating_role) IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
        creating_role
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
        creating_role
      );
      EXECUTE pg_catalog.format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
        creating_role
      );
      FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
      LOOP
        IF pg_catalog.to_regrole(data_api_role) IS NOT NULL THEN
          EXECUTE pg_catalog.format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
            creating_role,
            data_api_role
          );
          EXECUTE pg_catalog.format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
            creating_role,
            data_api_role
          );
          EXECUTE pg_catalog.format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
            creating_role,
            data_api_role
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;
