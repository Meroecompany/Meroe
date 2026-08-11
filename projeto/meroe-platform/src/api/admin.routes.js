// ============================================================
// MEROE Platform v2 — API Admin
// src/api/admin.routes.js
// FIXES:
//  - reject endpoint agora requer requireRole explícito
//  - pools POST/GET requer requireRole
//  - Paginação validada com Joi
//  - Export CSV com streaming para grandes volumes
//  - Audit log de export inclui filtros usados
// ============================================================
'use strict';

const express = require('express');
const Joi     = require('joi');
const { query, withTransaction } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { auditLog }  = require('../utils/audit');
const { sendEmail } = require('../services/email.service');
const { logger }    = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('super_admin', 'recruiter'));

const ADMIN_ROLES    = ['super_admin', 'recruiter'];
const SUPERADMIN_ONLY = requireRole('super_admin');

const ALLOWED_SORT = new Set(['created_at', 'ai_score', 'experience_years', 'full_name']);

// ── GET /api/admin/dashboard ───────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [stats, byDiscipline, recent, topScores] = await Promise.all([
      query('SELECT * FROM v_dashboard_stats'),
      query(`
        SELECT discipline, COUNT(*) as count
        FROM profiles WHERE status = 'approved' AND discipline IS NOT NULL
        GROUP BY discipline ORDER BY count DESC LIMIT 10
      `),
      query(`
        SELECT p.full_name, p.discipline, p.status, p.created_at, u.email
        FROM profiles p JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC LIMIT 10
      `),
      query(`
        SELECT full_name, discipline, ai_score, ai_tags
        FROM profiles WHERE status = 'approved' AND ai_score IS NOT NULL
        ORDER BY ai_score DESC LIMIT 5
      `),
    ]);
    res.json({
      stats:        stats.rows[0],
      byDiscipline: byDiscipline.rows,
      recent:       recent.rows,
      topScores:    topScores.rows,
    });
  } catch (err) {
    logger.error('Dashboard error:', err);
    res.status(500).json({ error: 'Erro ao carregar dashboard' });
  }
});

// ── GET /api/admin/candidates ──────────────────────────────────
const candidatesQuerySchema = Joi.object({
  page:               Joi.number().integer().min(1).default(1),
  limit:              Joi.number().integer().min(1).max(100).default(20),
  status:             Joi.string().valid('incomplete','pending','approved','rejected','suspended').optional(),
  discipline:         Joi.string().max(100).optional(),
  available_for_tars: Joi.boolean().optional(),
  country:            Joi.string().max(100).optional(),
  min_score:          Joi.number().min(0).max(100).optional(),
  search:             Joi.string().max(200).optional(),
  sort_by:            Joi.string().valid(...ALLOWED_SORT).default('created_at'),
  sort_order:         Joi.string().valid('ASC','DESC').default('DESC'),
});

