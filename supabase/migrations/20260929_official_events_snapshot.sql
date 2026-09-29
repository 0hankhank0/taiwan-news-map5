-- Refresh-owned official events form a canonical snapshot. Published
-- candidates, submissions, and manually reviewed/retained rows are outside
-- that snapshot and are deliberately preserved.
create or replace function public.replace_official_events_snapshot(p_events jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.official_events
    (id, source_candidate_id, submission_id, public_payload, internal_payload, updated_at)
  select
    row->>'id',
    nullif(row->>'source_candidate_id', ''),
    nullif(row->>'submission_id', ''),
    coalesce(row->'public_payload', '{}'::jsonb),
    row->'internal_payload',
    now()
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as input(row)
  on conflict (id) do update set
    source_candidate_id = excluded.source_candidate_id,
    submission_id = excluded.submission_id,
    public_payload = excluded.public_payload,
    internal_payload = excluded.internal_payload,
    updated_at = now();

  delete from public.official_events current_row
  where current_row.source_candidate_id is null
    and current_row.submission_id is null
    and coalesce(current_row.public_payload->>'categorySource', '') <> 'manual'
    and coalesce(current_row.public_payload->>'statusSource', '') <> 'manual'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as input(row)
      where current_row.id = input.row->>'id'
    );
end;
$$;

revoke all on function public.replace_official_events_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.replace_official_events_snapshot(jsonb) to service_role;
