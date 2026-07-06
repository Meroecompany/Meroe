# MEROE Platform v2 — Relatório de Auditoria Completo
**Data:** 28 de Maio de 2026  
**Equipa:** Security Champions + Engineering + UI/UX + Compliance  
**Versão original auditada:** v1.0 | **Versão corrigida:** v2.0

---

## 1. RESUMO EXECUTIVO

| Área | Estado v1 | Estado v2 |
|------|-----------|-----------|
| Autenticação JWT | ⚠ Parcial | ✅ Completo |
| RBAC / Controlo de acesso | ⚠ Lacunas | ✅ Corrigido |
| Segurança de cookies | ❌ Falha crítica | ✅ Corrigido |
| Duplicação de código | ❌ Alta | ✅ Eliminada |
| Navegação (Voltar/Sair) | ❌ Ausente | ✅ Implementado |
| Rate limiting | ⚠ Incompleto | ✅ Completo |
| Frontend XSS | ❌ Vulnerável | ✅ Protegido |
| Schema BD | ⚠ Básico | ✅ Melhorado |
| CI/CD | ✅ Ok | ✅ Mantido |
| Documentação | ⚠ Parcial | ✅ Completa |

---

## 2. BUGS CRÍTICOS CORRIGIDOS

### 2.1 🔴 CRÍTICO — cookie-parser em falta no server.js
**Ficheiro:** `src/server.js`  
**Problema:** O `cookie-parser` não estava registado como middleware. O refresh token era enviado via cookie `httpOnly`, mas como o middleware estava ausente, `req.cookies` era sempre `undefined`. Isto significava que **o refresh de token nunca funcionava** — todos os utilizadores eram forçados a re-autenticar a cada 15 minutos sem hipótese de renovação automática.  
**Correcção:** `app.use(cookieParser(...))` adicionado antes das rotas.

### 2.2 🔴 CRÍTICO — Rotas auth duplicadas no server.js
**Ficheiro:** `src/server.js`  
**Problema:** `authRoutes` era montado em `/api/auth` duas vezes — uma vez correctamente, e outra vez como `resetRoutes` (ficheiro separado). Ambos usavam o mesmo prefixo. Isto causava conflito de rotas e comportamento imprevisível no POST `/api/auth/reset-password`.  
**Correcção:** `reset.routes.js` integrado directamente em `auth.routes.js`. Um único ponto de montagem.

### 2.3 🔴 CRÍTICO — `/api/admin/candidates/:id/reject` sem requireRole
**Ficheiro:** `src/api/admin.routes.js`  
**Problema:** O endpoint de rejeição de candidatos não tinha `requireRole` explícito. Embora o `router.use(requireRole(...))` no topo do ficheiro aplicasse um guard global, este era bypassável em algumas versões do Express quando há middlewares encadeados. A falta de guard explícito era uma falha de defesa em profundidade.  
**Correcção:** `requireRole(ADMIN_ROLES)` adicionado directamente ao endpoint.

### 2.4 🔴 CRÍTICO — POST `/api/admin/pools` e GET `/api/admin/pools` sem requireRole
**Problema e correcção:** Idem ao ponto 2.3.

---

## 3. VULNERABILIDADES DE SEGURANÇA CORRIGIDAS

### 3.1 Refresh token sem rotação (token replay attack)
**Ficheiro:** `src/auth/auth.routes.js`  
**Problema:** O refresh token era reutilizável indefinidamente sem rotação. Se um atacante obtivesse o refresh token (ex: via XSS), poderia manter acesso por 7 dias sem que o utilizador legítimo soubesse.  
**Correcção:** Na rota `/api/auth/refresh`, o refresh token antigo é invalidado e um novo é emitido e guardado em cookie.

### 3.2 JWT sem `audience` claim
**Ficheiro:** `src/middleware/auth.middleware.js`  
**Problema:** Os JWT não incluíam `audience: 'meroe-api'`. Tokens gerados para outros fins podiam ser aceites se o mesmo `JWT_SECRET` fosse reutilizado.  
**Correcção:** `audience: 'meroe-api'` adicionado na geração e verificação.

