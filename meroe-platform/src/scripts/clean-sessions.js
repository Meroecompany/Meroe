// ============================================================
// MEROE Platform v2 — Limpeza de sessões expiradas
// src/scripts/clean-sessions.js
// USO: node src/scripts/clean-sessions.js
// CRON: 0 3 * * * (diariamente às 03:00 hora de Luanda)
// ============================================================
'use strict';
require('dotenv').config();

const { pool } = require('../db/connection');
const { logger } = require('../utils/logger');

async function main() {
  try {
    await pool.query('SELECT 1');
    const result = await pool.query('SELECT cleanup_expired_sessions()');
    const deleted = result.rows[0].cleanup_expired_sessions;
    logger.info(`✅ Sessões limpas: ${deleted} registos removidos`);
    console.log(`✅ Sessões limpas: ${deleted} registos removidos`);
  } catch (err) {
    logger.error('Erro na limpeza de sessões:', err);
    console.error('Erro:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
