-- User approved anonymous archive/restore on 2026-10-25.
-- Raw sample content is immutable; this is recoverable exclusion, not erasure.
begin;
alter table public.sign_samples add column if not exists archived boolean not null default false;
grant update (archived) on public.sign_samples to anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sign_samples' and policyname = 'sb_anon_archive') then
    create policy sb_anon_archive on public.sign_samples for update to anon using (true) with check (true);
  end if;
end $$;
create index if not exists sign_samples_active_language_idx on public.sign_samples(archived, language, id);
notify pgrst, 'reload schema';
commit;
select has_column_privilege('anon','public.sign_samples','archived','UPDATE') as archive_allowed,
       has_column_privilege('anon','public.sign_samples','frames','UPDATE') as raw_update_allowed,
       has_table_privilege('anon','public.sign_samples','DELETE') as permanent_delete_allowed;
