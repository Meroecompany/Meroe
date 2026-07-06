# MIGRACAO.md — Relatório de Consolidação e Migração (Fase 1)

Este documento descreve as decisões técnicas tomadas para a consolidação física do projeto **MEROE Platform** na pasta definitiva `projeto/`, unindo o melhor da versão corrigida `meroe_v2` e os ajustes de segurança e testes da versão da raiz.

---

## 1. Decisões de Consolidação por Componente

### 1.1 Backend (`meroe-platform/`)
* **Base Adoptada:** `meroe_v2/meroe-platform/`
  * **Motivo:** Contém as correções críticas de segurança e lógica do backend v2 (rota de tokens sem replay, correção da ordem das rotas do Express, envio de emails com pool SMTP, e inicialização lazy de SDKs).
* **Mesclagens com a Versão da Raiz:**
  * **`src/server.js`:** Mantivemos a versão da raiz (11 de Junho) que inclui ajustes de compatibilidade para execução de testes unitários com Jest (detecção automática de importação em ambiente de testes) e correção de avisos do ESLint.
  * **`src/db/migrate.js`:** Preservado a partir da versão exclusiva da raiz. Este script automatiza o parse e execução do `sql/schema.sql` no PostgreSQL.
  * **`package.json`:** Mesclado o script `"test"` ajustado para Jest com flags de terminação forçada (`jest --coverage --runInBand --detectOpenHandles --forceExit`) e as dependências `"pdf-parse"` (necessária para análise automática de CV) e `"express-validator"`.
  * **`.github/workflows/deploy.yml`:** Mantida a versão da raiz que continha pequenas atualizações de CI/CD.

### 1.2 Frontend & Website (`meroe-website/`)
* **Base Adoptada:** `meroe_v2/meroe-website/`
  * **Motivo:** Contém os ficheiros do portal frontend v2 consolidado, incluindo a lógica de refresh automático de assinaturas Firebase Storage no `dashboard.html`.
* **Mesclagens com a Versão da Raiz:**
  * **`index.html`:** Adotada a versão da raiz (5 de Junho). Esta versão removeu permanentemente a chave Gemini do código JavaScript client-side (que estava obfuscada na versão `meroe_v2`), fazendo as chamadas ao chatbot de IA de forma segura através do proxy de backend `/api/chat`.
  * **`api/chat.js`:** Mantida a versão da raiz que substituiu o comentário com a chave real por um placeholder descritivo.
  * **`vercel.json`:** Adotado o modelo seguro da raiz que define políticas CORS explícitas restringindo acesso ao domínio da Vercel. Contudo, devido à validação de DNS (ver Secção 2), o destino da API foi mantido temporariamente como placeholder.

---

## 2. Condição 1 — DNS e Destino do Gateway no Vercel

Realizámos um teste de resolução ao subdomínio configurado no `vercel.json` da raiz (`api.meroe-engineering.com`).
* **Resultado:** `NXDOMAIN` (Não resolvido / domínio inexistente na rede pública).
* **Decisão:** De acordo com as instruções, utilizámos o placeholder dinâmico no `vercel.json` consolidado:
  ```json
  { "source": "/api/:path*", "destination": "https://SEU-PROJETO.up.railway.app/api/:path*" }
  ```

---

## 3. Condição 2 — Segurança e Rotação de Segredos

O ficheiro `.env` original da raiz continha segredos configurados. Para garantir que nenhuma credencial é exposta no repositório de produção:
1. **Ficheiro Ignorado:** Confirmamos que `.env` está registado nos ficheiros `.gitignore` de ambas as pastas e **não foi copiado** para a nova pasta `projeto/`.
2. **Uso de Placeholders:** Apenas ficheiros `.env.example` sem valores reais estão presentes em `projeto/meroe-platform/` e `projeto/meroe-website/`.
3. **Segredos Identificados (para Rotação):** As seguintes variáveis continham segredos preenchidos no `.env` do programador anterior (recomenda-se rotação em produção):
   * `JWT_SECRET` (Chave de criptografia de tokens JWT)
   * `REFRESH_TOKEN_SECRET` (Chave de assinatura dos refresh tokens)
   * `COOKIE_SECRET` (Segredo para cookie assinado)
   * `GEMINI_API_KEY` (Chave de acesso à API Google Gemini)

---

## 4. Condição 3 — Script de Migração da BD

O ficheiro `src/db/migrate.js` foi mantido em `projeto/meroe-platform/src/db/migrate.js`.
* **Função:** Script Node.js idempotente que se liga à base de dados PostgreSQL, carrega as queries presentes em `sql/schema.sql` e executa-as sequencialmente, tratando erros de ligação.
* **Uso no Fluxo:** Essencial para automatizar a criação inicial das tabelas e índices em localhost e no pipeline de CI/CD.

---

*Relatório de consolidação gerado em 19 de Junho de 2026 pela Equipa de Engenharia Sénior MEROE.*
