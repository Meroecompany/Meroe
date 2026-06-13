// ============================================================
// MEROE Platform — API de IA (Gemini)
// src/api/ai.routes.js
// ============================================================
'use strict';

const express  = require('express');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { query } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { auditLog } = require('../utils/audit');
const { logger } = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// Rate limit específico para IA (chamadas são caras)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max: 15,
  message: { error: 'Limite de pesquisas IA atingido. Aguarde 1 minuto.' },
});

// ── INICIALIZAR GEMINI ────────────────────────────────────────
const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model  = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  generationConfig: { maxOutputTokens: 1000, temperature: 0.3 },
});

// ── HELPER: chamar Gemini com retry ──────────────────────────
async function callGemini(prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (attempt === retries) {throw err;}
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ── HELPER: extrair JSON da resposta Gemini ───────────────────
function extractJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/) ||
                text.match(/\{[\s\S]*\}/);
  if (!match) {throw new Error('JSON não encontrado na resposta da IA');}
  return JSON.parse(match[1] || match[0]);
}

// ── POST /api/ai/analyse-cv ───────────────────────────────────
// Analisa o texto de um CV e extrai dados estruturados
router.post('/analyse-cv', requireRole('super_admin','recruiter'), aiLimiter, async (req, res) => {
  const { profile_id, cv_text } = req.body;

  if (!profile_id || !cv_text) {
    return res.status(400).json({ error: 'profile_id e cv_text obrigatórios' });
  }
  if (cv_text.length > 15000) {
    return res.status(400).json({ error: 'Texto do CV demasiado longo (máx. 15000 caracteres)' });
  }

  const prompt = `
Você é um especialista em recrutamento para Oil & Gas em Angola (MEROE).
Analise este CV e responda APENAS com JSON válido (sem markdown, sem texto extra):

CV:
${cv_text}

JSON esperado:
{
  "full_name": "nome completo",
  "discipline": "disciplina principal (Mechanical/Electrical/Civil/Process/Instrumentation/Pipeline/HSE/Project Management)",
  "specialization": ["especialização 1", "especialização 2"],
  "experience_years": número inteiro,
  "seniority_level": "junior|mid|senior|lead|expert",
  "certifications": [{"name": "cert", "issued_by": "org", "year": "2020"}],
  "skills": ["skill1", "skill2"],
  "languages": [{"language": "Portuguese", "level": "native|fluent|intermediate|basic"}],
  "available_for_tars": true ou false,
  "professional_summary": "resumo profissional em PT, 3-4 frases focado em O&G",
  "ai_tags": ["tag1","tag2","tag3","tag4","tag5"],
  "ai_score": número 0-100 (relevância para O&G/TARs),
  "score_justification": "explicação do score em 2 frases em PT",
  "strengths": ["ponto forte 1", "ponto forte 2"],
  "concerns": ["preocupação 1 se existir"]
}`;

  try {
    const start = Date.now();
    const rawText = await callGemini(prompt);
    const data = extractJSON(rawText);
    const duration = Date.now() - start;

    // Actualizar perfil na base de dados
    await query(
      `UPDATE profiles SET
        discipline          = COALESCE($1, discipline),
        specialization      = $2,
        experience_years    = COALESCE($3, experience_years),
        seniority_level     = $4,
        certifications      = $5,
        skills              = $6,
        languages           = $7,
        professional_summary = COALESCE($8, professional_summary),
        ai_data             = $9,
        ai_score            = $10,
        ai_tags             = $11,
        ai_analysed_at      = NOW(),
        updated_at          = NOW()
       WHERE id = $12`,
      [
        data.discipline,
        data.specialization || [],
        data.experience_years,
        data.seniority_level,
        JSON.stringify(data.certifications || []),
        data.skills || [],
        JSON.stringify(data.languages || []),
        data.professional_summary,
        JSON.stringify(data),
        data.ai_score,
        data.ai_tags || [],
        profile_id,
      ]
    );

    await auditLog({
      userId: req.user.id, action: 'ai.analyse_cv',
      resourceType: 'profile', resourceId: profile_id,
      newValue: { score: data.ai_score, duration_ms: duration },
    });

    logger.info('CV analisado pela IA', { profileId: profile_id, score: data.ai_score, durationMs: duration });

    res.json({ success: true, data, duration_ms: duration });
  } catch (err) {
    logger.error('Erro na análise IA do CV:', err);
    res.status(500).json({ error: 'Erro na análise do CV pela IA. Tente novamente.' });
  }
});

