// Vercel API Route for Travel Chatbot
// This handles all requests in Vercel's serverless environment

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const env = {};
if (process.env.WP_URL) env.WP_URL = process.env.WP_URL;
if (process.env.WP_USERNAME) env.WP_USERNAME = process.env.WP_USERNAME;
if (process.env.WP_APP_PASSWORD) env.WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (process.env.OPENAI_MODEL) env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
if (process.env.AI_PROVIDER) env.AI_PROVIDER = process.env.AI_PROVIDER || 'openai';
if (process.env.AI_KEY) env.AI_KEY = process.env.AI_KEY;
if (process.env.AI_MODEL) env.AI_MODEL = process.env.AI_MODEL;

// Constants
const WP_URL = env.WP_URL;
const WP_USER = env.WP_USERNAME;
const WP_PASS = env.WP_APP_PASSWORD;
const WP_MAX_POSTS = parseInt(env.WP_MAX_POSTS || '200', 10);
const WP_TAG_IDS = env.WP_TAG_IDS || '';
const SITE_DESTINATION = env.SITE_DESTINATION || 'בחריין';
const SITE_DEST_IATA = env.SITE_DESTINATION_IATA || 'BAH';

// ── HTTPS request helper ──────────────────────────────────────────────────────
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Fetch posts from WordPress ────────────────────────────────────────────────
async function fetchWpPosts() {
  if (!WP_URL) throw new Error('WP_URL not set');
  if (!WP_USER) throw new Error('WP_USERNAME not set');
  if (!WP_PASS) throw new Error('WP_APP_PASSWORD not set');

  const params = new URLSearchParams({
    per_page: Math.min(WP_MAX_POSTS, 100),
    status: 'publish',
    _fields: 'id,title,content,excerpt,link',
    orderby: 'date',
    order: 'desc',
  });

  const tagIds = WP_TAG_IDS.replace(/[^0-9,]/g, '');
  if (tagIds) params.set('tags', tagIds);

  const urlObj = new URL(`/wp-json/wp/v2/posts?${params}`, WP_URL);
  const creds = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

  const result = await httpsRequest({
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Accept': 'application/json',
    },
  });

  if (result.status === 401) throw new Error('WordPress auth failed');
  if (result.status === 404) throw new Error('WordPress REST API not found');
  if (result.status !== 200) throw new Error(`WordPress API error: HTTP ${result.status}`);

  const posts = JSON.parse(result.body);
  if (!Array.isArray(posts)) throw new Error('Unexpected response from WordPress');

  return posts.map(post => ({
    title: decodeHtml(stripTags(post.title?.rendered || '')),
    content: htmlToText(post.content?.rendered || '') || htmlToText(post.excerpt?.rendered || ''),
    url: post.link || '',
  }));
}

