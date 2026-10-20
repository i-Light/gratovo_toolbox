# Setup

What you do by hand to run the new app on the team's Supabase project. It replaces `legacy/backend/SETUP.md` for the new stack. Every value shown here is a fake example: copy the shape, never these values.

Short words, numbered steps. If a screen looks different from what is written here, Supabase has moved a button. Look for the same name nearby, and tell the session you are working with.

**The one rule:** the secret key (also called the service-role key) never goes into the app, into `apps/desktop/.env.local`, into the repository or into a chat. The app refuses it on purpose. Only the publishable key goes into the app.

## What you need

- Node, pnpm, uv and gitleaks: [workflow.md](workflow.md#setting-up-and-things-to-know) says how to get them on Windows.
- Docker Desktop, only to run the database tests (`pnpm test:sql`) and the local server tests (`pnpm test:server`). It must be running when you start them.
- The Supabase command line, only for the local server tests. Don't install it. Run it with `npx supabase@2.119.0 ...` (a pinned version).
- A Supabase login with the **Owner** or **Administrator** role on the team's project. Only those roles can add function secrets.

## 1. Give the app its two Supabase values

The app needs two public values: the project address and the publishable key. They are not secret, but they are not written in the code either. You put them in one file that Git ignores.

1. Open the Supabase dashboard and pick the team's project.
2. Go to **Project Settings › API Keys**. (There is no separate "API" page any more.)
3. Find the **publishable key**. It starts with `sb_publishable_`.
   - If the project has none, create one on that page. A new key sits next to the old `anon` and `service_role` keys and does not switch them off, so the old app keeps working.
4. Copy the **project URL**. You can see it in the **Connect** dialog at the top of the project. It looks like `https://abcdefghijklmnopqrst.supabase.co`: `https://`, 20 lowercase letters or digits, `.supabase.co`, and nothing after it.
5. Create the file `apps/desktop/.env.local` with exactly two lines:

   ```
   MAIN_VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
   MAIN_VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test000
   ```

6. Start the app with `pnpm dev`, or build it with `pnpm build`. The values are read when the app is built or started.

Good to know:

- Git ignores this file. Never commit it, and never paste its content into a chat.
- **Never put the secret key here.** A key starting with `sb_secret_`, or a long key made of three parts joined by dots (the old `service_role` and `anon` keys look like this), makes the app run without Supabase: it writes one line in the terminal that started it (for example "Supabase is not configured: the key is a secret key.") and shows the example data, with no sign-in. It shows no message on screen. This is on purpose.
- Without the file the app still runs, with the example data and no sign-in. That is how the tests run too.
- Release builds come with step 3h. They will take the same two values from GitHub Actions *variables* (not secrets).

## 2. Add a team member

The app has no sign-up screen. You make each account in Supabase, as in the old app.

1. Go to **Authentication › Users**.
2. Click **Add user**, then **Create new user**.
3. Type the email and a password. Turn on **Auto Confirm User**, so the person does not have to wait for a confirmation email.
4. Click **Create user**.
5. Send the person their email and password in a way you trust. They sign in to the app with them.

A new person lands on the "waiting for access" screen. Their access is still `unauthorized`. A row in `public.profiles` is made for them at once; the app never makes it.

### Let them in (access)

1. Go to **SQL Editor** and open a new query.
2. Run this, with the person's real email:

   ```sql
   update public.profiles
   set role = 'basic'
   where id = (select id from auth.users where email = 'sara@example.com');
   ```

   Use `'full'` instead of `'basic'` if you want it. In the database the two behave the same today.
3. The person clicks **Check again** on the waiting screen.

### Give them roles and the money switch

Roles are a list: `owner`, `scout`, `outreach`, `deal_lead`, `delivery`. "Sees money" is its own switch. An Owner always sees money, whatever the switch says. Without a row, a person has no roles and sees no money.

In the same **SQL Editor**:

```sql
insert into public.member_access (profile_id, roles, sees_money)
select id, '{deal_lead,delivery}', true
from auth.users
where email = 'sara@example.com'
on conflict (profile_id) do update
  set roles = excluded.roles, sees_money = excluded.sees_money;
```

Change the list in the braces and `true` or `false` to suit. Run it again to change them later.

Things to know:

- The SQL Editor runs as the database owner, so it may write `member_access`. Team members can't: the table has no write rule for them. Inside the app, only an Owner can change roles, through the function `set_member_access`. A screen for it comes with step 9 (Settings › Team).
- The team always needs one Owner. The first Owner row is written once at the rollout (section 6), with your go.
- Money is hidden in the new app only. The database still lets every signed-in member read it until the old app retires (steps 10 and 11).

## 3. The YouTube key (Vault)

The key stays in Supabase. Signed-in members get it on demand through a function. It is never in the installer and never on disk.

1. In the dashboard, open **Vault**. It is in the left menu, in the **Integrations** area (also reachable from **Database**). If you can't find it, use the search box at the top of the dashboard.
2. Click **Add new secret**.
3. Name: `team_youtube_key`. Spell it exactly like this.
4. Secret: the value of `YOUTUBE_API_KEY` from the old `data/.env`. Open that file yourself and copy the value across. Don't paste it in a chat.
5. Save.

Use the Vault screen, not the SQL editor. The SQL editor keeps a history of what you typed.

To change the key later, edit the secret on the same screen. Nobody can read it through the app's own account: only the function `team_youtube_key()` hands it to an authorized member.

## 4. The R2 keys (Edge Function Secrets)

The R2 keys stay in Supabase too. The function `r2-access` uses them to make links that work for 15 minutes. The app never sees the keys, only the links.

1. In the dashboard, go to **Edge Functions** and open **Secrets**. (The page is called **Edge Function Secrets**.)
2. Add four secrets. For each, type the name and paste the value from the old `data/.env`:

   | Name | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | your Cloudflare account id |
   | `R2_ACCESS_KEY_ID` | the R2 access key id |
   | `R2_SECRET_ACCESS_KEY` | the R2 secret access key |
   | `R2_BUCKET` | the bucket name, for example `my-bucket` |

   The page lets you paste several at once. Use **Add another** for more rows.
3. Click **Save**. The function sees new secrets without a redeploy.

If any of the four is missing, the function answers "R2 isn't set up" and signs nothing.

Names can't start with `SUPABASE_`; Supabase refuses them. These four don't.

## 5. Check the old app still works

After the rollout (section 6), open the **old app**: sign in, check the creators list loads, and make one edit and see it save. Then open the new app built with your `.env.local` and sign in. You should see your name and the team with roles.

## 6. How changes reach the real project

Changes to the team's live Supabase project never go out by themselves.

- A session makes each change through the **Supabase MCP**, and **asks you first**. You say "go" before each numbered step. Nothing happens without it.
- The first migration file, `20261020120000_baseline.sql`, is the old schema. The live project already runs it. It is **marked as applied** in the project's history and **never pushed**. Pushing it would run the old schema a second time.
- The new migrations (`member_access`, `team_keys`) are small and only add things. They don't change anything the old app uses. The session applies them one at a time, then deploys the `r2-access` function.
- At the end, the session writes your Owner row (section 2), and you enter the key values yourself (sections 3 and 4). The session only checks that the secret names exist. It never reads a value.
- If something looks wrong, the session stops and tells you. Undoing the new parts is safe because nothing else depends on them, and it also needs your go.
- **If anyone re-runs the old `schema.sql`, re-apply the later migrations right after** (`member_access`, then `team_keys`, in that order). The old file takes away the app's right to call the new functions, and gives members write rights on `member_access` (the table's rules still refuse the writes). Re-applying the two files puts both back. They are safe to run again. `pnpm test:sql` runs this exact sequence and checks the rights come back the same.

