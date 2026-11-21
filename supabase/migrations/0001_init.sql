-- Job Pilot AI — initial schema
-- Every user-owned table carries user_id and is protected by Row Level Security
-- (owner-only). The background worker uses the service-role key, which bypasses RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profile & resumes
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  profile_data jsonb not null default '{}'::jsonb,   -- master career profile (source of truth)
  preferences jsonb not null default '{}'::jsonb,    -- job preferences
  settings jsonb not null default '{}'::jsonb,       -- ai / automation / scoring / notifications
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_api_key_enc text,          -- AES-256-GCM, encrypted with APP_ENCRYPTION_KEY server-side
  telegram_bot_token_enc text,
  updated_at timestamptz not null default now()
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  original_file_path text,       -- path in private storage bucket "resumes"
  mime_type text,
  raw_text text,
  extracted_data jsonb not null default '{}'::jsonb,
  extraction_method text,        -- 'ai' | 'heuristic'
  resume_type text not null default 'uploaded',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index resumes_user_idx on public.resumes(user_id);

-- ---------------------------------------------------------------------------
-- companies & jobs
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website text,
  industry text,
  company_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  query jsonb not null default '{}'::jsonb,     -- {keywords, roles[], locations[], exclude[]}
  filters jsonb not null default '{}'::jsonb,   -- JobFilters
  sources text[] not null default '{}',
  schedule text not null default 'manual' check (schedule in ('manual','6h','12h','daily','weekly','custom')),
  cron text,
  enabled boolean not null default true,
  is_preset boolean not null default false,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index saved_searches_user_idx on public.saved_searches(user_id);
create index saved_searches_due_idx on public.saved_searches(next_run_at) where enabled;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  company text not null,
  company_id uuid references public.companies(id) on delete set null,
  company_logo text,
  location text,
  countries text[] not null default '{}',
  description text,
  salary_min numeric,
  salary_max numeric,
  currency text,
  salary_period text,           -- year | month | hour
  salary_text text,
  job_type text,                -- full-time | part-time | contract | freelance | internship | temporary
  remote_type text,             -- remote | hybrid | onsite | unknown
  experience_min numeric,
  experience_max numeric,
  source text not null,
  source_url text,
  apply_url text,
  external_job_id text,
  skills text[] not null default '{}',
  tags text[] not null default '{}',
  easy_apply boolean,
  visa_sponsorship boolean,
  degree_required text,
  company_size text,
  industry text,
  deadline date,
  match_score integer,
  match_analysis jsonb,
  ai_analysis jsonb,
  fingerprint text,
  duplicate_of uuid references public.jobs(id) on delete set null,
  hidden boolean not null default false,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  analyzed_at timestamptz
);
create unique index jobs_source_ext_uidx on public.jobs(user_id, source, external_job_id) where external_job_id is not null;
create index jobs_user_idx on public.jobs(user_id, discovered_at desc);
create index jobs_fp_idx on public.jobs(user_id, fingerprint);
create index jobs_score_idx on public.jobs(user_id, match_score desc nulls last);
create index jobs_url_idx on public.jobs(user_id, source_url);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  source_name text not null,
  source_url text,
  external_job_id text,
  created_at timestamptz not null default now(),
  unique (job_id, source_name, source_url)
);
create index job_sources_job_idx on public.job_sources(job_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  resume_id uuid references public.resumes(id) on delete set null,
  generated_content jsonb not null,    -- TailoredResume
  change_log jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,   -- previous edits (undo across sessions)
  method text,                          -- 'ai' | 'rules'
  file_name text,
  file_path text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resume_versions_job_idx on public.resume_versions(user_id, job_id);

create table public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null default 'cover_letter' check (kind in ('cover_letter','intro','recruiter','linkedin','email')),
  tone text not null default 'professional',
  content text not null,
  flags text[] not null default '{}',
  method text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cover_letters_job_idx on public.cover_letters(user_id, job_id);

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  resume_version_id uuid references public.resume_versions(id) on delete set null,
  cover_letter_id uuid references public.cover_letters(id) on delete set null,
  cover_letter text,
  application_status text not null default 'discovered' check (application_status in (
    'discovered','saved','shortlisted','resume_generated','ready_to_apply','awaiting_approval',
    'applied','application_confirmed','recruiter_contacted','interview','assessment','offer',
    'rejected','withdrawn','expired')),
  status_history jsonb not null default '[]'::jsonb,
  mode text check (mode in ('manual','assisted','auto')),
  shortlisted_at timestamptz,
  applied_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  assessment_at timestamptz,
  offer_details jsonb,
  notes text,
  follow_up_date date,
  recruiter_details jsonb not null default '{}'::jsonb,
  submission_evidence jsonb,
  review_data jsonb,             -- filled-form snapshot awaiting approval
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index applications_user_status_idx on public.applications(user_id, application_status);

create table public.application_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  question text not null,
  answer text not null,
  source text not null default 'ai' check (source in ('library','profile','ai','manual','rules')),
  flags text[] not null default '{}',
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index application_answers_job_idx on public.application_answers(user_id, job_id);

create table public.answer_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  question text not null,
  answer text not null,
  category text not null default 'general',
  verified boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  scheduled_at timestamptz,
  round integer not null default 1,
  interview_type text,
  details jsonb not null default '{}'::jsonb,
  prep jsonb,
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_at timestamptz not null default now()
);
create index interviews_user_idx on public.interviews(user_id, scheduled_at);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  due_at timestamptz not null,
  type text not null default 'follow_up',
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  note text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index followups_due_idx on public.followups(user_id, status, due_at);

