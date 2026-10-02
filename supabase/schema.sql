-- October Lover — esquema de Supabase
-- Pégalo completo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: puedes volver a ejecutarlo sin perder datos.

-- ───────────── Tablas ─────────────

-- Si existe una tabla memories de un intento anterior (sin couple_id), se reemplaza.
-- No toca una tabla memories que ya tenga el formato de este esquema.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'memories')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memories' and column_name = 'couple_id') then
    drop table public.memories cascade;
  end if;
end $$;

create table if not exists public.couples (
  id               uuid primary key default gen_random_uuid(),
  invite_code      text not null unique,
  prompt_seed      integer not null,
  prompt_overrides jsonb not null default '{}'::jsonb,
  created_by       uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id    uuid not null references public.couples(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at    timestamptz not null default now(),
  primary key (couple_id, user_id)
);
create unique index if not exists couple_members_one_couple_per_user on public.couple_members(user_id);

create table if not exists public.memories (
  id           uuid primary key,
  couple_id    uuid not null references public.couples(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name  text not null default '',
  day          smallint not null check (day between 1 and 31),
  prompt_index smallint not null,
  title        text not null default '',
  content      text not null default '',
  media_path   text,
  media_type   text check (media_type in ('image', 'video')),
  deleted      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists memories_couple_updated on public.memories(couple_id, updated_at);

-- updated_at lo pone siempre el servidor: la sincronización incremental depende de él.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists memories_touch on public.memories;
create trigger memories_touch before insert or update on public.memories
  for each row execute function public.touch_updated_at();

-- ───────────── Funciones ─────────────

-- security definer evita recursión de RLS al consultar couple_members desde sus propias políticas.
create or replace function public.is_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.create_couple(p_name text, p_seed integer)
returns public.couples
language plpgsql security definer set search_path = public as $$
declare
  c public.couples;
  code text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a una pareja';
  end if;
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from couples where invite_code = code);
  end loop;
  insert into couples (invite_code, prompt_seed, created_by)
    values (code, p_seed, auth.uid()) returning * into c;
  insert into couple_members (couple_id, user_id, display_name)
    values (c.id, auth.uid(), coalesce(p_name, ''));
  return c;
end $$;

create or replace function public.join_couple(p_code text, p_name text)
returns public.couples
language plpgsql security definer set search_path = public as $$
declare
  c public.couples;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into c from couples where invite_code = upper(trim(p_code));
  if not found then raise exception 'Código no válido'; end if;
  if exists (select 1 from couple_members where couple_id = c.id and user_id = auth.uid()) then
    return c;
  end if;
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    raise exception 'Ya perteneces a otra pareja';
  end if;
  if (select count(*) from couple_members where couple_id = c.id) >= 2 then
    raise exception 'Esta pareja ya está completa';
  end if;
  insert into couple_members (couple_id, user_id, display_name)
    values (c.id, auth.uid(), coalesce(p_name, ''));
  return c;
end $$;

grant execute on function public.create_couple(text, integer) to authenticated;
grant execute on function public.join_couple(text, text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- ───────────── Seguridad (RLS) ─────────────

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.memories enable row level security;

drop policy if exists "couples: ver la mía" on public.couples;
create policy "couples: ver la mía" on public.couples
  for select to authenticated using (public.is_member(id));

drop policy if exists "couples: editar la mía" on public.couples;
create policy "couples: editar la mía" on public.couples
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists "members: ver los de mi pareja" on public.couple_members;
create policy "members: ver los de mi pareja" on public.couple_members
  for select to authenticated using (public.is_member(couple_id));

drop policy if exists "members: cambiar mi nombre" on public.couple_members;
create policy "members: cambiar mi nombre" on public.couple_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "memories: ver los de mi pareja" on public.memories;
create policy "memories: ver los de mi pareja" on public.memories
  for select to authenticated using (public.is_member(couple_id));

drop policy if exists "memories: crear los míos" on public.memories;
create policy "memories: crear los míos" on public.memories
  for insert to authenticated with check (public.is_member(couple_id) and author_id = auth.uid());

drop policy if exists "memories: editar los míos" on public.memories;
create policy "memories: editar los míos" on public.memories
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_member(couple_id));

-- Solo se permite editar el nombre y los temas cambiados; lo demás lo controlan las funciones.
revoke update on public.couples from authenticated;
grant update (prompt_overrides) on public.couples to authenticated;
revoke update on public.couple_members from authenticated;
grant update (display_name) on public.couple_members to authenticated;

-- ───────────── Tiempo real ─────────────

do $$
begin
  alter publication supabase_realtime add table public.memories;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.couples;
exception when duplicate_object then null;
end $$;

-- ───────────── Archivos (fotos y videos) ─────────────
-- Bucket privado; cada archivo vive en media/<couple_id>/<memory_id>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: ver de mi pareja" on storage.objects;
create policy "media: ver de mi pareja" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "media: subir a mi pareja" on storage.objects;
create policy "media: subir a mi pareja" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "media: reemplazar lo mío" on storage.objects;
create policy "media: reemplazar lo mío" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and owner_id = auth.uid()::text);

drop policy if exists "media: borrar lo mío" on storage.objects;
create policy "media: borrar lo mío" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and owner_id = auth.uid()::text);

