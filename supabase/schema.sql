create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(), name text not null, phone text, remarks text,
  is_admin boolean not null default false, auth_user_id uuid unique not null references auth.users(id) on delete cascade
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), description text not null, date date not null,
  start_time timestamp not null, end_time timestamp not null, created_by uuid not null references public.volunteers(id) on delete restrict
);
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  start_time timestamp not null, end_time timestamp not null, remarks text
);
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.shifts(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade, created_at timestamptz not null default now(),
  unique (shift_id, volunteer_id)
);
create table if not exists public.club_settings (id uuid primary key default gen_random_uuid(), invite_code text not null);

alter table public.volunteers enable row level security; alter table public.events enable row level security;
alter table public.shifts enable row level security; alter table public.assignments enable row level security; alter table public.club_settings enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.volunteers where auth_user_id = auth.uid() and is_admin) $$;
create or replace function public.validate_invite_code(candidate text) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.club_settings where invite_code = candidate) $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.volunteers (name, phone, remarks, is_admin, auth_user_id) values (coalesce(new.raw_user_meta_data->>'name','Volunteer'), new.raw_user_meta_data->>'phone', new.raw_user_meta_data->>'remarks', not exists (select 1 from public.volunteers), new.id); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create policy volunteers_read on public.volunteers for select using (public.is_admin() or auth.uid() = auth_user_id);
create policy volunteers_name_read on public.volunteers for select using (auth.uid() is not null);
create policy volunteers_admin on public.volunteers for all using (public.is_admin()) with check (public.is_admin());
create policy events_read on public.events for select using (auth.uid() is not null);
create policy events_insert on public.events for insert with check (auth.uid() is not null and (public.is_admin() or created_by = (select id from public.volunteers where auth_user_id = auth.uid())));
create policy events_owner_update on public.events for update using (public.is_admin() or created_by = (select id from public.volunteers where auth_user_id = auth.uid())) with check (public.is_admin() or created_by = (select id from public.volunteers where auth_user_id = auth.uid()));
create policy events_owner_delete on public.events for delete using (public.is_admin() or created_by = (select id from public.volunteers where auth_user_id = auth.uid()));
create policy shifts_read on public.shifts for select using (auth.uid() is not null);
create policy shifts_insert on public.shifts for insert with check (auth.uid() is not null);
create policy shifts_update on public.shifts for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy shifts_delete on public.shifts for delete using (public.is_admin());
create policy shifts_admin on public.shifts for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.add_shift_with_split(target_event_id uuid, new_start timestamp, new_remarks text default null)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  containing_shift public.shifts;
  created_shift public.shifts;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into event_row from public.events where id = target_event_id;
  if event_row.id is null then raise exception 'event not found'; end if;
  select * into containing_shift
  from public.shifts
  where event_id = target_event_id and start_time <= new_start and end_time > new_start
  order by start_time desc
  limit 1
  for update;
  if containing_shift.id is not null then
    update public.shifts set end_time = new_start where id = containing_shift.id;
  end if;
  insert into public.shifts (event_id, start_time, end_time, remarks)
  values (target_event_id, new_start, event_row.end_time, new_remarks)
  returning * into created_shift;
  return created_shift;
end;
$$;
revoke all on function public.add_shift_with_split(uuid, timestamp, text) from public;
grant execute on function public.add_shift_with_split(uuid, timestamp, text) to authenticated;

create or replace function public.create_default_shift() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.shifts (event_id, start_time, end_time) values (new.id, new.start_time, new.end_time); return new; end; $$;
drop trigger if exists after_event_created on public.events;
create trigger after_event_created after insert on public.events for each row execute function public.create_default_shift();
create policy assignments_read on public.assignments for select using (auth.uid() is not null);
create policy assignments_self_insert on public.assignments for insert with check (public.is_admin() or volunteer_id = (select id from public.volunteers where auth_user_id = auth.uid()));
create policy assignments_self_delete on public.assignments for delete using (public.is_admin() or volunteer_id = (select id from public.volunteers where auth_user_id = auth.uid()));
create policy assignments_admin on public.assignments for all using (public.is_admin()) with check (public.is_admin());
create policy settings_admin on public.club_settings for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.import_events(rows jsonb) returns void language plpgsql security definer set search_path = '' as $$ begin if not public.is_admin() then raise exception 'admin required'; end if; insert into public.events (description, date, start_time, end_time, created_by) select r.description, r.date::date, (r.date || 'T' || r.start_time || ':00')::timestamp, (r.date || 'T' || r.end_time || ':00')::timestamp, (select id from public.volunteers where auth_user_id = auth.uid()) from jsonb_to_recordset(rows) as r(description text, date text, start_time text, end_time text); end; $$;
revoke all on function public.import_events(jsonb) from public;
grant execute on function public.import_events(jsonb) to authenticated;

-- Seed this row with the club's real invite code before opening registration.
insert into public.club_settings (invite_code) select 'CHANGE-ME' where not exists (select 1 from public.club_settings);

create or replace function public.set_admin_status(target_id uuid, next_status boolean) returns void language plpgsql security definer set search_path = '' as $$
declare admin_count integer;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if target_id = (select id from public.volunteers where auth_user_id = auth.uid()) then raise exception 'cannot change own status'; end if;
  select count(*) into admin_count from public.volunteers where is_admin;
  if not next_status and admin_count <= 1 then raise exception 'at least one admin required'; end if;
  update public.volunteers set is_admin = next_status where id = target_id;
end; $$;
revoke all on function public.set_admin_status(uuid, boolean) from public;
grant execute on function public.set_admin_status(uuid, boolean) to authenticated;

create or replace function public.admin_volunteers() returns table(id uuid, name text, email text, phone text, remarks text, is_admin boolean, auth_user_id uuid) language sql security definer set search_path = '' as $$
  select v.id, v.name, u.email, v.phone, v.remarks, v.is_admin, v.auth_user_id from public.volunteers v join auth.users u on u.id = v.auth_user_id where public.is_admin() order by v.name;
$$;
revoke all on function public.admin_volunteers() from public;
grant execute on function public.admin_volunteers() to authenticated;

-- Admin status changes must go through the guarded function; prevent direct client updates.
drop policy if exists volunteers_admin on public.volunteers;
drop policy if exists volunteers_admin_select on public.volunteers;
create policy volunteers_admin_select on public.volunteers for select using (public.is_admin());

-- Table privileges for the authenticated role. Without these, PostgREST
-- returns 403 on every request regardless of the policies above.
grant usage on schema public to authenticated;
grant select on public.volunteers to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, update on public.shifts to authenticated;
grant select, insert, delete on public.assignments to authenticated;
grant select, update on public.club_settings to authenticated;

-- Contact details are restricted to admins in the database, not just the UI.
-- Row-level security cannot filter columns, so the table is self-plus-admin and
-- other people's names are served by roster_assignments() instead.
drop policy if exists volunteers_name_read on public.volunteers;

create or replace function public.roster_assignments()
returns table (id uuid, shift_id uuid, volunteer_id uuid, volunteer_name text, phone text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.shift_id, a.volunteer_id, v.name,
         case when public.is_admin() then v.phone else null end
  from public.assignments a join public.volunteers v on v.id = a.volunteer_id
  where auth.uid() is not null
$$;

revoke all on function public.roster_assignments() from public;
grant execute on function public.roster_assignments() to authenticated;
