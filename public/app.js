// BhagamRef client — vanilla ES modules, no build step.
// All user-provided text is rendered through text nodes (see h()), never innerHTML.

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'autofocus') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
};
function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  // Static, trusted SVG markup only.
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const naturalCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  let res;
  try { res = await fetch(url, opts); } catch { const e = new Error('No connection'); e.offline = true; throw e; }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
const app = {
  user: undefined, // undefined = unknown, null = signed out
  rules: null,
  ruleIndex: new Map(),
  sess: null, // active competition session state
};

async function loadRules() {
  const data = await fetch('/rules.json').then(r => r.json());
  app.rules = data;
  for (const cat of data.categories) for (const r of cat.rules) app.ruleIndex.set(r.code, { ...r, cat: cat.id, catName: cat.name });
}
const ruleTitle = code => app.ruleIndex.get(code)?.title || '';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return route();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => { closeSheet(true); route(); });

const link = (href, attrs, ...children) => h('a', { href, 'data-link': true, ...attrs }, ...children);

function route() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  const m = p.match(/^\/s\/([A-Za-z0-9]+)(?:\/(matches|m|teams|t|log|info)(?:\/([^/]+))?)?$/);
  if (m) return showSession(m[1].toUpperCase(), m[2] || 'matches', m[3] ? decodeURIComponent(m[3]) : null);
  if (app.sess) leaveSessionView();
  const j = p.match(/^\/join(?:\/([A-Za-z0-9]+))?$/);
  if (j) return showJoin(j[1] ? j[1].toUpperCase() : '');
  if (p === '/login') return showAuth('login');
  if (p === '/register') return showAuth('register');
  if (p === '/new') return showNewSession();
  return showHome();
}

function setPage(...children) {
  const root = $('#app');
  root.replaceChildren(...children.flat());
  window.scrollTo(0, 0);
}

function topbar({ title, back, right } = {}) {
  return h('header', { class: 'topbar' },
    back ? link(back, { class: 'icon-btn', 'aria-label': 'Back' }, icon('back')) : link('/', { class: 'brand', 'aria-label': 'BhagamRef home' }, brandMark(), h('span', null, 'BhagamRef')),
    title ? h('div', { class: 'topbar-title' }, title) : h('div', { class: 'spacer' }),
    right || null);
}
function brandMark() {
  return h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, h('i', { class: 'r' }), h('i', { class: 'b' }));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function joinCodeForm() {
  const input = h('input', { class: 'input code-input', placeholder: 'ABC234', maxlength: 8, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Session code', inputmode: 'text' });
  input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  return h('form', { class: 'join-form', onsubmit: e => { e.preventDefault(); if (input.value.length >= 4) navigate(`/join/${input.value}`); else input.focus(); } },
    input, h('button', { class: 'btn primary', type: 'submit' }, 'Join'));
}

async function showHome() {
  if (app.user === undefined) await refreshMe();
  if (!app.user) {
    return setPage(
      topbar({ right: link('/login', { class: 'btn ghost sm' }, 'Sign in') }),
      h('main', { class: 'page narrow' },
        h('section', { class: 'hero' },
          h('h1', null, 'The anomaly log for V5RC referees.'),
          h('p', { class: 'lede' }, 'Log minor and major violations by match and team, pick rules straight from the Override game manual, and stay in sync with every ref on your crew.')),
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, 'Join a session'),
          h('p', { class: 'muted' }, 'Got a code from your head ref? Enter it to start reffing — no account needed.'),
          joinCodeForm()),
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, 'Run a session'),
          h('p', { class: 'muted' }, 'Create an account to start competition sessions, pick an event from events.vex.com, and keep a record of every day you ref.'),
          h('div', { class: 'row gap' }, link('/register', { class: 'btn primary' }, 'Create account'), link('/login', { class: 'btn' }, 'Sign in')))));
  }

  const listEl = h('div', { class: 'session-list' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  setPage(
    topbar({ right: h('button', { class: 'btn ghost sm', onclick: logout }, 'Sign out') }),
    h('main', { class: 'page narrow' },
      h('div', { class: 'page-head' },
        h('div', null, h('p', { class: 'eyebrow' }, `Signed in as ${app.user.displayName}`), h('h1', null, 'Competition sessions')),
        link('/new', { class: 'btn primary' }, icon('plus', 18), 'New session')),
      listEl,
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Join with a code'), joinCodeForm())));

  try {
    const { sessions } = await api('GET', '/api/sessions');
    if (!sessions.length) {
      listEl.replaceChildren(h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No sessions yet'),
        h('p', { class: 'muted' }, 'A session is one day of competition. Create one, share its code with your refs, and start logging.'),
        link('/new', { class: 'btn primary' }, 'Create your first session')));
      return;
    }
    listEl.replaceChildren(...sessions.map(s => link(`/s/${s.code}`, { class: 'session-card' + (s.archived ? ' archived' : '') },
      h('div', { class: 'session-card-main' },
        h('div', { class: 'session-card-name' }, s.name),
        h('div', { class: 'session-card-event' }, s.eventName),
        h('div', { class: 'session-card-meta' },
          h('span', null, fmtDate(s.date)),
          h('span', { class: 'dot-sep' }, `${s.violationCount} logged`),
          h('span', { class: 'dot-sep' }, `${s.participantCount} ${s.participantCount === 1 ? 'ref' : 'refs'}`),
          s.isOwner ? null : h('span', { class: 'dot-sep' }, 'Joined'),
          s.archived ? h('span', { class: 'dot-sep' }, 'Archived') : null)),
      h('div', { class: 'code-chip' }, s.code))));
  } catch (e) {
    listEl.replaceChildren(h('div', { class: 'error-box' }, e.message));
  }
}

async function refreshMe() {
  try { app.user = (await api('GET', '/api/me')).user; } catch { app.user = app.user ?? null; }
}
async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch {}
  app.user = null;
  navigate('/');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function showAuth(mode) {
  const isReg = mode === 'register';
  const next = new URLSearchParams(location.search).get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const err = h('div', { class: 'error-box', hidden: true });
  const username = h('input', { class: 'input', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 32 });
  const displayName = h('input', { class: 'input', name: 'displayName', autocomplete: 'name', maxlength: 40, placeholder: 'e.g. Pranav B.' });
  const password = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: isReg ? 8 : 1 });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, isReg ? 'Create account' : 'Sign in');
  const form = h('form', { class: 'card form', onsubmit: async e => {
    e.preventDefault();
    err.hidden = true; submit.disabled = true;
    try {
      const body = { username: username.value, password: password.value };
      if (isReg) body.displayName = displayName.value;
      app.user = (await api('POST', `/api/auth/${mode}`, body)).user;
      navigate(safeNext, { replace: true });
    } catch (e2) {
      err.textContent = e2.message; err.hidden = false; submit.disabled = false;
    }
  } },
    h('h1', { class: 'form-title' }, isReg ? 'Create your account' : 'Welcome back'),
    err,
    field('Username', username, isReg ? '3–32 characters: letters, numbers, . _ -' : null),
    isReg ? field('Display name', displayName, 'Shown next to violations you log.') : null,
    field('Password', password, isReg ? 'At least 8 characters.' : null),
    submit,
    h('p', { class: 'muted center' }, isReg ? 'Already have an account? ' : 'New here? ',
      link(`/${isReg ? 'login' : 'register'}${safeNext !== '/' ? `?next=${encodeURIComponent(safeNext)}` : ''}`, null, isReg ? 'Sign in' : 'Create an account')));
  setPage(topbar({ back: '/' }), h('main', { class: 'page narrow' }, form));
  username.focus();
}

