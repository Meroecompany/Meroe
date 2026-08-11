// ============================================================
// MEROE Platform v2 — API de Perfis de Técnicos
// src/api/profiles.routes.js
// FIX CRÍTICO: rotas /me/* movidas ANTES de /:id para evitar conflito
//              (Express é sequencial — /:id apanharia 'me' como parâmetro)
// ============================================================
'use strict';

const express = require('express');
const Joi     = require('joi');
const { query } = require('../db/connection');
const { requireAuth } = require('../middleware/auth.middleware');
const { auditLog }    = require('../utils/audit');
const { logger }      = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ── SCHEMA de actualização de perfil ─────────────────────────
const profileSchema = Joi.object({
  full_name:            Joi.string().min(2).max(255),
  phone:                Joi.string().max(50).allow('', null),
  nationality:          Joi.string().max(100).allow('', null),
  location_city:        Joi.string().max(100).allow('', null),
  location_country:     Joi.string().max(100),
  date_of_birth:        Joi.date().max('now').allow(null),
  discipline:           Joi.string().max(100).allow('', null),
  specialization:       Joi.array().items(Joi.string().max(100)).max(20),
  experience_years:     Joi.number().integer().min(0).max(60),
  seniority_level:      Joi.string().valid('junior','mid','senior','lead','expert').allow(null),
  certifications:       Joi.array().items(Joi.object({
    name:      Joi.string().max(100).required(),
    issued_by: Joi.string().max(100).allow('',null),
    year:      Joi.string().max(10).allow('', null),
    expiry:    Joi.string().max(20).allow('', null),
    verified:  Joi.boolean(),
  })).max(50),
  skills:               Joi.array().items(Joi.string().max(100)).max(100),
  languages:            Joi.array().items(Joi.object({
    language: Joi.string().max(50).required(),
    level:    Joi.string().valid('native','fluent','intermediate','basic').required(),
  })).max(10),
  professional_summary: Joi.string().max(2000).allow('', null),
  available_for_tars:   Joi.boolean(),
  availability_from:    Joi.date().allow(null),
  availability_notes:   Joi.string().max(500).allow('', null),
  daily_rate_usd:       Joi.number().min(0).max(100000).allow(null),
  linkedin_url:         Joi.string().uri().max(500).allow('', null),
});

// ── GET /api/profiles/me ─────────────────── (ANTES de /:id!)
router.get('/me', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, u.email, u.is_verified, u.mfa_enabled
       FROM profiles p JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) {return res.status(404).json({ error: 'Perfil não encontrado' });}
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('GET /profiles/me error:', err);
    res.status(500).json({ error: 'Erro ao obter perfil' });
  }
});

// ── PUT /api/profiles/me ─────────────────── (ANTES de /:id!)
router.put('/me', async (req, res) => {
  const { error, value } = profileSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({ error: 'Dados inválidos', details: error.details.map(d => d.message) });
  }
  try {
    const fields = Object.keys(value);
    if (fields.length === 0) {return res.status(400).json({ error: 'Nenhum campo para actualizar' });}

    // Tipos PostgreSQL por campo — TEXT[] precisa de ser passado como array JS (o driver pg converte)
    // JSONB (certifications, languages) também aceita array JS directamente
    // Nunca usar JSON.stringify() — o driver node-postgres faz a serialização correcta
    const TEXT_ARRAY_FIELDS = new Set(['skills', 'specialization', 'ai_tags']);
    const JSONB_FIELDS      = new Set(['certifications', 'languages']);

    const sets = fields.map((f, i) => {
      if (TEXT_ARRAY_FIELDS.has(f)) {return `${f} = $${i + 1}::text[]`;}
      if (JSONB_FIELDS.has(f))      {return `${f} = $${i + 1}::jsonb`;}
      return `${f} = $${i + 1}`;
    });

    const vals = fields.map(f => {
      const v = value[f];
      // TEXT[]: passar array JS — o driver pg serializa correctamente
      if (TEXT_ARRAY_FIELDS.has(f)) {return Array.isArray(v) ? v : [];}
      // JSONB: passar array/objecto JS — o driver pg serializa para JSON
      if (JSONB_FIELDS.has(f))      {return Array.isArray(v) ? v : [];}
      return v;
    });

    const hasProfData = ['discipline','experience_years','certifications'].some(f => fields.includes(f));
    const statusUpdate = hasProfData
      ? `, status = CASE WHEN status = 'incomplete' THEN 'pending' ELSE status END`
      : '';

    const result = await query(
      `UPDATE profiles SET ${sets.join(', ')}${statusUpdate}, updated_at = NOW()
       WHERE user_id = $${fields.length + 1}
       RETURNING *`,
      [...vals, req.user.id]
    );

    await auditLog({
      userId: req.user.id, action: 'profile.update',
      resourceType: 'profile', resourceId: result.rows[0]?.id,
      newValue: value, ipAddress: req.ip,
    });

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('PUT /profiles/me error:', err);
    res.status(500).json({ error: 'Erro ao actualizar perfil' });
  }
});

// ── GET /api/profiles/me/notifications ────── (ANTES de /:id!)
router.get('/me/notifications', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('GET notifications error:', err);
    res.status(500).json({ error: 'Erro ao obter notificações' });
  }
});

// ── PATCH /api/profiles/me/notifications/:id/read ─────────── (ANTES de /:id!)
router.patch('/me/notifications/:notifId/read', async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.notifId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('PATCH notifications read error:', err);
    res.status(500).json({ error: 'Erro ao marcar notificação' });
  }
});

// ── GET /api/profiles/:id ───────── (DEPOIS das rotas /me/*, por isso funciona correctamente)
router.get('/:id', async (req, res) => {
  const isAdmin = ['super_admin', 'recruiter'].includes(req.user.role);

  try {
    const result = await query(
      `SELECT p.*, u.email FROM profiles p JOIN users u ON p.user_id = u.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) {return res.status(404).json({ error: 'Perfil não encontrado' });}

    // CORREÇÃO: req.params.id é o UUID do registo na tabela profiles (profiles.id).
    // req.user.id é o UUID do utilizador autenticado (users.id).
    // Estes dois UUIDs nunca coincidem — são PKs de tabelas diferentes.
    // A comparação correcta é entre profiles.user_id (FK) e users.id.
    const isSelf = result.rows[0].user_id === req.user.id;
    if (!isAdmin && !isSelf) {return res.status(403).json({ error: 'Acesso negado' });}

    if (isAdmin && !isSelf) {
      await query('UPDATE profiles SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);
      await auditLog({
        userId: req.user.id, action: 'profile.view',
        resourceType: 'profile', resourceId: req.params.id, ipAddress: req.ip,
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('GET /profiles/:id error:', err);
    res.status(500).json({ error: 'Erro ao obter perfil' });
  }
});

module.exports = router;