## 7. Run the tests

- `pnpm test:sql`: the database rules in a throwaway Postgres in Docker. Nothing touches the live project.
- `pnpm test:server`: the server tests against a local copy of Supabase. They use made-up users, a fake YouTube value and fake R2 values (like `r2-test-000`). CI runs them as the job "Server tests (Linux, local Supabase)". On your machine they are optional.

  The tests need three values: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. They come from the local stack, never from the team's project: the local stack prints the command line's fixed local values, which open nothing but the throwaway copy on your machine. **Never put the production keys here.**

  Start Docker Desktop, then from the repository folder, in Git Bash:

  ```bash
  npx supabase@2.119.0 start -x studio,mailpit,storage-api,imgproxy,logflare,vector,supavisor,postgres-meta
  eval "$(npx supabase@2.119.0 status -o env | sed -n -e 's/^API_URL=/export SUPABASE_URL=/p' -e 's/^PUBLISHABLE_KEY=/export SUPABASE_PUBLISHABLE_KEY=/p' -e 's/^SECRET_KEY=/export SUPABASE_SECRET_KEY=/p')"
  pnpm test:server
  npx supabase@2.119.0 stop --no-backup
  ```

  Or in PowerShell:

  ```powershell
  npx supabase@2.119.0 start -x studio,mailpit,storage-api,imgproxy,logflare,vector,supavisor,postgres-meta
  $names = @{ API_URL = 'SUPABASE_URL'; PUBLISHABLE_KEY = 'SUPABASE_PUBLISHABLE_KEY'; SECRET_KEY = 'SUPABASE_SECRET_KEY' }
  npx supabase@2.119.0 status -o env | ForEach-Object { if ($_ -match '^(\w+)="?(.*?)"?$' -and $names.ContainsKey($Matches[1])) { Set-Item "env:$($names[$Matches[1]])" $Matches[2] } }
  pnpm test:server
  npx supabase@2.119.0 stop --no-backup
  ```

  The `-x` list leaves out the services the tests don't use (Studio, the mail server, Storage, Realtime and the rest), so the start is shorter. It is the same line as the CI job. The values stay in that terminal only; close it when you are done.

These tests check the server, not the app, so they don't break the Windows-only rule.

## If something goes wrong

- **The app shows the example data and no sign-in, although you made `.env.local`:** look in the terminal that started the app for one line beginning "Supabase is not configured:". It names the problem, never the value. Check `apps/desktop/.env.local`. The URL must be the plain project address. The key must start with `sb_publishable_`. Restart the app.
- **"Waiting for access" for someone you let in:** they click **Check again**. If it stays, check the `update public.profiles` step and the email spelling.
- **A person sees no prices:** they need the `owner` role or `sees_money = true` (section 2).
- **A key leaked (in a chat, a commit or a screenshot):** treat it as lost. Make a new one in Supabase or Cloudflare first, then delete the old one. [SECURITY.md](../SECURITY.md) has the rule.

More: [SECURITY.md](../SECURITY.md) (what is secret and where it lives), [supabase/README.md](../supabase/README.md) (the migrations and tests), [decisions/0003-secrets.md](decisions/0003-secrets.md) (why keys are not in the installer).
