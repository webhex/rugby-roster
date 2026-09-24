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
3. Run the five SQL files from the `supabase/` folder **in this order**, each
   one copied whole into the editor. Order matters: each builds on the last.

   | File | What it does |
   |---|---|
   | `schema.sql` | tables, security policies, helper functions |
   | `grants.sql` | table privileges for logged-in users. Without it every request returns 403 |
   | `privacy-fix.sql` | stops volunteers reading each other's phone numbers |
   | `ownership.sql` | event owners, shift permissions, handover |
   | `account-deletion.sql` | lets people delete their own account, and admins delete any |

   All five are safe to run more than once, so if you lose track you can run
   them again in order.

   After the last one, run this to confirm account deletion will actually work:

   ```sql
   select has_table_privilege('postgres', 'auth.users', 'delete');
   ```

   It should return `true`. If it returns `false`, deleting accounts will fail
   at the last step, and the fallback is a server route using the
   `service_role` key instead. Everything else works either way.
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
3. Add `https://your-url.vercel.app/**` under Redirect URLs

Use the `/**` wildcard rather than listing `/auth/callback` on its own. The
password reset link carries a query string — `/auth/callback?next=...` — and an
exact entry without the wildcard will not match it. Supabase then refuses the
redirect and the reset link fails, with the reason only visible in the Auth logs.

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

**Forgotten passwords.** There is a Forgot your password? link on the sign-in
page. It emails a link that signs the person in once and drops them on a page to
choose a new password. The link lasts an hour and stops working after one use.

The page says the same thing whether or not the address has an account, so
nobody can use it to find out who is a member of the club.

One thing to know before the club relies on this: **Supabase's built-in email
service is rate limited and is not meant for real use.** The allowance is a
handful of messages per hour for the whole project, shared across sign-up
confirmations and password resets. Two people forgetting their passwords on the
same evening is enough to hit it, and the second one gets told to wait with no
email arriving. Before handing the URL to the club, set up your own mail sender
under **Authentication → Emails → SMTP Settings**. Resend, Postmark and SendGrid
all have free tiers that cover a club comfortably.

This is separate from the email confirmation you turned off for sign-up. Reset
emails use a different template and still send.

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

**Deleting an account.** Anyone can delete their own, from the Your account box
at the bottom of the roster. Admins can delete anybody's, from the Delete button
beside each name in the admin panel.

Two things stop a deletion. You cannot delete somebody who still owns events —
hand those to another volunteer first, or a fixture loses its bar cover along
with them. And the club must keep at least one admin, so the last admin cannot
delete themselves, the same rule that stops them demoting themselves.

Deleting an account removes that person from every shift they had signed up for.
The shifts themselves survive, one name shorter. You are warned before it
happens, and it cannot be undone.

This is enforced in the database, so it holds however the account is deleted —
including straight from the Supabase dashboard, where the refusal appears as a
message explaining what to do.

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
- [ ] Use Forgot your password?, follow the emailed link, set a new password,
      and sign in with it. The old password should no longer work.
- [ ] Request a reset for an address that has no account. The page should say
      the same thing as for a real one, and no email should arrive.
- [ ] Open `/auth/update-password` directly while signed out. It should send you
      to the forgot-password page rather than showing a form.
- [ ] Use a reset link twice. The second attempt should fail.
- [ ] While already signed in, open `/auth/login`. It should redirect to the
      roster — that redirect still applies to every `/auth` page except the
      callback and the update-password page.
- [ ] As a volunteer who owns no events, delete your own account. You are signed
      out, and your name is gone from the shifts you were on.
- [ ] Sign up again with the same email. It should work, as a new volunteer.
- [ ] As a volunteer who owns an event, try to delete your account. Refused,
      naming how many events. Hand them over, then it works.
- [ ] As an admin, delete another volunteer. Their name disappears from the
      volunteer list and from every shift.
- [ ] As the only admin, try to delete yourself. Refused. Promote somebody else,
      then it works.
- [ ] As a volunteer, call `delete_account` from the browser console with another
      volunteer's id. Refused — the admin panel's absence is not the protection.

## Known rough edges

- Everything on the main screen lives in one file, `app/app/page.tsx`. It
  works, but it will get awkward to extend.
- `next.config.mjs` sets `typescript.ignoreBuildErrors: true`. There are 10
  implicit-`any` warnings in the Supabase cookie helpers. They have no runtime
  effect, but the setting also hides any future type error, so consider turning
  it off once the app is stable.
- No email reminders, no recurring events, no shift swap requests.
- Account deletion is immediate, with a confirmation box and nothing else. There
  is no grace period and no way back.
- Deleting an account from the Supabase dashboard rather than from the app still
  works, and is still refused if they own events, but the dashboard gives no
  warning about the shift sign-ups that go with them.

## Files worth knowing

```
app/app/page.tsx        the whole roster screen
app/auth/               login, sign-up, email callback
lib/supabase/           browser, server and middleware clients
supabase/              four SQL files, run in the order given above
middleware.ts          redirects logged-out users away from /app
SPEC-ownership.md      what the ownership rules are, and how to test them
```
