CREATE INDEX "v2_generated_outputs_expiry_idx" ON "v2_generated_outputs" USING btree ("expires_at","id") WHERE "v2_generated_outputs"."expires_at" is not null;
