// src/api/health.routes.js v2
'use strict';
const express = require('express');
const { pool } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { logger } = require('../utils/logger');
const router = express.Router();
const START_TIME = Date.now();

router.get('/', async (_req, res) => {
  const checks = { api: 'ok', database: 'unknown', uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000) };
  try {
    if (process.env.DATABASE_URL) {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
      ]);
      checks.database = 'ok';
    } else {
      checks.database = 'not_configured';
    }
  } catch (err) {
    checks.database = 'error';
    logger.warn('Health DB check warning:', err.message);
  }

  const isHealthy = checks.database === 'ok' || checks.database === 'not_configured';
  res.status(200).json({
    status: isHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

router.get('/ping', (_req,res) => res.json({ pong:true, ts:Date.now() }));

router.get('/metrics', requireAuth, requireRole('super_admin'), async (_req,res) => {
  try {
    const [users,profiles,sessions] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users WHERE is_active=TRUE'),
      pool.query('SELECT status,COUNT(*) FROM profiles GROUP BY status ORDER BY count DESC'),
      pool.query('SELECT COUNT(*) FROM sessions WHERE expires_at>NOW() AND revoked=FALSE'),
    ]);
    res.json({ users:parseInt(users.rows[0].count), profiles:profiles.rows, active_sessions:parseInt(sessions.rows[0].count), memory:process.memoryUsage(), uptime:process.uptime(), version:'2.0.0' });
  } catch { res.status(500).json({ error:'Erro ao obter métricas' }); }
});

module.exports = router;
