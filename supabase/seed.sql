-- Local only: this file runs when the local stack starts (`supabase start`, `supabase db reset`).
-- Production is never seeded. The value is made up; it only lets the server tests read a team key.
select vault.create_secret('yt-test-000', 'team_youtube_key', 'Fake key for the server tests');
