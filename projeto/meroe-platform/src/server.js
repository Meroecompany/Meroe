// ============================================================
// MEROE Platform v2 — Server Principal
// src/server.js
// FIXES: cookie-parser adicionado, rotas auth duplicadas removidas,
//        helmet CSP melhorado, slow-down adicionado, routes centralizadas
// ============================================================
'use strict';

require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const slowDown     = require('express-slow-down');
const hpp          = require('hpp');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { logger }   = require('./utils/logger');
const { connectDB } = require('./db/connection');

// ── ROTAS (centralizadas — sem duplicação) ─────────────────────
const authRoutes    = require('./auth/auth.routes');
const profileRoutes = require('./api/profiles.routes');
const adminRoutes   = require('./api/admin.routes');
const aiRoutes      = require('./api/ai.routes');
const uploadRoutes  = require('./api/upload.routes');
const healthRoutes  = require('./api/health.routes');
const usersRoutes   = require('./api/users.routes');
// FIX: reset.routes.js integrado em auth.routes.js — removida duplicação

const app  = express();
const PORT = process.env.PORT || 4000;

// ── TRUST PROXY (Vercel/Railway/Render/Cloudflare) ────────────
app.set('trust proxy', 1);

// ── HELMET — security headers ──────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ['https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https://storage.googleapis.com', 'https://firebasestorage.googleapis.com'],
      connectSrc:  ["'self'", 'https://generativelanguage.googleapis.com'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts:           { maxAge: 63072000, includeSubDomains: true, preload: true },
  noSniff:        true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // compatibilidade Vercel
}));

// ── CORS ───────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
  .concat([
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080',
  ]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {return cb(null, true);}
    logger.warn(`CORS blocked: ${origin}`);
    cb(new Error('Origem não autorizada'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
}));

// ── COMPRESSION ────────────────────────────────────────────────
app.use(compression());

// ── COOKIE PARSER (FIX: estava em falta — refresh_token precisava disto) ──
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));

// ── BODY PARSING ───────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── HPP (HTTP Parameter Pollution) ────────────────────────────
app.use(hpp());

// ── REQUEST ID ────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  _res.setHeader('X-Request-ID', req.id);
  next();
});

// ── RATE LIMITING GLOBAL ───────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos. Por favor aguarde 15 minutos.' },
  skip: (req) => req.path === '/api/health',
  keyGenerator: (req) => req.ip,
});
app.use(globalLimiter);

// ── SLOW DOWN (evita brute-force gradual) ─────────────────────
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 100,
  delayMs: (hits) => (hits - 100) * 100, // +100ms por req após limite
  skip: (req) => req.path === '/api/health',
});
app.use(speedLimiter);

// ── RATE LIMITING AGRESSIVO — Auth ────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Demasiadas tentativas de autenticação. Aguarde 15 minutos.' },
  keyGenerator: (req) => req.ip,
  skip: (req) => req.method === 'OPTIONS',
});

// ── REQUEST LOGGING ────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.path} ${res.statusCode} ${ms}ms`, {
      ip: req.ip,
      requestId: req.id,
      userAgent: req.get('User-Agent')?.substring(0, 100),
    });
  });
  next();
});

// ── ROTAS ──────────────────────────────────────────────────────
// FIX: authRoutes agora inclui reset; eliminada duplicação de /api/auth
app.use('/api/health',   healthRoutes);
app.use('/api/auth',     authLimiter, authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/upload',   uploadRoutes);
app.use('/api/users',    usersRoutes);

// Servir ficheiros locais em ambiente de desenvolvimento
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── ROTA RAIZ ──────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'MEROE Platform API',
    version: '2.0.0',
    status: 'online',
    docs: '/api/health',
  });
});

// ── 404 ────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path });
});

// ── GLOBAL ERROR HANDLER ───────────────────────────────────────
 
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    requestId: req.id,
    path: req.path,
  });

  if (err.message === 'Origem não autorizada') {
    return res.status(403).json({ error: 'CORS: origem não autorizada' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Pedido demasiado grande' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message,
    requestId: req.id,
  });
});

// ── INICIAR SERVIDOR ───────────────────────────────────────────
async function start() {
  try {
    await connectDB();
    logger.info('✅ Base de dados ligada');

    const server = app.listen(PORT, () => {
      logger.info(`🚀 MEROE Platform API → http://localhost:${PORT}`);
      logger.info(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    // Keep-alive para Railway/Render (evita timeout 30s)
    server.keepAliveTimeout = 65000;
    server.headersTimeout   = 66000;

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} recebido — a encerrar servidor...`);
      server.close(async () => {
        const { pool } = require('./db/connection');
        await pool.end().catch(() => {});
        logger.info('Servidor encerrado com segurança');
        process.exit(0);
      });
      // Forçar encerramento após 30s
      setTimeout(() => process.exit(1), 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('uncaughtException',  e => { logger.error('uncaughtException:', e);  shutdown('uncaughtException'); });
    process.on('unhandledRejection', e => { logger.error('unhandledRejection:', e); shutdown('unhandledRejection'); });

  } catch (err) {
    logger.error('Falha ao arrancar servidor:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
module.exports = app; // para testes Jest

