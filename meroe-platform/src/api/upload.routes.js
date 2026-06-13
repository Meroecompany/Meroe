// ============================================================
// MEROE Platform — Upload Seguro de Ficheiros
// src/api/upload.routes.js
// ============================================================
'use strict';

const express  = require('express');
const multer   = require('multer');
const admin    = require('firebase-admin');
const { query } = require('../db/connection');
const { requireAuth } = require('../middleware/auth.middleware');
const { auditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
router.use(requireAuth);

// ── INICIALIZAR FIREBASE ADMIN ────────────────────────────────
let bucket;
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
  bucket = admin.storage().bucket();
} catch (err) {
  logger.error('Erro ao inicializar Firebase Admin:', err);
}

// ── MULTER — armazenamento em memória (temporário) ────────────
const ALLOWED_MIME = ['application/pdf'];
const MAX_SIZE     = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Apenas ficheiros PDF são aceites'));
    }
    // Verificar extensão também
    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new Error('Extensão de ficheiro inválida'));
    }
    cb(null, true);
  },
});

// ── HELPER: verificar magic bytes do PDF ─────────────────────
function isPDF(buffer) {
  // PDFs começam com %PDF-
  return buffer.length >= 5 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2D;   // -
}

// ── POST /api/upload/cv ───────────────────────────────────────
router.post('/cv', upload.single('cv'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ficheiro em falta' });
  }

  // Verificar magic bytes (previne upload de ficheiros mascarados de PDF)
  if (!isPDF(req.file.buffer)) {
    return res.status(400).json({ error: 'O ficheiro não é um PDF válido' });
  }

  if (!bucket) {
    return res.status(503).json({ error: 'Serviço de storage não disponível' });
  }

  try {
    // Nome único e seguro (sem nome original do utilizador)
    const fileId   = uuidv4();
    const fileName = `cvs/${req.user.id}/${fileId}.pdf`;

    const fileRef = bucket.file(fileName);

    // Upload para Firebase Storage com metadados
    await fileRef.save(req.file.buffer, {
      metadata: {
        contentType:    'application/pdf',
        cacheControl:   'private, max-age=3600',
        metadata: {
          uploadedBy: req.user.id,
          originalName: req.file.originalname.substring(0, 100),
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // URL de download assinada (válida 7 dias — renovar automaticamente)
    const [signedUrl] = await fileRef.getSignedUrl({
      action:  'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    // Actualizar perfil com URL do CV
    const profileResult = await query(
      `UPDATE profiles
       SET cv_url = $1, cv_filename = $2, cv_uploaded_at = NOW(),
           status = CASE WHEN status = 'incomplete' THEN 'pending' ELSE status END
       WHERE user_id = $3
       RETURNING id`,
      [signedUrl, req.file.originalname.substring(0, 255), req.user.id]
    );

    if (profileResult.rows.length > 0) {
      // Registar documento
      await query(
        `INSERT INTO documents (profile_id, document_type, file_name, file_url, storage_path, file_size_bytes, mime_type, is_primary)
         VALUES ($1, 'cv', $2, $3, $4, $5, 'application/pdf', TRUE)
         ON CONFLICT DO NOTHING`,
        [
          profileResult.rows[0].id,
          req.file.originalname.substring(0, 255),
          signedUrl,
          fileName,
          req.file.size,
        ]
      );
    }

    await auditLog({
      userId: req.user.id, action: 'cv.upload',
      resourceType: 'document',
      newValue: { size: req.file.size, fileName },
      ipAddress: req.ip, success: true,
    });

    logger.info('CV carregado com sucesso', { userId: req.user.id, size: req.file.size });

    res.json({
      success:  true,
      message:  'CV carregado com sucesso',
      cv_url:   signedUrl,
      fileName: req.file.originalname,
    });

  } catch (err) {
    logger.error('Erro no upload do CV:', { message: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Erro ao guardar o ficheiro. Tente novamente.' });
  }
});

// ── DELETE /api/upload/cv — apagar CV ────────────────────────
router.delete('/cv', async (req, res) => {
  try {
    const result = await query(
      'SELECT cv_url FROM profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0 || !result.rows[0].cv_url) {
      return res.status(404).json({ error: 'CV não encontrado' });
    }

    // Apagar do storage
    const storagePath = `cvs/${req.user.id}/`;
    const [files] = await bucket.getFiles({ prefix: storagePath });
    await Promise.all(files.map(f => f.delete()));

    // Limpar na BD
    await query(
      `UPDATE profiles SET cv_url = NULL, cv_filename = NULL, cv_uploaded_at = NULL WHERE user_id = $1`,
      [req.user.id]
    );
    await query(
      `DELETE FROM documents WHERE profile_id = (SELECT id FROM profiles WHERE user_id = $1) AND document_type = 'cv'`,
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
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Ficheiro demasiado grande (máximo 10MB)' });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
