-- Reconcile historical outputs after the insertion bridge is active. Keeping
-- this scan outside the column-add transaction bounds the v2_users DDL lock.
update public.v2_users as users
   set first_artifact_at = first_output.created_at
  from (
    select user_id, min(created_at) as created_at
      from public.v2_generated_outputs
     group by user_id
  ) as first_output
 where users.id = first_output.user_id
   and (
     users.first_artifact_at is null
     or users.first_artifact_at > first_output.created_at
   );
