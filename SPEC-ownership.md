# Spec: event ownership and shift permissions

A change to who may do what. The app already has an owner concept; this spec
makes the owner genuinely powerful, and takes away powers volunteers were never
meant to have.

Status: specification only. Nothing here is built yet.

## Why this is needed

Three of the seven rules in the request already hold. Four do not, and one of the
gaps is worse than it looks: nobody can delete a shift at all, not even an admin,
because the policy allows admins but the table grant was never issued. Every
attempt returns 403.

| Rule | Today |
|---|---|
| Every event has an owner | Holds. `events.created_by`, `not null` |
| Owner edits and deletes their event, as an admin does | Holds. Policies `events_owner_update`, `events_owner_delete` |
| A volunteer changes only their own sign-up | Holds. Policy `assignments_self_delete` |
| A volunteer cannot add shifts | **Broken.** Policy `shifts_insert` permits any logged-in user, and `add_shift_with_split` is `security definer`, so it bypasses policies outright |
| Owner and admin can delete shifts | **Missing.** Policy `shifts_delete` is admin-only, no `delete` grant exists, and there is no button in the interface |
| Owner can remove someone from a shift | **Missing.** Only admins can |
| Owner can hand the event to another volunteer | **Missing.** `created_by` is set at creation and nothing changes it. A quirk in `events_owner_update` blocks it even once a button exists |

A fourth problem surfaced while reading the schema and is included below,
because this change makes it much easier to trigger.

## The permission model

Three roles. A person can hold two at once: the owner of an event is also a
volunteer everywhere else.

| Action | Volunteer | Owner of this event | Admin |
|---|---|---|---|
| Create an event | yes, becomes its owner | — | yes, becomes its owner |
| Edit or delete this event | no | yes | yes |
| Hand this event to another volunteer | no | **yes** | yes |
| Add a shift | **no** | yes | yes |
| Edit a shift's end time or remarks | **no** | yes | yes |
| Delete a shift | **no** | yes | yes |
| Sign self up, remove self | yes | yes | yes |
| Add another volunteer to a shift | no | **yes** | yes |
| Remove another volunteer from a shift | no | **yes** | yes |
| See names on a shift | yes | yes | yes |
| See phone and email of people on a shift | no | **yes, own events only** | yes, everywhere |

Bold marks a change from current behaviour. Ownership is per event: it grants
nothing on anyone else's event.

## Handing an event to someone else

The person who creates an event owns it. An owner can hand that ownership to
another volunteer, and an admin can do the same on any event. This is a full
handover, not a shared arrangement: an event has exactly one owner, and the
moment it changes the previous owner drops back to being an ordinary volunteer
on that event. They cannot take it back. Only the new owner, or an admin, can
move it again.

There is a trap in the database here. A row-level security `update` policy
checks the row twice: `using` tests the row as it is, `with check` tests the row
as it will be. Policy `events_owner_update` currently applies the same test to
both:

```sql
using (public.is_admin() or created_by = <me>)
with check (public.is_admin() or created_by = <me>)
```

So a transfer fails. The `using` half passes, because I own the row now, and the
`with check` half then rejects it, because after the change `created_by` is
somebody else. Handover has to be permitted explicitly: keep `using` as it is,
so only the owner or an admin may touch the row at all, and relax `with check`
to accept a `created_by` naming any volunteer. The `using` clause is what
provides the security; `with check` only needs to confirm the new owner is a
real volunteer, which the foreign key already guarantees.

Pick the new owner from `assignable_volunteers(event.id)` — the same names-only
list the manage dropdown uses, so no extra function is needed. Confirm before
acting, because from the old owner's side it cannot be undone:

> Hand "Home match" to Sam Okafor? They will be able to edit and delete this
> event, and you will not. Only Sam or an admin can change it back.

The event's shifts and sign-ups are untouched by a handover. Only the owner
changes.

## Deleting a shift

The previous shift absorbs the freed time, so an event is never left with a
hole in its cover. This is the exact inverse of `add_shift_with_split`, which
already creates shifts by splitting.

