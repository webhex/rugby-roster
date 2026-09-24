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
3. Open `supabase/schema.sql` from this folder, copy all of it, paste it into
   the editor and click Run. It creates the tables, the security policies and
   four helper functions.
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

**Events** can be created by any logged-in user. Volunteers can edit and
delete only their own; admins can edit and delete any. Creating an event
automatically creates one shift covering the whole event.

**Shifts** split automatically. Add a shift starting at 15:00 to an event
running 12:00–18:00 and you get two shifts, 12:00–15:00 and 15:00–18:00. This
happens in the database, in the `add_shift_with_split` function. Afterwards you
can edit both end times freely, and overlapping shifts are allowed.

**Sign-up.** Volunteers add and remove only themselves. Admins can place or
remove anyone via the dropdown on each shift. Any number of people can be on
one shift; there is no cap.

**Privacy.** Every volunteer sees the names of people on a shift. Only admins
see email addresses and phone numbers.

**CSV import**, admins only. Upload a file with the columns
`description,date,start_time,end_time`. You get a preview marking bad rows —
unparseable dates, end time before start time, missing description — and only
the valid rows are imported. There is a button to download an example file.

## Test checklist

Nothing below has been tested against a live database. Work through it before
you hand the URL to the club.

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
- Admins do not get the "Sign me up" button. An admin adds themselves through
  the same dropdown they use for everyone else.
- No email reminders, no recurring events, no shift swap requests.

## Files worth knowing

```
app/app/page.tsx        the whole roster screen
app/auth/               login, sign-up, email callback
lib/supabase/           browser, server and middleware clients
supabase/schema.sql     tables, 18 security policies, 4 functions
middleware.ts           redirects logged-out users away from /app
```
