// DealRadar board. Source text is only ever written with textContent, never as HTML.

const PREFS_KEY = 'dealradar-prefs-v2';
const SORTS = [['price', 'Lowest'], ['newest', 'Newest'], ['percent', 'Deepest %'], ['ending', 'Ending soon']];
const TRIP_TYPES = [['all', 'All'], ['ski', 'Ski'], ['lifts', 'Near the lifts'], ['beach', 'Beach'], ['cruise', 'Cruise'], ['stays', 'Stays']];
const TRIP_LABEL = Object.fromEntries(TRIP_TYPES);
const FINEPRINT = {
  deal: 'Lowest posted on the feeds we read. The price can change in the cart. Open the link before you pay.',
  trip: 'Package prices and specials that people post. The price can change in the cart. Open the link before you pay.',
};

// Static icon paths (24x24, stroke). Not source data.
const ICONS = {
  Electronics: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  Home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  Outdoors: '<path d="m3 20 6-11 4 7 2-3 6 7z"/><circle cx="17" cy="6" r="2"/>',
  Apparel: '<path d="M8 4 3 7l2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
  Tools: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2z"/>',
  Other: '<path d="M20 12 12 20l-8-8V4h8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  ski: '<path d="m3 20 6-11 4 7 2-3 6 7z"/><path d="m9 9 1.5-2.5"/>',
  lifts: '<path d="M3 6 21 3M8 5.3V10M16 4.3V9"/><rect x="5" y="10" width="6" height="7" rx="1.5"/><rect x="13" y="9" width="6" height="7" rx="1.5"/>',
  beach: '<path d="M12 21V9M12 9c-3-4-7-3-9 0 3-1 6-1 9 0zm0 0c3-4 7-3 9 0-3-1-6-1-9 0zM4 21h16"/>',
  cruise: '<path d="M3 15h18l-2.5 5h-13zM6 15V9h12v6M10 9V5h4v4"/>',
  stays: '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M7 9V6h10v3"/>',
  save: '<path d="M6 4h12v16l-6-4.5L6 20z"/>',
  done: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

const state = { kind: 'deal', sort: 'price', type: 'all', saved: false, responder: false, q: '', showDone: false, items: [], loading: true, error: '' };
const prefs = loadPrefs();
const $ = (id) => document.getElementById(id);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
    return { saved: Array.isArray(p.saved) ? p.saved : [], done: Array.isArray(p.done) ? p.done : [] };
  } catch {
    return { saved: [], done: [] };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* Private mode or storage full: the board still works. */
  }
}
function toggleIn(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function icon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.innerHTML = paths; // static strings from ICONS only
  return svg;
}
function money(cents) {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}
function when(iso) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
function shortAge(age) {
  return age.replace(' ago', '');
}
function endsLabel(iso) {
  const hours = (new Date(iso) - Date.now()) / 3_600_000;
  if (hours <= 24) return 'Ends today';
  const days = Math.ceil(hours / 24);
  return days <= 3 ? `Ends in ${days} days` : `Ends ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso))}`;
}
function safeHref(url) {
  try {
    return new URL(url).protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}
function outLink(node, url, affiliate) {
  node.href = safeHref(url);
  node.rel = (affiliate ? 'sponsored ' : '') + 'noopener noreferrer';
  node.target = '_blank';
  return node;
}

function iconButton(paths, label, pressed, onClick) {
  const btn = el('button', 'icon-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(pressed));
  btn.title = label;
  btn.append(icon(paths));
  btn.addEventListener('click', onClick);
  return btn;
}

function card(item) {
  const done = prefs.done.includes(item.id);
  const saved = prefs.saved.includes(item.id);
  const group = item.kind === 'trip' ? item.trip_type ?? 'stays' : item.category;
  const node = el('article', 'card' + (done ? ' is-done' : ''));

  // Photo area with the price on it. Feeds with photos fill this; until then, a tinted tile.
  const photo = outLink(el('a', `photo photo--art photo--${group in ICONS ? group : 'Other'}`), item.url, item.affiliate);
  photo.setAttribute('aria-label', `${money(item.price_cents)}: ${item.title}`);
  const art = el('span', 'photo__art');
  art.append(icon(ICONS[group] ?? ICONS.Other));
  const price = el('span', 'photo__price');
  if (item.kind === 'trip') price.append(el('small', '', 'from'));
  price.append(document.createTextNode(money(item.price_cents)));
  const flags = el('span', 'photo__flags');
  if (item.trust.status !== 'lead') flags.append(el('span', `flag flag--${item.trust.status}`, item.trust.label));
  if (item.percent_off_stated) flags.append(el('span', 'flag', `${item.percent_off_stated}% off stated`));
  if (item.expires_at) flags.append(el('span', 'flag', endsLabel(item.expires_at)));
  photo.append(art, flags, price);

  const body = el('div', 'card__body');
  const title = el('h3', 'card__title');
  title.append(outLink(el('a', '', item.title), item.url, item.affiliate));
  const meta = el('p', 'card__meta');
  const where = item.kind === 'trip' ? [item.merchant, TRIP_LABEL[group]] : [item.merchant];
  meta.textContent = [...where.filter(Boolean), shortAge(item.age)].join(' · ');
  if (item.eligibility === 'first_responder') {
    meta.append(document.createTextNode(' · '), el('strong', '', 'First responder'));
  }

  const actions = el('div', 'card__actions');
  actions.append(
    iconButton(ICONS.save, saved ? `Remove from saved: ${item.title}` : `Save: ${item.title}`, saved, () => {
      prefs.saved = toggleIn(prefs.saved, item.id);
      savePrefs();
      render();
    }),
    iconButton(ICONS.done, done ? `Bring back: ${item.title}` : `Mark as seen: ${item.title}`, done, () => {
      prefs.done = toggleIn(prefs.done, item.id);
      savePrefs();
      render();
    }),
    outLink(el('a', '', item.sources.length > 1 ? `${item.sources.length} sources` : 'Thread'), item.sources[0].url, false),
  );

  body.append(title, meta, actions, details(item));
  node.append(photo, body);
  return node;
}

// Everything that backs the price lives here, one tap away.
function details(item) {
  const box = el('details', 'info');
  box.append(el('summary', '', 'Price details'));
  const list = el('div', 'info__list');
  const line = (text, cls) => list.append(el('p', cls, text));

  line(`${item.trust.label}: ${item.trust.note}`);
  if (item.was_price_cents) line(`Stated was price ${money(item.was_price_cents)} (${item.percent_off_stated}% off vs stated was price).`);
  for (const cost of item.extra_costs) {
    line(cost.amount_cents != null ? `Plus ${cost.label.toLowerCase()}: ${money(cost.amount_cents)}` : `Plus ${cost.label.toLowerCase()}: amount not listed`);
  }
  if (item.all_in_cents != null) line(`About ${money(item.all_in_cents)} all-in${item.has_unknown_costs ? ', plus fees not listed' : ''}.`, 'info__warn');
  if (item.eligibility === 'first_responder') line(`First responders only${item.verification ? `. ${item.verification}.` : '.'}`);
  if (!item.stock_checked) line('Not stock-checked.');
  if (item.affiliate) line('Affiliate link.');
  if (item.summary) line(item.summary);

  for (const s of item.sources) {
    const p = el('p');
    p.append(outLink(el('a', '', s.name), s.url, false), document.createTextNode(` · ${money(s.price_cents)} · posted ${s.age} (${when(s.posted_at)})`));
    list.append(p);
  }
  box.append(list);
  return box;
}

function stateBox(titleText, text, action) {
  const box = el('div', 'state');
  box.append(el('p', 'state__title', titleText), el('p', 'state__text', text));
  if (action) box.append(action);
  return box;
}

function visibleItems() {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = state.items.filter((item) => {
    if (!state.showDone && prefs.done.includes(item.id)) return false;
    if (state.saved && !prefs.saved.includes(item.id)) return false;
    if (state.responder && item.eligibility !== 'first_responder') return false;
    if (state.kind === 'trip' && state.type !== 'all' && item.trip_type !== state.type) return false;
    const hay = `${item.title} ${item.summary} ${item.merchant}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const byPrice = (a, b) => a.price_cents - b.price_cents;
  if (state.kind === 'deal' && state.sort === 'newest') list.sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  else if (state.kind === 'deal' && state.sort === 'percent') list.sort((a, b) => (b.percent_off_stated ?? 0) - (a.percent_off_stated ?? 0) || byPrice(a, b));
  else if (state.kind === 'deal' && state.sort === 'ending') list.sort((a, b) => (a.expires_at ?? '9999').localeCompare(b.expires_at ?? '9999') || byPrice(a, b));
  else list.sort(byPrice);
  return list;
}

function pill(label, pressed, onClick) {
  const node = el('button', 'pill', label);
  node.type = 'button';
  node.setAttribute('aria-pressed', String(pressed));
  node.addEventListener('click', () => {
    onClick();
    renderPills();
    render();
  });
  return node;
}

function renderPills() {
  const main =
    state.kind === 'deal'
      ? SORTS.map(([value, label]) => pill(label, state.sort === value, () => (state.sort = value)))
      : TRIP_TYPES.map(([value, label]) => pill(label, state.type === value, () => (state.type = value)));
  $('pills').replaceChildren(
    ...main,
    el('span', 'pills__gap'),
    pill('Saved', state.saved, () => (state.saved = !state.saved)),
    pill('First responder', state.responder, () => (state.responder = !state.responder)),
  );
}

function render() {
  const board = $('board');
  const noun = state.kind === 'trip' ? 'trips' : 'deals';
  board.setAttribute('aria-busy', String(state.loading));

  if (state.loading) {
    board.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'skeleton')));
    $('count').textContent = '';
    return;
  }
  if (state.error) {
    const retry = el('button', 'btn btn--ink', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', load);
    board.replaceChildren(stateBox(`We couldn’t load ${noun}`, state.error, retry));
    $('count').textContent = '';
    return;
  }

  const list = visibleItems();
  $('count').textContent = String(list.length);
  $('count').setAttribute('aria-label', `${list.length} ${noun}`);
  const doneCount = state.items.filter((i) => prefs.done.includes(i.id)).length;
  const toggle = $('toggle-done');
  toggle.hidden = doneCount === 0;
  toggle.textContent = state.showDone ? 'Stop showing seen' : `Show seen (${doneCount})`;

  if (!list.length) {
    const filtered = state.q || state.saved || state.responder || state.type !== 'all';
    let action = null;
    if (filtered) {
      action = el('button', 'btn btn--ghost', 'Clear search and filters');
      action.type = 'button';
      action.addEventListener('click', () => {
        Object.assign(state, { q: '', saved: false, responder: false, type: 'all' });
        $('search').value = '';
        renderPills();
        render();
      });
    }
    board.replaceChildren(
      stateBox(
        filtered ? `No ${noun} match` : `No ${noun} right now`,
        state.q
          ? `Nobody has posted a price for “${state.q.trim()}” on the feeds we read. Try a shorter word.`
          : filtered
            ? 'Nothing fits these filters.'
            : 'Expired listings drop off on their own. Check back after the next refresh.',
        action,
      ),
    );
    return;
  }
  board.replaceChildren(...list.map(card));
}

async function load() {
  state.loading = true;
  state.error = '';
  render();
  try {
    const res = await fetch(`/api/items?kind=${state.kind}`);
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    state.items = (await res.json()).items;
  } catch {
    state.error = 'Check your connection and try again.';
  }
  state.loading = false;
  render();
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    const enabled = data.sources.filter((s) => s.enabled);
    const failed = enabled.filter((s) => s.ok === false);
    $('sample-banner').hidden = !data.sample_only;
    $('source-alert').hidden = failed.length === 0;
    $('source-alert').textContent = failed.length ? `${failed.map((s) => s.name).join(', ')} did not load. Other prices are still here.` : '';
    $('as-of').textContent = `Board as of ${when(data.as_of)}.`;
    $('sources').replaceChildren(
      ...enabled.map((s) => {
        const li = el('li');
        const detail = s.ok === null ? 'not fetched yet' : s.ok ? `${s.item_count} listings, fetched ${when(s.last_fetch)}` : `did not load: ${s.error || 'unknown error'}`;
        li.append(el('span', `dot ${s.ok === true ? 'dot--ok' : s.ok === false ? 'dot--bad' : ''}`), el('strong', '', s.name), el('span', '', detail));
        return li;
      }),
    );
  } catch {
    /* The board itself reports connection problems. */
  }
}

// Next big sale day, worked out from the calendar. No claims about what will be on sale.
function nextSaleDay(now = new Date()) {
  const events = [];
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const nov1 = new Date(year, 10, 1);
    const thanksgiving = 1 + ((4 - nov1.getDay() + 7) % 7) + 21; // fourth Thursday
    events.push({ name: `Black Friday ${year}`, at: new Date(year, 10, thanksgiving + 1) });
    events.push({ name: `Cyber Monday ${year}`, at: new Date(year, 10, thanksgiving + 4) });
  }
  return events.find((e) => e.at > now && e.at - now < 45 * 86_400_000) ?? null;
}
function renderCountdown() {
  const event = nextSaleDay();
  $('countdown').hidden = !event;
  if (!event) return;
  const mins = Math.floor((event.at - Date.now()) / 60_000);
  $('countdown-name').textContent = event.name;
  $('countdown-time').textContent = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', 'toast', message);
  node.setAttribute('role', 'status');
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

function selectTab(kind) {
  Object.assign(state, { kind, type: 'all', q: '' });
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.kind === kind;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  $('board').setAttribute('aria-labelledby', `tab-${kind}`);
  $('page-title').textContent = kind === 'trip' ? 'Trips' : 'Deals';
  $('search').value = '';
  $('search').placeholder = kind === 'trip' ? 'Type a place, like Colorado ski' : 'Type a product, like security cameras';
  $('fineprint').textContent = FINEPRINT[kind];
  renderPills();
  load();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.kind));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tab.dataset.kind === 'deal' ? 'trip' : 'deal';
    selectTab(next);
    $(`tab-${next}`).focus();
  });
}
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = $('search').value;
  render();
  $('search').blur();
});
$('search').addEventListener('input', (e) => {
  state.q = e.target.value;
  render();
});
$('toggle-done').addEventListener('click', () => {
  state.showDone = !state.showDone;
  render();
});
$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.disabled = true;
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) toast(data.error ?? 'Refreshed a moment ago.');
    else if (!res.ok) toast('Refresh failed. Try again shortly.');
    else {
      toast('Refreshed.');
      await Promise.all([load(), loadStatus()]);
    }
  } catch {
    toast('Refresh failed. Check your connection.');
  }
  btn.disabled = false;
});

// Open on Trips when the address ends in #trips, so the tab can be linked to.
$('fineprint').textContent = FINEPRINT.deal;
renderCountdown();
loadStatus();
if (location.hash === '#trips') selectTab('trip');
else {
  renderPills();
  load();
}