```
Before   [12:00-15:00][15:00-18:00]
Delete the second shift
After    [12:00----------18:00]
```

The rules, in order:

1. Find the previous shift: the one on the same event whose `start_time` is the
   latest of those strictly earlier than the deleted shift's `start_time`.
   Overlapping shifts are permitted in this app, so "previous" must be defined
   by start time and nothing else. `add_shift_with_split` already resolves
   ambiguity this way, with `order by start_time desc limit 1`, and the new
   function should match it.
2. If a previous shift exists, set its `end_time` to the deleted shift's
   `end_time`, but only if that moves it later. Never shorten a shift by
   deleting another one.
3. If there is no previous shift, the deleted shift was first. Move the *next*
   shift's `start_time` back to the deleted shift's `start_time`, so the event
   still begins when it says it begins.
4. If it was the only shift, the event ends up with no shifts. This is allowed.
   The event still shows, with an empty shift list and the add-shift form.

Sign-ups on the deleted shift disappear with it, because `assignments.shift_id`
is declared `on delete cascade`. That is silent data loss, so the interface must
confirm first, naming the count:

> Delete the 15:00–18:00 shift? Two volunteers are signed up and will lose
> their place. The 12:00–15:00 shift will be extended to 18:00.

Take the whole deletion in one database function, not several calls from the
browser. A delete followed by a separate update can be interrupted halfway and
leave an event with a gap nobody asked for.

## Database changes

### Shifts: stop volunteers inserting

Policy `shifts_insert` currently reads `auth.uid() is not null`. Replace it with
a check that the caller is an admin or the event's owner.

Tightening the policy is not enough on its own. `add_shift_with_split` is
`security definer`, which means it runs with the definer's rights and ignores
row-level security completely. Any logged-in volunteer can call it today and get
a shift. The function itself must check the caller and raise if they are neither
admin nor owner, the same way `import_events` already guards itself with
`if not public.is_admin() then raise exception`.

### Shifts: allow owners and admins to delete

Widen policy `shifts_delete` from admin-only to admin-or-owner.

No `delete` grant is added, despite that being the other half of why deletion
fails today. Deletion goes through `delete_shift()`, which is `security definer`
and so bypasses grants entirely — it has to be a function anyway, because the
delete and the neighbouring shift's adjustment must happen together. Granting
`delete` on top would only open a second route that skips the time absorption.
The policy stays as a second line of defence if a grant is ever added later.

This mirrors the reasoning already in `grants.sql` for why `insert` on
`public.shifts` is not granted.

### Shifts: restrict editing

Policy `shifts_update` currently reads `auth.uid() is not null`. Narrow it to
admin-or-owner. The grant `select, update` in `grants.sql` can stay as it is;
the policy does the work.

### Assignments: let owners manage other people

Policies `assignments_self_insert` and `assignments_self_delete` allow the row's
own volunteer or an admin. Extend both to allow the owner of the event the
shift belongs to, which means joining `assignments → shifts → events`.

That join appears in four policies and two functions. Write it once, as a
helper, rather than repeating it:

```sql
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
```

Mirroring `public.is_admin()`, which already exists and is used the same way.
Policies then read `public.is_admin() or public.owns_event_of_shift(shift_id)`.

### Events: permit handover

Relax the `with check` half of policy `events_owner_update` so `created_by` may
name a volunteer other than the caller, while leaving `using` untouched. Reasoning
in "Handing an event to someone else" above. No grant change is needed; `update`
on `public.events` is already granted to `authenticated`.

### Contact details for owners

`roster_assignments()` currently returns `phone` when `public.is_admin()` and
null otherwise. Extend the condition to include the owner of the event that the
assignment's shift belongs to, so an owner can ring a volunteer who has not
turned up. An owner still sees null for every other event.

The function does not currently return email at all; the interface reads it from
the admin-only `admin_volunteers()` list. If owners are to see email as the
table above says, `roster_assignments()` should return it under the same
condition, and the interface should read it from there instead. That is the
smaller change and it removes the interface's dependence on an admin-only call.

