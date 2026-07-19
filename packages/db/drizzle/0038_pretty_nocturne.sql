ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_role_check" CHECK ("v2_messages"."role" in ('assistant', 'user')) NOT VALID;
