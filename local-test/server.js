/**
 * Travel Chatbot — Local Dev Server
 * Pure Node.js, zero dependencies.
 *
 * Usage:  node server.js
 * Then open: http://localhost:8080
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;

// ── Load .env ─────────────────────────────────────────────────────────
function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return;
    const [key, ...rest] = line.split('=');
    let val = rest.join('=').trim();
    // strip inline comments
    const commentIdx = val.indexOf(' #');
    if (commentIdx !== -1) val = val.slice(0, commentIdx).trim();
    // strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key.trim()] = val;
  });
  return env;
}

const env = loadEnv(path.join(__dirname, '.env'));

// ── In-memory usage tracking ───────────────────────────────────────────
const usageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };

// ── Flight API call log (last 10) ──────────────────────────────────────
const flightLogs = [];

// ── WP posts + site-config cache (30 min) ─────────────────────────────
let postsCache  = { data: null, fetchedAt: 0 };
let siteConfig  = null; // { destination, iata, locationHints } — derived from posts
const POSTS_CACHE_TTL = 30 * 60 * 1000;

async function getCachedPosts() {
  if (postsCache.data && Date.now() - postsCache.fetchedAt < POSTS_CACHE_TTL) {
    return postsCache.data;
  }
  const posts = await fetchWpPosts();
  postsCache = { data: posts, fetchedAt: Date.now() };
  siteConfig  = null; // invalidate derived config
  return posts;
}

// Returns { destination, iata, locationHints }
// Priority: .env values → auto-extracted from WP posts
async function getSiteConfig() {
  if (siteConfig) return siteConfig;
  const posts         = await getCachedPosts().catch(() => []);
  const locationHints = extractLocations(posts);
  const autoDest      = locationHints[0] || '';
  const destination   = SITE_DESTINATION || autoDest;
  const iata          = SITE_DEST_IATA   || DEST_TO_IATA[destination] || '';
  siteConfig = { destination, iata, locationHints };
  return siteConfig;
}

// ── AI response cache (1 hour, max 100 entries) ────────────────────────
const aiCache = new Map();
const AI_CACHE_TTL = 60 * 60 * 1000;

function hashRequest(msg, histLen) {
  return `${msg.trim().toLowerCase()}::${histLen}`;
}

const OPENAI_KEY   = env.OPENAI_API_KEY  || '';
const OPENAI_MODEL = env.OPENAI_MODEL    || 'gpt-4o';
const WP_URL       = (env.WP_URL         || '').replace(/\/$/, '');
const WP_USER      = env.WP_USERNAME     || '';
const WP_PASS      = env.WP_APP_PASSWORD || '';
const WP_TAG_IDS   = env.WP_TAG_IDS      || '';
const WP_MAX_POSTS      = parseInt(env.WP_MAX_POSTS || '10', 10);
const SF_KEY            = env.SECRETFLIGHTS_API_KEY     || '';
const SF_BASE_URL       = env.SECRETFLIGHTS_BASE_URL    || 'https://api.secretflights.co.il/deals/v2';
const SF_ASSOCIATE_ID   = env.SECRETFLIGHTS_ASSOCIATE_ID || '';
const SF_HOTELS_URL     = env.SF_HOTELS_URL  || 'https://secretflights.co.il/wp-json/onix/v1/get_hotels';
const SF_HOTELS_NONCE   = env.SF_HOTELS_NONCE || '';
const SKYSCANNER_AFF_ID = env.SKYSCANNER_AFFILIATE_ID || '';
const BOOKING_AFF_ID    = env.BOOKING_AFFILIATE_ID    || '';
const SITE_NAME         = env.SITE_NAME               || 'Travel Assistant';
const SITE_DESTINATION  = env.SITE_DESTINATION        || '';
const SITE_DEST_IATA    = env.SITE_DESTINATION_IATA   || '';

// ── MIME types for static files ───────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── HTTP helpers ──────────────────────────────────────────────────────
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

// ── Fetch posts from WordPress ────────────────────────────────────────
async function fetchWpPosts() {
  if (!WP_URL)  throw new Error('WP_URL not set in .env');
  if (!WP_USER) throw new Error('WP_USERNAME not set in .env');
  if (!WP_PASS) throw new Error('WP_APP_PASSWORD not set in .env');

  const params = new URLSearchParams({
    per_page: Math.min(WP_MAX_POSTS, 100),
    status:   'publish',
    _fields:  'id,title,content,excerpt,link',
    orderby:  'date',
    order:    'desc',
  });

  const tagIds = WP_TAG_IDS.replace(/[^0-9,]/g, '');
  if (tagIds) params.set('tags', tagIds);

  const urlObj  = new URL(`/wp-json/wp/v2/posts?${params}`, WP_URL);
  const creds   = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

  const result = await httpsRequest({
    hostname: urlObj.hostname,
    port:     urlObj.port || 443,
    path:     urlObj.pathname + urlObj.search,
    method:   'GET',
    headers:  {
      'Authorization': `Basic ${creds}`,
      'Accept':        'application/json',
    },
  });

  if (result.status === 401) throw new Error('WordPress auth failed — check WP_USERNAME and WP_APP_PASSWORD');
  if (result.status === 404) throw new Error('WordPress REST API not found — check WP_URL');
  if (result.status !== 200) throw new Error(`WordPress API error: HTTP ${result.status}`);

  const posts = JSON.parse(result.body);
  if (!Array.isArray(posts)) throw new Error('Unexpected response from WordPress');

  return posts.map(post => ({
    title:   decodeHtml(stripTags(post.title?.rendered || '')),
    content: htmlToText(post.content?.rendered || '') || htmlToText(post.excerpt?.rendered || ''),
    url:     post.link || '',
  }));
}

function stripTags(html) { return html.replace(/<[^>]*>/g, ''); }
function decodeHtml(s)   { return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'"); }
function htmlToText(html) {
  let t = html.replace(/<(br|p|h[1-6]|li|div|blockquote)[^>]*>/gi, '\n');
  t = stripTags(t);
  t = decodeHtml(t);
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// ── Build AI context ──────────────────────────────────────────────────
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

// ── Extract location names from post titles ───────────────────────────
function extractLocations(posts) {
  const freq = {};
  // Common non-location Hebrew words to ignore
  const stopwords = new Set([
    'מדריך','טיול','ביקור','חופשה','אתר','מקום','דברים','ראות','לעשות',
    'תיירות','מומלץ','מומלצים','המדריך','השלם','הטוב','ביותר','גדול',
    'קטן','חדש','ישן','יפה','מיוחד','כיף','בחינם','לילה','יום','שבוע',
  ]);

  posts.forEach(post => {
    const title = post.title || '';
    // Extract words/bi-grams after Hebrew prepositions ב/ל/מ/אל
    const re = /(?:^|[\s,–-])(?:[בלמ]-?|אל\s+)([א-ת]{2,}(?:\s+[א-ת]{2,})?)/g;
    let m;
    while ((m = re.exec(title)) !== null) {
      const loc = m[1].trim();
      if (!stopwords.has(loc)) freq[loc] = (freq[loc] || 0) + 1;
    }
    // Also grab stand-alone capitalised-position words (first word of title)
    const first = title.split(/[\s–-]/)[0];
    if (first && first.length >= 3 && !stopwords.has(first))
      freq[first] = (freq[first] || 0) + 0.5;
  });

  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([w]) => w);
}

// ── Booking flow — parse what's already been collected ────────────────
const DEST_TO_IATA = {
  'בחריין': 'BAH', 'מנאמה': 'BAH', 'מחרק': 'BAH', 'ריף': 'BAH', 'סטרה': 'BAH',
  'דובאי': 'DXB', 'אבו דאבי': 'AUH', 'לונדון': 'LHR', 'פריז': 'CDG',
  'ניו יורק': 'JFK', 'בנגקוק': 'BKK', 'טוקיו': 'NRT', 'ברצלונה': 'BCN',
  'אמסטרדם': 'AMS', 'רומא': 'FCO', 'מדריד': 'MAD', 'אתונה': 'ATH',
};

function parseCollectedData(history) {
  const data = { destination: null, iata: null, adults: null, children: null, month: null, maxPrice: null, hotelCheckin: null, hotelCheckout: null };
  const allText = history.map(m => m.content || '').join('\n');

  // Destination
  const destMatch = allText.match(/טיסה ל([א-ת]+(?:\s[א-ת]+)?)|אני מחפש [^ל]*ל([א-ת]+(?:\s[א-ת]+)?)/);
  if (destMatch) {
    const d = (destMatch[1] || destMatch[2] || '').trim();
    if (d) { data.destination = d; data.iata = DEST_TO_IATA[d] || SITE_DEST_IATA; }
  }
  if (!data.destination && SITE_DESTINATION) {
    data.destination = SITE_DESTINATION; data.iata = SITE_DEST_IATA;
  }

  // Travelers — matches "2 מבוגרים, ללא ילדים" / "2 מבוגרים, ילד אחד" / "2 מבוגרים, 3 ילדים"
  const travMatch = allText.match(/(\d+)\s*מבוגרים?[,،]\s*(?:(\d+)\s*ילדים?|ילד אחד|(ללא ילדים))/);
  if (travMatch) {
    data.adults   = parseInt(travMatch[1]);
    data.children = travMatch[2] ? parseInt(travMatch[2]) : (travMatch[3] ? 0 : 1);
  }

  // Max price / budget
  const budgetMatch = allText.match(/תקציב[^:]*:\s*\$?(\d+)/);
  if (budgetMatch) data.maxPrice = parseInt(budgetMatch[1]);

  // Hotel dates — "תאריכים: DD.MM.YYYY — DD.MM.YYYY"
  const hotelDateMatch = allText.match(/תאריכים:\s*(\d{2})\.(\d{2})\.(\d{4})\s*[—–-]\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (hotelDateMatch) {
    data.hotelCheckin  = `${hotelDateMatch[3]}-${hotelDateMatch[2]}-${hotelDateMatch[1]}`;
    data.hotelCheckout = `${hotelDateMatch[6]}-${hotelDateMatch[5]}-${hotelDateMatch[4]}`;
  }

  // Month / season keyword
  const monthMap = {
    'חודש הבא': 'next_month', 'בקיץ': 'summer', 'קיץ': 'summer',
    'בסוכות': 'sukkot',       'בחנוכה': 'hanukkah', 'בפסח': 'pesach',
    'גמיש': 'flexible',
    'ינואר':'01','פברואר':'02','מרץ':'03','אפריל':'04',
    'מאי':'05','יוני':'06','יולי':'07','אוגוסט':'08',
    'ספטמבר':'09','אוקטובר':'10','נובמבר':'11','דצמבר':'12',
  };
  for (const [kw, val] of Object.entries(monthMap)) {
    if (allText.includes(kw)) { data.month = val; break; }
  }

  return data;
}

// ── Booking flow — detect which step we're on ─────────────────────────
function detectFlowStep(userMessage, history) {
  const msg        = userMessage.trim();
  const lastBot    = [...history].reverse().find(m => m.role === 'assistant');
  const lastBotMsg = lastBot?.content || '';

  // Hotel date picker result — "תאריכים: DD.MM.YYYY — DD.MM.YYYY"
  if (/תאריכים:\s*\d{2}\.\d{2}\.\d{4}/.test(msg)) return 'flow_hotel_dates_answer';

  // Budget slider chip clicked
  if (/שנה תקציב|💰 שנה/.test(msg)) return 'show_budget_slider';

  // User confirmed budget (sent from slider or manually)
  if (/תקציב[^:]*:\s*\$?\d+/.test(msg)) return 'flow_budget_answer';
  if (/ללא הגבלה|כל מחיר/.test(msg) && /תקציב|מחיר|דילים/.test(lastBotMsg)) return 'flow_budget_answer';

  // Traveler count answer (from picker — after any question asking for travelers)
  if (/\d+\s*מבוגרים?/.test(msg) &&
      (/כמה נוסעים|כמה אנשים|מספר נוסעים|נוסע 1/.test(lastBotMsg) || /ילדים|ללא ילדים/.test(msg))) {
    return 'flow_travelers_answer';
  }

  // Holiday/timing auto-search (BEFORE isQuestion guard and attraction guard)
  if (/מתי.*(לטוס|הזמן|כדאי|טוב)|הזמן.*(טוב|כדאי).*לטוס|(דיל|דילים).*(חג|פסח|סוכות|חנוכה|קיץ)|(חג|פסח|סוכות|חנוכה|קיץ).*(דיל|טיסה)|טיסות.*לחג/.test(msg)) return 'flow_timing_auto';

  // Month chip answer (only when last bot asked מתי)
  if (/חודש|קיץ|חגים|סוכות|חנוכה|פסח|גמיש|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר/.test(msg) &&
      /מתי|באיזה חודש|תאריך|לטוס/.test(lastBotMsg)) {
    return 'flow_dates_answer';
  }

  // Attraction followup
  if (/סוג האטרקציות|מה מחפש|אקסטרים|משפחתי|תרבות|אוכל|טבע|לילה/.test(lastBotMsg)) {
    return 'content';
  }

  // Fresh booking intents — skip question words (those go to AI)
  const isQuestion = /^(מה|כמה|מתי|יש|האם|למה|איפה|איזה)/.test(msg);
  if (!isQuestion && /טיסה|לטוס|דיל טיסה|טיסות|דילים/.test(msg)) return 'flight_start';
  if (!isQuestion && /מלון|לינה|אירוח|להתאכסן/.test(msg))          return 'hotel_start';
  if (!isQuestion && /אטרקצי|לראות|לעשות|מה יש|מה כדאי/.test(msg)) return 'attraction_start';

  return 'content';
}

// Returns the next upcoming holiday label + approximate month for auto-search
function getNextHoliday() {
  const m = new Date().getMonth() + 1; // 1-based
  if (m <= 3)  return { label: 'בפסח',    month: 4  };
  if (m <= 5)  return { label: 'בקיץ',    month: 7  };
  if (m <= 8)  return { label: 'בסוכות',  month: 10 };
  if (m <= 10) return { label: 'בחנוכה',  month: 12 };
  return             { label: 'בפסח',    month: 4  }; // next year Passover
}

// Month number → display label (Hebrew)
const MONTH_LABELS = {
  1:'ינואר', 2:'פברואר', 3:'מרץ', 4:'אפריל', 5:'מאי', 6:'יוני',
  7:'יולי', 8:'אוגוסט', 9:'ספטמבר', 10:'אוקטובר', 11:'נובמבר', 12:'דצמבר',
};

const SEASON_MONTH_NUM = { summer: 7, sukkot: 10, hanukkah: 12, pesach: 4 };

// Return numeric month (1-12) for a collected.month value, or null
function resolvedMonthNum(month) {
  if (!month) return null;
  if (SEASON_MONTH_NUM[month]) return SEASON_MONTH_NUM[month];
  if (month === 'next_month') return (new Date().getMonth() + 2) % 12 || 12;
  if (/^\d{2}$/.test(month)) return parseInt(month, 10);
  return null;
}

// Build chips for the ±1 and ±2 months adjacent to a given month number
function adjacentMonthChips(monthNum) {
  if (!monthNum) return [];
  const chips = [];
  for (const delta of [-1, 1, -2, 2]) {
    const m = ((monthNum - 1 + delta + 12) % 12) + 1;
    chips.push(MONTH_LABELS[m]);
  }
  return chips;
}

// ── Shared: search flights and return structured deal cards ───────────
async function searchAndReturnDeals(collected) {
  try {
    const params = {};
    if (collected.iata)     params.destination = collected.iata;
    if (collected.maxPrice) params.max_price   = collected.maxPrice;
    const monthNum = resolvedMonthNum(collected.month);
    if (monthNum) params.month = monthNum;

    const rawDeals = await fetchFlightDeals(params);

    if (!rawDeals.length) {
      const adjChips = adjacentMonthChips(monthNum);
      return {
        reply: 'לא מצאתי דילים זמינים כרגע 😕\nאולי כדאי לנסות חודשים אחרים?',
        suggestions: [...adjChips, 'יעד אחר'],
        suggestionType: 'chips',
      };
    }

    const dest = collected.destination || 'בחריין';

    // Build structured deal objects for card rendering in the chat
    const deals = rawDeals.slice(0, 4).map(deal => {
      const destCode = deal.destination || deal.dest || '';
      const outDate  = deal.outbound_date  || deal.departure_date || deal.date_from || '';
      const retDate  = deal.inbound_date   || deal.return_date    || deal.date_to   || '';
      const hasKey   = !!(deal.deal_key || deal.key);
      return {
        city:    deal.destination_city || deal.dest_name || deal.city || deal.destination_name || dest,
        iata:    destCode || collected.iata || '',
        price:   deal.price || deal.min_price || deal.total_price || '?',
        outDate,
        retDate,
        airline: deal.airline_name || deal.airline || deal.carrier || '',
        direct:  !!(deal.direct || deal.non_stop),
        url: hasKey
          ? buildSecretFlightsRedirectUrl(deal)
          : buildSkyscannerUrl(destCode, outDate, retDate, collected.adults || 1),
      };
    });

    return {
      reply: `מצאתי ${rawDeals.length} דילים על טיסות ל${dest} ✈️`,
      deals,
      suggestions: ['🏨 חפש גם מלון', '📍 מה לראות', '💰 שנה תקציב'],
      suggestionType: 'flight_cards',
    };
  } catch (err) {
    return {
      reply: `לא הצלחתי למצוא טיסות כרגע. ${err.message}`,
      suggestions: ['נסה שוב', '📍 מה לראות'],
      suggestionType: 'chips',
    };
  }
}

// ── Booking flow — build pre-built response (no AI call) ──────────────
async function buildFlowResponse(step, collected, locationHints) {
  // Artificial delay so pre-built responses feel natural, not instant
  await new Promise(r => setTimeout(r, 2500));

  switch (step) {

    case 'flight_start': {
      const dest    = collected.destination;
      const destStr = dest ? `ל${dest} ` : '';
      return {
        reply: `בשמחה! מתי תרצו לטוס ${destStr}? 📅`,
        suggestions: ['חודש הבא', 'בקיץ', 'בפסח', 'בחגים', 'בחנוכה', 'גמיש'],
        suggestionType: 'chips',
      };
    }

    case 'flow_travelers_answer': {
      // Deals already shown — just acknowledge passenger count
      const adults  = collected.adults || 1;
      const paxStr  = adults === 1 ? 'נוסע אחד' : `${adults} נוסעים`;
      const dest    = collected.destination || 'היעד';
      return {
        reply: `מצוין! 🎉 הנה ההצעות שמצאנו ל${paxStr}.\nלחץ על ״למצוא את ההצעה״ לפרטים נוספים.`,
        suggestions: [`🏨 חפש גם מלון`, `📍 מה לראות ב${dest}`],
        suggestionType: 'chips',
      };
    }

    case 'hotel_start': {
      const dest = collected.destination || SITE_DESTINATION;
      return {
        reply: `מתי תרצו להגיע ל${dest}? 📅\nבחרו תאריכי הגעה ועזיבה:`,
        suggestions: [],
        suggestionType: 'date_picker',
      };
    }

    case 'flow_hotel_dates_answer': {
      const dest  = collected.destination || SITE_DESTINATION;
      const iata  = collected.iata || SITE_DEST_IATA;
      // Parse dates from message like "תאריכים: 15.05.2026 — 20.05.2026"
      const match = (collected.hotelCheckin && collected.hotelCheckout)
        ? { checkin: collected.hotelCheckin, checkout: collected.hotelCheckout }
        : null;
      if (!match || !iata) {
        return {
          reply: 'לא הצלחתי לקרוא את התאריכים 😔 נסו שוב',
          suggestions: [],
          suggestionType: 'date_picker',
        };
      }
      try {
        const hotels = await fetchHotelDeals(iata, null, collected.adults || 2, match.checkin, match.checkout);
        if (!hotels.length) {
          return {
            reply: `לא מצאתי מלונות זמינים ב${dest} לתאריכים האלה 😔`,
            suggestions: ['📅 שנה תאריכים', '✈️ חפש טיסה'],
            suggestionType: 'chips',
          };
        }
        const hotelDeals = hotels.map(h => ({
          type:             'hotel',
          name:             h.name,
          stars:            h.stars,
          price:            h.price,
          image:            h.image_url || '',
          rating:           h.guest_rating,
          reviewCount:      h.guest_review_count,
          checkin:          h.checkin_date,
          checkout:         h.checkout_date,
          freeCancellation: h.free_cancellation,
          breakfast:        h.breakfast_included,
          url:              h.deeplink,
        }));
        return {
          reply: `מצאתי ${hotels.length} מלונות ב${dest} 🏨`,
          deals: hotelDeals,
          suggestions: ['✈️ חפש גם טיסה', '📍 מה לראות'],
          suggestionType: 'hotel_cards',
        };
      } catch (err) {
        return {
          reply: `לא הצלחתי למצוא מלונות כרגע 😔 (${err.message})`,
          suggestions: ['📅 נסה שוב', '✈️ חפש טיסה'],
          suggestionType: 'chips',
        };
      }
    }

    case 'attraction_start': {
      const dest = collected.destination || SITE_DESTINATION;
      return {
        reply: `מה סוג האטרקציות שאתם מחפשים${dest ? ` ב${dest}` : ''}?`,
        suggestions: ['🤿 אקסטרים', '👨‍👩‍👧 משפחתי', '🏛️ תרבות', '🍽️ אוכל', '🌿 טבע', '🎉 לילה'],
        suggestionType: 'chips',
      };
    }

    case 'show_budget_slider': {
      return {
        reply: 'כמה תרצה להוציא לאדם? 💰',
        suggestions: [],
        suggestionType: 'budget_slider',
      };
    }

    case 'flow_timing_auto': {
      // Auto-detect next upcoming holiday and search deals for it
      const holiday = getNextHoliday();
      const result  = await searchAndReturnDeals({ ...collected, month: holiday.label, adults: 1 });
      result.reply  = `מצאתי את הדילים הכי טובים **${holiday.label}** ✈️\n\n` + result.reply;
      result.reply += '\n\n_מחירים לנוסע 1 — כמה נוסעים יטוסו?_';
      result.suggestions = [];
      result.suggestionType = 'traveler_picker';
      return result;
    }

    case 'flow_dates_answer': {
      const result = await searchAndReturnDeals({ ...collected, adults: 1 });
      if (!collected.adults) {
        result.reply += '\n\n_מחירים לנוסע 1 — כמה נוסעים יטוסו?_';
        result.suggestions = [];
        result.suggestionType = 'traveler_picker';
      }
      return result;
    }

    case 'flow_budget_answer': {
      // User set a budget (or said "no limit") — re-search with price filter
      return await searchAndReturnDeals(collected);
    }

    default:
      return null; // fall through to AI
  }
}

// ── Detect topic + suggest follow-up chips ────────────────────────────
function detectTopic(msg) {
  const m = (msg || '').toLowerCase();
  if (/טיס|דיל|flight|iata|skyscanner/.test(m)) return 'flights';
  if (/מלון|לינה|אירוח|hotel|booking/.test(m))   return 'hotels';
  if (/אטרקצי|לראות|לעשות|מה יש|מה כדאי/.test(m)) return 'attractions';
  return 'general';
}

function getSuggestions(topic) {
  switch (topic) {
    case 'flights':     return ['🏨 מלון שם', '📍 מה לראות', '💰 דיל זול יותר'];
    case 'hotels':      return ['✈️ טיסה לשם', '📍 מה לראות', 'ספר לי עוד'];
    case 'attractions': return ['✈️ טיסות לשם', '🏨 מלון שם', 'ספר לי עוד'];
    default:            return ['📍 אטרקציות', '✈️ טיסות', '🏨 מלונות'];
  }
}

// ── Extract inline chips / picker / sources from AI reply ────────────
function extractChips(rawText) {
  let text      = rawText;
  let chips     = null;
  let sourceUrls = [];

  // Extract CHIPS/PICKER first so SOURCES can match regardless of tag order

  // Traveler picker tag
  const pickerMatch = text.match(/\[PICKER:\s*travelers\]/i);
  if (pickerMatch) {
    text = text.replace(pickerMatch[0], '').trim();
    // Extract SOURCES before returning
    const srcMatch = text.match(/\[SOURCES:\s*([^\]]+)\]/);
    if (srcMatch) {
      sourceUrls = srcMatch[1].split('|').map(s => s.trim()).filter(s => s.startsWith('http'));
      text = text.replace(srcMatch[0], '').trim();
    }
    return { text, chips: null, pickerType: 'travelers', sourceUrls };
  }

  // Chips tag
  const chipsMatch = text.match(/\[CHIPS:\s*([^\]]+)\]/);
  if (chipsMatch) {
    chips = chipsMatch[1].split('|').map(s => s.trim()).filter(Boolean);
    text  = text.replace(chipsMatch[0], '').trim();
  }

  // [SOURCES: url1 | url2]
  const sourcesMatch = text.match(/\[SOURCES:\s*([^\]]+)\]/);
  if (sourcesMatch) {
    sourceUrls = sourcesMatch[1].split('|').map(s => s.trim()).filter(s => s.startsWith('http'));
    text = text.replace(sourcesMatch[0], '').trim();
  }

  return { text, chips, pickerType: null, sourceUrls };
}

// ── Hotels API (SecretFlights) ────────────────────────────────────────

// Map a month label ("בקיץ", "בפסח", etc.) or numeric month to a checkin/checkout date range
function monthToDateRange(monthLabel) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based

  const SEASON_TO_MONTH = {
    'בקיץ': 7, 'קיץ': 7,
    'בפסח': 4, 'פסח': 4,
    'בסוכות': 10, 'סוכות': 10,
    'בחגים': 10,
    'בחנוכה': 12, 'חנוכה': 12,
    'חודש הבא': (month % 12) + 1,
    'גמיש': month + 1,
  };

  let targetMonth = SEASON_TO_MONTH[monthLabel] || parseInt(monthLabel, 10) || (month + 1);
  let targetYear  = year;
  if (targetMonth <= month) targetYear++; // already past — next year

  const checkin  = `${targetYear}-${String(targetMonth).padStart(2, '0')}-15`;
  const checkout = `${targetYear}-${String(targetMonth).padStart(2, '0')}-20`;
  return { checkin, checkout };
}

async function fetchHotelDeals(iata, monthLabel, adults = 2, checkinOverride = null, checkoutOverride = null) {
  if (!SF_HOTELS_NONCE) throw new Error('SF_HOTELS_NONCE not set in .env');

  const { checkin, checkout } = checkinOverride && checkoutOverride
    ? { checkin: checkinOverride, checkout: checkoutOverride }
    : monthToDateRange(monthLabel || 'חודש הבא');

  const qs = `destination=${iata}&checkin_date=${checkin}&checkout_date=${checkout}` +
    `&adults=${adults}&children=0&rooms=1` +
    `&star_rating=3%2C4%2C5&sort_by=price&free_cancellation=1`;

  // Step 1 — get searchId
  const step1Url = new URL(SF_HOTELS_URL);
  step1Url.searchParams.set('action', 'get_hotels_search_id');
  step1Url.searchParams.set('newQueryString', qs);
  step1Url.searchParams.set('nonce', SF_HOTELS_NONCE);

  const r1 = await httpsRequest({ hostname: step1Url.hostname, path: step1Url.pathname + step1Url.search, method: 'GET', headers: { Accept: 'application/json' } });
  const d1 = JSON.parse(r1.body);
  const searchId = d1?.data?.searchId;
  if (!searchId) throw new Error('Hotel search: no searchId returned');

  // Step 2 — poll up to 3 times
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const step2Url = new URL(SF_HOTELS_URL);
    step2Url.searchParams.set('action', 'get_hotels_search_results');
    step2Url.searchParams.set('searchId', searchId);
    step2Url.searchParams.set('newQueryString', 'limit=5&offset=0');
    step2Url.searchParams.set('nonce', SF_HOTELS_NONCE);

    const r2     = await httpsRequest({ hostname: step2Url.hostname, path: step2Url.pathname + step2Url.search, method: 'GET', headers: { Accept: 'application/json' } });
    const d2     = JSON.parse(r2.body);
    const hotels = d2?.data?.hotels || d2?.hotels || [];
    if (hotels.length) return hotels.slice(0, 5);
  }
  return [];
}

// ── Flights API ───────────────────────────────────────────────────────
async function fetchFlightDeals(params) {
  if (!SF_KEY) throw new Error('SECRETFLIGHTS_API_KEY not set in .env');

  const url = new URL(SF_BASE_URL);
  url.searchParams.set('key',      SF_KEY);
  url.searchParams.set('origin',   'TLV');
  url.searchParams.set('details',  'true');
  url.searchParams.set('cheapest', 'true');
  url.searchParams.set('limit',    '6');
  url.searchParams.set('offset',   '0');

  if (params.destination) url.searchParams.set('destination', params.destination);
  if (params.max_price)   url.searchParams.set('max_price',   params.max_price);
  if (params.min_days)    url.searchParams.set('min_days',    params.min_days);
  if (params.max_days)    url.searchParams.set('max_days',    params.max_days);
  if (params.direct)      url.searchParams.set('direct',      'true');
  if (params.month)       url.searchParams.set('month',       params.month);
  if (params.date_from)   url.searchParams.set('date_from',   params.date_from);
  if (params.date_to)     url.searchParams.set('date_to',     params.date_to);

  const result = await httpsRequest({
    hostname: url.hostname,
    port:     url.port || 443,
    path:     url.pathname + url.search,
    method:   'GET',
    headers:  { 'Accept': 'application/json' },
  });

  const logEntry = {
    ts:  new Date().toISOString(),
    url: url.toString().replace(SF_KEY, '[KEY]'),
    status: result.status,
    body:   result.body.substring(0, 400),
  };
  flightLogs.unshift(logEntry);
  if (flightLogs.length > 10) flightLogs.pop();

  console.log(`[Flights API] ${result.status} — ${logEntry.url}`);
  console.log(`[Flights API] Body: ${result.body.substring(0, 300)}`);

  if (result.status !== 200) throw new Error(`Flights API error: HTTP ${result.status}`);
  const data = JSON.parse(result.body);
  // API may return array directly or wrapped: { deals: [...] } / { data: [...] }
  return Array.isArray(data) ? data : (data.deals || data.data || data.results || []);
}

// ── SecretFlights booking redirect URL ────────────────────────────────
function buildSecretFlightsRedirectUrl(deal) {
  const dest     = deal.destination || deal.dest || '';
  const outDate  = deal.outbound_date  || deal.departure_date || deal.date_from || '';
  const inDate   = deal.inbound_date   || deal.return_date    || deal.date_to   || '';
  const price    = deal.price          || deal.min_price      || '';
  const dealKey  = deal.deal_key       || deal.key            || '';
  const airline  = deal.airline        || deal.carrier        || '';
  const direct   = deal.direct || deal.non_stop || false;
  const premium  = deal.price_premium  || '';

  const q = new URLSearchParams({ origin: 'TLV', destination: dest, cabinclass: 'economy', alert: 'false', campaign: 'HPcheapest' });
  if (outDate)       q.set('out_date',      outDate);
  if (inDate)        q.set('in_date',       inDate);
  if (price)         q.set('price',         price);
  if (premium)       q.set('price_premium', premium);
  if (dealKey)       q.set('deal_key',      dealKey);
  if (airline)       q.set('deal_airline',  airline);
  if (direct)        q.set('direct',        'true');
  if (SF_ASSOCIATE_ID) q.set('associateid', SF_ASSOCIATE_ID);

  return `https://fly.secretflights.co.il/redirect?${q}`;
}

// Convert YYYY-MM-DD to Skyscanner's YYMMDD format
function toSkyDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${y.slice(2)}${m}${d}`;
}

function buildSkyscannerUrl(destIata, outDate, inDate, adults = 1) {
  const from = 'tlv';
  const to   = (destIata || '').toLowerCase();
  let   p    = `/transport/flights/${from}/${to}/`;
  if (outDate) p += `${toSkyDate(outDate)}/`;
  if (inDate)  p += `${toSkyDate(inDate)}/`;

  const q = new URLSearchParams({ adultsv2: adults, currency: 'USD', locale: 'he-IL', market: 'IL', sortby: 'cheapest' });
  if (SKYSCANNER_AFF_ID) q.set('affilid', SKYSCANNER_AFF_ID);
  return `https://www.skyscanner.co.il${p}?${q}`;
}

function buildBookingUrl(destination, checkin, checkout, adults = 2, rooms = 1) {
  const q = new URLSearchParams({ ss: destination, lang: 'he', group_adults: adults, no_rooms: rooms });
  if (checkin)       q.set('checkin',  checkin);
  if (checkout)      q.set('checkout', checkout);
  if (BOOKING_AFF_ID) q.set('aid',    BOOKING_AFF_ID);
  return `https://www.booking.com/searchresults.html?${q}`;
}

function formatDealsForAI(deals) {
  if (!deals.length) return 'לא נמצאו דילים לפי הפרמטרים שביקשת. נסה לשנות את התקציב או את התאריכים.';

  let out = `נמצאו ${deals.length} דילים ✈️\n\n`;
  deals.forEach((deal, i) => {
    const dest    = deal.destination || deal.dest || '';
    const city    = deal.destination_city || deal.dest_name || deal.city || deal.destination_name || dest;
    const price   = deal.price || deal.min_price || deal.total_price || '?';
    const outDate = deal.outbound_date  || deal.departure_date || deal.date_from || '';
    const retDate = deal.inbound_date   || deal.return_date    || deal.date_to   || '';
    const airline = deal.airline_name   || deal.airline        || deal.carrier   || '';
    const direct  = deal.direct || deal.non_stop || false;
    const dealKey = deal.deal_key || deal.key || '';

    // Use SecretFlights redirect if we have the deal_key; fall back to Skyscanner
    const bookUrl = dealKey
      ? buildSecretFlightsRedirectUrl(deal)
      : buildSkyscannerUrl(dest, outDate, retDate, 1);

    out += `${i + 1}. **${city}**  |  כ-$${price} לאדם\n`;
    if (outDate) out += `   יציאה: ${outDate}`;
    if (retDate) out += `  →  חזרה: ${retDate}`;
    if (outDate || retDate) out += '\n';
    if (airline) out += `   ${direct ? '✈️ ישיר' : '🔄 עם עצירה'}  •  ${airline}\n`;
    const bookLabel = `להזמנה ✈️|city=${city}|out=${outDate}|in=${retDate}|price=${price}`;
    out += `   [${bookLabel}](${bookUrl})\n\n`;
  });
  return out;
}

// ── Call OpenAI ───────────────────────────────────────────────────────
async function callOpenAI(context, userMessage, history = [], locationHints = []) {
  if (!OPENAI_KEY || OPENAI_KEY === 'sk-...') throw new Error('OPENAI_API_KEY not set in .env');

  const systemPrompt = `אתה עוזר תיירות ידידותי של האתר. אתה עונה בעברית, בשפה חמה וטבעית.

כללים:
- לשאלות על תוכן האתר (אטרקציות, מדריכים, טיפים) — ענה על סמך ה-TRAVEL KNOWLEDGE BASE למטה, ברשימה ממוספרת:
    1. **שם המקום/הפעילות** — הסבר קצר (1-2 משפטים).
    (עד 5 פריטים)
- לשאלות על תוכן האתר — ענה על סמך ה-KNOWLEDGE BASE ברשימה ממוספרת עם שמות ב-**bold**.
- ענה רק על סמך ה-KNOWLEDGE BASE. אם התשובה אינה שם — אמור בנעימות שאין לך מידע על כך.
- אל תערבב נושאים: שאלה על מלון → ענה על מלון בלבד. שאלה על טיסה → ענה על טיסה בלבד.
- אל תמציא מידע שאינו ב-KNOWLEDGE BASE.
- לשאלות מידע על טיסות/מלונות (מתי לטוס, כמה עולה, מה הזמן הטוב וכו') — ענה מה-KNOWLEDGE BASE, אל תפעיל כלי חיפוש.
- אל תענה על שאלות שאינן קשורות לתיירות.
- שאל שאלה אחת בכל פעם — אל תציף את המשתמש.
- לברכות או שיחה — ענה בחביבות בלי רשימה.
- בסוף תשובה המבוססת על מאמרים — הוסף תגית מקורות בשורה נפרדת (אחרי כל תגית אחרת):
  [SOURCES: https://url1.com | https://url2.com]
  כלול רק כתובות URL שמופיעות ב-KNOWLEDGE BASE. אל תמציא כתובות.
- אחרי תשובה על שאלת טיסה — חובה להוסיף: [CHIPS: ✈️ מצא לי טיסה עכשיו]
- אחרי תשובה על שאלת מלון — חובה להוסיף: [CHIPS: 🏨 מצא לי מלון עכשיו]
⚡ INTERACTIVE UI — חובה לכלול בכל שאלה שדורשת קלט:

• שאלת יעד/עיר/אזור:
  [CHIPS: עיר1 | עיר2 | עיר3]
  השתמש אך ורק בערים מהרשימה: ${locationHints.length ? locationHints.join(', ') : 'מהKNOWLEDGE BASE'}

• שאלת מספר נוסעים (תמיד כלול ילדים):
  [PICKER: travelers]
  דוגמה: "לכמה נוסעים? [PICKER: travelers]"

• שאלת סוג טיול:
  [CHIPS: חופשת חוף | סיטי טריפ | הרפתקה | זוגי | משפחה]

• שאלת סוג אטרקציות (שאל לפני שממליץ):
  [CHIPS: 🤿 אקסטרים | 👨‍👩‍👧 משפחתי | 🏛️ תרבות | 🍽️ אוכל | 🌿 טבע | 🎉 לילה]

אסור לשכוח את התג — הוא מציג כפתורים אינטראקטיביים. אל תוסיף לתשובות רגילות.

${context}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const payload = JSON.stringify({ model: OPENAI_MODEL, max_tokens: 500, messages });
  const result  = await httpsRequest({
    hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
    headers: {
      'Authorization':  `Bearer ${OPENAI_KEY}`,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  const data = JSON.parse(result.body);
  if (result.status !== 200) throw new Error(data?.error?.message || `OpenAI error ${result.status}`);
  if (data.usage) {
    usageStats.promptTokens     += data.usage.prompt_tokens     || 0;
    usageStats.completionTokens += data.usage.completion_tokens || 0;
    usageStats.totalTokens      += data.usage.total_tokens      || 0;
    usageStats.requests++;
  }

  const { text, chips, pickerType, sourceUrls } = extractChips(data.choices[0].message.content || '');
  return { reply: text, chips, pickerType, sourceUrls };
}

// ── Cost estimate (gpt-4o pricing) ────────────────────────────────────
function estimatedCostUsd() {
  return ((usageStats.promptTokens * 2.5 + usageStats.completionTokens * 10) / 1_000_000).toFixed(4);
}

// ── Status check ─────────────────────────────────────────────────────
async function handleStatus(_req, res) {
  const result = { wordpress: {}, openai: {}, config: {} };

  // Config summary (never expose full keys)
  result.config = {
    wp_url:       WP_URL       || null,
    wp_user:      WP_USER      || null,
    wp_tag_ids:   WP_TAG_IDS   || 'none (all posts)',
    wp_max_posts: WP_MAX_POSTS,
    openai_model: OPENAI_MODEL,
    openai_key_set:     !!(OPENAI_KEY && OPENAI_KEY !== 'sk-...'),
    openai_key_preview: OPENAI_KEY ? OPENAI_KEY.slice(0, 8) + '...' + OPENAI_KEY.slice(-4) : null,
    sf_key_set:         !!SF_KEY,
    skyscanner_aff_set: !!(SKYSCANNER_AFF_ID && SKYSCANNER_AFF_ID !== 'your-skyscanner-affiliate-id'),
    booking_aff_set:    !!(BOOKING_AFF_ID    && BOOKING_AFF_ID    !== 'your-booking-affiliate-id'),
  };

  // Check WordPress (uses cache if fresh)
  try {
    const posts = await getCachedPosts();
    result.wordpress = {
      ok: true,
      post_count: posts.length,
      site: WP_URL,
      posts: posts.map(p => ({ title: p.title, url: p.url, content: p.content })),
    };
  } catch (err) {
    result.wordpress = { ok: false, error: err.message };
  }

  // Check OpenAI — minimal ping (1 token, cheapest possible)
  try {
    if (!OPENAI_KEY || OPENAI_KEY === 'sk-...') throw new Error('API key not set in .env');
    const payload = JSON.stringify({
      model: OPENAI_MODEL, max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const r = await httpsRequest({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload);
    const data = JSON.parse(r.body);
    if (r.status !== 200) throw new Error(data?.error?.message || `HTTP ${r.status}`);
    result.openai = { ok: true, model: OPENAI_MODEL };
  } catch (err) {
    result.openai = { ok: false, error: err.message };
  }

  // SecretFlights — only verify key is configured, don't make a live API call
  result.flights = SF_KEY
    ? { ok: true, message: 'מפתח API מוגדר — בדוק מהצ\'אט', deal_count: null }
    : { ok: false, error: 'SECRETFLIGHTS_API_KEY לא הוגדר ב-.env' };

  result.usage = {
    requests:         usageStats.requests,
    promptTokens:     usageStats.promptTokens,
    completionTokens: usageStats.completionTokens,
    totalTokens:      usageStats.totalTokens,
    estimatedCostUsd: estimatedCostUsd(),
  };

  result.flightLogs = flightLogs;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

// ── /config endpoint ──────────────────────────────────────────────────
async function handleConfig(_req, res) {
  const { destination: dest, iata } = await getSiteConfig();
  const quickReplies = dest ? [
    { label: `✈️ טיסה ל${dest}`, message: `אני מחפש טיסה ל${dest}` },
    { label: `🏨 מלון ב${dest}`,  message: `אני מחפש מלון ב${dest}`  },
    { label: '📍 אטרקציות',        message: `מה מומלץ לראות ב${dest}?` },
  ] : [
    { label: '📍 אטרקציות', message: 'מה מומלץ לראות?' },
    { label: '✈️ טיסות',   message: 'אני מחפש טיסה'   },
    { label: '🏨 מלונות',  message: 'אני מחפש מלון'   },
  ];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ siteName: SITE_NAME, destination: dest, iata, quickReplies }));
}

// ── Chat handler ──────────────────────────────────────────────────────
async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message, history: rawHistory } = JSON.parse(body);
      if (!message || !message.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'message is required' }));
      }

      const userMessage = message.trim().substring(0, 500);

      // Validate history
      const history = Array.isArray(rawHistory)
        ? rawHistory.slice(-6)
            .filter(i => i && typeof i === 'object' &&
              (i.role === 'user' || i.role === 'assistant') &&
              typeof i.content === 'string')
            .map(i => ({ role: i.role, content: i.content.substring(0, 500) }))
        : [];

      // ── Booking flow (no AI call) ──
      const step                              = detectFlowStep(userMessage, history);
      const collected                         = parseCollectedData([...history, { role: 'user', content: userMessage }]);
      const { destination: siteDest, iata: siteIata, locationHints } = await getSiteConfig();

      // Inject site destination into collected data when user hasn't specified one
      if (!collected.destination && siteDest) { collected.destination = siteDest; collected.iata = siteIata; }

      if (step !== 'content') {
        const flowResp = await buildFlowResponse(step, collected, locationHints);
        if (flowResp) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, ...flowResp }));
        }
      }

      // ── AI path — check cache first ──
      const cacheKey = hashRequest(userMessage, history.length);
      const cached   = aiCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < AI_CACHE_TTL) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, reply: cached.reply, suggestions: cached.suggestions, suggestionType: cached.suggestionType, sources: cached.sources || [] }));
      }

      const posts                                        = await getCachedPosts();
      const context                                      = buildContext(posts);
      const { reply, chips, pickerType, sourceUrls = [] } = await callOpenAI(context, userMessage, history, locationHints);
      const topic                                        = detectTopic(userMessage);
      const suggestions                                  = chips && chips.length ? chips : getSuggestions(topic);
      const suggestionType                               = pickerType === 'travelers' ? 'traveler_picker' : 'chips';

      // Resolve source URLs to { title, url } using the posts cache
      const sources = sourceUrls
        .map(url => {
          const post = posts.find(p => {
            try { return new URL(p.url).pathname === new URL(url).pathname; } catch { return p.url === url; }
          });
          return { title: post ? post.title : url, url };
        })
        .filter((s, i, arr) => arr.findIndex(x => x.url === s.url) === i)
        .slice(0, 5);

      // Store in cache
      if (aiCache.size >= 100) aiCache.delete(aiCache.keys().next().value);
      aiCache.set(cacheKey, { reply, suggestions, suggestionType, sources, ts: Date.now() });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, reply, suggestions, suggestionType, sources }));
    } catch (err) {
      console.error('[Chat error]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
}

function serveStatic(req, res) {
  // Strip query string from URL
  const urlPath  = req.url.split('?')[0];
  const reqPath  = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.resolve(__dirname, reqPath);

  // Prevent directory traversal
  if (!filePath.startsWith(path.resolve(__dirname))) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error('[Static]', filePath, err.code);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end(`File not found: ${reqPath}`);
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// ── Server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  console.log(`[${req.method}] ${req.url}`);
  if (req.method === 'POST' && req.url === '/api-proxy.php') {
    handleChat(req, res);
  } else if (req.method === 'GET' && req.url === '/status') {
    handleStatus(req, res);
  } else if (req.method === 'GET' && req.url === '/config') {
    handleConfig(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. Stop the other process or change PORT in server.js\n`);
  } else {
    console.error('\n❌ Server error:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✈️  Travel Chatbot running at http://127.0.0.1:${PORT}`);
  console.log(`   WordPress: ${WP_URL || '(not set)'}`);
  console.log(`   OpenAI model: ${OPENAI_MODEL}`);
  console.log('   Press Ctrl+C to stop\n');
});
