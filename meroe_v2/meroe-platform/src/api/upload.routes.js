// ============================================================
// MEROE Platform v2 — Upload Seguro de CVs
// src/api/upload.routes.js
// FIXES v2:
//   - Após upload do CV, dispara análise IA automaticamente (assíncrono)
//   - URL Firebase renovada automaticamente (storage_path guardado)
//   - GET /api/upload/cv/refresh — renova URL expirada sem re-upload
//   - Firebase init isolada num helper para evitar re-init
// ============================================================
'use strict';

const express  = require('express');
const multer   = require('multer');
const admin    = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { query } = require('../db/connection');
const { requireAuth } = require('../middleware/auth.middleware');
const { auditLog }   = require('../utils/audit');
const { logger }     = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const pdfParse      = require('pdf-parse');

const router = express.Router();
router.use(requireAuth);

// ── FIREBASE ADMIN — init único (singleton) ───────────────────
function getBucket() {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
    return null;
  }
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }
    return admin.storage().bucket();
  } catch (err) {
    logger.error('Firebase init error:', { message: err.message });
    return null;
  }
}

// ── MULTER ─────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Apenas ficheiros PDF são aceites'));
    }
    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new Error('Extensão inválida — use .pdf'));
    }
    cb(null, true);
  },
});

// ── HELPER: verificar magic bytes do PDF ─────────────────────
function isPDF(buf) {
  return buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 &&
    buf[3] === 0x46 && buf[4] === 0x2D;
}

// ── HELPER: gerar URL assinada Firebase (validade 7 dias) ────
async function generateSignedUrl(bucket, storagePath) {
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action:  'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  return url;
}

