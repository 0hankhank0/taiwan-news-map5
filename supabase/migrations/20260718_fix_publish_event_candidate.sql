-- This migration only replaces RPC definitions. It never recreates or deletes
-- event_candidates or official_events rows.
drop function if exists public.publish_event_candidate(text, boolean);

create or replace function public.publish_event_candidate(p_candidate_id text)
returns table(event_id text, candidate_id text, status text, already_published boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.event_candidates%rowtype;
  v_event_id text;
begin
  select ec.* into v_candidate from public.event_candidates as ec
    where ec.candidate_id = p_candidate_id for update;
  if not found then raise exception 'candidate not found' using errcode = 'P0002'; end if;
  if v_candidate.status = 'published' and v_candidate.published_event_id is not null then
    return query select v_candidate.published_event_id, v_candidate.candidate_id, v_candidate.status, true;
    return;
  end if;
  if v_candidate.status not in ('pending', 'publishing') then
    raise exception 'candidate is not publishable' using errcode = 'P0001';
  end if;

  v_event_id := coalesce(v_candidate.published_event_id, v_candidate.normalized_payload ->> 'id', 'event:' || v_candidate.candidate_id);
  v_candidate.normalized_payload := v_candidate.normalized_payload || jsonb_build_object(
    'id', v_event_id, 'candidateId', v_candidate.candidate_id, 'batchId', v_candidate.batch_id,
    'source', coalesce(v_candidate.normalized_payload ->> 'source', v_candidate.source)
  );
  insert into public.official_events as oe (id, source_candidate_id, submission_id, public_payload, internal_payload)
  values (v_event_id, v_candidate.candidate_id, v_candidate.normalized_payload ->> 'submissionId', v_candidate.normalized_payload, v_candidate.raw_source_data)
  on conflict on constraint official_events_source_candidate_id_key do update set updated_at = now()
  returning oe.id into v_event_id;
  update public.event_candidates as ec set status = 'published', published_event_id = v_event_id, updated_at = now()
    where ec.candidate_id = v_candidate.candidate_id;
  return query select v_event_id, v_candidate.candidate_id, 'published'::text, false;
end;
$$;

-- A separate, service-role-only staging test RPC. Production callers use the
-- one-argument function above and cannot opt into failure injection.
create or replace function public.publish_event_candidate_test(
  p_candidate_id text,
  p_fail_after_event_insert boolean default false
)
returns table(event_id text, candidate_id text, status text, already_published boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.event_candidates%rowtype;
  v_event_id text;
begin
  select ec.* into v_candidate from public.event_candidates as ec
    where ec.candidate_id = p_candidate_id for update;
  if not found then raise exception 'candidate not found' using errcode = 'P0002'; end if;
  if v_candidate.status = 'published' and v_candidate.published_event_id is not null then
    return query select v_candidate.published_event_id, v_candidate.candidate_id, v_candidate.status, true;
    return;
  end if;
  if v_candidate.status not in ('pending', 'publishing') then
    raise exception 'candidate is not publishable' using errcode = 'P0001';
  end if;

  v_event_id := coalesce(v_candidate.published_event_id, v_candidate.normalized_payload ->> 'id', 'event:' || v_candidate.candidate_id);
  v_candidate.normalized_payload := v_candidate.normalized_payload || jsonb_build_object(
    'id', v_event_id, 'candidateId', v_candidate.candidate_id, 'batchId', v_candidate.batch_id,
    'source', coalesce(v_candidate.normalized_payload ->> 'source', v_candidate.source)
  );
  insert into public.official_events as oe (id, source_candidate_id, submission_id, public_payload, internal_payload)
  values (v_event_id, v_candidate.candidate_id, v_candidate.normalized_payload ->> 'submissionId', v_candidate.normalized_payload, v_candidate.raw_source_data)
  on conflict on constraint official_events_source_candidate_id_key do update set updated_at = now()
  returning oe.id into v_event_id;
  if p_fail_after_event_insert then raise exception 'TEST_ONLY_ROLLBACK_AFTER_EVENT_INSERT'; end if;
  update public.event_candidates as ec set status = 'published', published_event_id = v_event_id, updated_at = now()
    where ec.candidate_id = v_candidate.candidate_id;
  return query select v_event_id, v_candidate.candidate_id, 'published'::text, false;
end;
$$;

revoke all on function public.publish_event_candidate(text) from public, anon, authenticated;
grant execute on function public.publish_event_candidate(text) to service_role;
revoke all on function public.publish_event_candidate_test(text, boolean) from public, anon, authenticated;
grant execute on function public.publish_event_candidate_test(text, boolean) to service_role;
