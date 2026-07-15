ALTER TABLE "v2_users" ADD COLUMN "first_artifact_at" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.v2_capture_first_artifact() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.v2_users
     SET first_artifact_at = NEW.created_at
   WHERE id = NEW.user_id
     AND (first_artifact_at IS NULL OR first_artifact_at > NEW.created_at);
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER v2_capture_first_artifact_trigger
AFTER INSERT ON public.v2_generated_outputs
FOR EACH ROW EXECUTE FUNCTION public.v2_capture_first_artifact();
