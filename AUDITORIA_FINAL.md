# Relatório de Auditoria Técnica Completa — MEROE Digital

Este documento apresenta a auditoria técnica completa sobre a estrutura consolidada da plataforma **MEROE Digital** (localizada em `projeto/`). O código foi analisado em detalhe sob as perspetivas de Segurança, Backend, Frontend, Base de Dados, Módulo de IA, Email Corporativo, DevOps/Infraestrutura e Compliance.

Cada item foi classificado de acordo com os seguintes critérios:
*   ✅ **Conforme:** Segue as melhores práticas, cumpre os requisitos do RFP e as regras de segurança estabelecidas.
*   ⚠️ **Parcial/Risco menor:** Funcional ou parcialmente em conformidade, mas apresenta fragilidades de design ou bugs menores.
*   ❌ **Falha crítica:** Erro de implementação, falha de segurança grave ou inconsistência arquitetural que impede o funcionamento seguro em produção.

---

## 1. Segurança

### ✅ Conforme
*   **Validação Fail-Fast de Segredos ao Arrancar:**  
    *Ficheiro:* [auth.middleware.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/middleware/auth.middleware.js#L20-L28)  
    *Detalhe:* O servidor valida se `JWT_SECRET` e `REFRESH_TOKEN_SECRET` estão preenchidos e têm pelo menos 32 caracteres, abortando a execução em produção (`process.exit(1)`) caso não cumpram os requisitos.
*   **Rotação de Refresh Tokens:**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L263-L284)  
    *Detalhe:* No endpoint `/api/auth/refresh`, o refresh token antigo é invalidado na base de dados e um novo token é gerado e retornado em cookie, mitigando ataques de reutilização (token replay).
*   **Segurança de Cookies:**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L83-L92)  
    *Detalhe:* Os cookies de sessão utilizam as diretivas `httpOnly: true`, `secure` em produção, e `sameSite: 'strict'` em produção (caindo para `'lax'` em desenvolvimento para evitar conflitos de portas locais), estando restritos à rota `/api/auth`.
*   **Audience e Issuer em Tokens JWT:**  
    *Ficheiro:* [auth.middleware.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/middleware/auth.middleware.js#L41-L44) e [L122-L140](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/middleware/auth.middleware.js#L122-L140)  
    *Detalhe:* Todos os tokens são emitidos e verificados com claims explícitos de `issuer: 'meroe-platform'` e `audience: 'meroe-api'`.
*   **Mecanismos de Rate Limiting e Anti-Brute-Force:**  
    *Ficheiro:* [server.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/server.js#L106-L133)  
    *Detalhe:* Proteção multicamadas ativa: limitador global de pedidos, middleware `express-slow-down` para atrasar pedidos suspeitos sequenciais (slow brute force) e um rate limiter agressivo exclusivo para as rotas `/api/auth`.
*   **Proteção de Endpoints Sensíveis (Forgot Password):**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L29-L35) e [L339-L368](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L339-L368)  
    *Detalhe:* O endpoint de recuperação de password possui um rate limiter próprio (5 pedidos/hora por IP) e responde sempre de forma genérica, impedindo a enumeração de emails registados.
*   **Bloqueio Temporário de Contas:**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L181-L208)  
    *Detalhe:* Implementação de contador de tentativas falhadas (`failed_logins`). Após 5 tentativas incorretas, a conta é bloqueada por 15 minutos (`locked_until`).
*   **Autenticação Multifator (MFA/2FA):**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L417-L493)  
    *Detalhe:* Integração robusta com TOTP (biblioteca `speakeasy`), geração de QR code em tempo real para configuração inicial e validação rigorosa nas rotas de login e alteração de definições.
*   **Hashing Seguro de Passwords:**  
    *Ficheiro:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L27)  
    *Detalhe:* Utilização de `bcrypt` com fator de custo de 12 (rounds) para todas as passwords, impedindo ataques de dicionário offline.