### A name list for owners

To add a volunteer to a shift, the owner needs a list of volunteers to choose
from. Today the only such list is `admin_volunteers()`, which is admin-gated and
returns phone, email and remarks. Do not open that up. Add a narrower function
instead:

```sql
create or replace function public.assignable_volunteers(target_event_id uuid)
returns table (id uuid, name text)
```

`security definer`, returning names and nothing else, and only to a caller who
is an admin or the owner of `target_event_id`. Anyone else gets no rows.

This keeps the privacy fix intact. The club's phone list stays admin-only, and
owners get exactly the names they need to fill their own event.

## Interface changes

All in `app/app/page.tsx`. Compute the owner flag once per event and reuse it:

```js
const canManage = isAdmin || event.created_by === volunteerId
```

Then:

- Gate the add-shift form on `canManage`. Volunteers should not see it at all,
  rather than see it and get a refusal.
- Render the shift end time as text for volunteers. Only `canManage` gets the
  time input.
- Show the manage-volunteers dropdown when `canManage`, not only when `isAdmin`.
  Populate it from `assignable_volunteers(event.id)`.
- Add a delete control per shift, visible when `canManage`, with the confirmation
  wording above.
- Give each listed person a remove control, visible when `canManage`.

One thing worth fixing while in here. Sign me up currently renders only when
`!isAdmin`, which is why an admin has to add themselves through the dropdown.
Extending that pattern to owners would mean an owner cannot sign up for their own
event, which is the opposite of what a club needs. Show Sign me up to everyone,
and give `canManage` the dropdown in addition. That removes an existing annoyance
rather than spreading it.

### Replace the edit prompts with a form

The handover needs a list of names to choose from, and `editEvent` cannot offer
one: it is four `window.prompt()` calls in a row, and a prompt can only ask for
text. So the edit flow becomes a real form, with the owner picker inside it.

The form to copy already exists. `showEventForm` renders description, date, start
and end for a new event; the edit form is the same fields with values filled in,
plus one more. Hold `editingEventId` alongside a form object shaped like
`eventForm`, and render the form in place of the event's details when its id
matches.

This is worth doing for its own sake, not only for the picker. The prompt chain
takes four strings and trusts all of them — a typo in the date or a start time
after the end time goes straight into the database. A form gets `required`,
`type="date"` and `type="time"` at no cost, and can refuse to save when the end
time is not after the start.

The extra field is Owner, a `<select>` filled from
`assignable_volunteers(event.id)` and defaulting to the current owner. Saving a
form where the owner is unchanged is an ordinary edit and must not ask about
handover. Only when the selection has actually moved to a different volunteer
does the confirmation from "Handing an event to someone else" appear — and it
appears before the save, so declining leaves everything untouched, the other
edits included.

## Deleting somebody who owns events

Today this fails with a foreign key error that explains nothing.
`events.created_by` is `on delete restrict`, while `volunteers.auth_user_id` is
`on delete cascade` from `auth.users`. Deleting a login cascades into the
volunteer row, hits the restrict on their events, and the whole delete aborts.
Somebody who has ever created an event cannot leave the club cleanly.

The restrict stays. It is the right instinct — it stops a departure silently
taking a fixture's bar cover with it, and the alternative, cascading so their
events vanish, is worse. What was missing is a way out, and handover is it: a
volunteer passes their events on before they go, or an admin does it for them.

What remains is to replace the unreadable error with an instruction.

**The check belongs in the database, not the interface.** There is no way to
delete an account in the app at all — no control in the admin panel, nothing in
`page.tsx`. It happens in the Supabase dashboard, under Authentication → Users.
An interface guard would therefore never run on the only path anyone actually
uses. A trigger runs on every path, including the dashboard.

Add a `before delete` trigger on `auth.users` that counts the events owned by
that person's volunteer row and raises if there are any. The precedent exists:
`on_auth_user_created` is already an `after insert` trigger on the same table, so
this is a pattern the schema uses rather than a new idea.

