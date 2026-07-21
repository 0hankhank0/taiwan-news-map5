create table if not exists public.pbs_road_events (
 id text primary key, source_record_id text, normalized_payload jsonb not null, raw_payload jsonb,
 source_last_modified timestamptz, snapshot_id text not null, is_active boolean not null default true,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), expired_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.pbs_sync_state (
 source text primary key, last_attempt_at timestamptz, last_successful_fetch timestamptz, last_snapshot_id text,
 event_count integer, normalized_count integer, last_status text, last_error_stage text, last_error_message text,
 consecutive_failures integer not null default 0, updated_at timestamptz not null default now());
alter table public.pbs_road_events enable row level security; alter table public.pbs_sync_state enable row level security;
revoke all on public.pbs_road_events, public.pbs_sync_state from public, anon, authenticated;
grant select,insert,update,delete on public.pbs_road_events, public.pbs_sync_state to service_role;
create or replace function public.replace_pbs_road_snapshot(p_events jsonb, p_snapshot_id text, p_raw_count integer, p_normalized_count integer, p_fetched_at timestamptz)
returns table(snapshot_id text, event_count integer, last_successful_fetch timestamptz) language plpgsql security definer set search_path = '' as $$
declare actual_event_count integer;
begin
 if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'PBS snapshot events must be an array'; end if;
 actual_event_count := jsonb_array_length(p_events);
 if actual_event_count = 0 then raise exception 'PBS snapshot must contain at least one event'; end if;
 if p_normalized_count is null or p_normalized_count <> actual_event_count then raise exception 'PBS snapshot event count does not match declared count'; end if;
 if nullif(btrim(p_snapshot_id), '') is null then raise exception 'PBS snapshot ID is required'; end if;
 if p_fetched_at is null then raise exception 'PBS fetched time is required'; end if;
 perform pg_advisory_xact_lock(hashtext('pbs_road_snapshot'));
 insert into public.pbs_road_events(id,source_record_id,normalized_payload,raw_payload,source_last_modified,snapshot_id,is_active,first_seen_at,last_seen_at,updated_at)
 select item->>'id', item->>'sourceRecordId', item, item->'raw', nullif(item->>'sourceUpdatedAt','')::timestamptz, p_snapshot_id, true, now(), now(), now() from jsonb_array_elements(p_events) item
 on conflict(id) do update set normalized_payload=excluded.normalized_payload, raw_payload=excluded.raw_payload, source_last_modified=excluded.source_last_modified, snapshot_id=excluded.snapshot_id, is_active=true, last_seen_at=now(), expired_at=null, updated_at=now();
 update public.pbs_road_events set is_active=false, expired_at=now(), updated_at=now() where is_active and snapshot_id <> p_snapshot_id;
 insert into public.pbs_sync_state(source,last_attempt_at,last_successful_fetch,last_snapshot_id,event_count,normalized_count,last_status,last_error_stage,last_error_message,consecutive_failures,updated_at)
 values('pbs',now(),p_fetched_at,p_snapshot_id,actual_event_count,p_normalized_count,'success',null,null,0,now())
 on conflict(source) do update set last_attempt_at=now(),last_successful_fetch=excluded.last_successful_fetch,last_snapshot_id=excluded.last_snapshot_id,event_count=excluded.event_count,normalized_count=excluded.normalized_count,last_status='success',last_error_stage=null,last_error_message=null,consecutive_failures=0,updated_at=now();
 return query select p_snapshot_id, actual_event_count, p_fetched_at;
end $$;
revoke all on function public.replace_pbs_road_snapshot(jsonb,text,integer,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.replace_pbs_road_snapshot(jsonb,text,integer,integer,timestamptz) to service_role;
