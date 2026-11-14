-- 공용 메타데이터 편집: 프레임과 원본 시각은 변경하지 않는다.
create table if not exists public.sb_retired_sign_ids (sign_id text primary key);
alter table public.sb_retired_sign_ids enable row level security;
revoke all on public.sb_retired_sign_ids from public, anon, authenticated;
create or replace function public.sb_edit_sample_metadata(
  p_id uuid, p_expected jsonb, p_new jsonb, p_expected_count integer
) returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare old_row public.sign_samples%rowtype; n integer; changed boolean; new_sign jsonb;
begin
  select * into old_row from public.sign_samples where id = p_id and is_test = false for update;
  if not found then raise exception '샘플을 찾을 수 없습니다'; end if;
  if jsonb_build_object('sign_id',old_row.sign_id,'label',old_row.label,'concept_id',old_row.concept_id,'signer_id',old_row.signer_id,'session_id',old_row.session_id,'sign_metadata',old_row.sign_metadata) <> p_expected then
    raise exception '다른 사용자가 수정했습니다. 새로고침해 주세요';
  end if;
  if exists (select 1 from jsonb_object_keys(p_new) k where k not in ('label','concept_id','sign_id','signer_id','session_id','description','source')) then raise exception '허용되지 않는 항목'; end if;
  if exists (select 1 from unnest(array['label','concept_id','sign_id','signer_id','session_id']) k where jsonb_typeof(p_new->k) is distinct from 'string' or length(btrim(p_new->>k)) not between 1 and 500) then raise exception '필수 항목을 확인하세요'; end if;
  if exists (select 1 from unnest(array['description','source']) k where jsonb_typeof(p_new->k) is distinct from 'string' or length(p_new->>k)>3000) then raise exception '설명이나 출처가 올바르지 않습니다'; end if;
  if coalesce((old_row.sign_metadata->>'correspondence_verified')::boolean,false) and btrim(p_new->>'source') = '' then raise exception '검증된 대응 표현에는 출처가 필요합니다'; end if;
  changed := old_row.sign_id <> p_new->>'sign_id' or old_row.label <> p_new->>'label' or old_row.concept_id <> p_new->>'concept_id' or old_row.sign_metadata->>'description' <> p_new->>'description' or old_row.sign_metadata->>'source' <> p_new->>'source';
  perform pg_advisory_xact_lock(hashtext('sb-edit:' || least(old_row.sign_id,p_new->>'sign_id')));
  if old_row.sign_id <> p_new->>'sign_id' then
    perform pg_advisory_xact_lock(hashtext('sb-edit:' || greatest(old_row.sign_id,p_new->>'sign_id')));
  end if;
  perform 1 from public.sign_samples where sign_id = old_row.sign_id and is_test = false for update;
  select count(*) into n from public.sign_samples where sign_id = old_row.sign_id and is_test = false;
  if n <> p_expected_count then raise exception '대상 수가 변경되었습니다. 새로고침해 주세요'; end if;
  if changed and exists(select 1 from public.sign_samples where sign_id = p_new->>'sign_id' and sign_id <> old_row.sign_id) then raise exception '이미 사용 중인 표현 ID입니다'; end if;
  if old_row.sign_id <> p_new->>'sign_id' and exists(select 1 from public.sb_retired_sign_ids where sign_id=p_new->>'sign_id') then raise exception '이전에 변경된 표현 ID는 다시 사용할 수 없습니다'; end if;
  if changed and exists(select 1 from public.sign_samples where sign_id = old_row.sign_id and is_test = false and (sign_metadata <> old_row.sign_metadata or label <> old_row.label or concept_id <> old_row.concept_id or language <> old_row.language)) then raise exception '같은 표현 ID의 자료가 서로 달라 일괄 수정할 수 없습니다'; end if;
  if exists(select 1 from public.sign_samples where session_id = p_new->>'session_id' and signer_id <> p_new->>'signer_id' and id <> p_id and is_test = false) then raise exception '이미 다른 촬영자가 사용하는 세션 ID입니다'; end if;
  if changed then
    new_sign := old_row.sign_metadata || jsonb_build_object('sign_id',p_new->>'sign_id','label',p_new->>'label','concept_id',p_new->>'concept_id','description',p_new->>'description','source',p_new->>'source');
    if old_row.concept_id <> p_new->>'concept_id' then
      new_sign := new_sign || jsonb_build_object('correspondence_verified', false);
    end if;
    update public.sign_samples set sign_id=p_new->>'sign_id', label=p_new->>'label', concept_id=p_new->>'concept_id', sign_metadata=new_sign where sign_id=old_row.sign_id and is_test=false;
    if old_row.sign_id <> p_new->>'sign_id' then insert into public.sb_retired_sign_ids(sign_id) values (old_row.sign_id) on conflict do nothing; end if;
  end if;
  update public.sign_samples set signer_id=p_new->>'signer_id', session_id=p_new->>'session_id' where id=p_id;
  return case when changed then n else 1 end;
end $$;
revoke all on function public.sb_edit_sample_metadata(uuid,jsonb,jsonb,integer) from public;
grant execute on function public.sb_edit_sample_metadata(uuid,jsonb,jsonb,integer) to anon;

-- 이전 기기의 오래된 단어 정보가 공용 목록에 혼입되는 것을 막는다.
create or replace function public.sb_guard_sign_metadata() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.is_test = false then
    perform pg_advisory_xact_lock(hashtext('sb-edit:' || new.sign_id));
    if exists(select 1 from public.sb_retired_sign_ids where sign_id=new.sign_id) then raise exception '변경된 이전 표현 ID입니다. 최신 단어 정보를 확인하세요'; end if;
    if exists(select 1 from public.sign_samples s where s.is_test=false and s.sign_id=new.sign_id and (s.language <> new.language or s.label <> new.label or s.concept_id <> new.concept_id or s.sign_metadata <> new.sign_metadata)) then
      raise exception '같은 표현 ID의 공용 단어 정보가 다릅니다. 최신 단어 정보를 확인하세요';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sb_sign_metadata_guard on public.sign_samples;
create trigger sb_sign_metadata_guard before insert on public.sign_samples for each row execute function public.sb_guard_sign_metadata();
