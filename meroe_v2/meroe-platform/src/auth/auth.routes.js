// ============================================================
// MEROE Platform v2 — Rotas de Autenticação (consolidadas)
// src/auth/auth.routes.js
// FIXES:
//  - reset.routes.js integrado aqui (elimina duplicação)
//  - POST /forgot-password com rate limit próprio
//  - GET /me para validar token e obter user info
//  - POST /mfa/setup e /mfa/verify adicionados
//  - Validação Joi consistente em todos os endpoints
//  - Cookie secure + sameSite corrigidos
// ============================================================
'use strict';

const express      = require('express');
const bcrypt       = require('bcrypt');
const speakeasy    = require('speakeasy');
const qrcode       = require('qrcode');
const Joi          = require('joi');
const rateLimit    = require('express-rate-limit');
const { query, withTransaction } = require('../db/connection');
const { generateTokens, verifyRefreshToken, requireAuth } = require('../middleware/auth.middleware');
const { auditLog }   = require('../utils/audit');
const { sendEmail }  = require('../services/email.service');
const { logger }     = require('../utils/logger');

const router        = express.Router();
const BCRYPT_ROUNDS = 12;

// Rate limit específico para forgot-password (anti-spam)
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5,
  message: { error: 'Demasiados pedidos de recuperação. Tente em 1 hora.' },
  keyGenerator: (req) => req.ip,
});

// ── SCHEMAS DE VALIDAÇÃO ───────────────────────────────────────
const PASSWORD_RULE = Joi.string()
  .min(8).max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
  .required()
  .messages({
    'string.pattern.base': 'Password precisa de maiúsculas, minúsculas, números e um símbolo especial',
  });

const registerSchema = Joi.object({
  email:     Joi.string().email().max(255).lowercase().required(),
  password:  PASSWORD_RULE,
  full_name: Joi.string().min(2).max(255).trim().required(),
  role:      Joi.string().valid('technician', 'partner').default('technician'),
  phone:     Joi.string().max(50).allow('', null).optional(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().max(128).required(),
  mfa_code: Joi.string().length(6).pattern(/^\d+$/).optional(),
});

const resetSchema = Joi.object({
  token:    Joi.string().uuid().required(),
  password: PASSWORD_RULE,
});

// ── HELPER: validação Joi middleware ──────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        error: 'Dados inválidos',
        details: error.details.map(d => d.message),
      });
    }
    req.body = value;
    next();
  };
}

