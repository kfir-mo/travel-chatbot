/**
 * Travel Chatbot Widget — WordPress edition
 *
 * Config injected via wp_localize_script() as window.TravelChatbotConfig:
 *   ajaxUrl, nonce, title, subtitle, quickReplies[]
 *
 * All AI calls go through wp-admin/admin-ajax.php (server-side, key never in browser).
 * Conversation history is NOT persisted between page loads (no localStorage cache).
 * AI response caching is handled server-side via WP transients.
 */

(function () {
  'use strict';

  /* ─── Config resolution ─────────────────────────────────────── */
  const cfg = window.TravelChatbotConfig || {};

  const getConfig = () => ({
    ajaxUrl:  cfg.ajaxUrl  || '/wp-admin/admin-ajax.php',
    nonce:    cfg.nonce    || '',
    title:    cfg.title    || 'עוזר הנסיעות',
    subtitle: cfg.subtitle || 'שאל/י אותי על יעדים וטיפים לנסיעה',
  });

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

  // Round-robin indices — one per category, persists across refreshes within the session
  const poolIdx = { flights: 0, hotels: 0, cars: 0, inspire: 0 };

  /* ─── WP AJAX call ──────────────────────────────────────────── */
  async function callWordPressAjax(userMessage, history) {
    const config = getConfig();
    const body   = new URLSearchParams({
      action:  'travel_chatbot_query',
      nonce:   config.nonce,
      message: userMessage,
      history: JSON.stringify((history || []).slice(-6)),
    });

    const response = await fetch(config.ajaxUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!response.ok) throw new Error(`שגיאת שרת ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.data?.message || 'שגיאה לא ידועה');

    const d = data.data || {};
    return {
      reply:          d.reply           || '',
      suggestions:    d.suggestions     || [],
      suggestionType: d.suggestion_type || 'chips',
      deals:          d.deals           || null,
      sources:        d.sources         || [],
    };
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

  /* ─── Build DOM ─────────────────────────────────────────────── */
  function buildWidget() {
    const config = getConfig();

    /* -- Backdrop -- */
    const backdrop = el('div', { id: 'tc-backdrop', onClick: closePopup });

    /* -- Launcher -- */
    const iconChat  = svgIcon(ICONS.chat);  iconChat.setAttribute('class',  'tc-icon-chat');
    const iconClose = svgIcon(ICONS.close); iconClose.setAttribute('class', 'tc-icon-close');
    iconClose.style.cssText = 'fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;';
    const dot = el('span', { className: 'tc-dot' });
    const launcher = el('button', {
      id: 'tc-launcher',
      'aria-label':    'פתח צ\'אט נסיעות',
      'aria-haspopup': 'dialog',
      onClick: togglePopup,
    }, iconChat, iconClose, dot);

    /* -- Header -- */
    const avatar     = el('div', { className: 'tc-avatar' }, svgIcon(ICONS.plane));
    const headerText = el('div', { className: 'tc-header-text' });
    const titleEl    = el('div', { className: 'tc-title' }, config.title);
    const subtitleEl = el('div', { className: 'tc-subtitle' });
    subtitleEl.innerHTML = `<span class="tc-status-dot"></span>${config.subtitle}`;
    headerText.append(titleEl, subtitleEl);

    const closeBtn = el('button', {
      id: 'tc-close',
      'aria-label': 'סגור',
      onClick: closePopup,
    }, svgIcon(ICONS.close));

    const resetBtn = el('button', {
      id: 'tc-reset',
      'aria-label': 'אפס שיחה',
      title: 'אפס שיחה',
      onClick: resetConversation,
    });
    resetBtn.innerHTML = '↺';

    const header = el('div', { id: 'tc-header' }, closeBtn, resetBtn, headerText, avatar);

    /* -- Welcome screen -- */
    const welcomeEl = buildWelcomeScreen(config);

    /* -- Conversation messages (hidden until first message) -- */
    const messages = el('div', {
      id: 'tc-messages',
      className: 'tc-hidden',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'הודעות צ\'אט',
    });

    /* -- Quick replies -- */
    const qrArea = el('div', { id: 'tc-qr-area' });

    /* -- Input -- */
    const input = el('textarea', {
      id: 'tc-input',
      placeholder: 'שאל/י אותי על הטיול...',
      rows: '1',
      'aria-label': 'הקלד/י הודעה',
      onKeydown: handleKeydown,
      onInput: autoResize,
    });

    const sendBtn = el('button', {
      id: 'tc-send',
      'aria-label': 'שלח',
      onClick: handleSend,
    }, svgIcon(ICONS.send));

    const inputArea = el('div', { id: 'tc-input-area' }, input, sendBtn);

    /* -- Panel -- */
    const popup = el('div', {
      id: 'tc-popup',
      role: 'dialog',
      dir: 'rtl',
      'aria-modal': 'true',
      'aria-label': `${config.title} — חלון שיחה`,
    }, header, welcomeEl, messages, qrArea, inputArea);

    document.body.append(backdrop, launcher, popup);
    return { backdrop, launcher, popup, welcomeEl, messages, input, sendBtn, qrArea };
  }

  /* ─── Welcome screen builder ────────────────────────────────── */
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

  /* ─── Populate welcome grid from rotating pool ───────────────── */
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

  /* ─── Switch from welcome screen to conversation ────────────── */
  function showConversation() {
    const { welcomeEl, messages } = widgetEls;
    if (!welcomeEl.classList.contains('tc-hidden')) {
      welcomeEl.classList.add('tc-hidden');
      messages.classList.remove('tc-hidden');
    }
  }

  /* ─── Safe markdown renderer ────────────────────────────────── */
  function renderMarkdown(text) {
    let s = text
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');

    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      (_, lbl, url) =>
        `<a href="${url}" class="tc-citation">${lbl}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g,     '<em>$1</em>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  /* ─── Message rendering ─────────────────────────────────────── */
  function appendMessage(role, text) {
    const { messages } = widgetEls;
    const msgAvatar = el('div', { className: 'tc-msg-avatar' }, role === 'bot' ? '✈️' : '👤');
    const bubble    = el('div', { className: 'tc-bubble' });

    if (role === 'bot') bubble.innerHTML = renderMarkdown(text);
    else                bubble.textContent = text;

    const msg = el('div', { className: `tc-msg tc-${role}` }, msgAvatar, bubble);
    messages.append(msg);
    scrollToBottom();
    return msg;
  }

  function showLoadingIndicator() {
    const { messages } = widgetEls;
    const msgAvatar = el('div', { className: 'tc-msg-avatar' }, '✈️');
    const dots   = el('div', { className: 'tc-dots' }, el('span'), el('span'), el('span'));
    const bubble = el('div', { className: 'tc-bubble' }, dots);
    const msg    = el('div', { className: 'tc-msg tc-bot tc-loading' }, msgAvatar, bubble);
    messages.append(msg);
    scrollToBottom();
    return msg;
  }

  function scrollToBottom() {
    widgetEls.messages.scrollTop = widgetEls.messages.scrollHeight;
  }

  /* ─── Suggestions (chips / traveler picker) ─────────────────── */
  function showSuggestions(suggestions, suggestionType) {
    if (suggestionType === 'traveler_picker') {
      appendTravelerPicker();
    } else if (suggestions && suggestions.length) {
      appendQuickReplies(suggestions.map(s => ({ label: s, message: s })));
    }
  }

  function appendQuickReplies(buttons) {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';
    buttons.forEach(btn => {
      const b = el('button', { className: 'tc-qr-btn' });
      b.textContent = btn.label;
      b.addEventListener('click', () => {
        qrArea.innerHTML = '';
        triggerMessage(btn.message);
      });
      qrArea.appendChild(b);
    });
  }

  function appendTravelerPicker() {
    const { qrArea } = widgetEls;
    qrArea.innerHTML = '';
    let adults = 2, children = 0;

    function makeRow(label, sublabel, getVal, setVal, min) {
      const row       = document.createElement('div');
      row.className   = 'tc-tp-row';
      const labelWrap = document.createElement('div');
      const lEl       = document.createElement('div');
      lEl.className   = 'tc-tp-label';
      lEl.textContent = label;
      labelWrap.appendChild(lEl);
      if (sublabel) {
        const sub       = document.createElement('div');
        sub.className   = 'tc-tp-sublabel';
        sub.textContent = sublabel;
        labelWrap.appendChild(sub);
      }
      const stepper     = document.createElement('div');
      stepper.className = 'tc-tp-stepper';
      const minus       = document.createElement('button');
      minus.textContent = '−'; minus.type = 'button';
      const countEl     = document.createElement('span');
      countEl.className   = 'tc-tp-count';
      countEl.textContent = getVal();
      const plus        = document.createElement('button');
      plus.textContent  = '+'; plus.type = 'button';
      minus.disabled    = getVal() <= min;
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

    const adultsRow   = makeRow('מבוגרים', '18 ומעלה',    () => adults,   v => { adults   = v; }, 1);
    const childrenRow = makeRow('ילדים',   'גיל 0 עד 17', () => children, v => { children = v; }, 0);

    const confirmBtn       = document.createElement('button');
    confirmBtn.className   = 'tc-tp-confirm';
    confirmBtn.type        = 'button';
    confirmBtn.textContent = 'אישור ✓';
    confirmBtn.addEventListener('click', () => {
      qrArea.innerHTML = '';
      const childStr = children === 0 ? 'ללא ילדים'
                     : children === 1 ? 'ילד אחד'
                     : `${children} ילדים`;
      triggerMessage(`${adults} מבוגרים, ${childStr}`);
    });

    const picker = document.createElement('div');
    picker.id = 'tc-traveler-picker';
    picker.append(adultsRow, childrenRow, confirmBtn);
    qrArea.appendChild(picker);
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
    messages.scrollTop = messages.scrollHeight;
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
    messages.scrollTop = messages.scrollHeight;
  }

  /* ─── Reset ─────────────────────────────────────────────────── */
  function resetConversation() {
    const { welcomeEl, messages, qrArea } = widgetEls;
    messages.innerHTML  = '';
    qrArea.innerHTML    = '';
    conversationHistory = [];
    messages.classList.add('tc-hidden');
    welcomeEl.classList.remove('tc-hidden');
    populateWelcomeGrid(welcomeEl._grid);
  }

  /* ─── Send / trigger ────────────────────────────────────────── */
  async function triggerMessage(text) {
    if (isLoading) return;
    showConversation();
    const { sendBtn } = widgetEls;
    appendMessage('user', text);
    isLoading        = true;
    sendBtn.disabled = true;
    const loadingMsg = showLoadingIndicator();
    try {
      const minWait = new Promise(r => setTimeout(r, 1500));
      const [{ reply, suggestions, suggestionType, deals, sources }] = await Promise.all([callWordPressAjax(text, conversationHistory), minWait]);
      loadingMsg.remove();
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: reply });
      appendMessage('bot', reply);
      if (deals && deals.length) appendFlightDealCards(deals);
      if (sources && sources.length) appendSourcesTag(sources);
      showSuggestions(suggestions, suggestionType === 'flight_cards' ? 'chips' : suggestionType);
    } catch (err) {
      loadingMsg.remove();
      appendMessage('bot', `⚠️ ${err.message}`);
    } finally {
      isLoading        = false;
      sendBtn.disabled = false;
      widgetEls.input.focus();
    }
  }

  async function handleSend() {
    if (isLoading) return;
    const { input, sendBtn } = widgetEls;
    const text = input.value.trim();
    if (!text) return;
    input.value        = '';
    input.style.height = '';
    showConversation();
    appendMessage('user', text);
    isLoading        = true;
    sendBtn.disabled = true;
    const loadingMsg = showLoadingIndicator();
    try {
      const minWait = new Promise(r => setTimeout(r, 1500));
      const [{ reply, suggestions, suggestionType, deals, sources }] = await Promise.all([callWordPressAjax(text, conversationHistory), minWait]);
      loadingMsg.remove();
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: reply });
      appendMessage('bot', reply);
      if (deals && deals.length) appendFlightDealCards(deals);
      if (sources && sources.length) appendSourcesTag(sources);
      showSuggestions(suggestions, suggestionType === 'flight_cards' ? 'chips' : suggestionType);
    } catch (err) {
      loadingMsg.remove();
      appendMessage('bot', `⚠️ ${err.message}`);
    } finally {
      isLoading        = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function autoResize() {
    const { input } = widgetEls;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  /* ─── Init ──────────────────────────────────────────────────── */
  function mountWidget() {
    if (document.getElementById('tc-launcher')) return;
    widgetEls = buildWidget();

    // Fetch site name from config endpoint
    const ajaxUrl = getConfig().ajaxUrl;
    fetch(`${ajaxUrl}?action=travel_chatbot_config`)
      .then(r => r.json())
      .then(data => {
        if (data.siteName) {
          cfg.title = data.siteName;
          const titleNode = document.querySelector('#tc-header .tc-title');
          if (titleNode) titleNode.textContent = data.siteName;
        }
        // Welcome title uses Hebrew destination when available, falls back to site name
        const destName = data.destination || data.siteName;
        if (destName) {
          const wTitle = document.querySelector('.tc-welcome-title');
          if (wTitle) wTitle.textContent = `בואו נתחיל עם ${destName}!`;
        }
      })
      .catch(() => {})
      .finally(() => {
        // Always start fresh — no conversation history restored
        populateWelcomeGrid(widgetEls.welcomeEl._grid);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWidget);
  } else {
    mountWidget();
  }

})();
