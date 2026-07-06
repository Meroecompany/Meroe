# MEROE v2 — Instruções de Instalação e Deploy

## 1. WEBSITE (Vercel) — gratuito, 60 segundos

```bash
cd meroe-website
vercel --prod
```

Ou via dashboard:
1. vercel.com → Import → pasta `meroe-website`
2. Environment Variables → adicionar: `GEMINI_API_KEY`
3. Deploy

**URLs públicas:**
- `/` → website corporativo
- `/plataforma` → registo de técnicos
- `/login` → login
- `/privacidade` → política de privacidade

---

## 2. BASE DE DADOS (Supabase) — gratuito

1. supabase.com → New Project → angola/africa
2. Settings → Database → copiar connection string
3. SQL Editor → colar conteúdo de `meroe-platform/sql/schema.sql` → Run
4. Copiar **DATABASE_URL** para `.env`

---

## 3. BACKEND (Railway) — gratuito

```bash
cd meroe-platform
cp .env.example .env
# Preencher TODOS os valores no .env
railway login
railway up
```

Ou via GitHub Actions (automático no push para main).

**Variáveis obrigatórias no Railway:**
```
NODE_ENV=production
DATABASE_URL=...
JWT_SECRET=...           (64+ chars hex)
REFRESH_TOKEN_SECRET=... (64+ chars hex)
COOKIE_SECRET=...        (32+ chars hex)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_STORAGE_BUCKET=...
GEMINI_API_KEY=...
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=noreply@meroe-engineering.com
SMTP_PASS=...
APP_URL=https://meroe-digital.vercel.app
ALLOWED_ORIGINS=https://meroe-digital.vercel.app,https://meroe-engineering.com
```

---

## 4. FIREBASE STORAGE — para upload de CVs

1. console.firebase.google.com → Novo projecto `meroe-digital-prod`
2. Storage → Começar → regras:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /cvs/{userId}/{allPaths=**} {
      allow read, write: if false; // acesso apenas via backend (service account)
    }
  }
}
```
3. Project Settings → Service accounts → Generate new private key
4. Copiar valores para `.env`

---

## 5. CRIAR CONTA SUPER ADMIN

Após deploy:
```bash
cd meroe-platform
node src/scripts/setup-admin.js
```
Ou inserir directamente no Supabase SQL:
```sql
INSERT INTO users (email, password_hash, role, is_active, is_verified)
VALUES (
  'admin@meroe-engineering.com',
  -- hash gerado com bcrypt de 12 rounds
  '$2b$12$...',
  'super_admin', TRUE, TRUE
);
```

---

## 6. DOMÍNIO PRÓPRIO

1. Comprar `meroe-engineering.com` (Namecheap, ~$12/ano)
2. Vercel Dashboard → Domains → Add `meroe-engineering.com`
3. Adicionar registos DNS:
   - `A @ 76.76.21.21`
   - `CNAME www meroe-digital.vercel.app`
4. Aguardar propagação (~30min)

---

## 7. MONITORIZAÇÃO

- Health check: `GET https://seu-railway-url/api/health`
- Métricas: `GET /api/health/metrics`
- Logs: Railway Dashboard → Logs

Recomendado: configurar UptimeRobot (gratuito) para alertas:
- https://uptimerobot.com → Monitor → HTTPS → URL do health check

---

## SEGREDOS — Como gerar

```bash
# JWT_SECRET e REFRESH_TOKEN_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# COOKIE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## NOTAS v2 (alterações em relação ao v1)

### Backend
- ✅ `reset.routes.js` integrado em `auth.routes.js` (eliminada duplicação)
- ✅ `cookie-parser` adicionado ao server.js (estava em falta — causava falha no refresh)
- ✅ `express-slow-down` adicionado (protecção brute-force gradual)
- ✅ Rate limit específico para `/forgot-password`
- ✅ Refresh token rotation (mais seguro)
- ✅ JWT inclui `audience: 'meroe-api'` (validação mais estrita)
- ✅ JWT_SECRET validado ao arrancar (fail-fast em produção)
- ✅ `/api/admin/candidates/:id/reject` agora tem requireRole explícito
- ✅ Novos endpoints: `/auth/mfa/setup`, `/auth/mfa/confirm`, `/auth/change-password`, `/auth/me`
- ✅ Timeout graceful de 30s no shutdown
- ✅ Pool DB com min connections e `application_name`
- ✅ DB retry automático no arranque (5 tentativas)
- ✅ `audit_logs` inclui `jwtid` para futura blacklist
- ✅ Schema v2: tabela `password_history`, função `cleanup_expired_sessions()`

### Frontend
- ✅ `platform.css` partilhado elimina duplicação de `:root` e estilos base em 4 ficheiros
- ✅ Botão "Voltar ao Website" no canto superior esquerdo em todas as páginas de plataforma
- ✅ Botão "Sair" em todas as páginas de plataforma
- ✅ Barra de progresso do perfil no dashboard
- ✅ Toast notifications em vez de `alert()`
- ✅ XSS prevention com função `esc()` em todas as interpolações HTML
- ✅ Modal de alteração de password
- ✅ Setup MFA via QR code
- ✅ Novos `rewrites` no vercel.json: `/login`, `/dashboard`, `/admin`
- ✅ Cache-Control `no-store` nas páginas de plataforma
