-- 실제 샘플 DELETE + 과거 로컬 사본의 같은 UUID 재등록 방지. 기존 샘플은 삭제하지 않습니다.
begin;
create table if not exists public.sign_sample_deletions (
  id uuid primary key,
  deleted_at timestamptz not null default now()
);
alter table public.sign_sample_deletions enable row level security;
revoke all on public.sign_sample_deletions from public, anon, authenticated;
grant select on public.sign_sample_deletions to anon;
drop policy if exists sb_deletion_read on public.sign_sample_deletions;
create policy sb_deletion_read on public.sign_sample_deletions for select to anon using (true);

create or replace function public.sb_guard_sample_deletion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare sample_key uuid;
begin
  sample_key := case when tg_op = 'DELETE' then old.id else new.id end;
  -- Serialize INSERT/DELETE for this UUID, including a delayed upload on another device.
  perform pg_advisory_xact_lock(hashtextextended(sample_key::text, 0));
  if tg_op = 'DELETE' then
    insert into public.sign_sample_deletions(id) values (old.id) on conflict (id) do nothing;
    return old;
  end if;
  if exists (select 1 from public.sign_sample_deletions where id = new.id) then
    raise exception 'SB_SAMPLE_DELETED: this sample UUID was permanently deleted' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.sb_guard_sample_deletion() from public, anon, authenticated;
drop trigger if exists sb_sample_delete_guard on public.sign_samples;
create trigger sb_sample_delete_guard before delete on public.sign_samples for each row execute function public.sb_guard_sample_deletion();
drop trigger if exists sb_sample_insert_guard on public.sign_samples;
create trigger sb_sample_insert_guard before insert on public.sign_samples for each row execute function public.sb_guard_sample_deletion();
grant delete on public.sign_samples to anon;
drop policy if exists sb_anon_delete on public.sign_samples;
create policy sb_anon_delete on public.sign_samples for delete to anon using (true);
notify pgrst, 'reload schema';
commit;
select has_table_privilege('anon','public.sign_samples','DELETE') as delete_allowed,
       has_column_privilege('anon','public.sign_samples','frames','UPDATE') as raw_update_allowed;