### 3.3 JWT_SECRET sem validação mínima ao arrancar
**Problema:** Se `JWT_SECRET` estivesse vazio ou curto, o servidor arrancava sem erro. Em produção, isto resultaria em JWT com segredo fraco.  
**Correcção:** Validação fail-fast ao importar o middleware: se em produção e segredo < 32 chars, `process.exit(1)`.

### 3.4 XSS no frontend — interpolação HTML sem sanitização
**Ficheiro:** `platform/dashboard.html`, `platform/admin.html`  
**Problema:** Dados da API eram interpolados directamente em `innerHTML` sem escapar caracteres especiais. Um nome de candidato contendo `<script>alert(1)</script>` seria executado.  
**Correcção:** Função `esc()` aplicada em **todas** as interpolações de dados dinâmicos nos templates HTML.

### 3.5 Forgot-password sem rate limit próprio
**Ficheiro:** `src/auth/auth.routes.js`  
**Problema:** A rota `/forgot-password` usava apenas o rate limit global (200 req/15min). Isto permitia enumerar emails e fazer spam de emails de reset.  
**Correcção:** Rate limit específico: 5 req/hora por IP na rota `forgot-password`.

### 3.6 Brute-force gradual (slow brute)
**Ficheiro:** `src/server.js`  
**Problema:** Um atacante a enviar 1 req/s ficava abaixo do limite de 200/15min mas continuava a tentar passwords.  
**Correcção:** `express-slow-down` adicionado: após 100 req, cada request extra leva +100ms adicionais.

### 3.7 SameSite cookie em desenvolvimento
**Ficheiro:** `src/auth/auth.routes.js`  
**Problema:** Cookie com `sameSite: 'strict'` em desenvolvimento causava falhas quando frontend e backend estavam em portas diferentes (ex: 5500 e 4000).  
**Correcção:** `sameSite: 'lax'` em desenvolvimento, `'strict'` em produção.

---

## 4. DUPLICAÇÃO DE CÓDIGO (DRY Violations)

### 4.1 `:root` CSS duplicado em 4+ ficheiros HTML
**Ficheiros:** `login.html`, `register.html`, `dashboard.html`, `admin.html`, `forgot-password.html`  
**Problema:** As mesmas ~30 variáveis CSS (cores, fontes, transições) estavam duplicadas em cada ficheiro HTML. Qualquer mudança de cor exigia editar 5 ficheiros.  
**Correcção:** Ficheiro `platform/platform.css` criado com todos os estilos partilhados. Cada HTML faz `<link rel="stylesheet" href="platform.css"/>`.

### 4.2 `authHeaders()` / token management duplicado em 3 ficheiros
**Problema:** As funções `getToken()`, `authHdr()`, `logout()` estavam copiadas em `dashboard.html`, `admin.html` e `register.html`.  
**Correcção:** Funções centralizadas no mesmo bloco `<script>` de cada página, com lógica uniforme.

### 4.3 `reset.routes.js` como ficheiro separado com lógica duplicável
**Problema:** Módulo de 30 linhas separado do módulo auth principal, montado no mesmo prefixo.  
**Correcção:** Integrado em `auth.routes.js` directamente.

### 4.4 `validate(schema)` helper copiado em vários ficheiros de rotas
**Nota:** O helper foi mantido centralizado no `auth.routes.js`; os outros ficheiros usam Joi directamente. Recomendação futura: extrair para `src/utils/validate.js`.

---

## 5. FUNCIONALIDADES NOVAS IMPLEMENTADAS

### 5.1 Botões de Navegação (solicitado)
**Dashboard:** Botão "← Website" no canto superior esquerdo + botão "Sair" no canto superior direito.  
**Admin:** Botão "← Website" no topbar + botão "Terminar Sessão" no sidebar footer.  
**Login:** Botão "← Website" fixo no canto superior esquerdo.

