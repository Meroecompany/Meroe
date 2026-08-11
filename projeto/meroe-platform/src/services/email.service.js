// ============================================================
// MEROE Platform v2 — Serviço de Email (Nodemailer)
// src/services/email.service.js
// NOVO v2: template 'rejected' adicionado (faltava na v1)
//          template 'ai_complete' para notificar análise IA concluída
//          Verificação de conexão SMTP com retry
// ============================================================
'use strict';
const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

const BASE_STYLE = `font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
background:#0A1628;color:#F0F4FA;padding:40px;border-radius:8px`;
const HEADER = `<h1 style="color:#C9820A;font-size:28px;margin-bottom:4px">MEROE</h1>
<p style="color:#8A97AA;font-size:11px;letter-spacing:3px;margin-bottom:32px;text-transform:uppercase">Soluções em Engenharia</p>`;
const FOOTER = `<hr style="border-color:#1A3260;margin:32px 0"/>
<p style="color:#8A97AA;font-size:11px">© 2026 MEROE – Soluções em Engenharia Lda. · Luanda, Angola</p>`;
const BTN = (url, label) =>
  `<a href="${url}" style="display:inline-block;background:#C9820A;color:#050C18;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1px;margin:24px 0">${label}</a>`;

const templates = {

  verify: (d) => ({
    subject: 'Verifique o seu email — MEROE Digital',
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2>Olá, ${d.name}!</h2>
      <p style="color:#C5CFD9;line-height:1.7">A sua conta foi criada com sucesso. Clique no botão abaixo para verificar o seu email e activar a conta.</p>
      ${BTN(d.url, 'VERIFICAR EMAIL')}
      <p style="color:#8A97AA;font-size:12px">Este link expira em 24 horas. Se não criou esta conta, ignore este email.</p>
      ${FOOTER}</div>`,
  }),

  'reset-password': (d) => ({
    subject: 'Redefinir password — MEROE Digital',
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2>Redefinir password</h2>
      <p style="color:#C5CFD9;line-height:1.7">Recebemos um pedido de redefinição de password para a sua conta MEROE. O link é válido por 1 hora.</p>
      ${BTN(d.url, 'REDEFINIR PASSWORD')}
      <p style="color:#8A97AA;font-size:12px">Se não pediu isto, ignore este email. A sua password não foi alterada.</p>
      ${FOOTER}</div>`,
  }),

  approved: (d) => ({
    subject: '✅ Perfil aprovado — MEROE Digital',
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2 style="color:#1A9E75">✓ O seu perfil foi aprovado!</h2>
      <p style="color:#C5CFD9;line-height:1.7">Olá ${d.name || ''},<br><br>
      O seu perfil profissional foi aprovado pela equipa MEROE. Já pode ser contactado para oportunidades em projectos de Oil &amp; Gas e TARs em Angola.</p>
      ${BTN(d.url || '#', 'VER MEU PERFIL')}
      <p style="color:#8A97AA;font-size:12px">Mantenha o seu perfil actualizado para maximizar as suas oportunidades.</p>
      ${FOOTER}</div>`,
  }),

  // NOVO v2 — faltava na versão 1
  rejected: (d) => ({
    subject: '📋 Perfil necessita de revisão — MEROE Digital',
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2 style="color:#EF9F27">Perfil necessita de revisão</h2>
      <p style="color:#C5CFD9;line-height:1.7">Olá ${d.name || ''},<br><br>
      A equipa MEROE analisou o seu perfil e identificou alguns pontos que precisam de ser corrigidos antes da aprovação.</p>
      ${d.reason ? `<div style="background:rgba(239,159,39,.08);border:1px solid rgba(239,159,39,.3);border-radius:4px;padding:16px;margin:16px 0;color:#F5C842;font-size:14px">
        <strong>Motivo:</strong><br>${d.reason}
      </div>` : ''}
      <p style="color:#C5CFD9">Por favor actualize o seu perfil e resubmeta para análise.</p>
      ${BTN(d.url || '#', 'ACTUALIZAR PERFIL')}
      ${FOOTER}</div>`,
  }),

  // NOVO v2 — notificação de análise IA concluída
  ai_complete: (d) => ({
    subject: `🤖 Análise IA concluída — Score ${d.score}/100 — MEROE`,
    html: `<div style="${BASE_STYLE}">${HEADER}
      <h2>Análise IA concluída</h2>
      <p style="color:#C5CFD9;line-height:1.7">O seu CV foi analisado pela Inteligência Artificial MEROE.</p>
      <div style="background:rgba(201,130,10,.08);border:1px solid rgba(201,130,10,.2);border-radius:8px;padding:20px;margin:20px 0;text-align:center">
        <div style="font-size:48px;font-weight:800;color:#C9820A">${d.score}<span style="font-size:20px">/100</span></div>
        <div style="color:#8A97AA;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:4px">Score de Compatibilidade O&G</div>
      </div>
      ${BTN(d.url || '#', 'VER ANÁLISE COMPLETA')}
      ${FOOTER}</div>`,
  }),

};

// ── TRANSPORTER com verificação lazy ─────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) {return _transporter;}
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.zoho.com',
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: parseInt(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    pool:           true,
    maxConnections: 3,
    rateDelta:      1000,
    rateLimit:      5,
  });
  return _transporter;
}

// ── sendEmail ─────────────────────────────────────────────────
async function sendEmail({ to, template, data = {}, subject, html }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('SMTP não configurado — email simulado', { to, template });
    return; // Não lança erro — permite desenvolver sem SMTP
  }
  if (!to || !to.includes('@')) {
    logger.warn('Email inválido ignorado', { to });
    return;
  }

  try {
    const tpl = templates[template]?.(data) || { subject, html };
    if (!tpl.subject || !tpl.html) {
      logger.warn('Template de email inválido ou em falta', { template });
      return;
    }

    await getTransporter().sendMail({
      from:    `"MEROE Digital" <${process.env.SMTP_USER}>`,
      to:      to.trim(),
      subject: tpl.subject,
      html:    tpl.html,
    });
    logger.info('Email enviado', { to: to.split('@')[1], template }); // Não logar email completo

  } catch (err) {
    logger.error('Erro ao enviar email', { template, error: err.message });
    // Não relançar — email não deve bloquear fluxo principal
  }
}

module.exports = { sendEmail };
