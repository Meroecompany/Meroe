// ============================================================
// MEROE Platform v2 — Jest Global Setup
// tests/setup.js
// Usa light-my-request — sem bind TCP (compatível com sandbox)
// ============================================================
'use strict';

// Garantir variáveis de ambiente para testes antes de importar o app
process.env.NODE_ENV      = 'test';
process.env.JWT_SECRET    = process.env.JWT_SECRET || 'test_secret_at_least_64_chars_long_for_github_actions_ci';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test_cookie_secret_64_chars_long_for_ci_environment_ok';
