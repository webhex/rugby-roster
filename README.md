# Rugby club bar volunteer roster

A web app where club volunteers sign themselves up for bar shifts. Admins
manage events, shifts, users and bulk imports.

Built with Next.js, Supabase and Tailwind. Generated with v0 and reviewed
against the original spec.

## What you need

Two free accounts:

- **Supabase** (supabase.com) — the database and the login system
- **Vercel** (vercel.com) — hosting and the public URL

## Deploy it, step by step

### 1. Set up the database

1. Create a new project at supabase.com. Pick any region near you and save
   the database password somewhere safe.
2. Open the **SQL Editor** in the left sidebar.
3. Run the four SQL files from the `supabase/` folder **in this order**, each
   one copied whole into the editor. Order matters: each builds on the last.

   | File | What it does |
   |---|---|
   | `schema.sql` | tables, security policies, helper functions |
   | `grants.sql` | table privileges for logged-in users. Without it every request returns 403 |
   | `privacy-fix.sql` | stops volunteers reading each other's phone numbers |
   | `ownership.sql` | event owners, shift permissions, handover |

   All four are safe to run more than once, so if you lose track you can run
   them again in order.
4. Go to **Settings → API** and copy two values:
   - Project URL
   - `anon` public key

Leave that tab open, you need those two values twice.

### 2. Put the app online

In a terminal, from this folder:

```
npx vercel
```

It opens your browser to log in, then asks a few questions. Accept the
defaults. When it finishes it prints a URL.

### 3. Give the app its database keys

The app cannot talk to Supabase until you add the two values from step 1.

1. Open your project on vercel.com
2. **Settings → Environment Variables**
3. Add both of these:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon public key |

4. Back in the terminal, publish again so the build picks them up:

```
npx vercel --prod
```

These two names start with `NEXT_PUBLIC_`, which means they are baked into the
build and visible in the browser. That is correct and safe for these two
values — the anon key is designed to be public, and the row-level security
policies are what actually protect your data. Never put the Supabase
`service_role` key here.

### 4. Tell Supabase about your domain

Sign-up sends a confirmation email, and Supabase will only redirect to domains
you have allowed.

1. In Supabase, go to **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel URL, for example
   `https://rugby-roster.vercel.app`
3. Add `https://your-url.vercel.app/auth/callback` under Redirect URLs

### 5. First login

1. Open your Vercel URL and register. The invite code is `CHANGE-ME`.
2. **The first account to register becomes the admin.** Make sure that is you.
3. As admin, open the Admin panel and press Generate new next to the invite
   code. Share the new code with the club, not `CHANGE-ME`.

## How it works

**Roles.** The first registered account is admin. Everyone after that is a
volunteer. Admins can promote and demote others, and the app refuses to leave
itself without an admin.

**Registration** is gated by a single shared invite code, which an admin can
rotate at any time. Rotating it does not affect existing accounts.

**Events** can be created by any logged-in user, and whoever creates one owns
it. The owner has the same powers over that event as an admin has: edit it,
delete it, add and remove its shifts, and put people on those shifts. Ownership
is per event and grants nothing on anybody else's. Creating an event
automatically creates one shift covering the whole event.

**Handing an event on.** An owner can pass an event to another volunteer,
through the Owner field on the edit form. It is a full handover — the previous
owner drops back to being an ordinary volunteer on that event and cannot take it
back. Only the new owner or an admin can move it again. Shifts and sign-ups are
untouched.

An owner also cannot delete their own account while they still own events; the
database refuses and tells them to hand the events on first. Otherwise a
departure would take a fixture's bar cover with it.

**Shifts** are managed by the event's owner and by admins. Volunteers see the
times but cannot add, edit or delete them.

Adding a shift splits the one it lands in. Add a shift starting at 15:00 to an
event running 12:00–18:00 and you get 12:00–15:00 and 15:00–18:00. Deleting one
puts the time back: delete the 15:00–18:00 shift and the earlier one stretches
to 18:00, so an event is never left with time nobody is covering. Delete the
*first* shift and the next one starts earlier instead. Both happen in the
database, in `add_shift_with_split` and `delete_shift`. Overlapping shifts are
allowed, and end times can be edited freely afterwards.

Deleting a shift also deletes the sign-ups on it. You are warned, and told how
many people that is, before it happens.

**Sign-up.** Everybody, admins included, can add and remove themselves with the
Sign me up button. Admins and the event's owner can additionally place or remove
anyone, via the dropdown on each shift and the Remove button next to each name.
Any number of people can be on one shift; there is no cap.

**Privacy.** Every volunteer sees the names of people on a shift, and nothing
else about them. Phone numbers and email addresses go to admins, and to an
event's owner for that event only — so whoever is running the bar can ring a
no-show without the whole club having the club's phone list.

This is decided in the database, not in the interface. A volunteer who opens the
browser console and queries directly gets names and nulls, the same as what the
screen shows them.

**CSV import**, admins only. Upload a file with the columns
`description,date,start_time,end_time`. You get a preview marking bad rows —
unparseable dates, end time before start time, missing description — and only
the valid rows are imported. There is a button to download an example file.

## Test checklist

Nothing below has been tested against a live database. Work through it before
you hand the URL to the club.

The ownership and permission rules have their own, longer checklist in
`SPEC-ownership.md`. Most of it is negative tests — proving a volunteer *cannot*
do something matters more here than proving an owner can, because permissions
fail in the direction of being too generous.

- [ ] Register. You become admin.
- [ ] Register a second account in a private window. It is a volunteer.
- [ ] Change the invite code. The old one stops working, both accounts still
      log in.
- [ ] Create an event 12:00–18:00. One shift appears.
- [ ] Add a shift at 15:00. You now have 12:00–15:00 and 15:00–18:00.
- [ ] As the volunteer, sign up for a shift, then remove yourself.
- [ ] As the volunteer, confirm you cannot see anyone's phone number and
      cannot remove anyone else from a shift.
- [ ] As admin, place the volunteer on a shift, then remove them.
- [ ] Import a CSV with one good row and one broken date. The preview flags
      the bad row, one event is created.
- [ ] Create an event in the past. Volunteers cannot see it, admins can via
      Show past.
- [ ] Try to demote yourself as the only admin. It should refuse.

## Known rough edges

- Everything on the main screen lives in one file, `app/app/page.tsx`. It
  works, but it will get awkward to extend.
- `next.config.mjs` sets `typescript.ignoreBuildErrors: true`. There are 10
  implicit-`any` warnings in the Supabase cookie helpers. They have no runtime
  effect, but the setting also hides any future type error, so consider turning
  it off once the app is stable.
- No email reminders, no recurring events, no shift swap requests.
- Nothing warns you that deleting a volunteer's account also removes them from
  every shift they had signed up for. The shifts survive, one name shorter, but
  it happens silently. There is no delete-volunteer screen in the app, so this
  only bites in the Supabase dashboard.

## Files worth knowing

```
app/app/page.tsx        the whole roster screen
app/auth/               login, sign-up, email callback
lib/supabase/           browser, server and middleware clients
supabase/              four SQL files, run in the order given above
middleware.ts          redirects logged-out users away from /app
SPEC-ownership.md      what the ownership rules are, and how to test them
```
