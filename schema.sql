-- Respira / GestorPro Financeiro

create table if not exists public.respira_state (
  id text primary key default 'default',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1
);

alter table public.respira_state
  add column if not exists revision bigint not null default 1;

create index if not exists respira_state_updated_at_idx
  on public.respira_state (updated_at desc);

comment on table public.respira_state is 'Estado financeiro pessoal (JSON) com controle de revisão.';
