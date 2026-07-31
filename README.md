# Respira — Comando Financeiro

Sistema pessoal, local-first e instalável para organizar receitas, contas, dívidas, envelopes semanais e projeções.

## O que já está pronto

- Painel mensal com situação **Déficit / Apertado / Respira**
- Proteção da folga mínima antes da distribuição da sobra
- Receitas por salário, diária/viagem e extras
- Contas essenciais, vencimentos, recorrência e baixa de pagamento
- Dívidas em **ATACAR / JUROS / CONGELADA / QUITADA**
- Fila automática de ataque por prioridade
- Envelopes semanais para dinheiro livre
- Cenários de quantidade de diárias
- Projeção financeira de 24 meses
- Fechamento mensal com criação automática do próximo mês
- Cofre local criptografado com PIN usando PBKDF2 + AES-GCM
- Backup criptografado e restauração
- PWA instalável e funcionamento offline
- Layout responsivo para computador e celular

## Privacidade

Nenhum dado financeiro pessoal está gravado neste repositório. Os dados ficam criptografados no navegador do usuário. Faça backups regulares: limpar os dados do navegador remove o cofre local.

## Executar localmente

O projeto não usa dependências ou etapa de build.

```bash
python -m http.server 8080
```

Depois abra `http://localhost:8080`.

> Não abra o `index.html` diretamente por `file://`, pois módulos JavaScript e o service worker precisam de um servidor HTTP.

## Publicar no GitHub Pages

O workflow em `.github/workflows/pages.yml` publica o conteúdo estático. No repositório, abra **Settings → Pages** e escolha **GitHub Actions** como fonte.

## Estrutura

- `index.html`: shell da aplicação e diálogos
- `styles.css`: design system e responsividade
- `js/model.js`: regras e cálculos financeiros
- `js/storage.js`: criptografia, cofre e backup
- `js/templates.js`: formatação e componentes HTML pequenos
- `js/app.js`: interface, formulários e navegação
- `sw.js`: funcionamento offline
- `manifest.webmanifest`: instalação como aplicativo
