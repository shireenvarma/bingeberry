# Binge Berry

This dashboard now uses Supabase for:

- user signup and login
- persistent JWT-backed sessions
- team profiles and roles
- clients and task assignment
- shared workspace documents for goals, recurring templates, checklist state, and settings

## Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](/Users/sanchit/IdeaProjects/bingeberry/supabase/schema.sql).
3. Copy [`supabase/config.example.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.example.js) to [`supabase/config.js`](/Users/sanchit/IdeaProjects/bingeberry/supabase/config.js) and fill in your project URL and anon key.
4. Serve the project over a local web server from the repo root.
5. Open `index.html` through that server.

## Auth model

- Users sign up with their own email and password.
- The first account created becomes `admin`.
- Later signups default to `team`.
- Admins can edit roles, assigned clients, and task ownership from the dashboard.
- Passwords are handled by Supabase Auth and are never visible in the UI.

## Notes

- `resetData()` clears workspace data but keeps user accounts.
- Team members can update progress on their own tasks.
- Admins and managers can create and assign tasks.
