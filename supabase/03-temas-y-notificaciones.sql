-- October Lover — solicitudes de cambio de tema y notificaciones push
-- Pégalo en Supabase → SQL Editor → consulta nueva (+) → Run.
-- Es seguro ejecutarlo más de una vez.

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
