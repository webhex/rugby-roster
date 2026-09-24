-- Letting people delete accounts.
--
-- A volunteer can delete their own account. An admin can delete anyone's.
-- Run this after ownership.sql, which this depends on.
--
-- Safe to run more than once.
--
-- Why a function rather than the admin API. Removing a row from auth.users
-- normally needs the service_role key, which would mean putting a key that
-- bypasses every security policy into the hosting environment, and a server
-- route to use it from. A security definer function keeps the whole thing in
-- the database, alongside every other rule in this app, and adds no secret to
-- manage.
--
-- That relies on the function's owner being allowed to delete from auth.users.
-- Check before trusting it:
--
--   select has_table_privilege('postgres', 'auth.users', 'delete');
--
-- If that returns false, this approach will not work in your project and the
-- service_role route is the fallback.

begin;

-- ---------------------------------------------------------------------------
-- Delete an account
-- ---------------------------------------------------------------------------
-- Pass the volunteer's id, not the auth user id, because that is what the
-- interface already has to hand.
--
-- Three things can refuse the deletion:
--
--   1. here, if you are neither an admin nor the person being deleted
--   2. here, if it would leave the club with no admin
--   3. the before_auth_user_deleted trigger from ownership.sql, if they still
--      own events. Its message explains what to do, and it is raised rather
--      than caught so the caller sees it.
--
-- What goes with the account: the volunteer row, because
-- volunteers.auth_user_id cascades from auth.users, and every shift sign-up,
-- because assignments.volunteer_id cascades from volunteers. Shifts and events
-- survive. Shifts they were covering show one fewer name.

create or replace function public.delete_account(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.volunteers;
  remaining_admins int;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into target from public.volunteers where id = target_id;
  if not found then raise exception 'That account no longer exists.'; end if;

  -- Either this is your own account, or you are an admin.
  if not (public.is_admin() or target.auth_user_id = auth.uid()) then
    raise exception 'You can only delete your own account.';
  end if;

  -- The same rule set_admin_status already enforces: somebody has to be able
  -- to administer the club. Applies equally to an admin deleting themselves
  -- and to an admin deleting the only other admin.
  if target.is_admin then
    select count(*) into remaining_admins from public.volunteers where is_admin;
    if remaining_admins <= 1 then
      raise exception 'The club must keep at least one admin. Make somebody else an admin first.';
    end if;
  end if;

  delete from auth.users where id = target.auth_user_id;
end;
$$;

revoke all on function public.delete_account(uuid) from public;
grant execute on function public.delete_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- How many events somebody owns
-- ---------------------------------------------------------------------------
-- So the interface can warn before the attempt rather than relying on the
-- trigger's refusal. Readable by an admin, or about yourself.

create or replace function public.owned_event_count(target_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.events e
  where e.created_by = target_id
    and (
      public.is_admin()
      or exists (
        select 1 from public.volunteers v
        where v.id = target_id and v.auth_user_id = auth.uid()
      )
    )
$$;

revoke all on function public.owned_event_count(uuid) from public;
grant execute on function public.owned_event_count(uuid) to authenticated;

commit;