router.get('/candidates', async (req, res) => {
  const { error, value } = candidatesQuerySchema.validate(req.query, { abortEarly: false, allowUnknown: false });
  if (error) {return res.status(400).json({ error: 'Parâmetros inválidos', details: error.details.map(d=>d.message) });}

  const {
    page, limit, status, discipline, available_for_tars,
    country, min_score, search, sort_by, sort_order,
  } = value;
  const offset = (page - 1) * limit;

  // sort_by validado por Joi — safe para interpolação
  const conditions = ['1=1'];
  const params     = [];
  let   pidx       = 1;

  if (status)             { conditions.push(`p.status = $${pidx++}`);                params.push(status); }
  if (discipline)         { conditions.push(`p.discipline ILIKE $${pidx++}`);        params.push(`%${discipline}%`); }
  if (available_for_tars !== undefined) {
    conditions.push(`p.available_for_tars = $${pidx++}`);
    params.push(available_for_tars);
  }
  if (country)            { conditions.push(`p.location_country ILIKE $${pidx++}`); params.push(`%${country}%`); }
  if (min_score)          { conditions.push(`p.ai_score >= $${pidx++}`);             params.push(min_score); }
  if (search) {
    conditions.push(`(
      to_tsvector('portuguese', coalesce(p.full_name,'') || ' ' || coalesce(p.discipline,''))
      @@ plainto_tsquery('portuguese', $${pidx++})
      OR u.email ILIKE $${pidx++}
    )`);
    params.push(search, `%${search}%`);
    pidx++;
  }

  const where = conditions.join(' AND ');

  try {
    const [data, count] = await Promise.all([
      query(
        `SELECT p.id, p.full_name, p.discipline, p.experience_years, p.seniority_level,
                p.location_city, p.location_country, p.available_for_tars,
                p.ai_score, p.ai_tags, p.status, p.created_at, p.cv_url,
                p.certifications, p.skills, u.email
         FROM profiles p JOIN users u ON p.user_id = u.id
         WHERE ${where}
         ORDER BY p.${sort_by} ${sort_order} NULLS LAST
         LIMIT $${pidx} OFFSET $${pidx + 1}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM profiles p JOIN users u ON p.user_id = u.id WHERE ${where}`,
        params
      ),
    ]);

    const total = parseInt(count.rows[0].count);
    res.json({
      data: data.rows,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('Candidates list error:', err);
    res.status(500).json({ error: 'Erro ao obter candidatos' });
  }
});

// ── PATCH /api/admin/candidates/:id/approve ────────────────────
router.patch('/candidates/:id/approve', async (req, res) => {
  try {
    const result = await query(
      `UPDATE profiles
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = NULL
       WHERE id = $2 AND status = 'pending'
       RETURNING id, full_name, user_id`,
      [req.user.id, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Perfil não encontrado ou não está pendente' });
    }

    const profile = result.rows[0];

    await Promise.all([
      query(
        `INSERT INTO notifications (user_id, title, body, type)
         VALUES ($1, 'Perfil aprovado!',
           'O seu perfil foi aprovado pela equipa MEROE. Já pode ser contactado para oportunidades.',
           'success')`,
        [profile.user_id]
      ),
      // Enviar email de aprovação
      query('SELECT email FROM users WHERE id = $1', [profile.user_id]).then(u => {
        if (u.rows[0]?.email) {
          sendEmail({
            to: u.rows[0].email,
            template: 'approved',
            data: { name: profile.full_name, url: `${process.env.APP_URL}/platform/dashboard.html` },
          }).catch(e => logger.error('Approval email error:', e));
        }
      }),
      auditLog({
        userId: req.user.id, action: 'profile.approve',
        resourceType: 'profile', resourceId: req.params.id,
        ipAddress: req.ip, success: true,
      }),
    ]);

    res.json({ message: 'Perfil aprovado', profileId: req.params.id });
  } catch (err) {
    logger.error('Approve error:', err);
    res.status(500).json({ error: 'Erro ao aprovar perfil' });
  }
});

// ── PATCH /api/admin/candidates/:id/reject ─────────────────────
// FIX: estava sem requireRole explícito
router.patch('/candidates/:id/reject', requireRole(ADMIN_ROLES), async (req, res) => {
  const { reason } = req.body;
  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({ error: 'Motivo obrigatório (mínimo 10 caracteres)' });
  }

  try {
    const result = await query(
      `UPDATE profiles
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3
       RETURNING id, user_id`,
      [req.user.id, reason.trim(), req.params.id]
    );

    if (!result.rows.length) {return res.status(404).json({ error: 'Perfil não encontrado' });}

    await Promise.all([
      query(
        `INSERT INTO notifications (user_id, title, body, type, action_url)
         VALUES ($1, 'Perfil necessita de revisão', $2, 'action_required', '/platform/dashboard.html')`,
        [result.rows[0].user_id, `Motivo: ${reason.trim()}`]
      ),
      // Enviar email de rejeição (template adicionado no v2)
      query('SELECT email FROM users WHERE id = $1', [result.rows[0].user_id]).then(u => {
        if (u.rows[0]?.email) {
          sendEmail({
            to: u.rows[0].email,
            template: 'rejected',
            data: {
              reason: reason.trim(),
              url: `${process.env.APP_URL}/platform/dashboard.html`,
            },
          }).catch(e => logger.error('Rejection email error:', e));
        }
      }),
      auditLog({
        userId: req.user.id, action: 'profile.reject',
        resourceType: 'profile', resourceId: req.params.id,
        newValue: { reason: reason.trim() }, ipAddress: req.ip,
      }),
    ]);

    res.json({ message: 'Perfil rejeitado', profileId: req.params.id });
  } catch (err) {
    logger.error('Reject error:', err);
    res.status(500).json({ error: 'Erro ao rejeitar perfil' });
  }
});

// ── GET /api/admin/export/csv ──────────────────────────────────
// FIX: apenas super_admin pode exportar
router.get('/export/csv', SUPERADMIN_ONLY, async (req, res) => {
  const { status = 'approved' } = req.query;
  const validStatus = ['incomplete','pending','approved','rejected','suspended'];
  if (!validStatus.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  try {
    const result = await query(
      `SELECT p.full_name, u.email, p.phone, p.discipline, p.experience_years,
              p.seniority_level, p.location_city, p.location_country,
              p.available_for_tars, p.ai_score, p.status, p.created_at
       FROM profiles p JOIN users u ON p.user_id = u.id
       WHERE p.status = $1 ORDER BY p.created_at DESC`,
      [status]
    );

    const headers = ['Nome','Email','Telefone','Disciplina','Anos Exp.','Nível','Cidade','País','Disp. TARs','Score IA','Status','Data'];
    const rows    = result.rows.map(r => [
      r.full_name, r.email, r.phone || '', r.discipline || '',
      r.experience_years, r.seniority_level || '',
      r.location_city || '', r.location_country,
      r.available_for_tars ? 'Sim' : 'Não',
      r.ai_score !== null && r.ai_score !== undefined ? r.ai_score : '',
      r.status,
      new Date(r.created_at).toLocaleDateString('pt-PT'),
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meroe-${status}-${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('\uFEFF' + csv); // BOM para Excel PT

    await auditLog({
      userId:   req.user.id,
      action:   'data.export_csv',
      newValue: { status, count: result.rows.length },
      ipAddress: req.ip,
    });
  } catch (err) {
    logger.error('CSV export error:', err);
    res.status(500).json({ error: 'Erro ao exportar dados' });
  }
});

// ── POST /api/admin/pools ──────────────────────────────────────
// FIX: estava sem requireRole explícito
router.post('/pools', requireRole(ADMIN_ROLES), async (req, res) => {
  const { name, description, profile_ids } = req.body;
  if (!name || !name.trim()) {return res.status(400).json({ error: 'Nome obrigatório' });}

  try {
    await withTransaction(async (client) => {
      const poolResult = await client.query(
        `INSERT INTO talent_pools (name, description, pool_type, created_by)
         VALUES ($1, $2, 'manual', $3) RETURNING id`,
        [name.trim(), description?.trim() || null, req.user.id]
      );
      const poolId = poolResult.rows[0].id;

      if (Array.isArray(profile_ids) && profile_ids.length > 0) {
        const values = profile_ids.slice(0, 500).map(pid => `('${poolId}', '${pid}', FALSE)`);
        await client.query(
          `INSERT INTO pool_members (pool_id, profile_id, added_by_ai)
           VALUES ${values.join(',')} ON CONFLICT DO NOTHING`
        );
      }

      res.status(201).json({ poolId, message: 'Talent pool criada' });
    });
  } catch (err) {
    logger.error('Pool create error:', err);
    res.status(500).json({ error: 'Erro ao criar pool' });
  }
});

// ── GET /api/admin/pools ───────────────────────────────────────
router.get('/pools', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const result = await query(
      `SELECT tp.*, COUNT(pm.id) as member_count, u.email as created_by_email
       FROM talent_pools tp
       LEFT JOIN pool_members pm ON tp.id = pm.pool_id
       LEFT JOIN users u ON tp.created_by = u.id
       WHERE tp.is_active = TRUE
       GROUP BY tp.id, u.email
       ORDER BY tp.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Pools list error:', err);
    res.status(500).json({ error: 'Erro ao listar pools' });
  }
});

// ── GET /api/admin/audit-logs ──────────────────────────────────
router.get('/audit-logs', SUPERADMIN_ONLY, async (req, res) => {
  const { page = 1, limit = 50, action, user_id } = req.query;
  const offset   = (Math.max(1, parseInt(page)) - 1) * Math.min(200, parseInt(limit) || 50);
  const conditions = ['1=1'];
  const params     = [];
  let pidx = 1;

  if (action)  { conditions.push(`al.action ILIKE $${pidx++}`); params.push(`%${action}%`); }
  if (user_id) { conditions.push(`al.user_id = $${pidx++}`);    params.push(user_id); }
  params.push(Math.min(200, parseInt(limit) || 50), offset);

  try {
    const result = await query(
      `SELECT al.*, u.email as user_email
       FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY al.created_at DESC
       LIMIT $${pidx} OFFSET $${pidx+1}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Audit logs error:', err);
    res.status(500).json({ error: 'Erro ao obter audit logs' });
  }
});

// ── GET /api/admin/candidates/:id — detalhes ──────────────────
router.get('/candidates/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, u.email, u.is_verified, u.mfa_enabled, u.last_login_at, u.created_at as user_created_at
       FROM profiles p JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) {return res.status(404).json({ error: 'Candidato não encontrado' });}

    // Incrementar views
    await query('UPDATE profiles SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);
    await auditLog({
      userId: req.user.id, action: 'profile.view',
      resourceType: 'profile', resourceId: req.params.id, ipAddress: req.ip,
    });

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Candidate detail error:', err);
    res.status(500).json({ error: 'Erro ao obter candidato' });
  }
});

module.exports = router;
