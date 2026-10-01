-- Shows who hosts each event.
--
-- Run this after schema.sql, grants.sql, privacy-fix.sql and ownership.sql.
--
-- events.created_by holds the host's volunteer id, but privacy-fix.sql narrowed
-- public.volunteers to "own row or admin", so a volunteer reading the events
-- table gets an id it cannot turn into a name. assignable_volunteers() would
-- answer, but only for someone who already manages an event, which is the
-- wrong audience: every volunteer should be able to see who to ask about a
-- fixture.
--
-- So the host's name comes back from a function that returns nothing else. No
-- phone, no email, no remarks — a name is all the roster needs to show.
--
-- Safe to run more than once.

create or replace function public.event_hosts()
returns table (
  event_id uuid,
  host_id uuid,
  host_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, v.id, v.name
  from public.events e
  join public.volunteers v on v.id = e.created_by
  where auth.uid() is not null
$$;

revoke all on function public.event_hosts() from public;
grant execute on function public.event_hosts() to authenticated;
