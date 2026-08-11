// ============================================================
// MEROE Platform v2 — Script de criação do Super Admin inicial
// src/scripts/setup-admin.js
// USO: node src/scripts/setup-admin.js
// ============================================================
'use strict';
require('dotenv').config();

const bcrypt   = require('bcrypt');
const readline = require('readline');
const { pool } = require('../db/connection');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n🔐 MEROE Platform — Configuração do Super Admin\n');

  try {
    // Verificar conexão BD
    await pool.query('SELECT 1');
    console.log('✅ Base de dados ligada\n');

    // Verificar se já existe um super_admin
    const existing = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND is_active = TRUE"
    );
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('⚠️  Já existe um super_admin activo. Continuar irá criar um adicional.');
      const cont = await ask('Continuar? (s/N): ');
      if (cont.toLowerCase() !== 's') {
        console.log('Cancelado.'); process.exit(0);
      }
    }

    const email    = await ask('Email do admin: ');
    const name     = await ask('Nome completo: ');
    const password = await ask('Password (mín. 8 char, maiúsculas+minúsculas+números+símbolo): ');

    // Validações básicas
    if (!email.includes('@')) { console.error('❌ Email inválido'); process.exit(1); }
    if (password.length < 8)  { console.error('❌ Password demasiado curta'); process.exit(1); }

    const pOk = /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
    if (!pOk) { console.error('❌ Password fraca — use maiúsculas, minúsculas, números e símbolos'); process.exit(1); }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, is_active, is_verified)
       VALUES ($1, $2, 'super_admin', TRUE, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = $2, role = 'super_admin', is_active = TRUE, is_verified = TRUE
       RETURNING id, email, role`,
      [email.toLowerCase().trim(), hash]
    );

    // Criar perfil básico
    await pool.query(
      `INSERT INTO profiles (user_id, full_name, location_country, status)
       VALUES ($1, $2, 'Angola', 'approved')
       ON CONFLICT (user_id) DO UPDATE SET full_name = $2`,
      [result.rows[0].id, name.trim()]
    );

    console.log(`\n✅ Super Admin criado com sucesso!`);
    console.log(`   ID:    ${result.rows[0].id}`);
    console.log(`   Email: ${result.rows[0].email}`);
    console.log(`   Role:  ${result.rows[0].role}`);
    console.log(`\n🔑 Aceda em: ${process.env.APP_URL || 'https://meroe-digital.vercel.app'}/platform/login.html\n`);

  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