// ---------------------------------------------------------------------------
// New session (event picker)
// ---------------------------------------------------------------------------
async function showNewSession() {
  if (app.user === undefined) await refreshMe();
  if (!app.user) return navigate('/login?next=/new', { replace: true });

  const today = new Date();
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const ui = { from: iso(today), to: iso(new Date(today.getTime() + 14 * 864e5)), q: '', events: null, error: null, loading: false, selected: null };

  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search name, city, state, or SKU', 'aria-label': 'Search events', autocomplete: 'off' });
  const from = h('input', { class: 'input', type: 'date', value: ui.from, 'aria-label': 'From date' });
  const to = h('input', { class: 'input', type: 'date', value: ui.to, 'aria-label': 'To date' });
  const results = h('div', { class: 'event-list' });
  const sideHint = () => h('div', { class: 'card side-hint' }, h('p', { class: 'empty-title' }, 'Select an event'), h('p', { class: 'muted' }, 'Then name the session and pick the competition day. You\'ll get a code to share with your refs.'));
  const formHost = h('div', null, window.matchMedia('(min-width: 900px)').matches ? sideHint() : null);

  async function load() {
    ui.loading = true; ui.error = null; draw();
    try {
      const sku = /^(RE|VE)-/i.test(q.value.trim()) ? q.value.trim() : '';
      const params = new URLSearchParams(sku ? { sku } : { from: from.value, to: to.value });
      ui.events = (await api('GET', `/api/vex/events?${params}`)).events;
      ui.skuMode = !!sku;
    } catch (e) { ui.error = e.message; ui.events = null; }
    ui.loading = false; draw();
  }
  let skuTimer;
  q.addEventListener('input', () => {
    ui.q = q.value;
    clearTimeout(skuTimer);
    if (/^(RE|VE)-[A-Z0-9]+-\d{2}-\d{3,}$/i.test(q.value.trim())) skuTimer = setTimeout(load, 300);
    else if (ui.skuMode) { ui.skuMode = false; load(); }
    else draw();
  });
  from.addEventListener('change', load);
  to.addEventListener('change', load);

  function draw() {
    if (ui.loading) return results.replaceChildren(...[1, 2, 3, 4].map(() => h('div', { class: 'skeleton' })));
    if (ui.error) return results.replaceChildren(h('div', { class: 'error-box' }, ui.error, ' ', h('button', { class: 'btn sm', onclick: load }, 'Retry')));
    if (!ui.events) return results.replaceChildren();
    const terms = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = ui.skuMode ? ui.events : ui.events.filter(e => {
      const hay = `${e.name} ${e.sku} ${e.location}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
    if (!list.length) return results.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'No events match'), h('p', { class: 'muted' }, 'Widen the date range, or paste the event SKU (e.g. RE-V5RC-26-4271).')));
    const groups = new Map();
    for (const e of list) { const d = (e.start || '').slice(0, 10); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(e); }
    results.replaceChildren(
      h('p', { class: 'muted small' }, `${list.length} V5RC event${list.length === 1 ? '' : 's'}`),
      ...[...groups].map(([d, evs]) => h('section', { class: 'event-group' },
        h('h3', { class: 'group-label' }, fmtDate(d)),
        ...evs.map(e => h('button', { class: 'event-row' + (ui.selected?.id === e.id ? ' selected' : ''), type: 'button', onclick: () => select(e) },
          h('div', { class: 'event-row-name' }, e.name),
          h('div', { class: 'event-row-meta' }, h('span', null, e.city || e.location), h('span', { class: 'dot-sep mono' }, e.sku),
            e.divisions.length > 1 ? h('span', { class: 'dot-sep' }, `${e.divisions.length} divisions`) : null))))));
  }

  function select(e) {
    ui.selected = e; draw();
    const days = [];
    const start = new Date((e.start || '').slice(0, 10) + 'T12:00:00');
    const end = new Date((e.end || e.start || '').slice(0, 10) + 'T12:00:00');
    for (let d = start; d <= end && days.length < 10; d = new Date(d.getTime() + 864e5)) days.push(iso(d));
    const todayIso = iso(today);
    const date = h('select', { class: 'input' }, ...days.map(d => h('option', { value: d, selected: d === todayIso }, fmtDate(d))));
    const name = h('input', { class: 'input', maxlength: 80, value: e.name.split(':')[0].trim() });
    const err = h('div', { class: 'error-box', hidden: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Create session');
    formHost.replaceChildren(h('form', { class: 'card form sticky-form', onsubmit: async ev => {
      ev.preventDefault(); btn.disabled = true; err.hidden = true;
      try {
        const { session } = await api('POST', '/api/sessions', { eventId: e.id, name: name.value, date: date.value });
        toast(`Session ${session.code} created`);
        navigate(`/s/${session.code}`, { replace: true });
      } catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; }
    } },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'New session'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Clear selection', onclick: () => { ui.selected = null; formHost.replaceChildren(window.matchMedia('(min-width: 900px)').matches ? sideHint() : ''); draw(); } }, icon('x'))),
      h('p', { class: 'selected-event' }, e.name),
      err,
      field('Session name', name),
      field('Competition day', date, days.length > 1 ? 'Multi-day event: make one session per day.' : null),
      btn));
    formHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  setPage(topbar({ back: '/', title: 'New session' }),
    h('main', { class: 'page' },
      h('div', { class: 'new-layout' },
        h('div', { class: 'new-main' },
          h('p', { class: 'muted' }, 'Pick the V5RC event you are reffing. Events come from events.vex.com.'),
          h('div', { class: 'filters' }, h('div', { class: 'search-wrap' }, icon('search', 18), q), h('div', { class: 'date-range' }, from, h('span', { class: 'muted' }, 'to'), to)),
          results),
        h('aside', { class: 'new-side' }, formHost))));
  load();
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
async function showJoin(code) {
  if (app.user === undefined) await refreshMe();
  if (!code) {
    return setPage(topbar({ back: '/' }), h('main', { class: 'page narrow' }, h('section', { class: 'card' }, h('h1', { class: 'form-title' }, 'Join a session'), joinCodeForm())));
  }
  const body = h('div', { class: 'card form' }, h('div', { class: 'skeleton' }));
  setPage(topbar({ back: '/' }), h('main', { class: 'page narrow' }, body));
  let info;
  try { info = (await api('GET', `/api/join/${code}`)).session; } catch (e) {
    body.replaceChildren(h('h1', { class: 'form-title' }, 'Session not found'), h('p', { class: 'muted' }, `No session uses the code ${code}. Double-check it with your head ref.`), joinCodeForm());
    return;
  }
  // Already a participant on this device? Go straight in.
  try { await api('GET', `/api/s/${code}/`); return navigate(`/s/${code}`, { replace: true }); } catch {}

  const err = h('div', { class: 'error-box', hidden: true });
  const name = h('input', { class: 'input', maxlength: 40, autocomplete: 'name', placeholder: 'e.g. Field 2 ref — Sam', value: store.get('br_guest_name', '') });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, app.user ? `Join as ${app.user.displayName}` : 'Join session');
  body.replaceChildren(h('form', { class: 'form-inner', onsubmit: async e => {
    e.preventDefault(); btn.disabled = true; err.hidden = true;
    try {
      if (!app.user) store.set('br_guest_name', name.value.trim());
      await api('POST', `/api/s/${code}/join`, app.user ? {} : { name: name.value });
      navigate(`/s/${code}`, { replace: true });
    } catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; }
  } },
    h('p', { class: 'eyebrow' }, `Session ${info.code}`),
    h('h1', { class: 'form-title' }, info.name),
    h('p', { class: 'muted' }, info.eventName, info.date ? ` · ${fmtDate(info.date)}` : ''),
    err,
    app.user ? null : field('Your name', name, 'Shown next to each violation you log.'),
    btn,
    app.user ? null : h('p', { class: 'muted center' }, 'Have an account? ', link(`/login?next=${encodeURIComponent('/join/' + code)}`, null, 'Sign in'), ' to keep this session in your list.')));
  if (!app.user) name.focus();
}

// ---------------------------------------------------------------------------
// Competition session: state, sync, offline outbox
// ---------------------------------------------------------------------------
function newSessState(code) {
  return {
    code,
    info: null,
    me: null,
    participants: [],
    online: [],
    violations: new Map(),
    customMatches: new Map(),
    matches: [],
    matchesAt: 0,
    matchesError: null,
    matchesLoading: false,
    division: null,
    teams: null,
    teamsError: null,
    es: null,
    connected: false,
    outbox: store.get(`br_outbox_${code}`, []),
    flushing: false,
    timers: [],
    tab: 'matches',
    param: null,
    ui: { matchQ: '', matchRound: 'all', teamQ: '', teamSort: 'number', logQ: '', logSev: 'all', scrolledToNow: false, closedEarlier: new Set() },
    view: null,
  };
}

function leaveSessionView() {
  const s = app.sess;
  if (!s) return;
  s.es?.close();
  s.timers.forEach(clearInterval);
  document.removeEventListener('visibilitychange', s.onVisible);
  window.removeEventListener('online', s.onOnline);
  window.removeEventListener('offline', s.onOffline);
  app.sess = null;
}

function saveOutbox(s) { store.set(`br_outbox_${s.code}`, s.outbox); }

/** Apply a queued op to local state (optimistic UI). */
function applyOp(s, op) {
  if (op.kind === 'create') s.violations.set(op.v.id, { ...op.v, pending: true });
  else if (op.kind === 'update') { const v = s.violations.get(op.id); if (v) s.violations.set(op.id, { ...v, ...op.patch, pending: true }); }
  else if (op.kind === 'delete') s.violations.delete(op.id);
  else if (op.kind === 'createMatch') s.customMatches.set(op.m.key, { ...op.m, pending: true });
  else if (op.kind === 'deleteMatch') s.customMatches.delete(`custom:${op.id}`);
}
function opRequest(s, op) {
  const base = `/api/s/${s.code}`;
  switch (op.kind) {
    case 'create': return ['POST', `${base}/violations`, op.v];
    case 'update': return ['PATCH', `${base}/violations/${op.id}`, op.patch];
    case 'delete': return ['DELETE', `${base}/violations/${op.id}`, {}];
    case 'createMatch': return ['POST', `${base}/matches`, { id: op.m.id, name: op.m.name, division: op.m.division, red: op.m.red.teams.map(t => t.number), blue: op.m.blue.teams.map(t => t.number) }];
    case 'deleteMatch': return ['DELETE', `${base}/matches/${op.id}`, {}];
  }
}

function enqueue(op) {
  const s = app.sess;
  if (!s) return;
  // Deleting/editing something that never reached the server: collapse into the pending create.
  if (op.kind === 'delete') {
    const i = s.outbox.findIndex(o => o.kind === 'create' && o.v.id === op.id);
    if (i >= 0) { s.outbox = s.outbox.filter(o => !((o.kind === 'create' && o.v.id === op.id) || (o.kind === 'update' && o.id === op.id))); saveOutbox(s); applyOp(s, op); return rerender(); }
  }
  if (op.kind === 'update') {
    const c = s.outbox.find(o => o.kind === 'create' && o.v.id === op.id);
    if (c) { Object.assign(c.v, op.patch); saveOutbox(s); applyOp(s, op); flush(); return rerender(); }
  }
  op.opId = uuid();
  s.outbox.push(op);
  saveOutbox(s);
  applyOp(s, op);
  rerender();
  flush();
}

async function flush() {
  const s = app.sess;
  if (!s || s.flushing || !s.outbox.length) return renderSyncStatus();
  s.flushing = true;
  renderSyncStatus();
  while (app.sess === s && s.outbox.length) {
    const op = s.outbox[0];
    try {
      const res = await api(...opRequest(s, op));
      s.outbox.shift();
      saveOutbox(s);
      s.netDown = false;
      if (res.violation) upsertViolation(s, res.violation);
      if (res.match) s.customMatches.set(res.match.key, res.match);
    } catch (e) {
      if (e.offline || !e.status || e.status >= 500 || e.status === 429) { s.netDown = !!e.offline; break; } // retry later
      // Permanent rejection — drop it and tell the ref.
      s.outbox.shift();
      saveOutbox(s);
      toast(`Couldn't sync a change: ${e.message}`, 'error');
      if (e.status === 403) { s.flushing = false; return handleKicked(s); }
      refetchState(s);
    }
  }
  s.flushing = false;
  rerender();
}

function upsertViolation(s, v) {
  // Don't clobber a local edit that is still waiting to sync.
  if (s.outbox.some(o => (o.kind === 'update' || o.kind === 'delete') && o.id === v.id)) return;
  if (s.outbox.some(o => o.kind === 'delete' && o.id === v.id)) return;
  s.violations.set(v.id, v);
}

async function refetchState(s) {
  try {
    const data = await api('GET', `/api/s/${s.code}/`);
    if (app.sess !== s) return;
    s.info = data.session;
    s.me = data.me;
    s.participants = data.participants;
    s.online = data.online;
    s.violations = new Map(data.violations.map(v => [v.id, v]));
    s.customMatches = new Map(data.customMatches.map(m => [m.key, m]));
    for (const op of s.outbox) applyOp(s, op);
    if (s.division == null) s.division = store.get(`br_div_${s.code}`, null) ?? s.info.divisions[0]?.id ?? 1;
    rerender();
    return true;
  } catch (e) {
    if (e.status === 403) return handleKicked(s);
    if (e.status === 404) { toast('This session no longer exists.', 'error'); navigate('/', { replace: true }); return false; }
    throw e;
  }
}

async function handleKicked(s) {
  // Not a participant on this device. Signed-in users rejoin silently; guests go to the join screen.
  if (app.user === undefined) await refreshMe();
  if (app.user) {
    try { await api('POST', `/api/s/${s.code}/join`, {}); return refetchState(s); } catch {}
  }
  navigate(`/join/${s.code}`, { replace: true });
  return false;
}

function connectStream(s) {
  s.es?.close();
  const es = new EventSource(`/api/s/${s.code}/stream`);
  s.es = es;
  let hadError = false;
  es.onopen = () => {
    s.connected = true;
    renderSyncStatus();
    if (hadError) refetchState(s).catch(() => {});
    flush();
  };
  es.onerror = () => {
    s.connected = false;
    hadError = true;
    renderSyncStatus();
    if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (app.sess === s) connectStream(s); }, 4000);
  };
  const on = (type, fn) => es.addEventListener(type, e => { if (app.sess !== s) return; fn(JSON.parse(e.data)); rerender(); });
  on('violation', v => upsertViolation(s, v));
  on('violation-deleted', ({ id }) => s.violations.delete(id));
  on('custom-match', m => s.customMatches.set(m.key, m));
  on('custom-match-deleted', ({ key }) => s.customMatches.delete(key));
  on('presence', list => { s.online = list; });
  on('session', info => { s.info = info; });
  on('deleted', () => { toast('The owner deleted this session.', 'error'); navigate('/', { replace: true }); });
}

