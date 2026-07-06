// ============================================================
// MEROE Platform v2 — Script de Migración de Base de Datos
// src/db/migrate.js
// USO: node src/db/migrate.js
// ============================================================
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./connection');
const { logger } = require('../utils/logger');

async function main() {
  console.log('\n🗄️  MEROE Platform — Ejecutando Migración de Base de Datos\n');

  try {
    // Leer schema.sql
    const schemaPath = path.join(__dirname, '..', '..', 'sql', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`No se encontró el archivo schema.sql en la ruta: ${schemaPath}`);
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('⏳ Conectando con la base de datos...');
    // Probar conexión
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión establecida con éxito.');

    console.log('⏳ Ejecutando comandos SQL de schema.sql...');
    // Ejecutar todo el SQL
    await pool.query(sql);
    console.log('✅ Migración completada con éxito.');
  } catch (err) {
    logger.error('Error al ejecutar la migración:', err);
    console.error('❌ Error en la migración:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Conexión cerrada.');
  }
}

main();
