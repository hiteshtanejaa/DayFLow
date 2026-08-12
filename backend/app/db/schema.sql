-- Supabase migration for the agentic scheduling assistant.
-- Run in the Supabase SQL editor (or via `supabase db push`) on an
-- EU-region project, per the GDPR data-residency requirement.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  pseudonym uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  title text not null,
  duration_minutes int not null,
  energy_required text not null default 'medium',
  priority int not null default 3,
  deadline timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'pending',
  orchestration_mode text not null,
  created_at timestamptz not null default now()
);

create table if not exists disruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  description text not null,
  disruption_type text not null,
  detected_at timestamptz not null default now()
);

-- Powers both the audit trail UI and the RQ1 automated metrics (latency,
-- token cost, accuracy) — every agent step writes exactly one row here.
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  orchestration_mode text not null,
  agent_name text not null,
  action text not null,
  input_summary text,
  output_summary text,
  reasoning_summary text,
  latency_ms numeric,
  tokens_input int,
  tokens_output int,
  created_at timestamptz not null default now()
);

create table if not exists experiment_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  condition text not null check (condition in ('A_ai_full', 'B_ai_passive', 'C_own_tool')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