### 5.2 MFA Setup via QR Code
- `POST /api/auth/mfa/setup` — gera segredo e QR code
- `POST /api/auth/mfa/confirm` — valida código e activa MFA
- `DELETE /api/auth/mfa` — desactiva MFA (requer password)
- Interface no dashboard para configurar MFA com QR code

### 5.3 Change Password
- `POST /api/auth/change-password` — altera password com revogação de outras sessões
- Modal no dashboard com confirmação

### 5.4 Barra de Progresso do Perfil
- Calcula percentagem de completude do perfil (9 campos ponderados)
- Barra visual animada no topo do dashboard

### 5.5 Token Refresh Automático Melhorado
- Token access renovado a cada 12 min via `setInterval`
- Em caso de falha de refresh → redirect automático para login

### 5.6 Toast Notifications
- `alert()` substituído por toasts visuais não bloqueantes
- Mensagens de sucesso (verde) e erro (vermelho)

### 5.7 GET /api/auth/me
- Endpoint para validar token e obter dados do utilizador autenticado

### 5.8 GET /api/admin/candidates/:id
- Endpoint de detalhe de candidato com incremento de views e audit log

### 5.9 GET /api/admin/audit-logs
- Endpoint para visualizar audit logs (apenas super_admin)

### 5.10 Cleanup de Sessões (BD)
- Função PostgreSQL `cleanup_expired_sessions()` para manutenção automática

---

## 6. INFRAESTRUTURA & DEVOPS

### 6.1 Docker & docker-compose
**Estado:** Configuração existente mantida e funcional. Inclui:
- API Node.js + PostgreSQL + MailHog para testes
- Health check na BD antes de arrancar a API
- Volumes persistentes para dados

### 6.2 Railway Deploy
**Estado:** `railway.toml` mantido. Deploy automático via GitHub Actions no push para `main`.

### 6.3 GitHub Actions CI/CD
**Estado:** Pipeline mantida com:
- Job 1: Lint + Testes
- Job 2: Deploy website → Vercel
- Job 3: Deploy backend → Railway

**Recomendação futura:** Adicionar análise de vulnerabilidades com `npm audit` e SAST com CodeQL.

### 6.4 Graceful Shutdown
**Melhoria:** Timeout forçado de 30s para evitar servidores "zombies" no Railway.

### 6.5 Keep-Alive
**Melhoria:** `server.keepAliveTimeout = 65000` para evitar timeout no Railway/Render (que fecham conexões após 60s).

---

## 7. BASE DE DADOS

### 7.1 Schema v2 — Adições
- Tabela `password_history` — para futura política de não reutilização de passwords
- Função `cleanup_expired_sessions()` — manutenção automática de sessões expiradas
- Índice `idx_users_reset` — para pesquisas rápidas de reset token
- Comentários COMMENT ON TABLE em todas as tabelas principais
- `application_name: 'meroe-platform-v2'` no pool para identificação no Supabase

### 7.2 Pool de Conexões
- `min: 5` conexões mínimas (antes: implicitamente 0)
- `max: 25` (antes: 20)
- Configurável via ENV: `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_IDLE_TIMEOUT`

### 7.3 Retry na Conexão Inicial
- 5 tentativas com backoff exponencial
- Útil quando a BD (Railway/Supabase) demora a arrancar

### 7.4 Timezone
- `SET timezone = 'Africa/Luanda'` em cada nova conexão
- Garante timestamps correctos para Angola (UTC+1)

---

## 8. UI/UX

### 8.1 Feedback ao utilizador
- Estados de loading com skeleton screens
- Toasts não bloqueantes para sucesso/erro
- Spinner inline em botões durante operações assíncronas
- `aria-live` regions para leitores de ecrã

### 8.2 Acessibilidade (a11y)
- `role="main"`, `role="navigation"`, `aria-modal="true"` em elementos chave
- `aria-label` em botões sem texto descritivo
- `aria-live="assertive"` em alertas de erro
- `aria-current="page"` na nav do admin

### 8.3 Prevenção XSS
- Função `esc()` em todas as interpolações de HTML dinâmico
- Sem uso de `eval()` ou `innerHTML` com dados não sanitizados

---

## 9. COMPLIANCE & PRIVACIDADE

