// Status endpoint for Vercel
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const result = { wordpress: {}, openai: {}, config: {} };

  // Config summary (never expose full keys)
  result.config = {
    wp_url: process.env.WP_URL || null,
    wp_user: process.env.WP_USERNAME || null,
    wp_tag_ids: process.env.WP_TAG_IDS || 'none (all posts)',
    wp_max_posts: parseInt(process.env.WP_MAX_POSTS || '200', 10),
    openai_model: process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o',
    openai_key_set: !!(process.env.OPENAI_API_KEY || process.env.AI_KEY),
    sf_key_set: !!process.env.SECRETFLIGHTS_API_KEY,
    skyscanner_aff_set: !!process.env.SKYSCANNER_AFFILIATE_ID,
    booking_aff_set: !!process.env.BOOKING_AFFILIATE_ID,
  };

  // Check WordPress
  try {
    // Simple check - just verify env vars are set
    result.wordpress = {
      ok: !!(process.env.WP_URL && process.env.WP_USERNAME && process.env.WP_APP_PASSWORD),
      site: process.env.WP_URL,
      message: 'Environment variables configured'
    };
  } catch (err) {
    result.wordpress = { ok: false, error: err.message };
  }

  // Check OpenAI
  try {
    if (!process.env.OPENAI_API_KEY && !process.env.AI_KEY) throw new Error('API key not set');
    result.openai = { ok: true, model: process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o' };
  } catch (err) {
    result.openai = { ok: false, error: err.message };
  }

  result.flights = process.env.SECRETFLIGHTS_API_KEY
    ? { ok: true, message: 'מפתח API מוגדר — בדוק מהצ\'אט' }
    : { ok: false, error: 'SECRETFLIGHTS_API_KEY לא הוגדר' };

  result.usage = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };

  res.status(200).json(result);
}