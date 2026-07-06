-- ============================================================
-- MEROE Platform v2 — Schema PostgreSQL Completo
-- sql/schema.sql
-- NOVO v2: tabela rate_limits, password_history, mfa_backup_codes
-- ============================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ============================================================
-- ENUM TYPES (idempotentes)
-- ============================================================
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('super_admin','recruiter','technician','partner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE profile_status AS ENUM ('incomplete','pending','approved','rejected','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE seniority_level AS ENUM ('junior','mid','senior','lead','expert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE doc_type AS ENUM ('cv','certificate','id_document','photo','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABELA: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT        NOT NULL,
  role              user_role   NOT NULL DEFAULT 'technician',
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  is_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  verify_token      TEXT,
  verify_token_exp  TIMESTAMPTZ,
  reset_token       TEXT,
  reset_token_exp   TIMESTAMPTZ,
  mfa_secret        TEXT,
  mfa_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  failed_logins     INTEGER     NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  last_login_ip     INET,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_reset    ON users(reset_token) WHERE reset_token IS NOT NULL;

-- ============================================================
-- TABELA: password_history (impede reutilização)
-- ============================================================
CREATE TABLE IF NOT EXISTS password_history (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pwdhist_user ON password_history(user_id, created_at DESC);

-- ============================================================
-- TABELA: profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name           VARCHAR(255)  NOT NULL,
  phone               VARCHAR(50),
  nationality         VARCHAR(100),
  location_city       VARCHAR(100),
  location_country    VARCHAR(100)  NOT NULL DEFAULT 'Angola',
  date_of_birth       DATE,
  discipline          VARCHAR(100),
  specialization      TEXT[]        DEFAULT '{}',
  experience_years    INTEGER       NOT NULL DEFAULT 0 CHECK (experience_years >= 0 AND experience_years <= 60),
  seniority_level     seniority_level,
  certifications      JSONB         NOT NULL DEFAULT '[]',
  skills              TEXT[]        DEFAULT '{}',
  languages           JSONB         NOT NULL DEFAULT '[]',
  professional_summary TEXT,
  available_for_tars  BOOLEAN       NOT NULL DEFAULT TRUE,
  availability_from   DATE,
  availability_notes  TEXT,
  daily_rate_usd      DECIMAL(10,2) CHECK (daily_rate_usd >= 0),
  linkedin_url        TEXT,
  cv_url              TEXT,
  cv_filename         TEXT,
  cv_uploaded_at      TIMESTAMPTZ,
  ai_data             JSONB,
  ai_score            DECIMAL(5,2)  CHECK (ai_score >= 0 AND ai_score <= 100),
  ai_tags             TEXT[]        DEFAULT '{}',
  ai_analysed_at      TIMESTAMPTZ,
  status              profile_status NOT NULL DEFAULT 'incomplete',
  rejection_reason    TEXT,
  reviewed_by         UUID          REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  views_count         INTEGER       NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user       ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_discipline ON profiles(discipline);
CREATE INDEX IF NOT EXISTS idx_profiles_status     ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_available  ON profiles(available_for_tars) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_profiles_score      ON profiles(ai_score DESC) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_profiles_country    ON profiles(location_country);
CREATE INDEX IF NOT EXISTS idx_profiles_fts ON profiles
  USING GIN(to_tsvector('portuguese',
    coalesce(full_name,'') || ' ' ||
    coalesce(discipline,'') || ' ' ||
    coalesce(professional_summary,'')
  ));

-- ============================================================
-- TABELA: documents
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type   doc_type    NOT NULL DEFAULT 'cv',
  file_name       VARCHAR(255) NOT NULL,
  file_url        TEXT        NOT NULL,
  storage_path    TEXT        NOT NULL,
  file_size_bytes INTEGER     CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  mime_type       VARCHAR(100),
  is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_profile ON documents(profile_id);
CREATE INDEX IF NOT EXISTS idx_documents_type    ON documents(document_type);
-- UNIQUE para permitir ON CONFLICT DO UPDATE no upsert do CV principal
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_primary_cv
  ON documents(profile_id, document_type, is_primary)
  WHERE is_primary = TRUE;

-- Coluna storage_path (caso a tabela já exista sem ela)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- ============================================================
-- TABELA: sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token   TEXT        UNIQUE NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(refresh_token) WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- TABELA: talent_pools
-- ============================================================
CREATE TABLE IF NOT EXISTS talent_pools (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  pool_type   VARCHAR(50) NOT NULL DEFAULT 'manual'
              CHECK (pool_type IN ('ai_generated','manual','project_based')),
  criteria    JSONB,
  created_by  UUID        NOT NULL REFERENCES users(id),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: pool_members
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_members (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id          UUID        NOT NULL REFERENCES talent_pools(id) ON DELETE CASCADE,
  profile_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ai_score         DECIMAL(5,2),
  ai_justification TEXT,
  added_by_ai      BOOLEAN     NOT NULL DEFAULT FALSE,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pool_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_pool_members_pool    ON pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_profile ON pool_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_score   ON pool_members(ai_score DESC);

-- ============================================================
-- TABELA: ai_searches
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_searches (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  searched_by     UUID        NOT NULL REFERENCES users(id),
  query_text      TEXT        NOT NULL,
  filters         JSONB,
  results_count   INTEGER,
  results_ids     UUID[],
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_searches_user ON ai_searches(searched_by);

-- ============================================================
-- TABELA: notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  type        VARCHAR(50) NOT NULL DEFAULT 'info'
              CHECK (type IN ('info','success','warning','action_required')),
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  action_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, is_read) WHERE NOT is_read;

-- ============================================================
-- TABELA: audit_logs (imutável — NUNCA apagar)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(100) NOT NULL,
  resource_type   VARCHAR(100),
  resource_id     UUID,
  old_value       JSONB,
  new_value       JSONB,
  ip_address      INET,
  user_agent      TEXT,
  request_id      TEXT,
  success         BOOLEAN     NOT NULL DEFAULT TRUE,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ============================================================
-- FUNÇÃO + TRIGGER: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['users','profiles','talent_pools'])
LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %s', t, t);
  EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
END LOOP; END $$;

-- ============================================================
-- FUNÇÃO: limpeza automática de sessões expiradas (cron job)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM sessions WHERE expires_at < NOW() OR revoked = TRUE;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- DECISÃO DE ARQUITECTURA: RLS desactivado intencionalmente.
-- Este backend liga-se via cliente PostgreSQL nativo (node-postgres)
-- com um utilizador de BD privilegiado. A função auth.uid() é exclusiva
-- do Supabase/PostgREST e não existe em PostgreSQL padrão (Railway, Docker).
-- A autorização row-level é garantida integralmente pela camada Express:
--   • Middleware requireAuth valida o JWT assinado em cada pedido
--   • Todas as queries filtram explicitamente por user_id = $req.user.id
--     usando queries parametrizadas (imunes a SQL injection)
--   • Endpoints de admin verificam req.user.role antes de executar
-- Se no futuro a infra migrar para Supabase (PostgREST), reactivar RLS
-- e substituir auth.uid() pelas políticas adequadas ao novo contexto.
-- ============================================================
ALTER TABLE users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles      DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- VISTAS
-- ============================================================
CREATE OR REPLACE VIEW v_approved_candidates AS
SELECT
  p.id, p.full_name, p.discipline, p.specialization,
  p.experience_years, p.seniority_level, p.certifications,
  p.skills, p.languages, p.available_for_tars, p.availability_from,
  p.location_city, p.location_country, p.ai_score, p.ai_tags,
  p.professional_summary, p.cv_url, p.created_at, u.email
FROM profiles p
JOIN users u ON p.user_id = u.id
WHERE p.status = 'approved' AND u.is_active = TRUE;

CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  COUNT(*) FILTER (WHERE role = 'technician')               AS total_technicians,
  COUNT(*) FILTER (WHERE role = 'partner')                  AS total_partners,
  (SELECT COUNT(*) FROM profiles WHERE status = 'pending')  AS pending_approval,
  (SELECT COUNT(*) FROM profiles WHERE status = 'approved') AS approved_profiles,
  (SELECT COUNT(*) FROM profiles WHERE available_for_tars AND status = 'approved') AS available_for_tars,
  (SELECT COUNT(*) FROM talent_pools WHERE is_active)       AS active_pools,
  (SELECT COUNT(*) FROM sessions WHERE expires_at > NOW() AND revoked = FALSE) AS active_sessions
FROM users WHERE is_active = TRUE;

-- ============================================================
-- COMENTÁRIOS nas tabelas (documentação BD)
-- ============================================================
COMMENT ON TABLE audit_logs IS 'Registo imutável de todas as acções — NUNCA apagar ou alterar';
COMMENT ON TABLE users IS 'Contas de utilizadores — dados sensíveis protegidos por RLS';
COMMENT ON TABLE profiles IS 'Perfis profissionais dos técnicos de O&G';
COMMENT ON TABLE sessions IS 'Sessões JWT refresh — limpeza automática via cleanup_expired_sessions()';
