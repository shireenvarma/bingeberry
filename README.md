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

After changes, stage required new files in Git and remove confirmed disposable
untracked artifacts. Keep ignored local dependencies and preserve unrelated user files.

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
- Reminder time and recurring generation use `Asia/Kolkata`. Completed tasks are permanently deleted after 24 hours; the hourly cleanup may run up to one hour later. Reopening a task before cleanup cancels deletion until it is completed again. No manual cleanup is required.

## Deploying The Reliability Update

For an existing deployment, apply these in Supabase SQL Editor **before pushing the new frontend**:

1. `supabase/migrations/20261113_reliability.sql`
2. `supabase/migrations/20261113_reminders.sql`
3. `supabase/migrations/20261113_task_board_archive.sql`
4. `supabase/migrations/20261113_task_retention.sql` (apply last; supersedes archiving)

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

- Click a task title to open its detail panel without navigating away from the list. Full briefs and references remain readable; permitted users can explicitly save name, brief, due date, status, and priority changes. Other properties use the existing advanced edit form.
- Reference links can be entered in Quick Add or directly below the brief in the full task form. Read-only properties in the detail panel appear as text, not disabled editing controls.
- All Tasks has Table and Board views with shared brand, type, owner, status, and sorting controls. The chosen view is saved per user in that browser. The Board includes To Do, In Progress, In Review, Blocked, and Completed; Blocked preserves the existing workflow.
- Drag a card's handle between columns to update status, or use its Move to menu on mobile/keyboard. Permissions and optimistic concurrency checks apply to both. Moving a card never changes priority. Card order follows Organize by; manual ordering is managed in the table, not by dropping within a Board column.
- Quick Add is available only to admins and managers. Team members can still use normal Add Task. Both views open the same task details panel.
- **Retention correction:** run `supabase/migrations/20261113_task_retention.sql` in Supabase SQL Editor before deploying this frontend. It restores automatic permanent deletion after 24 hours, including completed tasks previously archived by the earlier Board migration. Existing installations only need this new migration; do not rerun the archive migration afterward. The existing hourly job is reused (or installed if missing). Maintenance is server-side and cannot be invoked by ordinary members.
- No archive view or manual cleanup is needed. The legacy `archived_at` database column is retained for compatibility but does not exempt a task from deletion. Deletion removes task briefs and reference links, not external Pinterest/Drive content. No social publishing, client-sharing, or approval automation is added by this Board update.
- The detail panel is a separate native-dialog UI module with mobile styling, focus restoration, draft protection, and optimistic conflict detection.

## Next Product Phase: Social Planner (Proposal)

The next feature to design is an agency social-content calendar, before task comments,
attachments, or richer editors. This section records direction, not implemented functionality.

- Use month/week calendar views plus an unscheduled-ideas list; filter by brand, channel, owner, and review status. Clicking a card opens a content detail panel.
- A content item should have an idea/title, brief, copy, references, concept images, intended publish time and timezone, and a review state. Internal tasks can link to content items, but content must be stored separately: the task cleanup policy must never delete approved posts, client feedback, or approval history.
- Provide a client review view through a revocable, scoped share link. It must expose only selected content for that client, never employee task APIs or the whole agency workspace. Decide whether comments require email verification before implementation.
- Separate internal notes from client-visible feedback. Model approvals against a content revision so later copy/image edits invalidate approval rather than silently publishing changed work.
- Future publishing should be a separate server-side integration and job queue, with per-brand social accounts, protected credentials, retries, and provider capability checks. Calendar dates and client approval must not themselves trigger publication.

Reference patterns: [Notion calendar database views](https://www.notion.com/help/calendars)
and [Notion sharing and permissions](https://www.notion.com/help/sharing-and-permissions).
Future Instagram integration should use [Meta's official Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

- `resetData()` clears workspace data but keeps user accounts.
- Team members can add tasks for themselves and update progress on their own tasks.
- Admins and managers can create and assign tasks, manage recurring templates, and reorder clients.
- Project timelines automatically create and update synced tasks for project-type clients.
