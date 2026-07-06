# MEROE Platform v2.0 — Sistema Completo

**Stack:** Node.js 20 · Express · PostgreSQL (Supabase) · Firebase Storage · Gemini AI · Vercel · Railway

## Estrutura do Projecto
```
meroe_v2/
├── meroe-platform/          # Backend API (Railway)
│   ├── src/
│   │   ├── server.js        # Ponto de entrada
│   │   ├── auth/            # Autenticação + MFA + Reset
│   │   ├── api/             # Rotas: profiles, admin, ai, upload, users, health
│   │   ├── middleware/      # JWT auth + RBAC
│   │   ├── db/              # Pool PostgreSQL com retry
│   │   ├── services/        # Email (Nodemailer + templates)
│   │   ├── utils/           # Logger Winston + Audit log
│   │   └── scripts/         # setup-admin.js · clean-sessions.js
│   ├── sql/schema.sql       # Schema PostgreSQL completo (idempotente)
│   ├── tests/               # Jest + Supertest
│   └── .env.example         # Todas as variáveis documentadas
│
├── meroe-website/           # Frontend (Vercel)
│   ├── index.html           # Website corporativo (PT/EN)
│   ├── platform/
│   │   ├── platform.css     # CSS partilhado (DRY)
│   │   ├── login.html       # Login + MFA
│   │   ├── register.html    # Registo multi-step
│   │   ├── dashboard.html   # Portal do técnico
│   │   ├── forgot-password.html
│   │   └── admin.html       # Painel admin + AI search
│   ├── api/chat.js          # Vercel Function (chatbot IA)
│   └── vercel.json          # Headers segurança + rewrites
│
├── meroe-email/             # Guias de configuração email
├── AUDITORIA_v2.md          # Relatório completo de auditoria
├── README.md                # Este ficheiro
└── meroe-website/INSTRUCOES.md  # Guia de deploy passo a passo
```

## Deploy Rápido (5 minutos)

```bash
# 1. Website
cd meroe-website && vercel --prod

# 2. Base de dados
# Supabase → SQL Editor → colar sql/schema.sql → Run

# 3. Backend
cd meroe-platform
cp .env.example .env  # Preencher variáveis
railway up

# 4. Admin inicial
node src/scripts/setup-admin.js
```

Ver `meroe-website/INSTRUCOES.md` para guia detalhado.

## O que há de novo na v2

| Categoria | Fix/Feature |
|-----------|-------------|
| 🔴 Bug crítico | `cookie-parser` em falta — refresh token nunca funcionava |
| 🔴 Bug crítico | Rotas auth duplicadas (`reset.routes.js`) |
| 🔴 Bug crítico | Ordem de rotas Express (`/me/notifications` apanhada por `/:id`) |
| 🔴 Bug crítico | `.env.example` com chave Gemini real exposta |
| 🔴 Segurança | Refresh token rotation (previne token replay) |
| 🔴 Segurança | XSS em todo o frontend (função `esc()`) |
| 🟡 Feature | Botões Voltar + Sair em todas as páginas |
| 🟡 Feature | Análise IA automática após upload do CV |
| 🟡 Feature | Renovação automática de URL Firebase expirada |
| 🟡 Feature | Setup MFA via QR code no dashboard |
| 🟡 Feature | Email de rejeição (template `rejected` em falta na v1) |
| 🟡 Feature | `GET /api/upload/cv/refresh` — renovar URL sem re-upload |
| 🟢 DRY | `platform.css` elimina duplicação CSS em 5 ficheiros |
| 🟢 DRY | `reset.routes.js` integrado em `auth.routes.js` |
| 🟢 DevOps | `docker-compose.yml` com todas as variáveis v2 |
| 🟢 DevOps | CI/CD com `npm audit` e `COOKIE_SECRET` |
| 🟢 Scripts | `setup-admin.js` + `clean-sessions.js` |
| 🟢 BD | Índice UNIQUE em `documents` para upsert correcto |
