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
   If you already set up the older version, rerun the updated schema file to add the new fields, backfills, indexes, and RLS policies.
3. Copy [`supabase/config.example.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.example.js) to [`supabase/config.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.js) and fill in your project URL and anon key.
4. Start the local server from the repo root with `npm start`.
5. Open [http://127.0.0.1:4174](http://127.0.0.1:4174) in your browser.
6. Do not open `index.html` directly as a `file://` page. Supabase auth will fail there.

## Auth model

- Users sign up with their own email and password.
- The first account created becomes `admin`.
- Later signups default to `team`.
- Admins can edit roles, assigned clients, and task ownership from the dashboard.
- Passwords are handled by Supabase Auth and are never visible in the UI.

## Notes

- `resetData()` clears workspace data but keeps user accounts.
- Team members can add tasks for themselves and update progress on their own tasks.
- Admins and managers can create and assign tasks, manage recurring templates, and reorder clients.
- Project timelines automatically create and update synced tasks for project-type clients.