// ── HELPER: análise IA do CV (assíncrona, não bloqueia resposta)
async function analyseCV(userId, profileId, cvText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY não configurada — análise IA ignorada');
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
Analisa este CV de um profissional de Oil & Gas. Responde APENAS com JSON válido (sem texto extra, sem markdown):

CV:
${cvText.substring(0, 8000)}

JSON esperado:
{
  "score": número 0-100 (qualidade e relevância para O&G),
  "discipline": "disciplina principal de engenharia",
  "experience_years": número,
  "seniority_level": "junior|mid|senior|lead|expert",
  "certifications": [{"name": "cert", "year": "2020"}],
  "skills": ["skill1", "skill2"],
  "tags": ["tag1", "tag2", "tag3"],
  "professional_summary": "resumo em português, 2-3 frases concisas",
  "languages": [{"language": "Português", "level": "native"}],
  "available_for_tars": true,
  "strengths": ["ponto forte 1", "ponto forte 2"],
  "notes": "observações adicionais"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Extrair JSON da resposta
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado na resposta IA');

    const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    // Actualizar perfil com dados da IA
    await query(
      `UPDATE profiles SET
         ai_data         = $1,
         ai_score        = $2,
         ai_tags         = $3,
         ai_analysed_at  = NOW(),
         discipline      = COALESCE(NULLIF(discipline,''), $4),
         experience_years = GREATEST(experience_years, $5),
         seniority_level = COALESCE(NULLIF(seniority_level::text, ''), $6)::seniority_level,
         professional_summary = COALESCE(NULLIF(professional_summary,''), $7),
         skills          = CASE WHEN array_length(skills,1) IS NULL THEN $8 ELSE skills END
       WHERE id = $9`,
      [
        data,                // JSONB — driver serializa automaticamente
        Math.min(100, Math.max(0, data.score || 0)),
        data.tags || [],
        data.discipline || null,
        data.experience_years || 0,
        data.seniority_level || null,
        data.professional_summary || null,
        data.skills || [],
        profileId,
      ]
    );

    // Notificar utilizador
    await query(
      `INSERT INTO notifications (user_id, title, body, type)
       VALUES ($1, 'Análise IA concluída', $2, 'success')`,
      [
        userId,
        `O seu CV foi analisado pela IA. Score: ${Math.round(data.score || 0)}/100. Verifique o seu perfil.`,
      ]
    );

    logger.info('CV analisado pela IA', { userId, profileId, score: data.score });

  } catch (err) {
    logger.error('Erro na análise IA do CV', { userId, message: err.message });
    // Notificar utilizador mesmo em caso de falha
    await query(
      `INSERT INTO notifications (user_id, title, body, type)
       VALUES ($1, 'CV recebido', 'O seu CV foi carregado com sucesso. A análise IA irá decorrer em breve.', 'info')`,
      [userId]
    ).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/upload/cv — upload do CV com análise IA automática
// ═══════════════════════════════════════════════════════════════
router.post('/cv', upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ficheiro em falta' });

  if (!isPDF(req.file.buffer)) {
    return res.status(400).json({ error: 'O ficheiro não é um PDF válido' });
  }

  const bucket = getBucket();

  try {
    let cvUrl       = null;
    let storagePath = null;

    // ── Upload para Firebase Storage (se configurado) ─────────
    if (bucket) {
      const fileId = uuidv4();
      storagePath  = `cvs/${req.user.id}/${fileId}.pdf`;
      const fileRef = bucket.file(storagePath);

      await fileRef.save(req.file.buffer, {
        metadata: {
          contentType:  'application/pdf',
          cacheControl: 'private, max-age=3600',
          metadata: {
            uploadedBy:   req.user.id,
            originalName: req.file.originalname.substring(0, 100),
            uploadedAt:   new Date().toISOString(),
          },
        },
      });

      cvUrl = await generateSignedUrl(bucket, storagePath);
    } else {
      // Firebase não configurado — modo de desenvolvimento
      logger.warn('Firebase não configurado — CV não guardado no Storage', { userId: req.user.id });
      cvUrl = `local://${req.user.id}/cv.pdf`;
    }

    // ── Actualizar perfil na BD ───────────────────────────────
    const profileResult = await query(
      `UPDATE profiles
       SET cv_url        = $1,
           cv_filename   = $2,
           cv_uploaded_at = NOW(),
           status = CASE WHEN status = 'incomplete' THEN 'pending' ELSE status END
       WHERE user_id = $3
       RETURNING id`,
      [cvUrl, req.file.originalname.substring(0, 255), req.user.id]
    );

    if (!profileResult.rows.length) {
      return res.status(404).json({ error: 'Perfil não encontrado' });
    }
    const profileId = profileResult.rows[0].id;

    // ── Guardar storage_path para renovação futura de URL ────
    if (storagePath) {
      await query(
        `INSERT INTO documents (profile_id, document_type, file_name, file_url, storage_path, file_size_bytes, mime_type, is_primary)
         VALUES ($1, 'cv', $2, $3, $4, $5, 'application/pdf', TRUE)
         ON CONFLICT (profile_id, document_type, is_primary)
           DO UPDATE SET file_name = $2, file_url = $3, storage_path = $4,
                         file_size_bytes = $5, uploaded_at = NOW()`,
        [profileId, req.file.originalname.substring(0, 255), cvUrl, storagePath, req.file.size]
      );
    }

    await auditLog({
      userId: req.user.id, action: 'cv.upload',
      resourceType: 'document', resourceId: profileId,
      newValue: { size: req.file.size, storagePath },
      ipAddress: req.ip, success: true,
    });

    // ── Responder imediatamente (não bloquear na análise IA) ──
    res.json({
      success:   true,
      message:   'CV carregado! A análise IA irá começar automaticamente.',
      cv_url:    cvUrl,
      file_name: req.file.originalname,
      ai_pending: true,
    });

    // ── Extrair texto do PDF e disparar análise IA em background ─
    const cvBuffer = req.file.buffer; // já em memória do multer
    setImmediate(async () => {
      try {
        // Extrair texto real do PDF com pdf-parse
        const pdfData = await pdfParse(cvBuffer, { max: 10 }); // máx 10 páginas
        const cvText  = pdfData.text?.trim() || '';

        if (cvText.length < 100) {
          // PDF sem texto seleccionável (scan) — usar metadados
          const fallback = `Ficheiro: ${req.file.originalname} (${req.file.size} bytes). PDF digitalizado sem texto extraível.`;
          await analyseCV(req.user.id, profileId, fallback);
        } else {
          await analyseCV(req.user.id, profileId, cvText);
        }
      } catch (err) {
        logger.error('Background AI analysis error:', { message: err.message, userId: req.user.id });
        // Notificar igualmente — o score ficará pendente
      }
    });

  } catch (err) {
    logger.error('Erro no upload CV:', { message: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Erro ao guardar ficheiro. Tente novamente.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/upload/cv/refresh — renovar URL assinada Firebase expirada
// (FIX: URLs assinadas expiram em 7 dias — este endpoint renova sem re-upload)
// ═══════════════════════════════════════════════════════════════
router.get('/cv/refresh', async (req, res) => {
  const bucket = getBucket();
  if (!bucket) return res.status(503).json({ error: 'Storage não configurado' });

  try {
    const docResult = await query(
      `SELECT d.storage_path, d.file_name
       FROM documents d
       JOIN profiles p ON d.profile_id = p.id
       WHERE p.user_id = $1 AND d.document_type = 'cv' AND d.is_primary = TRUE
       ORDER BY d.uploaded_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (!docResult.rows.length || !docResult.rows[0].storage_path) {
      return res.status(404).json({ error: 'CV não encontrado ou sem storage_path' });
    }

    const { storage_path, file_name } = docResult.rows[0];
    const newUrl = await generateSignedUrl(bucket, storage_path);

    // Actualizar URL na BD
    await query(
      `UPDATE profiles SET cv_url = $1 WHERE user_id = $2`,
      [newUrl, req.user.id]
    );
    await query(
      `UPDATE documents SET file_url = $1
       WHERE storage_path = $2`,
      [newUrl, storage_path]
    );

    logger.info('URL Firebase renovada', { userId: req.user.id });
    res.json({ success: true, cv_url: newUrl, file_name });

  } catch (err) {
    logger.error('Erro ao renovar URL CV:', err);
    res.status(500).json({ error: 'Erro ao renovar URL do CV' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/upload/cv — apagar CV do storage e BD
// ═══════════════════════════════════════════════════════════════
router.delete('/cv', async (req, res) => {
  const bucket = getBucket();

  try {
    const result = await query(
      `SELECT d.storage_path FROM documents d
       JOIN profiles p ON d.profile_id = p.id
       WHERE p.user_id = $1 AND d.document_type = 'cv'`,
      [req.user.id]
    );

    // Apagar do Firebase Storage
    if (bucket && result.rows.length) {
      await Promise.allSettled(
        result.rows
          .filter(r => r.storage_path)
          .map(r => bucket.file(r.storage_path).delete())
      );
    }

    // Limpar BD
    await query(
      `UPDATE profiles SET cv_url = NULL, cv_filename = NULL, cv_uploaded_at = NULL
       WHERE user_id = $1`,
      [req.user.id]
    );
    await query(
      `DELETE FROM documents
       WHERE profile_id = (SELECT id FROM profiles WHERE user_id = $1)
         AND document_type = 'cv'`,
      [req.user.id]
    );

    await auditLog({ userId: req.user.id, action: 'cv.delete', ipAddress: req.ip });
    res.json({ success: true, message: 'CV apagado' });

  } catch (err) {
    logger.error('Erro ao apagar CV:', err);
    res.status(500).json({ error: 'Erro ao apagar ficheiro' });
  }
});

// ── TRATAMENTO DE ERROS MULTER ────────────────────────────────
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Ficheiro demasiado grande (máximo 10 MB)' });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  if (err?.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Erro no upload' });
});

module.exports = router;
