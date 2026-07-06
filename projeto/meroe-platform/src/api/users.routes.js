// src/api/users.routes.js
'use strict';
const express = require('express');
const { query } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { auditLog } = require('../utils/audit');
const router = express.Router();

router.use(requireAuth, requireRole('super_admin'));

// GET /api/users — listar utilizadores
router.get('/', async (req, res) => {
  const { page = 1, limit = 20, role, search } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 20);
  const conditions = ['1=1']; const params = [];
  let i = 1;
  if (role) { conditions.push(`role = $${i++}`); params.push(role); }
  if (search) { conditions.push(`(email ILIKE $${i++})`); params.push(`%${search}%`); }
  params.push(parseInt(limit)||20, offset);
  try {
    const [data, count] = await Promise.all([
      query(`SELECT id,email,role,is_active,is_verified,created_at,last_login_at FROM users WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, params),
      query(`SELECT COUNT(*) FROM users WHERE ${conditions.join(' AND ')}`, params.slice(0,-2)),
    ]);
    res.json({ data: data.rows, total: parseInt(count.rows[0].count) });
  } catch { res.status(500).json({ error: 'Erro ao listar utilizadores' }); }
});

// PATCH /api/users/:id/activate — activar/desactivar
router.patch('/:id/activate', async (req, res) => {
  const { active } = req.body;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode desactivar a própria conta' });
  try {
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [!!active, req.params.id]);
    await auditLog({ userId: req.user.id, action: active ? 'user.activate' : 'user.deactivate', resourceType: 'user', resourceId: req.params.id, ipAddress: req.ip });
    res.json({ message: active ? 'Utilizador activado' : 'Utilizador desactivado' });
  } catch { res.status(500).json({ error: 'Erro ao actualizar utilizador' }); }
});

// PATCH /api/users/:id/role — alterar papel
router.patch('/:id/role', async (req, res) => {
  const { role } = req.body;
  const valid = ['super_admin','recruiter','technician','partner'];
  if (!valid.includes(role)) return res.status(400).json({ error: 'Papel inválido' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode alterar o próprio papel' });
  try {
    await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, req.params.id]);
    await auditLog({ userId: req.user.id, action: 'user.role_change', resourceType: 'user', resourceId: req.params.id, newValue: { role }, ipAddress: req.ip });
    res.json({ message: 'Papel actualizado' });
  } catch { res.status(500).json({ error: 'Erro ao alterar papel' }); }
});

// DELETE /api/users/:id — apagar conta (RGPD)
router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode apagar a própria conta' });
  try {
    // Anonimizar em vez de apagar fisicamente (preserva audit logs)
    await query(`UPDATE users SET email = 'deleted_' || id || '@deleted.meroe', password_hash = 'DELETED', is_active = FALSE WHERE id = $1`, [req.params.id]);
    await auditLog({ userId: req.user.id, action: 'user.delete_gdpr', resourceType: 'user', resourceId: req.params.id, ipAddress: req.ip });
    res.json({ message: 'Conta anonimizada (RGPD)' });
  } catch { res.status(500).json({ error: 'Erro ao apagar conta' }); }
});

module.exports = router;