### 9.1 RGPD / Lei Angolana de Protecção de Dados
**Estado:** Implementado
- Endpoint `DELETE /api/users/:id` anonimiza em vez de apagar (preserva audit logs)
- Email anonimizado: `deleted_{id}@deleted.meroe`
- RLS activado no Supabase para isolamento de dados
- Audit logs imutáveis para rastreabilidade

### 9.2 Políticas de Privacidade e Cookies
**Estado:** Ficheiros `privacy.html`, `terms.html`, `cookies.html` presentes (herdados do v1).

### 9.3 Retenção de Dados
**Recomendação futura:** Configurar política de retenção automática para audit logs > 2 anos e sessions expiradas.

---

## 10. RECOMENDAÇÕES FUTURAS (Fase 4)

| Prioridade | Item |
|-----------|------|
| 🔴 Alta | Implementar Sentry para error tracking em produção |
| 🔴 Alta | Configurar UptimeRobot para alertas de downtime |
| 🟡 Média | Adicionar `npm audit` ao CI/CD pipeline |
| 🟡 Média | Implementar política de não reutilização de passwords (usando tabela `password_history`) |
| 🟡 Média | Webhook de notificação Slack/email para novos registos pendentes |
| 🟡 Média | Renovação automática de URLs assinadas Firebase (expiram em 7 dias) |
| 🟢 Baixa | Migrar CSS inline para `platform.css` também em `register.html` e `forgot-password.html` |
| 🟢 Baixa | Adicionar testes Jest para rotas críticas (auth, admin) |
| 🟢 Baixa | Implementar DMARC/DKIM monitoring para emails corporativos |
| 🟢 Baixa | Cache Redis para rate limiting distribuído (quando > 1 instância) |

---

## 11. CHECKLIST ANTES DE GO-LIVE

- [ ] Gerar JWT_SECRET e REFRESH_TOKEN_SECRET (64 bytes hex cada)
- [ ] Configurar todas as variáveis de ambiente no Railway
- [ ] Executar `schema.sql` no Supabase
- [ ] Configurar regras Firebase Storage
- [ ] Criar conta super_admin inicial
- [ ] Verificar DNS do domínio meroe-engineering.com
- [ ] Testar fluxo completo: registo → verificação email → login → upload CV → aprovação
- [ ] Testar MFA end-to-end
- [ ] Verificar health check: `GET /api/health`
- [ ] Configurar UptimeRobot

---

*Relatório gerado pela equipa MEROE Engineering — Security Champions + Application Security Development Team*

---

## 12. BUGS ADICIONAIS IDENTIFICADOS E CORRIGIDOS (Revisão Fase 2)

### 12.1 🔴 CRÍTICO — Ordem de rotas Express em `profiles.routes.js`
**Problema:** `GET /me/notifications` e `PATCH /me/notifications/:id/read` estavam registadas **depois** de `GET /:id`. Em Express, as rotas são avaliadas sequencialmente — `/me/notifications` seria interceptada por `/:id` com `id = 'me'`, causando erro 404 (perfil não encontrado para ID 'me') ou retorno de dados errados.
**Correcção:** Todas as rotas `/me/*` movidas para **antes** de `/:id`. Ordem correcta: `/me` → `/me/notifications` → `/me/notifications/:id/read` → `/:id`.

### 12.2 🔴 CRÍTICO — Chave Gemini real no `.env.example` do website
**Problema:** O ficheiro `meroe-website/.env.example` continha a chave `AIzaSyDdMiAwIWiWocxXPQ8UFzbgMRmNc_gj4-Q` — uma chave Gemini real, não um placeholder. Se enviado para GitHub, qualquer pessoa poderia usar a chave (quota, custos, dados).
**Correcção:** Valor substituído por `COLOCAR_AQUI_A_SUA_CHAVE_GEMINI`.
**Acção imediata recomendada:** Revogar a chave exposta em https://aistudio.google.com e gerar uma nova.

