-- Generated outputs are stored exclusively in the R2 bucket bound as
-- `R2_OUTPUTS` (`cheatcode-outputs`). Persisting the deployment-level bucket
-- identity created a second source of truth without supporting another bucket.
do $$
begin
  if exists (
    select 1
      from public.v2_generated_outputs
     where r2_bucket is distinct from 'cheatcode-outputs'
  ) then
    raise exception 'v2_generated_outputs contains an unexpected R2 bucket';
  end if;
end
$$;

alter table public.v2_generated_outputs
  drop constraint v2_generated_outputs_r2_object_key,
  drop constraint v2_generated_outputs_bucket_check,
  drop column r2_bucket,
  add constraint v2_generated_outputs_r2_key_unique unique (r2_key);

-- Webhook acceptance, replay, and idempotency are owned by the
-- WebhookIdempotencyStore Durable Object. This table was a write-only,
-- short-lived diagnostic copy and had no billing reconciliation reader.
drop table public.v2_billing_events restrict;
