# Respira — by GestorPro

Comando financeiro pessoal em [financeiro.gestorpro.sbs](https://financeiro.gestorpro.sbs).

## Acesso

- **PIN fixo:** `0707` (também em `APP_PIN` no servidor)
- Sem tela de criar PIN
- Sessão permanece aberta no navegador até bloquear
- Sync PostgreSQL (Neon) via `/api/state`

## Banco

O Neon já tinha o schema `neon_auth` (Auth nativo). O app usa a tabela:

- `public.respira_state` — JSON completo do comando financeiro

```bash
npm run migrate
```

Variáveis no Vercel / `.env`:

```
DATABASE_URL=postgresql://...
APP_PIN=0707
```

> Nunca commite `.env`. Se a URL do banco vazou em chat, troque a senha no Neon.

## Stack

- Front estático (PWA) com visual GestorPro (mint `#72e3ad`, Outfit)
- API Vercel (`/api/state`, `/api/health`)
- PostgreSQL Neon

## Local

```bash
npm install
npm run migrate
npx vercel dev
```

Ou só o front (sem sync): `npm run dev`

## GitHub Pages

O Pages continua publicando o estático, mas **a API Neon só funciona no Vercel**. Para o domínio `financeiro.gestorpro.sbs`, aponte o DNS para o projeto Vercel.
