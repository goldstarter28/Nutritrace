'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/responses';

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function cleanText(v, max = 300) {
  return String(v || '').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo non consentito.' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(503).json({
    error: 'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'
  });

  const body = getBody(req);
  const food = body.food || {};
  const name = cleanText(food.name, 180);

  if (!name) {
    return res.status(400).json({ error: 'Nome alimento mancante.' });
  }

  const missingNutrients = Array.isArray(body.missingNutrients)
    ? [...new Set(
        body.missingNutrients
          .map(x => cleanText(x, 100))
          .filter(Boolean)
      )].slice(0, 80)
    : [];

  const existingNutrients = Array.isArray(food.nutrients)
    ? food.nutrients.slice(0, 100).map(n => ({
        name: cleanText(n.name, 100),
        amount: Number(n.amount),
        unit: cleanText(n.unit, 8)
      }))
    : [];

  const knownLabel = {};

  for (const k of [
    'kcal',
    'protein',
    'carbs',
    'sugar',
    'fat',
    'saturatedFat',
    'fiber',
    'salt'
  ]) {
    const v = food.label?.[k];

    knownLabel[k] =
      v === '' ||
      v === null ||
      v === undefined ||
      !Number.isFinite(Number(v))
        ? null
        : Number(v);
  }

  const prompt = {
    task: 'Estimate only missing food-composition values for NutriTrace.',
    food: {
      name,
      brand: cleanText(food.brand, 120),
      reference_basis_g:
        Number(food.servingGrams) > 0
          ? Number(food.servingGrams)
          : 100,
      known_label: knownLabel,
      already_known_nutrients: existingNutrients
    },
    requested_missing_nutrients: missingNutrients
  };

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          [
            'kcal',
            'protein',
            'carbs',
            'sugar',
            'fat',
            'saturatedFat',
            'fiber',
            'salt'
          ].map(k => [k, { type: ['number', 'null'] }])
        ),
        required: [
          'kcal',
          'protein',
          'carbs',
          'sugar',
          'fat',
          'saturatedFat',
          'fiber',
          'salt'
        ]
      },

      nutrients: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            unit: {
              type: 'string',
              enum: ['g', 'mg', 'µg']
            },
            confidence: {
              type: 'string',
              enum: ['alta', 'media', 'bassa']
            },
            basis: { type: 'string' }
          },
          required: [
            'name',
            'amount',
            'unit',
            'confidence',
            'basis'
          ]
        }
      },

      note: { type: 'string' }
    },

    required: ['label', 'nutrients', 'note']
  };

  const instructions = [
    'You are a food-composition estimation component, not a dietitian.',
    'Return estimates for a reference amount equal to reference_basis_g in the input. Usually this is 100 g.',
    'Never modify or reinterpret a value that is already present in known_label or already_known_nutrients.',
    'For label fields, return null when that field was already known. Otherwise estimate only when reasonably defensible.',
    'For nutrients, return only names explicitly listed in requested_missing_nutrients; omit nutrients you cannot reasonably estimate.',
    'Use common edible-food composition, respecting preparation state in the food name (raw/cooked/dried/etc.).',
    'Do not fabricate laboratory precision. Use sensible significant digits and mark uncertain values with lower confidence.',
    'Amounts must use exactly g, mg, or µg. Salt is grams of salt equivalent, not sodium.',
    'The output will be displayed as AI-estimated data and never as analytical or label data.'
  ].join(' ');

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',

      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',

        ...(process.env.OPENROUTER_SITE_URL
          ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL }
          : {}),

        'X-Title':
          process.env.OPENROUTER_APP_NAME || 'NutriTrace'
      },

      body: JSON.stringify({
        model:
          process.env.OPENROUTER_MODEL ||
          'openrouter/free',

        store: false,
        max_output_tokens: 5000,

        instructions,

        input: JSON.stringify(prompt),

        text: {
          format: {
            type: 'json_schema',
            name: 'nutrition_estimate',
            strict: true,
            schema
          }
        }
      })
    });

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const message =
        data?.error?.message ||
        `OpenRouter API ${response.status}`;

      return res.status(502).json({
        error: message
      });
    }

    const text = outputText(data);

    if (!text) {
      return res.status(502).json({
        error: 'Risposta AI priva di output strutturato.'
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: 'Risposta AI non interpretabile.'
      });
    }

    const allowed = new Set(
      missingNutrients.map(x =>
        x.toLocaleLowerCase('it-IT')
      )
    );

    parsed.nutrients = (parsed.nutrients || [])
      .filter(n =>
        allowed.has(
          String(n.name || '')
            .toLocaleLowerCase('it-IT')
        )
      );

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(502).json({
      error:
        `AI non disponibile: ${
          error.message || 'errore di rete'
        }`
    });
  }
};