async function loadMatches(s, { fresh = false } = {}) {
  const div = s.division;
  if (s.matchesLoading === div) return;
  s.matchesLoading = div;
  renderSyncStatus();
  try {
    const data = await api('GET', `/api/s/${s.code}/matches?division=${s.division}${fresh ? '&fresh=1' : ''}`);
    if (app.sess !== s) return;
    if (data.division === s.division) { s.matches = data.matches; s.matchesAt = data.fetchedAt; s.matchesError = null; }
  } catch (e) {
    if (app.sess === s) s.matchesError = e.offline ? 'Offline — showing the last schedule loaded.' : e.message;
  } finally {
    if (s.matchesLoading === div) s.matchesLoading = false;
  }
  rerender();
}
async function loadTeams(s) {
  try { s.teams = (await api('GET', `/api/s/${s.code}/teams`)).teams; s.teamsError = null; } catch (e) { s.teamsError = e.message; }
  if (app.sess === s) rerender();
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------
function allMatches(s) {
  const custom = [...s.customMatches.values()].filter(m => m.division === s.division);
  return [...s.matches, ...custom];
}
function findMatch(s, key) {
  return s.matches.find(m => m.key === key) || s.customMatches.get(key) || null;
}
function violationsByTeam(s) {
  const map = new Map();
  for (const v of s.violations.values()) {
    if (!map.has(v.team)) map.set(v.team, []);
    map.get(v.team).push(v);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return map;
}
function violationsByMatch(s) {
  const map = new Map();
  for (const v of s.violations.values()) {
    if (!map.has(v.matchKey)) map.set(v.matchKey, []);
    map.get(v.matchKey).push(v);
  }
  return map;
}
function counts(list) {
  let major = 0, minor = 0;
  for (const v of list || []) v.severity === 'major' ? major++ : minor++;
  return { major, minor, total: major + minor };
}
function matchTeams(m) {
  return [...m.red.teams.map(t => ({ ...t, alliance: 'red' })), ...m.blue.teams.map(t => ({ ...t, alliance: 'blue' }))].filter(t => t.number);
}

// ---------------------------------------------------------------------------
// Session view
// ---------------------------------------------------------------------------
async function showSession(code, tab, param) {
  let s = app.sess;
  const fresh = !s || s.code !== code;
  if (fresh) {
    if (s) leaveSessionView();
    s = app.sess = newSessState(code);
    setPage(h('div', { class: 'loading-screen' }, brandMark(), h('p', { class: 'muted' }, 'Opening session…')));
  }
  s.tab = tab === 'm' ? 'matches' : tab === 't' ? 'teams' : tab;
  s.param = param;

  if (fresh) {
    if (app.user === undefined) refreshMe();
    let ok;
    try { ok = await refetchState(s); } catch (e) {
      // Offline on first load — nothing cached server-side we can show.
      setPage(topbar({ back: '/' }), h('main', { class: 'page narrow' }, h('div', { class: 'error-box' }, `Couldn't open session: ${e.message}`), h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry')));
      app.sess = null;
      return;
    }
    if (!ok || app.sess !== s) return;
    buildSessionShell(s);
    connectStream(s);
    loadMatches(s);
    loadTeams(s);
    s.timers.push(setInterval(() => { if (document.visibilityState === 'visible') loadMatches(s); }, 30000));
    s.timers.push(setInterval(() => { if (s.outbox.length) flush(); }, 5000));
    s.onVisible = () => { if (document.visibilityState === 'visible' && app.sess === s) { refetchState(s).catch(() => {}); loadMatches(s); if (s.es?.readyState === EventSource.CLOSED) connectStream(s); } };
    s.onOnline = () => { s.netDown = false; flush(); refetchState(s).catch(() => {}); };
    s.onOffline = () => renderSyncStatus();
    window.addEventListener('offline', s.onOffline);
    document.addEventListener('visibilitychange', s.onVisible);
    window.addEventListener('online', s.onOnline);
    flush();
  }
  mountTab(s);
}

function buildSessionShell(s) {
  const statusEl = h('button', { class: 'sync-pill', type: 'button', onclick: () => navigate(`/s/${s.code}/info`) });
  const titleEl = h('div', { class: 'session-title' });
  const content = h('div', { class: 'session-content' });
  const tabs = [
    ['matches', 'Matches', 'list'],
    ['teams', 'Teams', 'users'],
    ['log', 'Log', 'log'],
    ['info', 'Session', 'info'],
  ];
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Session sections' },
    ...tabs.map(([id, label, ic]) => link(`/s/${s.code}${id === 'matches' ? '' : '/' + id}`, { class: 'tab', dataset: { tab: id } }, icon(ic, 22), h('span', null, label))));
  s.shell = { statusEl, titleEl, content, tabbar };
  setPage(h('div', { class: 'session-shell' },
    h('header', { class: 'topbar session-top' },
      link('/', { class: 'icon-btn', 'aria-label': 'All sessions' }, icon('back')),
      titleEl,
      statusEl),
    content,
    tabbar));
  renderShellHeader(s);
}

function renderShellHeader(s) {
  if (!s.shell) return;
  s.shell.titleEl.replaceChildren(
    h('div', { class: 'session-name' }, s.info?.name || s.code),
    h('div', { class: 'session-sub' }, h('span', { class: 'mono' }, s.code), s.info?.date ? h('span', { class: 'dot-sep' }, fmtDate(s.info.date)) : null));
  for (const a of s.shell.tabbar.querySelectorAll('.tab')) a.classList.toggle('active', a.dataset.tab === s.tab);
  renderSyncStatus();
}

function renderSyncStatus() {
  const s = app.sess;
  if (!s?.shell) return;
  const pending = s.outbox.length;
  let cls = 'ok', label = `${s.online.length || 1} online`;
  if (!s.connected || s.netDown || navigator.onLine === false) { cls = 'off'; label = pending ? `Offline · ${pending} queued` : 'Reconnecting…'; }
  else if (pending) { cls = 'busy'; label = `Syncing ${pending}…`; }
  s.shell.statusEl.className = `sync-pill ${cls}`;
  s.shell.statusEl.replaceChildren(h('i', { class: 'sync-dot' }), h('span', null, label));
  s.shell.statusEl.setAttribute('aria-label', `Sync status: ${label}`);
}

let rerenderQueued = false;
function rerender() {
  if (rerenderQueued) return;
  rerenderQueued = true;
  requestAnimationFrame(() => {
    rerenderQueued = false;
    const s = app.sess;
    if (!s?.shell) return;
    renderShellHeader(s);
    s.view?.update();
    sheetState.onDataChange?.();
  });
}

function mountTab(s) {
  if (!s.shell) return;
  const key = `${s.tab}:${s.tab === 'matches' || s.tab === 'teams' ? '' : s.param || ''}`;
  if (s.view && s.view.key === key) { s.view.setParam?.(s.param); s.view.update(); renderShellHeader(s); return; }
  const builders = { matches: buildMatchesView, teams: buildTeamsView, log: buildLogView, info: buildInfoView };
  s.view = (builders[s.tab] || buildMatchesView)(s);
  s.view.key = key;
  s.shell.content.replaceChildren(s.view.el);
  s.shell.content.scrollTop = 0;
  renderShellHeader(s);
  s.view.update();
}

// ---- Matches tab: split list/detail -------------------------------------
function buildMatchesView(s) {
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Team or match (e.g. 4621F, Q12)', value: s.ui.matchQ, 'aria-label': 'Filter matches', autocomplete: 'off', autocapitalize: 'characters' });
  q.addEventListener('input', () => { s.ui.matchQ = q.value; drawList(); });
  const roundSeg = segmented([['all', 'All'], ['quals', 'Quals'], ['elims', 'Elims'], ['flagged', 'Flagged']], s.ui.matchRound, v => { s.ui.matchRound = v; drawList(); });
  const divSelect = h('select', { class: 'input div-select', 'aria-label': 'Division', onchange: e => { s.division = Number(e.target.value); store.set(`br_div_${s.code}`, s.division); s.matches = []; s.ui.scrolledToNow = false; drawList(); loadMatches(s, { fresh: true }); } });
  const listMeta = h('div', { class: 'list-meta' });
  const listBody = h('div', { class: 'match-list', role: 'list' });
  const detail = h('section', { class: 'detail-pane', 'aria-label': 'Match details' });
  const listPane = h('section', { class: 'list-pane', 'aria-label': 'Matches' },
    h('div', { class: 'list-tools' },
      h('div', { class: 'search-wrap' }, icon('search', 18), q),
      h('div', { class: 'row gap-sm' }, roundSeg.el, divSelect)),
    listMeta,
    listBody);
  const el = h('div', { class: 'split' }, listPane, detail);
  let detailKey = null, detailView = null;

  function drawDivisions() {
    const divs = s.info?.divisions || [];
    divSelect.hidden = divs.length <= 1;
    if (divSelect.options.length !== divs.length) divSelect.replaceChildren(...divs.map(d => h('option', { value: d.id }, d.name)));
    divSelect.value = String(s.division);
  }

  function filtered() {
    const vm = violationsByMatch(s);
    const terms = s.ui.matchQ.toUpperCase().split(/[\s,]+/).filter(Boolean);
    return allMatches(s).filter(m => {
      if (s.ui.matchRound === 'quals' && !(m.round === 2 || (m.custom && /^Q/i.test(m.label)))) return false;
      if (s.ui.matchRound === 'elims' && (m.round === 1 || m.round === 2 || m.custom)) return false;
      if (s.ui.matchRound === 'flagged' && !vm.get(m.key)?.length) return false;
      if (!terms.length) return true;
      const hay = [m.label, m.name, ...matchTeams(m).map(t => t.number)].join(' ').toUpperCase();
      return terms.every(t => hay.includes(t));
    }).map(m => ({ m, vs: vm.get(m.key) || [] }));
  }

  function drawList() {
    drawDivisions();
    const items = filtered();
    const total = allMatches(s).length;
    listMeta.replaceChildren(
      h('span', null, s.matchesLoading && !total ? 'Loading schedule…' : `${items.length} of ${total} matches`),
      s.matchesAt ? h('span', { class: 'muted' }, ` · updated ${fmtTime(s.matchesAt)}`) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Refresh schedule', onclick: () => loadMatches(s, { fresh: true }) }, icon('refresh', 16)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openCustomMatchSheet(s) }, icon('plus', 16), 'Match'));
    const nodes = [];
    if (s.matchesError) nodes.push(h('div', { class: 'error-box compact' }, s.matchesError));
    if (!total && !s.matchesLoading) {
      nodes.push(h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No matches published yet'),
        h('p', { class: 'muted' }, 'The schedule appears here once Tournament Manager publishes it to events.vex.com. It refreshes every 30 seconds. Until then, add a match by hand.'),
        h('button', { class: 'btn primary', onclick: () => openCustomMatchSheet(s) }, icon('plus', 18), 'Add a match')));
    }
    if (!items.length && total) nodes.push(h('div', { class: 'empty small' }, h('p', { class: 'muted' }, 'No matches match that filter.')));
    const byTeam = violationsByTeam(s);
    let nowKey = null;
    for (const { m } of items) if (m.started) nowKey = m.key;
    for (const { m, vs } of items) {
      const c = counts(vs);
      const teamCell = (t, alliance) => {
        const tc = counts(byTeam.get(t.number));
        return h('span', { class: `mteam ${alliance}${t.sitting ? ' sitting' : ''}` }, t.number,
          tc.major ? h('i', { class: 'tdot major', title: `${tc.major} major this session` }) : tc.minor ? h('i', { class: 'tdot minor', title: `${tc.minor} minor this session` }) : null);
      };
      nodes.push(link(`/s/${s.code}/m/${encodeURIComponent(m.key)}`, {
        class: 'match-row' + (s.param === m.key ? ' active' : '') + (m.key === nowKey ? ' now' : '') + (m.pending ? ' pending' : ''),
        role: 'listitem', dataset: { key: m.key },
      },
        h('div', { class: 'mlabel' }, h('strong', null, m.label), h('span', null, m.custom ? 'manual' : m.started ? fmtTime(m.started) : m.scheduled ? fmtTime(m.scheduled) : '')),
        h('div', { class: 'malliances' },
          h('div', { class: 'malliance red' }, ...m.red.teams.map(t => teamCell(t, 'red'))),
          h('div', { class: 'malliance blue' }, ...m.blue.teams.map(t => teamCell(t, 'blue')))),
        h('div', { class: 'mbadges' },
          c.major ? h('span', { class: 'badge major' }, c.major) : null,
          c.minor ? h('span', { class: 'badge minor' }, c.minor) : null)));
    }
    listBody.replaceChildren(...nodes);
    if (!s.ui.scrolledToNow && nowKey && !s.param && !s.ui.matchQ) {
      s.ui.scrolledToNow = true;
      requestAnimationFrame(() => listBody.querySelector('.match-row.now')?.scrollIntoView({ block: 'center' }));
    }
  }

  function drawDetail() {
    el.classList.toggle('has-detail', !!s.param);
    if (!s.param) {
      detailKey = null; detailView = null;
      detail.replaceChildren(h('div', { class: 'detail-empty' }, brandMark(), h('p', { class: 'empty-title' }, 'Pick a match'), h('p', { class: 'muted' }, 'Tap a match to log violations and see each team\'s history for the day.')));
      return;
    }
    if (detailKey !== s.param) {
      detailKey = s.param;
      detailView = buildMatchDetail(s, s.param);
      detail.replaceChildren(detailView.el);
      detail.scrollTop = 0;
    }
    detailView.update();
  }

  return {
    el,
    setParam() {},
    update() { drawList(); drawDetail(); },
  };
}

function segmented(options, value, onChange) {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  const draw = v => el.replaceChildren(...options.map(([val, label]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(val === v), class: val === v ? 'on' : '',
    onclick: () => { draw(val); onChange(val); },
  }, label)));
  draw(value);
  return { el, set: draw };
}

function buildMatchDetail(s, key) {
  const el = h('div', { class: 'match-detail' });
  function update() {
    const m = findMatch(s, key);
    if (!m) {
      el.replaceChildren(
        h('div', { class: 'detail-head' }, link(`/s/${s.code}`, { class: 'icon-btn narrow-only', 'aria-label': 'Back to matches' }, icon('back')), h('h2', null, 'Match')),
        s.matchesLoading || !s.matchesAt ? h('div', { class: 'skeleton tall' }) : h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Match not found'), h('p', { class: 'muted' }, 'It may be in another division or was removed.')));
      return;
    }
    const byTeam = violationsByTeam(s);
    const inMatch = [...s.violations.values()].filter(v => v.matchKey === key);
    const c = counts(inMatch);
    const scoreText = m.red.score != null && m.blue.score != null && (m.scored || m.red.score || m.blue.score) ? `${m.red.score} – ${m.blue.score}` : null;
    el.replaceChildren(
      h('div', { class: 'detail-head' },
        link(`/s/${s.code}`, { class: 'icon-btn narrow-only', 'aria-label': 'Back to matches' }, icon('back')),
        h('div', { class: 'detail-title' },
          h('h2', null, m.name || m.label),
          h('div', { class: 'muted small' }, [m.field, m.started ? `Started ${fmtTime(m.started)}` : m.scheduled ? `Scheduled ${fmtTime(m.scheduled)}` : null, scoreText ? `Score ${scoreText}` : null, m.custom ? 'Added manually' : null].filter(Boolean).join(' · '))),
        h('div', { class: 'mbadges' }, c.major ? h('span', { class: 'badge major' }, `${c.major} major`) : null, c.minor ? h('span', { class: 'badge minor' }, `${c.minor} minor`) : null),
        m.custom && (s.me?.isOwner) ? h('button', { class: 'icon-btn', 'aria-label': 'Remove manual match', onclick: () => confirmSheet({ title: `Remove ${m.label}?`, body: 'This removes the manual match. Violations already logged on it stay in the log.', confirm: 'Remove match', danger: true, onConfirm: () => { enqueue({ kind: 'deleteMatch', id: m.id }); navigate(`/s/${s.code}`); } }) }, icon('trash', 18)) : null),
      ...['red', 'blue'].map(color => h('section', { class: `alliance-block ${color}` },
        h('h3', { class: 'alliance-label' }, color === 'red' ? 'Red alliance' : 'Blue alliance', m[color].score != null && scoreText ? h('span', { class: 'alliance-score' }, m[color].score) : null),
        h('div', { class: 'team-cards' }, ...m[color].teams.filter(t => t.number).map(t => teamCard(s, m, t, color, byTeam.get(t.number) || []))))));
  }
  return { el, update };
}

function teamCard(s, m, t, alliance, history) {
  const here = history.filter(v => v.matchKey === m.key);
  const earlier = history.filter(v => v.matchKey !== m.key);
  const c = counts(history);
  const ruleCounts = new Map();
  for (const v of history) { const k = `${v.rule}|${v.severity}`; ruleCounts.set(k, (ruleCounts.get(k) || 0) + 1); }
  const repeats = [...ruleCounts].filter(([, n]) => n > 1).map(([k, n]) => { const [rule, sev] = k.split('|'); return { rule, sev, n }; });
  const add = sev => openViolationSheet(s, { match: m, team: t.number, alliance, severity: sev });
  return h('article', { class: `team-card ${alliance}${t.sitting ? ' sitting' : ''}` },
    h('header', { class: 'team-card-head' },
      h('div', null,
        link(`/s/${s.code}/teams/${encodeURIComponent(t.number)}`, { class: 'team-num' }, t.number),
        h('div', { class: 'team-name' }, teamName(s, t.number) || (t.sitting ? 'Sitting out' : ''))),
      h('div', { class: 'team-tally', 'aria-label': `Session total: ${c.major} major, ${c.minor} minor` },
        h('span', { class: 'tally major' + (c.major ? '' : ' zero') }, h('b', null, c.major), ' major'),
        h('span', { class: 'tally minor' + (c.minor ? '' : ' zero') }, h('b', null, c.minor), ' minor'))),
    repeats.length ? h('div', { class: 'repeat-row' }, 'Repeat: ', ...repeats.map(r => h('span', { class: `rchip ${r.sev}` }, `${r.rule} ×${r.n}`))) : null,
    here.length ? h('div', { class: 'vgroup' }, h('div', { class: 'vgroup-label' }, 'This match'), ...here.map(v => violationItem(s, v, { showMatch: false }))) : null,
    earlier.length ? h('details', { class: 'vgroup earlier', open: !s.ui.closedEarlier.has(t.number),
      ontoggle: e => { e.currentTarget.open ? s.ui.closedEarlier.delete(t.number) : s.ui.closedEarlier.add(t.number); } },
      h('summary', { class: 'vgroup-label' }, `Earlier today (${earlier.length})`),
      ...earlier.slice().reverse().map(v => violationItem(s, v, { showMatch: true }))) : null,
    !history.length ? h('p', { class: 'muted small clean' }, 'Clean so far today.') : null,
    h('div', { class: 'add-row' },
      h('button', { class: 'btn add minor', type: 'button', onclick: () => add('minor') }, icon('plus', 18), 'Minor'),
      h('button', { class: 'btn add major', type: 'button', onclick: () => add('major') }, icon('plus', 18), 'Major')));
}

function teamName(s, number) {
  return s.teams?.find(t => t.number === number)?.name || '';
}

function violationItem(s, v, { showMatch = true, showTeam = false } = {}) {
  return h('button', { class: `vitem ${v.severity}${v.pending ? ' pending' : ''}`, type: 'button', onclick: () => openViolationSheet(s, { existing: v }) },
    h('span', { class: `sev ${v.severity}` }, v.severity === 'major' ? 'MAJ' : 'MIN'),
    h('span', { class: 'vbody' },
      h('span', { class: 'vline' },
        showTeam ? h('strong', { class: 'vteam' }, v.team) : null,
        h('strong', { class: 'vrule' }, v.rule),
        h('span', { class: 'vtitle' }, ruleTitle(v.rule))),
      v.comment ? h('span', { class: 'vcomment' }, v.comment) : null,
      h('span', { class: 'vmeta' }, [showMatch ? v.matchName : null, v.createdByName, fmtTime(v.createdAt), v.pending ? 'not synced yet' : null].filter(Boolean).join(' · '))));
}

// ---- Teams tab -------------------------------------------------------------
function buildTeamsView(s) {
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Find a team', value: s.ui.teamQ, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Find a team' });
  q.addEventListener('input', () => { s.ui.teamQ = q.value; drawList(); });
  const sortSeg = segmented([['number', 'Number'], ['most', 'Most flagged']], s.ui.teamSort, v => { s.ui.teamSort = v; drawList(); });
  const listBody = h('div', { class: 'team-list', role: 'list' });
  const detail = h('section', { class: 'detail-pane' });
  const el = h('div', { class: 'split' },
    h('section', { class: 'list-pane' }, h('div', { class: 'list-tools' }, h('div', { class: 'search-wrap' }, icon('search', 18), q), sortSeg.el), listBody),
    detail);

  function teamNumbers() {
    const set = new Map();
    for (const t of s.teams || []) set.set(t.number, t);
    for (const m of allMatches(s)) for (const t of matchTeams(m)) if (!set.has(t.number)) set.set(t.number, { number: t.number });
    for (const v of s.violations.values()) if (!set.has(v.team)) set.set(v.team, { number: v.team });
    return [...set.values()];
  }

  function drawList() {
    const byTeam = violationsByTeam(s);
    const terms = s.ui.teamQ.toUpperCase().trim();
    let teams = teamNumbers().filter(t => !terms || `${t.number} ${t.name || ''} ${t.org || ''}`.toUpperCase().includes(terms));
    teams.sort((a, b) => {
      if (s.ui.teamSort === 'most') {
        const ca = counts(byTeam.get(a.number)), cb = counts(byTeam.get(b.number));
        return cb.major - ca.major || cb.total - ca.total || naturalCmp(a.number, b.number);
      }
      return naturalCmp(a.number, b.number);
    });
    if (!teams.length) {
      listBody.replaceChildren(s.teamsError ? h('div', { class: 'error-box compact' }, s.teamsError) : s.teams ? h('div', { class: 'empty small' }, h('p', { class: 'muted' }, 'No teams found.')) : h('div', { class: 'skeleton' }));
      return;
    }
    listBody.replaceChildren(...teams.map(t => {
      const c = counts(byTeam.get(t.number));
      return link(`/s/${s.code}/teams/${encodeURIComponent(t.number)}`, { class: 'team-row' + (s.param === t.number ? ' active' : ''), role: 'listitem' },
        h('div', { class: 'team-row-main' }, h('strong', { class: 'mono' }, t.number), h('span', { class: 'muted small' }, t.name || '')),
        h('div', { class: 'mbadges' }, c.major ? h('span', { class: 'badge major' }, c.major) : null, c.minor ? h('span', { class: 'badge minor' }, c.minor) : null),
        icon('chevron', 16));
    }));
  }

  function drawDetail() {
    el.classList.toggle('has-detail', !!s.param);
    if (!s.param) {
      detail.replaceChildren(h('div', { class: 'detail-empty' }, brandMark(), h('p', { class: 'empty-title' }, 'Pick a team'), h('p', { class: 'muted' }, 'See every violation a team has picked up today and jump to their matches.')));
      return;
    }
    const number = s.param;
    const info = (s.teams || []).find(t => t.number === number);
    const history = (violationsByTeam(s).get(number) || []).slice().reverse();
    const c = counts(history);
    const vm = violationsByMatch(s);
    const theirMatches = allMatches(s).filter(m => matchTeams(m).some(t => t.number === number));
    detail.replaceChildren(h('div', { class: 'match-detail' },
      h('div', { class: 'detail-head' },
        link(`/s/${s.code}/teams`, { class: 'icon-btn narrow-only', 'aria-label': 'Back to teams' }, icon('back')),
        h('div', { class: 'detail-title' }, h('h2', { class: 'mono' }, number), h('div', { class: 'muted small' }, [info?.name, info?.org, info?.city].filter(Boolean).join(' · '))),
        h('div', { class: 'team-tally' },
          h('span', { class: 'tally major' + (c.major ? '' : ' zero') }, h('b', null, c.major), ' major'),
          h('span', { class: 'tally minor' + (c.minor ? '' : ' zero') }, h('b', null, c.minor), ' minor'))),
      h('section', { class: 'panel' }, h('h3', { class: 'panel-title' }, 'Violations today'),
        history.length ? h('div', { class: 'vstack' }, ...history.map(v => violationItem(s, v, { showMatch: true }))) : h('p', { class: 'muted' }, 'No violations logged for this team.')),
      h('section', { class: 'panel' }, h('h3', { class: 'panel-title' }, `Matches (${theirMatches.length})`),
        theirMatches.length ? h('div', { class: 'chip-grid' }, ...theirMatches.map(m => {
          const tm = (vm.get(m.key) || []).filter(v => v.team === number);
          const color = m.red.teams.some(t => t.number === number) ? 'red' : 'blue';
          return link(`/s/${s.code}/m/${encodeURIComponent(m.key)}`, { class: `match-chip ${color}` }, m.label, tm.length ? h('span', { class: `badge ${tm.some(v => v.severity === 'major') ? 'major' : 'minor'}` }, tm.length) : null);
        })) : h('p', { class: 'muted' }, 'No matches on the schedule yet.'))));
  }

  return { el, update() { drawList(); drawDetail(); } };
}

// ---- Log tab --------------------------------------------------------------
function buildLogView(s) {
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search team, rule, match, comment', value: s.ui.logQ, autocomplete: 'off', 'aria-label': 'Search log' });
  q.addEventListener('input', () => { s.ui.logQ = q.value; draw(); });
  const sev = segmented([['all', 'All'], ['major', 'Major'], ['minor', 'Minor']], s.ui.logSev, v => { s.ui.logSev = v; draw(); });
  const summary = h('div', { class: 'log-summary' });
  const body = h('div', { class: 'vstack log-list' });
  const el = h('div', { class: 'page log-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Violation log'),
      h('a', { class: 'btn sm', href: `/api/s/${s.code}/export.csv`, download: `bhagamref-${s.code}.csv` }, icon('download', 16), 'CSV')),
    summary,
    h('div', { class: 'list-tools' }, h('div', { class: 'search-wrap' }, icon('search', 18), q), sev.el),
    body);

  function draw() {
    const all = [...s.violations.values()].sort((a, b) => b.createdAt - a.createdAt);
    const c = counts(all);
    const teamsFlagged = new Set(all.map(v => v.team)).size;
    summary.replaceChildren(
      stat(c.total, 'logged'), stat(c.major, 'major', 'major'), stat(c.minor, 'minor', 'minor'), stat(teamsFlagged, teamsFlagged === 1 ? 'team' : 'teams'));
    const terms = s.ui.logQ.toLowerCase().split(/\s+/).filter(Boolean);
    const list = all.filter(v => (s.ui.logSev === 'all' || v.severity === s.ui.logSev) &&
      terms.every(t => `${v.team} ${v.rule} ${ruleTitle(v.rule)} ${v.matchName} ${v.comment} ${v.createdByName}`.toLowerCase().includes(t)));
    if (!all.length) return body.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Nothing logged yet'), h('p', { class: 'muted' }, 'Violations from every ref in this session show up here as they happen.')));
    if (!list.length) return body.replaceChildren(h('p', { class: 'muted' }, 'No entries match.'));
    body.replaceChildren(...list.map(v => violationItem(s, v, { showMatch: true, showTeam: true })));
  }
  return { el, update: draw };
}
function stat(n, label, cls = '') { return h('div', { class: `stat ${cls}` }, h('b', null, n), h('span', null, label)); }

