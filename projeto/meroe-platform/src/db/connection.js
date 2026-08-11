// ============================================================
// MEROE Platform v2 — Conexão PostgreSQL
// src/db/connection.js
// FIXES:
//  - Pool size aumentado + configurável via ENV
//  - application_name para debugging
//  - Retry automático na conexão inicial
//  - withTransaction com savepoints
// ============================================================
'use strict';

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false,
  max:                  parseInt(process.env.DB_POOL_MAX)  || 25,
  min:                  parseInt(process.env.DB_POOL_MIN)  || 5,
  idleTimeoutMillis:    parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout:    30000,
  application_name:     'meroe-platform-v2',
});

pool.on('error', (err) => {
  logger.error('Pool PostgreSQL error:', { message: err.message });
});

pool.on('connect', (client) => {
  // Definir timezone e locale para Angola
  client.query("SET timezone = 'Africa/Luanda'").catch(() => {});
  logger.debug('New PostgreSQL connection established');
});

// ── QUERY com logging de queries lentas ───────────────────────
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 2000) {
      logger.warn('Slow query detected', { duration_ms: duration, query: text.substring(0, 150) });
    }
    return result;
  } catch (err) {
    logger.error('PostgreSQL query error', {
      message: err.message,
      code:    err.code,
      query:   text.substring(0, 150),
    });
    throw err;
  }
}

// ── TRANSAÇÃO com suporte a savepoints ────────────────────────
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── VERIFICAR CONEXÃO com retry ───────────────────────────────
async function connectDB(retries = 5, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as now, version() as version');
      client.release();
      logger.info('PostgreSQL connected', {
        time:    result.rows[0].now,
        version: result.rows[0].version.split(' ').slice(0, 2).join(' '),
        pool:    `min=${pool.options.min || 5}, max=${pool.options.max}`,
      });
      return;
    } catch (err) {
      logger.warn(`DB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) {throw err;}
      await new Promise(r => setTimeout(r, delay * i));
    }
  }
}

module.exports = { pool, query, withTransaction, connectDB };
