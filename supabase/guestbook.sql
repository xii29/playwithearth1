-- Supabase SQL Editor에서 실행하세요. 같은 스크립트를 다시 실행해도 됩니다.
begin;
create table if not exists public.guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists guestbook_entries_created_at_idx
  on public.guestbook_entries (created_at desc, id desc);
alter table public.guestbook_entries enable row level security;
-- 공개 방문자는 읽기와 이름/메시지 작성만 가능. ID/작성 시각은 DB가 생성합니다.
revoke all on public.guestbook_entries from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.guestbook_entries to anon, authenticated;
grant insert (name, message) on public.guestbook_entries to anon, authenticated;
drop policy if exists guestbook_public_read on public.guestbook_entries;
create policy guestbook_public_read on public.guestbook_entries
  for select to anon, authenticated using (true);
drop policy if exists guestbook_public_insert on public.guestbook_entries;
create policy guestbook_public_insert on public.guestbook_entries
  for insert to anon, authenticated with check (
    char_length(btrim(name)) between 1 and 30
    and char_length(btrim(message)) between 1 and 500
    and name ~ '[^[:space:]]' and message ~ '[^[:space:]]'
  );
-- 다른 브라우저의 새 글도 실시간 수신합니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'guestbook_entries'
  ) then
    alter publication supabase_realtime add table public.guestbook_entries;
  end if;
end $$;
commit;
