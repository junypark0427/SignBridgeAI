-- SignBridge AI: additive, transaction-safe setup. No table/data DROP or UPDATE.
begin;
create schema if not exists signbridge_private;
revoke all on schema signbridge_private from public;
grant usage on schema signbridge_private to anon;

create or replace function signbridge_private.valid_sample(
  frames jsonb, started timestamptz, duration double precision, capture jsonb,
  metadata jsonb, lang text, sign_key text, concept_key text, word_label text
) returns boolean language plpgsql immutable parallel safe
set search_path = '' as $$
declare
  frame jsonb; hand jsonb; point jsonb; relative_time double precision;
  previous_time double precision := -1; base_ms double precision;
begin
  if jsonb_typeof(frames) <> 'array' or jsonb_array_length(frames) not between 1 and 7200
     or octet_length(frames::text) > 33554432 then return false; end if;
  if capture is null or jsonb_typeof(capture) <> 'object'
     or not (capture ?& array['width','height','mirrored_input'])
     or capture - array['width','height','mirrored_input'] <> '{}'::jsonb
     or jsonb_typeof(capture->'width') <> 'number' or jsonb_typeof(capture->'height') <> 'number'
     or (capture->>'width')::double precision <= 0 or (capture->>'height')::double precision <= 0
     or capture->'mirrored_input' <> 'false'::jsonb then return false; end if;
  if metadata is null or jsonb_typeof(metadata) <> 'object'
     or not (metadata ?& array['sign_id','language','concept_id','label','description','source','correspondence_verified'])
     or metadata - array['sign_id','language','concept_id','label','description','source','correspondence_verified'] <> '{}'::jsonb
     or metadata->>'sign_id' is distinct from sign_key or metadata->>'language' is distinct from lang
     or metadata->>'concept_id' is distinct from concept_key or metadata->>'label' is distinct from word_label
     or jsonb_typeof(metadata->'description') <> 'string' or length(metadata->>'description') > 3000
     or jsonb_typeof(metadata->'source') <> 'string' or length(metadata->>'source') > 3000
     or jsonb_typeof(metadata->'correspondence_verified') <> 'boolean'
     or (metadata->>'correspondence_verified' = 'true' and length(btrim(metadata->>'source')) = 0)
     then return false; end if;
  base_ms := extract(epoch from started) * 1000;
  for frame in select value from jsonb_array_elements(frames) loop
    if jsonb_typeof(frame) <> 'object'
       or not (frame ?& array['timestamp','relative_timestamp','detected_hand_count','hands'])
       or frame - array['timestamp','relative_timestamp','detected_hand_count','hands'] <> '{}'::jsonb
       or jsonb_typeof(frame->'timestamp') <> 'number' or jsonb_typeof(frame->'relative_timestamp') <> 'number'
       or jsonb_typeof(frame->'detected_hand_count') <> 'number' or jsonb_typeof(frame->'hands') <> 'array'
       then return false; end if;
    relative_time := (frame->>'relative_timestamp')::double precision;
    if relative_time < 0 or relative_time <= previous_time or relative_time > duration
       or abs((frame->>'timestamp')::double precision - base_ms - relative_time) > 2
       or jsonb_array_length(frame->'hands') > 2
       or (frame->>'detected_hand_count')::double precision <> jsonb_array_length(frame->'hands')
       then return false; end if;
    previous_time := relative_time;
    for hand in select value from jsonb_array_elements(frame->'hands') loop
      if jsonb_typeof(hand) <> 'object' or not (hand ?& array['handedness','score','landmarks'])
         or hand - array['handedness','score','landmarks'] <> '{}'::jsonb
         or hand->>'handedness' not in ('Left','Right','Unknown') or jsonb_typeof(hand->'handedness') <> 'string'
         or jsonb_typeof(hand->'score') <> 'number' or (hand->>'score')::double precision not between 0 and 1
         or jsonb_typeof(hand->'landmarks') <> 'array' or jsonb_array_length(hand->'landmarks') <> 21
         then return false; end if;
      for point in select value from jsonb_array_elements(hand->'landmarks') loop
        if jsonb_typeof(point) <> 'object' or not (point ?& array['x','y','z'])
           or point - array['x','y','z'] <> '{}'::jsonb
           or jsonb_typeof(point->'x') <> 'number' or jsonb_typeof(point->'y') <> 'number' or jsonb_typeof(point->'z') <> 'number'
           then return false; end if;
        -- Force finite float64-representable coordinates; JSON itself rejects NaN/Infinity.
        if abs((point->>'x')::double precision) = 'Infinity'::double precision
           or abs((point->>'y')::double precision) = 'Infinity'::double precision
           or abs((point->>'z')::double precision) = 'Infinity'::double precision then return false; end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function signbridge_private.valid_sample(jsonb,timestamptz,double precision,jsonb,jsonb,text,text,text,text) from public;
grant execute on function signbridge_private.valid_sample(jsonb,timestamptz,double precision,jsonb,jsonb,text,text,text,text) to anon;

