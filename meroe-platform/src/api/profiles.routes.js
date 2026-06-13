// ============================================================
// MEROE Platform — API de Perfis de Técnicos
// src/api/profiles.routes.js
// ============================================================
'use strict';

const express = require('express');
const Joi     = require('joi');
const { query } = require('../db/connection');
const { requireAuth, requireSelfOrAdmin } = require('../middleware/auth.middleware');
const { auditLog } = require('../utils/audit');

const router = express.Router();

// Todas as rotas exigem autenticação
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
    name:       Joi.string().max(100).required(),
    issued_by:  Joi.string().max(100),
    year:       Joi.string().max(10).allow('', null),
    expiry:     Joi.string().max(20).allow('', null),
    verified:   Joi.boolean(),
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

// ── GET /api/profiles/me — perfil próprio ─────────────────────
router.get('/me', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, u.email, u.is_verified, u.mfa_enabled
       FROM profiles p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter perfil' });
  }
});

// ── PUT /api/profiles/me — actualizar perfil próprio ─────────
router.put('/me', async (req, res) => {
  const { error, value } = profileSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({ error: 'Dados inválidos', details: error.details.map(d => d.message) });
  }

  try {
    // Construir query dinâmica
    const fields = Object.keys(value);
    if (fields.length === 0) {return res.status(400).json({ error: 'Nenhum campo para actualizar' });}

    const sets  = fields.map((f, i) => `${f} = $${i + 1}`);
    const vals  = fields.map(f => {
      const v = value[f];
      return Array.isArray(v) ? JSON.stringify(v) : v;
    });

    // Determinar se perfil fica "pending" (para aprovação)
    const hasProfessionalData = ['discipline','experience_years','certifications','cv_url'].some(f => fields.includes(f));
    const statusUpdate = hasProfessionalData
      ? `, status = CASE WHEN status = 'incomplete' THEN 'pending' ELSE status END`
      : '';

    const result = await query(
      `UPDATE profiles SET ${sets.join(', ')}${statusUpdate}, updated_at = NOW()
       WHERE user_id = $${fields.length + 1}
       RETURNING *`,
      [...vals, req.user.id]
    );

    await auditLog({
      userId:       req.user.id,
      action:       'profile.update',
      resourceType: 'profile',
      resourceId:   result.rows[0].id,
      newValue:     value,
      ipAddress:    req.ip,
    });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao actualizar perfil' });
  }
});

// ── GET /api/profiles/:id — ver perfil específico (admin/recruiter) ──
router.get('/:id', async (req, res) => {
  const isAdmin = ['super_admin','recruiter'].includes(req.user.role);
  const isSelf  = req.params.id === req.user.id;

  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  try {
    const result = await query(
      `SELECT p.*, u.email FROM profiles p JOIN users u ON p.user_id = u.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {return res.status(404).json({ error: 'Perfil não encontrado' });}

    // Incrementar contador de visualizações (apenas admins)
    if (isAdmin && !isSelf) {
      await query('UPDATE profiles SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);
      await auditLog({
        userId: req.user.id, action: 'profile.view',
        resourceType: 'profile', resourceId: req.params.id,
        ipAddress: req.ip,
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter perfil' });
  }
});

// ── GET /api/profiles/me/notifications ───────────────────────
router.get('/me/notifications', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter notificações' });
  }
});

// ── PATCH /api/profiles/me/notifications/:id/read ────────────
router.patch('/me/notifications/:id/read', async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao marcar notificação' });
  }
});

module.exports = router;
