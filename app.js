// Pin Wei Spend — single-page app. Every piece of data shown here was already
// filtered by the backend for this user; the frontend only lays it out.

(function () {
  const state = {
    user: null,
    ref: null,
    limits: null,
    views: { mine: [], to_approve: [], to_pay: [], to_check: [], to_fix: [] },
    detail: null,   // last expense opened, reused by the edit form
    cash: null,     // petty cash book, loaded when its tab is opened
  };

  // ------------------------------------------------------------ DOM helpers

  /** h('div.card', {onclick}, [children]) — text children are escaped. */
  function h(spec, attrs, children) {
    const parts = spec.split('.');
    const el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  const $app = function () { return document.getElementById('app'); };
  function mount(node, keepScroll) {
    const y = window.scrollY;
    const root = $app();
    root.textContent = '';
    root.appendChild(node);
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function toast(message, kind) {
    // One message at a time: a new one replaces the one on screen.
    document.querySelectorAll('.toast').forEach(function (old) { old.remove(); });
    const el = h('div.toast' + (kind ? '.' + kind : ''), { role: 'status', text: message });
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3500);
  }

  /** Tiles that act as one radio group: a single Tab stop (the chosen tile, or the first one). */
  function radioTabStop(group) {
    const tiles = [].slice.call(group.querySelectorAll('[role=radio]'));
    const stop = tiles.filter(function (b) { return b.getAttribute('aria-checked') === 'true'; })[0] || tiles[0];
    tiles.forEach(function (b) { b.tabIndex = b === stop ? 0 : -1; });
  }
  /** Arrow keys move between the tiles of a group; Space or Enter chooses, as a tap does. */
  function radioKeys(group) {
    group.addEventListener('keydown', function (ev) {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      const tiles = [].slice.call(group.querySelectorAll('[role=radio]'));
      const at = tiles.indexOf(document.activeElement);
      if (!step || at === -1) return;
      ev.preventDefault();
      tiles[(at + step + tiles.length) % tiles.length].focus();
    });
  }

  // --------------------------------------------------------------- formats

  const money = new Intl.NumberFormat('en-US');
  function fmtMoney(n) { return n === '' || n === null || n === undefined ? '' : money.format(Number(n)) + ' ₫'; }
  /** "350,000" → "three hundred fifty thousand dong": catches a missing or extra zero before money is recorded. */
  function amountInWords(n) {
    n = Math.round(Number(n) || 0);
    if (!n) return 'zero dong';
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
      'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const small = function (x) {
      const out = [];
      if (x >= 100) { out.push(ones[Math.floor(x / 100)] + ' hundred'); x %= 100; }
      if (x >= 20) out.push(tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : ''));
      else if (x) out.push(ones[x]);
      return out.join(' ');
    };
    const words = [];
    [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']].forEach(function (s) {
      if (n >= s[0]) { words.push(small(Math.floor(n / s[0])) + ' ' + s[1]); n %= s[0]; }
    });
    if (n) words.push(small(n));
    return words.join(' ') + ' dong';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  }
  function label(field, value) {
    const e = state.ref.enums.find(function (x) { return x.field === field && x.value === value; });
    return e ? e.label : value;
  }
  function categoryLabel(code) {
    const c = state.ref.categories.find(function (x) { return x.value === code; });
    return c ? c.label : code;
  }
  // One or two words for tiles and lists; the full wording from the Sheet is the "Covers:" line.
  const CATEGORY_SHORT = {
    FOOD: 'Food & drinks', PACKAGING: 'Packaging', SUPPLIES: 'Supplies', GAS: 'Gas', TRANSPORT: 'Transport',
    MAINTENANCE: 'Repairs', EQUIPMENT: 'Equipment', UTILITIES: 'Utilities', RENT: 'Rent', PREMISES: 'Rent & utilities', STAFF: 'Staff costs',
    MARKETING: 'Marketing', GIFTS: 'Gifts', OFFICE: 'Office & fees', SECURITY_DEPOSIT: 'Deposit', OTHER: 'Other',
  };
  // Tile order; codes added later in the Sheet go just before Other.
  const CATEGORY_ORDER = ['FOOD', 'PACKAGING', 'SUPPLIES', 'GAS', 'TRANSPORT', 'MAINTENANCE', 'EQUIPMENT',
    'PREMISES', 'UTILITIES', 'RENT', 'STAFF', 'MARKETING', 'GIFTS', 'OFFICE', 'SECURITY_DEPOSIT', 'OTHER'];
  // Rent and Utilities became one tile. The old codes stay readable on older expenses, and
  // stay on the form until the Sheet has the new category (setupSheet adds it).
  const MERGED_CATEGORIES = { RENT: 'PREMISES', UTILITIES: 'PREMISES' };
  function mergedAway(code) {
    const into = MERGED_CATEGORIES[code];
    return Boolean(into) && state.ref.categories.some(function (c) { return c.value === into; });
  }
  // No longer offered on the forms (the code stays readable on older expenses).
  const HIDDEN_CATEGORIES = ['SECURITY_DEPOSIT'];
  function offTheForm(code) { return mergedAway(code) || HIDDEN_CATEGORIES.indexOf(code) !== -1; }
  // Kitchen staff (requesters outside head office) never pay these, so they don't see them.
  const HQ_ONLY_CATEGORIES = ['RENT', 'OFFICE', 'SECURITY_DEPOSIT'];
  function categoryShort(code) {
    if (CATEGORY_SHORT[code]) return CATEGORY_SHORT[code];
    return String(categoryLabel(code)).split(',')[0];   // categories added later in the Sheet
  }
  function tileCategories(current) {
    const kitchen = state.user.role === 'REQUESTER' && state.user.outletCode !== 'HQ';
    const rank = function (code) { const i = CATEGORY_ORDER.indexOf(code); return i === -1 ? CATEGORY_ORDER.length - 1.5 : i; };
    return state.ref.categories
      .filter(function (c) { return c.value === current || (!offTheForm(c.value) && (!kitchen || HQ_ONLY_CATEGORIES.indexOf(c.value) === -1)); })
      .sort(function (a, b) { return rank(a.value) - rank(b.value); });
  }

  const STATUS_TONE = {
    NEEDS_INFO: 'warn', PENDING_APPROVAL: 'info', APPROVED: 'info', PARTIAL: 'info',
    PAID: 'ok', CLOSED: 'ok', REJECTED: 'bad', CANCELLED: 'muted', DRAFT: 'muted',
  };
  // Short badge text so a status never wraps; the full wording stays available to screen readers.
  const STATUS_SHORT = {
    PENDING_APPROVAL: 'Pending approval', NEEDS_INFO: 'Needs info', APPROVED: 'Approved',
    PARTIAL: 'Partially paid', PAID: 'Paid', CLOSED: 'Closed', REJECTED: 'Rejected', CANCELLED: 'Cancelled', DRAFT: 'Draft',
  };
  function statusChip(status) {
    const full = label('status', status);
    return h('span.chip.st-' + status, { text: STATUS_SHORT[status] || full, title: full, 'aria-label': 'Status: ' + full });
  }

  const OPEN_STATUSES = ['PENDING_APPROVAL', 'NEEDS_INFO', 'APPROVED', 'PARTIAL'];
  function isOverdue(e) {
    if (!e.due_date || OPEN_STATUSES.indexOf(e.status) === -1) return false;
    return new Date(e.due_date).getTime() < new Date(new Date().toDateString()).getTime();
  }

  // Theme: light by default (brand look); dark is opt-in and remembered.
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function toggleTheme(ev) {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pw_theme', next); } catch (err) { /* private mode */ }
    if (ev && ev.currentTarget) ev.currentTarget.textContent = next === 'dark' ? 'Light' : 'Dark';
  }

  // ----------------------------------------------------------------- router

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    if (hash === '/new') return renderForm(null);
    const edit = hash.match(/^\/edit\/(.+)$/);
    if (edit) return renderEdit(decodeURIComponent(edit[1]));
    const m = hash.match(/^\/expense\/(.+)$/);
    if (m) return renderExpense(decodeURIComponent(m[1]));
    const cashForm = hash.match(/^\/cash-(spend|deposit|count)$/);
    if (cashForm) return renderCashForm(cashForm[1]);
    const cashEntry = hash.match(/^\/cash\/(.+)$/);
    if (cashEntry) return renderCashEntry(decodeURIComponent(cashEntry[1]));
    return renderHome();
  }
  function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }

  // ------------------------------------------------------------------ shell

  function header() {
    return h('header.topbar', {}, [h('div.topbar-inner', {}, [
      h('a.brand', { href: '#/', 'aria-label': 'Pin Wei Spend, home' }, [h('img.brand-logo', { src: 'logo-96.png', alt: '' }), h('span', { text: 'Pin Wei Spend' })]),
      h('div.who', {}, [
        h('span.who-name', { text: state.user.name }),
        h('span.who-role', { text: label('role', state.user.role) }),
      ]),
      h('button.link', { type: 'button', title: 'Switch light or dark theme', text: currentTheme() === 'dark' ? 'Light' : 'Dark', onclick: toggleTheme }),
      h('button.link', { type: 'button', text: 'Sign out', onclick: function () { if (!window.confirm('Sign out of Pin Wei Spend?')) return; forgetStartData(); Api.signOut(); location.reload(); } }),
    ])]);
  }

  function page(children) {
    return h('div.page', {}, [header(), h('main.content', {}, children)]);
  }

  // ------------------------------------------------------------------- home

  const APPROVER_ROLES = ['OUTLET_MANAGER', 'OWNER', 'ADMIN'];
  const PAYER_ROLES = ['ACCOUNTANT', 'ADMIN'];
  const ALL_VIEW_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'OUTLET_MANAGER'];
  const EXPORT_MONTH_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT'];
  let doneOpen = false;       // the collapsed "Done" list stays open across refreshes
  const allFilter = { outlet: '', status: 'OPEN', q: '' };
  let payShow = '';           // "Show" dropdown on the Pay tab
  let mineShow = '';          // "Show" dropdown on the Mine tab
  let homeTab = null;
  let notSaved = [];          // decisions that could not be saved: they stay above the lists until dismissed

  /** Replaces or inserts an expense in a view list (keeps local state fresh without a reload). */
  function upsert(view, item) {
    const list = state.views[view] || (state.views[view] = []);
    const i = list.findIndex(function (x) { return x.expense_id === item.expense_id; });
    if (i === -1) list.unshift(item); else list[i] = item;
  }
  function removeFrom(view, id) {
    state.views[view] = (state.views[view] || []).filter(function (x) { return x.expense_id !== id; });
  }

  function expenseCard(e, showSubmitter) {
    const overdue = isOverdue(e);
    return h('a.item' + (overdue ? '.overdue' : ''), { href: '#/expense/' + encodeURIComponent(e.expense_id), 'data-status': e.status }, [
      h('div.item-body', {}, [
        h('div.item-top', {}, [h('span.amount', { text: fmtMoney(e.status === 'PARTIAL' ? e.balance_due : e.amount_total) + (e.status === 'PARTIAL' ? ' left' : '') }), statusChip(e.status)]),
        h('div.item-mid', { text: categoryShort(e.expense_category) + (e.supplier_name ? ' · ' + e.supplier_name : e.description ? ' · ' + e.description : '') }),
        h('div.item-meta', {}, [
          h('span', { text: e.expense_id }),
          h('span', { text: fmtDate(e.created_at) }),
          showSubmitter ? h('span', { text: e.submitted_by_name + ' · ' + e.outlet_code }) : h('span', { text: 'To ' + e.send_to_name }),
          e.due_date && OPEN_STATUSES.indexOf(e.status) !== -1 ? h('span.due' + (overdue ? '.overdue' : ''), { text: (overdue ? 'Overdue · ' : 'Due ') + fmtDate(e.due_date) }) : null,
          bankOrderWaits(e) ? h('span.bank-order', { text: 'Bank order · ' + fmtDate(e.bank_order_at) }) : null,
          (e.status === 'PAID' || e.status === 'CLOSED') && e.paid_at ? h('span.paid-on', { text: 'Paid ' + fmtDate(e.paid_at) }) : null,
        ]),
        e.status === 'NEEDS_INFO' && e.info_request ? h('div.item-note', { text: 'Requested: ' + e.info_request }) : null,
        e.status === 'REJECTED' && e.rejection_reason ? h('div.item-note.bad', { text: 'Rejected: ' + e.rejection_reason }) : null,
        e.payment_problem ? h('div.item-note.bad', { text: 'Payment problem · ' + e.payment_problem }) : null,
      ]),
    ]);
  }

  // Bank orders: the accountant creates the transfer in the bank, the bank approver releases it there,
  // then the payment is recorded. In between the expense carries bank_order_at.
  function bankOrdersOn() { return Boolean(state.limits && state.limits.bankOrders); }
  function bankApprover() { return (state.limits && state.limits.bankOrderApprover) || 'the bank approver'; }
  function bankOrderWaits(e) { return bankOrdersOn() && Boolean(e.bank_order_at) && (e.status === 'APPROVED' || e.status === 'PARTIAL'); }

  /** Summary tiles at the top of a tab. tiles: [{value, label, brand?, alert? (red), warn? (amber)}] */
  function stats(tiles) {
    tiles = tiles.filter(Boolean);
    return h('div.stats.stats-' + tiles.length, {}, tiles.map(function (t) {
      return h('div.stat' + (t.brand ? '.stat-hero' : '') + (t.alert ? '.alert' : '') + (t.warn ? '.warn' : ''), {}, [
        h('div.stat-value', { text: String(t.value) }),
        h('div.stat-label', { text: t.label }),
      ]);
    }));
  }
  function sum(list, field) { return list.reduce(function (a, e) { return a + (Number(e[field]) || 0); }, 0); }
  /** Short money for summary tiles: 7,586,000 becomes "7.59M ₫". */
  function fmtShort(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B ₫';
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M ₫';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K ₫';
    return n + ' ₫';
  }

  // A long list opens with its first rows; "Show more" brings the next ones, so nobody has to scroll through everything.
  const PAGE = 10;
  let shownMore = {};         // list name → rows on screen; back to the first rows when the tab or a filter changes
  function firstRows(key, rows) {
    const n = Math.max(PAGE, shownMore[key] || 0);
    if (rows.length <= n + 2) return { rows: rows, more: null };     // never a button for one or two rows
    return { rows: rows.slice(0, n), more: h('button.btn.btn-rows', { type: 'button', text: 'Show more (' + (rows.length - n) + ' left)',
      onclick: function () { shownMore[key] = n + PAGE * 2; renderHome(true); } }) };
  }

  /** opts: showSubmitter, showEmpty + empty, collapsed, alert (red title), all (never cut short). */
  function section(title, items, opts) {
    opts = opts || {};
    if (!items.length && !opts.showEmpty) return null;
    const head = h('h2.section-title' + (opts.alert ? '.alert' : ''), {}, [title, items.length ? h('span.count', { text: String(items.length) }) : null]);
    const part = opts.all ? { rows: sortItems(items), more: null } : firstRows(title, sortItems(items));
    const list = items.length ? h('div.list', {}, part.rows.map(function (e) { return expenseCard(e, opts.showSubmitter); })) : h('p.empty', { text: opts.empty });
    if (opts.collapsed) return h('details.section', { open: doneOpen, ontoggle: function (ev) { doneOpen = ev.currentTarget.open; } }, [h('summary', {}, [head]), list, part.more]);
    return h('section.section', {}, [head, list, part.more]);
  }

  // Order of every list. Newest first unless the viewer picks another order (remembered on this device).
  const SORTS = [
    ['new', 'Newest first'], ['old', 'Oldest first'],
    ['amount_desc', 'Amount: high to low'], ['amount_asc', 'Amount: low to high'],
    ['due', 'Due date: soonest first'],
  ];
  let sortBy = 'new';
  try { sortBy = localStorage.getItem('pw_sort') || 'new'; } catch (err) { /* private mode */ }
  if (!SORTS.some(function (s) { return s[0] === sortBy; })) sortBy = 'new';

  function sortItems(list) {
    const time = function (e) { return new Date(e.created_at).getTime() || 0; };
    const amount = function (e) { return Number(e.status === 'PARTIAL' ? e.balance_due : e.amount_total) || 0; };
    const due = function (e) { return e.due_date ? new Date(e.due_date).getTime() : Infinity; };
    const by = {
      new: function (a, b) { return time(b) - time(a); },
      old: function (a, b) { return time(a) - time(b); },
      amount_desc: function (a, b) { return amount(b) - amount(a) || time(b) - time(a); },
      amount_asc: function (a, b) { return amount(a) - amount(b) || time(b) - time(a); },
      due: function (a, b) { return (due(a) - due(b)) || time(a) - time(b); },
    }[sortBy];
    // Overdue is a warning: it always comes first, whatever order was chosen.
    return list.slice().sort(function (a, b) {
      const lateA = isOverdue(a), lateB = isOverdue(b);
      if (lateA !== lateB) return lateA ? -1 : 1;
      return by(a, b);
    });
  }

  function sortControl() {
    const sel = h('select.input', { 'aria-label': 'Sort', onchange: function () {
      sortBy = sel.value;
      try { localStorage.setItem('pw_sort', sortBy); } catch (err) { /* private mode */ }
      renderHome(true);
    } }, SORTS.map(function (s) { return h('option', { value: s[0], text: s[1] }); }));
    sel.value = sortBy;
    return h('label.show-filter', {}, [h('span.show-label', { text: 'Sort' }), sel]);
  }

  /** "Show" and "Sort" side by side (stacked on a phone). */
  function listControls(show) {
    return h('div.list-controls', {}, [show, sortControl()]);
  }

  /** A "Show: …" dropdown above a list. options: [[value, label], …] */
  function showFilter(value, options, onChange) {
    const sel = h('select.input', { 'aria-label': 'Show', onchange: function () { onChange(sel.value); shownMore = {}; bankSelect = null; renderHome(true); } },
      options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    sel.value = value;
    return h('label.show-filter', {}, [h('span.show-label', { text: 'Show' }), sel]);
  }

  /** Every expense the user may see across outlets; loaded once, then kept fresh by Refresh. null while loading. */
  let allLoading = false;
  let allError = '';          // why the list could not be loaded; shown in its place until asked again
  function allExpenses() {
    if (state.views.all) return state.views.all;
    if (!allLoading && !allError) {
      allLoading = true;
      Api.call('listExpenses', { view: 'all' }).then(function (res) {
        state.views.all = res.expenses;
      }).catch(function (err) { allError = err.message; }).finally(function () {
        allLoading = false;
        if (onHome()) renderHome(true);
      });
    }
    return null;
  }
  function allFailed() { return loadFailed(allError, function () { allError = ''; renderHome(true); }); }

  /** Card that walks the user through linking Telegram (no webhook: they tap Start, then "Done"). */
  function telegramCard() {
    const card = h('div.card.tg');
    function showIntro() {
      card.textContent = '';
      card.appendChild(h('div.tg-title', { text: 'Get alerts on Telegram' }));
      card.appendChild(h('p.hint', { text: 'Know right away when something needs you. Without it, alerts go to your email.' }));
      card.appendChild(h('button.btn', { type: 'button', text: 'Connect Telegram', onclick: start }));
    }
    async function start(ev) {
      ev.target.disabled = true;
      ev.target.textContent = 'Preparing…';
      try {
        const res = await Api.call('telegramLinkStart');
        card.textContent = '';
        card.appendChild(h('div.tg-title', { text: 'Two taps' }));
        card.appendChild(h('p.hint', { text: '1. Open the bot and tap Start.  2. Come back here and tap Done.' }));
        card.appendChild(h('a.btn.btn-primary', { href: res.url, target: '_blank', rel: 'noopener', text: '1 · Open Telegram' }));
        // Computers without the Telegram app, or a bot chat opened before: the code can also be sent by hand.
        const m = String(res.url).match(/t\.me\/([^?]+)\?start=([A-Za-z0-9_-]+)/);
        if (m) {
          const cmd = '/start ' + m[2];
          const copyBtn = h('button.link', { type: 'button', text: 'Copy', onclick: function () {
            (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject()).then(function () { toast('Copied'); }, function () { toast('Select the text and copy it'); });
          } });
          card.appendChild(h('details.more-inline.tg-manual', {}, [
            h('summary', { text: 'Start does nothing? Send the code by hand' }),
            h('p.hint', { text: 'Open @' + m[1] + ' in Telegram (phone, desktop or web.telegram.org), send this message, then come back and tap Done:' }),
            h('div.tg-code', {}, [h('code', { text: cmd }), copyBtn]),
          ]));
        }
        const err = h('p.error', { hidden: true });
        const done = h('button.btn', { type: 'button', text: '2 · Done, I tapped Start', onclick: async function () {
          done.disabled = true;
          err.hidden = true;
          try {
            await Api.call('telegramLinkFinish');
            state.user.telegramLinked = true;
            toast('Telegram connected', 'ok');
            renderHome();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
            done.disabled = false;
          }
        } });
        card.appendChild(done);
        card.appendChild(err);
      } catch (ex) {
        toast(ex.message);
        showIntro();
      }
    }
    showIntro();
    return card;
  }

  function telegramFooter() {
    return h('p.hint.center-text.tg-footer', {}, [
      'Telegram alerts: on · ',
      h('button.link', { type: 'button', text: 'Disconnect', onclick: async function () {
        try { await Api.call('telegramUnlink'); state.user.telegramLinked = false; renderHome(); } catch (ex) { toast(ex.message); }
      } }),
    ]);
  }

  function renderHome(keepScroll) {
    const role = state.user.role;
    const mine = state.views.mine;
    const byStatus = function (list) { return mine.filter(function (e) { return list.indexOf(e.status) !== -1; }); };

    // Tabs by role; queues come first because they are someone's job.
    const tabDefs = [];
    if (PAYER_ROLES.indexOf(role) !== -1) tabDefs.push({ key: 'pay', label: 'To pay', count: state.views.to_pay.length + (state.views.to_fix || []).length });
    if (APPROVER_ROLES.indexOf(role) !== -1) tabDefs.push({ key: 'approve', label: 'To approve', count: state.views.to_approve.length + (state.views.to_check || []).length + (state.views.for_owners || []).length });
    tabDefs.push({ key: 'mine', label: tabDefs.length ? 'Mine' : 'My expenses', count: byStatus(['NEEDS_INFO']).length });
    if (ALL_VIEW_ROLES.indexOf(role) !== -1 || state.user.seeAll) tabDefs.push({ key: 'all', label: role === 'OUTLET_MANAGER' ? 'Outlet' : 'All', count: 0 });
    // Petty cash: first for the cash keeper and funder (it is their job), last for everyone else who follows it.
    if (state.user.petty) {
      const cashTab = { key: 'cash', label: 'Cash', count: state.cash ? state.cash.pending.filter(function (x) { return x.can_confirm; }).length : 0 };
      if (state.user.petty === 'KEEPER' || state.user.petty === 'FUNDER') tabDefs.unshift(cashTab); else tabDefs.push(cashTab);
    }
    // Someone who only follows their own expenses (a requester; the cash keeper and funder too) gets them as two tabs:
    // what is still open, and what is done. With a Cash tab next to it, the open one keeps the name "My expenses".
    // Someone who mostly follows their own expenses (requester, cash keeper, funder) gets what is paid as its own tab,
    // next to what is still open. A test account that also sees everything (All) keeps it.
    const solo = !tabDefs.some(function (t) { return t.key === 'pay' || t.key === 'approve'; }) && ALL_VIEW_ROLES.indexOf(role) === -1;
    if (solo) {
      const at = tabDefs.findIndex(function (t) { return t.key === 'mine'; });
      if (tabDefs.length === 1) tabDefs[at].label = 'Open';
      tabDefs.splice(at + 1, 0, { key: 'paid', label: 'Paid', count: 0 });
    }
    if (tabDefs.length >= 4) {                      // phone width: keep tab labels on one line
      const short = { pay: 'Pay', approve: 'Approve', mine: 'Mine' };
      tabDefs.forEach(function (t) { if (short[t.key]) t.label = short[t.key]; });
    }
    if (!homeTab || !tabDefs.some(function (t) { return t.key === homeTab; })) {
      const own = state.user.petty === 'KEEPER' || state.user.petty === 'FUNDER' ? { key: 'cash' } : null;
      homeTab = (own || tabDefs.find(function (t) { return t.key !== 'mine' && t.count; }) || { key: 'mine' }).key;
    }
    const tabs = tabDefs.length > 1 ? h('div.tabs', { role: 'tablist', style: 'grid-template-columns: repeat(' + tabDefs.length + ', 1fr)' }, tabDefs.map(function (t) {
      return h('button.tab' + (homeTab === t.key ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': homeTab === t.key ? 'true' : 'false', onclick: function () { homeTab = t.key; shownMore = {}; bankSelect = null; renderHome(); } },
        [t.label, t.count ? h('span.count', { text: String(t.count) }) : null]);
    })) : null;

    let body;
    if (homeTab === 'cash') {
      body = cashView();
    } else if (homeTab === 'all') {
      body = allView();
    } else if (homeTab === 'approve') {
      const qa = state.views.to_approve;
      // The admin also sees what is waiting for the owners, and can step in.
      const theirs = state.views.for_owners || [];
      const theirPending = theirs.filter(function (e) { return e.status === 'PENDING_APPROVAL'; });
      const theirChecks = theirs.filter(function (e) { return e.status !== 'PENDING_APPROVAL'; });
      const waiting = qa.concat(theirPending);
      body = [
        stats([
          { value: waiting.length, label: 'Waiting', brand: true },
          { value: fmtShort(sum(waiting, 'amount_total')), label: 'Total' },
          { value: (state.views.to_check || []).length + theirChecks.length, label: 'Cash checks' },
        ]),
        waiting.length > 1 ? listControls(null) : null,
        section('Waiting for your decision', qa, { showEmpty: !theirs.length, empty: 'Nothing waiting for you.', showSubmitter: true }),
        section('Cash payments to post-check', state.views.to_check || [], { showSubmitter: true }),
        section('Waiting for the owners', theirPending, { showSubmitter: true }),
        section('Cash checks waiting for the owners', theirChecks, { showSubmitter: true }),
        section('Waiting for you to release in the bank', state.views.bank_waiting || [], { showSubmitter: true }),
      ];
    } else if (homeTab === 'pay') {
      const q = state.views.to_pay;
      const total = q.reduce(function (sum, e) { return sum + (Number(e.balance_due) || 0); }, 0);
      const overdueN = q.filter(isOverdue).length;
      const partialN = q.filter(function (e) { return e.status === 'PARTIAL'; }).length;
      // Bank orders: where each transfer stands in the bank (to create, or waiting for the release).
      const bank = bankOrdersOn();
      const candidates = q.filter(function (e) { return !e.bank_order_at; });
      const waitN = q.length - candidates.length;
      const markButton = candidates.length ? h('button.btn.bank-mark', { type: 'button', text: 'Mark bank orders created…', onclick: function () { bankSelect = {}; renderHome(true); } }) : null;
      let listPart;
      let lateList = null;      // everything to pay: what is overdue stands first, as its own list, never cut short
      if (payShow === 'PAID') {
        const all = allExpenses();
        const since = Date.now() - 30 * 86400000;
        const paid = (all || []).filter(function (e) { return (e.status === 'PAID' || e.status === 'CLOSED') && e.paid_at && new Date(e.paid_at).getTime() >= since; })
          .sort(function (a, b) { return new Date(b.paid_at) - new Date(a.paid_at); });
        listPart = [all ? section('Paid in the last 30 days', paid, { showEmpty: true, empty: 'Nothing paid in the last 30 days.', showSubmitter: true }) : allError ? allFailed() : loading('Loading paid expenses…')];
      } else {
        const shown = q.filter(function (e) {
          if (payShow === 'OVERDUE') return isOverdue(e);
          if (payShow === 'BANK_TODO') return !e.bank_order_at;
          if (payShow === 'BANK_WAIT') return Boolean(e.bank_order_at);
          return !payShow || e.status === payShow;
        });
        const title = { '': 'Approved, waiting for payment', APPROVED: 'Approved, nothing paid yet', PARTIAL: 'Partially paid', OVERDUE: 'Overdue',
          BANK_TODO: 'To create a bank order', BANK_WAIT: 'Waiting for ' + bankApprover() + ' to release in the bank' }[payShow];
        const late = payShow ? [] : shown.filter(isOverdue);
        const rest = shown.filter(function (e) { return late.indexOf(e) === -1; });
        lateList = section('Overdue', late, { showSubmitter: true, alert: true, all: true });
        listPart = [late.length && !rest.length ? null
          : section(title, rest, { showEmpty: true, empty: payShow ? 'Nothing here.' : 'Nothing to pay.', showSubmitter: true, alert: payShow === 'OVERDUE' })];
        if (bank && bankSelect && (!payShow || payShow === 'BANK_TODO')) {
          lateList = null;
          listPart = [bankSelectView(candidates)];
        } else if (bank && !payShow) {
          // Everything to pay, split by where the transfer stands in the bank. The button sits right under Show and Sort.
          const toCreate = rest.filter(function (e) { return !e.bank_order_at; });
          const waiting = rest.filter(function (e) { return e.bank_order_at; });
          listPart = [
            markButton,
            section('To create a bank order', toCreate, { showEmpty: !late.length && !waiting.length, empty: 'Nothing to pay.', showSubmitter: true }),
            section('Waiting for ' + bankApprover() + ' to release in the bank', waiting, { showSubmitter: true }),
          ];
        } else if (bank && payShow === 'BANK_TODO') {
          listPart = [markButton].concat(listPart);
        }
      }
      body = [
        stats(bank ? [
          // Where the transfers stand; the exact amount outstanding is on the line under the tiles.
          { value: q.length, label: 'To pay', brand: true },
          { value: candidates.length, label: 'To create an order' },
          { value: waitN, label: 'Waiting for ' + bankApprover() },
          { value: overdueN, label: 'Overdue', alert: overdueN > 0 },
        ] : [
          { value: q.length, label: 'To pay', brand: true },
          { value: fmtShort(total), label: 'Outstanding' },
          { value: overdueN, label: 'Overdue', alert: overdueN > 0 },
          { value: partialN, label: 'Partially paid' },
        ]),
        q.length ? h('p.queue-total', { text: 'Outstanding: ' + fmtMoney(total) }) : null,
        lateList,
        section('Payment problems to sort out', state.views.to_fix || [], { showSubmitter: true }),
        listControls(showFilter(payShow, bank ? [
          // In the order the work goes: create the order, wait for the release, then paid.
          ['', 'Everything to pay (' + q.length + ')'],
          ['BANK_TODO', 'To create a bank order (' + candidates.length + ')'],
          ['BANK_WAIT', 'Waiting for ' + bankApprover() + ' to release (' + waitN + ')'],
          ['OVERDUE', 'Overdue (' + overdueN + ')'],
          ['PARTIAL', 'Partially paid (' + partialN + ')'],
          ['PAID', 'Paid in the last 30 days'],
        ] : [
          ['', 'Everything to pay (' + q.length + ')'],
          ['APPROVED', 'Approved, nothing paid yet (' + (q.length - partialN) + ')'],
          ['PARTIAL', 'Partially paid (' + partialN + ')'],
          ['OVERDUE', 'Overdue (' + overdueN + ')'],
          ['PAID', 'Paid in the last 30 days'],
        ], function (v) { payShow = v; })),
      ].concat(listPart, [
        q.length && payShow !== 'PAID' ? h('button.btn', { type: 'button', text: 'Export list for bank transfers (CSV)', onclick: exportToPay }) : null,
        monthExportRow(),
      ]);
    } else if (homeTab === 'paid') {
      // Everything paid in full, the latest payment first. Open one for the payments and the bank's transfer confirmation.
      const paid = byStatus(['PAID', 'CLOSED']).sort(function (a, b) { return new Date(b.paid_at || 0) - new Date(a.paid_at || 0); });
      const month = todayVN().slice(0, 7);
      const thisMonth = paid.filter(function (e) { return e.paid_at && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(e.paid_at)).slice(0, 7) === month; });
      const part = firstRows('paid', paid);
      body = [
        stats([
          { value: paid.length, label: 'Paid', brand: true },
          { value: fmtShort(sum(thisMonth, 'amount_total')), label: 'Paid this month' },
          { value: byStatus(['APPROVED', 'PARTIAL']).length, label: 'Still to be paid' },
        ]),
        paid.length ? h('section.section', {}, [
          h('h2.section-title', {}, ['Paid, latest first', h('span.count', { text: String(paid.length) })]),
          h('div.list', {}, part.rows.map(function (e) { return expenseCard(e, false); })),
          part.more,
        ]) : h('p.empty', { text: 'Nothing is paid yet.' }),
      ];
    } else {
      body = [
        stats([
          { value: byStatus(['NEEDS_INFO']).length, label: 'Need info', warn: byStatus(['NEEDS_INFO']).length > 0 },
          { value: byStatus(['PENDING_APPROVAL']).length, label: 'Pending' },
          { value: byStatus(['APPROVED', 'PARTIAL']).length, label: 'To be paid' },
        ]),
        h('a.btn.btn-primary.btn-big', { href: '#/new' }, ['+ New expense']),
      ];
      const MINE_SHOW = {
        NEEDS_INFO: ['Needs your info', ['NEEDS_INFO']],
        PENDING_APPROVAL: ['Waiting for approval', ['PENDING_APPROVAL']],
        APPROVED: ['Approved, waiting for payment', ['APPROVED', 'PARTIAL']],
        PAID: ['Paid', ['PAID', 'CLOSED']],
        REJECTED: ['Rejected', ['REJECTED']],
        CANCELLED: ['Cancelled', ['CANCELLED']],
      };
      // With the Paid tab next to it (solo), this list holds what is still open; rejected and cancelled are folded at the bottom.
      const openStatuses = ['DRAFT', 'NEEDS_INFO', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL'];
      const showKeys = Object.keys(MINE_SHOW).filter(function (k) { return !solo || openStatuses.indexOf(MINE_SHOW[k][1][0]) !== -1; });
      if (showKeys.indexOf(mineShow) === -1) mineShow = '';
      const listed = solo ? byStatus(openStatuses) : mine;
      if (listed.length) {
        body.push(listControls(showFilter(mineShow, [['', (solo ? 'Everything open (' : 'Everything (') + listed.length + ')']].concat(showKeys.map(function (k) {
          return [k, MINE_SHOW[k][0] + ' (' + byStatus(MINE_SHOW[k][1]).length + ')'];
        })), function (v) { mineShow = v; })));
      }
      if (MINE_SHOW[mineShow]) {
        body.push(section(MINE_SHOW[mineShow][0], byStatus(MINE_SHOW[mineShow][1]), { showEmpty: true, empty: 'Nothing here.' }));
      } else {
        body.push(
          section('Needs your info', byStatus(['NEEDS_INFO'])),
          section('In progress', byStatus(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL']), { showEmpty: true, empty: 'Nothing in progress.' }),
          solo ? section('Rejected or cancelled', byStatus(['REJECTED', 'CANCELLED']), { collapsed: true })
            : section('Done', byStatus(['PAID', 'CLOSED', 'REJECTED', 'CANCELLED']), { collapsed: true })
        );
      }
    }
    body.push(state.user.telegramLinked ? telegramFooter() : telegramCard());
    const refreshed = h('p.refresh-line' + (refreshFailed ? '.warn-text' : ''), {}, [
      (refreshFailed ? 'Not updated since ' : 'Updated ') + (state.refreshedAt ? state.refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—') + ' · ',
      h('button.link', { type: 'button', text: 'Refresh', onclick: function () { refreshViews(true); } }),
    ]);
    const failed = notSaved.length ? h('div.flags', { role: 'alert' }, notSaved.map(function (m) {
      return h('div.flag', {}, [m + ' ', h('button.link', { type: 'button', text: 'OK', onclick: function () { notSaved.splice(notSaved.indexOf(m), 1); renderHome(true); } })]);
    })) : null;
    mount(page([failed, tabs, refreshed].concat(body)), keepScroll);
    // More tabs than fit (the admin on a narrow phone): the chosen one is brought into the bar.
    const on = tabs && tabs.querySelector('.on');
    if (on) tabs.scrollLeft = Math.max(0, on.getBoundingClientRect().right - tabs.getBoundingClientRect().right);
  }

  let bankSelect = null;   // expense id → ticked, while the accountant marks bank orders; null = not marking

  /** The accountant ticks the expenses she created bank orders for, then marks them in one go. */
  function bankSelectView(candidates) {
    const picked = function () { return candidates.filter(function (e) { return bankSelect[e.expense_id]; }); };
    const go = h('button.btn.btn-primary.btn-big', { type: 'button' });
    function paint() {
      const p = picked();
      go.disabled = !p.length;
      go.textContent = p.length ? 'Mark ' + p.length + ' as created · ' + fmtMoney(sum(p, 'balance_due')) : 'Tick the orders you created';
    }
    const rows = sortItems(candidates).map(function (e) {
      const late = isOverdue(e);
      const box = h('input', { type: 'checkbox', checked: Boolean(bankSelect[e.expense_id]), 'aria-label': e.expense_id,
        onchange: function () { bankSelect[e.expense_id] = box.checked; paint(); } });
      return h('label.item.bank-pick' + (late ? '.overdue' : ''), {}, [box, h('div.item-body', {}, [
        h('div.item-top', {}, [h('span.amount', { text: fmtMoney(e.balance_due) }), statusChip(e.status)]),
        h('div.item-mid', { text: e.supplier_name || e.payee_name || ('Pay back ' + e.submitted_by_name) }),
        h('div.item-meta', {}, [
          h('span', { text: e.expense_id }),
          h('span', { text: e.submitted_by_name + ' · ' + e.outlet_code }),
          e.due_date ? h('span.due' + (late ? '.overdue' : ''), { text: (late ? 'Overdue · ' : 'Due ') + fmtDate(e.due_date) }) : null,
        ]),
      ])]);
    });
    go.addEventListener('click', async function () {
      const ids = picked().map(function (e) { return e.expense_id; });
      if (!ids.length) return;
      go.disabled = true;
      go.textContent = 'Saving…';
      try {
        const res = await Api.call('bankOrder', { ids: ids });
        res.expenses.forEach(function (e) { upsert('to_pay', e); });
        bankSelect = null;
        toast((ids.length === 1 ? '1 bank order' : ids.length + ' bank orders') + ' marked · ' + bankApprover() + ' is told', 'ok');
        renderHome(true);
      } catch (err) { toast(err.message); paint(); }
    });
    paint();
    return h('section.section', {}, [
      h('h2.section-title', { text: 'Which bank orders did you create?' }),
      h('div.list', {}, rows),
      h('div.bank-pick-actions', {}, [go, h('button.btn', { type: 'button', text: 'Cancel', onclick: function () { bankSelect = null; renderHome(true); } })]),
    ]);
  }

  /** Owner/admin timeline across every outlet (spec §8), loaded on first open. */
  function allView() {
    if (!allExpenses()) return [allError ? allFailed() : loading('Loading all expenses…')];
    const OPEN = ['PENDING_APPROVAL', 'NEEDS_INFO', 'APPROVED', 'PARTIAL'];
    const q = allFilter.q.trim().toLowerCase();
    const rows = state.views.all.filter(function (e) {
      if (allFilter.outlet && e.outlet_code !== allFilter.outlet) return false;
      if (allFilter.status === 'OPEN' && OPEN.indexOf(e.status) === -1) return false;
      if (allFilter.status && allFilter.status !== 'OPEN' && e.status !== allFilter.status) return false;
      if (q && [e.expense_id, e.description, e.supplier_name, e.submitted_by_name, e.payee_name].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const total = rows.reduce(function (sum, e) { return sum + (Number(e.amount_total) || 0); }, 0);

    const outletSel = h('select.input', { 'aria-label': 'Outlet', onchange: function () { allFilter.outlet = outletSel.value; shownMore = {}; renderHome(true); } },
      [h('option', { value: '', text: 'All outlets' })].concat(outletChoices().map(function (o) { return h('option', { value: o.value, text: o.label }); })));
    outletSel.value = allFilter.outlet;
    const statusSel = h('select.input', { 'aria-label': 'Status', onchange: function () { allFilter.status = statusSel.value; shownMore = {}; renderHome(true); } },
      [h('option', { value: 'OPEN', text: 'Open' }), h('option', { value: '', text: 'Every status' })]
        .concat(state.ref.enums.filter(function (x) { return x.field === 'status'; }).map(function (x) { return h('option', { value: x.value, text: x.label }); })));
    statusSel.value = allFilter.status;
    const search = h('input.input', { type: 'search', 'aria-label': 'Search', placeholder: 'Search ID, supplier, person…', value: allFilter.q });
    search.addEventListener('change', function () { allFilter.q = search.value; shownMore = {}; renderHome(true); });

    // Timeline: what is overdue first, then grouped by submission day when sorted by date; one list otherwise.
    const groups = [];
    const byDate = sortBy === 'new' || sortBy === 'old';
    const part = firstRows('all', sortItems(rows));
    part.rows.forEach(function (e) {
      const late = isOverdue(e);
      const day = late ? 'Overdue' : byDate ? fmtDate(e.created_at) : (SORTS.find(function (s) { return s[0] === sortBy; }) || [])[1];
      const last = groups[groups.length - 1];
      if (last && last.day === day && last.late === late) last.items.push(e); else groups.push({ day: day, late: late, items: [e] });
    });
    return [
      h('div.filters', {}, [h('div.grid2', {}, [outletSel, statusSel]), search]),
      rows.length > 1 ? listControls(null) : null,
      monthExportRow(),
      stats([
        { value: rows.length, label: 'Shown', brand: true },
        { value: fmtShort(total), label: 'Total' },
        { value: rows.filter(isOverdue).length, label: 'Overdue', alert: rows.filter(isOverdue).length > 0 },
      ]),
      rows.length ? null : h('p.empty', { text: 'Nothing matches.' }),
    ].concat(groups.map(function (g) {
      return h('section.section', {}, [h('h2.section-title' + (g.late ? '.alert' : ''), { text: g.day }), h('div.list', {}, g.items.map(function (e) { return expenseCard(e, true); }))]);
    }), [part.more]);
  }

  /** Every outlet the viewer may see, with or without expenses, plus any code left on old expenses. */
  function outletChoices() {
    const list = state.ref.outlets.map(function (o) { return { value: o.value, label: o.label }; });
    (state.views.all || []).forEach(function (e) {
      if (e.outlet_code && !list.some(function (o) { return o.value === e.outlet_code; })) list.push({ value: e.outlet_code, label: e.outlet_code });
    });
    return list;
  }

  // -------------------------------------------------------------- petty cash
  // One cash box kept by the cash keeper. Deposits count once she confirms them;
  // spends are recorded (not approved); a count lines the balance up with the cash.

  const CASH_TYPE = { DEPOSIT: 'Deposit', SPEND: 'Spend', COUNT: 'Cash count', VOID: 'Cancelled entry' };
  let cashLoading = false;
  let cashError = '';         // as allError, for the cash box

  function loadCash(force) {
    if (state.cash && !force) return state.cash;
    if (!cashLoading && (force || !cashError)) {
      cashLoading = true;
      cashError = '';
      Api.call('pettyCash').then(function (res) {
        state.cash = res;
      }).catch(function (err) {
        if (state.cash) toast(err.message); else cashError = err.message;
      }).finally(function () {
        cashLoading = false;
        if (onHome() && homeTab === 'cash') renderHome(true);
      });
    }
    return state.cash || null;
  }

  function cashChip(x) {
    return h('span.chip' + (x.entry_type === 'DEPOSIT' ? '.ok' : x.entry_type === 'SPEND' ? '.info' : '.warn'), { text: CASH_TYPE[x.entry_type] || x.entry_type });
  }

  function signedMoney(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtMoney(Math.abs(n)); }

  function cashEntryLine(x) {
    const what = x.entry_type === 'SPEND'
      ? [x.outlet_code, categoryShort(x.expense_category), x.supplier_name, x.description].filter(Boolean).join(' · ')
      : x.entry_type === 'DEPOSIT'
        ? 'From ' + x.recorded_by_name + (x.status === 'PENDING' ? ' · waiting for the keeper to confirm' : x.status === 'CANCELLED' ? ' · cancelled' : ' · received by ' + x.confirmed_by_name + (x.received_amount !== '' && x.received_amount !== x.amount ? ' (' + fmtMoney(x.received_amount) + ' of ' + fmtMoney(x.amount) + ')' : ''))
        : x.description;
    const shown = x.entry_type === 'DEPOSIT' && x.status !== 'RECEIVED' ? fmtMoney(x.amount) : signedMoney(x.effect);
    return h('a.item.cash-item' + (x.voided || x.status === 'CANCELLED' ? '.voided' : ''), { href: '#/cash/' + encodeURIComponent(x.entry_id) }, [h('div.item-body', {}, [
      h('div.item-top', {}, [
        h('span.amount' + (x.effect > 0 ? '.cash-in' : ''), { text: shown }),
        cashChip(x),
      ]),
      h('div.item-mid', { text: what }),
      h('div.item-meta', {}, [
        h('span', { text: x.entry_id }),
        h('span', { text: fmtDate(x.entry_date) }),
        x.entry_type === 'SPEND' ? h('span', { text: x.has_doc ? 'Receipt attached' : 'No receipt' }) : null,
        x.voided ? h('span', { text: 'Cancelled' }) : null,
      ]),
    ])]);
  }

  // The entries are listed one month at a time (this month first), so the list stays short.
  let cashMonth = '';           // month on screen; '' = this month
  let cashOther = null;         // { month, entries, base }: another month, fetched when asked for
  let cashOtherLoading = '';
  function monthName(ym) {
    return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  function monthBefore(ym) {
    const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  /** One month's entries, latest day first. This month comes with the Cash tab; another month is fetched (null while it loads). */
  function cashEntriesOf(month) {
    const c = state.cash;
    let list;
    if (month === todayVN().slice(0, 7)) {
      list = c.entries.filter(function (x) { return String(x.entry_date).slice(0, 7) === month; });
    } else {
      const have = cashOther && cashOther.month === month ? cashOther : null;
      if ((!have || have.base !== c) && cashOtherLoading !== month) {      // not loaded yet, or the cash box changed since
        cashOtherLoading = month;
        Api.call('pettyCash', { month: month }).then(function (res) {
          cashOther = { month: month, entries: res.entries || [], base: state.cash };
          if (onHome() && homeTab === 'cash') renderHome(true);
        }).catch(function (err) {
          toast(err.message);
          if (cashMonth === month) { cashMonth = ''; if (onHome() && homeTab === 'cash') renderHome(true); }
        }).finally(function () { cashOtherLoading = ''; });
      }
      if (!have) return null;
      list = have.entries;
    }
    return list.filter(function (x) { return !(x.entry_type === 'DEPOSIT' && x.status === 'PENDING'); })
      .sort(function (a, b) { return a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0; });
  }

  function cashView() {
    const c = loadCash(false);
    if (!c) return [cashError ? loadFailed(cashError, function () { cashError = ''; renderHome(true); }) : loading('Loading the cash box…')];
    const low = c.lowBalance > 0 && c.balance < c.lowBalance;
    const thisMonth = todayVN().slice(0, 7);
    const month = cashMonth || thisMonth;
    const showMonth = function (m) { cashMonth = m === thisMonth ? '' : m; delete shownMore.cash; renderHome(true); };
    const entries = cashEntriesOf(month);
    let listed;
    if (!entries) {
      listed = [loading('Loading ' + monthName(month) + '…')];
    } else if (!entries.length) {
      listed = [
        h('p.empty', { text: 'Nothing recorded in ' + monthName(month) + (month === thisMonth ? ' yet.' : '.') }),
        month === thisMonth ? h('button.btn.btn-rows', { type: 'button', text: 'Show ' + monthName(monthBefore(month)), onclick: function () { showMonth(monthBefore(month)); } }) : null,
      ];
    } else {
      const part = firstRows('cash', entries);
      const groups = [];
      part.rows.forEach(function (x) {
        const day = fmtDate(x.entry_date);
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.items.push(x); else groups.push({ day: day, items: [x] });
      });
      const spent = entries.reduce(function (t, x) { return t + (x.entry_type === 'SPEND' && !x.voided ? Number(x.amount) || 0 : 0); }, 0);
      listed = [h('p.hint.cash-period', { text: entries.length + (entries.length === 1 ? ' entry' : ' entries') + ' · ' + fmtMoney(spent) + ' spent' })]
        .concat(groups.map(function (g) {
          return h('section.section', {}, [h('h2.section-title', { text: g.day }), h('div.list', {}, g.items.map(cashEntryLine))]);
        }), [part.more]);
    }
    const monthIn = h('input.input', { type: 'month', 'aria-label': 'Month', value: month, max: thisMonth, onchange: function () {
      if (!/^\d{4}-\d{2}$/.test(monthIn.value) || monthIn.value > thisMonth) { monthIn.value = month; return; }
      if (monthIn.value !== month) showMonth(monthIn.value);
    } });
    const exportBtn = h('button.btn', { type: 'button', text: 'Export month (CSV)', onclick: async function () {
      if (!/^\d{4}-\d{2}$/.test(monthIn.value)) { toast('Choose a month.'); return; }
      exportBtn.disabled = true;
      try {
        const res = await Api.call('pettyExport', { month: monthIn.value });
        downloadCsv(toCsv(res.columns, res.rows), 'pinwei-petty-cash-' + res.month + '.csv');
        toast(res.rows.length + ' entries exported');
      } catch (err) { toast(err.message); } finally { exportBtn.disabled = false; }
    } });
    return [
      h('div.card.cash-balance' + (low ? '.low' : ''), {}, [
        h('div.stat-label', { text: 'Cash in the box' }),
        h('div.cash-balance-value', { text: fmtMoney(c.balance) }),
      ]),
      stats([
        { value: fmtMoney(c.spentSinceDeposit), label: 'Spent since deposit' },
        { value: c.lastCount ? (c.lastCount.difference ? signedMoney(c.lastCount.difference) : 'Matched') : '—', label: c.lastCount ? 'Last count · ' + fmtDate(c.lastCount.date) : 'Last count' },
      ]),
      low ? h('div.flag.warn', { text: 'The cash box is low.' + (Number(c.spentSinceDeposit) > 0
        ? ' To refill it, the next deposit should be about ' + fmtMoney(c.spentSinceDeposit) + ' (what was spent since the last deposit).' : '') }) : null,
      c.can.spend ? h('a.btn.btn-primary.btn-big', { href: '#/cash-spend' }, ['+ Record a cash spend']) : null,
      c.can.deposit || c.can.count ? h('div.row.cash-actions', {}, [
        c.can.deposit ? h('a.btn', { href: '#/cash-deposit', text: 'Record a deposit' }) : null,
        c.can.count ? h('a.btn', { href: '#/cash-count', text: 'Count the cash' }) : null,
      ]) : null,
      c.pending.length ? h('section.section', {}, [
        h('h2.section-title', {}, ['Deposits waiting to be confirmed', h('span.count', { text: String(c.pending.length) })]),
        h('div.list', {}, c.pending.map(function (x) { return depositCard(x); })),
      ]) : null,
      h('section.section.cash-entries', {}, [h('h2.section-title', { text: 'Entries' }), h('div.month-export', {}, [monthIn, exportBtn])]),
    ].concat(listed);
  }

  /** A deposit on its way: the keeper counts it and confirms what actually arrived. */
  function depositCard(x) {
    const card = h('div.card.deposit-card');
    card.appendChild(h('div.item-top', {}, [h('span.amount', { text: fmtMoney(x.amount) }), h('span.chip.ok', { text: 'Deposit' })]));
    card.appendChild(h('div.item-mid', { text: 'From ' + x.recorded_by_name + ' · ' + fmtDate(x.entry_date) + (x.description ? ' · ' + x.description : '') }));
    card.appendChild(h('a.link', { href: '#/cash/' + encodeURIComponent(x.entry_id), text: x.entry_id }));
    if (!x.can_confirm) { card.appendChild(h('p.hint', { text: 'Waiting for the cash keeper to count it and confirm.' })); return card; }
    const amount = moneyBox(String(x.amount), 'got_' + x.entry_id);
    amount.input.setAttribute('aria-required', 'true');
    const err = h('p.error', { hidden: true });
    const btn = h('button.btn.btn-approve', { type: 'button', text: 'Received' });
    const sure = h('div.stack', { hidden: true });   // a different amount is confirmed here first
    const askAgain = function () { sure.hidden = true; btn.hidden = false; };
    async function save(got) {
      btn.disabled = true;
      try {
        const res = await Api.call('pettyConfirm', { id: x.entry_id, received_amount: got });
        toast('Received ' + fmtMoney(got), 'ok');
        if (res.cash) { state.cash = res.cash; if (onHome() && homeTab === 'cash') renderHome(true); } else loadCash(true);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; askAgain(); }
    }
    btn.addEventListener('click', function () {
      const got = amount.value();
      if (!got) { err.textContent = 'Enter the amount you received.'; err.hidden = false; return; }
      if (got === Number(x.amount)) { save(got); return; }
      sure.textContent = '';
      sure.appendChild(h('p.confirm-text', { text: 'You received ' + fmtMoney(got) + ', not ' + fmtMoney(x.amount) + '. The owners will be told about the difference.' }));
      sure.appendChild(h('div.row', {}, [
        h('button.btn', { type: 'button', text: 'Back', onclick: askAgain }),
        h('button.btn.btn-approve', { type: 'button', text: 'Confirm ' + fmtMoney(got).replace(' ', ' '), onclick: function (ev) { ev.currentTarget.disabled = true; save(got); } }),
      ]));
      sure.hidden = false;
      btn.hidden = true;
    });
    card.appendChild(starLabel(h('label.label', { for: 'got_' + x.entry_id, text: 'Amount you received' })));
    card.appendChild(amount.el);
    let gotTouched = false;
    const checkGot = function () {
      lock(btn, !(amount.value() > 0));
      if (!(amount.value() > 0) && gotTouched) { err.textContent = 'Enter the amount you received. This field is required.'; err.hidden = false; err.dataset.req = '1'; }
      else if (err.dataset.req) { err.hidden = true; delete err.dataset.req; }
    };
    amount.input.addEventListener('input', function () { gotTouched = true; askAgain(); checkGot(); });
    checkGot();
    card.appendChild(err);
    card.appendChild(btn);
    card.appendChild(sure);
    return card;
  }

  /** A supplier's name that is too long for its box (the box cuts it) is shown in full in the line under it. */
  function showIfCut(line, input, text) {
    line.textContent = text;
    line.hidden = true;
    requestAnimationFrame(function () { line.hidden = document.activeElement === input || input.scrollWidth <= input.clientWidth + 1; });
  }

  /** Text for searching: no accents, lower case ("Hiền Thảo" is found by typing "hien thao"). */
  function plainText(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase(); }

  /**
   * A supplier box that is searched by typing, as on the expense form (used by the cash spend form).
   * opts: { listId, category(): code, onPick(supplier or null), onAddNew(typed name), below: element under the box }
   * → { el, value(): id, '' or NEW_SUPPLIER, set(id), categoryChanged() }
   */
  function supplierPicker(opts) {
    const ownList = (state.limits && state.limits.supplierCategories) || [];
    const PLACEHOLDER = 'Search or choose a supplier';
    let value = '';
    const input = h('input.input.picker-input', { type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
      'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': opts.listId, placeholder: PLACEHOLDER });
    const list = h('div.picker-list', { id: opts.listId, role: 'listbox', 'aria-label': 'Suppliers', hidden: true });
    const note = h('p.hint', { hidden: true });
    const full = h('p.hint', { hidden: true });
    const addLink = h('button.link.picker-add', { type: 'button', text: '+ Add a new supplier', onclick: function () { addNew(''); } });
    const find = function (id) { return state.ref.suppliers.find(function (x) { return x.value === id; }); };
    const name = function () { const s = find(value); return value === NEW_SUPPLIER ? NEW_SUPPLIER_LABEL : s ? s.label : ''; };
    // Categories named in config (supplier_filter_categories) list only their own suppliers.
    function choices() {
      const cat = opts.category();
      if (ownList.indexOf(cat) === -1) return state.ref.suppliers;
      return state.ref.suppliers.filter(function (s) { return s.defaultCategory === cat || s.value === value; });
    }
    function paint() {
      if (document.activeElement !== input) input.value = name();
      showIfCut(full, input, name());
      addLink.hidden = value === NEW_SUPPLIER;
      const cat = opts.category();
      const own = ownList.indexOf(cat) !== -1;
      note.textContent = own ? 'Only the suppliers for "' + categoryShort(cat) + '" are listed.' : '';
      note.hidden = !own;
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function open(query) {
      const words = plainText(query).split(/\s+/).filter(Boolean);
      const rows = words.length ? [] : [{ value: '', label: 'Not listed / none', cls: '.quiet' }];
      choices().forEach(function (s) {
        const text = plainText(s.label);
        if (words.every(function (w) { return text.indexOf(w) !== -1; })) rows.push({ value: s.value, label: s.label });
      });
      list.textContent = '';
      const typed = String(query).trim();
      if (!rows.length) {
        // Nothing found: the typed name can go straight into the new-supplier form.
        list.appendChild(h('p.picker-empty', { text: 'No supplier matches "' + typed + '".' }));
        list.appendChild(h('div.picker-option.add', { role: 'option', id: opts.listId + '_new', 'data-value': NEW_SUPPLIER, 'aria-selected': 'false',
          text: '+ Add "' + typed + '" as a new supplier', onclick: function () { addNew(typed); } }));
      }
      rows.forEach(function (r, i) {
        list.appendChild(h('div.picker-option' + (r.cls || ''), { role: 'option', id: opts.listId + '_' + i, 'data-value': r.value,
          'aria-selected': String(r.value === value), text: r.label, onclick: function () { pick(r.value); } }));
      });
      list.hidden = false;
      list.scrollTop = 0;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    }
    function pick(id) {
      value = id;
      input.blur();   // closes the list and shows the name
      paint();
      opts.onPick(find(id) || null);
    }
    function addNew(typed) {
      value = NEW_SUPPLIER;
      input.blur();
      paint();
      opts.onAddNew(typed);
    }
    function move(step) {
      const options = [].slice.call(list.querySelectorAll('.picker-option'));
      if (!options.length) return;
      const now = options.findIndex(function (o) { return o.classList.contains('active'); });
      const next = Math.max(0, Math.min(options.length - 1, now === -1 ? (step > 0 ? 0 : options.length - 1) : now + step));
      options.forEach(function (o, i) { o.classList.toggle('active', i === next); });
      input.setAttribute('aria-activedescendant', options[next].id);
      options[next].scrollIntoView({ block: 'nearest' });
    }
    // While the box is in use it is empty for typing; the supplier already chosen shows as its grey text.
    input.addEventListener('focus', function () { input.placeholder = name() || PLACEHOLDER; input.value = ''; full.hidden = true; open(''); });
    input.addEventListener('click', function () { if (list.hidden) open(input.value); });
    input.addEventListener('input', function () { open(input.value); });
    input.addEventListener('blur', function () { close(); input.placeholder = PLACEHOLDER; input.value = name(); showIfCut(full, input, name()); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (list.hidden) open(''); else move(ev.key === 'ArrowDown' ? 1 : -1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (list.hidden) { open(''); return; }
        const active = list.querySelector('.picker-option.active');
        const found = list.querySelectorAll('.picker-option:not(.add):not(.quiet)');
        if (active) active.click();
        else if (found.length === 1) found[0].click();
      } else if (ev.key === 'Escape' && !list.hidden) {
        ev.preventDefault();
        input.blur();
      }
    });
    // A tap in the list must not take the cursor out of the box first (that would close the list).
    list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    return {
      el: h('div.picker', {}, [input, full, addLink, list, note, opts.below]),
      value: function () { return value; },
      set: function (id) { value = id; paint(); },
      /** Another category was tapped: a supplier that is not on that category's own list is taken out. */
      categoryChanged: function () {
        const s = find(value);
        const cat = opts.category();
        if (s && ownList.indexOf(cat) !== -1 && s.defaultCategory !== cat) value = '';
        close();
        paint();
      },
    };
  }

  /** A pasted amount may end in decimals ("1,250,000.00"): dong has none, so they are dropped, never read as two more digits. */
  function wholeDongOnPaste(input) {
    input.addEventListener('paste', function (ev) {
      const text = ev.clipboardData ? ev.clipboardData.getData('text') : '';
      const m = text.trim().replace(/\s*(₫|đ|vnd)$/i, '').match(/^(.*\d)[.,]\d{1,2}$/);
      if (!m) return;
      ev.preventDefault();
      input.setRangeText(m[1], input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input'));
    });
  }

  /** Money field with thousands separators and the amount in words. value() → number or 0. */
  function moneyBox(initial, id) {
    const input = h('input.input.money', { inputmode: 'numeric', autocomplete: 'off', placeholder: 'Enter amount', id: id || null });
    wholeDongOnPaste(input);
    const words = h('p.hint.words');
    let digits = String(initial || '').replace(/\D/g, '');
    function paint() {
      input.value = digits ? money.format(Number(digits)) : '';
      words.textContent = Number(digits) ? amountInWords(digits) : '';
    }
    input.addEventListener('input', function () { digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''); paint(); if (input.onamount) input.onamount(); });
    paint();
    return { el: h('div', {}, [h('div.money-wrap', {}, [input, h('span.suffix', { text: '₫' })]), words]), input: input, value: function () { return Number(digits) || 0; } };
  }

  /** #/cash-spend, #/cash-deposit, #/cash-count */
  function renderCashForm(kind) {
    const back = h('a.back', { href: '#/', text: 'Back' });
    if (!state.user.petty) { mount(page([back, h('p.empty', { text: 'You do not use the cash box.' })])); return; }
    if (kind === 'count' && !state.cash) {           // the count compares with the balance on record
      mount(page([back, loading()]));
      Api.call('pettyCash').then(function (res) { state.cash = res; if (location.hash === '#/cash-count') renderCashForm('count'); })
        .catch(function (err) { mount(page([back, h('p.empty', { text: err.message })])); });
      return;
    }
    const titles = { spend: 'Record a cash spend', deposit: 'Record a cash deposit', count: 'Count the cash' };
    const errs = {};
    const fieldBox = function (name, labelText, control, hint) {
      const id = 'cash_' + name;
      errs[name] = h('p.error', { hidden: true, id: id + '_error' });
      // Bind the label to the first real control inside (input/select/textarea), or name the group.
      const target = control.matches('input,select,textarea') ? control : control.querySelector('input:not([type=file]),select,textarea');
      if (target && !target.id) target.id = id;
      if (target) target.setAttribute('aria-describedby', id + '_error');
      if (!target && labelText && !control.getAttribute('aria-label')) { control.setAttribute('role', 'group'); control.setAttribute('aria-labelledby', id + '_label'); }
      return h('div.field', { 'data-field': name }, [
        labelText ? h(target ? 'label.label' : 'span.label', target ? { for: target.id, text: labelText } : { id: id + '_label', text: labelText }) : null,
        control, hint ? h('p.hint', { text: hint }) : null, errs[name]]);
    };
    /** The control of a required field (its box, or its group of tiles), for aria-required and aria-invalid. */
    const controlOf = function (name) {
      const f = errs[name] && errs[name].parentNode;
      return f ? f.querySelector('input:not([type=file]),select,textarea') || f.querySelector('[role=radiogroup]') : null;
    };
    const summary = h('div.error-summary', { role: 'alert', hidden: true });
    function showProblems(details, title) {
      Object.keys(errs).forEach(function (k) { errs[k].hidden = true; });
      details.forEach(function (d) { const p = errs[d.field] || errs._form; p.textContent = d.message; p.hidden = false; });
      summary.textContent = '';
      summary.appendChild(h('p.error-summary-title', { text: title || (details.length === 1 ? 'Please fix 1 problem' : 'Please fix ' + details.length + ' problems') }));
      summary.appendChild(h('ul', {}, details.map(function (d) { return h('li', { text: d.message }); })));
      summary.hidden = false;
      summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    errs._form = h('p.error', { hidden: true });
    const amount = moneyBox('', 'cash_amount');
    const date = h('input.input', { type: 'date', value: todayVN(), max: todayVN() });
    const note = h('textarea.input', { rows: 2 });
    let attachment = null;
    let extras = [];            // more files after the first (payment QR code, more pages)
    const MAX_FILES = 5;
    let preparing = null;
    const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
    const preview = h('div.preview');
    const extraInput = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: function () {
      [].slice.call(extraInput.files || []).forEach(pickExtra);
      extraInput.value = '';
    } });
    const extrasBox = h('div.preview.extras');
    const addMore = h('button.btn.btn-photo.btn-more', { type: 'button', hidden: true, onclick: function () { extraInput.click(); } }, ['+ Add another file']);
    const addMoreHint = h('p.hint', { hidden: true, text: 'Payment QR code, more pages. Photo or PDF, up to ' + MAX_FILES + ' files.' });
    // Once there is a file, each one has Remove and more are added below.
    function paintFiles() {
      const hasDoc = Boolean(attachment) || extras.length > 0;
      dropzone.hidden = hasDoc;
      noDoc.hidden = hasDoc;
      extrasBox.textContent = '';
      extras.forEach(function (x) {
        extrasBox.appendChild(h('div.preview-row', {}, [
          x.mime.indexOf('image/') === 0 ? h('img.thumb', { src: 'data:' + x.mime + ';base64,' + x.base64, alt: 'More' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: x.name })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { extras.splice(extras.indexOf(x), 1); paintFiles(); touch('file'); } }),
        ]));
      });
      addMore.hidden = !hasDoc || (attachment ? 1 : 0) + extras.length >= MAX_FILES;
      addMoreHint.hidden = addMore.hidden;
      validate();
    }
    function pickExtra(f) {
      if ((attachment ? 1 : 0) + extras.length >= MAX_FILES) return;
      const job = Attachment.prepare(f, (state.limits && state.limits.maxUploadMb) || 10).then(function (a) {
        extras.push(a);
        startUpload(a, 'petty');
        paintFiles();
      }).catch(function (err) { if (errs.file) { errs.file.textContent = err.message; errs.file.hidden = false; } });
      preparing = preparing ? Promise.all([preparing, job]) : job;
      job.finally(function () { if (preparing === job) preparing = null; validate(); });
    }
    const filesBox = function () { return h('div', {}, [fileInput, preview, dropzone, extraInput, extrasBox, addMore, addMoreHint]); };
    const dropzone = h('button.dropzone', { type: 'button', onclick: function () { fileInput.click(); } }, [
      h('span.dropzone-title', { text: 'Take or choose a photo' }),
      h('span.dropzone-sub', { text: kind === 'deposit' ? 'Cheque or withdrawal slip (optional)' : 'Receipt or bill. PDF works too.' }),
    ]);
    // The latest photo chosen always wins (picked, dragged in, or chosen again after Remove).
    let pickSeq = 0;
    function pickFile(f) {
      if (!f) return;
      const mine = ++pickSeq;
      attachment = null;
      if (errs.file) errs.file.hidden = true;
      summary.hidden = true;
      preview.textContent = 'Preparing photo…';
      const job = Attachment.prepare(f, (state.limits && state.limits.maxUploadMb) || 10).then(function (a) {
        if (mine !== pickSeq) return;
        attachment = a;
        startUpload(a, 'petty');
        preview.textContent = '';
        preview.appendChild(h('div.preview-row', {}, [
          a.mime.indexOf('image/') === 0 ? h('img.thumb', { src: 'data:' + a.mime + ';base64,' + a.base64, alt: 'Receipt' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: f.name })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { pickSeq++; attachment = null; preview.textContent = ''; paintFiles(); touch('file'); } }),
        ]));
        paintFiles();
        validate();
      }).catch(function (err) { if (mine === pickSeq) { attachment = null; preview.textContent = err.message; } })
        .finally(function () { if (preparing === job) preparing = null; validate(); });
      preparing = job;
    }
    fileInput.addEventListener('change', function () {
      pickFile(fileInput.files[0]);
      fileInput.value = '';   // so the same file can be chosen again
    });
    ['dragenter', 'dragover'].forEach(function (t) { dropzone.addEventListener(t, function (ev) { ev.preventDefault(); dropzone.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dropzone.addEventListener(t, function () { dropzone.classList.remove('drag'); }); });
    dropzone.addEventListener('drop', function (ev) {
      ev.preventDefault();
      pickFile(ev.dataTransfer && ev.dataTransfer.files[0]);
    });
    const reasonSel = h('select.input', {}, [h('option', { value: '', text: 'Choose a reason' })]
      .concat(state.ref.enums.filter(function (x) { return x.field === 'no_doc_reason' && x.value !== 'PURCHASE_NOT_ORDERED'; }).map(function (x) { return h('option', { value: x.value, text: x.label }); })));
    const reasonNote = h('input.input', { maxlength: 300, 'aria-label': 'Reason (optional)', placeholder: 'Reason (optional), e.g. street vendor' });
    reasonNote.hidden = true;
    reasonSel.addEventListener('change', function () { reasonNote.hidden = reasonSel.value !== 'OTHER'; touch('file'); });
    const noDoc = fieldBox('no_doc_reason', 'No receipt? Choose why', h('div.stack', {}, [reasonSel, reasonNote]));

    let body = [];
    let payloadOf;
    let action;
    let beforeSave = null;      // work to finish before the entry is saved (a new supplier is created first)
    // Required fields: [name, short name, message, filled?]. A red * on each; the message shows
    // once the field was touched and left empty; Save waits until all are filled.
    let rules = [];
    const touchedC = {};
    let ready = false;
    function touch(name) { touchedC[name] = true; validate(); }
    if (kind === 'spend') {
      let category = '';
      const catGrid = h('div.cat-grid', { role: 'radiogroup', 'aria-label': 'Category' });
      const paintCats = function () { catGrid.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.value === category); b.setAttribute('aria-checked', b.dataset.value === category); }); radioTabStop(catGrid); };
      state.ref.categories.filter(function (c) { return !offTheForm(c.value); }).sort(function (a, b) {
        const r = function (x) { const i = CATEGORY_ORDER.indexOf(x.value); return i === -1 ? 99 : i; };
        return r(a) - r(b);
      }).forEach(function (c) {
        catGrid.appendChild(h('button.chip-btn', { type: 'button', role: 'radio', 'data-value': c.value, text: categoryShort(c.value), title: c.label, onclick: function () { category = c.value; paintCats(); if (supplier) supplier.categoryChanged(); touch('expense_category'); } }));
      });
      paintCats();
      radioKeys(catGrid);
      // As on an expense: the supplier it was bought from, when it is one on the list (shown once the server keeps it).
      const newName = h('input.input', { autocomplete: 'off', maxlength: 200, oninput: function () { touch('new_supplier_name'); } });
      const newTax = h('input.input', { inputmode: 'numeric', autocomplete: 'off' });
      const newBank = h('input.input', { autocomplete: 'off' });
      const newAccount = h('input.input', { inputmode: 'numeric', autocomplete: 'off' });
      const newBox = h('div.payee-other', { hidden: true }, [
        h('p.hint', { text: ONE_TIME_SELLER }),
        fieldBox('new_supplier_name', 'Supplier name', newName),
        fieldBox('new_supplier_tax_id', 'Tax ID (MST)', newTax),
        fieldBox('new_supplier_bank_name', 'Bank', newBank),
        fieldBox('new_supplier_bank_account', 'Account number', newAccount),
      ]);
      const supplier = state.limits && state.limits.pettySupplier ? supplierPicker({
        listId: 'cash_supplier_list',
        below: newBox,
        category: function () { return category; },
        onPick: function (s) {       // a regular supplier suggests its usual category
          newBox.hidden = true;
          if (s && s.defaultCategory && !category && catGrid.querySelector('[data-value="' + s.defaultCategory + '"]')) { category = s.defaultCategory; paintCats(); touch('expense_category'); }
          validate();
        },
        onAddNew: function (typed) {  // a name typed in the search box is carried into the new-supplier form
          if (typed && !newName.value.trim()) newName.value = typed;
          newBox.hidden = false;
          if (!typed) newName.focus();
          validate();
        },
      }) : null;
      // The new supplier is created first, then the entry points at it.
      beforeSave = async function () {
        if (!supplier || supplier.value() !== NEW_SUPPLIER) return;
        try {
          const res = await Api.call('createSupplier', { name: newName.value.trim(), tax_id: newTax.value, bank_name: newBank.value, bank_account: newAccount.value, default_category: category });
          state.ref.suppliers.push(res.supplier);
          supplier.set(res.supplier.value);
          newBox.hidden = true;
        } catch (err) {
          const dup = err.details && err.details.find(function (d) { return d.existingId; });
          if (!dup) throw err;
          // Already in the list: nothing is saved. The existing supplier is selected, and the user checks it first.
          const name = dup.existingName || newName.value.trim();
          if (!state.ref.suppliers.some(function (s) { return s.value === dup.existingId; })) state.ref.suppliers.push({ value: dup.existingId, label: name });
          supplier.set(dup.existingId);
          newBox.hidden = true;
          const stop = new Error('This supplier is already in the list: ' + name + '. It is now selected. Check it, then press Save again.');
          stop.code = 'VALIDATION';
          stop.details = [{ field: 'supplier_id', message: stop.message }];
          throw stop;
        }
      };
      const outlet = h('select.input', {}, [h('option', { value: '', text: 'Choose the outlet' })]
        .concat(state.ref.outlets.map(function (o) { return h('option', { value: o.value, text: o.label }); })));
      note.placeholder = 'What was bought, and why in cash?';
      outlet.addEventListener('change', function () { touch('outlet_code'); });
      rules = [
        ['amount', 'Amount', 'Enter the amount. This field is required.', function () { return amount.value() > 0; }],
        ['file', 'Photo or reason', 'Attach a photo of the receipt, or choose why there is none.', function () { return Boolean(attachment || extras.length || reasonSel.value); }],
        ['outlet_code', 'Outlet', 'Choose the outlet. This field is required.', function () { return Boolean(outlet.value); }],
        ['expense_category', 'Category', 'Choose a category. This field is required.', function () { return Boolean(category); }],
        ['description', 'What for', 'Write what it was for. This field is required.', function () { return Boolean(note.value.trim()); }],
        ['entry_date', 'Date', 'Choose the date. This field is required.', function () { return Boolean(date.value); }],
        ['new_supplier_name', 'Supplier name', 'Enter the supplier name, or choose "Not listed / none".', function () { return !supplier || supplier.value() !== NEW_SUPPLIER || Boolean(newName.value.trim()); }],
      ];
      body = [
        fieldBox('amount', 'Amount', amount.el),
        fieldBox('file', 'Receipt (photo or PDF)', filesBox()),
        noDoc,
        fieldBox('outlet_code', 'For which outlet?', outlet),
        fieldBox('expense_category', 'Category', catGrid),
        supplier ? fieldBox('supplier_id', 'Supplier (optional)', supplier.el) : null,
        fieldBox('description', 'What for?', note),
        fieldBox('entry_date', 'Date', date),
      ];
      action = 'pettySpend';
      payloadOf = function () {
        return { amount: amount.value(), entry_date: date.value, outlet_code: outlet.value, expense_category: category, description: note.value.trim(),
          supplier_id: supplier ? supplier.value() : '',
          no_doc_reason: attachment || extras.length ? '' : reasonSel.value, no_doc_note: attachment || extras.length ? '' : reasonNote.value.trim() };
      };
    } else if (kind === 'deposit') {
      note.placeholder = 'e.g. Cheque no. 123, signed by Eddy';
      rules = [
        ['amount', 'Amount', 'Enter the amount. This field is required.', function () { return amount.value() > 0; }],
        ['entry_date', 'Date', 'Choose the date. This field is required.', function () { return Boolean(date.value); }],
      ];
      body = [
        h('p.hint', { text: 'Record the cash you are handing to the cash keeper. It is added to the balance when she confirms how much she received.' }),
        fieldBox('amount', 'Amount', amount.el),
        fieldBox('entry_date', 'Date', date),
        fieldBox('file', 'Cheque or withdrawal slip (optional)', filesBox()),
        fieldBox('description', 'Note (optional)', note),
      ];
      action = 'pettyDeposit';
      payloadOf = function () { return { amount: amount.value(), entry_date: date.value, description: note.value.trim() }; };
    } else {
      const expected = state.cash ? state.cash.balance : null;
      const diff = h('p.hint.words');
      amount.input.onamount = function () {
        if (expected === null) return;
        const d = amount.value() - expected;
        diff.textContent = !amount.input.value ? '' : d === 0 ? 'Matches the records.' : (d < 0 ? 'Short by ' : 'Over by ') + fmtMoney(Math.abs(d)) + ' — the owners will be told.';
        diff.classList.toggle('warn-text', Boolean(amount.input.value) && d !== 0);
      };
      note.placeholder = 'Optional note';
      rules = [
        ['counted', 'Cash counted', 'Enter the cash you counted (0 if the box is empty).', function () { return amount.input.value !== ''; }],
      ];
      body = [
        h('p.hint', { text: 'Count all the cash in the box and enter the total. ' + (expected === null ? '' : 'The records say ' + fmtMoney(expected) + '. ') + 'Any difference is recorded and the balance then matches your count.' }),
        fieldBox('counted', 'Cash counted', h('div', {}, [amount.el, diff])),
        fieldBox('description', 'Note (optional)', note),
      ];
      action = 'pettyCount';
      payloadOf = function () { return { counted: amount.input.value === '' ? '' : amount.value(), description: note.value.trim() }; };
    }

    const submit = h('button.btn.btn-primary.btn-big', { type: 'button', text: kind === 'count' ? 'Save the count' : 'Save' });
    const missingLine = h('p.hint.missing-line', { hidden: true, 'aria-live': 'polite' });
    let saving = false;
    rules.forEach(function (r) {
      const lbl = errs[r[0]] && errs[r[0]].parentNode && errs[r[0]].parentNode.querySelector('.label');
      if (lbl) lbl.appendChild(h('span.req-star', { text: ' *', 'aria-hidden': 'true' }));
      const c = controlOf(r[0]);
      if (c) c.setAttribute('aria-required', 'true');
    });
    amount.input.addEventListener('input', function () { touch(kind === 'count' ? 'counted' : 'amount'); });
    note.addEventListener('input', function () { if (touchedC.description || note.value) touch('description'); });
    date.addEventListener('change', function () { touch('entry_date'); });
    function overBalance() { return kind === 'spend' && Boolean(state.cash) && amount.value() > Number(state.cash.balance); }
    function validate(showAll) {
      if (!ready) return [];
      const missing = [];
      rules.forEach(function (r) {
        const p = errs[r[0]];
        const c = controlOf(r[0]);
        if (r[3]()) { if (p && p.dataset.required) { p.hidden = true; delete p.dataset.required; if (c) c.removeAttribute('aria-invalid'); } return; }
        missing.push(r[1]);
        if (showAll) touchedC[r[0]] = true;
        if (p && touchedC[r[0]]) { p.textContent = r[2]; p.hidden = false; p.dataset.required = '1'; if (c) c.setAttribute('aria-invalid', 'true'); }
      });
      const over = overBalance();
      if (over && errs.amount) {
        errs.amount.textContent = 'More than the cash in the box (' + fmtMoney(state.cash.balance) + '). Check the amount, or confirm the latest deposit first.';
        errs.amount.hidden = false;
        errs.amount.dataset.required = '1';
      }
      if (!saving) lock(submit, missing.length > 0 || over);
      missingLine.textContent = missing.length ? 'Still needed: ' + missing.join(', ') : '';
      missingLine.hidden = !missing.length;
      return missing;
    }
    submit.addEventListener('click', async function () {
      if (validate(true).length || overBalance()) return;
      saving = true;
      submit.disabled = true;
      summary.hidden = true;
      try {
        if (preparing) { submit.textContent = 'Preparing photo…'; await preparing; }
        submit.textContent = 'Saving…';
        if (beforeSave) await beforeSave();
        const payload = payloadOf();
        if (attachment && kind !== 'count') Object.assign(payload, await filePayload(attachment));
        if (extras.length && kind !== 'count') {
          payload.extraFiles = [];
          for (let i = 0; i < extras.length; i++) { const fp = await filePayload(extras[i]); payload.extraFiles.push(fp.fileRef ? { ref: fp.fileRef } : fp.file); }
        }
        let res;
        try { res = await Api.call(action, payload); } catch (ex) {
          const expired = [attachment].concat(extras).filter(Boolean).map(function (x) { return uploadExpired(ex, x); }).some(Boolean);
          if (!expired) throw ex;
          delete payload.fileRef;
          if (attachment) Object.assign(payload, await filePayload(attachment));
          if (extras.length) {
            payload.extraFiles = [];
            for (let i = 0; i < extras.length; i++) { const fp = await filePayload(extras[i]); payload.extraFiles.push(fp.fileRef ? { ref: fp.fileRef } : fp.file); }
          }
          res = await Api.call(action, payload);
        }
        toast(kind === 'spend' ? 'Saved · ' + fmtMoney(res.balance) + ' left' : kind === 'deposit' ? 'Deposit recorded — waiting for the keeper to confirm'
          : res.difference ? 'Count saved · ' + (res.difference < 0 ? 'short ' : 'over ') + fmtMoney(Math.abs(res.difference)) : 'Count saved · matches', 'ok');
        state.cash = res.cash || null;   // the answer carries the updated Cash tab
        homeTab = 'cash';
        go('/');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details && err.details.length) showProblems(err.details);
        else showProblems([{ field: '_form', message: err.message + (err.code === 'NETWORK' ? ' Your form is kept.' : '') }], 'Not saved');
      } finally {
        saving = false;
        submit.textContent = kind === 'count' ? 'Save the count' : 'Save';
        submit.disabled = false;
        validate();
      }
    });
    ready = true;
    validate();
    mount(page([back, h('h1.title', { text: titles[kind] }), summary, h('section.form-section', {}, [h('p.hint', { text: REQUIRED_NOTE })].concat(body, [errs._form])), missingLine, submit]));
  }

  /** #/cash/<id>: one entry, its photo, and "cancel this entry". */
  async function renderCashEntry(id) {
    const back = h('a.back', { href: '#/', text: 'Back' });
    const here = function () { return location.hash === '#/cash/' + encodeURIComponent(id); };
    // Already in the Cash list: shown at once; only the photo is fetched.
    const known = state.cash ? (state.cash.pending || []).concat(state.cash.entries || []).filter(function (e) { return e.entry_id === id; })[0] : null;
    if (known) {
      drawCashEntry(back, Object.assign({}, known, { attachment: known.has_doc ? { pending: true } : null,
        extra_files: Array.apply(null, Array(known.extra_count || 0)).map(function () { return { pending: true }; }) }));
      if (!known.has_doc) return;
    } else {
      mount(page([back, loading()]));
    }
    let x;
    try { x = (await Api.call('pettyEntry', { id: id })).entry; } catch (err) {
      if (!here()) return;
      if (known) { const slot = document.querySelector('[data-slot="attachment"]'); if (slot) slot.replaceWith(h('div.doc-missing', { text: 'Could not load the photo: ' + err.message })); }
      else mount(page([back, h('p.empty', { text: err.message })]));
      return;
    }
    if (!here()) return;
    if (!known) { drawCashEntry(back, x); return; }
    const slot = document.querySelector('[data-slot="attachment"]');
    if (slot) slot.replaceWith(x.attachment ? attachmentView(x.attachment) : h('div.doc-missing', { text: 'The photo could not be loaded.' }));
    (x.extra_files || []).forEach(function (f, i) {
      const ph = document.querySelector('[data-slot="extra-' + i + '"]');
      if (ph) ph.replaceWith(attachmentView(f));
    });
  }

  function drawCashEntry(back, x) {
    const row = function (k, v) { return v ? h('div.kv', {}, [h('span.k', { text: k }), h('span.v', { text: v })]) : null; };
    const doc = x.entry_type === 'SPEND' || x.attachment
      ? (x.attachment ? attachmentView(x.attachment) : h('div.doc-missing.none', { text: 'No receipt: ' + label('no_doc_reason', x.no_doc_reason) + (x.no_doc_note ? ' — ' + x.no_doc_note : '') }))
      : null;
    const more = (x.extra_files || []).length ? [h('p.section-title.more-files', { text: 'More files (' + x.extra_files.length + ')' })].concat(
      x.extra_files.map(function (f, i) { return h('div.extra-file', {}, [attachmentView(f, 'extra-' + i)]); })) : [];
    homeTab = 'cash';
    mount(page([
      back,
      h('div.detail-grid', {}, [
        doc ? h('div.detail-media', {}, [doc].concat(more)) : null,
        h('div.detail-side', {}, [
          x.voided ? h('div.flag.warn', { text: 'This entry was cancelled. See the cancelling entry in the list.' }) : null,
          h('div.card', {}, [
            h('div.item-top', {}, [h('span.amount.big', { text: x.entry_type === 'DEPOSIT' && x.status !== 'RECEIVED' ? fmtMoney(x.amount) : signedMoney(x.effect) }),
              cashChip(x)]),
            row('Entry', x.entry_id),
            row('Date', fmtDate(x.entry_date)),
            row('Outlet', x.outlet_code),
            row('Category', x.expense_category ? categoryLabel(x.expense_category) : ''),
            row('Supplier', x.supplier_name),
            row(x.entry_type === 'COUNT' ? 'Count' : 'What for', x.description),
            row('Recorded by', x.recorded_by_name + ' · ' + fmtDateTime(x.created_at)),
            x.entry_type === 'DEPOSIT' ? row('Status', x.status === 'PENDING' ? 'Waiting for the keeper to confirm' : x.status === 'CANCELLED' ? 'Cancelled' : 'Received') : null,
            x.entry_type === 'DEPOSIT' && x.status === 'RECEIVED' ? row('Received', fmtMoney(x.received_amount) + ' by ' + x.confirmed_by_name + ' · ' + fmtDateTime(x.confirmed_at)) : null,
            row('Cancels', x.voids_entry_id),
            row('Reason', x.void_reason),
          ]),
          x.can_void ? confirmPanel({
            open: x.entry_type === 'DEPOSIT' && x.status === 'PENDING' ? 'Cancel this deposit' : 'Recorded by mistake? Cancel this entry',
            danger: true, required: true, label: 'Why is it wrong? (required)', placeholder: 'e.g. typed the amount twice',
            intro: 'Nothing is deleted: a cancelling entry is added and the balance is corrected. The owners are told.',
            confirm: 'Cancel entry',
            run: async function (reason) {
              const res = await Api.call('pettyVoid', { id: x.entry_id, reason: reason });
              toast('Cancelled · balance ' + fmtMoney(res.balance), 'ok');
              state.cash = res.cash || null;
              go('/');
            },
          }) : null,
        ]),
      ]),
    ]));
  }

  // ----------------------------------------------------------- expense view

  function loading(text) {
    return h('div.center-block', { role: 'status', 'aria-live': 'polite' }, [h('div.spinner', { 'aria-hidden': 'true' }), h('p.sub', { text: text || 'Loading…' })]);
  }

  /** A list that could not be loaded: the reason and a way to ask again, not a spinner that never ends. */
  function loadFailed(message, retry) {
    return h('p.empty', { role: 'alert' }, [message, h('button.btn.btn-rows', { type: 'button', text: 'Try again', onclick: retry })]);
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function attachmentView(att, slot) {
    if (att && att.pending) return h('div.doc-missing.doc-loading', { 'data-slot': slot || 'attachment' }, [h('div.spinner'), h('span', { text: 'Loading photo…' })]);
    if (!att) return h('div.doc-missing.none', { text: 'No document attached' });
    if (att.error) return h('div.doc-missing', { text: att.error });
    const url = URL.createObjectURL(base64ToBlob(att.base64, att.mime));
    if (att.mime === 'application/pdf') {
      return h('div.doc-links', {}, [
        h('a.btn.btn-doc', { href: url, target: '_blank', rel: 'noopener' }, ['Open PDF document']),
        h('a.link', { href: url, download: 'invoice.pdf', text: 'Save the PDF to this device' }),
      ]);
    }
    const open = h('button.doc-open', { type: 'button', 'aria-label': 'Open the photo full size', onclick: function () { openViewer(url); } },
      [h('img.doc-img', { src: url, alt: 'Invoice' })]);
    return h('div.doc', {}, [open, h('p.hint.center-text', { text: 'Tap the photo to zoom' })]);
  }

  /**
   * A photo on top of the page, fitted to the screen. − and + (or a tap on the photo) zoom, and a zoomed
   * photo scrolls; Previous and Next go through the expense's photos. Close, Esc, a tap on the dark edge
   * or the phone's Back button close it (not the expense).
   */
  function openViewer(url) {
    const pics = [].map.call(document.querySelectorAll('img.doc-img'), function (i) { return i.src; });
    const list = pics.indexOf(url) !== -1 ? pics : [url];
    let at = list.indexOf(url);
    let zoom = 1;
    const STEPS = [1, 1.5, 2, 3, 4];
    const viewer = h('div.viewer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo' });
    const img = h('img.viewer-img', { alt: 'Photo, full size' });
    const stage = h('div.viewer-stage', {}, [img]);
    const count = h('span.viewer-count');
    const btn = function (text, label, fn) { return h('button.viewer-btn', { type: 'button', text: text, 'aria-label': label, onclick: fn }); };
    const prev = btn('Previous', 'Previous photo', function () { show(at - 1); });
    const next = btn('Next', 'Next photo', function () { show(at + 1); });
    const out = btn('−', 'Zoom out', function () { setZoom(STEPS[Math.max(0, STEPS.indexOf(zoom) - 1)]); });
    const fit = btn('Fit', 'Fit to the screen', function () { setZoom(1); });
    const inn = btn('+', 'Zoom in', function () { setZoom(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(zoom) + 1)]); });
    const save = h('a.viewer-btn', { text: 'Download' });
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', close);
      document.removeEventListener('keydown', keys);
      viewer.remove();
    }
    // Zoomed: a width in pixels from the fitted size, so the photo can be scrolled; fitted: CSS keeps it on screen.
    function size() {
      if (zoom === 1 || !img.naturalWidth) {
        img.style.width = ''; img.style.maxWidth = ''; img.style.maxHeight = '';
      } else {
        const fitted = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight, 1);
        img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
        img.style.width = Math.round(img.naturalWidth * fitted * zoom) + 'px';
      }
      img.classList.toggle('zoomed', zoom > 1);
      // Zoomed, a finger moves the photo freely (in every direction, as a hand tool); fitted, the phone's own pinch works.
      stage.style.touchAction = zoom > 1 ? 'none' : '';
      out.disabled = zoom === 1; fit.disabled = zoom === 1; inn.disabled = zoom === STEPS[STEPS.length - 1];
    }
    function setZoom(z) { zoom = z; size(); }
    function show(i) {
      at = (i + list.length) % list.length;
      zoom = 1;
      img.src = list[at];
      save.href = list[at];
      save.setAttribute('download', 'photo-' + (at + 1) + '.jpg');
      count.textContent = list.length > 1 ? (at + 1) + ' / ' + list.length : '';
      size();
    }
    function keys(ev) {
      if (ev.key === 'Escape') history.back();
      else if (ev.key === 'ArrowLeft' && list.length > 1) show(at - 1);
      else if (ev.key === 'ArrowRight' && list.length > 1) show(at + 1);
      else if (ev.key === '+' || ev.key === '=') inn.click();
      else if (ev.key === '-') out.click();
    }
    img.addEventListener('load', size);
    // A click zooms in where it points; a zoomed photo is moved by dragging it (mouse or finger), or scrolled.
    img.setAttribute('draggable', 'false');
    img.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
    let drag = null;
    let moved = false;
    img.addEventListener('click', function (ev) {
      if (moved) { moved = false; return; }
      if (zoom !== 1) return;
      const r = img.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
      setZoom(2);
      stage.scrollLeft = img.offsetLeft + fx * img.offsetWidth - stage.clientWidth / 2;
      stage.scrollTop = img.offsetTop + fy * img.offsetHeight - stage.clientHeight / 2;
    });
    stage.addEventListener('pointerdown', function (ev) {
      if (drag || zoom === 1 || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      drag = { x: ev.clientX, y: ev.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      moved = false;
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add('dragging');
      ev.preventDefault();
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      stage.scrollLeft = drag.left - dx;
      stage.scrollTop = drag.top - dy;
    });
    const endDrag = function () { drag = null; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('click', function (ev) {
      if (moved) { moved = false; return; }
      if (ev.target === stage) history.back();
    });
    prev.hidden = next.hidden = list.length < 2;
    viewer.appendChild(h('div.viewer-bar.top', {}, [count, h('button.viewer-btn.viewer-close', { type: 'button', text: 'Close', onclick: function () { history.back(); } })]));
    viewer.appendChild(stage);
    viewer.appendChild(h('div.viewer-bar', {}, [prev, out, fit, inn, save, next]));
    history.pushState({ viewer: true }, '');
    window.addEventListener('popstate', close);
    document.addEventListener('keydown', keys);
    document.body.appendChild(viewer);
    show(at);
  }

  const ACTION_LABEL = {
    SUBMIT: 'Submitted', SUBMIT_DIRECT_TO_ACCOUNTANT: 'Submitted to accountant', APPROVE: 'Approved',
    REJECT: 'Rejected', REQUEST_INFO: 'Asked for more info', RESUBMIT: 'Resubmitted',
    EDIT: 'Edited', EDIT_NEEDS_REAPPROVAL: 'Edited — needs approval again', CANCEL: 'Cancelled', POST_CHECK: 'Cash payment post-checked',
    PAY_FULL: 'Paid in full', PAY_PARTIAL: 'Partial payment',
    REVIEW_REQUEST: 'Accountant asked for a review', ACCOUNTANT_REQUEST_INFO: 'Accountant asked for more info', PAY_VOID: 'Payment record voided',
    POST_CHECK_PROBLEM: 'Problem reported at the cash check', SYSTEM_CLEAR_DEMO: 'Demo data cleared',
    PAYMENT_PROBLEM: 'Problem reported with the payment', PAYMENT_PROBLEM_CLOSED: 'Payment problem closed',
  };

  // Flags that ask for a look, not errors: amber, as the warnings of the payment check. Every other flag stays red.
  const WARNING_FLAGS = ['NO_DOCUMENT', 'NEW_SUPPLIER'];
  // The same words as on the form and the payment button.
  const REQUEST_TYPE_LABEL = { INVOICE: 'Already bought', PURCHASE_REQUEST: 'Not bought yet' };
  /** "Full payment" when it is the only one of a paid expense, "Final payment" for the one that completed it, else "Partial payment". */
  function paymentLabel(p, e) {
    const live = (e.payments || []).filter(function (x) { return x.payment_seq !== 'REVERSAL' && !x.voided; });
    const paid = e.status === 'PAID' || e.status === 'CLOSED';
    if (!paid || live[live.length - 1] !== p) return 'Partial payment';
    return live.length === 1 ? 'Full payment' : 'Final payment';
  }

  function timelineView(items) {
    // One line per action; the field-level rows of the same action are folded in.
    const lines = [];
    items.forEach(function (t) {
      const last = lines[lines.length - 1];
      if (last && last.at === t.at && last.action === t.action) { if (t.field) last.fields.push(t); return; }
      lines.push({ at: t.at, by: t.by, action: t.action, fields: t.field ? [t] : [] });
    });
    const isReason = function (f) { return ['info_request', 'rejection_reason', 'payment', 'cancel_reason', 'post_check_note', 'post_check_problem', 'review_request', 'void', 'void_reason', 'payment_problem', 'payment_problem_closed'].indexOf(f.field) !== -1; };
    return h('ol.timeline', {}, lines.map(function (l) {
      const note = l.fields.filter(isReason).map(function (f) {
        if (f.field !== 'payment' && f.field !== 'void') return '"' + f.value + '"';
        const parts = String(f.value).split(' ');   // "PAY-0001 500000 FULL"
        return (f.field === 'void' ? 'Voided ' : '') + parts[0] + ' · ' + fmtMoney(parts[1]);
      }).join(' ');
      const changed = l.fields.filter(function (f) { return !isReason(f); }).map(function (f) { return f.field.replace(/_/g, ' '); }).join(', ');
      return h('li', {}, [
        h('span.tl-what', { text: (ACTION_LABEL[l.action] || l.action) + ' · ' + l.by }),
        h('span.tl-when', { text: fmtDateTime(l.at) }),
        note ? h('span.tl-note', { text: note }) : null,
        changed ? h('span.tl-when', { text: 'Changed: ' + changed }) : null,
      ]);
    }));
  }

  /** opts.silent: background refresh — no spinner, keep scroll, re-render only if something changed. */
  // Photos of the last expenses opened (they don't change once uploaded).
  const filesCache = {};
  function knownItem(id) {
    const lists = ['to_approve', 'to_pay', 'to_check', 'to_fix', 'mine', 'all'];
    for (let i = 0; i < lists.length; i++) {
      const hit = (state.views[lists[i]] || []).find(function (x) { return x.expense_id === id; });
      if (hit) return hit;
    }
    return null;
  }
  /** Puts the photos into their placeholders once they arrive (the rest of the page is left alone). */
  function fillFiles(e, files) {
    e.attachment = e.attachment ? (files.attachment || null) : null;
    (e.extra_files || []).forEach(function (f, i) {
      const got = (files.extra_files || [])[i] || null;
      e.extra_files[i] = got;
      const ph = document.querySelector('[data-slot="extra-' + i + '"]');
      if (ph) ph.replaceWith(attachmentView(got || { error: 'This file could not be loaded.' }));
    });
    (e.payments || []).forEach(function (p) { if (p.proof) p.proof = (files.proofs || {})[p.payment_id] || null; });
    const slot = document.querySelector('[data-slot="attachment"]');
    if (slot) slot.replaceWith(attachmentView(files.attachment || null));
    (e.payments || []).forEach(function (p) {
      const ph = document.querySelector('[data-proof="' + p.payment_id + '"]');
      if (!ph) return;
      const view = proofView(p);
      if (view) ph.replaceWith(view); else ph.remove();
    });
  }

  async function renderExpense(id, opts) {
    const silent = Boolean(opts && opts.silent);
    const backLink = function () { return h('a.back', { href: '#/', text: 'Back' }); };
    if (!silent) {
      // What the list already knows shows at once; the full details follow.
      const it = knownItem(id);
      mount(page([backLink(), it ? h('div.card', { 'data-status': it.status }, [
        h('div.item-top', {}, [h('span.amount.big', { text: fmtMoney(it.amount_total) }), statusChip(it.status)]),
        h('div.item-mid', { text: categoryShort(it.expense_category) + (it.supplier_name ? ' · ' + it.supplier_name : it.description ? ' · ' + it.description : '') }),
        h('div.item-meta', {}, [h('span', { text: it.expense_id }), h('span', { text: fmtDate(it.created_at) })]),
      ]) : null, loading('Loading details…')]));
    }
    // Details and photos are asked for at the same time.
    const fetchFiles = function () { return Api.call('getExpenseFiles', { id: id }).then(function (f) { filesCache[id] = f; return f; }); };
    let filesPromise = filesCache[id] ? Promise.resolve(filesCache[id]) : fetchFiles();
    filesPromise.catch(function () { /* the detail call reports problems */ });
    let e;
    try {
      e = await Api.call('getExpense', { id: id, lite: true });
    } catch (err) {
      if (!silent) mount(page([backLink(), h('p.empty', { text: err.message })]));
      return;
    }
    // Photos kept from an earlier look belong to that version: after an edit or a new payment they are fetched again.
    if (filesCache[id] && filesCache[id].stamp && filesCache[id].stamp !== e.updated_at) {
      delete filesCache[id];
      filesPromise = fetchFiles();
    }
    filesPromise.then(function (f) { if (!f.stamp) f.stamp = e.updated_at; }, function () { /* reported below */ });
    if (filesCache[id]) {
      e.attachment = e.attachment ? filesCache[id].attachment : null;
      e.extra_files = (e.extra_files || []).map(function (f, i) { return (filesCache[id].extra_files || [])[i] || null; });
      (e.payments || []).forEach(function (p) { if (p.proof) p.proof = filesCache[id].proofs[p.payment_id] || null; });
    } else {
      filesPromise.then(function (files) {
        if (location.hash === '#/expense/' + encodeURIComponent(id)) fillFiles(e, files);
      }, function () {
        const slot = document.querySelector('[data-slot="attachment"]');
        if (slot) slot.replaceWith(h('div.doc-missing', { text: 'The photo could not be loaded. Go back and open it again.' }));
      });
    }
    if (location.hash !== '#/expense/' + encodeURIComponent(id)) return; // user navigated away meanwhile
    if (silent && state.detail && state.detail.expense_id === e.expense_id &&
        state.detail.updated_at === e.updated_at && state.detail.status === e.status) return;
    state.detail = e;

    const row = function (k, v) { return v ? h('div.kv', {}, [h('span.k', { text: k }), h('span.v', { text: v })]) : null; };
    const hasVat = e.amount_before_vat !== '' && e.amount_before_vat !== undefined && e.amount_before_vat !== null;
    if (silent) toast('Updated: ' + label('status', e.status));
    mount(page([
      backLink(),
      h('div.detail-grid', {}, [
      h('div.detail-media', {}, [
        attachmentView(e.attachment),
      ].concat((e.extra_files || []).length ? [h('p.section-title.more-files', { text: 'More files (' + e.extra_files.length + ')' })].concat(
        e.extra_files.map(function (f, i) { return h('div.extra-file', {}, [attachmentView(f, 'extra-' + i)]); })) : [])),
      h('div.detail-side', {}, [
      e.flags.length ? h('div.flags', {}, e.flags.map(function (f) {
        return h('div.flag' + (f.level === 'info' ? '.info' : WARNING_FLAGS.indexOf(f.code) !== -1 ? '.warn' : ''), { text: f.message });
      })) : null,
      h('div.card', { 'data-status': e.status }, [
        h('div.item-top', {}, [h('span.amount.big', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
        h('div.item-mid', { text: categoryLabel(e.expense_category) + ' · ' + (REQUEST_TYPE_LABEL[e.request_type] || label('request_type', e.request_type)) }),
        row('Submitted by', e.submitted_by_name + ' · ' + e.outlet_code),
        row('Submitted', fmtDateTime(e.created_at)),
        row('Sent to', e.send_to_name),
        row('Supplier', e.supplier ? e.supplier.name + (e.supplier.tax_id ? ' · Tax ID ' + e.supplier.tax_id : '') + (e.supplier.status === 'PENDING' ? ' · NOT APPROVED YET' : '') : ''),
        row('Who gets paid', e.payee_type ? label('payee_type', e.payee_type) : ''),
        row('Refund due', e.status === 'CANCELLED' && e.refund_amount ? fmtMoney(e.refund_amount) : ''),
        row('Payee', [e.payee_name, e.payee_bank, e.payee_account_masked].filter(Boolean).join(' · ')),
        row('Description', e.description),
        row('Due date', fmtDate(e.due_date)),
        row('Document', e.document_type ? (state.ref.documentTypes.find(function (d) { return d.value === e.document_type; }) || { label: e.document_type }).label : ''),
        row('Invoice', [e.invoice_no, fmtDate(e.invoice_date), e.is_red_invoice === true ? 'VAT red invoice' : ''].filter(Boolean).join(' · ')),
        row('Before VAT', hasVat ? fmtMoney(e.amount_before_vat) + ' + VAT ' + fmtMoney(e.vat_amount) : ''),
        row('Payment method', e.payment_method ? label('payment_method', e.payment_method) : ''),
        row(e.status === 'NEEDS_INFO' ? 'Info requested' : 'Last info request', e.info_request),
        row('Rejection reason', e.rejection_reason),
        row('Decided by', ['APPROVED', 'PARTIAL', 'PAID', 'CLOSED', 'REJECTED', 'NEEDS_INFO'].indexOf(e.status) !== -1 ? e.approver_name : ''),
        row('Paid so far', Number(e.amount_paid) ? fmtMoney(e.amount_paid) : ''),
        row('Balance due', e.status === 'PARTIAL' ? fmtMoney(e.balance_due) : ''),
        row('Bank order', bankOrderWaits(e) ? 'Created ' + fmtDateTime(e.bank_order_at) + (e.bank_order_by_name ? ' by ' + e.bank_order_by_name : '') + ' · waiting for ' + bankApprover() + ' to release it' : ''),
        row('ID', e.expense_id),
      ]),
      e.can.decide ? decisionPanel(e) : null,
      e.can.approveSupplier ? supplierApprovalCard(e) : null,
      e.pay_blocked ? h('div.flag.warn', { text: e.pay_blocked }) : null,
      e.pay_to && e.can.pay ? payToCard(e.pay_to) : null,
      bankOrdersOn() && (e.can.bankOrder || e.can.cancelBankOrder) ? bankOrderPanel(e) : null,
      e.can.pay ? paymentPanel(e) : null,
      e.can.requestReview ? reviewRequestPanel(e) : null,
      e.can.postCheck ? postCheckPanel(e) : null,
      e.payments && e.payments.length ? h('h2.section-title', { text: 'Payments' }) : null,
      e.payments && e.payments.length ? h('div.list.single', {}, e.payments.map(function (p) { return paymentCard(p, e); })) : null,
      e.can.resolvePayment ? resolvePaymentPanel(e) : null,
      e.can.reportPayment ? reportPaymentPanel(e) : null,
      e.can.edit ? h('a.btn' + (e.status === 'NEEDS_INFO' ? '.btn-primary.btn-big' : ''), { href: '#/edit/' + encodeURIComponent(e.expense_id) },
        [e.status === 'NEEDS_INFO' ? 'Edit and resubmit' : 'Edit']) : null,
      e.can.cancel ? cancelPanel(e) : null,
      h('h2.section-title', { text: 'History' }),
      timelineView(e.timeline),
      ]),
      ]),
    ]), silent);
  }

  function decisionPanel(e) {
    const panel = h('div.decide');
    const reasonBox = h('textarea.input', { rows: 3, id: 'decision_reason' });
    const err = h('p.error', { hidden: true });
    let busy = false;

    function setDisabled(on) { panel.querySelectorAll('button').forEach(function (b) { b.disabled = on; }); }

    async function send(decision) {
      if (busy) return;
      const reason = reasonBox.value.trim();
      if (decision !== 'APPROVE' && !reason) { err.textContent = 'Please write a reason.'; err.hidden = false; reasonBox.focus(); return; }
      busy = true;
      setDisabled(true);
      // Back to the list at once; the decision is saved in the background (a few seconds).
      // If saving fails, the item comes back to the list and a message says why.
      const from = (state.views.for_owners || []).some(function (x) { return x.expense_id === e.expense_id; }) ? 'for_owners' : 'to_approve';
      const item = (state.views[from] || []).find(function (x) { return x.expense_id === e.expense_id; });
      removeFrom(from, e.expense_id);
      savingIds[e.expense_id] = true;
      state.detail = null;
      toast({ APPROVE: 'Approving ', REJECT: 'Rejecting ', REQUEST_INFO: 'Sending back for info: ' }[decision] + e.expense_id + '…');
      go('/');
      Api.call('decide', { id: e.expense_id, decision: decision, reason: reason, seen_updated_at: e.updated_at })
        .then(function (res) {
          if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
          toast({ APPROVE: 'Approved ', REJECT: 'Rejected ', REQUEST_INFO: 'Sent back for info: ' }[decision] + e.expense_id, 'ok');
        })
        .catch(function (ex) {
          if (item) upsert(from, item);
          notSaved.push('Not saved — ' + e.expense_id + ': ' + ex.message);
          toast('Not saved — ' + e.expense_id + ': ' + ex.message);
        })
        .finally(function () {
          delete savingIds[e.expense_id];
          busy = false;
          if (onHome()) renderHome(true);
        });
    }

    function showMain() {
      panel.textContent = '';
      err.hidden = true;
      panel.appendChild(h('h2.section-title', { text: 'Your decision' }));
      panel.appendChild(h('button.btn.btn-approve.btn-big', { type: 'button', text: 'Approve', onclick: showApproveConfirm }));
      panel.appendChild(h('div.row', {}, [
        h('button.btn', { type: 'button', text: 'Request info', onclick: function () { showReason('REQUEST_INFO'); } }),
        h('button.btn.btn-danger', { type: 'button', text: 'Reject', onclick: function () { showReason('REJECT'); } }),
      ]));
      panel.appendChild(err);
    }
    function showApproveConfirm() {
      panel.textContent = '';
      panel.appendChild(h('p.confirm-text', { text: 'Approve ' + fmtMoney(e.amount_total) + ' from ' + e.submitted_by_name + '? It goes to the accountant for payment.' }));
      panel.appendChild(h('div.row', {}, [
        h('button.btn', { type: 'button', text: 'Cancel', onclick: showMain }),
        h('button.btn.btn-approve', { type: 'button', text: 'Yes, approve', onclick: function () { send('APPROVE'); } }),
      ]));
      panel.appendChild(err);
    }
    function showReason(decision) {
      const reject = decision === 'REJECT';
      panel.textContent = '';
      err.hidden = true;
      reasonBox.placeholder = reject ? 'Why is this rejected?' : 'What should the submitter add or fix?';
      panel.appendChild(starLabel(h('label.label', { for: 'decision_reason', text: reject ? 'Reason for rejecting' : 'What is missing?' })));
      panel.appendChild(reasonBox);
      panel.appendChild(err);
      const act = h('button.btn' + (reject ? '.btn-danger' : '.btn-primary'), { type: 'button', text: reject ? 'Reject' : 'Send back', onclick: function () { send(decision); } });
      panel.appendChild(h('div.row', {}, [h('button.btn', { type: 'button', text: 'Cancel', onclick: showMain }), act]));
      requireText(reasonBox, act, err, reject ? 'Write why it is rejected. This field is required.' : 'Write what is missing. This field is required.');
      reasonBox.focus();
    }
    showMain();
    return panel;
  }

  // ------------------------------------------------------- lifecycle panels

  /** Red * after a label's text ("(required)" written in the text is dropped). */
  function starLabel(labelEl) {
    labelEl.textContent = labelEl.textContent.replace(/\s*\(required\)\s*$/i, '');
    labelEl.appendChild(h('span.req-star', { text: ' *', 'aria-hidden': 'true' }));
    return labelEl;
  }

  /** A button that waits for something to be filled in: grey, unlike one that is busy saving. */
  function lock(button, on) {
    button.disabled = on;
    button.classList.toggle('not-ready', on);
  }

  /**
   * A required text box in a panel: its button waits until something is typed, and
   * "required" shows once the box was typed in and emptied again.
   */
  function requireText(box, button, errEl, message) {
    box.setAttribute('aria-required', 'true');
    let touched = false;
    function check() {
      const ok = box.value.trim() !== '';
      lock(button, !ok);
      if (!ok && touched) { errEl.textContent = message; errEl.hidden = false; errEl.dataset.req = '1'; }
      else if (errEl.dataset.req) { errEl.hidden = true; delete errEl.dataset.req; }
    }
    box.oninput = function () { touched = true; check(); };
    check();
  }

  /**
   * Uploads a prepared photo at once, while the form is still being filled in;
   * the form then sends only its reference. If this fails, the form sends the
   * photo itself, as before.
   */
  function startUpload(att, purpose) {
    att.upload = Api.call('uploadFile', { purpose: purpose, file: { name: att.name, mime: att.mime, base64: att.base64, sha256: att.sha256 } })
      .then(function (r) { att.ref = r.ref; return r.ref; })
      .catch(function () { att.ref = null; return null; });
    return att.upload;
  }
  /** What to send for a photo: its reference when the upload is done, else the photo. */
  async function filePayload(att) {
    if (att.upload) await att.upload;
    return att.ref ? { fileRef: att.ref } : { file: { name: att.name, mime: att.mime, base64: att.base64, sha256: att.sha256 } };
  }
  /** The reference ran out (6 h): send the photo itself next time. */
  function uploadExpired(err, att) {
    const hit = att && err && err.details && err.details.some(function (d) { return d.code === 'FILE_EXPIRED'; });
    if (hit) { att.ref = null; att.upload = null; }
    return hit;
  }

  /** Small reusable "reason + confirm" panel. */
  let panelSeq = 0;
  function confirmPanel(opts) {
    const panel = h('div.decide' + (opts.danger ? '.problem-panel' : ''));
    const boxId = 'panel_box_' + (++panelSeq);
    const box = h('textarea.input', { rows: 2, placeholder: opts.placeholder, id: boxId });
    const err = h('p.error', { hidden: true });
    function collapsed() {
      panel.textContent = '';
      panel.appendChild(h('button.btn' + (opts.danger ? '.btn-danger' : ''), { type: 'button', text: opts.open, onclick: expanded }));
    }
    function expanded() {
      panel.textContent = '';
      if (opts.intro) panel.appendChild(h('p.confirm-text', { text: opts.intro }));
      const lbl = h('label.label', { for: boxId, text: opts.label });
      panel.appendChild(opts.required ? starLabel(lbl) : lbl);
      panel.appendChild(box);
      panel.appendChild(err);
      const go2 = h('button.btn' + (opts.danger ? '.btn-danger' : '.btn-approve'), { type: 'button', text: opts.confirm });
      if (opts.required) requireText(box, go2, err, 'This field is required. Please write a reason.');
      go2.addEventListener('click', async function () {
        const text = box.value.trim();
        if (opts.required && !text) { err.textContent = 'Please write a reason.'; err.hidden = false; return; }
        go2.disabled = true;
        try { await opts.run(text); } catch (ex) { err.textContent = ex.message; err.hidden = false; go2.disabled = false; }
      });
      panel.appendChild(h('div.row', {}, [h('button.btn', { type: 'button', text: 'Back', onclick: collapsed }), go2]));
      box.focus();
    }
    if (opts.startOpen) expanded(); else collapsed();
    return panel;
  }

  function afterAction(res, message) {
    ['to_approve', 'to_pay', 'to_check', 'for_owners'].forEach(function (v) { removeFrom(v, res.expense.expense_id); });
    if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
    state.detail = null;
    toast(message, 'ok');
    go('/');
  }

  function cancelPanel(e) {
    const paid = Number(e.amount_paid) || 0;
    return confirmPanel({
      open: 'Cancel this expense', danger: true, required: true,
      label: 'Why is it cancelled? (required)', placeholder: 'e.g. order cancelled by the supplier',
      intro: paid ? fmtMoney(paid) + ' was already paid — it will be recorded as a refund to collect.' : '',
      confirm: 'Cancel expense',
      run: async function (reason) {
        const res = await Api.call('cancelExpense', { id: e.expense_id, reason: reason });
        afterAction(res, 'Cancelled ' + e.expense_id + (res.refund ? ' · refund due ' + fmtMoney(res.refund) : ''));
      },
    });
  }

  function postCheckPanel(e) {
    const wrap = h('div.stack');
    wrap.appendChild(confirmPanel({
      open: 'Confirm cash payment', startOpen: true,
      intro: 'Paid in cash: ' + fmtMoney(e.amount_paid) + '. Confirm the money went out and the goods or service arrived.',
      label: 'Note (optional)', placeholder: 'e.g. receipt matches, goods received',
      confirm: 'Confirm and close',
      run: async function (note) {
        const res = await Api.call('postCheck', { id: e.expense_id, note: note });
        afterAction(res, 'Closed ' + e.expense_id);
      },
    }));
    // Something wrong with it? One button for every payment: "Something wrong with this payment? Report it", under Payments.
    return wrap;
  }

  /** After the money moved: the submitter (or an owner) says the payment went wrong. The expense keeps its status. */
  function reportPaymentPanel(e) {
    return confirmPanel({
      open: 'Something wrong with this payment? Report it', danger: true, required: true,
      intro: 'The accountant and the owners are told at once.',
      label: 'What is wrong? (required)', placeholder: 'e.g. Paid to the wrong account, or the goods did not arrive',
      confirm: 'Report the problem',
      run: async function (reason) {
        const res = await Api.call('reportPayment', { id: e.expense_id, reason: reason });
        if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
        else if (PAYER_ROLES.indexOf(state.user.role) !== -1) upsert('to_fix', res.expense);
        state.detail = null;
        toast('Problem reported for ' + res.expense.expense_id, 'ok');
        renderExpense(e.expense_id);
      },
    });
  }

  /** The accountant marks the transfer order created in the bank, or moves a cancelled one back. */
  function bankOrderPanel(e) {
    if (e.can.cancelBankOrder) {
      return confirmPanel({
        open: 'Bank order cancelled or refused? Move it back',
        intro: 'It goes back to the bank orders to create.',
        label: 'Why? (optional)', placeholder: 'e.g. Wrong amount in the order',
        confirm: 'Move it back',
        run: async function (reason) {
          const res = await Api.call('cancelBankOrder', { id: e.expense_id, reason: reason });
          upsert('to_pay', res.expense);
          state.detail = null;
          toast('Moved back: ' + e.expense_id, 'ok');
          renderExpense(e.expense_id);
        },
      });
    }
    const btn = h('button.btn', { type: 'button', text: 'Bank order created' });
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        const res = await Api.call('bankOrder', { ids: [e.expense_id] });
        upsert('to_pay', res.expenses[0]);
        state.detail = null;
        toast('Bank order marked · ' + bankApprover() + ' is told', 'ok');
        renderExpense(e.expense_id);
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
    return h('div.decide', {}, [h('p.confirm-text', { text: 'Created the transfer order in the bank? Mark it, and ' + bankApprover() + ' is told to release it.' }), btn]);
  }

  /** The accountant closes a reported payment problem by writing how it was sorted out. */
  function resolvePaymentPanel(e) {
    return confirmPanel({
      open: 'Sorted out? Close the payment problem', required: true,
      intro: 'Recorded wrongly? Void the payment and record it again first.',
      label: 'How was it sorted out? (required)', placeholder: 'e.g. Refunded on 14 Oct',
      confirm: 'Close the problem',
      run: async function (note) {
        const res = await Api.call('resolvePayment', { id: e.expense_id, note: note });
        removeFrom('to_fix', e.expense_id);
        if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
        state.detail = null;
        toast('Payment problem closed for ' + res.expense.expense_id, 'ok');
        go('/');
      },
    });
  }

  /** Accountant: "this looks wrong" → back to whoever approved it (the owners if nobody did) before anything is paid. */
  function reviewRequestPanel(e) {
    const opts = e.review_options || [];
    const target = opts[0];
    if (e.review_to_submitter && target) return backToSubmitterPanel(e, target);
    const panel = h('div.decide');
    const box = h('textarea.input', { id: 'review_reason', rows: 3, placeholder: 'e.g. The invoice total does not match the amount' });
    const err = h('p.error', { hidden: true });
    function collapsed() {
      panel.textContent = '';
      panel.appendChild(h('button.btn', { type: 'button', text: 'Something looks wrong? Send back for review', onclick: expanded }));
    }
    function expanded() {
      panel.textContent = '';
      err.hidden = true;
      panel.appendChild(h('h2.section-title', { text: 'Send back for review' }));
      if (!target) {
        panel.appendChild(h('p.error', { text: 'Nobody else is active to review this. Ask the admin.' }));
        panel.appendChild(h('button.btn', { type: 'button', text: 'Back', onclick: collapsed }));
        return;
      }
      const send = h('button.btn.btn-primary', { type: 'button', text: 'Send for review' });
      send.addEventListener('click', async function () {
        const reason = box.value.trim();
        if (!reason) { err.textContent = 'Write what looks wrong.'; err.hidden = false; box.focus(); return; }
        send.disabled = true;
        try {
          const res = await Api.call('requestReview', { id: e.expense_id, reviewer_id: target.value, reason: reason });
          afterAction(res, 'Sent back to ' + target.label + ' for review: ' + e.expense_id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
      });
      panel.appendChild(h('p.hint', {}, ['Goes back to ', h('strong', { text: target.label }),
        target.value === e.approver_id ? ', who approved it.' : e.approver_id ? ' (the person who approved it can no longer review).' : ' (nobody approved it before).',
        ' It cannot be paid until it is approved again. The submitter is not told.']));
      panel.appendChild(starLabel(h('label.label', { for: 'review_reason', text: 'What looks wrong?' })));
      panel.appendChild(box);
      requireText(box, send, err, 'Write what looks wrong. This field is required.');
      panel.appendChild(err);
      panel.appendChild(h('div.row', {}, [h('button.btn', { type: 'button', text: 'Back', onclick: collapsed }), send]));
      box.focus();
    }
    collapsed();
    return panel;
  }

  /** Accountant, on an expense sent straight to them: the question goes back to the person who sent it. */
  function backToSubmitterPanel(e, target) {
    const panel = h('div.decide');
    const box = h('textarea.input', { id: 'review_reason', rows: 3, placeholder: 'e.g. The invoice total does not match the amount' });
    const err = h('p.error', { hidden: true });
    function collapsed() {
      panel.textContent = '';
      panel.appendChild(h('button.btn', { type: 'button', text: 'Something looks wrong? Send back to ' + target.label, onclick: expanded }));
    }
    function expanded() {
      panel.textContent = '';
      err.hidden = true;
      panel.appendChild(h('h2.section-title', { text: 'Send back to ' + target.label }));
      const send = h('button.btn.btn-primary', { type: 'button', text: 'Send back' });
      send.addEventListener('click', async function () {
        const reason = box.value.trim();
        if (!reason) { err.textContent = 'Write what is wrong or missing.'; err.hidden = false; box.focus(); return; }
        send.disabled = true;
        try {
          const res = await Api.call('requestReview', { id: e.expense_id, reviewer_id: target.value, reason: reason });
          afterAction(res, 'Sent back to ' + target.label + ': ' + e.expense_id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
      });
      panel.appendChild(h('p.hint', {}, ['It was sent straight to you, so it goes back to ', h('strong', { text: target.label }),
        ' with your question. When it is fixed and sent again, it comes back to your Pay list.']));
      panel.appendChild(starLabel(h('label.label', { for: 'review_reason', text: 'What is wrong or missing?' })));
      panel.appendChild(box);
      requireText(box, send, err, 'Write what is wrong or missing. This field is required.');
      panel.appendChild(err);
      panel.appendChild(h('div.row', {}, [h('button.btn', { type: 'button', text: 'Back', onclick: collapsed }), send]));
      box.focus();
    }
    collapsed();
    return panel;
  }

  function supplierApprovalCard(e) {
    const s = e.supplier;
    const btn = h('button.btn.btn-approve', { type: 'button', text: 'Approve supplier' });
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      try {
        await Api.call('approveSupplier', { supplier_id: s.supplier_id });
        toast('Supplier approved', 'ok');
        renderExpense(e.expense_id);
      } catch (ex) { toast(ex.message); btn.disabled = false; }
    });
    return h('div.card.payto', {}, [
      h('h2.section-title', { text: 'New supplier — check before approving' }),
      h('div.payto-name', { text: s.name }),
      h('p.hint', { text: (s.tax_id ? 'Tax ID ' + s.tax_id + ' · ' : 'No tax ID · ') + (s.bank || 'no bank account given') }),
      btn,
    ]);
  }

  /** CSV text: UTF-8 BOM so Excel shows Vietnamese names; formula-looking cells neutralised; accounts kept as text. */
  function toCsv(columns, rows) {
    const cell = function (v) {
      let t = String(v === null || v === undefined ? '' : v);
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;   // stop Excel from running it as a formula
      return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const accIdx = columns.indexOf('account');
    return '\ufeff' + [columns.join(',')].concat(rows.map(function (r) {
      return r.map(function (v, i) {
        const acc = i === accIdx ? String(v || '').replace(/[^0-9A-Za-z-]/g, '') : '';
        return i === accIdx && acc ? '="' + acc + '"' : cell(v);
      }).join(',');
    })).join('\r\n');
  }
  function downloadCsv(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /** Month-end: every payment of a month with its accounting fields (voids as negative rows). */
  function monthExportRow() {
    if (EXPORT_MONTH_ROLES.indexOf(state.user.role) === -1) return null;
    const month = h('input.input', { type: 'month', 'aria-label': 'Month to export', value: todayVN().slice(0, 7), max: todayVN().slice(0, 7) });
    const btn = h('button.btn', { type: 'button', text: 'Export month (CSV)' });
    btn.addEventListener('click', async function () {
      if (!/^\d{4}-\d{2}$/.test(month.value)) { toast('Choose a month.'); return; }
      btn.disabled = true;
      try {
        const res = await Api.call('exportMonth', { month: month.value });
        downloadCsv(toCsv(res.columns, res.rows), 'pinwei-payments-' + res.month + '.csv');
        toast(res.rows.length + ' payments exported');
      } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    });
    return h('div.month-export', {}, [month, btn]);
  }

  /** CSV for preparing bank transfers; UTF-8 BOM so Excel shows Vietnamese names correctly. */
  async function exportToPay(ev) {
    const btn = ev.target;
    btn.disabled = true;
    try {
      const res = await Api.call('exportToPay');
      downloadCsv(toCsv(res.columns, res.rows), 'pinwei-to-pay-' + todayVN() + '.csv');
      toast(res.rows.length + ' rows exported');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // --------------------------------------------------------------- payments

  function todayVN() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()); // yyyy-mm-dd
  }

  function payToCard(p) {
    const copyBtn = p.account ? h('button.link', { type: 'button', text: 'Copy', onclick: function () {
      if (!navigator.clipboard) { toast(p.account); return; }
      navigator.clipboard.writeText(p.account).then(function () { toast('Account number copied'); }, function () { toast(p.account); });
    } }) : null;
    if (p.source === 'outlet_cash') {
      return h('div.card.payto', {}, [
        h('h2.section-title', { text: 'Pay to' }),
        h('div.payto-name', { text: p.name }),
        h('p.hint', { text: 'Already paid from the outlet cash box. Recording this payment means you topped the box up — nobody else is paid.' }),
      ]);
    }
    return h('div.card.payto', {}, [
      h('h2.section-title', { text: 'Pay to' }),
      h('div.payto-name', { text: p.name || '(no name given)' }),
      p.account
        ? h('div.payto-acc', {}, [h('span', { text: [p.bank, p.account].filter(Boolean).join(' · ') }), copyBtn])
        : h('p.hint', { text: 'No bank account on file. Ask the submitter, or pay in cash.' }),
      p.source === 'payee' ? h('p.hint', { text: 'This is the payee given by the submitter, not the supplier\'s registered account.' }) : null,
    ]);
  }

  /** The transfer confirmation of one payment: thumbnail / PDF link, or a placeholder while it loads. */
  function proofView(p) {
    if (p.proof && p.proof.pending) return h('p.hint', { 'data-proof': p.payment_id, text: 'Loading transfer confirmation…' });
    const proofUrl = p.proof && p.proof.base64 ? URL.createObjectURL(base64ToBlob(p.proof.base64, p.proof.mime)) : null;
    if (!proofUrl) return null;
    // Saved under the payment's ID, e.g. to send the supplier as proof of payment.
    const ext = p.proof.mime === 'application/pdf' ? '.pdf' : p.proof.mime === 'image/png' ? '.png' : '.jpg';
    const save = h('a.link.proof-save', { href: proofUrl, download: 'transfer-' + p.payment_id + ext, text: 'Download transfer confirmation' });
    if (p.proof.mime.indexOf('image/') === 0) {
      return h('div.proof', {}, [h('img.proof-thumb', { src: proofUrl, alt: 'Transfer confirmation', onclick: function () { openViewer(proofUrl); } }), save]);
    }
    return h('div.proof', {}, [h('a.link', { href: proofUrl, target: '_blank', rel: 'noopener', text: 'Open transfer confirmation (PDF)' }), save]);
  }

  function paymentCard(p, e) {
    const reversal = p.payment_seq === 'REVERSAL';
    const chip = reversal ? h('span.chip.bad', { text: 'Voids ' + p.reverses_payment_id })
      : p.voided ? h('span.chip.muted', { text: 'Voided' })
      : h('span.chip.ok', { text: paymentLabel(p, e) });
    return h('div.item.pay-card', {}, [
      h('div.item-top', {}, [h('span.amount' + (p.voided ? '.struck' : ''), { text: fmtMoney(p.amount) }), chip]),
      reversal && p.note ? h('div.item-note.bad', { text: 'Reason: ' + p.note }) : null,
      h('div.item-meta', {}, [
        h('span', { text: p.payment_id }),
        h('span', { text: fmtDate(p.paid_at) }),
        h('span', { text: label('payment_method', p.payment_method) }),
        h('span', { text: 'by ' + p.recorded_by_name }),
        p.source_account ? h('span', { text: 'from ' + p.source_account }) : null,
      ]),
      proofView(p),
      p.can_void ? confirmPanel({
        open: 'Recorded by mistake? Void this payment', danger: true, required: true,
        intro: 'Only for a payment recorded wrongly (wrong amount, wrong expense, recorded twice). Nothing is deleted: a reversal is added to the history and the owners are told.',
        label: 'What was wrong? (required)', placeholder: 'e.g. Typed 3,500,000 instead of 350,000',
        confirm: 'Void ' + p.payment_id,
        run: async function (reason) {
          const res = await Api.call('voidPayment', { id: e.expense_id, payment_id: p.payment_id, reason: reason });
          upsert('to_pay', res.expense);
          state.detail = null;
          toast('Voided ' + p.payment_id + ' · ' + label('status', res.expense.status), 'ok');
          renderExpense(e.expense_id);
        },
      }) : null,
    ]);
  }

  /**
   * "Mark as paid": amount is prefilled with the balance and the date with
   * today, so a full payment is just attach proof + one tap (spec: two actions).
   */
  function paymentPanel(e) {
    const balance = Number(e.balance_due) || 0;
    let amount = balance;
    let proof = null;
    let preparing = null;
    let busy = false;

    const amountInput = h('input.input.money', { inputmode: 'numeric', autocomplete: 'off' });
    wholeDongOnPaste(amountInput);
    amountInput.value = money.format(balance);
    const dateInput = h('input.input', { type: 'date', max: todayVN() });
    dateInput.value = todayVN();
    const methodSelect = h('select.input', {}, state.ref.enums.filter(function (x) { return x.field === 'payment_method'; })
      .map(function (x) { return h('option', { value: x.value, text: x.label }); }));
    methodSelect.value = e.payee_type === 'OUTLET_CASH' ? 'CASH' : (e.payment_method || 'BANK_TRANSFER');
    const sourceInput = h('input.input', { autocomplete: 'off', 'aria-label': 'Paid from which account', placeholder: 'e.g. VCB-8866 (optional)' });
    const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
    const proofBox = h('div.preview');
    const attachProof = h('button.btn.btn-photo', { type: 'button', onclick: function () { fileInput.click(); } }, ['Attach transfer confirmation']);
    const err = h('p.error', { hidden: true });
    const btn = h('button.btn.btn-approve.btn-big', { type: 'button' });

    function paintButton() {
      const partial = amount > 0 && amount < balance;
      const over = amount > balance;
      btn.textContent = partial ? 'Record partial payment' : 'Mark as paid';
      hint.textContent = over ? 'More than the balance due (' + fmtMoney(balance) + ').'
        : partial ? 'Balance after this payment: ' + fmtMoney(balance - amount) : '';
      hint.classList.toggle('over', over);
      hint.hidden = !partial && !over;
      words.textContent = amount ? amountInWords(amount) : '';
    }
    const hint = h('p.hint', { hidden: true });
    const words = h('p.hint.words');

    amountInput.addEventListener('input', function () {
      const digits = amountInput.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      amountInput.value = digits ? money.format(Number(digits)) : '';
      amount = Number(digits) || 0;
      payTouched.amount = true;
      paintButton();
      checkPay();
    });

    // Required: amount, date, method, and the transfer confirmation for a bank transfer.
    const payTouched = {};
    const amountErr = h('p.error', { hidden: true });
    const dateErr = h('p.error', { hidden: true });
    const proofErr = h('p.error', { hidden: true });
    const proofLabel = h('span.label', { text: 'Transfer confirmation' });
    const payHint = h('p.hint');
    const payMissing = h('p.hint.missing-line', { hidden: true, 'aria-live': 'polite' });
    function checkPay(showAll) {
      const bank = methodSelect.value === 'BANK_TRANSFER';
      const rules = [
        ['amount', 'Amount', amountErr, amount > 0, 'Enter the amount paid. This field is required.'],
        ['date', 'Date', dateErr, Boolean(dateInput.value), 'Choose the payment date. This field is required.'],
        ['proof', 'Transfer confirmation', proofErr, !bank || Boolean(proof || preparing), 'Attach the transfer confirmation. It is required for a bank transfer.'],
      ];
      const missing = [];
      rules.forEach(function (r) {
        const box = { amount: amountInput, date: dateInput }[r[0]];
        if (r[3]) { r[2].hidden = true; if (box) box.removeAttribute('aria-invalid'); return; }
        missing.push(r[1]);
        if (showAll) payTouched[r[0]] = true;
        if (payTouched[r[0]]) { r[2].textContent = r[4]; r[2].hidden = false; if (box) box.setAttribute('aria-invalid', 'true'); }
      });
      proofLabel.firstChild.nodeValue = bank ? 'Transfer confirmation' : 'Receipt or photo (optional)';
      attachProof.textContent = bank ? 'Attach transfer confirmation' : 'Attach a photo';
      payHint.textContent = (bank ? 'Transfer the money in your bank app first' : 'Pay the cash first') + ', then record it here. You will see a summary to check before anything is saved.';
      const star = proofLabel.querySelector('.req-star');
      if (bank && !star) proofLabel.appendChild(h('span.req-star', { text: ' *', 'aria-hidden': 'true' }));
      if (!bank && star) star.remove();
      if (!busy) lock(btn, missing.length > 0 || amount > balance);
      const over = !missing.length && amount > balance;   // the reason is said at the button too
      payMissing.textContent = missing.length ? 'Still needed: ' + missing.join(', ') : over ? 'More than the balance due (' + fmtMoney(balance) + ').' : '';
      payMissing.hidden = !missing.length && !over;
      return missing;
    }
    dateInput.addEventListener('change', function () { payTouched.date = true; checkPay(); });
    methodSelect.addEventListener('change', function () { checkPay(); });

    function paintProof(status) {
      proofBox.textContent = '';
      attachProof.hidden = Boolean(proof) || status === 'working';
      if (status === 'working') proofBox.appendChild(h('p.hint', { text: 'Preparing photo…' }));
      if (proof) {
        proofBox.appendChild(h('div.preview-row', {}, [
          proof.mime.indexOf('image/') === 0 ? h('img.thumb', { src: 'data:' + proof.mime + ';base64,' + proof.base64, alt: 'Transfer confirmation' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: proof.name }), h('span.hint', { text: Math.round(proof.sizeAfter / 1024) + ' KB' })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { proof = null; fileInput.value = ''; payTouched.proof = true; paintProof(); } }),
        ]));
      }
      checkPay();
    }
    fileInput.addEventListener('change', function () {
      const f = fileInput.files[0];
      if (!f) return;
      proof = null;
      err.hidden = true;
      paintProof('working');
      preparing = Attachment.prepare(f, state.limits.maxUploadMb)
        .then(function (a) { proof = a; startUpload(a, 'proof'); })
        .catch(function (ex) { err.textContent = ex.message; err.hidden = false; })
        .finally(function () { preparing = null; paintProof(); });
    });

    const formWrap = h('div.stack');
    const reviewWrap = h('div.stack', { hidden: true });

    /** Step 1: catch the obvious mistakes before showing the summary. */
    async function review() {
      if (busy) return;
      if (checkPay(true).length) return;
      err.hidden = true;
      if (preparing) { btn.disabled = true; btn.textContent = 'Preparing photo…'; await preparing; btn.disabled = false; paintButton(); }
      const problem = !(amount > 0) ? 'Enter the amount paid.'
        : amount > balance ? 'That is more than the balance due (' + fmtMoney(balance) + ').'
        : !dateInput.value ? 'Choose the payment date.'
        : methodSelect.value === 'BANK_TRANSFER' && !proof ? 'Attach the transfer confirmation first.'
        : '';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      showReview();
    }

    /** Step 2: the double-check. Nothing is saved until the accountant ticks the box. */
    function showReview() {
      const to = e.pay_to || {};
      const partial = amount < balance;
      const cash = methodSelect.value === 'CASH';
      const warnings = [];
      if (partial) warnings.push('Partial payment: ' + fmtMoney(balance - amount) + ' will still be owed.');
      if (dateInput.value !== todayVN()) warnings.push('The payment date is not today: ' + fmtDate(dateInput.value) + '.');
      if (!cash && !to.account && to.source !== 'outlet_cash') warnings.push('No bank account is on file for this payee. Check where the money went.');
      if (to.source === 'payee') warnings.push('The money goes to an account the submitter gave, not the supplier\'s registered account.');
      if (cash && e.payee_type !== 'OUTLET_CASH') warnings.push('Cash: an owner will be asked to confirm it afterwards.');

      const tick = h('input', { type: 'checkbox', id: 'pay_checked' });
      const confirmBtn = h('button.btn.btn-approve.btn-big', { type: 'button', text: partial ? 'Confirm partial payment' : 'Confirm and mark as paid' });
      lock(confirmBtn, true);
      tick.addEventListener('change', function () { lock(confirmBtn, !tick.checked); if (busy) confirmBtn.disabled = true; });
      confirmBtn.addEventListener('click', function () { submit(confirmBtn); });
      const row = function (k, v) { return h('div.kv', {}, [h('span.k', { text: k }), h('span.v', { text: v || '—' })]); };
      const proofSrc = proof && proof.mime.indexOf('image/') === 0 ? 'data:' + proof.mime + ';base64,' + proof.base64 : null;

      reviewWrap.textContent = '';
      reviewWrap.appendChild(h('p.confirm-text', { text: 'Check before saving' }));
      reviewWrap.appendChild(h('div.review-amount', {}, [
        h('span.amount.big', { text: fmtMoney(amount) }),
        h('span.hint', { text: amountInWords(amount) }),
      ]));
      reviewWrap.appendChild(h('div', {}, [
        row('Pay to', to.name),
        row('Account', cash ? 'Cash' : [to.bank, to.account].filter(Boolean).join(' · ')),
        row('Paid on', fmtDate(dateInput.value)),
        row('Method', label('payment_method', methodSelect.value)),
        row('Balance before', fmtMoney(balance)),
        row('Balance after', fmtMoney(balance - amount)),
      ]));
      if (proofSrc) reviewWrap.appendChild(h('img.review-proof', { src: proofSrc, alt: 'Transfer confirmation', onclick: function () { openViewer(proofSrc); } }));
      else if (proof) reviewWrap.appendChild(h('p.hint', { text: 'Transfer confirmation attached (PDF): ' + proof.name }));
      warnings.forEach(function (w) { reviewWrap.appendChild(h('div.flag.warn', { text: w })); });
      reviewWrap.appendChild(h('label.check-row', { for: 'pay_checked' }, [tick, h('span', {
        text: cash ? 'I confirm this amount was paid in cash.' : 'I compared the transfer confirmation with the amount and account above. They match.',
      })]));
      reviewWrap.appendChild(h('div.row', {}, [h('button.btn', { type: 'button', text: 'Back', onclick: showForm }), confirmBtn]));
      formWrap.hidden = true;
      reviewWrap.hidden = false;
      reviewWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function showForm() {
      err.hidden = true;
      reviewWrap.hidden = true;
      formWrap.hidden = false;
    }

    async function submit(confirmBtn) {
      if (busy) return;
      err.hidden = true;
      busy = true;
      confirmBtn.disabled = true;
      try {
        confirmBtn.textContent = 'Saving…';
        const base = {
          id: e.expense_id,
          amount: amount,
          paid_at: dateInput.value,
          payment_method: methodSelect.value,
          source_account: sourceInput.value.trim(),
          file: null,
        };
        let res;
        try {
          res = await Api.call('recordPayment', Object.assign({}, base, proof ? await filePayload(proof) : {}));
        } catch (ex) {
          if (!uploadExpired(ex, proof)) throw ex;
          res = await Api.call('recordPayment', Object.assign({}, base, await filePayload(proof)));
        }
        if (res.expense.status === 'PAID') removeFrom('to_pay', e.expense_id); else upsert('to_pay', res.expense);
        if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
        delete filesCache[e.expense_id];   // the new transfer confirmation is not in it
        state.detail = null;
        toast((res.expense.status === 'PAID' ? 'Paid ' : 'Partial payment recorded: ') + e.expense_id, 'ok');
        go('/');
      } catch (ex) {
        err.textContent = ex.details && ex.details.length ? ex.details.map(function (d) { return d.message; }).join(' ') : ex.message;
        err.hidden = false;
        confirmBtn.textContent = 'Try again';
        confirmBtn.disabled = false;
      } finally {
        busy = false;
      }
    }
    btn.addEventListener('click', review);
    paintButton();

    amountInput.id = 'pay_amount';
    dateInput.id = 'pay_date';
    methodSelect.id = 'pay_method';
    amountErr.id = 'pay_amount_error';
    dateErr.id = 'pay_date_error';
    amountInput.setAttribute('aria-describedby', 'pay_amount_error');
    dateInput.setAttribute('aria-describedby', 'pay_date_error');
    [amountInput, dateInput, methodSelect].forEach(function (c) { c.setAttribute('aria-required', 'true'); });
    [h('div.field', {}, [proofLabel, fileInput, proofBox,
        attachProof, proofErr]),
      h('div.field', {}, [starLabel(h('label.label', { for: 'pay_amount', text: 'Amount paid' })), h('div.money-wrap', {}, [amountInput, h('span.suffix', { text: '₫' })]), words, hint, amountErr]),
      h('div.grid2', {}, [
        h('div.field', {}, [starLabel(h('label.label', { for: 'pay_date', text: 'Paid on' })), dateInput, dateErr]),
        h('div.field', {}, [starLabel(h('label.label', { for: 'pay_method', text: 'Method' })), methodSelect]),
      ]),
      h('details.more-inline', {}, [h('summary', { text: 'Paid from which account? (optional)' }), sourceInput]),
      payMissing,
      btn,
    ].forEach(function (n) { formWrap.appendChild(n); });
    checkPay();

    return h('div.decide', {}, [
      h('h2.section-title', { text: 'Record payment' }),
      payHint,
      formWrap,
      reviewWrap,
      err,
    ]);
  }

  // ------------------------------------------------------------------- form

  const REQUIRED_NOTE = 'Required fields are marked *.';
  const NEW_SUPPLIER = '__new__';
  const NEW_SUPPLIER_LABEL = 'New supplier (details below)';
  // Shown where a supplier is optional: the list stays short when one-time sellers are left out.
  const ONE_TIME_SELLER = 'Only for a seller you will buy from again. One-time purchase? Leave the supplier empty.';
  const DRAFT_FIELDS = ['new_supplier_name', 'new_supplier_tax_id', 'new_supplier_bank_name', 'new_supplier_bank_account', 'request_type', 'amount_total', 'expense_category', 'send_to', 'description', 'no_doc_reason', 'no_doc_note', 'payee_type',
    'outlet_code', 'supplier_id', 'document_type', 'due_date', 'invoice_no', 'invoice_date', 'is_red_invoice',
    'amount_before_vat', 'vat_amount', 'payment_method', 'payee_name', 'payee_account', 'payee_bank'];

  function draftKey() { return 'pw_draft_' + state.user.userId; }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch (err) { return {}; } }
  function saveDraft(values) { try { localStorage.setItem(draftKey(), JSON.stringify(values)); } catch (err) { /* ignore */ } }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (err) { /* ignore */ } }

  /** Opens the resubmit form, reusing the detail just viewed when possible. */
  async function renderEdit(id) {
    let e = state.detail && state.detail.expense_id === id ? state.detail : null;
    if (!e) {
      mount(page([loading()]));
      try { e = await Api.call('getExpense', { id: id }); } catch (err) {
        mount(page([h('a.back', { href: '#/', text: 'Back' }), h('p.empty', { text: err.message })]));
        return;
      }
    }
    if (!e.can.edit || !e.editable) { go('/expense/' + encodeURIComponent(id)); return; }
    const pendingExtras = (e.extra_files || []).some(function (f) { return f && f.pending; });
    if ((e.attachment && e.attachment.pending) || pendingExtras) {
      // The edit form shows the current photos: wait for them if they are still on their way.
      mount(page([loading()]));
      try {
        const f = filesCache[id] || await Api.call('getExpenseFiles', { id: id });
        filesCache[id] = f;
        e = Object.assign({}, e, { attachment: e.attachment ? f.attachment || null : null, extra_files: f.extra_files || [] });
      } catch (err) {
        e = Object.assign({}, e, { attachment: { error: 'The current photo could not be loaded.' }, extra_files: [] });
      }
    }
    renderForm(e);
  }

  /**
   * New-expense form, or (with `existing`) the edit-and-resubmit form after the
   * approver asked for more info. Drafts are only kept for new expenses.
   */
  function renderForm(existing) {
    const editing = Boolean(existing);
    const saved = editing ? {} : loadDraft();
    // A draft is kept when someone leaves the form; say so, so an old amount isn't sent by mistake.
    const restored = ['amount_total', 'expense_category', 'payee_type', 'supplier_id', 'description'].some(function (k) { return saved[k]; });
    // Nothing the person typed (only the form's own defaults, or an old ticked "Send to"): start clean.
    const draft = restored ? saved : {};
    const values = editing
      ? Object.assign({}, existing.editable)
      : Object.assign({ request_type: 'INVOICE', outlet_code: state.user.outletCode, payment_method: 'BANK_TRANSFER' }, draft);
    if (!state.ref.outlets.some(function (o) { return o.value === values.outlet_code; })) values.outlet_code = state.ref.outlets[0].value;
    // A category that left the form (in an unsent draft, or on an older expense): its replacement, or none.
    if (mergedAway(values.expense_category)) values.expense_category = MERGED_CATEGORIES[values.expense_category];
    else if (!editing && HIDDEN_CATEGORIES.indexOf(values.expense_category) !== -1) values.expense_category = '';

    let attachment = null;      // newly prepared upload
    // The photo already on file (edit mode) stays unless replaced or removed.
    let keptAttachment = editing && existing.attachment && !existing.attachment.error ? existing.attachment : null;
    let removedAttachment = false;
    // More files after the main one (payment QR code, more pages…): kept ones {kept, id, mime, base64} or new uploads.
    let extras = editing ? (existing.extra_files || []).filter(function (f) { return f && f.id && !f.error; })
      .map(function (f) { return { kept: true, id: f.id, mime: f.mime, base64: f.base64, name: 'Current file' }; }) : [];
    const MAX_FILES = 5;
    let preparing = null;       // promise while compressing
    let submitting = false;
    const fieldEls = {};        // field -> wrapper, for error display
    const summary = h('p.submit-summary', { hidden: true, 'aria-live': 'polite' });

    function set(field, value) {
      values[field] = value;
      touched[field === 'no_doc_reason' ? 'file' : field] = true;
      if (!editing) saveDraft(values);
      clearError(field);
      paintSummary();
      checkRequired();
    }

    // --- required fields: a red * on each one that is needed right now; "required" appears
    // under a field only after someone touched it and left it empty; Submit waits for all of them.
    const touched = {};
    const shownRequired = {};
    let formReady = false;
    const REQUIRED = {
      file: ['Document or reason', 'Attach a photo or PDF, or choose why there is no document.'],
      amount_total: ['Amount', 'Enter the amount. This field is required.'],
      expense_category: ['Category', 'Choose a category. This field is required.'],
      description: ['Description', 'Write what it was for. Required when the category is "Other".'],
      payee_type: ['Who gets paid', 'Choose who gets paid. This field is required.'],
      supplier_id: ['Supplier', 'Choose the supplier, or add a new one.'],
      new_supplier_name: ['Supplier name', 'Enter the new supplier\u2019s name.'],
      payee_name: ['Their name', 'Enter their name.'],
      payee_account: ['Their account number', 'Enter their account number.'],
      send_to: ['Send to', 'Choose who to send this to.'],
    };
    function requiredNow() {
      const v = values;
      const filled = function (x) { return Boolean(String(x === undefined || x === null ? '' : x).trim()); };
      return [
        ['file', true, Boolean(attachment || keptAttachment || extras.length || v.no_doc_reason)],
        ['amount_total', true, Number(v.amount_total) > 0],
        ['expense_category', true, filled(v.expense_category)],
        ['description', v.expense_category === 'OTHER', filled(v.description)],
        ['payee_type', true, filled(v.payee_type)],
        ['supplier_id', v.payee_type === 'SUPPLIER', filled(v.supplier_id)],
        ['new_supplier_name', v.payee_type === 'SUPPLIER' && v.supplier_id === NEW_SUPPLIER, filled(v.new_supplier_name)],
        ['payee_name', v.payee_type === 'OTHER', filled(v.payee_name)],
        ['payee_account', v.payee_type === 'OTHER', filled(v.payee_account)],
        ['send_to', !editing, filled(v.send_to)],
      ];
    }
    /** Where the red * goes: the field's label, or the section title for fields without one. */
    function starTarget(name) {
      if (name === 'payee_type') return payeeTitle;
      if (name === 'send_to') return sendTitle;
      const w = fieldEls[name];
      return w && w.querySelector('.label');
    }
    function markRequired(name, on) {
      const t = starTarget(name);
      if (!t) return;
      const star = t.querySelector('.req-star');
      if (on && !star) t.appendChild(h('span.req-star', { text: ' *', 'aria-hidden': 'true' }));
      if (!on && star) star.remove();
      const c = controlOf(name);
      if (c) { if (on) c.setAttribute('aria-required', 'true'); else c.removeAttribute('aria-required'); }
    }
    /** The field's own control (#f_name), or its group of choices. */
    function controlOf(name) {
      const w = fieldEls[name];
      return w ? w.querySelector('#f_' + name) || w.querySelector('[role=radiogroup]') : null;
    }
    function checkRequired(showAll) {
      if (!formReady) return [];
      const missing = [];
      requiredNow().forEach(function (r) {
        const name = r[0];
        const needed = r[1];
        const ok = r[2];
        markRequired(name, needed);
        if (!needed || ok) {
          if (shownRequired[name]) { clearError(name); shownRequired[name] = false; }
          return;
        }
        missing.push(REQUIRED[name][0]);
        if (showAll) touched[name] = true;
        if (touched[name]) { showError(name, REQUIRED[name][1]); shownRequired[name] = true; }
      });
      if (!submitting) lock(submitBtn, missing.length > 0);
      missingLine.textContent = missing.length ? 'Still needed: ' + missing.join(', ') : '';
      missingLine.hidden = !missing.length;
      return missing;
    }

    /** One line above Submit: what is about to be sent, so nothing needs scrolling back up. */
    function paintSummary() {
      const parts = [];
      if (Number(values.amount_total)) parts.push(fmtMoney(values.amount_total));
      const cat = state.ref.categories.find(function (c) { return c.value === values.expense_category; });
      if (cat) parts.push(categoryShort(cat.value));
      const to = editing ? null : (state.ref.sendTo[values.outlet_code] || []).find(function (o) { return o.value === values.send_to; });
      if (to) parts.push(to.kind === 'ACCOUNTANT' ? 'to the accountant' : 'to ' + to.label.replace(/^Ask /, '').replace(/ to approve$/, ''));
      summary.textContent = parts.join(' · ');
      summary.hidden = !parts.length;
    }

    function field(name, labelText, control, hint) {
      const id = 'f_' + name;
      // Bind the label to the first real control inside (input/select/textarea), or name the group.
      const target = control.matches && control.matches('input,select,textarea') ? control : control.querySelector && control.querySelector('input:not([type=file]):not([type=radio]),select,textarea');
      const isGroup = !target;
      if (target) target.id = id;
      if (isGroup && labelText) { control.setAttribute('role', control.getAttribute('role') || 'group'); control.setAttribute('aria-labelledby', id + '_label'); }
      const err = h('p.error', { hidden: true, id: id + '_error' });
      if (target) target.setAttribute('aria-describedby', id + '_error');
      const wrap = h('div.field', { 'data-field': name }, [
        labelText ? h(isGroup ? 'span.label' : 'label.label', isGroup ? { id: id + '_label', text: labelText } : { for: id, text: labelText }) : null,
        control,
        hint ? h('p.hint', { text: hint }) : null,
        err,
      ]);
      fieldEls[name] = wrap;
      return wrap;
    }
    function clearError(name) {
      const w = fieldEls[name];
      if (w) {
        w.classList.remove('has-error');
        w.querySelector('.error').hidden = true;
        const c = controlOf(name);
        if (c) c.removeAttribute('aria-invalid');
      }
    }
    function showError(name, message) {
      if (name === 'no_doc_reason' && typeof openNoDoc === 'function') openNoDoc(true);
      const w = fieldEls[name] || fieldEls._form;
      w.classList.add('has-error');
      const p = w.querySelector('.error');
      p.textContent = message;
      p.hidden = false;
      const c = controlOf(name);
      if (c) c.setAttribute('aria-invalid', 'true');
    }

    // 1. Focusable error summary at the top of the form, each item linking to its field.
    const errorSummary = h('div.error-summary', { role: 'alert', tabindex: '-1', hidden: true });
    function showErrorSummary(details, title) {
      errorSummary.textContent = '';
      errorSummary.appendChild(h('p.error-summary-title', { text: title || (details.length === 1 ? 'Please fix 1 problem' : 'Please fix ' + details.length + ' problems') }));
      errorSummary.appendChild(h('ul', {}, details.map(function (d) {
        const targetField = fieldEls[d.field] ? d.field : '_form';
        return h('li', {}, [h('a', { href: '#', text: d.message, onclick: function (ev) {
          ev.preventDefault();
          const w = fieldEls[targetField];
          const c = w && (w.querySelector('#f_' + targetField) || w.querySelector('button, input, select, textarea'));
          if (w) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (c) c.focus({ preventScroll: true });
        } })]);
      })));
      errorSummary.hidden = false;
      errorSummary.scrollIntoView({ behavior: 'smooth', block: 'start' });
      errorSummary.focus({ preventScroll: true });
    }

    /** Large tappable options, each with a one-line explanation (a radio group). */
    function choices(name, options, cols, ariaLabel) {
      const wrap = h('div.choices' + (cols ? '.cols-' + cols : ''), { role: 'radiogroup', 'aria-label': ariaLabel || null });
      function paint() {
        wrap.querySelectorAll('button').forEach(function (b) {
          const on = b.dataset.value === values[name];
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', on);
        });
        radioTabStop(wrap);
      }
      options.forEach(function (o) {
        wrap.appendChild(h('button.choice', { type: 'button', role: 'radio', 'data-value': o.value, onclick: function () { set(name, o.value); paint(); if (o.onpick) o.onpick(); } }, [
          h('span.choice-title', { text: o.label }),
          o.sub ? h('span.choice-sub', { text: o.sub }) : null,
        ]));
      });
      paint();
      radioKeys(wrap);
      return wrap;
    }

    /** A section card with a step number, so the form reads as four short steps. */
    function section(num, title, children, titleEl) {
      return h('section.form-section', {}, [
        h('h2.form-step', {}, [h('span.step-num', { text: String(num), 'aria-hidden': 'true' }), titleEl || h('span', { text: title })]),
      ].concat(children));
    }

    function select(name, options, placeholder) {
      const el = h('select.input', { onchange: function () { set(name, el.value); } },
        [h('option', { value: '', text: placeholder || 'Choose…' })].concat(options.map(function (o) { return h('option', { value: o.value, text: o.label }); })));
      el.value = values[name] || '';
      return el;
    }

    function input(name, attrs) {
      const el = h('input.input', Object.assign({ oninput: function () { set(name, el.value); } }, attrs || {}));
      el.value = values[name] || '';
      return el;
    }

    /** withWords: the main amount also shows in words, which catches a missing or extra zero. */
    function moneyInput(name, withWords) {
      const words = withWords ? h('p.hint.words') : null;
      const paintWords = function () { if (words) words.textContent = Number(values[name]) ? amountInWords(values[name]) : ''; };
      const el = h('input.input.money', { inputmode: 'numeric', autocomplete: 'off', placeholder: withWords ? 'Enter amount' : '0', oninput: function () {
        const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        el.value = digits ? money.format(Number(digits)) : '';
        set(name, digits);
        paintWords();
      } });
      el.value = values[name] ? money.format(Number(values[name])) : '';
      wholeDongOnPaste(el);
      paintWords();
      const wrap = h('div.money-wrap', {}, [el, h('span.suffix', { text: '₫' })]);
      return words ? h('div', {}, [wrap, words]) : wrap;
    }

    // --- request type
    const typeField = field('request_type', null, choices('request_type', [
      { value: 'INVOICE', label: 'Already bought', sub: 'I have an invoice or receipt', onpick: function () { if (!editing) refreshSendTo(); } },
      { value: 'PURCHASE_REQUEST', label: 'Not bought yet', sub: 'Ask for approval before buying', onpick: function () { if (!editing) refreshSendTo(); } },
    ], 2, 'What is this?'));

    // --- attachment
    const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: function () { if (fileInput.files[0]) pickFile(fileInput.files[0]); } });
    const preview = h('div.preview');
    const noDocSelect = select('no_doc_reason', state.ref.enums.filter(function (e) { return e.field === 'no_doc_reason'; }), 'Choose a reason');
    const noDocField = field('no_doc_reason', 'Why is there no document?', noDocSelect);
    const noDocNoteField = field('no_doc_note', 'Reason (optional)', input('no_doc_note', { maxlength: 300, autocomplete: 'off', placeholder: 'e.g. Street vendor, no receipt' }));
    noDocSelect.addEventListener('change', function () { paintAttachment(); });
    // The reason picker stays out of the way until someone says they have no document.
    let noDocOpen = Boolean(values.no_doc_reason);
    const noDocToggle = h('button.link.nodoc-toggle', { type: 'button', text: 'No document? Choose a reason instead', onclick: function () { openNoDoc(true); } });
    function openNoDoc(focus) { noDocOpen = true; paintAttachment(); if (focus) noDocSelect.focus(); }
    const dropTitle = h('span.dropzone-title', { text: 'Take or choose a photo' });
    const dropzone = h('button.dropzone', { type: 'button', onclick: function () { fileInput.click(); } }, [
      dropTitle,
      h('span.dropzone-sub', { text: 'Invoice, delivery note or quote. PDF works too.' }),
    ]);
    // Desktop: a file can also be dragged onto the box.
    ['dragenter', 'dragover'].forEach(function (t) { dropzone.addEventListener(t, function (ev) { ev.preventDefault(); dropzone.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dropzone.addEventListener(t, function () { dropzone.classList.remove('drag'); }); });
    dropzone.addEventListener('drop', function (ev) {
      ev.preventDefault();
      const f = ev.dataTransfer && ev.dataTransfer.files[0];
      if (f) pickFile(f);
    });
    // More files: a second invoice page, the seller's payment QR code, a delivery note…
    const extraInput = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: function () {
      [].slice.call(extraInput.files || []).forEach(pickExtra);
      extraInput.value = '';
    } });
    const extrasBox = h('div.preview.extras');
    const addMore = h('button.btn.btn-photo.btn-more', { type: 'button', onclick: function () { extraInput.click(); } }, ['+ Add another file']);
    const addMoreHint = h('p.hint', { text: 'Payment QR code, more pages, delivery note. Photo or PDF, up to ' + MAX_FILES + ' files.' });
    const fileField = field('file', 'Document (photo or PDF)', h('div', {}, [fileInput, preview, dropzone, extraInput, extrasBox, addMore, addMoreHint]));

    function paintExtras(status) {
      extrasBox.textContent = '';
      if (status === 'working') extrasBox.appendChild(h('p.hint', { text: 'Preparing photo…' }));
      extras.forEach(function (x, i) {
        const isImg = String(x.mime).indexOf('image/') === 0;
        extrasBox.appendChild(h('div.preview-row', {}, [
          isImg ? h('img.thumb', { src: 'data:' + x.mime + ';base64,' + x.base64, alt: 'File ' + (i + 2) }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: x.kept ? 'File ' + (i + 2) + ' (already attached)' : x.name }),
            x.kept ? null : h('span.hint', { text: Math.round(x.sizeAfter / 1024) + ' KB' })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { extras.splice(extras.indexOf(x), 1); touched.file = true; paintAttachment(); } }),
        ]));
      });
    }

    function pickExtra(file) {
      if ((attachment || keptAttachment ? 1 : 0) + extras.length >= MAX_FILES) { showError('file', 'Up to ' + MAX_FILES + ' files.'); return; }
      clearError('file');
      paintExtras('working');
      const job = Attachment.prepare(file, state.limits.maxUploadMb).then(function (a) {
        extras.push(a);
        startUpload(a, 'expense');
        paintAttachment();
      }).catch(function (err) {
        paintAttachment();
        showError('file', err.message);
      });
      preparing = preparing ? Promise.all([preparing, job]) : job;
      job.finally(function () { if (preparing === job) preparing = null; });
    }

    function paintAttachment(status) {
      preview.textContent = '';
      if (status === 'working') preview.appendChild(h('p.hint', { text: 'Preparing photo…' }));
      if (!attachment && keptAttachment) {
        const isImg = keptAttachment.mime.indexOf('image/') === 0;
        preview.appendChild(h('div.preview-row', {}, [
          isImg ? h('img.thumb', { src: 'data:' + keptAttachment.mime + ';base64,' + keptAttachment.base64, alt: 'Current document' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: 'Current document' }), h('span.hint', { text: 'Already attached' })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { keptAttachment = null; removedAttachment = true; touched.file = true; paintAttachment(); } }),
        ]));
      }
      if (attachment) {
        const isImg = attachment.mime.indexOf('image/') === 0;
        preview.appendChild(h('div.preview-row', {}, [
          isImg ? h('img.thumb', { src: 'data:' + attachment.mime + ';base64,' + attachment.base64, alt: 'Invoice preview' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [
            h('span', { text: attachment.name }),
            h('span.hint', { text: Math.round(attachment.sizeAfter / 1024) + ' KB' + (isImg ? ' (from ' + Math.round(attachment.sizeBefore / 1024) + ' KB)' : '') }),
          ]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { attachment = null; fileInput.value = ''; touched.file = true; paintAttachment(); } }),
        ]));
      }
      const hasMain = Boolean(attachment || keptAttachment);
      const hasDoc = hasMain || extras.length > 0;
      paintExtras();
      // Once there is a file, each one has Remove and more are added below: no "replace".
      addMore.hidden = !hasDoc || (hasMain ? 1 : 0) + extras.length >= MAX_FILES || status === 'working';
      addMoreHint.hidden = addMore.hidden;
      dropzone.hidden = hasDoc;
      noDocField.hidden = hasDoc || status === 'working' || !noDocOpen;
      noDocNoteField.hidden = noDocField.hidden || values.no_doc_reason !== 'OTHER';
      noDocToggle.hidden = hasDoc || status === 'working' || noDocOpen;
      checkRequired();
    }

    function pickFile(file) {
      clearError('file');
      attachment = null;
      paintAttachment('working');
      preparing = Attachment.prepare(file, state.limits.maxUploadMb).then(function (a) {
        attachment = a;
        startUpload(a, 'expense');
        paintAttachment();
      }).catch(function (err) {
        paintAttachment();
        showError('file', err.message);
      }).finally(function () { preparing = null; });
    }

    // --- amount + category
    const amountField = field('amount_total', 'Total amount (incl. VAT)', moneyInput('amount_total', true));
    const catGrid = h('div.cat-grid', { role: 'radiogroup', 'aria-label': 'Category' });
    // Short names on the tiles; what the chosen one covers is spelled out underneath.
    const catHint = h('p.hint.cat-hint');
    function paintCats() {
      catGrid.querySelectorAll('button').forEach(function (b) {
        const on = b.dataset.value === values.expense_category;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
      });
      radioTabStop(catGrid);
      const full = values.expense_category ? categoryLabel(values.expense_category) : '';
      catHint.textContent = full && full !== categoryShort(values.expense_category) ? 'Covers: ' + full : '';
    }
    tileCategories(values.expense_category).forEach(function (c) {
      catGrid.appendChild(h('button.chip-btn', { type: 'button', role: 'radio', 'data-value': c.value, text: categoryShort(c.value), title: c.label,
        onclick: function () { set('expense_category', c.value); paintCats(); supplierCategoryChanged(); } }));
    });
    paintCats();
    radioKeys(catGrid);
    const catField = field('expense_category', 'Category', h('div', {}, [catGrid, catHint]));

    // --- send to
    const sendToList = h('div.radios', { role: 'radiogroup', 'aria-label': 'Send to' });
    // Money back to the submitter, out of the cash box, or to a third party always needs an approver.
    const NEEDS_APPROVER = ['OTHER', 'SUBMITTER', 'OUTLET_CASH'];
    // Before sending straight to the accountant: what happens if something is wrong.
    const directNote = h('p.hint.direct-note', { text: 'Nobody approves it first: the accountant checks it before paying. If something is wrong or missing, it comes back to you to fix.' });
    function paintDirectNote() { directNote.hidden = values.send_to !== 'ACCOUNTANT'; }
    let sendAuto = false;   // the only option was ticked for the user, not by them
    function refreshSendTo() {
      // Paying you back and buying something not bought yet both need an approver: no "pay directly".
      const opts = (state.ref.sendTo[values.outlet_code] || []).filter(function (o) {
        return !(o.kind === 'ACCOUNTANT' && (NEEDS_APPROVER.indexOf(values.payee_type) !== -1 || values.request_type === 'PURCHASE_REQUEST'));
      });
      if (!opts.some(function (o) { return o.value === values.send_to; }) || (sendAuto && opts.length > 1)) {
        // Nothing is chosen for the user: they decide who it goes to. (With a single option there is nothing to decide.)
        values.send_to = opts.length === 1 ? opts[0].value : '';
        sendAuto = opts.length === 1;
        saveDraft(values);
      }
      sendToList.textContent = '';
      if (!opts.length) {
        const all = state.ref.sendTo[values.outlet_code] || [];
        sendToList.appendChild(h('p.hint.warn-text', { text: all.length
          ? 'Money to someone else, back to you or from the cash box must be approved first, and nobody is set up to approve it for this outlet yet. Choose "Supplier" if it is paid to a supplier, or ask the admin.'
          : 'Nobody is set up to receive this yet. Ask the admin to check the users list.' }));
      }
      opts.forEach(function (o) {
        const id = 'sendto_' + o.value;
        sendToList.appendChild(h('label.radio', { for: id }, [
          h('input', { type: 'radio', name: 'send_to', id: id, value: o.value, checked: values.send_to === o.value, onchange: function () { sendAuto = false; set('send_to', o.value); paintDirectNote(); } }),
          h('span', { text: o.label }),
        ]));
      });
      sendToList.appendChild(directNote);
      paintDirectNote();
      paintSummary();
      checkRequired();
    }
    /** Fresh approver list from the server (someone may have been added or deactivated since sign-in). */
    function reloadSendTo() {
      return Api.call('views').then(function (data) {
        if (!data.sendTo) return;
        state.ref.sendTo = data.sendTo;
        if (sendToList.isConnected) refreshSendTo();
      }).catch(function () { /* the list on screen stays; submitting reports any real problem */ });
    }
    const sendField = editing
      ? field('send_to', 'Goes back to', h('div.readonly', { text: existing.send_to_name }), 'The person who asked for more info reviews it again.')
      : field('send_to', null, sendToList);
    if (!editing) { refreshSendTo(); reloadSendTo(); }

    // --- who gets paid (supplier / someone else / me)
    const payeeHint = h('p.hint');
    // The supplier is picked from a list that can be searched by typing (with or without accents).
    // Categories named in config (supplier_filter_categories) list only their own suppliers.
    const ownListCategories = (state.limits && state.limits.supplierCategories) || [];
    // Adding a supplier is its own link under the box: always in sight, however long the list is.
    const addSupplierLink = h('button.link.picker-add', { type: 'button', text: '+ Add a new supplier', onclick: function () { addNewSupplier(''); } });
    const SUPPLIER_PLACEHOLDER = 'Search or choose a supplier';
    const supplierInput = h('input.input.picker-input', { type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
      'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': 'supplier_list', placeholder: SUPPLIER_PLACEHOLDER });
    const supplierList = h('div.picker-list', { id: 'supplier_list', role: 'listbox', 'aria-label': 'Suppliers', hidden: true });
    const supplierNote = h('p.hint', { hidden: true });
    const supplierFull = h('p.hint', { hidden: true });
    function supplierChoices() {
      const cat = values.expense_category;
      if (ownListCategories.indexOf(cat) === -1) return state.ref.suppliers;
      return state.ref.suppliers.filter(function (s) { return s.defaultCategory === cat || s.value === values.supplier_id; });
    }
    function supplierLabel() {
      if (values.supplier_id === NEW_SUPPLIER) return NEW_SUPPLIER_LABEL;
      const s = state.ref.suppliers.find(function (x) { return x.value === values.supplier_id; });
      return s ? s.label : '';
    }
    function paintSupplier() {
      if (document.activeElement !== supplierInput) supplierInput.value = supplierLabel();
      showIfCut(supplierFull, supplierInput, supplierLabel());
      newSupplierBox.hidden = values.supplier_id !== NEW_SUPPLIER;
      addSupplierLink.hidden = values.supplier_id === NEW_SUPPLIER;
      const own = ownListCategories.indexOf(values.expense_category) !== -1;
      supplierNote.textContent = own ? 'Only the suppliers for "' + categoryShort(values.expense_category) + '" are listed.' : '';
      supplierNote.hidden = !own;
    }
    function closeSuppliers() {
      supplierList.hidden = true;
      supplierInput.setAttribute('aria-expanded', 'false');
      supplierInput.removeAttribute('aria-activedescendant');
    }
    function openSuppliers(query) {
      const words = plainText(query).split(/\s+/).filter(Boolean);
      const rows = words.length ? [] : [{ value: '', label: 'Not listed / none', cls: '.quiet' }];
      const matches = supplierChoices().filter(function (s) {
        const text = plainText(s.label);
        return words.every(function (w) { return text.indexOf(w) !== -1; });
      });
      matches.forEach(function (s) { rows.push({ value: s.value, label: s.label }); });
      supplierList.textContent = '';
      const typed = String(query).trim();
      if (words.length && !matches.length) {
        // Nothing found: the typed name can go straight into the new-supplier form.
        supplierList.appendChild(h('p.picker-empty', { text: 'No supplier matches "' + typed + '".' }));
        supplierList.appendChild(h('div.picker-option.add', { role: 'option', id: 'supplier_opt_new', 'data-value': NEW_SUPPLIER, 'aria-selected': 'false',
          text: '+ Add "' + typed + '" as a new supplier', onclick: function () { addNewSupplier(typed); } }));
      }
      rows.forEach(function (r, i) {
        supplierList.appendChild(h('div.picker-option' + (r.cls || ''), { role: 'option', id: 'supplier_opt_' + i, 'data-value': r.value,
          'aria-selected': String(r.value === (values.supplier_id || '')), text: r.label, onclick: function () { pickSupplier(r.value); } }));
      });
      supplierList.hidden = false;
      supplierList.scrollTop = 0;
      supplierInput.setAttribute('aria-expanded', 'true');
      supplierInput.removeAttribute('aria-activedescendant');
    }
    function pickSupplier(id) {
      set('supplier_id', id);
      supplierInput.blur();   // closes the list and shows the name
      // A regular supplier suggests its usual category (one tap less for daily deliveries).
      const s = state.ref.suppliers.find(function (x) { return x.value === id; });
      if (s && s.defaultCategory && !values.expense_category && catGrid.querySelector('[data-value="' + s.defaultCategory + '"]')) {
        set('expense_category', s.defaultCategory);
        paintCats();
      }
      paintSupplier();
    }
    /** Opens the new-supplier form; a name typed in the search box is carried into it. */
    function addNewSupplier(name) {
      const nameInput = fieldEls.new_supplier_name.querySelector('input');
      if (name && !String(values.new_supplier_name || '').trim()) {
        values.new_supplier_name = name;
        nameInput.value = name;
      }
      pickSupplier(NEW_SUPPLIER);
      if (!name) nameInput.focus();
    }
    /** Another category was tapped: a supplier that is not on that category's own list is taken out. */
    function supplierCategoryChanged() {
      const cat = values.expense_category;
      const s = state.ref.suppliers.find(function (x) { return x.value === values.supplier_id; });
      if (s && ownListCategories.indexOf(cat) !== -1 && s.defaultCategory !== cat) {
        values.supplier_id = '';
        if (!editing) saveDraft(values);
        checkRequired();
      }
      closeSuppliers();
      paintSupplier();
    }
    function moveSupplier(step) {
      const options = [].slice.call(supplierList.querySelectorAll('.picker-option'));
      if (!options.length) return;
      const now = options.findIndex(function (o) { return o.classList.contains('active'); });
      const next = Math.max(0, Math.min(options.length - 1, now === -1 ? (step > 0 ? 0 : options.length - 1) : now + step));
      options.forEach(function (o, i) { o.classList.toggle('active', i === next); });
      supplierInput.setAttribute('aria-activedescendant', options[next].id);
      options[next].scrollIntoView({ block: 'nearest' });
    }
    // While the box is in use it is empty for typing; the supplier already chosen shows as its grey text.
    supplierInput.addEventListener('focus', function () {
      supplierInput.placeholder = supplierLabel() || SUPPLIER_PLACEHOLDER;
      supplierInput.value = '';
      supplierFull.hidden = true;
      openSuppliers('');
    });
    supplierInput.addEventListener('click', function () { if (supplierList.hidden) openSuppliers(supplierInput.value); });
    supplierInput.addEventListener('input', function () { openSuppliers(supplierInput.value); });
    supplierInput.addEventListener('blur', function () {
      closeSuppliers();
      supplierInput.placeholder = SUPPLIER_PLACEHOLDER;
      supplierInput.value = supplierLabel();
      showIfCut(supplierFull, supplierInput, supplierLabel());
    });
    supplierInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (supplierList.hidden) openSuppliers(''); else moveSupplier(ev.key === 'ArrowDown' ? 1 : -1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();   // never submits the form from here
        if (supplierList.hidden) { openSuppliers(''); return; }
        const active = supplierList.querySelector('.picker-option.active');
        const found = supplierList.querySelectorAll('.picker-option:not(.add):not(.quiet)');
        if (active) active.click();
        else if (found.length === 1) found[0].click();
      } else if (ev.key === 'Escape' && !supplierList.hidden) {
        ev.preventDefault();
        supplierInput.blur();
      }
    });
    // A tap in the list must not take the cursor out of the box first (that would close the list).
    supplierList.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    const newSupplierHint = h('p.hint');
    const newSupplierBox = h('div.payee-other', { hidden: true }, [
      newSupplierHint,
      field('new_supplier_name', 'Supplier name', input('new_supplier_name', { autocomplete: 'off' })),
      field('new_supplier_tax_id', 'Tax ID (MST)', input('new_supplier_tax_id', { inputmode: 'numeric', autocomplete: 'off' })),
      field('new_supplier_bank_name', 'Bank', input('new_supplier_bank_name', { autocomplete: 'off' })),
      field('new_supplier_bank_account', 'Account number', input('new_supplier_bank_account', { inputmode: 'numeric', autocomplete: 'off' })),
    ]);
    paintSupplier();
    const supplierField = field('supplier_id', 'Supplier', h('div.picker', {}, [supplierInput, supplierFull, addSupplierLink, supplierList, supplierNote, newSupplierBox]));

    /** Creates the typed-in supplier first, then the expense can point at it. */
    async function createSupplierFromForm() {
      try {
        const res = await Api.call('createSupplier', {
          name: values.new_supplier_name, tax_id: values.new_supplier_tax_id,
          bank_name: values.new_supplier_bank_name, bank_account: values.new_supplier_bank_account,
          default_category: values.expense_category,
        });
        state.ref.suppliers.push(res.supplier);
        values.supplier_id = res.supplier.value;
      } catch (err) {
        const dup = err.details && err.details.find(function (d) { return d.existingId; });
        if (!dup) throw err;
        // Already in the list: nothing is submitted. The existing supplier is selected, and the user checks it first.
        const name = dup.existingName || values.new_supplier_name;
        if (!state.ref.suppliers.some(function (s) { return s.value === dup.existingId; })) {
          state.ref.suppliers.push({ value: dup.existingId, label: name });
        }
        values.supplier_id = dup.existingId;
        paintSupplier();
        saveDraft(values);
        const stop = new Error('This supplier is already in the list: ' + name + '. It is now selected. Check it, then press Submit again.');
        stop.code = 'VALIDATION';
        stop.details = [{ field: 'supplier_id', message: stop.message }];
        throw stop;
      }
      saveDraft(values);
    }
    const otherFields = h('div.payee-other', {}, [
      field('payee_name', 'Their name', input('payee_name', { autocomplete: 'off' })),
      field('payee_account', 'Their account number', input('payee_account', { inputmode: 'numeric', autocomplete: 'off' })),
      field('payee_bank', 'Their bank', input('payee_bank', { autocomplete: 'off' })),
    ]);
    // Which choices are in use is set in config (payee_types); an edit keeps the one it already has.
    const inUse = (state.limits && state.limits.payeeTypes) || [];
    const payeeOptions = [
      { value: 'SUPPLIER', label: 'The supplier', sub: 'Into their bank account', onpick: paintPayee },
      { value: 'OUTLET_CASH', label: 'Outlet cash box', sub: 'Already paid from the box', onpick: paintPayee },
      { value: 'SUBMITTER', label: 'Me', sub: 'I paid, pay me back', onpick: paintPayee },
      { value: 'OTHER', label: 'Someone else', sub: 'e.g. a delivery driver', onpick: paintPayee },
    ].filter(function (o) { return !inUse.length || inUse.indexOf(o.value) !== -1 || (editing && existing.editable.payee_type === o.value); });
    if (values.payee_type && !payeeOptions.some(function (o) { return o.value === values.payee_type; })) values.payee_type = '';
    function paintPayee() {
      const t = values.payee_type;
      supplierField.querySelector('.label').textContent = t === 'SUPPLIER' ? 'Supplier' : 'Bought from (optional)';
      newSupplierHint.textContent = t === 'SUPPLIER' ? 'New suppliers need an owner\u2019s approval before the accountant can pay into their account.' : ONE_TIME_SELLER;
      checkRequired();
      supplierField.hidden = !t;
      otherFields.hidden = t !== 'OTHER';
      payeeHint.textContent = t === 'SUBMITTER'
        ? (state.user.hasBankAccount ? 'The accountant pays you back into your bank account on file. Someone must approve it first.'
          : 'Your bank account is not on file yet: ask the admin to add it, or you will be paid back in cash. Someone must approve it first.')
        : t === 'OUTLET_CASH'
          ? 'Paid from the outlet cash box. The accountant tops the box up, so nobody is paid twice. Someone must approve it first.'
          : t === 'OTHER'
            ? 'e.g. a delivery driver. Money to someone other than the supplier always needs an approver.'
            : t === 'SUPPLIER' ? 'Paid to the supplier\u2019s registered bank account.' + (payeeOptions.some(function (o) { return o.value === 'OTHER'; }) ? '' : ' Paying anyone else, e.g. a delivery driver? Add them as a new supplier.') : '';
      // These can never go straight to the accountant: the list hides that option.
      if (!editing) refreshSendTo();
    }
    const payeeField = field('payee_type', null, h('div', {}, [
      choices('payee_type', payeeOptions, 2, 'Who gets paid?'),
      payeeHint,
    ]));
    const payeeBlock = h('div.payee-block', {}, [payeeField, supplierField, otherFields]);
    paintPayee();

    // --- description
    const desc = h('textarea.input', { rows: 2, placeholder: 'What was bought, and for what?', oninput: function () { set('description', desc.value); } });
    desc.value = values.description || '';
    const descField = field('description', 'Description', desc, 'Required when the category is "Other".');

    // --- more details
    const outletField = state.ref.outlets.length > 1
      ? field('outlet_code', 'Outlet', (function () {
        const el = select('outlet_code', state.ref.outlets);
        el.addEventListener('change', function () { if (!editing) refreshSendTo(); });
        return el;
      })())
      : null;
    const redBox = h('input', { type: 'checkbox', checked: Boolean(values.is_red_invoice), onchange: function () { set('is_red_invoice', redBox.checked); } });
    const more = h('details.more', { open: DRAFT_FIELDS.slice(6).some(function (f) { return f !== 'payment_method' && f !== 'outlet_code' && values[f]; }) }, [
      h('summary', { text: 'More details (optional)' }),
      outletField,
      field('document_type', 'Document type', select('document_type', state.ref.documentTypes, 'Choose…')),
      field('due_date', 'Pay by (due date)', input('due_date', { type: 'date' })),
      field('invoice_no', 'Invoice number', input('invoice_no', { autocomplete: 'off' })),
      field('invoice_date', 'Invoice date', input('invoice_date', { type: 'date' })),
      field('is_red_invoice', null, h('label.check', {}, [redBox, h('span', { text: 'VAT red invoice (e-invoice)' })])),
      h('div.grid2', {}, [
        field('amount_before_vat', 'Before VAT', moneyInput('amount_before_vat')),
        field('vat_amount', 'VAT', moneyInput('vat_amount')),
      ]),
      field('payment_method', 'Payment method', select('payment_method', state.ref.enums.filter(function (e) { return e.field === 'payment_method'; }))),
    ]);

    // --- warnings panel + submit
    const formErrors = field('_form', null, h('div'));
    const warnBox = h('div.warnbox', { role: 'alert', hidden: true });
    const submitBtn = h('button.btn.btn-primary.btn-big', { type: 'submit', text: 'Submit' });

    async function submit(confirmWarnings) {
      if (submitting) return;
      if (checkRequired(true).length) {
        const first = requiredNow().find(function (r) { return r[1] && !r[2]; });
        const w = first && (fieldEls[first[0]] || starTarget(first[0]));
        if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      submitting = true;
      warnBox.hidden = true;
      stickyBar.hidden = false;
      errorSummary.hidden = true;
      Object.keys(fieldEls).forEach(clearError);
      submitBtn.disabled = true;
      try {
        if (preparing) { submitBtn.textContent = 'Preparing photo…'; await preparing; }
        submitBtn.textContent = attachment && !attachment.ref ? 'Uploading photo…' : 'Submitting…';
        const payload = {};
        DRAFT_FIELDS.forEach(function (f) { if (values[f] !== undefined) payload[f] = values[f]; });
        if (attachment) { Object.assign(payload, await filePayload(attachment)); payload.no_doc_reason = ''; }
        submitBtn.textContent = 'Submitting…';
        if (!attachment && keptAttachment) payload.no_doc_reason = '';
        payload.extraFiles = [];
        for (let i = 0; i < extras.length; i++) {
          const x = extras[i];
          if (x.kept) { payload.extraFiles.push({ keep: x.id }); continue; }
          const p = await filePayload(x);
          payload.extraFiles.push(p.fileRef ? { ref: p.fileRef } : p.file);
        }
        if (extras.length) payload.no_doc_reason = '';
        if (!payload.no_doc_reason) payload.no_doc_note = '';
        payload.confirmWarnings = Boolean(confirmWarnings);
        if (editing) { payload.id = existing.expense_id; payload.removeAttachment = removedAttachment && !attachment; }
        if (values.supplier_id === NEW_SUPPLIER) {
          submitBtn.textContent = 'Adding supplier…';
          await createSupplierFromForm();
          payload.supplier_id = values.supplier_id;
        }
        const res = await Api.call(editing ? 'editExpense' : 'submitExpense', payload);
        if (!res.saved) { showWarnings(res.warnings); return; }
        if (!editing) clearDraft();
        if (editing) delete filesCache[existing.expense_id];   // its photos may have changed
        state.detail = null;
        upsert('mine', res.expense);
        toast(!editing ? 'Submitted ' + res.expense.expense_id
          : res.action === 'RESUBMIT' ? 'Resubmitted ' + res.expense.expense_id
            : res.action === 'EDIT_NEEDS_REAPPROVAL' ? 'Saved — ' + res.expense.expense_id + ' goes back for approval'
              : 'Saved ' + res.expense.expense_id, 'ok');
        go('/');
      } catch (err) {
        if (uploadExpired(err, attachment) || extras.some(function (x) { return !x.kept && uploadExpired(err, x); })) {
          retryAfterExpiry = true;   // handled below, after the button is reset
        } else if (err.code === 'VALIDATION' && err.details.length) {
          if (!editing && err.details.some(function (d) { return d.field === 'send_to'; })) reloadSendTo();
          err.details.forEach(function (d) { showError(d.field in fieldEls ? d.field : '_form', d.message); });
          if (err.details.some(function (d) { return more.contains(fieldEls[d.field] || null); })) more.open = true;
          showErrorSummary(err.details);
        } else {
          const message = (err.message || 'Something went wrong. Please try again.') + (err.code === 'NETWORK' ? ' Your form is kept.' : '');
          showError('_form', message);
          showErrorSummary([{ field: '_form', message: message }], err.code === 'NETWORK' ? 'Not sent' : null);
        }
      } finally {
        submitting = false;
        submitBtn.textContent = 'Submit';
        submitBtn.disabled = false;
        checkRequired();
      }
      // The photo's upload reference ran out: send again once, with the photo itself.
      if (retryAfterExpiry) { retryAfterExpiry = false; return submit(confirmWarnings); }
    }
    let retryAfterExpiry = false;

    function showWarnings(warnings) {
      warnBox.textContent = '';
      warnBox.appendChild(h('p.warn-title', { text: 'Please double-check' }));
      warnBox.appendChild(h('ul', {}, warnings.map(function (w) { return h('li', { text: w.message }); })));
      warnBox.appendChild(h('div.row', {}, [
        h('button.btn', { type: 'button', text: 'Go back', onclick: function () { warnBox.hidden = true; stickyBar.hidden = false; } }),
        h('button.btn.btn-primary', { type: 'button', text: 'Submit anyway', onclick: function () { submit(true); } }),
      ]));
      warnBox.hidden = false;
      stickyBar.hidden = true;   // one Submit button at a time: the warnings decide
      warnBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const missingLine = h('p.hint.missing-line', { hidden: true, 'aria-live': 'polite' });
    const stickyBar = h('div.sticky-submit', {}, [summary, missingLine, submitBtn]);
    const payeeTitle = h('span', { text: 'Who gets paid?' });
    const sendTitle = h('span', { text: editing ? 'Who reviews it' : 'Send to' });
    const form = h('form.form', { novalidate: true, onsubmit: function (ev) { ev.preventDefault(); submit(false); } }, [
      h('a.back', { href: editing ? '#/expense/' + encodeURIComponent(existing.expense_id) : '#/', text: editing ? 'Cancel' : 'Back' }),
      h('h1.title', {}, editing
        ? [(existing.status === 'NEEDS_INFO' ? 'Edit and resubmit ' : 'Edit '), h('span.id-nowrap', { text: existing.expense_id })]
        : ['New expense']),
      h('p.hint', { text: REQUIRED_NOTE }),
      restored ? h('p.hint', {}, ['Filled in from your unsent expense. ',
        h('button.link', { type: 'button', text: 'Start empty', onclick: function () { clearDraft(); renderForm(null); } })]) : null,
      errorSummary,
      editing && existing.status === 'APPROVED' && existing.send_to !== 'ACCOUNTANT'
        ? h('div.item-note', { text: 'Already approved. Changing the amount, the supplier or who gets paid sends it back for approval.' }) : null,
      editing && existing.info_request ? h('div.item-note', { text: 'Requested: ' + existing.info_request }) : null,
      section(1, 'What is it?', [typeField, fileField, noDocToggle, noDocField, noDocNoteField]),
      section(2, 'How much?', [amountField, catField, descField]),
      section(3, 'Who gets paid?', [payeeBlock], payeeTitle),
      section(4, editing ? 'Who reviews it' : 'Send to', [sendField], sendTitle),
      more,
      formErrors, warnBox,
      stickyBar,
    ]);
    formReady = true;
    paintAttachment();
    paintSummary();
    checkRequired();
    mount(page([form]));
  }

  // ---------------------------------------------------------- auto refresh
  // Apps Script can't push to the browser, so lists are re-fetched: when the
  // app comes back to the foreground (e.g. after tapping a Telegram alert),
  // every 60 s while the home screen is open, and on the Refresh button.

  const POLL_MS = 60000;
  const MIN_GAP_MS = 15000;
  let refreshing = false;
  let refreshFailed = false;  // the lists on screen are from last time: the "Updated" line says so

  function onHome() { return !location.hash || location.hash === '#/' || location.hash === '#'; }
  function userIsTyping() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
    return Array.prototype.some.call(document.querySelectorAll('textarea'), function (t) { return t.value.trim(); });
  }

  let roleChanged = false;
  // Decisions still being saved in the background: kept out of the "to approve" list meanwhile.
  const savingIds = {};
  window.addEventListener('beforeunload', function (ev) {
    if (Object.keys(savingIds).length) { ev.preventDefault(); ev.returnValue = ''; }
  });
  async function refreshViews(manual) {
    if (refreshing || !state.user) return;
    if (!manual && state.refreshedAt && Date.now() - state.refreshedAt.getTime() < MIN_GAP_MS) return;
    refreshing = true;
    try {
      const data = await Api.call('views', { cash: Boolean(state.user.petty) });
      // Role or outlet changed in the users tab: tabs and buttons depend on it, so start again.
      if (data.me && (data.me.role !== state.user.role || data.me.outletCode !== state.user.outletCode || (data.me.petty || '') !== (state.user.petty || ''))) {
        roleChanged = true;
        if (onHome() && !userIsTyping()) { toast('Your access was changed — reloading…'); setTimeout(function () { location.reload(); }, 1500); }
        return;
      }
      const hadAll = Boolean(state.views.all);
      state.views = data.views;
      if (data.sendTo) state.ref.sendTo = data.sendTo;
      Object.keys(savingIds).forEach(function (id) { removeFrom('to_approve', id); removeFrom('for_owners', id); });
      if (data.cash) state.cash = data.cash;
      if (hadAll) state.views.all = (await Api.call('listExpenses', { view: 'all' })).expenses;
      state.user.telegramLinked = data.telegramLinked;
      state.refreshedAt = new Date();
      refreshFailed = false;
      allError = '';
      cashError = '';
      saveStartData();
      if (onHome() && !userIsTyping() && !document.querySelector('.overlay, .viewer')) renderHome(true);
    } catch (err) {
      if (manual) toast(err.message);
      if (!refreshFailed) {
        refreshFailed = true;
        if (onHome() && !userIsTyping() && !document.querySelector('.overlay, .viewer')) renderHome(true);
      }
    } finally {
      refreshing = false;
    }
  }

  // Tabs stay open for days: when a new version is published, offer a reload (never forced: a form may be half-filled).
  const loadedVersion = (function () {
    const el = document.querySelector('script[src*="app.js"]');
    const m = el && el.getAttribute('src').match(/[?&]v=([^&]+)/);
    return m ? m[1] : '';
  })();
  let lastVersionCheck = 0;
  async function checkForUpdate() {
    if (!loadedVersion || Date.now() - lastVersionCheck < 10 * 60000 || document.querySelector('.update-bar')) return;
    lastVersionCheck = Date.now();
    try {
      const html = await (await fetch('index.html?check=' + Date.now(), { cache: 'no-store' })).text();
      const m = html.match(/app\.js\?v=([^"']+)/);
      if (!m || m[1] === loadedVersion) return;
      document.body.appendChild(h('div.update-bar', { role: 'status' }, [
        h('span', { text: 'A new version of the app is ready.' }),
        h('button.btn', { type: 'button', text: 'Reload', onclick: function () { location.reload(); } }),
      ]));
    } catch (err) { /* offline: try again later */ }
  }

  function refreshCurrent() {
    if (document.visibilityState !== 'visible') return;
    checkForUpdate();
    if (onHome()) { refreshViews(false); return; }
    const m = location.hash.match(/^#\/expense\/(.+)$/);
    if (m && !userIsTyping() && !document.querySelector('.viewer')) renderExpense(decodeURIComponent(m[1]), { silent: true });
  }

  function startAutoRefresh() {
    document.addEventListener('visibilitychange', refreshCurrent);
    window.addEventListener('focus', refreshCurrent);
    setInterval(function () { if (document.visibilityState === 'visible' && onHome()) refreshViews(false); }, POLL_MS);
  }

  // -------------------------------------------------------------- bootstrap

  function renderSignIn(message) {
    const slot = h('div.signin-slot');
    mount(h('div.page', {}, [h('main.content.center', {}, [
      h('img.signin-logo', { src: 'logo-192.png', alt: 'Pin Wei' }),
      h('h1.title', { text: 'Pin Wei Spend' }),
      h('p.sub', { text: message || 'Sign in with your Google account to submit and track expenses.' }),
      slot,
      h('a.link.signin-privacy', { href: 'privacy.html', text: 'Privacy notice' }),
    ])]));
    Api.renderButton(slot);
  }

  function renderFatal(err) {
    const registered = err.code !== 'AUTH_NOT_REGISTERED' && err.code !== 'AUTH_INACTIVE';
    mount(h('div.page', {}, [h('main.content.center', {}, [
      h('h1.title', { text: registered ? 'Could not load' : 'No access' }),
      h('p.sub', { text: err.message }),
      h('button.btn', { type: 'button', text: registered ? 'Try again' : 'Use another account', onclick: function () { if (!registered) Api.signOut(); location.reload(); } }),
    ])]));
  }

  async function start() {
    // A deep link like ?id=EXP-… opens that expense after sign-in.
    const params = new URLSearchParams(location.search);
    if (params.get('id')) {
      history.replaceState(null, '', location.pathname + '#/expense/' + encodeURIComponent(params.get('id')));
    } else if (params.get('cash')) {
      history.replaceState(null, '', location.pathname + '#/cash/' + encodeURIComponent(params.get('cash')));
    }

    const inApp = InApp.detect();
    if (inApp) {
      let continued = false;
      try { continued = Boolean(sessionStorage.getItem('inapp_continue')); } catch (err) { /* private mode */ }
      if (!continued) {
        const box = h('div.card');
        mount(h('div.page', {}, [h('main.content', {}, [box])]));
        InApp.renderEscape(box, inApp, function () {
          try { sessionStorage.setItem('inapp_continue', '1'); } catch (err) { /* private mode */ }
          location.reload();
        });
        return;
      }
    }

    if (!window.google || !google.accounts || !google.accounts.id) {
      renderFatal({ code: 'GSI', message: 'Google sign-in could not load. Check your connection and reload.' });
      return;
    }
    Api.init();
    if (!Api.hasToken()) {
      renderSignIn();
      await Api.waitForSignIn();
    }
    let started = false;
    function begin() {
      if (started) return;
      started = true;
      window.addEventListener('hashchange', function () {
        if (roleChanged && onHome()) { location.reload(); return; }
        route();
        if (onHome()) refreshViews(false); // coming back to the list: pick up changes made elsewhere
      });
      startAutoRefresh();
      route();
    }
    // The screen from last time (this person, this device) shows at once; fresh data follows.
    const saved = loadStartData(Api.currentEmail());
    if (saved) {
      applyStartData(saved.data);
      state.refreshedAt = new Date(saved.savedAt);
      begin();
    } else {
      mount(h('div.page', {}, [h('main.content.center', {}, [h('div.spinner'), h('p.sub', { text: 'Loading…' })])]));
    }
    try {
      const data = await Api.call('bootstrap');
      const was = state.user;
      applyStartData(data);
      state.refreshedAt = new Date();
      saveStartData();
      if (!started) { begin(); return; }
      // Already showing last time's screen: bring it up to date without touching a form being filled in.
      const changedAccess = !was || was.role !== data.user.role || was.outletCode !== data.user.outletCode || (was.petty || '') !== (data.user.petty || '');
      if (changedAccess) { homeTab = null; route(); return; }
      if (onHome() && !userIsTyping()) renderHome(true);
    } catch (err) {
      if (!started || /^AUTH_/.test(err.code || '')) { forgetStartData(); renderFatal(err); return; }
      toast(err.code === 'NETWORK' ? 'No connection — showing what was saved at ' + state.refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : err.message);
      refreshFailed = true;
      if (onHome() && !userIsTyping()) renderHome(true);
    }
  }

  // --------------------------------------------------------- start data
  // What bootstrap returned last time, kept in this browser for the same Google
  // account only (never shown to anyone signed in as someone else), for 7 days.
  const START_KEY = 'pw_start_v1';
  function applyStartData(data) {
    state.user = data.user;
    state.ref = data.ref;
    state.limits = data.limits;
    state.views = data.views;
    if (data.cash !== undefined) state.cash = data.cash;
  }
  function saveStartData() {
    try {
      if (!state.user || !state.user.email) return;
      const views = Object.assign({}, state.views);
      delete views.all;   // the full chain list is loaded when that tab is opened
      localStorage.setItem(START_KEY, JSON.stringify({
        email: String(state.user.email).toLowerCase(), savedAt: Date.now(),
        data: { user: state.user, ref: state.ref, limits: state.limits, views: views, cash: state.user.petty ? state.cash : null },
      }));
    } catch (err) { /* private mode or full: start normally next time */ }
  }
  function loadStartData(email) {
    try {
      const s = JSON.parse(localStorage.getItem(START_KEY) || 'null');
      if (!s || !email || s.email !== email || Date.now() - s.savedAt > 7 * 86400000) return null;
      return s;
    } catch (err) { return null; }
  }
  function forgetStartData() {
    try { localStorage.removeItem(START_KEY); } catch (err) { /* nothing saved */ }
  }

  ['dragover', 'drop'].forEach(function (t) { window.addEventListener(t, function (ev) { ev.preventDefault(); }); });
  // Start as soon as the page and Google's sign-in script are there (not after every font has loaded).
  function whenGoogleReady(fn) {
    const t0 = Date.now();
    (function wait() {
      if (window.google && google.accounts && google.accounts.id) return fn();
      if (Date.now() - t0 > 10000) return fn();   // start() then says sign-in could not load
      setTimeout(wait, 50);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { whenGoogleReady(start); });
  else whenGoogleReady(start);
})();