// ---- Session info tab ------------------------------------------------------
function buildInfoView(s) {
  const el = h('div', { class: 'page narrow info-page' });
  function draw() {
    const info = s.info;
    if (!info) return;
    const joinUrl = `${location.origin}/join/${info.code}`;
    const onlineIds = new Set(s.online.map(o => o.id));
    const isOwner = s.me?.isOwner;
    el.replaceChildren(
      h('section', { class: 'card code-card' },
        h('p', { class: 'eyebrow' }, 'Session code'),
        h('div', { class: 'big-code', 'aria-label': `Code ${info.code.split('').join(' ')}` }, info.code),
        h('p', { class: 'muted' }, 'Refs join at ', h('span', { class: 'mono' }, `${location.host}/join`), ' with this code — or send them the link.'),
        h('div', { class: 'row gap center-row' },
          h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(joinUrl); toast('Join link copied'); } catch { toast(joinUrl); } } }, icon('copy', 18), 'Copy link'),
          navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ title: `Join ${info.name} on BhagamRef`, text: `Join my BhagamRef session with code ${info.code}`, url: joinUrl }).catch(() => {}) }, icon('share', 18), 'Share') : null)),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, info.name),
        h('dl', { class: 'facts' },
          h('dt', null, 'Event'), h('dd', null, info.eventName),
          h('dt', null, 'SKU'), h('dd', { class: 'mono' }, h('a', { href: `https://www.robotevents.com/robot-competitions/vex-robotics-competition/${info.eventSku}.html`, target: '_blank', rel: 'noopener' }, info.eventSku)),
          info.eventLocation ? [h('dt', null, 'Venue'), h('dd', null, info.eventLocation)] : null,
          h('dt', null, 'Day'), h('dd', null, fmtDate(info.date)),
          h('dt', null, 'You'), h('dd', null, `${s.me?.name} (${isOwner ? 'owner' : s.me?.role === 'guest' ? 'guest' : 'ref'})`)),
        isOwner ? h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onclick: () => openRenameSheet(s) }, icon('edit', 16), 'Edit')) : null),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, `Refs (${s.participants.length})`),
        h('ul', { class: 'people' }, ...s.participants.map(p => h('li', null,
          h('i', { class: 'presence' + (onlineIds.has(p.id) ? ' on' : '') }),
          h('span', null, p.name), p.role === 'owner' ? h('span', { class: 'tag' }, 'owner') : p.role === 'guest' ? h('span', { class: 'tag muted' }, 'guest') : null,
          h('span', { class: 'muted small push' }, onlineIds.has(p.id) ? 'online' : `seen ${fmtAgo(p.lastSeen)}`))))),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Data'),
        h('p', { class: 'muted' }, `${s.violations.size} violations logged. Changes made offline are kept on this device and sent automatically when you reconnect.`),
        h('div', { class: 'row gap' },
          h('a', { class: 'btn', href: `/api/s/${s.code}/export.csv`, download: `bhagamref-${s.code}.csv` }, icon('download', 18), 'Export CSV'),
          h('a', { class: 'btn ghost', href: app.rules?.source, target: '_blank', rel: 'noopener' }, `Game manual v${app.rules?.version}`))),
      h('section', { class: 'card danger-zone' },
        isOwner
          ? h('div', { class: 'row gap' },
              h('button', { class: 'btn', onclick: async () => { try { await api('PATCH', `/api/sessions/${s.code}`, { archived: !info.archived }); toast(info.archived ? 'Session restored' : 'Session archived'); refetchState(s); } catch (e) { toast(e.message, 'error'); } } }, info.archived ? 'Unarchive' : 'Archive'),
              h('button', { class: 'btn danger', onclick: () => confirmSheet({ title: 'Delete this session?', body: `This permanently deletes "${info.name}" and all ${s.violations.size} logged violations for every ref. It can't be undone. Export the CSV first if you need a record.`, confirm: 'Delete forever', danger: true, onConfirm: async () => { try { await api('DELETE', `/api/sessions/${s.code}`); store.del(`br_outbox_${s.code}`); toast('Session deleted'); navigate('/', { replace: true }); } catch (e) { toast(e.message, 'error'); } } }) }, icon('trash', 18), 'Delete session'))
          : h('button', { class: 'btn', onclick: () => confirmSheet({ title: 'Leave this session?', body: s.outbox.length ? `You have ${s.outbox.length} change(s) that haven't synced yet — they will be lost.` : 'You can rejoin any time with the code.', confirm: 'Leave', danger: !!s.outbox.length, onConfirm: async () => { try { await api('POST', `/api/s/${s.code}/leave`); } catch {} store.del(`br_outbox_${s.code}`); navigate('/', { replace: true }); } }) }, 'Leave session')));
  }
  return { el, update: draw };
}

