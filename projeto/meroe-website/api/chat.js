// ============================================================
// MEROE — Vercel Serverless Function: /api/chat
// Proxy seguro para a Gemini API
// A API key NÃO está no frontend — está aqui como variável de ambiente
// ============================================================
// CONFIGURAR NO VERCEL:
//   Dashboard → Project → Settings → Environment Variables
//   Nome: GEMINI_API_KEY
//   Valor: [Tu clave de API de Gemini]
// ============================================================

const ALLOWED_ORIGINS = [
  'https://meroe-digital.vercel.app',
  'https://meroe-engineering.com',
  'https://www.meroe-engineering.com',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

const RATE_LIMIT_MAP = new Map(); // IP → { count, resetAt }
const MAX_REQUESTS = 20;          // por IP por hora
const WINDOW_MS = 60 * 60 * 1000; // 1 hora

const SYSTEM_PROMPT = `Você é o assistente digital da MEROE – Soluções em Engenharia Lda., 
uma empresa angolana de engenharia especializada em Oil & Gas.
Responda sempre de forma profissional, concisa e útil.
Sobre a MEROE: empresa angolana de engenharia, serviços upstream e downstream Oil & Gas, 
TARs, construção industrial, manutenção, supply chain, baseada em Luanda Angola.
Para questões de recrutamento, indique que há uma plataforma de talentos.
Responda em português a menos que o utilizador escreva em inglês.
Máximo 3 frases por resposta. Nunca partilhe informação confidencial.`;

export default async function handler(req, res) {
  // ── CORS ─────────────────────────────────────────────────
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // ── RATE LIMITING ─────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = RATE_LIMIT_MAP.get(ip) || { count: 0, resetAt: now + WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }

  if (record.count >= MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Limite de pedidos excedido. Por favor aguarde antes de continuar.',
      retryAfter: Math.ceil((record.resetAt - now) / 1000)
    });
  }

  record.count++;
  RATE_LIMIT_MAP.set(ip, record);

  // ── VALIDAÇÃO DO BODY ─────────────────────────────────────
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ error: 'Pedido inválido' });
  }

  const { message, history = [] } = body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem em falta ou inválida' });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: 'Mensagem demasiado longa (máx. 500 caracteres)' });
  }

  // Validar histórico
  if (!Array.isArray(history) || history.length > 20) {
    return res.status(400).json({ error: 'Histórico inválido' });
  }

  // ── CHAMAR GEMINI API ─────────────────────────────────────
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY não configurada');
    return res.status(500).json({ error: 'Serviço temporariamente indisponível' });
  }

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // Construir mensagens seguras
  const safeHistory = history
    .slice(-10) // máx 10 mensagens de contexto
    .filter(m => m.role && m.parts && Array.isArray(m.parts))
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.parts[0]?.text || '').substring(0, 500) }]
    }));

  const messages = [
    ...safeHistory,
    { role: 'user', parts: [{ text: message }] }
  ];

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages,
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.7,
          topP: 0.9,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ]
      }),
      signal: AbortSignal.timeout(10000) // timeout 10s
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini error:', err);
      return res.status(502).json({ error: 'Erro ao contactar serviço de IA' });
    }

    const data = await geminiRes.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return res.status(502).json({ error: 'Resposta da IA vazia' });
    }

    // Headers de cache — não cachear respostas de chat
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', MAX_REQUESTS - record.count);

    return res.status(200).json({ reply });

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Tempo de resposta excedido. Tente novamente.' });
    }
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
}
