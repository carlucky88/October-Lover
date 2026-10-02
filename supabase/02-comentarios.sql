-- October Lover — comentarios y reacciones
-- Pégalo en Supabase → SQL Editor → consulta nueva (+) → Run.
-- Es seguro ejecutarlo más de una vez.

create table if not exists public.memory_comments (
  id          uuid primary key,
  memory_id   uuid not null references public.memories(id) on delete cascade,
  couple_id   uuid not null references public.couples(id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '',
  kind        text not null check (kind in ('reaction', 'comment')),
  body        text not null check (char_length(body) between 1 and 500),
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists memory_comments_couple_updated on public.memory_comments(couple_id, updated_at);

drop trigger if exists memory_comments_touch on public.memory_comments;
create trigger memory_comments_touch before insert or update on public.memory_comments
  for each row execute function public.touch_updated_at();

alter table public.memory_comments enable row level security;

drop policy if exists "comments: ver los de mi pareja" on public.memory_comments;
create policy "comments: ver los de mi pareja" on public.memory_comments
  for select to authenticated using (public.is_member(couple_id));

drop policy if exists "comments: crear los míos" on public.memory_comments;
create policy "comments: crear los míos" on public.memory_comments
  for insert to authenticated with check (public.is_member(couple_id) and author_id = auth.uid());

drop policy if exists "comments: editar los míos" on public.memory_comments;
create policy "comments: editar los míos" on public.memory_comments
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_member(couple_id));

do $$
begin
  alter publication supabase_realtime add table public.memory_comments;
exception when duplicate_object then null;
end $$;
