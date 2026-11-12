# BingeBerry

This dashboard now uses Supabase for:

- user signup and login
- persistent JWT-backed sessions
- team profiles and roles
- clients, projects, timelines, and task assignment
- shared workspace documents for goals, recurring templates, checklist state, and settings
- recurring task generation with daily, weekly, and monthly repeat rules

## Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](/Users/sanchit/IdeaProjects/bingeberry/supabase/schema.sql).
   For a new installation, then run all SQL files in `supabase/migrations/` in filename order.
   For an existing installation, run only migrations that have not been applied; do not rerun the base schema.
3. Copy [`supabase/config.example.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.example.js) to [`supabase/config.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.js) and fill in your project URL and anon key.
4. Start the local server from the repo root with `npm start`.
5. Open [http://127.0.0.1:4174](http://127.0.0.1:4174) in your browser.
6. Do not open `index.html` directly as a `file://` page. Supabase auth will fail there.

## Team Signup

For the deployed app, configure Supabase Dashboard → Authentication → URL Configuration with:

- Site URL: `https://shireenvarma.github.io/bingeberry/`
- Redirect URL: `https://shireenvarma.github.io/bingeberry/`

New teammates must use **Create an account**, then confirm their email. An administrator must then approve their workspace access from Team Members. The confirmation dialog supports resending verification emails; use **Forgot Password** only to change a password.

## Auth model

- Users sign up with their own email and password.
- The first account created becomes `admin`.
- Later signups default to `team`.
- Admins can edit roles, assigned clients, and task ownership from the dashboard.
- Passwords are handled by Supabase Auth and are never visible in the UI.

## Product And UX Brief

These are standing project instructions for every future feature and fix; the user
does not need to repeat or explicitly invoke them.

Act as the product architect for an agency task platform. Translate requested
functionality into a complete, scalable workflow and make routine design decisions
without waiting for pixel-level instructions. Preserve BingeBerry's visual identity.

- Design for 100 teammates, brands, and task types, not only today's sample data.
- Use compact, labeled dropdowns for growing option lists; add search when needed.
- Combine filters predictably, show the current selection and result count, and provide a clear reset.
- Make full task information accessible through progressive disclosure instead of truncation alone.
- Separate selection, completion, and destructive actions; preserve role permissions.
- Support keyboard navigation, readable mobile layouts, empty states, loading, and errors.
- Keep feature logic in focused modules and identify required database migrations.
- Verify behavior, permission boundaries, and layout at realistic data sizes before calling work complete.

## Operational Notes

- Install test dependencies with `npm ci`, then run `npm test`.
- Existing accounts remain approved. New verified accounts need approval by an admin under Team Members → Edit → Approved workspace access.
- Shared task visibility applies to approved members of this single agency workspace. Separate agencies must use separate Supabase projects until workspace isolation is implemented.
- Financial values and business goals are available only to admins and people granted goals access. Only admins can change financial values or delete brands.
- Shared edits use conflict detection; a stale edit asks the user to refresh instead of overwriting a teammate's work.
- Reminder time and recurring generation use `Asia/Kolkata`. Completed tasks are eligible for permanent deletion after 24 hours; the hourly cleanup may run up to one hour later.

## Deploying The Reliability Update

For an existing deployment, apply these in Supabase SQL Editor **before pushing the new frontend**:

1. `supabase/migrations/20261113_reliability.sql`
2. `supabase/migrations/20261113_reminders.sql`

Apply older migrations first if they have not already been installed. The new migrations are rerunnable and preserve existing account approval. They add task transactions, conflict detection, finance restrictions, approval, an occurrence ledger, and scheduled jobs. They do not delete active tasks.

Then commit the changed frontend files, new helper modules, migrations, tests, `package.json`, and `package-lock.json`, and push to `main` for GitHub Pages. `.gitignore` excludes local IDE files, dependencies, and environment secrets.

## Enabling Reminder Email Delivery

Reminders now have a real database queue and a worker, replacing the inactive EmailJS settings. Email delivery requires an email provider and one-time deployment configuration:

1. Configure a verified sender in Resend. Store `RESEND_API_KEY`, `REMINDER_FROM`, and a random `REMINDER_CRON_SECRET` as Supabase Edge Function secrets. Never put them in `supabase/config.js`, GitHub Pages, or the repository.
2. Authenticate the Supabase CLI and link it to the BingeBerry project, then deploy with `supabase functions deploy task-reminders --no-verify-jwt`. The worker validates its own scheduler secret; ordinary anonymous and authenticated requests are rejected.
3. In Supabase Vault add `bingeberry_reminder_worker_url` with the deployed function URL, and `bingeberry_reminder_worker_token` with the same scheduler secret.
4. Run `supabase/schedule-reminder-worker.sql` in SQL Editor. It invokes the worker every minute using `pg_net` and Vault.
5. Create a test task assigned to an approved user with email reminders enabled, with a reminder due a few minutes ahead. Check `reminder_deliveries.sent_at` and the recipient's inbox after the scheduled minute.

Delivery uses leases, bounded retries, and provider idempotency keys. The queue is private; only the service role can claim or acknowledge deliveries. Completed tasks and opted-out or unassigned recipients are excluded. If configuration is missing, the worker returns a configuration error rather than marking reminders delivered. Existing Supabase Auth confirmation/reset emails still use Supabase SMTP settings, independently of task reminders.

## Manual Regression Check

After migration and deployment, test with an admin, manager, approved team member, and newly verified account. Verify approval, financial access, task creation from both forms, conflict handling in two tabs, filter combinations, a 500-word brief, drag and keyboard ordering, bulk deletion, and mobile navigation. Confirm tab switching preserves drafts and navigation, reset links show the password form, and a running timer survives reload. Automated tests use an isolated PostgreSQL engine and a DOM runtime; they do not modify the live database or send email.

## Workspace Features

- `resetData()` clears workspace data but keeps user accounts.
- Team members can add tasks for themselves and update progress on their own tasks.
- Admins and managers can create and assign tasks, manage recurring templates, and reorder clients.
- Project timelines automatically create and update synced tasks for project-type clients.
