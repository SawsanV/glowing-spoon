# TBANON Tracker — setup

A self-hosted progress tracker for Tb. Captains, hero, artifacts, snapshot history, and a group leaderboard. Built on Supabase (Postgres + Auth) with a static frontend deployed on Vercel.

---

## What you need

- A Supabase account (you said you have one)
- A Vercel account (free)
- A GitHub account if you want auto-deploy (optional but recommended)
- ~15 minutes

---

## Step 1 — Create the Supabase project

1. Go to https://supabase.com/dashboard
2. Click **New project**, name it something like `tb-tracker`
3. Pick a region close to you (Europe West if you're in London)
4. Set a strong database password and save it somewhere safe — you don't need it for the app, but you'll need it if you ever touch the DB directly
5. Wait ~2 minutes for the project to provision

---

## Step 2 — Run the SQL

In the Supabase dashboard, go to **SQL Editor → New query**, then run each of the three files in this order:

1. `sql/01_schema.sql` — creates the tables
2. `sql/02_rls.sql` — sets up Row Level Security so users can only edit their own data
3. `sql/03_signup_code.sql` — adds the group code verification function

Paste each file's contents, click **Run**, wait for "Success", then move to the next.

---

## Step 3 — Set the group signup code

The schema seeded a placeholder code (`change-me-now`). Change it:

In SQL Editor:
```sql
update public.group_settings set signup_code = 'your-secret-code-here' where id = 1;
```

Pick something memorable but not guessable. You can change it any time later from the in-app admin panel.

---

## Step 4 — Configure email confirmation

Supabase has email confirmation **on by default**. That's what you wanted. Default settings should work — Supabase's built-in email service handles it for free up to a low limit (3 emails/hour on the free tier as of early 2026, check current limits).

If you hit that limit, plug in your own SMTP (Resend, Postmark, etc.) under **Authentication → Settings → SMTP Settings**.

The default redirect URL after confirmation is your site root, which is fine.

---

## Step 5 — Get your API keys

In Supabase dashboard → **Settings → API**:

- Copy the **Project URL**
- Copy the **anon / public** key (the long one labelled `anon public`)

⚠ **DO NOT copy the `service_role` key.** That one bypasses RLS and must never go in frontend code or be shared.

---

## Step 6 — Configure the frontend

Edit `public/config.js`:

```js
export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

---

## Step 7 — Make yourself admin

You need to sign up first so a profile row exists for you, then promote yourself manually (just this one time — after that, you can promote others from inside the app).

1. Run the site locally OR deploy first (Step 8), then sign up with your email + the group code
2. Confirm via the email link
3. Go to Supabase → **Table Editor → profiles**
4. Find your row, edit `is_admin` to `true`, save
5. Refresh the app — the **Admin** button will appear

---

## Step 8 — Deploy to Vercel

### Option A: Via GitHub (recommended — auto-deploys on every push)

1. Create a new GitHub repo, push this folder to it
2. Go to https://vercel.com/new
3. Import the repo
4. Framework preset: **Other** (it's static)
5. Root directory: leave as `/`
6. Click **Deploy**

### Option B: Via Vercel CLI

```bash
npm i -g vercel
cd tb-tracker
vercel
```

Follow prompts. It'll give you a URL.

---

## Step 9 — Update Supabase auth redirect URLs

Once deployed, you need to whitelist your Vercel URL in Supabase so confirmation emails work:

1. Supabase → **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel URL (e.g. `https://tb-tracker.vercel.app`)
3. Add the same URL to **Redirect URLs** (paste it again as an allowed redirect)

Without this, the email confirmation link will redirect to `localhost`.

---

## Step 10 — Share with your friends

Give them:
- The site URL
- The group signup code

They sign up, confirm email, and they're in. From the **Admin** button you can change the code, promote others to admin, or remove members.

---

## Local development

You don't strictly need a local dev setup for this — it's static, so just open `public/index.html` in a browser after editing `config.js`. But CORS may complain about the ES module imports loaded over `file://`. Easy fix:

```bash
cd public
python3 -m http.server 8000
```

Then visit http://localhost:8000.

(If you go this route, also add `http://localhost:8000` to Supabase's Redirect URLs so signup emails work locally.)

---

## What's in here

```
tb-tracker/
├── public/
│   ├── index.html      # markup
│   ├── styles.css      # medieval/parchment theme
│   ├── app.js          # all the logic
│   └── config.js       # YOU EDIT THIS — Supabase URL + anon key
├── sql/
│   ├── 01_schema.sql   # tables
│   ├── 02_rls.sql      # row-level security
│   └── 03_signup_code.sql  # signup gate function
├── vercel.json         # serve as static site
├── package.json        # placeholder for Vercel
└── README.md           # this file
```

---

## Things that could go wrong

- **"Profile not found" after sign up** — the trigger that creates profiles is async. If it doesn't kick in within ~2 seconds, check Supabase logs (Database → Logs). Usually means you didn't run `01_schema.sql` cleanly.
- **Email never arrives** — Supabase free tier rate-limits its built-in email. Check spam folder, then check Auth → Logs in Supabase. If hitting limits, set up your own SMTP.
- **Confirmation link goes to localhost** — fix the Site URL in Supabase Auth settings (Step 9).
- **RLS errors on save** — means the user is not authenticated. Sign out + back in.

---

## Costs

Free tier on both Supabase and Vercel is fine for a friend group. You'd have to be tracking thousands of users daily before either complains.
