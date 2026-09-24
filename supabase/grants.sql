-- Table privileges for logged-in users.
--
-- schema.sql enabled row-level security and created policies, but never
-- granted the underlying table privileges to the `authenticated` role. RLS
-- decides *which rows* a user may touch; grants decide whether the role may
-- touch the table at all. Without these, PostgREST answers 403 Forbidden on
-- every request, which is why the app could not read your own profile row.
--
-- The signup trigger still worked because it runs as security definer and so
-- bypasses grants entirely. That is why a volunteers row existed while the app
-- insisted you were nobody.
--
-- These grants do not weaken security. Every policy in schema.sql still
-- applies on top of them.
--
-- Safe to run more than once.

grant usage on schema public to authenticated;

-- Read own row and, for admins, everyone's. Names of others are needed to
-- render who is on each shift.
grant select on public.volunteers to authenticated;

-- Any logged-in user may create events; policies restrict editing and
-- deleting to the owner or an admin.
grant select, insert, update, delete on public.events to authenticated;

-- Shift times are edited inline. New shifts are inserted by the
-- add_shift_with_split function, and the default shift by the
-- after_event_created trigger, so no insert grant is required here.
grant select, update on public.shifts to authenticated;

-- Volunteers add and remove their own sign-ups; policies enforce that it is
-- only ever their own, unless they are an admin.
grant select, insert, delete on public.assignments to authenticated;

-- The invite code is read on load and rotated by admins.
grant select, update on public.club_settings to authenticated;
