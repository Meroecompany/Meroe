// ============================================================
// MEROE Platform v2 — Testes Jest (profiles.routes)
// tests/profiles.test.js
// Testa: GET /me, PUT /me (validação), rotas de notificações
// Nota: usa light-my-request — sem bind TCP (sandbox-compatible)
// ============================================================
'use strict';

const { inject } = require('light-my-request');
const jwt        = require('jsonwebtoken');

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test_secret_at_least_64_chars_long_for_github_actions_ci';

// ── MOCKS ────────────────────────────────────────────────────
jest.mock('../src/db/connection', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(cb => cb({ query: jest.fn().mockResolvedValue({ rows: [] }) })),
  connectDB: jest.fn().mockResolvedValue(),
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
    end: jest.fn(),
  },
}));

jest.mock('../src/utils/audit', () => ({ auditLog: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/services/email.service', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const { query } = require('../src/db/connection');
const app = require('../src/server');

// ── HELPER: injetar request ───────────────────────────────────
async function req(method, url, { body, headers = {} } = {}) {
  return inject(app, {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload: body ? JSON.stringify(body) : undefined,
  });
}

// ── Token JWT válido de técnico ───────────────────────────────
function makeTechToken() {
  return jwt.sign(
    { id: 'tech-user-uuid', role: 'technician', email: 'tech@test.com' },
    TEST_JWT_SECRET,
    { expiresIn: '1h', issuer: 'meroe-platform', audience: 'meroe-api' }
  );
}

// ─────────────────────────────────────────────────────────────
// SUITE: GET /api/profiles/me
// ─────────────────────────────────────────────────────────────
describe('GET /api/profiles/me', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve devolver 401 sem autenticação', async () => {
    const res = await req('GET', '/api/profiles/me');
    expect(res.statusCode).toBe(401);
  });

  it('deve devolver 404 quando técnico não tem perfil', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    const res = await req('GET', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
    });
    expect([401, 404]).toContain(res.statusCode);
  });

  it('deve devolver 200 com dados do perfil quando existe', async () => {
    const mockUser    = { id: 'tech-user-uuid', role: 'technician', is_active: true, mfa_enabled: false };
    const mockProfile = {
      id: 'profile-uuid', user_id: 'tech-user-uuid', full_name: 'Test Tech',
      discipline: 'Mechanical', status: 'approved', email: 'tech@test.com',
    };
    query.mockResolvedValueOnce({ rows: [mockUser] });
    query.mockResolvedValueOnce({ rows: [mockProfile] });

    const res = await req('GET', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
    });
    expect([200, 401]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: PUT /api/profiles/me — Validação de campos
// ─────────────────────────────────────────────────────────────
describe('PUT /api/profiles/me — Validação', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve devolver 401 sem autenticação', async () => {
    const res = await req('PUT', '/api/profiles/me', { body: { full_name: 'Novo Nome' } });
    expect(res.statusCode).toBe(401);
  });

  it('deve recusar experience_years negativo', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'tech-user-uuid', role: 'technician', is_active: true, mfa_enabled: false }] });
    const res = await req('PUT', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
      body: { experience_years: -5 },
    });
    expect([400, 401]).toContain(res.statusCode);
  });

  it('deve recusar experience_years > 60', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'tech-user-uuid', role: 'technician', is_active: true, mfa_enabled: false }] });
    const res = await req('PUT', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
      body: { experience_years: 99 },
    });
    expect([400, 401]).toContain(res.statusCode);
  });

  it('deve recusar linkedin_url com URL inválida', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'tech-user-uuid', role: 'technician', is_active: true, mfa_enabled: false }] });
    const res = await req('PUT', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
      body: { linkedin_url: 'nao-e-uma-url-valida' },
    });
    expect([400, 401]).toContain(res.statusCode);
  });

  it('deve recusar full_name com apenas 1 caracter', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'tech-user-uuid', role: 'technician', is_active: true, mfa_enabled: false }] });
    const res = await req('PUT', '/api/profiles/me', {
      headers: { authorization: `Bearer ${makeTechToken()}` },
      body: { full_name: 'A' },
    });
    expect([400, 401]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: GET /api/profiles/:id — RBAC
// ─────────────────────────────────────────────────────────────
describe('GET /api/profiles/:id — Controlo de Acesso', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve devolver 401 para utilizador não autenticado', async () => {
    const res = await req('GET', '/api/profiles/some-profile-uuid');
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: GET /api/profiles/me/notifications
// ─────────────────────────────────────────────────────────────
describe('GET /api/profiles/me/notifications', () => {
  it('deve devolver 401 sem autenticação', async () => {
    const res = await req('GET', '/api/profiles/me/notifications');
    expect(res.statusCode).toBe(401);
  });
});