The message has to be readable by whoever is standing in the dashboard:

> Sam Okafor owns 3 events. Hand those to another volunteer first, then delete
> this account.

Raising aborts the delete completely. That is the intent.

Note what the trigger does not cover. Somebody who owns no events deletes
cleanly, and their shift sign-ups vanish with them, because
`assignments.volunteer_id` is `on delete cascade`. Shifts they were covering just
show one fewer name. That is acceptable — the event and its shifts survive — but
it happens silently, and a trigger that only speaks up when it refuses cannot
warn about a deletion it permits. Warning about lost sign-ups would need a
remove-volunteer flow in the admin panel. There isn't one, and this spec does not
add one.

Keep the foreign key restrict in place as the backstop. If the trigger is ever
dropped, the delete still fails rather than destroying events.

## Also worth knowing

`load()` reads `isAdmin` inside its own body while `isAdmin` is also its
`useEffect` dependency, so the first call always sees the stale value `false`
and the admin data arrives only on a second pass. Owners will need a similar
conditional load, and will hit the same trap. Fetch the caller's own row first,
then decide what else to fetch from the value just read rather than from state.

## Test checklist

Ownership is easiest to get wrong in the direction of being too permissive, so
most of these are negative tests. Three accounts: an admin, volunteer A who owns
an event, and volunteer B who owns nothing.

- [ ] B cannot see the add-shift form on A's event.
- [ ] B cannot edit a shift end time on A's event; the time shows as text.
- [ ] B has no delete control on any shift of A's event.
- [ ] B calling `add_shift_with_split` directly from the browser console is
      refused. This is the one that policies alone do not cover.
- [ ] B can sign themselves up for a shift on A's event and remove themselves.
- [ ] B cannot remove A from a shift.
- [ ] B sees null for every phone number, including on shifts they are on.
- [ ] A can add a shift, edit its times, and delete it on their own event.
- [ ] A can add B to a shift on their own event, and remove B again.
- [ ] A sees B's phone and email on their own event.
- [ ] A sees null for phone and email on an event owned by someone else.
- [ ] A cannot add a shift to an event owned by someone else.
- [ ] Delete the second of two shifts: the first extends to cover the freed
      time, and the confirmation named the right number of sign-ups.
- [ ] Delete the first of two shifts: the second starts earlier to cover it.
- [ ] Delete the only shift: the event remains, with none.
- [ ] Admin can do all of the above on an event they do not own.
- [ ] An event created by CSV import is owned by the importing admin, who can
      then edit and delete it.

Handover:

- [ ] A hands their event to B. B can now add a shift to it.
- [ ] After that handover, A cannot add a shift, cannot edit shift times, and
      cannot hand the event back.
- [ ] After that handover, A sees null for phone numbers on the event they used
      to own.
- [ ] The event's shifts and sign-ups are unchanged by the handover.
- [ ] B, who owns nothing, has no handover control on A's event.
- [ ] B cannot hand A's event to themselves by calling the update directly from
      the browser console. This is the `with check` relaxation's blast radius —
      test it deliberately.
- [ ] Admin can hand any event to anyone.
- [ ] The handover picker lists volunteers by name only, with no phone numbers
      in the response.

The edit form:

- [ ] Editing description, date or times without touching Owner saves with no
      handover confirmation.
- [ ] An end time earlier than the start is refused instead of saved.
- [ ] Declining the handover confirmation abandons the whole save, including the
      other fields edited alongside it.
- [ ] Owner defaults to the event's current owner every time the form opens.

Account deletion:

- [ ] Delete an account that owns events, **from the Supabase dashboard**, not
      from SQL. It is refused, and the message names how many events. The
      dashboard is the only path anyone uses, so testing it elsewhere proves
      nothing.
- [ ] Hand that person's events to someone else, then delete them. It succeeds.
- [ ] Delete an account that owns no events but is signed up for shifts. It
      succeeds, and their name disappears from those shifts while the shifts
      themselves remain.
- [ ] After a refused deletion, the account and its events are both still
      intact — the abort rolled everything back.
