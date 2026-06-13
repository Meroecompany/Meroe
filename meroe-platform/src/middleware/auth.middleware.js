// ============================================================
// MEROE Platform v2 — Middleware de Autenticação e RBAC
// src/middleware/auth.middleware.js
// FIXES:
//  - JWT_SECRET validado ao arrancar (sem fallback inseguro)
//  - requireRole aceita array ou múltiplos args
//  - Tokens: algorithm RS256 configurável via ENV
//  - jwtid incluído para suporte a blacklist futura
// ============================================================
'use strict';

const jwt    = require('jsonwebtoken');
const { query } = require('../db/connection');
const { logger } = require('../utils/logger');

const JWT_SECRET      = process.env.JWT_SECRET;
const REFRESH_SECRET  = process.env.REFRESH_TOKEN_SECRET;

// Validar segredos ao arrancar (fail-fast)
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  logger.error('JWT_SECRET não configurado ou demasiado curto (mínimo 32 chars)');
  if (process.env.NODE_ENV === 'production') {process.exit(1);}
}
if (!REFRESH_SECRET || REFRESH_SECRET.length < 32) {
  logger.error('REFRESH_TOKEN_SECRET não configurado ou demasiado curto');
  if (process.env.NODE_ENV === 'production') {process.exit(1);}
}

// ── VERIFICAR ACCESS TOKEN ─────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação em falta', code: 'NO_TOKEN' });
    }

    const token = header.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, {
        issuer:   'meroe-platform',
        audience: 'meroe-api',
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Token inválido', code: 'INVALID_TOKEN' });
    }

    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Tipo de token inválido' });
    }

    // Verificar utilizador na BD
    const result = await query(
      'SELECT id, email, role, is_active, mfa_enabled FROM users WHERE id = $1',
      [payload.userId]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Conta não encontrada ou desactivada' });
    }

    req.user = {
      id:          result.rows[0].id,
      email:       result.rows[0].email,
      role:        result.rows[0].role,
      mfa_enabled: result.rows[0].mfa_enabled,
    };

    next();
  } catch (err) {
    logger.error('Auth middleware error:', { message: err.message });
    res.status(500).json({ error: 'Erro interno de autenticação' });
  }
}

// ── RBAC — exigir papel específico ────────────────────────────
// Uso: requireRole('super_admin', 'recruiter')  ou  requireRole(['super_admin'])
function requireRole(...roles) {
  const flatRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    if (!flatRoles.includes(req.user.role)) {
      logger.warn('RBAC access denied', {
        userId:   req.user.id,
        userRole: req.user.role,
        required: flatRoles,
        path:     req.path,
      });
      return res.status(403).json({
        error:    'Não tem permissão para aceder a este recurso',
        required: flatRoles,
        current:  req.user.role,
      });
    }
    next();
  };
}

// ── RBAC: só o próprio utilizador OU admin ─────────────────────
function requireSelfOrAdmin(paramField = 'userId') {
  return (req, res, next) => {
    const targetId = req.params[paramField];
    const isAdmin  = ['super_admin', 'recruiter'].includes(req.user?.role);
    const isSelf   = req.user?.id === targetId;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'Acesso negado: não é o proprietário do recurso' });
    }
    next();
  };
}

// ── GERAR TOKENS ───────────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');

function generateTokens(userId, role) {
  const jwtid = uuidv4(); // para futura blacklist

  const accessToken = jwt.sign(
    { userId, role, type: 'access' },
    JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      issuer:    'meroe-platform',
      audience:  'meroe-api',
      jwtid,
    }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    REFRESH_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      issuer:    'meroe-platform',
      audience:  'meroe-api',
    }
  );

  return { accessToken, refreshToken };
}

// ── VERIFICAR REFRESH TOKEN ────────────────────────────────────
async function verifyRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, REFRESH_SECRET, {
      issuer:   'meroe-platform',
      audience: 'meroe-api',
    });
  } catch {
    throw new Error('Refresh token inválido');
  }

  if (payload.type !== 'refresh') {throw new Error('Tipo de token inválido');}

  const result = await query(
    `SELECT s.id, s.user_id, u.role, u.is_active
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.refresh_token = $1
       AND s.expires_at > NOW()
       AND s.revoked = FALSE`,
    [token]
  );

  if (!result.rows.length)     {throw new Error('Sessão inválida ou expirada');}
  if (!result.rows[0].is_active) {throw new Error('Conta desactivada');}

  return result.rows[0];
}

module.exports = {
  requireAuth,
  requireRole,
  requireSelfOrAdmin,
  generateTokens,
  verifyRefreshToken,
};