create table if not exists public.sign_samples (
  id uuid primary key,
  language text not null,
  sign_id text not null,
  concept_id text not null,
  label text not null,
  signer_id text not null,
  session_id text not null,
  schema_version text not null,
  preprocessing_version text not null,
  duration_ms double precision not null,
  frame_count integer not null,
  frames jsonb not null,
  created_at timestamptz not null,
  start_timestamp timestamptz not null,
  end_timestamp timestamptz not null,
  capture jsonb not null,
  sign_metadata jsonb not null,
  uploaded_at timestamptz not null default now(),
  is_test boolean not null default false
);
-- Existing compatible required columns are retained. Add only reconstruction metadata.
alter table public.sign_samples add column if not exists start_timestamp timestamptz;
alter table public.sign_samples add column if not exists end_timestamp timestamptz;
alter table public.sign_samples add column if not exists capture jsonb;
alter table public.sign_samples add column if not exists sign_metadata jsonb;
alter table public.sign_samples add column if not exists uploaded_at timestamptz not null default now();
alter table public.sign_samples add column if not exists is_test boolean not null default false;

do $$
declare constraint_row record;
begin
  if not exists (
    select 1 from pg_constraint c where c.conrelid = 'public.sign_samples'::regclass
      and c.contype = 'p' and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)'
  ) then raise exception 'sign_samples requires UUID id primary key. Existing data was not modified.'; end if;
  for constraint_row in select * from (values
    ('sb_language', $c$language is not null and language in ('KSL','ASL')$c$),
    ('sb_identity', $c$id is not null and length(btrim(sign_id)) between 1 and 500 and sign_id is not null
      and length(btrim(concept_id)) between 1 and 500 and concept_id is not null
      and length(btrim(label)) between 1 and 500 and label is not null
      and length(btrim(signer_id)) between 1 and 500 and signer_id is not null
      and length(btrim(session_id)) between 1 and 500 and session_id is not null$c$),
    ('sb_versions', $c$schema_version is not null and schema_version = '1.0.0'
      and preprocessing_version is not null and preprocessing_version = 'wrist-scale-spatial-v1'$c$),
    ('sb_time', $c$start_timestamp is not null and end_timestamp is not null and created_at is not null
      and isfinite(start_timestamp) and isfinite(end_timestamp) and isfinite(created_at)
      and duration_ms is not null and duration_ms > 0 and duration_ms < 'Infinity'::double precision
      and abs(extract(epoch from end_timestamp - start_timestamp) * 1000 - duration_ms) <= 2
      and abs(extract(epoch from created_at - start_timestamp) * 1000) <= 2$c$),
    ('sb_frames', $c$frames is not null and frame_count is not null and frame_count between 1 and 7200
      and jsonb_typeof(frames) = 'array' and jsonb_array_length(frames) = frame_count
      and signbridge_private.valid_sample(frames,start_timestamp,duration_ms,capture,sign_metadata,language,sign_id,concept_id,label) is true$c$)
  ) as definitions(name, expression) loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.sign_samples'::regclass and conname = constraint_row.name) then
      execute format('alter table public.sign_samples add constraint %I check (%s) not valid', constraint_row.name, constraint_row.expression);
    end if;
    execute format('alter table public.sign_samples validate constraint %I', constraint_row.name);
  end loop;
end;
$$;

create index if not exists sign_samples_language_sign_idx on public.sign_samples(language, sign_id, id);
create index if not exists sign_samples_language_signer_idx on public.sign_samples(language, signer_id, id);
create index if not exists sign_samples_language_session_idx on public.sign_samples(language, session_id, id);
create index if not exists sign_samples_created_idx on public.sign_samples(created_at, id);

alter table public.sign_samples enable row level security;
revoke all on table public.sign_samples from public, anon, authenticated;
-- Remove any legacy column-level UPDATE/INSERT grants before the explicit table grant.
do $$ declare columns_sql text; begin
  select string_agg(quote_ident(column_name), ', ') into columns_sql
  from information_schema.columns where table_schema = 'public' and table_name = 'sign_samples';
  execute format('revoke all (%s) on public.sign_samples from public, anon, authenticated', columns_sql);
end; $$;
grant select, insert on public.sign_samples to anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sign_samples' and policyname = 'sb_anon_read') then
    create policy sb_anon_read on public.sign_samples for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sign_samples' and policyname = 'sb_anon_insert') then
    create policy sb_anon_insert on public.sign_samples for insert to anon with check (true);
  end if;
end; $$;
notify pgrst, 'reload schema';
commit;

select relrowsecurity as rls_enabled from pg_class where oid = 'public.sign_samples'::regclass;
select has_table_privilege('anon','public.sign_samples','SELECT') as anon_select,
  has_table_privilege('anon','public.sign_samples','INSERT') as anon_insert,
  has_table_privilege('anon','public.sign_samples','UPDATE') as anon_update,
  has_table_privilege('anon','public.sign_samples','DELETE') as anon_delete;