-- ---------------------------------------------------------------------------
-- agent
-- ---------------------------------------------------------------------------
create table public.agent_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state text not null default 'running' check (state in ('running','paused','stopped')),
  updated_at timestamptz not null default now()
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  task_type text not null check (task_type in ('search','job_analysis','resume_tailoring','cover_letter',
    'application_preparation','application_submission','status_monitoring','notification')),
  status text not null default 'pending' check (status in ('pending','running','waiting_user','completed','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  logs jsonb not null default '[]'::jsonb,
  error text,
  retry_count integer not null default 0,
  max_retries integer not null default 2,
  requires_browser boolean not null default false,
  run_after timestamptz not null default now(),
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_tasks_queue_idx on public.agent_tasks(status, run_after);
create index agent_tasks_user_idx on public.agent_tasks(user_id, created_at desc);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete set null,
  kind text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index agent_events_user_idx on public.agent_events(user_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  content text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read, created_at desc);

-- ---------------------------------------------------------------------------
-- browser workspace & extension
-- ---------------------------------------------------------------------------
create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  url text not null,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create table public.browser_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  job_id uuid references public.jobs(id) on delete set null,
  visited_at timestamptz not null default now()
);
create index browser_history_user_idx on public.browser_history(user_id, visited_at desc);

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,     -- sha256 of the token; plaintext is shown once
  token_prefix text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger t_user_profiles_updated before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger t_applications_updated before update on public.applications for each row execute function public.set_updated_at();
create trigger t_agent_tasks_updated before update on public.agent_tasks for each row execute function public.set_updated_at();
create trigger t_resume_versions_updated before update on public.resume_versions for each row execute function public.set_updated_at();
create trigger t_cover_letters_updated before update on public.cover_letters for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only on every table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_profiles','user_secrets','resumes','companies','saved_searches','jobs',
    'job_sources','resume_versions','cover_letters','applications','application_answers','answer_library',
    'interviews','followups','agent_state','agent_tasks','agent_events','notifications','bookmarks',
    'browser_history','api_tokens']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$,
                   t || '_owner', t);
  end loop;
end $$;

-- secrets are never readable from the browser; the server decrypts with the service role
revoke select on public.user_secrets from authenticated;
grant insert, update, delete on public.user_secrets to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for resumes, folder per user
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false)
      on conflict (id) do nothing;
    execute $p$create policy "resumes_owner_rw" on storage.objects for all to authenticated
      using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;