// ── Helper functions ──────────────────────────────────────────────────────────
function stripTags(html) { return html.replace(/<[^>]*>/g, ''); }
function decodeHtml(s) { return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'"); }
function htmlToText(html) {
  let t = html.replace(/<(br|p|h[1-6]|li|div|blockquote)[^>]*>/gi, '\n');
  t = stripTags(t);
  t = decodeHtml(t);
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// ── Build AI context ──────────────────────────────────────────────────────────
function buildContext(posts) {
  if (!posts.length) return 'No travel articles are available.';
  let ctx = 'TRAVEL KNOWLEDGE BASE\n=====================\n\n';
  posts.forEach((post, i) => {
    const content = post.content.substring(0, 800) + (post.content.length > 800 ? '…' : '');
    ctx += `[Article ${i + 1}: ${post.title}]\n`;
    if (post.url) ctx += `URL: ${post.url}\n`;
    ctx += `Content: ${content}\n\n`;
  });
  return ctx;
}

// ── Call OpenAI API ───────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userMessage, history = []) {
  const apiKey = env.OPENAI_API_KEY || env.AI_KEY;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  const response = await httpsRequest({
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }, JSON.stringify({
    model: env.OPENAI_MODEL || env.AI_MODEL || 'gpt-4o',
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  }));

  if (response.status !== 200) {
    throw new Error(`OpenAI API error: ${response.status} - ${response.body}`);
  }

  const data = JSON.parse(response.body);
  return data.choices[0].message.content;
}

// ── Main API handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Handle different routes
  if (req.method === 'GET') {
    if (req.url === '/status') {
      // Handle status endpoint
      const result = { wordpress: {}, openai: {}, config: {} };

      // Config summary (never expose full keys)
      result.config = {
        wp_url: WP_URL || null,
        wp_user: WP_USER || null,
        wp_tag_ids: WP_TAG_IDS || 'none (all posts)',
        wp_max_posts: WP_MAX_POSTS,
        openai_model: env.OPENAI_MODEL || 'gpt-4o',
        openai_key_set: !!(env.OPENAI_API_KEY || env.AI_KEY),
        sf_key_set: !!env.SECRETFLIGHTS_API_KEY,
        skyscanner_aff_set: !!env.SKYSCANNER_AFFILIATE_ID,
        booking_aff_set: !!env.BOOKING_AFFILIATE_ID,
      };

      // Check WordPress
      try {
        const posts = await fetchWpPosts();
        result.wordpress = {
          ok: true,
          post_count: posts.length,
          site: WP_URL,
        };
      } catch (err) {
        result.wordpress = { ok: false, error: err.message };
      }

      // Check OpenAI
      try {
        if (!env.OPENAI_API_KEY && !env.AI_KEY) throw new Error('API key not set');
        result.openai = { ok: true, model: env.OPENAI_MODEL || 'gpt-4o' };
      } catch (err) {
        result.openai = { ok: false, error: err.message };
      }

      result.flights = env.SECRETFLIGHTS_API_KEY
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
    } else if (req.url === '/config') {
      // Handle config endpoint
      const destination = env.SITE_DESTINATION || 'בחריין';
      const iata = env.SITE_DESTINATION_IATA || 'BAH';
      const quickReplies = [
        { label: `✈️ טיסה ל${destination}`, message: `אני מחפש טיסה ל${destination}` },
        { label: `🏨 מלון ב${destination}`, message: `אני מחפש מלון ב${destination}` },
        { label: '📍 אטרקציות', message: `מה מומלץ לראות ב${destination}?` },
      ];

      res.status(200).json({
        siteName: env.SITE_NAME || 'Visit Bahrain',
        destination,
        iata,
        quickReplies
      });
    } else if (req.url === '/' || req.url === '/index.html') {
      try {
        const filePath = join(__dirname, '..', 'local-test', 'index.html');
        const data = readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(data);
      } catch (err) {
        res.status(500).json({ error: 'Error loading index.html' });
      }
    } else if (req.url.endsWith('.css')) {
      try {
        const filePath = join(__dirname, '..', 'local-test', req.url);
        const data = readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'text/css');
        res.status(200).send(data);
      } catch (err) {
        res.status(404).json({ error: 'CSS file not found' });
      }
    } else if (req.url.endsWith('.js')) {
      try {
        const filePath = join(__dirname, '..', 'local-test', req.url);
        const data = readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'application/javascript');
        res.status(200).send(data);
      } catch (err) {
        res.status(404).json({ error: 'JS file not found' });
      }
    } else if (req.url === '/favicon.ico') {
      // Return empty favicon to avoid 404
      res.setHeader('Content-Type', 'image/x-icon');
      res.status(200).send('');
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } else if (req.method === 'POST') {
    // Handle API requests
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { message, history = [] } = data;

        if (!message) {
          return res.status(400).json({ error: 'Message is required' });
        }

        // Fetch posts and build context
        let posts = [];
        try {
          posts = await fetchWpPosts();
        } catch (err) {
          console.error('Failed to fetch posts:', err.message);
          // Continue with empty posts if WP fetch fails
        }

        const context = buildContext(posts);
        const systemPrompt = `You are a helpful travel assistant for ${SITE_DESTINATION}. Use the provided travel knowledge base to answer questions about destinations, travel tips, and local attractions. Always respond in Hebrew. Be friendly and informative.

${context}`;

        // Call AI API
        let reply;
        try {
          reply = await callOpenAI(systemPrompt, message, history);
        } catch (err) {
          console.error('AI API error:', err.message);
          reply = 'מצטער, יש בעיה עם החיבור לשרת הבינה המלאכותית. אנא נסה שוב מאוחר יותר.';
        }

        res.status(200).json({
          success: true,
          reply,
          suggestions: ['מה כדאי לראות?', 'איפה כדאי ללון?', 'טיסות זולות'],
          suggestionType: 'chips'
        });
      } catch (err) {
        console.error('Request error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}