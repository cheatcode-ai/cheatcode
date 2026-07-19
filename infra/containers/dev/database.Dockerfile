FROM ghcr.io/supabase/postgres:17.6.1.139@sha256:f6cdd6bf9b556934e8a761d92d082488db206deeec9349c4e938a72d65677e80

# The application uses Supabase's Vault-capable Postgres build, not the local
# Supabase API/Auth/Studio stack. Application migrations own the database schema.
RUN rm -rf /docker-entrypoint-initdb.d/*