*   **Cabeçalhos de Segurança HTTP (Helmet):**  
    *Ficheiro:* [server.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/server.js#L38-L59)  
    *Detalhe:* Configuração completa do Helmet no Express, incluindo Content-Security-Policy (CSP) restritiva, HSTS configurado para 2 anos e desativação de Mime Sniffing.

---

## 2. Backend

### ✅ Conforme
*   **Validação de Parâmetros com Joi:**  
    *Ficheiros:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L37-L63) e [admin.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/admin.routes.js#L64-L75)  
    *Detalhe:* Validação estrita de todos os dados de entrada no backend (tanto rotas de autenticação como filtragem e paginação no admin), evitando SQL injection e dados corrompidos.
*   **Gestão de Transações na BD:**  
    *Ficheiros:* [auth.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/auth.routes.js#L101-L147) e [admin.routes.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/admin.routes.js#L304-L321)  
    *Detalhe:* Ações que afetam múltiplas tabelas (como o registo de utilizador + perfil básico ou a criação de uma pool + membros) são executadas dentro de blocos transacionais seguros (`withTransaction`), garantindo a integridade dos dados em caso de falha a meio da execução.
*   **Tratamento de Erros Global e Desligamento Controlado:**  
    *Ficheiro:* [server.js](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/server.js#L175-L237)  
    *Detalhe:* Handler global centraliza respostas de erros (ocultando detalhes internos em produção). Eventos `uncaughtException` e `unhandledRejection` são intercetados para fechar o pool de ligações antes do encerramento forçado.

### ⚠️ Parcial/Risco menor
*   **Lógica de Negócio nos Ficheiros de Rotas (Organização de Código):**  
    *Ficheiros:* Todos os ficheiros em [src/auth/](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/auth/) e [src/api/](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/)  
    *Detalhe:* As rotas Express acumulam toda a lógica de negócio, queries SQL e validações diretamente no handler da rota. Para facilitar a manutenção e legibilidade de acordo com arquiteturas limpas, esta lógica devia ser extraída para módulos de Controladores ou Serviços.

---

## 3. Frontend

### ✅ Conforme
*   **Prevenção Contundente de XSS:**  
    *Ficheiros:* [dashboard.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/dashboard.html#L676), [admin.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/admin.html#L597) e [register.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/register.html#L309)  
    *Detalhe:* Utilização sistemática da função utilitária `esc()` para sanitizar e escapar dados de texto interpolados nos templates HTML dinâmicos antes de serem inseridos via `.innerHTML` ou equivalentes.
*   **Gestão de Sessão do Utilizador:**  
    *Ficheiros:* [dashboard.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/dashboard.html#L270-L286) e [admin.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/admin.html#L313-L317)  
    *Detalhe:* O estado de autenticação e os dados do utilizador são isolados em `sessionStorage` (destruído ao fechar o separador). Lógica de logout correta que limpa os tokens e chama o endpoint de revogação no backend.
*   **Refresh Automático de Tokens:**  
    *Ficheiros:* [dashboard.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/dashboard.html#L751-L761) e [admin.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/admin.html#L600-L606)  
    *Detalhe:* Configuração de rotina periódica (`setInterval` a cada 12 minutos) para invocar a renovação do token de acesso em background sem interromper a navegação do utilizador.
*   **Botões de Navegação e Usabilidade:**  
    *Ficheiros:* [dashboard.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/dashboard.html#L93), [admin.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/admin.html#L162) e [login.html](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/platform/login.html#L46)  
    *Detalhe:* Todos os ecrãs internos do portal possuem agora de forma visível e acessível botões para retroceder ao website institucional ("← Website") ou para terminar sessão com segurança ("Sair").

### ⚠️ Parcial/Risco menor
*   **Comparação Incorreta de Propriedade do Perfil (Bug Crítico de Acesso por ID):**  
    *Ficheiro:* [profiles.routes.js:L153-L156](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/profiles.routes.js#L153-L156)  
    *Detalhe:* O endpoint `GET /api/profiles/:id` valida se o utilizador autenticado é dono do perfil com: `const isSelf = req.params.id === req.user.id;`. Contudo, `req.params.id` refere-se ao ID do registo na tabela `profiles` (que é um UUID dinâmico), enquanto `req.user.id` é o ID do utilizador autenticado (`users.id`). Como estes UUIDs nunca coincidem, um técnico em modo normal nunca conseguirá ver o seu próprio perfil através deste endpoint, obtendo sempre `403 Acesso negado`.  
    *Impacto:* Menor, porque o frontend utiliza `/api/profiles/me` para a visualização própria e os recrutadores são capturados pela verificação de papel (`isAdmin`), mas impede a utilização do endpoint por ID próprio.

---

## 4. Base de Dados

### ✅ Conforme
*   **Rastreabilidade Imutável:**  
    *Ficheiro:* [schema.sql](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/sql/schema.sql#L230-L249)  
    *Detalhe:* A tabela de `audit_logs` regista todas as ações críticas em base de dados e não possui rotas ou procedimentos que permitam a alteração ou remoção de dados, garantindo logs forenses à prova de adulteração.
*   **Estrutura de Índices e Performance:**  
    *Ficheiro:* [schema.sql](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/sql/schema.sql#L50-L53) e [L106-L117](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/sql/schema.sql#L106-L117)  
    *Detalhe:* Índices bem planeados para chaves estrangeiras, datas de expiração e um índice de texto completo (`GIN` para pesquisa FTS em português angolano).
*   **Gestão de Timezones:**  
    *Ficheiro:* [connection.js:L34](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/db/connection.js#L34)  
    *Detalhe:* Ligação ao PostgreSQL executa a alteração do timezone local para `Africa/Luanda` (UTC+1) ao iniciar a conexão, alinhando as datas de auditoria e criação ao local físico de atividade da empresa.

### ❌ Falha crítica
*   **Incompatibilidade das Políticas RLS do Supabase em Ligação Direta:**  
    *Ficheiro:* [schema.sql:L281-L298](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/sql/schema.sql#L281-L298)  
    *Detalhe:* O schema declara políticas de Row Level Security (RLS) dependentes de `auth.uid()`, por exemplo: `CREATE POLICY "users_own" ON users FOR ALL USING (id = auth.uid()::UUID);`.  
    *Problema:* O backend liga-se diretamente através de PostgreSQL nativo (`pg` client). Numa ligação nativa direta:
    1.  Se o utilizador da base de dados fornecido for o dono das tabelas (owner) ou superuser, o RLS é **ignorado por omissão**, tornando a política ineficaz.
    2.  Se o utilizador não for owner e o RLS for forçado, a query **falhará sempre** ou retornará vazio, dado que a função `auth.uid()` só funciona sob o contexto de autenticação JWT interno do Supabase (PostgREST), que não existe no cliente nativo de Node.js (que se liga diretamente e não inicializa variáveis locais de sessão).
    3.  Se a base de dados for um PostgreSQL genérico (como o fornecido no docker-compose local ou no Railway), a execução do script `schema.sql` **irá falhar** porque o schema `auth` ou a função `auth.uid()` não existem no servidor.

---

## 5. Módulo de IA

### ✅ Conforme
*   **Modelo Moderno Configurável:**  
    *Ficheiros:* [ai.routes.js:L34](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/ai.routes.js#L34) e [upload.routes.js:L90](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/upload.routes.js#L90)  
    *Detalhe:* Utilização do modelo de IA avançado `gemini-2.0-flash` para processar e estruturar a informação dos currículos técnicos.
*   **Fail-Safe de Arranque (Lazy Initialization):**  
    *Ficheiro:* [ai.routes.js:L27-L38](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/ai.routes.js#L27-L38)  
    *Detalhe:* A inicialização da biblioteca da Google Generative AI é executada apenas quando uma query é pedida (lazy loading), evitando que o servidor falhe no arranque por falta da chave `GEMINI_API_KEY` (útil para desenvolvimento local simplificado).
*   **Parser de JSON Robustecido:**  
    *Ficheiro:* [ai.routes.js:L54-L59](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/ai.routes.js#L54-L59) e [upload.routes.js:L118](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/upload.routes.js#L118)  
    *Detalhe:* Utilitário `extractJSON` utiliza expressões regulares para isolar blocos de código JSON válidos enviados pela IA, evitando falhas quando o modelo insere marcas markdown (como ` ```json `).
*   **Análise de CV Assíncrona Não Bloqueante:**  
    *Ficheiro:* [upload.routes.js:L260-L277](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/upload.routes.js#L260-L277)  
    *Detalhe:* O upload do currículo guarda o ficheiro e atualiza o estado imediatamente para o utilizador. A extração de texto em PDF e o posterior processamento no Gemini são enviados para background com `setImmediate`, impedindo que o timeout do request HTTP expire durante a resposta lenta da IA.

---

## 6. Email Corporativo

### ✅ Conforme
*   **Nodemailer com Pooling de Conexões:**  
    *Ficheiro:* [email.service.js:L87-L104](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/services/email.service.js#L87-L104)  
    *Detalhe:* Transporter SMTP configurado com pool ativado (máximo 3 conexões concorrentes) e limitador de taxa de envio para respeitar as quotas do Zoho Mail.
*   **Templates Completos:**  
    *Ficheiro:* [email.service.js:L21-L83](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/services/email.service.js#L21-L83)  
    *Detalhe:* Inclui todos os emails exigidos pelo fluxo de vida do candidato (verificação, redefinição, aprovação, rejeição com motivos e conclusão de análise IA).
*   **Documentação e Políticas de DNS:**  
    *Ficheiros:* [ACCOUNTS_LIST.md](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-email/ACCOUNTS_LIST.md) e [DNS_RECORDS.md](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-email/DNS_RECORDS.md)  
    *Detalhe:* Registo completo dos registos DNS necessários a apontar no Cloudflare (MX, SPF, DMARC e DKIM) para garantir entregabilidade 10/10 e proteção contra spoofing.

---

## 7. DevOps/Infraestrutura

### ✅ Conforme
*   **Dockerfile Otimizado e Seguro:**  
    *Ficheiro:* [Dockerfile](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/Dockerfile)  
    *Detalhe:* Utilização de imagem base minimalista (`node:20-alpine`), gestor de processos `dumb-init` configurado como Entrypoint (evitando PIDs zombie), exclusão de pacotes dev dependências, desativação de privilégios de root (`USER node`), e definição de verificação de integridade interna (`HEALTHCHECK`).
*   **CI/CD Pipeline Funcional:**  
    *Ficheiro:* [deploy.yml](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/.github/workflows/deploy.yml)  
    *Detalhe:* Fluxo automatizado via GitHub Actions que executa auditoria de qualidade de código (linting e testes unitários) antes de fazer deploy automático do frontend (Vercel) e backend (Railway).

### ⚠️ Parcial/Risco menor
*   **Ausência de Persistência Local de Ficheiros de CV em Desenvolvimento:**  
    *Ficheiro:* [upload.routes.js:L207-L211](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/upload.routes.js#L207-L211)  
    *Detalhe:* Em desenvolvimento (sem credenciais de Firebase Storage configuradas), o ficheiro PDF é apenas processado em memória pela IA e descartado. O URL retornado é `local://${id}/cv.pdf`, contudo, não existe qualquer persistência no disco do servidor nem uma rota API local para servir este ficheiro. Isto impossibilita o teste de descarga ou leitura física do CV em desenvolvimento local.
*   **Limitação do Rate Limiter Local em Funções Serverless:**  
    *Ficheiro:* [chat.js:L20-L22](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/api/chat.js#L20-L22) e [L51-L69](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/api/chat.js#L51-L69)  
    *Detalhe:* O rate limiter do chatbot seguro de IA utiliza um `Map` local na memória da função. Dado que as funções Serverless da Vercel são instâncias stateless e efémeras que escalam horizontalmente de forma isolada, este bloqueio por IP não é persistido e pode ser contornado caso as chamadas caiam em instâncias diferentes. Recomenda-se a migração futura para Redis ou Vercel KV.

---

## 8. Compliance

### ✅ Conforme
*   **RGPD / Conformidade com a Lei Angolana de Proteção de Dados:**  
    *Ficheiro:* [users.routes.js:L53-L62](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-platform/src/api/users.routes.js#L53-L62)  
    *Detalhe:* Em conformidade com o "Direito ao Esquecimento", a remoção física de uma conta não destrói o histórico forense e logs da base de dados. Em vez disso, os dados sensíveis do utilizador são anonimizados (`deleted_{id}@deleted.meroe` e hash de password nulo), preservando a consistência dos audit logs.

---

## 9. Acções Pendentes Antes de Produção

As seguintes ações técnicas são de execução obrigatória antes de realizar qualquer deploy em ambiente de produção:

1.  **Geração e Rotação de Segredos Criptográficos:**  
    *   Devem ser geradas novas chaves de criptografia e assinaturas seguras para substituir as chaves temporárias utilizadas em desenvolvimento.
    *   **Comando sugerido:** Executar no terminal:
        ```bash
        # Gerar segredo para JWT_SECRET (64 hex)
        openssl rand -hex 64
        # Gerar segredo para REFRESH_TOKEN_SECRET (64 hex)
        openssl rand -hex 64
        # Gerar segredo para COOKIE_SECRET (32 hex)
        openssl rand -hex 32
        ```
    *   **Ação:** Configurar os valores gerados nas variáveis de ambiente da plataforma Railway no painel de produção.

2.  **Configuração de DNS e Conectividade do Subdomínio de API:**  
    *   O subdomínio `api.meroe-engineering.com` deve ser configurado no painel do Cloudflare (ou registrador de DNS) como um registo **CNAME** a apontar para o domínio público gerado pelo Railway (ex: `meroe-api.up.railway.app`).
    *   **Ação após verificação do DNS (através de `dig api.meroe-engineering.com`):** Substituir o placeholder dinâmico de reencaminhamento no ficheiro [vercel.json](file:///Users/dennyroleitao/Desktop/MEROE/projeto/meroe-website/vercel.json#L52):
        ```diff
        - "destination": "https://SEU-PROJETO.up.railway.app/api/:path*"
        + "destination": "https://api.meroe-engineering.com/api/:path*"
        ```

3.  **Remoção de Políticas RLS Incompatíveis:**  
    *   Para evitar erros graves e travagens nos pipelines de CI/CD ou deploys locais/produção, as diretivas RLS e referências a `auth.uid()` devem ser comentadas ou removidas de `sql/schema.sql` se a ligação for realizada diretamente via cliente PostgreSQL nativo (`pg`).
