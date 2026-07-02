const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function stripMarkdownFences(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleaned = text.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/```\s*$/, '');
  }

  return cleaned.trim();
}

function parseMcqJson(text) {
  const cleaned = stripMarkdownFences(text);
  if (!cleaned) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
}

function buildPrompt(subject, level, count) {
  const levelLabel = String(level).charAt(0).toUpperCase() + String(level).slice(1).toLowerCase();

  return [
    `Generate exactly ${count} unique multiple-choice questions for the academic subject "${subject}" at ${levelLabel} difficulty.`,
    'Return ONLY a valid JSON array. No markdown, no commentary, no code fences.',
    'Each item must use this exact shape:',
    '{"question":"...","options":["A","B","C","D"],"correct_answer":"exact text of one option","explanation":"short reason"}',
    'Rules:',
    '- Exactly 4 options per question',
    '- correct_answer must exactly match one option string',
    `- Questions must be relevant to ${subject}`,
    `- Difficulty must be ${levelLabel}`,
    '- Do not repeat questions',
  ].join('\n');
}

function validateMcqs(mcqs) {
  if (!Array.isArray(mcqs) || mcqs.length === 0) {
    return false;
  }

  return mcqs.every((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const question = String(item.question || '').trim();
    const options = Array.isArray(item.options) ? item.options.map((o) => String(o).trim()) : [];
    const correct = String(item.correct_answer || '').trim();

    return question !== '' && options.length === 4 && correct !== '' && options.includes(correct);
  });
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const subject = String(body.subject || '').trim();
    const level = String(body.level || '').trim().toLowerCase();
    const count = Math.min(Math.max(parseInt(body.count, 10) || 10, 1), 30);

    if (!subject) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: subject',
      });
    }

    if (!level) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: level',
      });
    }

    const prompt = buildPrompt(subject, level, count);
    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    });

    const geminiBody = await geminiResponse.text();

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status >= 400 && geminiResponse.status < 600 ? geminiResponse.status : 502).json({
        success: false,
        error: `Gemini API error (${geminiResponse.status}): ${geminiBody.slice(0, 500)}`,
      });
    }

    let geminiJson;
    try {
      geminiJson = JSON.parse(geminiBody);
    } catch (_) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned a non-JSON response envelope.',
      });
    }

    const responseText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const mcqs = parseMcqJson(responseText);

    if (!validateMcqs(mcqs)) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned invalid or empty MCQ JSON.',
        debugRawText: responseText.slice(0, 1000),
        debugParsedMcqs: mcqs,
      });
    }

    return res.status(200).json({
      success: true,
      mcqs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    });
  }
}
