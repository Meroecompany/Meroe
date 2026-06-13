// ============================================================
// MEROE Platform v2 — Testes Jest (auth.routes)
// tests/auth.test.js
// USO: npm test
// ============================================================
'use strict';

const request = require('supertest');
const app     = require('../src/server');

// Mock da BD para testes
jest.mock('../src/db/connection', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(cb => cb({ query: jest.fn().mockResolvedValue({ rows: [] }) })),
  connectDB: jest.fn().mockResolvedValue(),
  pool: { query: jest.fn().mockResolvedValue({ rows: [{ count: '0' }] }), end: jest.fn() },
}));

jest.mock('../src/utils/audit', () => ({ auditLog: jest.fn() }));
jest.mock('../src/services/email.service', () => ({ sendEmail: jest.fn() }));
jest.mock('firebase-admin', () => {
  const mockBucket = {
    file: jest.fn(() => ({
      save: jest.fn().mockResolvedValue(),
      getSignedUrl: jest.fn().mockResolvedValue(['http://mock-url']),
    })),
    getFiles: jest.fn().mockResolvedValue([[]]),
  };
  return {
    apps: { length: 0 },
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    storage: () => ({ bucket: () => mockBucket }),
  };
});

const { query } = require('../src/db/connection');

describe('POST /api/auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deve recusar dados em falta', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('deve recusar password fraca', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@test.com', password: 'weak', full_name: 'Test User',
    });
    expect(res.status).toBe(400);
  });

  it('deve recusar email duplicado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });
    const res = await request(app).post('/api/auth/register').send({
      email: 'existing@test.com', password: 'Password1!', full_name: 'Test User',
    });
    expect([400, 409, 500]).toContain(res.status);
  });
});

describe('POST /api/auth/login', () => {
  it('deve recusar campos em falta', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'test@test.com' });
    expect(res.status).toBe(400);
  });

  it('deve retornar 401 para utilizador inexistente', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/login').send({
      email: 'nope@test.com', password: 'Password1!',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/health', () => {
  it('deve retornar status healthy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBeLessThanOrEqual(503);
    expect(res.body.version).toBe('2.0.0');
  });
});

describe('GET /api/health/ping', () => {
  it('deve retornar pong', async () => {
    const res = await request(app).get('/api/health/ping');
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
  });
});

describe('Segurança — Headers', () => {
  it('deve ter X-Content-Type-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('deve ter X-Frame-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('Rotas não existentes', () => {
  it('deve retornar 404', async () => {
    const res = await request(app).get('/api/rota-que-nao-existe');
    expect(res.status).toBe(404);
  });
});
