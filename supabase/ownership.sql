-- Event ownership and shift permissions.
--
-- Implements SPEC-ownership.md. Run this after schema.sql, grants.sql and
-- privacy-fix.sql, on a database that already has those three.
--
-- What changes:
--   * volunteers can no longer add, edit or delete shifts
--   * an event's owner can, on their own events, exactly as an admin can
--   * an owner can add and remove other volunteers on their own events
--   * an owner sees phone and email for people on their own events only
--   * an owner can hand the event to another volunteer
--   * deleting a shift gives its time back to the neighbouring shift
--   * deleting an account that owns events is refused with a readable message
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership helpers
-- ---------------------------------------------------------------------------
-- The join from a shift back to its event's owner appears in four policies and
-- three functions, so it lives in one place. Both mirror public.is_admin():
-- security definer, so they can read the tables regardless of the caller's own
-- row-level security, and they answer only about the caller. Someone asking
-- "do I own this?" about an event they do not own gets false and learns
-- nothing else.

create or replace function public.owns_event(target_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.events e
    join public.volunteers v on v.id = e.created_by
    where e.id = target_event_id and v.auth_user_id = auth.uid()
  )
$$;

create or replace function public.owns_event_of_shift(target_shift_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.shifts s
    join public.events e on e.id = s.event_id
    join public.volunteers v on v.id = e.created_by
    where s.id = target_shift_id and v.auth_user_id = auth.uid()
  )
$$;

-- Used only in the events update policy below. See the comment there for why a
-- plain subquery cannot do this job.
create or replace function public.is_volunteer_id(target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.volunteers where id = target_id)
$$;

-- ---------------------------------------------------------------------------
-- 2. Shifts: admin or owner only
-- ---------------------------------------------------------------------------
-- All three policies previously read `auth.uid() is not null`, which is to say
-- any logged-in volunteer could reshape anyone's event.

drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts for insert
  with check (public.is_admin() or public.owns_event(event_id));

drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts for update
  using (public.is_admin() or public.owns_event(event_id))
  with check (public.is_admin() or public.owns_event(event_id));

drop policy if exists shifts_delete on public.shifts;
create policy shifts_delete on public.shifts for delete
  using (public.is_admin() or public.owns_event(event_id));

-- No grant is added for insert or delete on public.shifts, and that is
-- deliberate. Both go through security definer functions —
-- add_shift_with_split and delete_shift — which bypass grants anyway. The
-- policies above are a second line of defence in case a grant is ever added
-- later. Only `update` is granted, from grants.sql, and the policy now
-- restricts who it applies to.

-- ---------------------------------------------------------------------------
-- 3. Adding a shift must check the caller
-- ---------------------------------------------------------------------------
-- Tightening shifts_insert above is not enough on its own.
-- add_shift_with_split is security definer, so it ignores row-level security
-- completely. Until this guard existed, any logged-in volunteer could call it
-- from the browser console and add a shift to anyone's event.
--
-- Unchanged from schema.sql apart from the one new check. Guard style copied
-- from import_events, which already refuses non-admins this way.

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
  if not (public.is_admin() or public.owns_event(target_event_id)) then
    raise exception 'only an admin or the event owner can add a shift';
  end if;
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

-- ---------------------------------------------------------------------------
-- 4. Deleting a shift, giving its time back
-- ---------------------------------------------------------------------------
-- The inverse of add_shift_with_split. Deleting 15:00-18:00 from an event that
-- runs 12:00-18:00 in two shifts leaves one shift of 12:00-18:00, not a hole.
--
-- The whole thing is one function rather than a delete and an update from the
-- browser, because a half-finished pair of calls would leave an event with
-- time nobody is covering.
--
-- Overlapping shifts are allowed in this app, so "previous" is defined only by
-- start time: the latest start that is strictly earlier than this one. Same
-- rule add_shift_with_split uses.