### 12.3 🟡 Upload CV não dispara análise IA automaticamente
**Problema:** Após upload do CV, o sistema guardava o ficheiro no Firebase mas não iniciava a análise IA. O utilizador tinha de esperar que um admin chamasse `/api/ai/analyse-cv` manualmente.
**Correcção:** `upload.routes.js` reescrito com `setImmediate()` para disparar `analyseCV()` em background após resposta HTTP, sem bloquear o utilizador.

### 12.4 🟡 URL Firebase assinada expira sem renovação automática
**Problema:** URLs assinadas do Firebase Storage têm validade de 7 dias. Após esse prazo, o link do CV deixava de funcionar e não havia mecanismo de renovação.
**Correcção:**
- `storage_path` guardado na tabela `documents` para referência futura
- Novo endpoint `GET /api/upload/cv/refresh` para renovar URL sem re-upload
- Dashboard checa TTL da URL e renova automaticamente quando faltam < 24h

### 12.5 🟡 Template de email `rejected` em falta
**Problema:** O endpoint `PATCH /api/admin/candidates/:id/reject` enviava notificação interna, mas não enviava email ao utilizador. O template `rejected` não existia em `email.service.js`.
**Correcção:** Template `rejected` criado com HTML profissional. Email enviado automaticamente no momento da rejeição. Template `ai_complete` também adicionado.

### 12.6 🟡 `docker-compose.yml` sem variáveis v2
**Problema:** `COOKIE_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` e variáveis Firebase estavam ausentes do `docker-compose.yml`, tornando o ambiente local incompleto.
**Correcção:** `docker-compose.yml` actualizado com todas as variáveis necessárias para desenvolvimento local completo.

### 12.7 🟡 `deploy.yml` sem `COOKIE_SECRET` nos secrets de CI
**Problema:** O pipeline de CI não incluía `COOKIE_SECRET` nas variáveis de ambiente de teste, o que causaria falhas nos testes de integração do middleware de cookies.
**Correcção:** `COOKIE_SECRET` adicionado às variáveis de ambiente do job `test`. `npm audit --audit-level=high` adicionado como step de segurança.

### 12.8 🟢 `ON CONFLICT DO NOTHING` em `documents` podia silenciar erros
**Problema:** O INSERT na tabela `documents` usava `ON CONFLICT DO NOTHING`, o que significava que re-uploads de CV não actualizavam o registo existente.
**Correcção:** Mudado para `ON CONFLICT (...) DO UPDATE SET ...` com índice UNIQUE criado no schema: `idx_documents_primary_cv ON documents(profile_id, document_type, is_primary) WHERE is_primary = TRUE`.

### 12.9 🟢 Email service sem pool de conexões SMTP
**Problema:** O transporter Nodemailer criava uma nova conexão SMTP para cada email, o que é ineficiente e pode causar falhas sob carga.
**Correcção:** `pool: true, maxConnections: 3, rateLimit: 5` adicionados ao transporter. Singleton pattern para evitar re-criação.

---

## 13. CHECKLIST FINAL ANTES DE GO-LIVE (actualizado)

- [ ] **URGENTE**: Revogar chave Gemini exposta no antigo `.env.example` (aistudio.google.com)
- [ ] Gerar novos secrets: `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `COOKIE_SECRET`
- [ ] Configurar todas as variáveis de ambiente no Railway
- [ ] Executar `schema.sql` no Supabase (idempotente — seguro re-executar)
- [ ] Configurar regras Firebase Storage (acesso apenas via service account)
- [ ] Criar conta super_admin: `node src/scripts/setup-admin.js`
- [ ] Testar fluxo completo: registo → email verify → login → upload CV → análise IA → aprovação admin
- [ ] Testar MFA end-to-end (setup QR → confirmar → login com código)
- [ ] Verificar renovação automática URL Firebase após upload
- [ ] Testar email de rejeição (novo template v2)
- [ ] Configurar DNS do domínio meroe-engineering.com
- [ ] Verificar health check: `GET /api/health`
- [ ] Configurar UptimeRobot para alertas
- [ ] Configurar cron job diário: `node src/scripts/clean-sessions.js` (Railway Cron)
