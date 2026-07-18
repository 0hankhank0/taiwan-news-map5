create table if not exists public.event_candidates (
  candidate_id text primary key, source text not null,
  status text not null check (status in ('pending','publishing','published','rejected','duplicate')),
  published_event_id text, batch_id text, normalized_payload jsonb not null,
  raw_source_data jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.official_events (
  id text primary key, source_candidate_id text unique references public.event_candidates(candidate_id),
  submission_id text, public_payload jsonb not null, internal_payload jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz not null default now()
);
alter table public.event_candidates add constraint event_candidates_published_event_fk foreign key (published_event_id) references public.official_events(id) deferrable initially deferred;
create index if not exists event_candidates_status_idx on public.event_candidates(status,created_at desc);
create index if not exists official_events_submission_idx on public.official_events(submission_id);
alter table public.event_candidates enable row level security; alter table public.official_events enable row level security;
revoke all on public.event_candidates, public.official_events from anon, authenticated, public;
grant select,insert,update,delete on public.event_candidates, public.official_events to service_role;
create or replace function public.publish_event_candidate(p_candidate_id text)
returns table(event_id text,candidate_id text,status text,already_published boolean)
language plpgsql security definer set search_path = '' as $$
declare c public.event_candidates%rowtype; eid text; payload jsonb;
begin
 select * into c from public.event_candidates where candidate_id=p_candidate_id for update;
 if not found then raise exception 'candidate not found' using errcode='P0002'; end if;
 if c.status='published' and c.published_event_id is not null then return query select c.published_event_id,c.candidate_id,c.status,true; return; end if;
 if c.status not in ('pending','publishing') then raise exception 'candidate is not publishable' using errcode='P0001'; end if;
 eid := coalesce(c.published_event_id, c.normalized_payload->>'id', 'event:'||c.candidate_id);
 payload := c.normalized_payload || jsonb_build_object('id',eid,'candidateId',c.candidate_id,'batchId',c.batch_id,'source',coalesce(c.normalized_payload->>'source',c.source));
 insert into public.official_events(id,source_candidate_id,submission_id,public_payload,internal_payload)
 values(eid,c.candidate_id,payload->>'submissionId',payload,c.raw_source_data)
 on conflict (source_candidate_id) do update set updated_at=now() returning id into eid;
 update public.event_candidates set status='published',published_event_id=eid,updated_at=now() where candidate_id=c.candidate_id;
 return query select eid,c.candidate_id,'published'::text,false;
end $$;
revoke all on function public.publish_event_candidate(text) from public, anon, authenticated;
grant execute on function public.publish_event_candidate(text) to service_role;
