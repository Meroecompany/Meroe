// src/services/email.service.js
'use strict';
const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.zoho.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: true },
});

const templates = {
  verify: (d) => ({
    subject: 'Verifique o seu email — MEROE Digital',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A1628;color:#F0F4FA;padding:40px;border-radius:8px">
      <h1 style="color:#C9820A;font-size:28px;margin-bottom:8px">MEROE</h1>
      <p style="color:#8A97AA;font-size:12px;margin-bottom:32px;letter-spacing:3px">SOLUÇÕES EM ENGENHARIA</p>
      <h2 style="color:#F0F4FA">Olá, ${d.name}!</h2>
      <p style="color:#C5CFD9;line-height:1.7">A sua conta foi criada com sucesso. Clique no botão abaixo para verificar o seu email e activar a conta.</p>
      <a href="${d.url}" style="display:inline-block;background:#C9820A;color:#060D18;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:1px;margin:24px 0">VERIFICAR EMAIL</a>
      <p style="color:#8A97AA;font-size:12px;margin-top:24px">Este link expira em 24 horas. Se não criou esta conta, ignore este email.</p>
      <hr style="border-color:#1A3260;margin:32px 0"/>
      <p style="color:#8A97AA;font-size:11px">© 2026 MEROE – Soluções em Engenharia Lda. · Luanda, Angola</p>
    </div>`
  }),
  'reset-password': (d) => ({
    subject: 'Redefinir password — MEROE Digital',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A1628;color:#F0F4FA;padding:40px;border-radius:8px">
      <h1 style="color:#C9820A">MEROE</h1>
      <h2>Redefinir password</h2>
      <p style="color:#C5CFD9;line-height:1.7">Recebemos um pedido de redefinição de password. Clique no botão abaixo. O link é válido por 1 hora.</p>
      <a href="${d.url}" style="display:inline-block;background:#C9820A;color:#060D18;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:600;margin:24px 0">REDEFINIR PASSWORD</a>
      <p style="color:#8A97AA;font-size:12px">Se não pediu isto, ignore este email. A sua password não foi alterada.</p>
      <hr style="border-color:#1A3260;margin:32px 0"/>
      <p style="color:#8A97AA;font-size:11px">© 2026 MEROE – Soluções em Engenharia Lda.</p>
    </div>`
  }),
  approved: (d) => ({
    subject: 'Perfil aprovado — MEROE Digital',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A1628;color:#F0F4FA;padding:40px;border-radius:8px">
      <h1 style="color:#C9820A">MEROE</h1>
      <h2 style="color:#1A9E75">✓ Perfil Aprovado!</h2>
      <p style="color:#C5CFD9;line-height:1.7">O seu perfil profissional foi aprovado pela equipa MEROE. Já pode ser contactado para oportunidades em projectos de Oil & Gas e TARs em Angola.</p>
      <a href="${d.url || '#'}" style="display:inline-block;background:#C9820A;color:#060D18;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:600;margin:24px 0">VER MEU PERFIL</a>
      <hr style="border-color:#1A3260;margin:32px 0"/>
      <p style="color:#8A97AA;font-size:11px">© 2026 MEROE – Soluções em Engenharia Lda.</p>
    </div>`
  }),
};

async function sendEmail({ to, template, data, subject, html }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('SMTP não configurado — email não enviado', { to, template });
    return;
  }
  try {
    const tpl = templates[template]?.(data) || { subject, html };
    await transporter.sendMail({
      from: `"MEROE Digital" <${process.env.SMTP_USER}>`,
      to,
      subject: tpl.subject,
      html: tpl.html,
    });
    logger.info('Email enviado', { to, template });
  } catch (err) {
    logger.error('Erro ao enviar email:', { to, template, error: err.message });
    throw err;
  }
}

module.exports = { sendEmail };