// ---------------------------------------------------------------------------
// Sheets (bottom sheet on phones, centered dialog on tablets)
// ---------------------------------------------------------------------------
const sheetState = { el: null, onDataChange: null, lastFocus: null };

function openSheet(content, { onDataChange, label = 'Dialog', wide = false } = {}) {
  closeSheet(true);
  sheetState.lastFocus = document.activeElement;
  const panel = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }), content);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === backdrop) closeSheet(); } }, panel);
  $('#sheet-root').replaceChildren(backdrop);
  document.body.classList.add('sheet-open');
  sheetState.el = backdrop;
  sheetState.onDataChange = onDataChange || null;
  requestAnimationFrame(() => backdrop.classList.add('in'));
  return panel;
}
function closeSheet(immediate = false) {
  const el = sheetState.el;
  if (!el) return;
  sheetState.el = null;
  sheetState.onDataChange = null;
  document.body.classList.remove('sheet-open');
  if (immediate) el.remove();
  else { el.classList.remove('in'); setTimeout(() => el.remove(), 220); }
  sheetState.lastFocus?.focus?.({ preventScroll: true });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetState.el) closeSheet(); });

function confirmSheet({ title, body, confirm, danger, onConfirm }) {
  openSheet(h('div', { class: 'sheet-body' },
    h('h2', { class: 'sheet-title' }, title),
    h('p', { class: 'muted' }, body),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', onclick: () => closeSheet() }, 'Cancel'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { closeSheet(); onConfirm(); } }, confirm))), { label: title });
}

function recentRules() { return store.get('br_recent_rules', []); }
function pushRecentRule(code) { store.set('br_recent_rules', [code, ...recentRules().filter(c => c !== code)].slice(0, 6)); }

/**
 * Add or edit a violation.
 * opts: { match, team, alliance, severity } for new, or { existing } to edit.
 */
function openViolationSheet(s, opts) {
  const existing = opts.existing || null;
  const st = {
    severity: existing?.severity || opts.severity || 'minor',
    rule: existing?.rule || null,
    comment: existing?.comment || '',
    q: '',
    cat: 'all',
  };
  const team = existing?.team || opts.team;
  const matchName = existing?.matchName || opts.match?.label || '';
  const alliance = existing?.alliance || opts.alliance || null;
  const prior = (violationsByTeam(s).get(team) || []).filter(v => v.id !== existing?.id);
  const priorByRule = new Map();
  for (const v of prior) priorByRule.set(v.rule, (priorByRule.get(v.rule) || 0) + 1);

  const sevSeg = segmented([['minor', 'Minor'], ['major', 'Major']], st.severity, v => { st.severity = v; panel.dataset.sev = v; drawFooter(); });
  sevSeg.el.classList.add('sev-seg');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search rules — SG6, holding, expansion…', autocomplete: 'off', 'aria-label': 'Search rules', enterkeyhint: 'search' });
  search.addEventListener('input', () => { st.q = search.value; drawRules(); });
  const cats = h('div', { class: 'cat-chips', role: 'tablist' });
  const ruleList = h('div', { class: 'rule-list', role: 'listbox', 'aria-label': 'Rules' });
  const comment = h('textarea', { class: 'input', rows: 2, maxlength: 1000, placeholder: 'What happened? (optional) — e.g. held 4621F against the wall ~5s', 'aria-label': 'Comment' });
  comment.value = st.comment;
  comment.addEventListener('input', () => { st.comment = comment.value; });
  const selectedEl = h('div', { class: 'selected-rule' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: save });
  const footer = h('div', { class: 'sheet-footer' });

  function drawCats() {
    const list = [['all', 'All'], ...app.rules.categories.map(c => [c.id, c.id])];
    cats.replaceChildren(...list.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(st.cat === id), class: 'chip' + (st.cat === id ? ' on' : ''),
      title: id === 'all' ? 'All rules' : app.rules.categories.find(c => c.id === id)?.name,
      onclick: () => { st.cat = id; drawCats(); drawRules(); ruleList.scrollTop = 0; },
    }, label)));
  }

  function ruleRow(r) {
    const n = priorByRule.get(r.code);
    return h('button', {
      type: 'button', role: 'option', 'aria-selected': String(st.rule === r.code), class: 'rule-row' + (st.rule === r.code ? ' on' : ''),
      onclick: () => { st.rule = r.code; drawRules(); drawFooter(); },
    }, h('span', { class: 'rule-code' }, r.code), h('span', { class: 'rule-title' }, r.title), n ? h('span', { class: 'rule-prior', title: `${team} already has ${n} for this rule today` }, `×${n}`) : null);
  }

  function drawRules() {
    const terms = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = r => terms.every(t => `${r.code} ${r.title}`.toLowerCase().includes(t));
    const nodes = [];
    if (!terms.length && st.cat === 'all') {
      const recent = recentRules().map(c => app.ruleIndex.get(c)).filter(Boolean);
      if (recent.length) nodes.push(h('div', { class: 'rule-group-label' }, 'Recently used'), ...recent.map(ruleRow));
    }
    for (const c of app.rules.categories) {
      if (st.cat !== 'all' && st.cat !== c.id) continue;
      const rules = c.rules.filter(match);
      if (!rules.length) continue;
      nodes.push(h('div', { class: 'rule-group-label' }, `${c.name} · ${c.id}`), ...rules.map(ruleRow));
    }
    if (!nodes.length) nodes.push(h('p', { class: 'muted pad' }, 'No rules match.'));
    const scroll = ruleList.scrollTop;
    ruleList.replaceChildren(...nodes);
    ruleList.scrollTop = scroll;
  }

  function drawFooter() {
    const r = st.rule && app.ruleIndex.get(st.rule);
    selectedEl.replaceChildren(r
      ? h('span', null, h('strong', null, r.code), ' ', r.title, priorByRule.get(r.code) ? h('span', { class: 'warn' }, ` — ${ordinal(priorByRule.get(r.code) + 1)} ${r.code} for ${team} today`) : null)
      : h('span', { class: 'muted' }, 'Pick a rule'));
    saveBtn.disabled = !r;
    saveBtn.textContent = existing ? 'Save changes' : `Log ${st.severity}`;
    saveBtn.className = `btn ${st.severity === 'major' ? 'major-fill' : 'minor-fill'}`;
  }

  function save() {
    if (!st.rule) return;
    pushRecentRule(st.rule);
    if (existing) {
      const patch = {};
      if (st.severity !== existing.severity) patch.severity = st.severity;
      if (st.rule !== existing.rule) patch.rule = st.rule;
      if (st.comment.trim() !== (existing.comment || '')) patch.comment = st.comment.trim();
      if (Object.keys(patch).length) enqueue({ kind: 'update', id: existing.id, patch: { ...patch, updatedAt: Date.now(), updatedByName: s.me?.name } });
      closeSheet();
      toast('Violation updated');
      return;
    }
    const m = opts.match;
    enqueue({ kind: 'create', v: {
      id: uuid(), matchKey: m.key, matchName: m.label, division: m.division ?? s.division, team, alliance,
      severity: st.severity, rule: st.rule, comment: st.comment.trim(),
      createdAt: Date.now(), updatedAt: Date.now(), createdBy: s.me?.id, createdByName: s.me?.name || 'You',
    } });
    closeSheet();
    toast(`${st.severity === 'major' ? 'Major' : 'Minor'} ${st.rule} logged for ${team}`);
  }

  const canDelete = existing && (s.me?.isOwner || existing.createdBy === s.me?.id || existing.pending);
  footer.append(
    selectedEl,
    h('div', { class: 'sheet-actions' },
      existing && canDelete ? h('button', { class: 'btn danger-ghost', type: 'button', onclick: () => confirmSheet({ title: `Delete ${existing.rule} on ${existing.team}?`, body: `${existing.severity === 'major' ? 'Major' : 'Minor'} · ${existing.matchName} · logged by ${existing.createdByName}. This removes it for every ref.`, confirm: 'Delete', danger: true, onConfirm: () => { enqueue({ kind: 'delete', id: existing.id }); toast('Violation deleted'); } }) }, icon('trash', 18)) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Cancel'),
      saveBtn));

  const panel = openSheet(h('div', { class: 'sheet-body violation-sheet' },
    h('div', { class: 'vs-head' },
      h('div', null,
        h('div', { class: 'vs-team' }, h('span', { class: `adot ${alliance || ''}` }), team),
        h('div', { class: 'muted small' }, [matchName, alliance ? `${alliance[0].toUpperCase()}${alliance.slice(1)} alliance` : null, existing ? `logged by ${existing.createdByName} at ${fmtTime(existing.createdAt)}${existing.updatedByName ? ` · edited by ${existing.updatedByName}` : ''}` : null].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('x'))),
    sevSeg.el,
    h('div', { class: 'search-wrap' }, icon('search', 18), search),
    cats,
    ruleList,
    comment,
    footer), { label: existing ? 'Edit violation' : `Log violation for ${team}`, wide: true });
  panel.dataset.sev = st.severity;
  drawCats(); drawRules(); drawFooter();
  if (st.rule) requestAnimationFrame(() => ruleList.querySelector('.rule-row.on')?.scrollIntoView({ block: 'center' }));
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function openCustomMatchSheet(s) {
  const err = h('div', { class: 'error-box', hidden: true });
  const listId = 'teams-datalist';
  const datalist = h('datalist', { id: listId }, ...(s.teams || []).map(t => h('option', { value: t.number }, t.name || '')));
  const teamInput = (label) => h('input', { class: 'input mono', list: listId, placeholder: label, autocapitalize: 'characters', autocomplete: 'off', maxlength: 12, 'aria-label': label });
  const name = h('input', { class: 'input', placeholder: 'e.g. Q12', maxlength: 24, autocapitalize: 'characters', autocomplete: 'off' });
  const reds = [teamInput('Red team 1'), teamInput('Red team 2')];
  const blues = [teamInput('Blue team 1'), teamInput('Blue team 2')];
  const save = () => {
    const red = reds.map(i => i.value.trim().toUpperCase()).filter(Boolean);
    const blue = blues.map(i => i.value.trim().toUpperCase()).filter(Boolean);
    if (!name.value.trim()) { err.textContent = 'Give the match a name.'; err.hidden = false; return; }
    if (!red.length && !blue.length) { err.textContent = 'Add at least one team.'; err.hidden = false; return; }
    const id = uuid();
    const m = { key: `custom:${id}`, id, custom: true, division: s.division, label: name.value.trim(), name: name.value.trim(),
      red: { score: null, teams: red.map(n => ({ number: n })) }, blue: { score: null, teams: blue.map(n => ({ number: n })) }, sort: 1e9 + Date.now() / 1e6, createdAt: Date.now() };
    enqueue({ kind: 'createMatch', m });
    closeSheet();
    navigate(`/s/${s.code}/m/${encodeURIComponent(m.key)}`);
  };
  openSheet(h('form', { class: 'sheet-body', onsubmit: e => { e.preventDefault(); save(); } },
    h('div', { class: 'vs-head' }, h('h2', { class: 'sheet-title' }, 'Add a match by hand'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('x'))),
    h('p', { class: 'muted small' }, 'For when the schedule isn\'t on events.vex.com yet, or for a skills run or replay. Everyone in the session sees it.'),
    err, datalist,
    field('Match name', name),
    h('div', { class: 'two-col' },
      h('fieldset', { class: 'alliance-inputs red' }, h('legend', null, 'Red alliance'), ...reds),
      h('fieldset', { class: 'alliance-inputs blue' }, h('legend', null, 'Blue alliance'), ...blues)),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Add match'))), { label: 'Add a match' });
  name.focus();
}

function openRenameSheet(s) {
  const name = h('input', { class: 'input', maxlength: 80, value: s.info.name });
  const date = h('input', { class: 'input', type: 'date', value: s.info.date || '' });
  const err = h('div', { class: 'error-box', hidden: true });
  openSheet(h('form', { class: 'sheet-body', onsubmit: async e => {
    e.preventDefault();
    try { const { session } = await api('PATCH', `/api/sessions/${s.code}`, { name: name.value, date: date.value }); s.info = session; closeSheet(); rerender(); toast('Saved'); }
    catch (e2) { err.textContent = e2.message; err.hidden = false; }
  } },
    h('h2', { class: 'sheet-title' }, 'Edit session'), err,
    field('Name', name), field('Competition day', date),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save'))), { label: 'Edit session' });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try { await loadRules(); } catch { toast('Could not load the rule list.', 'error'); }
  route();
})();
