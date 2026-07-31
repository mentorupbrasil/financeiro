-- Respira / GestorPro Financeiro
-- Neon já tem neon_auth (Auth nativo). Este schema guarda o estado financeiro.

create table if not exists public.respira_state (
  id text primary key default 'default',
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists respira_state_updated_at_idx
  on public.respira_state (updated_at desc);

comment on table public.respira_state is 'Estado mensal do comando financeiro pessoal (JSON completo).';