-- ───────────── Comentarios y reacciones ─────────────

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

-- ───────────── Cambio de tema y notificaciones ─────────────

-- ───────────── Solicitudes para cambiar el tema del día ─────────────

create table if not exists public.topic_requests (
  id             uuid primary key,
  couple_id      uuid not null references public.couples(id) on delete cascade,
  day            smallint not null check (day between 1 and 31),
  requested_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requester_name text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid references auth.users(id) on delete set null,
  new_prompt     smallint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists topic_requests_couple_day on public.topic_requests(couple_id, day);

drop trigger if exists topic_requests_touch on public.topic_requests;
create trigger topic_requests_touch before insert or update on public.topic_requests
  for each row execute function public.touch_updated_at();

alter table public.topic_requests enable row level security;

drop policy if exists "topic: ver los de mi pareja" on public.topic_requests;
create policy "topic: ver los de mi pareja" on public.topic_requests
  for select to authenticated using (public.is_member(couple_id));

drop policy if exists "topic: pedir" on public.topic_requests;
create policy "topic: pedir" on public.topic_requests
  for insert to authenticated with check (public.is_member(couple_id) and requested_by = auth.uid());

-- Quien pidió puede cancelar; la pareja aprueba o rechaza.
drop policy if exists "topic: responder" on public.topic_requests;
create policy "topic: responder" on public.topic_requests
  for update to authenticated
  using (public.is_member(couple_id))
  with check (public.is_member(couple_id));

do $$
begin
  alter publication supabase_realtime add table public.topic_requests;
exception when duplicate_object then null;
end $$;

-- ───────────── Suscripciones a notificaciones push ─────────────

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  couple_id  uuid not null references public.couples(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- La función "notify" lee las suscripciones de la pareja con la sesión de quien envía.
drop policy if exists "push: ver las de mi pareja" on public.push_subscriptions;
create policy "push: ver las de mi pareja" on public.push_subscriptions
  for select to authenticated using (public.is_member(couple_id));

drop policy if exists "push: registrar la mía" on public.push_subscriptions;
create policy "push: registrar la mía" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid() and public.is_member(couple_id));

drop policy if exists "push: actualizar la mía" on public.push_subscriptions;
create policy "push: actualizar la mía" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(couple_id));

-- Se permite borrar suscripciones vencidas de la pareja (el teléfono ya no las acepta).
drop policy if exists "push: borrar de mi pareja" on public.push_subscriptions;
create policy "push: borrar de mi pareja" on public.push_subscriptions
  for delete to authenticated using (public.is_member(couple_id));
