-- Restricts volunteer contact details to admins, in the database rather than
-- only in the interface.
--
-- The problem: schema.sql contained
--
--   create policy volunteers_name_read on public.volunteers
--     for select using (auth.uid() is not null);
--
-- which let any logged-in volunteer read every column of every volunteer row,
-- phone and remarks included. The app only displayed names, but anyone able to
-- open a browser console could read the club's phone numbers directly.
--
-- Postgres row-level security filters rows, never columns, so the policy could
-- not be narrowed to "names only". Instead the table becomes self-plus-admin,
-- and other people's names are served by a function that returns nothing else.
--
-- Safe to run more than once.

-- 1. Remove the blanket read.
drop policy if exists volunteers_name_read on public.volunteers;

-- What remains on public.volunteers:
--   volunteers_read         select where own row or admin
--   volunteers_admin_select select where admin
-- So a volunteer can now read only themselves.

-- 2. Serve the roster without exposing the table.
--
-- Returns who is on which shift. Names are visible to any logged-in user,
-- because the roster is the point of the app. Phone numbers come back only for
-- admins; everyone else gets null, decided here and not in the UI.
create or replace function public.roster_assignments()
returns table (
  id uuid,
  shift_id uuid,
  volunteer_id uuid,
  volunteer_name text,
  phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.shift_id,
    a.volunteer_id,
    v.name,
    case when public.is_admin() then v.phone else null end
  from public.assignments a
  join public.volunteers v on v.id = a.volunteer_id
  where auth.uid() is not null
$$;

revoke all on function public.roster_assignments() from public;
grant execute on function public.roster_assignments() to authenticated;
