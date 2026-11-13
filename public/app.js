// DealRadar board. Source text is only ever written with textContent, never as HTML.

const PREFS_KEY = 'dealradar-prefs-v1';
const FILTERS = {
  deal: [['all', 'All'], ['Electronics', 'Electronics'], ['Home', 'Home'], ['Outdoors', 'Outdoors'], ['Apparel', 'Apparel'], ['Tools', 'Tools'], ['Other', 'Other']],
  trip: [['all', 'All'], ['ski', 'Ski'], ['lifts', 'Near the lifts'], ['beach', 'Beach'], ['cruise', 'Cruise'], ['stays', 'Stays']],
};
const TRIP_LABEL = Object.fromEntries(FILTERS.trip);

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
  trust: {
    lead: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.2"/>',
    confirmed: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.5"/>',
    expected: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  },
  warn: '<path d="M12 4 2.5 20h19zM12 10v4.5M12 17v.2"/>',
  empty: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
};

const state = { kind: 'deal', filter: 'all', responder: false, q: '', sort: 'price', showHidden: false, items: [], loading: true, error: '' };
const prefs = loadPrefs();
const seenAtLoad = new Set(prefs.seen);
const $ = (id) => document.getElementById(id);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
    return { hidden: Array.isArray(p.hidden) ? p.hidden : [], seen: Array.isArray(p.seen) ? p.seen : [] };
  } catch {
    return { hidden: [], seen: [] };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* Private mode or storage full: the board still works. */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function icon(paths, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
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

function card(item) {
  const hidden = prefs.hidden.includes(item.id);
  const node = el('article', 'card' + (hidden ? ' is-hidden' : ''));
  const group = item.kind === 'trip' ? item.trip_type ?? 'stays' : item.category;

  const tile = el('div', `tile tile--${group}`);
  tile.append(icon(ICONS[group] ?? ICONS.Other));
  const badges = el('div', 'tile__badges');
  const trust = el('span', `badge badge--${item.trust.status}`);
  trust.title = item.trust.note;
  trust.append(icon(ICONS.trust[item.trust.status]), el('span', '', item.trust.label));
  badges.append(trust);
  if (!seenAtLoad.has(item.id)) badges.append(el('span', 'badge badge--new', 'New'));
  tile.append(badges);

  const body = el('div', 'card__body');
  const groupLabel = item.kind === 'trip' ? TRIP_LABEL[group] ?? 'Trip' : item.category;
  body.append(el('p', 'card__meta', [item.merchant, groupLabel].filter(Boolean).join(' · ')));

  const title = el('h3', 'card__title');
  const link = el('a', '', item.title);
  link.href = safeHref(item.url);
  link.rel = (item.affiliate ? 'sponsored ' : '') + 'noopener noreferrer';
  link.target = '_blank';
  title.append(link);
  body.append(title);
  if (item.summary) body.append(el('p', 'card__summary', item.summary));

  const price = el('div', 'price');
  price.append(el('span', 'price__now', money(item.price_cents)));
  if (item.was_price_cents) {
    const was = el('span', 'price__was', money(item.was_price_cents));
    was.setAttribute('aria-label', `Stated was price ${money(item.was_price_cents)}`);
    const off = el('span', 'price__off');
    off.append(el('strong', '', `${item.percent_off_stated}% off`), document.createTextNode(' vs stated was price'));
    price.append(was, off);
  }
  if (item.all_in_cents != null) {
    price.append(el('span', 'price__allin', `About ${money(item.all_in_cents)} all-in${item.has_unknown_costs ? ', plus fees not listed' : ''}`));
  }
  body.append(price);

  const tags = el('ul', 'tags');
  for (const cost of item.extra_costs) {
    tags.append(el('li', 'tag tag--cost', cost.amount_cents != null ? `${cost.label} ${money(cost.amount_cents)}` : `${cost.label} (amount not listed)`));
  }
  if (item.eligibility === 'first_responder') {
    tags.append(el('li', 'tag tag--hero', item.verification ? `First responder · ${item.verification}` : 'First responder'));
  }
  if (item.expires_at) tags.append(el('li', 'tag tag--soon', endsLabel(item.expires_at)));
  if (!item.stock_checked) tags.append(el('li', 'tag', 'Not stock-checked'));
  if (item.affiliate) tags.append(el('li', 'tag', 'Affiliate link'));
  body.append(tags);

  if (item.cart_warning) {
    const warn = el('p', 'warnline');
    warn.append(icon(ICONS.warn), el('span', '', item.cart_warning));
    body.append(warn);
  }

  const prov = el('div', 'prov');
  const posted = el('p', '');
  posted.append(document.createTextNode(`Posted ${item.age} · `));
  const time = el('time', '', when(item.posted_at));
  time.dateTime = item.posted_at;
  posted.append(time);
  prov.append(posted);
  const seen = el('p', '');
  seen.append(document.createTextNode(item.sources.length > 1 ? `Seen at ${item.sources.length} sources: ` : 'Source: '));
  item.sources.forEach((s, i) => {
    if (i) seen.append(document.createTextNode(', '));
    const a = el('a', '', s.name);
    a.href = safeHref(s.url);
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    seen.append(a);
    if (item.sources.length > 1) seen.append(document.createTextNode(` (${money(s.price_cents)}, ${s.age})`));
  });
  prov.append(seen);
  prov.append(el('p', 'prov__note', item.trust.note));
  body.append(prov);

  const actions = el('div', 'card__actions');
  const open = el('a', 'btn btn--primary', item.kind === 'trip' ? 'Open trip' : 'Open deal');
  open.href = link.href;
  open.rel = link.rel;
  open.target = '_blank';
  const hide = el('button', 'btn btn--quiet', hidden ? 'Unhide' : 'Hide');
  hide.type = 'button';
  hide.setAttribute('aria-label', `${hidden ? 'Unhide' : 'Hide'}: ${item.title}`);
  hide.addEventListener('click', () => {
    prefs.hidden = hidden ? prefs.hidden.filter((id) => id !== item.id) : [...prefs.hidden, item.id];
    savePrefs();
    render();
  });
  actions.append(open, hide);
  body.append(actions);

  node.append(tile, body);
  return node;
}

function stateBox(kind, titleText, text, action) {
  const box = el('div', `state${kind === 'error' ? ' state--error' : ''}`);
  box.append(icon(kind === 'error' ? ICONS.warn : ICONS.empty), el('p', 'state__title', titleText), el('p', 'state__text', text));
  if (action) box.append(action);
  return box;
}

function visibleItems() {
  const q = state.q.trim().toLowerCase();
  const list = state.items.filter((item) => {
    if (!state.showHidden && prefs.hidden.includes(item.id)) return false;
    if (state.filter !== 'all' && (item.kind === 'trip' ? item.trip_type : item.category) !== state.filter) return false;
    if (state.responder && item.eligibility !== 'first_responder') return false;
    if (q && !`${item.title} ${item.summary} ${item.merchant}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (state.sort === 'newest') list.sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  else if (state.sort === 'ending') list.sort((a, b) => (a.expires_at ?? '9999').localeCompare(b.expires_at ?? '9999') || a.price_cents - b.price_cents);
  else list.sort((a, b) => a.price_cents - b.price_cents);
  return list;
}

function renderChips() {
  const chips = $('chips');
  const filterChips = FILTERS[state.kind].map(([value, label]) => {
      const chip = el('button', 'chip', label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(state.filter === value));
      chip.addEventListener('click', () => {
        state.filter = value;
        renderChips();
        render();
      });
      return chip;
  });
  // "All" first, then the responder toggle so it is visible on a phone without scrolling.
  chips.replaceChildren(filterChips[0], responderChip(), ...filterChips.slice(1));
}

function responderChip() {
  const chip = el('button', 'chip chip--hero', 'First responder');
  chip.type = 'button';
  chip.setAttribute('aria-pressed', String(state.responder));
  chip.title = 'Show only discounts for fire, police, and EMS';
  chip.addEventListener('click', () => {
    state.responder = !state.responder;
    renderChips();
    render();
  });
  return chip;
}

function render() {
  const board = $('board');
  const noun = state.kind === 'trip' ? 'trip' : 'deal';
  board.setAttribute('aria-busy', String(state.loading));

  if (state.loading) {
    board.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'skeleton')));
    $('count').textContent = `Loading ${noun}s…`;
    return;
  }
  if (state.error) {
    const retry = el('button', 'btn btn--primary', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', load);
    board.replaceChildren(stateBox('error', `We couldn’t load ${noun}s`, state.error, retry));
    $('count').textContent = '';
    return;
  }

  const list = visibleItems();
  const hiddenCount = state.items.filter((i) => prefs.hidden.includes(i.id)).length;
  const toggle = $('toggle-hidden');
  toggle.hidden = hiddenCount === 0;
  toggle.textContent = state.showHidden ? 'Stop showing hidden' : `Show hidden (${hiddenCount})`;
  $('count').textContent = `${list.length} ${noun}${list.length === 1 ? '' : 's'} · lowest posted price first`.replace(
    'lowest posted price first',
    { price: 'lowest posted price first', newest: 'newest first', ending: 'ending soonest first' }[state.sort],
  );

  if (!list.length) {
    const filtered = state.q || state.filter !== 'all' || state.responder;
    let action = null;
    if (filtered) {
      action = el('button', 'btn btn--quiet', 'Clear search and filters');
      action.type = 'button';
      action.addEventListener('click', () => {
        state.q = '';
        state.filter = 'all';
        state.responder = false;
        $('search').value = '';
        renderChips();
        render();
      });
    }
    board.replaceChildren(
      stateBox(
        'empty',
        filtered ? `No ${noun}s match` : `No ${noun}s right now`,
        filtered ? 'Try a different word or clear the filters.' : 'Expired listings drop off on their own. Check back after the next refresh.',
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
    const data = await res.json();
    state.items = data.items;
    prefs.seen = [...new Set([...prefs.seen, ...data.items.map((i) => i.id)])].slice(-2000);
    savePrefs();
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
    $('sample-banner').hidden = !data.sample_only;
    $('as-of').textContent = `Board as of ${when(data.as_of)}.`;
    $('sources').replaceChildren(
      ...data.sources.filter((s) => s.enabled).map((s) => {
        const li = el('li');
        li.append(el('span', `dot ${s.ok === true ? 'dot--ok' : s.ok === false ? 'dot--bad' : ''}`));
        const detail =
          s.ok === null ? 'not fetched yet' : s.ok ? `${s.item_count} listings, fetched ${when(s.last_fetch)}` : `failed: ${s.error || 'unknown error'}`;
        li.append(el('strong', '', s.name), el('span', '', detail));
        return li;
      }),
    );
  } catch {
    /* The board itself reports connection problems. */
  }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', 'toast', message);
  node.setAttribute('role', 'status');
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

function selectTab(kind) {
  state.kind = kind;
  state.filter = 'all';
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.kind === kind;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  $('board').setAttribute('aria-labelledby', `tab-${kind}`);
  $('search').placeholder = kind === 'trip' ? 'Search trips' : 'Search deals';
  renderChips();
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
$('search').addEventListener('input', (e) => {
  state.q = e.target.value;
  render();
});
$('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  render();
});
$('toggle-hidden').addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  render();
});
$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.disabled = true;
  btn.classList.add('is-busy');
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) toast(data.error ?? 'Refreshed a moment ago.');
    else if (!res.ok) toast('Refresh failed. Try again shortly.');
    else {
      const failed = (data.results ?? []).filter((r) => !r.ok).length;
      toast(failed ? `Refreshed. ${failed} source${failed === 1 ? '' : 's'} failed.` : 'Refreshed.');
      await Promise.all([load(), loadStatus()]);
    }
  } catch {
    toast('Refresh failed. Check your connection.');
  }
  btn.disabled = false;
  btn.classList.remove('is-busy');
});

renderChips();
load();
loadStatus();