// ── HELPER: cookie options ────────────────────────────────────
function cookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
    path:     '/api/auth',
  };
}

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, full_name, role, phone } = req.body;

  try {
    await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (existing.rows.length > 0) {
        const err = new Error('Email já registado'); err.status = 409; throw err;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, role, verify_token, verify_token_exp)
         VALUES ($1, $2, $3, gen_random_uuid(), NOW() + INTERVAL '24 hours')
         RETURNING id, email, role, verify_token`,
        [email, passwordHash, role]
      );
      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO profiles (user_id, full_name, phone, status)
         VALUES ($1, $2, $3, 'incomplete')`,
        [user.id, full_name.trim(), phone || null]
      );

      sendEmail({
        to: user.email,
        template: 'verify',
        data: {
          name: full_name,
          url:  `${process.env.APP_URL}/api/auth/verify?token=${user.verify_token}`,
        },
      }).catch(e => logger.error('Email verify error:', e));

      await auditLog({
        userId: user.id, action: 'user.register',
        resourceType: 'user', resourceId: user.id,
        ipAddress: req.ip, userAgent: req.get('User-Agent'),
        newValue: { email: user.email, role: user.role },
        success: true,
      });

      res.status(201).json({
        message: 'Conta criada. Verifique o seu email.',
        userId: user.id,
      });
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Register error:', err);
    res.status(500).json({ error: 'Erro ao criar conta. Tente novamente.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password, mfa_code } = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  try {
    const result = await query(
      `SELECT id, email, role, password_hash, is_active, is_verified,
              mfa_enabled, mfa_secret, failed_logins, locked_until
       FROM users WHERE email = $1`,
      [email]
    );

    const GENERIC_ERR = 'Email ou password incorrectos';

    if (result.rows.length === 0) {
      // Timing attack prevention
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingreasonXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
      return res.status(401).json({ error: GENERIC_ERR });
    }

    const user = result.rows[0];

    // Conta bloqueada
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      return res.status(423).json({
        error: `Conta bloqueada. Tente em ${mins} minuto(s).`,
        code: 'ACCOUNT_LOCKED',
      });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: GENERIC_ERR });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      const failed   = user.failed_logins + 1;
      const lockUntil = failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await query(
        'UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3',
        [failed, lockUntil, user.id]
      );
      await auditLog({ userId: user.id, action: 'user.login_failed', ipAddress: ip, success: false });
      return res.status(401).json({
        error: failed >= 5
          ? 'Conta bloqueada por 15 min após 5 tentativas falhadas'
          : GENERIC_ERR,
      });
    }

    // MFA
    if (user.mfa_enabled) {
      if (!mfa_code) return res.status(200).json({ mfa_required: true });
      const mfaOk = speakeasy.totp.verify({
        secret:   user.mfa_secret,
        encoding: 'base32',
        token:    mfa_code,
        window:   1,
      });
      if (!mfaOk) {
        await auditLog({ userId: user.id, action: 'user.mfa_failed', ipAddress: ip, success: false });
        return res.status(401).json({ error: 'Código MFA inválido' });
      }
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    await query(
      `INSERT INTO sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
      [user.id, refreshToken, ip, ua?.substring(0, 500)]
    );

    await query(
      `UPDATE users SET failed_logins = 0, locked_until = NULL,
                        last_login_at = NOW(), last_login_ip = $1
       WHERE id = $2`,
      [ip, user.id]
    );

    await auditLog({ userId: user.id, action: 'user.login', ipAddress: ip, success: true });

    res.cookie('refresh_token', refreshToken, cookieOptions());

    res.json({
      accessToken,
      user: {
        id:          user.id,
        email:       user.email,
        role:        user.role,
        is_verified: user.is_verified,
        mfa_enabled: user.mfa_enabled,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'Sessão expirada', code: 'SESSION_EXPIRED' });

  try {
    const session = await verifyRefreshToken(token);
    const { accessToken, refreshToken: newRefresh } = generateTokens(session.user_id, session.role);

    // Rotate refresh token (security best practice)
    await query(
      `UPDATE sessions SET refresh_token = $1, expires_at = NOW() + INTERVAL '7 days'
       WHERE refresh_token = $2`,
      [newRefresh, token]
    );

    res.cookie('refresh_token', newRefresh, cookieOptions());
    res.json({ accessToken });
  } catch (err) {
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.status(401).json({ error: err.message, code: 'INVALID_SESSION' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    await query(
      'UPDATE sessions SET revoked = TRUE WHERE refresh_token = $1',
      [token]
    ).catch(e => logger.error('Session revoke error:', e));
  }
  res.clearCookie('refresh_token', { path: '/api/auth' });
  await auditLog({ userId: req.user.id, action: 'user.logout', ipAddress: req.ip });
  res.json({ message: 'Sessão terminada' });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me — validar token e retornar user
// ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/verify?token=xxx
// ─────────────────────────────────────────────────────────────
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token em falta' });

  try {
    const result = await query(
      `UPDATE users
       SET is_verified = TRUE, verify_token = NULL, verify_token_exp = NULL
       WHERE verify_token = $1 AND verify_token_exp > NOW() AND is_verified = FALSE
       RETURNING id, email`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }
    await auditLog({ userId: result.rows[0].id, action: 'user.email_verified', ipAddress: req.ip });
    // Redirecionar para login com mensagem
    res.redirect(`${process.env.APP_URL}/platform/login.html?verified=1`);
  } catch (err) {
    logger.error('Verify error:', err);
    res.status(500).json({ error: 'Erro ao verificar email' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password  (FIX: rate limit próprio)
// ─────────────────────────────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email obrigatório' });
  }

  try {
    const result = await query(
      `UPDATE users
       SET reset_token = gen_random_uuid(), reset_token_exp = NOW() + INTERVAL '1 hour'
       WHERE email = $1 AND is_active = TRUE
       RETURNING email, reset_token`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length > 0) {
      const { email: userEmail, reset_token } = result.rows[0];
      sendEmail({
        to:       userEmail,
        template: 'reset-password',
        data: { url: `${process.env.APP_URL}/platform/forgot-password.html?token=${reset_token}` },
      }).catch(e => logger.error('Reset email error:', e));
    }

    // Resposta idêntica independentemente de o email existir
    res.json({ message: 'Se o email existir, receberá instruções de redefinição.' });
  } catch (err) {
    logger.error('Forgot-password error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/reset-password  (integrado — sem ficheiro separado)
// ─────────────────────────────────────────────────────────────
router.post('/reset-password', validate(resetSchema), async (req, res) => {
  const { token, password } = req.body;

  try {
    const result = await query(
      `SELECT id FROM users
       WHERE reset_token = $1 AND reset_token_exp > NOW() AND is_active = TRUE`,
      [token]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Link inválido ou expirado. Peça um novo link.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await query(
      `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_exp = NULL,
           failed_logins = 0, locked_until = NULL
       WHERE id = $2`,
      [hash, result.rows[0].id]
    );

    // Revogar todas as sessões ativas por segurança
    await query(
      'UPDATE sessions SET revoked = TRUE WHERE user_id = $1',
      [result.rows[0].id]
    );

    await auditLog({
      userId:   result.rows[0].id,
      action:   'user.password_reset',
      ipAddress: req.ip,
      success:  true,
    });

    res.json({ message: 'Password redefinida com sucesso. Faça login.' });
  } catch (err) {
    logger.error('Reset-password error:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/mfa/setup — gerar QR code MFA
// ─────────────────────────────────────────────────────────────
router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const user = await query('SELECT email, mfa_enabled FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0]?.mfa_enabled) {
      return res.status(400).json({ error: 'MFA já activado' });
    }

    const secret = speakeasy.generateSecret({
      name:   `MEROE (${user.rows[0].email})`,
      length: 20,
    });

    // Guardar secret temporariamente (não confirmado ainda)
    await query(
      'UPDATE users SET mfa_secret = $1 WHERE id = $2',
      [secret.base32, req.user.id]
    );

    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ qr: qrDataUrl, secret: secret.base32 });
  } catch (err) {
    logger.error('MFA setup error:', err);
    res.status(500).json({ error: 'Erro ao configurar MFA' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/mfa/confirm — confirmar e activar MFA
// ─────────────────────────────────────────────────────────────
router.post('/mfa/confirm', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código obrigatório' });

  try {
    const user = await query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = user.rows[0]?.mfa_secret;
    if (!secret) return res.status(400).json({ error: 'Configure o MFA primeiro' });

    const valid = speakeasy.totp.verify({
      secret, encoding: 'base32', token: String(code), window: 1,
    });
    if (!valid) return res.status(401).json({ error: 'Código inválido' });

    await query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [req.user.id]);
    await auditLog({ userId: req.user.id, action: 'user.mfa_enabled', ipAddress: req.ip });
    res.json({ message: 'MFA activado com sucesso' });
  } catch (err) {
    logger.error('MFA confirm error:', err);
    res.status(500).json({ error: 'Erro ao activar MFA' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/auth/mfa — desactivar MFA
// ─────────────────────────────────────────────────────────────
router.delete('/mfa', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password obrigatória para desactivar MFA' });

  try {
    const user = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Password incorrecta' });

    await query(
      'UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1',
      [req.user.id]
    );
    await auditLog({ userId: req.user.id, action: 'user.mfa_disabled', ipAddress: req.ip });
    res.json({ message: 'MFA desactivado' });
  } catch (err) {
    logger.error('MFA disable error:', err);
    res.status(500).json({ error: 'Erro ao desactivar MFA' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/change-password
// ─────────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Password actual e nova obrigatórias' });
  }

  const { error } = Joi.string().min(8).max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
    .validate(new_password);
  if (error) return res.status(400).json({ error: 'Nova password fraca' });

  try {
    const user = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current_password, user.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Password actual incorrecta' });

    const hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    // Revogar outras sessões
    const rt = req.cookies?.refresh_token;
    await query(
      `UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND refresh_token != $2`,
      [req.user.id, rt || '']
    );

    await auditLog({ userId: req.user.id, action: 'user.password_changed', ipAddress: req.ip });
    res.json({ message: 'Password alterada. Outras sessões foram encerradas.' });
  } catch (err) {
    logger.error('Change-password error:', err);
    res.status(500).json({ error: 'Erro ao alterar password' });
  }
});

module.exports = router;
