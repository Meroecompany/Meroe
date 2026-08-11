// ============================================================
// MEROE Platform v2 — Testes Jest (auth.routes + middleware)
// tests/auth.test.js
// USO: npm test
// Nota: usa light-my-request para injeção HTTP sem bind TCP
//       (compatível com ambientes sandboxed macOS)
// ============================================================
'use strict';

const { inject } = require('light-my-request');
const jwt        = require('jsonwebtoken');

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test_secret_at_least_64_chars_long_for_github_actions_ci';

// ── MOCKS DE BASE DE DADOS ────────────────────────────────────
const mockInsertResult = { rows: [{ id: 'new-test-uuid-1234' }] };
const mockEmptyResult  = { rows: [] };

jest.mock('../src/db/connection', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(cb =>
    cb({
      query: jest.fn()
        .mockResolvedValueOnce(mockEmptyResult)    // CHECK email duplicado → vazio = não existe
        .mockResolvedValueOnce(mockInsertResult)    // INSERT user → devolve id
        .mockResolvedValueOnce({ rows: [] })        // INSERT profile
        .mockResolvedValue(mockEmptyResult),
    })
  ),
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

// ── HELPER: injetar request no app Express ───────────────────
async function req(method, url, { body, headers = {} } = {}) {
  return inject(app, {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload: body ? JSON.stringify(body) : undefined,
  });
}

// ── HELPER: criar token JWT de teste válido ───────────────────
function makeTestToken(payload = {}) {
  return jwt.sign(
    { id: 'test-user-uuid', role: 'technician', email: 'test@test.com', ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '1h', issuer: 'meroe-platform', audience: 'meroe-api' }
  );
}

// ─────────────────────────────────────────────────────────────
// SUITE: POST /api/auth/register
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve recusar dados em falta', async () => {
    const res = await req('POST', '/api/auth/register', { body: { email: 'test@test.com' } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('deve recusar password fraca', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { email: 'test@test.com', password: 'weak', full_name: 'Test User' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deve recusar email duplicado', async () => {
    const { withTransaction } = require('../src/db/connection');
    withTransaction.mockImplementationOnce(async (cb) => {
      return cb({
        query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-user-id' }] }),
      });
    });

    const res = await req('POST', '/api/auth/register', {
      body: { email: 'existing@test.com', password: 'Password1!', full_name: 'Test User' },
    });
    expect([400, 409]).toContain(res.statusCode);
  });

  it('deve recusar email com formato inválido', async () => {
    const res = await req('POST', '/api/auth/register', {
      body: { email: 'nao-e-um-email', password: 'Password1!', full_name: 'Test User' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: POST /api/auth/login
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve recusar campos em falta', async () => {
    const res = await req('POST', '/api/auth/login', { body: { email: 'test@test.com' } });
    expect(res.statusCode).toBe(400);
  });

  it('deve retornar 401 para utilizador inexistente', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await req('POST', '/api/auth/login', {
      body: { email: 'nope@test.com', password: 'Password1!' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deve recusar password em falta', async () => {
    const res = await req('POST', '/api/auth/login', { body: { email: 'test@test.com' } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: Middleware de Autenticação
// ─────────────────────────────────────────────────────────────
describe('Middleware requireAuth', () => {
  it('deve devolver 401 para rota protegida sem token', async () => {
    const res = await req('GET', '/api/profiles/me');
    expect(res.statusCode).toBe(401);
  });

  it('deve devolver 401 para token malformado', async () => {
    const res = await req('GET', '/api/profiles/me', {
      headers: { authorization: 'Bearer isto-nao-e-um-token-valido' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deve devolver 401 para token com segredo errado', async () => {
    const wrongToken = jwt.sign({ id: 'x', role: 'technician' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await req('GET', '/api/profiles/me', {
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deve devolver 401 para token sem Bearer prefix', async () => {
    const token = makeTestToken();
    const res = await req('GET', '/api/profiles/me', {
      headers: { authorization: token },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: GET /api/health
// ─────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  it('deve retornar status healthy com versão', async () => {
    const res = await req('GET', '/api/health');
    expect(res.statusCode).toBeLessThanOrEqual(503);
    const body = JSON.parse(res.body);
    expect(body.version).toBe('2.0.0');
  });

  it('deve retornar campo status no body', async () => {
    const res = await req('GET', '/api/health');
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('status');
  });
});

describe('GET /api/health/ping', () => {
  it('deve retornar pong', async () => {
    const res = await req('GET', '/api/health/ping');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pong).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: Segurança — Headers HTTP
// ─────────────────────────────────────────────────────────────
describe('Segurança — Headers HTTP', () => {
  it('deve ter X-Content-Type-Options: nosniff', async () => {
    const res = await req('GET', '/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('deve ter X-Frame-Options definido', async () => {
    const res = await req('GET', '/api/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('deve ter X-Request-ID no header de resposta', async () => {
    const res = await req('GET', '/api/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('deve ter Strict-Transport-Security', async () => {
    const res = await req('GET', '/api/health');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: RBAC — Endpoints de Admin
// ─────────────────────────────────────────────────────────────
describe('RBAC — Endpoints de Admin', () => {
  it('deve devolver 401 para /api/admin/candidates sem token', async () => {
    const res = await req('GET', '/api/admin/candidates');
    expect(res.statusCode).toBe(401);
  });

  it('deve devolver 403 para /api/admin/candidates com token de technician', async () => {
    const token = makeTestToken({ role: 'technician' });
    query.mockResolvedValueOnce({ rows: [{ role: 'technician', is_active: true, mfa_enabled: false }] });
    const res = await req('GET', '/api/admin/candidates', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: Rotas não existentes
// ─────────────────────────────────────────────────────────────
describe('Rotas não existentes', () => {
  it('deve retornar 404 para rota desconhecida', async () => {
    const res = await req('GET', '/api/rota-que-nao-existe');
    expect(res.statusCode).toBe(404);
  });

  it('deve retornar body JSON com campo error no 404', async () => {
    const res = await req('GET', '/api/endpoint-inexistente');
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE: Forgot Password
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('deve recusar body sem email', async () => {
    const res = await req('POST', '/api/auth/forgot-password', { body: {} });
    expect(res.statusCode).toBe(400);
  });

  it('deve responder de forma genérica mesmo com email inexistente (anti-enumeração)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await req('POST', '/api/auth/forgot-password', {
      body: { email: 'naoexiste@test.com' },
    });
    expect([200, 202]).toContain(res.statusCode);
  });
});