create or replace function public.delete_shift(target_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  doomed public.shifts;
  neighbour public.shifts;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into doomed from public.shifts where id = target_shift_id for update;
  if not found then raise exception 'shift not found'; end if;

  if not (public.is_admin() or public.owns_event_of_shift(target_shift_id)) then
    raise exception 'only an admin or the event owner can delete a shift';
  end if;

  -- The shift before this one stretches forward over the gap.
  select * into neighbour
  from public.shifts
  where event_id = doomed.event_id
    and id <> doomed.id
    and start_time < doomed.start_time
  order by start_time desc
  limit 1
  for update;

  if found then
    -- Only ever extend. Deleting a shift must not shorten another one, which
    -- it would if the neighbour already ended later because of an overlap.
    update public.shifts
       set end_time = doomed.end_time
     where id = neighbour.id and end_time < doomed.end_time;
  else
    -- Nothing before it, so this was the event's first shift. The one after it
    -- starts earlier instead, so the event still begins when it says it does.
    select * into neighbour
    from public.shifts
    where event_id = doomed.event_id
      and id <> doomed.id
      and start_time > doomed.start_time
    order by start_time asc
    limit 1
    for update;

    if found then
      update public.shifts
         set start_time = doomed.start_time
       where id = neighbour.id;
    end if;
    -- If neither exists this was the only shift, and the event is left with
    -- none. That is allowed; the owner can add one back.
  end if;

  -- Sign-ups on this shift go with it: assignments.shift_id is declared
  -- on delete cascade. The interface warns and names the count first.
  delete from public.shifts where id = doomed.id;
end;
$$;

revoke all on function public.delete_shift(uuid) from public;
grant execute on function public.delete_shift(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assignments: owners manage their own event's volunteers
-- ---------------------------------------------------------------------------
-- Previously admin-or-self. Now admin, or the owner of the event the shift
-- belongs to, or the volunteer themselves. A volunteer still changes only
-- their own sign-up, and only ever on shifts, never on other people.

drop policy if exists assignments_self_insert on public.assignments;
create policy assignments_self_insert on public.assignments for insert
  with check (
    public.is_admin()
    or public.owns_event_of_shift(shift_id)
    or volunteer_id = (select id from public.volunteers where auth_user_id = auth.uid())
  );

drop policy if exists assignments_self_delete on public.assignments;
create policy assignments_self_delete on public.assignments for delete
  using (
    public.is_admin()
    or public.owns_event_of_shift(shift_id)
    or volunteer_id = (select id from public.volunteers where auth_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. Events: allow the owner to hand the event on
-- ---------------------------------------------------------------------------
-- An update policy tests the row twice: `using` as it is now, `with check` as
-- it will be afterwards. The old policy applied the same test to both, so a
-- handover always failed — `using` passed because I own the row, then
-- `with check` rejected it because afterwards I do not.
--
-- `using` is unchanged and is what provides the security: only an admin or the
-- current owner may touch the row at all. `with check` now only confirms the
-- new owner is a real volunteer.
--
-- That check cannot be a plain subquery. `select id from public.volunteers`
-- inside a policy runs with the caller's own privileges, and row-level
-- security on volunteers means a volunteer sees only themselves — so the check
-- would pass only when handing the event to yourself, which is not a handover.
-- is_volunteer_id is security definer and sees the whole table.

drop policy if exists events_owner_update on public.events;
create policy events_owner_update on public.events for update
  using (
    public.is_admin()
    or created_by = (select id from public.volunteers where auth_user_id = auth.uid())
  )
  with check (public.is_volunteer_id(created_by));

-- ---------------------------------------------------------------------------
-- 7. The roster, now with contact details for owners
-- ---------------------------------------------------------------------------
-- Replaces the version from privacy-fix.sql. Two changes: an owner sees
-- contact details for people on their own events, and email comes from here
-- rather than from the admin-only admin_volunteers() list, so the interface no
-- longer needs an admin call to show an owner an email address.
--
-- The caller is resolved once, in `me`, instead of calling is_admin() per row.
-- Starting the joins from `me` also enforces being logged in: no volunteer row
-- for auth.uid() means no rows at all.
--
-- The return type gains a column, and create or replace cannot change a
-- function's output columns, so it has to be dropped first.

drop function if exists public.roster_assignments();

create or replace function public.roster_assignments()
returns table (
  id uuid,
  shift_id uuid,
  volunteer_id uuid,
  volunteer_name text,
  phone text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select id, is_admin from public.volunteers where auth_user_id = auth.uid()
  )
  select
    a.id,
    a.shift_id,
    a.volunteer_id,
    v.name,
    case when m.is_admin or e.created_by = m.id then v.phone end,
    case when m.is_admin or e.created_by = m.id then u.email::text end
  from me m
  cross join public.assignments a
  join public.shifts s on s.id = a.shift_id
  join public.events e on e.id = s.event_id
  join public.volunteers v on v.id = a.volunteer_id
  join auth.users u on u.id = v.auth_user_id
$$;

revoke all on function public.roster_assignments() from public;
grant execute on function public.roster_assignments() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Names an owner may pick from
-- ---------------------------------------------------------------------------
-- To put somebody on a shift, or to hand an event over, an owner needs a list
-- of volunteers. The only existing list is admin_volunteers(), which returns
-- phone, email and remarks and is admin-gated. Opening that up would undo the
-- privacy fix, so this returns names and nothing else, and only to the owner
-- of the event named or to an admin. Anyone else gets no rows.

create or replace function public.assignable_volunteers(target_event_id uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name
  from public.volunteers v
  where public.is_admin() or public.owns_event(target_event_id)
  order by v.name
$$;

revoke all on function public.assignable_volunteers(uuid) from public;
grant execute on function public.assignable_volunteers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Refuse to delete somebody who owns events
-- ---------------------------------------------------------------------------
-- events.created_by is `on delete restrict` while volunteers.auth_user_id is
-- `on delete cascade` from auth.users, so deleting a login cascades into the
-- volunteer row, hits the restrict, and aborts with a foreign key error that
-- explains nothing.
--
-- The restrict stays — it stops somebody leaving the club and silently taking
-- a fixture's bar cover with them. This only replaces the error with an
-- instruction.
--
-- It has to be a trigger rather than a check in the app, because the app has
-- no way to delete an account at all. It happens in the Supabase dashboard,
-- under Authentication -> Users, and a trigger is on that path too.
-- schema.sql already puts an after insert trigger on auth.users, so this
-- follows a pattern the schema uses.

create or replace function public.block_delete_of_event_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  volunteer_name text;
  owned_count int;
begin
  select v.name into volunteer_name
  from public.volunteers v
  where v.auth_user_id = old.id;

  -- No volunteer row, so nothing of ours to protect.
  if not found then return old; end if;

  select count(*) into owned_count
  from public.events e
  join public.volunteers v on v.id = e.created_by
  where v.auth_user_id = old.id;

  if owned_count > 0 then
    raise exception
      '% owns % event(s). Hand those to another volunteer first, then delete this account.',
      volunteer_name, owned_count;
  end if;

  -- Their shift sign-ups go with them, because assignments.volunteer_id is
  -- on delete cascade. The shifts themselves survive, one name shorter.
  return old;
end;
$$;

drop trigger if exists before_auth_user_deleted on auth.users;
create trigger before_auth_user_deleted
  before delete on auth.users
  for each row execute function public.block_delete_of_event_owner();

commit;
