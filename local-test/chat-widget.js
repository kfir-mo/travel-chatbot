/**
 * Travel Chatbot Widget
 *
 * Works in two modes:
 *  - "local"  : calls AI API directly from browser (dev/test only — exposes key in network tab)
 *  - "proxy"  : POSTs to api-proxy.php which hides the key server-side (recommended)
 *
 * Config is injected via window.TravelChatbotConfig before this script loads.
 * In WordPress the equivalent is wp_localize_script().
 */

(function () {
  'use strict';

  /* ─── Config resolution ─────────────────────────────────────── */
  const cfg = window.TravelChatbotConfig || {};

  const getConfig = () => ({
    provider:       cfg.provider       || localStorage.getItem('tc_provider')   || 'claude',
    apiKey:         cfg.apiKey         || localStorage.getItem('tc_api_key')    || '',
    model:          cfg.model          || localStorage.getItem('tc_model')       || '',
    proxyUrl:       cfg.proxyUrl       || null,           // if set, use proxy instead of direct
    title:          cfg.title          || 'Travel Assistant',
    subtitle:       cfg.subtitle       || 'Ask me about our travel guides',
    welcomeMessage: cfg.welcomeMessage || "Hi! I'm your travel guide. Ask me anything about the destinations and tips in our articles.",
    posts:          cfg.posts          || [],             // array of {title, content, url}
    maxTokens:      cfg.maxTokens      || 1024,
    quickReplies:   cfg.quickReplies   || [],
  });

  /* ─── Context builder ───────────────────────────────────────── */
  function buildContext(posts) {
    if (!posts || posts.length === 0) {
      return 'No travel articles are available as a knowledge base.';
    }

    const MAX_CHARS_PER_POST = 1500;
    let ctx = 'TRAVEL KNOWLEDGE BASE\n=====================\n\n';

    posts.forEach((post, i) => {
      const content = (post.content || post.excerpt || '').substring(0, MAX_CHARS_PER_POST);
      ctx += `[Article ${i + 1}: ${post.title}]\n`;
      if (post.url) ctx += `URL: ${post.url}\n`;
      ctx += `Content: ${content}\n\n`;
    });

    return ctx;
  }

  function buildSystemPrompt(context) {
    return `You are a helpful travel assistant for this website. Your job is to answer visitors' questions about travel destinations, tips, and guides.

IMPORTANT RULES:
- Answer ONLY based on the travel articles provided in the TRAVEL KNOWLEDGE BASE below.
- If the answer cannot be found in the articles, respond with: "I don't have information about that in our travel guides. Feel free to browse our articles for more details!"
- Do not use any outside knowledge beyond what is provided.
- Keep answers friendly, concise, and helpful.
- When relevant, mention which article your answer comes from.
- Do not answer questions unrelated to travel.

${context}`;
  }

  /* ─── API callers ───────────────────────────────────────────── */
  async function callClaude({ apiKey, model, systemPrompt, userMessage, maxTokens }) {
    const effectiveModel = model || 'claude-sonnet-4-6';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        // Required for browser-side CORS calls to Anthropic:
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      effectiveModel,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${response.status}`);
    }

    const data = await response.json();
    return data?.content?.[0]?.text || '';
  }

  async function callOpenAI({ apiKey, model, systemPrompt, userMessage, maxTokens }) {
    const effectiveModel = model || 'gpt-4o';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:      effectiveModel,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${response.status}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  async function callViaProxy({ proxyUrl, userMessage, history }) {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, history: history || [] }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error || `Proxy error ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Unknown proxy error');
    return {
      reply:          data.reply,
      suggestions:    data.suggestions || [],
      suggestionType: data.suggestionType || 'chips',
      deals:          data.deals   || null,
      sources:        data.sources || [],
    };
  }

  /* ─── Conversation history (localStorage) ───────────────────── */
  function loadHistory() {
    try {
      const raw = localStorage.getItem('tc_history');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-10) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem('tc_history', JSON.stringify(history.slice(-10)));
    } catch (e) { /* silent fail */ }
  }

  async function queryAI(userMessage, history) {
    const config = getConfig();

    if (config.proxyUrl) {
      return callViaProxy({ proxyUrl: config.proxyUrl, userMessage, history });
    }

    // Direct browser call (dev fallback — requires API key in config)
    if (!config.apiKey) throw new Error('No API key configured.');
    const context      = buildContext(config.posts);
    const systemPrompt = buildSystemPrompt(context);

    let reply;
    if (config.provider === 'openai') {
      reply = await callOpenAI({ apiKey: config.apiKey, model: config.model, systemPrompt, userMessage, maxTokens: config.maxTokens });
    } else {
      reply = await callClaude({ apiKey: config.apiKey, model: config.model, systemPrompt, userMessage, maxTokens: config.maxTokens });
    }
    return { reply, suggestions: [], suggestionType: 'chips', deals: null, sources: [] };
  }

  /* ─── DOM helpers ───────────────────────────────────────────── */
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach(child => {
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  };

  const svgIcon = (path, viewBox = '0 0 24 24') => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', viewBox);
    s.innerHTML = path;
    return s;
  };

  /* SVG paths */
  const ICONS = {
    chat:  '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    send:  '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>',
    plane: '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>',
  };

  /* ─── Widget state ──────────────────────────────────────────── */
  let isOpen              = false;
  let isLoading           = false;
  let widgetEls           = null;
  let conversationHistory = []; // in-memory only — cleared on reset, never persisted

  /* ─── Pre-made question pool (rotates on refresh) ───────────── */
  const QUESTION_POOL = {
    flights: [
      { label: '✈️ מה הדיל הכי זול לטיסה?',            message: 'מה הדיל הכי זול שיש עכשיו לטיסה?' },
      { label: '✈️ תמצא לי טיסה זולה',                  message: 'מצא לי טיסה זולה' },
      { label: '✈️ מתי כדאי לטוס?',                     message: 'מתי הזמן הכי טוב לטוס?' },
      { label: '✈️ כמה עולה טיסה?',                     message: 'כמה עולה טיסה ומה המחיר הממוצע?' },
      { label: '✈️ יש דילים לחגים?',                    message: 'יש דילים מיוחדים על טיסות לחגים?' },
    ],
    hotels: [
      { label: '🏨 מצא לי מלון בזול',                   message: 'מצא לי מלון בזול' },
      { label: '🏨 מה המלון הכי מומלץ?',                message: 'מה המלון הכי מומלץ ביעד?' },
      { label: '🏨 מלון על הים — יש?',                  message: 'יש מלונות על הים ביעד?' },
      { label: '🏨 מלון משפחתי עם בריכה',               message: 'מה המלון הכי טוב למשפחות עם בריכה?' },
      { label: '🏨 כמה עולה לילה במלון?',               message: 'כמה עולה לילה במלון ביעד?' },
    ],
    cars: [
      { label: 'האם צריך רישיון נהיגה בינלאומי?',      message: 'האם צריך רישיון נהיגה בינלאומי בנסיעה לחו"ל?' },
      { label: 'מה עדיף — רכב שכור או Uber?',          message: 'מה עדיף להשתמש ביעד — רכב שכור או שירותי הסעות כמו Uber?' },
      { label: 'מה לבדוק לפני השכרת רכב?',             message: 'על מה חשוב לשים לב לפני שחותמים על השכרת רכב?' },
      { label: 'האם ביטוח שכירות רכב חובה?',           message: 'איזה ביטוח לוקחים בהשכרת רכב בחו"ל?' },
      { label: 'כמה מראש כדאי להזמין רכב שכור?',       message: 'כמה זמן לפני החופשה כדאי להזמין רכב שכור?' },
    ],
    inspire: [
      { label: 'מה הדברים שחייבים לראות ביעד?',        message: 'מה האטרקציות הכי מומלצות לביקור?' },
      { label: 'מה מומלץ לאכול ביעד?',                 message: 'מה האוכל המקומי שחייבים לנסות?' },
      { label: 'כמה ימים מספיקים לחופשה?',             message: 'כמה ימים מומלץ לתכנן לחופשה?' },
      { label: 'מה צריך לדעת לפני הנסיעה?',            message: 'מה הדברים החשובים שצריך לדעת לפני שמגיעים?' },
      { label: 'מה מזג האוויר ביעד?',                  message: 'מה מזג האוויר ביעד ומה כדאי להביא?' },
    ],
  };
  const poolIdx = { flights: 0, hotels: 0, cars: 0, inspire: 0 };

  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function populateWelcomeGrid(grid) {
    grid.innerHTML = '';
    const categories = shuffleArray([
      { key: 'flights', catCls: 'flights', catLabel: '✈ טיסות'  },
      { key: 'hotels',  catCls: 'hotels',  catLabel: '⊕ מלונות' },
      { key: 'cars',    catCls: 'cars',    catLabel: '🚗 רכב'    },
      { key: 'inspire', catCls: 'inspire', catLabel: '✦ השראה'  },
    ]);
    categories.forEach(({ key, catCls, catLabel }) => {
      const pool = QUESTION_POOL[key];
      const qr   = pool[poolIdx[key] % pool.length];
      poolIdx[key]++;
      const card = el('div', { className: 'tc-suggestion-card', onClick: () => triggerMessage(qr.message) });
      const cat  = el('span', { className: `tc-card-category ${catCls}` }, catLabel);
      const text = el('p',    { className: 'tc-card-text' }, qr.label);
      card.append(cat, text);
      grid.append(card);
    });
  }

  /* ─── Build DOM ─────────────────────────────────────────────── */
  function buildWidget() {
    const config = getConfig();

    // ── Backdrop
    const backdrop = el('div', { id: 'tc-backdrop', onClick: closePopup });

    // ── Launcher button
    const iconChat  = svgIcon(ICONS.chat);  iconChat.setAttribute('class', 'tc-icon-chat');
    const iconClose = svgIcon(ICONS.close, '0 0 24 24'); iconClose.setAttribute('class', 'tc-icon-close');
    iconClose.style.cssText = 'fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;';
    const dot = el('span', { className: 'tc-dot' });

    const launcher = el('button', {
      id:          'tc-launcher',
      'aria-label': 'Open travel chat assistant',
      'aria-haspopup': 'dialog',
      onClick:     togglePopup,
    }, iconChat, iconClose, dot);

    // ── Header
    const avatar = el('div', { className: 'tc-avatar' }, svgIcon(ICONS.plane));

    const headerText = el('div', { className: 'tc-header-text' });
    const titleEl    = el('div', { className: 'tc-title' }, config.title);
    const subtitleEl = el('div', { className: 'tc-subtitle' });
    subtitleEl.innerHTML = `<span class="tc-status-dot"></span>${config.subtitle}`;
    headerText.append(titleEl, subtitleEl);

    const closeBtn = el('button', { id: 'tc-close', 'aria-label': "סגור צ'אט", onClick: closePopup });
    closeBtn.append(svgIcon(ICONS.close, '0 0 24 24'));

    const resetBtn = el('button', {
      id:           'tc-reset',
      'aria-label': 'אפס שיחה',
      title:        'אפס שיחה',
      onClick:      resetConversation,
    });
    resetBtn.innerHTML = '↺';

    const header = el('div', { id: 'tc-header' }, closeBtn, resetBtn, headerText, avatar);

    // ── Welcome screen
    const welcomeEl = buildWelcomeScreen(config);

    // ── Messages (hidden until conversation starts)
    const messages = el('div', {
      id:          'tc-messages',
      className:   'tc-hidden',
      role:        'log',
      'aria-live': 'polite',
      'aria-label': 'Chat messages',
    });

    // ── Quick replies
    const qrArea = el('div', { id: 'tc-qr-area' });

    // ── Input area
    const input = el('textarea', {
      id:          'tc-input',
      placeholder: 'שאל/י אותי על הטיול...',
      rows:        '1',
      'aria-label': 'הקלד/י הודעה',
      onKeydown:   handleKeydown,
      onInput:     autoResize,
    });

    const sendBtn = el('button', {
      id:          'tc-send',
      'aria-label': 'Send message',
      onClick:     handleSend,
    }, svgIcon(ICONS.send));

    const inputArea = el('div', { id: 'tc-input-area' }, input, sendBtn);

    // ── Panel
    const popup = el('div', {
      id:           'tc-popup',
      role:         'dialog',
      dir:          'rtl',
      'aria-modal': 'true',
      'aria-label': `${config.title} חלון שיחה`,
    }, header, welcomeEl, messages, qrArea, inputArea);

    document.body.append(backdrop, launcher, popup);
    return { backdrop, launcher, popup, welcomeEl, messages, input, sendBtn, qrArea };
  }

  const WELCOME_DESC = 'אני העוזר הנסיעות שלך! אוכל לעזור לך לתכנן טיול, להזמין טיסות, ולמצוא מלונות מושלמים ליעד החלומות שלך. כמובן שאפשר לשאול אותי כל שאלה הקשורה לנסיעות — ואם אין לך מה לשאול, פשוט בחר/י אחת מהשאלות המומלצות למטה.';

  function buildWelcomeScreen(config) {
    const wrap     = el('div', { id: 'tc-welcome' });
    const greeting = el('div', { className: 'tc-welcome-greeting' }, 'שלום! 👋');
    const title    = el('div', { className: 'tc-welcome-title' }, `בואו נתחיל עם ${config.title}!`);
    const desc     = el('div', { className: 'tc-welcome-desc' }, WELCOME_DESC);
    const grid     = el('div', { className: 'tc-suggestions-grid' });
    populateWelcomeGrid(grid);
    const refreshBtn = el('button', { className: 'tc-refresh-btn', onClick: () => populateWelcomeGrid(grid) });
    refreshBtn.innerHTML = '↻ רענן שאלות';
    const disclaimer = el('p', { className: 'tc-disclaimer' }, 'שאל/י אותי על הטיול הבא שלך');
    wrap.append(greeting, title, desc, grid, refreshBtn, disclaimer);
    wrap._grid = grid;
    return wrap;
  }

  /* ─── Toggle / open / close ─────────────────────────────────── */
  function togglePopup() { isOpen ? closePopup() : openPopup(); }

  function openPopup() {
    isOpen = true;
    const { backdrop, launcher, popup, input } = widgetEls;
    backdrop.classList.add('is-visible');
    launcher.classList.add('is-open');
    launcher.setAttribute('aria-expanded', 'true');
    popup.classList.add('is-visible');
    setTimeout(() => input.focus(), 80);
    launcher.querySelector('.tc-dot').classList.remove('visible');
  }

  function closePopup() {
    isOpen = false;
    const { backdrop, launcher, popup } = widgetEls;
    backdrop.classList.remove('is-visible');
    launcher.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    popup.classList.remove('is-visible');
    launcher.focus();
  }

  /* ─── Switch from welcome to conversation ────────────────────── */
  function showConversation() {
    const { welcomeEl, messages } = widgetEls;
    if (!welcomeEl.classList.contains('tc-hidden')) {
      welcomeEl.classList.add('tc-hidden');
      messages.classList.remove('tc-hidden');
    }
  }

  /* ─── Safe markdown renderer (bot messages only) ────────────── */
  function renderMarkdown(text) {
    // Escape raw HTML first to prevent XSS
    let s = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // [label](url) → <a> — only allow http/https URLs
    // Labels with |key=val metadata become booking buttons with data attributes
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, rawLabel, url) => {
      if (rawLabel.includes('|')) {
        const parts = rawLabel.split('|');
        const display = parts[0];
        const dataAttrs = parts.slice(1).map(part => {
          const [k, ...v] = part.split('=');
          return `data-${k.trim()}="${v.join('=').trim()}"`;
        }).join(' ');
        return `<a href="${url}" target="_blank" rel="noopener" class="tc-citation tc-book-btn" ${dataAttrs}>${display}</a>`;
      }
      return `<a href="${url}" class="tc-citation">${rawLabel}</a>`;
    });

    // **bold**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // *italic*
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // newlines → <br>
    s = s.replace(/\n/g, '<br>');

    return s;
  }

  /* ─── Message rendering ─────────────────────────────────────── */
  function appendMessage(role, text) {
    const { messages } = widgetEls;

    const avatarEmoji = role === 'bot' ? '✈️' : '👤';
    const msgAvatar   = el('div', { className: 'tc-msg-avatar' }, avatarEmoji);
    const bubble      = el('div', { className: 'tc-bubble' });

    if (role === 'bot') {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = text;
    }

    const msg = el('div', { className: `tc-msg tc-${role}` }, msgAvatar, bubble);
    messages.append(msg);
    scrollToBottom();
    return msg;
  }

  /* ─── Flight deal cards ─────────────────────────────────────── */
  function formatDisplayDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y.slice(2)}`;
  }

  function appendFlightDealCards(deals) {
    const { messages } = widgetEls;
    const container = el('div', { className: 'tc-flight-deals' });

    deals.forEach(deal => {
      const outFmt    = formatDisplayDate(deal.outDate);
      const retFmt    = formatDisplayDate(deal.retDate);
      const destCode  = deal.iata || '';
      const cityName  = deal.city || destCode;
      const cityLabel = destCode ? `${cityName} (${destCode})` : cityName;
      const priceStr  = `$${deal.price}`;
      const dateRange = outFmt && retFmt ? `${retFmt} — ${outFmt}` : (outFmt || '');

      const card = el('div', { className: 'tc-deal-card' });
      card.append(el('div', { className: 'tc-deal-img' }));

      const infoRow = el('div', { className: 'tc-deal-info-row' });
      infoRow.append(
        el('div', { className: 'tc-deal-price' }, priceStr),
        el('div', { className: 'tc-deal-city'  }, cityLabel),
      );

      const bookBtn = el('a', {
        href: deal.url,
        className: 'tc-deal-book-btn',
      }, 'למצוא את ההצעה');

      card.append(infoRow, el('div', { className: 'tc-deal-dates' }, dateRange), bookBtn);
      container.append(card);
    });

    messages.append(container);
    scrollToBottom();
  }

  function appendHotelDealCards(deals) {
    const { messages } = widgetEls;
    const container = el('div', { className: 'tc-flight-deals' });

    deals.forEach(deal => {
      const starsStr = '★'.repeat(Math.round(deal.stars || 0));
      const ratingStr = deal.rating ? `${deal.rating.toFixed(1)} ⭐` : '';
      const priceStr  = `$${deal.price}`;
      const nights    = deal.checkin && deal.checkout
        ? Math.round((new Date(deal.checkout) - new Date(deal.checkin)) / 86400000)
        : null;
      const nightsStr = nights ? `${nights} לילות` : '';
      const checkinFmt  = deal.checkin  ? formatDisplayDate(deal.checkin)  : '';
      const checkoutFmt = deal.checkout ? formatDisplayDate(deal.checkout) : '';
      const dateRange   = checkinFmt && checkoutFmt ? `${checkinFmt} — ${checkoutFmt}` : '';

      const card = el('div', { className: 'tc-deal-card' });

      // Hotel photo header (real image)
      if (deal.image) {
        const img = el('img', { className: 'tc-deal-img tc-hotel-photo', src: deal.image, alt: deal.name || '' });
        card.append(img);
      } else {
        card.append(el('div', { className: 'tc-deal-img tc-hotel-gradient' }));
      }

      // Name + stars row
      const nameRow = el('div', { className: 'tc-deal-info-row' });
      nameRow.append(
        el('div', { className: 'tc-hotel-name' }, deal.name || ''),
        el('div', { className: 'tc-hotel-stars' }, starsStr),
      );

      // Price + rating row
      const priceRow = el('div', { className: 'tc-deal-info-row' });
      priceRow.append(
        el('div', { className: 'tc-deal-price' }, priceStr),
        el('div', { className: 'tc-hotel-meta' }, [ratingStr, nightsStr].filter(Boolean).join(' · ')),
      );

      // Badges
      const badges = el('div', { className: 'tc-hotel-badges' });
      if (deal.freeCancellation) badges.append(el('span', { className: 'tc-deal-badge direct' }, 'ביטול חינם'));
      if (deal.breakfast)        badges.append(el('span', { className: 'tc-deal-badge direct' }, 'ארוחת בוקר'));

      // Dates
      const datesEl = el('div', { className: 'tc-deal-dates' }, dateRange);

      // Book button
      const bookBtn = el('a', { href: deal.url, className: 'tc-deal-book-btn' }, 'הזמן מלון');

      card.append(nameRow, priceRow, badges, datesEl, bookBtn);
      container.append(card);
    });

    messages.append(container);
    scrollToBottom();
  }

  /* ─── Source citations tag ──────────────────────────────────── */
  function appendSourcesTag(sources) {
    if (!sources || !sources.length) return;
    const { messages } = widgetEls;

    const wrap   = el('div', { className: 'tc-sources-wrap' });
    const toggle = el('button', { className: 'tc-sources-toggle' });
    toggle.innerHTML = `<span class="tc-sources-icon">📚</span> ${sources.length} מאמר${sources.length > 1 ? 'ים' : ''} בבסיס הידע`;

    const list = el('div', { className: 'tc-sources-list tc-sources-hidden' });
    sources.forEach(src => {
      list.append(el('a', {
        href: src.url,
        className: 'tc-source-item',
      }, src.title || src.url));
    });

    toggle.addEventListener('click', () => {
      list.classList.toggle('tc-sources-hidden');
      toggle.classList.toggle('tc-sources-open');
    });

    wrap.append(toggle, list);
    messages.append(wrap);
    scrollToBottom();
  }

  /* ─── Reset conversation ────────────────────────────────────── */
  function resetConversation() {
    const { welcomeEl, messages, qrArea } = widgetEls;
    messages.innerHTML    = '';
    qrArea.innerHTML      = '';
    conversationHistory   = [];
    messages.classList.add('tc-hidden');
    welcomeEl.classList.remove('tc-hidden');
    populateWelcomeGrid(welcomeEl._grid);
  }

  /* ─── Traveler picker ───────────────────────────────────────── */
  function appendTravelerPicker() {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';

    let adults = 2, children = 0;

    function makeRow(label, sublabel, getVal, setVal, min) {
      const row = document.createElement('div');
      row.className = 'tc-tp-row';

      const labelWrap = document.createElement('div');
      const labelEl = document.createElement('div');
      labelEl.className = 'tc-tp-label';
      labelEl.textContent = label;
      labelWrap.appendChild(labelEl);
      if (sublabel) {
        const sub = document.createElement('div');
        sub.className = 'tc-tp-sublabel';
        sub.textContent = sublabel;
        labelWrap.appendChild(sub);
      }

      const stepper = document.createElement('div');
      stepper.className = 'tc-tp-stepper';

      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.type = 'button';

      const countEl = document.createElement('span');
      countEl.className = 'tc-tp-count';
      countEl.textContent = getVal();

      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.type = 'button';

      minus.disabled = getVal() <= min;
      minus.addEventListener('click', () => {
        if (getVal() <= min) return;
        setVal(getVal() - 1);
        countEl.textContent = getVal();
        minus.disabled = getVal() <= min;
      });
      plus.addEventListener('click', () => {
        setVal(getVal() + 1);
        countEl.textContent = getVal();
        minus.disabled = false;
      });

      stepper.append(minus, countEl, plus);
      row.append(labelWrap, stepper);
      return row;
    }

    const adultsRow   = makeRow('מבוגרים', '18 ומעלה', () => adults,   v => { adults   = v; }, 1);
    const childrenRow = makeRow('ילדים',   'גיל 0 עד 17', () => children, v => { children = v; }, 0);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'tc-tp-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'אישור ✓';
    confirmBtn.addEventListener('click', () => {
      qrArea.innerHTML = '';
      const childStr = children === 0 ? 'ללא ילדים' : children === 1 ? 'ילד אחד' : `${children} ילדים`;
      triggerMessage(`${adults} מבוגרים, ${childStr}`);
    });

    const picker = document.createElement('div');
    picker.id = 'tc-traveler-picker';
    picker.append(adultsRow, childrenRow, confirmBtn);
    qrArea.appendChild(picker);
  }

  /* ─── Quick-reply buttons ───────────────────────────────────── */
  function appendQuickReplies(buttons) {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';

    buttons.forEach(btn => {
      const b = document.createElement('button');
      b.className = 'tc-qr-btn';
      b.textContent = btn.label;
      b.addEventListener('click', () => {
        qrArea.innerHTML = '';
        triggerMessage(btn.message);
      });
      qrArea.appendChild(b);
    });
  }

  /* ─── Budget slider ─────────────────────────────────────────── */
  function appendBudgetSlider() {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'tc-budget-slider';

    const topRow = document.createElement('div');
    topRow.className = 'tc-bs-top';

    const label = document.createElement('span');
    label.className = 'tc-bs-label';
    label.textContent = '💰 מחיר מקסימלי לאדם:';

    const valueEl = document.createElement('span');
    valueEl.className = 'tc-bs-value';
    valueEl.textContent = '$500';

    topRow.append(label, valueEl);

    const range = document.createElement('input');
    range.type = 'range';
    range.min = 50; range.max = 1500; range.step = 50; range.value = 500;
    range.className = 'tc-bs-range';
    range.addEventListener('input', () => { valueEl.textContent = `$${range.value}`; });

    const actions = document.createElement('div');
    actions.className = 'tc-bs-actions';

    const anyBtn = document.createElement('button');
    anyBtn.className = 'tc-qr-btn';
    anyBtn.textContent = 'ללא הגבלה';
    anyBtn.type = 'button';
    anyBtn.addEventListener('click', () => {
      qrArea.innerHTML = '';
      triggerMessage('ללא הגבלה');
    });

    const searchBtn = document.createElement('button');
    searchBtn.className = 'tc-tp-confirm';
    searchBtn.textContent = 'חפש';
    searchBtn.type = 'button';
    searchBtn.addEventListener('click', () => {
      qrArea.innerHTML = '';
      triggerMessage(`תקציב: $${range.value}`);
    });

    actions.append(anyBtn, searchBtn);
    wrapper.append(topRow, range, actions);
    qrArea.appendChild(wrapper);
  }

  /* ─── Date range picker (hotel) ────────────────────────────────── */
  function appendDatePicker() {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';

    let checkin = null, checkout = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start calendar at next month
    let calYear  = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
    let calMonth = (today.getMonth() + 1) % 12; // 0-based, next month

    const wrapper = document.createElement('div');
    wrapper.className = 'tc-datepicker';

    const nav = document.createElement('div');
    nav.className = 'tc-dp-nav';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '‹';
    prevBtn.className = 'tc-dp-nav-btn';

    const monthLabel = document.createElement('span');
    monthLabel.className = 'tc-dp-month-label';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '›';
    nextBtn.className = 'tc-dp-nav-btn';

    nav.append(nextBtn, monthLabel, prevBtn); // RTL: next on left visually = right in flex-row-reverse

    const grid = document.createElement('div');
    grid.className = 'tc-dp-grid';

    const hint = document.createElement('div');
    hint.className = 'tc-dp-hint';
    hint.textContent = 'בחרו תאריך הגעה';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'tc-tp-confirm';
    confirmBtn.textContent = 'אשר תאריכים ✓';
    confirmBtn.disabled = true;

    const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const DAYS_HE   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

    function fmt(d) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yy = d.getFullYear();
      return `${dd}.${mm}.${yy}`;
    }

    function renderGrid() {
      grid.innerHTML = '';
      monthLabel.textContent = `${MONTHS_HE[calMonth]} ${calYear}`;

      // Day headers
      DAYS_HE.forEach(d => {
        const h = document.createElement('div');
        h.className = 'tc-dp-dayname';
        h.textContent = d;
        grid.append(h);
      });

      const firstDay = new Date(calYear, calMonth, 1);
      const startPad = firstDay.getDay(); // 0=Sun
      for (let i = 0; i < startPad; i++) {
        grid.append(document.createElement('div'));
      }

      const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(calYear, calMonth, d);
        date.setHours(0,0,0,0);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.textContent = d;
        cell.className = 'tc-dp-day';

        if (date < today) {
          cell.disabled = true;
          cell.classList.add('tc-dp-past');
        } else {
          if (checkin && date.getTime() === checkin.getTime()) cell.classList.add('tc-dp-selected', 'tc-dp-start');
          if (checkout && date.getTime() === checkout.getTime()) cell.classList.add('tc-dp-selected', 'tc-dp-end');
          if (checkin && checkout && date > checkin && date < checkout) cell.classList.add('tc-dp-inrange');

          cell.addEventListener('click', () => {
            if (!checkin || (checkin && checkout)) {
              checkin = date; checkout = null;
              hint.textContent = 'בחרו תאריך עזיבה';
              confirmBtn.disabled = true;
            } else {
              if (date <= checkin) { checkin = date; checkout = null; hint.textContent = 'בחרו תאריך עזיבה'; confirmBtn.disabled = true; }
              else { checkout = date; hint.textContent = `${fmt(checkin)} — ${fmt(checkout)}`; confirmBtn.disabled = false; }
            }
            renderGrid();
          });
        }
        grid.append(cell);
      }
    }

    prevBtn.addEventListener('click', () => {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderGrid();
    });
    nextBtn.addEventListener('click', () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderGrid();
    });

    confirmBtn.addEventListener('click', () => {
      if (!checkin || !checkout) return;
      qrArea.innerHTML = '';
      triggerMessage(`תאריכים: ${fmt(checkin)} — ${fmt(checkout)}`);
    });

    renderGrid();
    wrapper.append(nav, grid, hint, confirmBtn);
    qrArea.appendChild(wrapper);
  }

  function showSuggestions(suggestions, suggestionType) {
    if (suggestionType === 'traveler_picker') {
      appendTravelerPicker();
    } else if (suggestionType === 'budget_slider') {
      appendBudgetSlider();
    } else if (suggestionType === 'date_picker') {
      appendDatePicker();
    } else if (suggestions && suggestions.length) {
      appendQuickReplies(suggestions.map(s => ({ label: s, message: s })));
    }
  }

  // Programmatically send a message (used by quick replies / welcome cards)
  async function triggerMessage(text) {
    const { input, sendBtn } = widgetEls;
    if (isLoading) return;
    showConversation();
    appendMessage('user', text);
    isLoading = true;
    sendBtn.disabled = true;
    const loadingMsg = showLoadingIndicator();
    try {
      const { reply, suggestions, suggestionType, deals, sources } = await queryAI(text, conversationHistory);
      loadingMsg.remove();
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: reply });
      appendMessage('bot', reply);
      if (deals && deals.length) {
        if (suggestionType === 'hotel_cards') appendHotelDealCards(deals);
        else appendFlightDealCards(deals);
      }
      if (sources && sources.length) appendSourcesTag(sources);
      const uiType = (suggestionType === 'flight_cards' || suggestionType === 'hotel_cards') ? 'chips' : suggestionType;
      showSuggestions(suggestions, uiType);
    } catch (err) {
      loadingMsg.remove();
      appendMessage('bot', `⚠️ ${err.message}`);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function showLoadingIndicator() {
    const { messages } = widgetEls;
    const msgAvatar = el('div', { className: 'tc-msg-avatar' }, '✈️');
    const dots = el('div', { className: 'tc-dots' },
      el('span'), el('span'), el('span')
    );
    const bubble = el('div', { className: 'tc-bubble' }, dots);
    const msg = el('div', { className: 'tc-msg tc-bot tc-loading' }, msgAvatar, bubble);
    messages.append(msg);
    scrollToBottom();
    return msg;
  }

  function scrollToBottom() {
    const { messages } = widgetEls;
    messages.scrollTop = messages.scrollHeight;
  }

  /* ─── Send logic ────────────────────────────────────────────── */
  async function handleSend() {
    if (isLoading) return;
    const { input, sendBtn } = widgetEls;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = '';
    showConversation();
    appendMessage('user', text);

    isLoading = true;
    sendBtn.disabled = true;

    const loadingMsg = showLoadingIndicator();

    try {
      const { reply, suggestions, suggestionType, deals, sources } = await queryAI(text, conversationHistory);
      loadingMsg.remove();
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: reply });
      appendMessage('bot', reply);
      if (deals && deals.length) {
        if (suggestionType === 'hotel_cards') appendHotelDealCards(deals);
        else appendFlightDealCards(deals);
      }
      if (sources && sources.length) appendSourcesTag(sources);
      const uiType = (suggestionType === 'flight_cards' || suggestionType === 'hotel_cards') ? 'chips' : suggestionType;
      showSuggestions(suggestions, uiType);
    } catch (err) {
      loadingMsg.remove();
      appendMessage('bot', `⚠️ ${err.message}`);
      console.error('[TravelChatbot]', err);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    const { input } = widgetEls;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  /* ─── Booking URL with passengers ──────────────────────────── */
  function buildBookingUrlWithPassengers(baseUrl, adults, children, infants) {
    try {
      const url = new URL(baseUrl);
      if (url.hostname.includes('secretflights')) {
        url.searchParams.set('adults',   adults);
        url.searchParams.set('children', children);
        url.searchParams.set('infants',  infants);
      } else if (url.hostname.includes('skyscanner')) {
        url.searchParams.set('adultsv2', adults);
        url.searchParams.delete('childrenv2');
        if (children > 0) url.searchParams.set('childrenv2', Array(children).fill(8).join(','));
        url.searchParams.set('infants',  infants);
        url.searchParams.set('currency', 'USD');
        url.searchParams.set('sortby',   'cheapest');
      }
      return url.toString();
    } catch (e) {
      return baseUrl;
    }
  }

  /* ─── Passenger picker modal ─────────────────────────────── */
  function showPassengerModal(bookUrl, dealData) {
    const existing = document.getElementById('tc-passenger-modal');
    if (existing) existing.remove();

    let adults = 1, children = 0, infants = 0;

    function fmtDate(iso) {
      if (!iso) return '';
      const [y, m, d] = iso.split('-');
      return `${d}.${m}.${y.slice(2)}`;
    }

    function makeRow(label, sublabel, getVal, setVal, min) {
      const row = document.createElement('div');
      row.className = 'tc-tp-row';
      const labelWrap = document.createElement('div');
      const labelEl = document.createElement('div');
      labelEl.className = 'tc-tp-label';
      labelEl.textContent = label;
      labelWrap.appendChild(labelEl);
      if (sublabel) {
        const sub = document.createElement('div');
        sub.className = 'tc-tp-sublabel';
        sub.textContent = sublabel;
        labelWrap.appendChild(sub);
      }
      const stepper = document.createElement('div');
      stepper.className = 'tc-tp-stepper';
      const minus = document.createElement('button');
      minus.textContent = '−'; minus.type = 'button';
      const countEl = document.createElement('span');
      countEl.className = 'tc-tp-count';
      countEl.textContent = getVal();
      const plus = document.createElement('button');
      plus.textContent = '+'; plus.type = 'button';
      minus.disabled = getVal() <= min;
      minus.addEventListener('click', () => {
        if (getVal() <= min) return;
        setVal(getVal() - 1);
        countEl.textContent = getVal();
        minus.disabled = getVal() <= min;
      });
      plus.addEventListener('click', () => {
        setVal(getVal() + 1);
        countEl.textContent = getVal();
        minus.disabled = false;
      });
      stepper.append(minus, countEl, plus);
      row.append(labelWrap, stepper);
      return row;
    }

    const overlay = document.createElement('div');
    overlay.id = 'tc-passenger-modal';

    const sheet = document.createElement('div');
    sheet.className = 'tc-pm-sheet';

    const avatar = document.createElement('div');
    avatar.className = 'tc-pm-avatar';
    avatar.textContent = '🌍';

    const heading = document.createElement('div');
    heading.className = 'tc-pm-heading';
    heading.textContent = `תל אביב ✈️ ${dealData.city || ''}`;

    const dates = document.createElement('div');
    dates.className = 'tc-pm-dates';
    const outFmt = fmtDate(dealData.out);
    const inFmt  = fmtDate(dealData.in);
    if (outFmt && inFmt) dates.textContent = `${outFmt} — ${inFmt}`;

    const sublabel = document.createElement('div');
    sublabel.className = 'tc-pm-sublabel';
    sublabel.textContent = 'נא לבחור את מספר הנוסעים';

    const card = document.createElement('div');
    card.className = 'tc-pm-card';
    card.append(
      makeRow('מבוגרים',    '18 ומעלה',    () => adults,   v => { adults   = v; }, 1),
      makeRow('ילדים 2-11', 'גיל 2 עד 11', () => children, v => { children = v; }, 0),
      makeRow('תינוקות',    'מתחת לגיל 2', () => infants,  v => { infants  = v; }, 0),
    );

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'tc-tp-confirm tc-pm-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'קדימה! ✈️';
    confirmBtn.addEventListener('click', () => {
      closeModal();
      window.open(buildBookingUrlWithPassengers(bookUrl, adults, children, infants), '_blank', 'noopener');
    });

    const note = document.createElement('p');
    note.className = 'tc-pm-note';
    note.textContent = 'מחיר הטיסה עלול להשתנות על פי הרכב הנוסעים';

    sheet.append(avatar, heading, dates, sublabel, card, confirmBtn, note);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('tc-pm-visible')));

    function closeModal() {
      overlay.classList.remove('tc-pm-visible');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
    });
  }

  /* ─── Init ──────────────────────────────────────────────────── */
  function mountWidget() {
    if (document.getElementById('tc-launcher')) return; // already mounted
    widgetEls = buildWidget();

    // Intercept booking link clicks → passenger modal
    widgetEls.messages.addEventListener('click', e => {
      const btn = e.target.closest('.tc-book-btn');
      if (!btn) return;
      e.preventDefault();
      showPassengerModal(btn.href, btn.dataset);
    });

    // Use Hebrew destination name in welcome title when available
    const destName = cfg.destination || cfg.title;
    if (destName) {
      const wTitle = document.querySelector('.tc-welcome-title');
      if (wTitle) wTitle.textContent = `בואו נתחיל עם ${destName}!`;
    }

    // Always start fresh — no conversation history restored
    populateWelcomeGrid(widgetEls.welcomeEl._grid);
  }

  function init() {
    // Wait for dynamic config fetch (if available), then mount
    const ready = window.TravelChatbotConfigReady || Promise.resolve();
    ready.finally(mountWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external re-init (e.g. after settings change in test harness)
  window.TravelChatbot = { reinit: () => { init(); } };
})();
