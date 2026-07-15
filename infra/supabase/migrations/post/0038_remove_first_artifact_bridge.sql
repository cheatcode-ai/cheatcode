-- New Workers set the first-artifact milestone transactionally. Reconcile the
-- deployment window once more, then remove the temporary old-writer bridge.
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

drop trigger v2_capture_first_artifact_trigger on public.v2_generated_outputs;
drop function public.v2_capture_first_artifact();