// ── POST /api/ai/match ────────────────────────────────────────
// Encontra e classifica candidatos para um pedido
router.post('/match', requireRole('super_admin','recruiter'), aiLimiter, async (req, res) => {
  const {
    job_description,
    discipline,
    min_experience = 0,
    seniority_level,
    available_for_tars,
    country,
    max_results = 10,
  } = req.body;

  if (!job_description || job_description.length < 20) {
    return res.status(400).json({ error: 'Descrição do pedido obrigatória (mínimo 20 caracteres)' });
  }

  try {
    // Buscar candidatos pré-filtrados
    const conditions = ["p.status = 'approved'"];
    const params = [];
    let pidx = 1;

    if (discipline) { conditions.push(`p.discipline ILIKE $${pidx++}`); params.push(`%${discipline}%`); }
    if (min_experience > 0) { conditions.push(`p.experience_years >= $${pidx++}`); params.push(min_experience); }
    if (seniority_level) { conditions.push(`p.seniority_level = $${pidx++}`); params.push(seniority_level); }
    if (available_for_tars) { conditions.push(`p.available_for_tars = TRUE`); }
    if (country) { conditions.push(`p.location_country ILIKE $${pidx++}`); params.push(`%${country}%`); }

    params.push(Math.min(50, max_results * 3));
    const candidatesResult = await query(
      `SELECT p.id, p.full_name, p.discipline, p.specialization, p.experience_years,
              p.seniority_level, p.certifications, p.skills, p.professional_summary,
              p.ai_tags, p.available_for_tars, p.location_city, p.location_country, p.ai_score
       FROM profiles p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.ai_score DESC NULLS LAST LIMIT $${pidx}`,
      params
    );

    if (candidatesResult.rows.length === 0) {
      return res.json({ matches: [], total: 0, message: 'Nenhum candidato encontrado com os critérios' });
    }

    // Avaliar cada candidato com IA
    const results = [];
    for (const c of candidatesResult.rows) {
      try {
        const prompt = `
Avalia este candidato para o pedido de recrutamento. Responde APENAS com JSON válido:

PEDIDO: ${job_description}

CANDIDATO:
- Nome: ${c.full_name}
- Disciplina: ${c.discipline}
- Experiência: ${c.experience_years} anos (${c.seniority_level})
- Certificações: ${JSON.stringify(c.certifications).substring(0,200)}
- Skills: ${(c.skills||[]).join(', ')}
- Disponível TARs: ${c.available_for_tars}
- Tags IA: ${(c.ai_tags||[]).join(', ')}
- Resumo: ${(c.professional_summary||'').substring(0,300)}

JSON esperado:
{
  "score": número 0-100,
  "recommendation": "strong_yes|yes|maybe|no",
  "justification_pt": "justificação em português, 2-3 frases",
  "strengths_for_role": ["ponto 1", "ponto 2"],
  "gaps": ["lacuna 1 se existir"]
}`;

        const raw = await callGemini(prompt);
        const evaluation = extractJSON(raw);

        results.push({
          profile_id:   c.id,
          full_name:    c.full_name,
          discipline:   c.discipline,
          experience_years: c.experience_years,
          location:     `${c.location_city || ''}, ${c.location_country}`.trim(),
          ai_score:     evaluation.score,
          recommendation: evaluation.recommendation,
          justification:  evaluation.justification_pt,
          strengths:    evaluation.strengths_for_role || [],
          gaps:         evaluation.gaps || [],
          cv_score:     c.ai_score,
        });
      } catch (e) {
        logger.warn('Erro ao avaliar candidato:', { id: c.id, error: e.message });
      }
    }

    results.sort((a, b) => b.ai_score - a.ai_score);
    const topResults = results.slice(0, max_results);

    // Guardar pesquisa no histórico
    await query(
      `INSERT INTO ai_searches (searched_by, query_text, filters, results_count, results_ids)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.id,
        job_description,
        JSON.stringify({ discipline, min_experience, seniority_level, available_for_tars }),
        topResults.length,
        topResults.map(r => r.profile_id),
      ]
    );

    res.json({ matches: topResults, total: topResults.length, evaluated: results.length });
  } catch (err) {
    logger.error('Erro no match IA:', err);
    res.status(500).json({ error: 'Erro na pesquisa IA. Tente novamente.' });
  }
});

// ── GET /api/ai/searches — histórico de pesquisas ─────────────
router.get('/searches', requireRole('super_admin','recruiter'), async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*, u.email as searched_by_email
       FROM ai_searches s JOIN users u ON s.searched_by = u.id
       ORDER BY s.created_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter histórico' });
  }
});

module.exports = router;
