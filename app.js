// Pin Wei Spend — single-page app. Every piece of data shown here was already
// filtered by the backend for this user; the frontend only lays it out.

(function () {
  const state = {
    user: null,
    ref: null,
    limits: null,
    views: { mine: [], to_approve: [], to_pay: [], to_check: [] },
    detail: null,   // last expense opened, reused by the edit form
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
    const el = h('div.toast' + (kind ? '.' + kind : ''), { role: 'status', text: message });
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3500);
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
    MAINTENANCE: 'Repairs', EQUIPMENT: 'Equipment', UTILITIES: 'Utilities', RENT: 'Rent', STAFF: 'Staff costs',
    MARKETING: 'Marketing', GIFTS: 'Gifts', OFFICE: 'Office & fees', SECURITY_DEPOSIT: 'Deposit', OTHER: 'Other',
  };
  // Tile order; codes added later in the Sheet go just before Other.
  const CATEGORY_ORDER = ['FOOD', 'PACKAGING', 'SUPPLIES', 'GAS', 'TRANSPORT', 'MAINTENANCE', 'EQUIPMENT',
    'UTILITIES', 'RENT', 'STAFF', 'MARKETING', 'GIFTS', 'OFFICE', 'SECURITY_DEPOSIT', 'OTHER'];
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
      .filter(function (c) { return !kitchen || HQ_ONLY_CATEGORIES.indexOf(c.value) === -1 || c.value === current; })
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
    return renderHome();
  }
  function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }

  // ------------------------------------------------------------------ shell

  function header() {
    return h('header.topbar', {}, [h('div.topbar-inner', {}, [
      h('a.brand', { href: '#/' }, [h('img.brand-logo', { src: 'logo-96.png', alt: '' }), h('span', { text: 'Pin Wei Spend' })]),
      h('div.who', {}, [
        h('span.who-name', { text: state.user.name }),
        h('span.who-role', { text: label('role', state.user.role) }),
      ]),
      h('button.link', { type: 'button', title: 'Switch light or dark theme', text: currentTheme() === 'dark' ? 'Light' : 'Dark', onclick: toggleTheme }),
      h('button.link', { type: 'button', text: 'Sign out', onclick: function () { if (!window.confirm('Sign out of Pin Wei Spend?')) return; Api.signOut(); location.reload(); } }),
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
    return h('a.item', { href: '#/expense/' + encodeURIComponent(e.expense_id), 'data-status': e.status }, [
      h('div.item-body', {}, [
        h('div.item-top', {}, [h('span.amount', { text: fmtMoney(e.status === 'PARTIAL' ? e.balance_due : e.amount_total) + (e.status === 'PARTIAL' ? ' left' : '') }), statusChip(e.status)]),
        h('div.item-mid', { text: categoryShort(e.expense_category) + (e.supplier_name ? ' · ' + e.supplier_name : e.description ? ' · ' + e.description : '') }),
        h('div.item-meta', {}, [
          h('span', { text: e.expense_id }),
          h('span', { text: fmtDate(e.created_at) }),
          showSubmitter ? h('span', { text: e.submitted_by_name + ' · ' + e.outlet_code }) : h('span', { text: 'To ' + e.send_to_name }),
          e.due_date && OPEN_STATUSES.indexOf(e.status) !== -1 ? h('span.due' + (overdue ? '.overdue' : ''), { text: (overdue ? 'Overdue · ' : 'Due ') + fmtDate(e.due_date) }) : null,
        ]),
        e.status === 'NEEDS_INFO' && e.info_request ? h('div.item-note', { text: 'Requested: ' + e.info_request }) : null,
        e.status === 'REJECTED' && e.rejection_reason ? h('div.item-note.bad', { text: 'Rejected: ' + e.rejection_reason }) : null,
      ]),
    ]);
  }

  /** Summary tiles at the top of a tab. tiles: [{value, label, brand?, alert?}] */
  function stats(tiles) {
    tiles = tiles.filter(Boolean);
    return h('div.stats.stats-' + tiles.length, {}, tiles.map(function (t) {
      return h('div.stat' + (t.brand ? '.stat-hero' : '') + (t.alert ? '.alert' : ''), {}, [
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

  function section(title, items, opts) {
    opts = opts || {};
    if (!items.length && !opts.showEmpty) return null;
    const head = h('h2.section-title', {}, [title, items.length ? h('span.count', { text: String(items.length) }) : null]);
    const list = items.length ? h('div.list', {}, items.map(function (e) { return expenseCard(e, opts.showSubmitter); })) : h('p.empty', { text: opts.empty });
    if (opts.collapsed) return h('details.section', { open: doneOpen, ontoggle: function (ev) { doneOpen = ev.currentTarget.open; } }, [h('summary', {}, [head]), list]);
    return h('section.section', {}, [head, list]);
  }

  /** A "Show: …" dropdown above a list. options: [[value, label], …] */
  function showFilter(value, options, onChange) {
    const sel = h('select.input', { 'aria-label': 'Show', onchange: function () { onChange(sel.value); renderHome(true); } },
      options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    sel.value = value;
    return h('label.show-filter', {}, [h('span.show-label', { text: 'Show' }), sel]);
  }

  /** Every expense the user may see across outlets; loaded once, then kept fresh by Refresh. null while loading. */
  let allLoading = false;
  function allExpenses() {
    if (state.views.all) return state.views.all;
    if (!allLoading) {
      allLoading = true;
      Api.call('listExpenses', { view: 'all' }).then(function (res) {
        state.views.all = res.expenses;
        if (onHome()) renderHome(true);
      }).catch(function (err) { toast(err.message); }).finally(function () { allLoading = false; });
    }
    return null;
  }

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
    if (PAYER_ROLES.indexOf(role) !== -1) tabDefs.push({ key: 'pay', label: 'To pay', count: state.views.to_pay.length });
    if (APPROVER_ROLES.indexOf(role) !== -1) tabDefs.push({ key: 'approve', label: 'To approve', count: state.views.to_approve.length + (state.views.to_check || []).length });
    tabDefs.push({ key: 'mine', label: tabDefs.length ? 'Mine' : 'My expenses', count: byStatus(['NEEDS_INFO']).length });
    if (ALL_VIEW_ROLES.indexOf(role) !== -1) tabDefs.push({ key: 'all', label: role === 'OUTLET_MANAGER' ? 'Outlet' : 'All', count: 0 });
    if (tabDefs.length >= 4) {                      // phone width: keep tab labels on one line
      const short = { pay: 'Pay', approve: 'Approve' };
      tabDefs.forEach(function (t) { if (short[t.key]) t.label = short[t.key]; });
    }
    if (!homeTab || !tabDefs.some(function (t) { return t.key === homeTab; })) {
      homeTab = (tabDefs.find(function (t) { return t.key !== 'mine' && t.count; }) || { key: 'mine' }).key;
    }
    const tabs = tabDefs.length > 1 ? h('div.tabs', { role: 'tablist', style: 'grid-template-columns: repeat(' + tabDefs.length + ', 1fr)' }, tabDefs.map(function (t) {
      return h('button.tab' + (homeTab === t.key ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': homeTab === t.key ? 'true' : 'false', onclick: function () { homeTab = t.key; renderHome(); } },
        [t.label, t.count ? h('span.count', { text: String(t.count) }) : null]);
    })) : null;

    let body;
    if (homeTab === 'all') {
      body = allView();
    } else if (homeTab === 'approve') {
      const qa = state.views.to_approve;
      body = [
        stats([
          { value: qa.length, label: 'Waiting', brand: true },
          { value: fmtShort(sum(qa, 'amount_total')), label: 'Total' },
          { value: (state.views.to_check || []).length, label: 'Cash checks' },
        ]),
        section('Waiting for your decision', state.views.to_approve, { showEmpty: true, empty: 'Nothing waiting for you.', showSubmitter: true }),
        section('Cash payments to post-check', state.views.to_check || [], { showSubmitter: true }),
      ];
    } else if (homeTab === 'pay') {
      const q = state.views.to_pay;
      const total = q.reduce(function (sum, e) { return sum + (Number(e.balance_due) || 0); }, 0);
      const overdueN = q.filter(isOverdue).length;
      const partialN = q.filter(function (e) { return e.status === 'PARTIAL'; }).length;
      let listPart;
      if (payShow === 'PAID') {
        const all = allExpenses();
        const since = Date.now() - 30 * 86400000;
        const paid = (all || []).filter(function (e) { return (e.status === 'PAID' || e.status === 'CLOSED') && e.paid_at && new Date(e.paid_at).getTime() >= since; })
          .sort(function (a, b) { return new Date(b.paid_at) - new Date(a.paid_at); });
        listPart = all ? section('Paid in the last 30 days', paid, { showEmpty: true, empty: 'Nothing paid in the last 30 days.', showSubmitter: true }) : loading('Loading paid expenses…');
      } else {
        const shown = q.filter(function (e) {
          if (payShow === 'OVERDUE') return isOverdue(e);
          return !payShow || e.status === payShow;
        });
        const title = { '': 'Approved, waiting for payment', APPROVED: 'Approved, nothing paid yet', PARTIAL: 'Partially paid', OVERDUE: 'Overdue' }[payShow];
        listPart = section(title, shown, { showEmpty: true, empty: payShow ? 'Nothing here.' : 'Nothing to pay.', showSubmitter: true });
      }
      body = [
        stats([
          { value: q.length, label: 'To pay', brand: true },
          { value: fmtShort(total), label: 'Outstanding' },
          { value: overdueN, label: 'Overdue', alert: overdueN > 0 },
          { value: partialN, label: 'Partially paid' },
        ]),
        showFilter(payShow, [
          ['', 'Everything to pay (' + q.length + ')'],
          ['APPROVED', 'Approved, nothing paid yet (' + (q.length - partialN) + ')'],
          ['PARTIAL', 'Partially paid (' + partialN + ')'],
          ['OVERDUE', 'Overdue (' + overdueN + ')'],
          ['PAID', 'Paid in the last 30 days'],
        ], function (v) { payShow = v; }),
        listPart,
        q.length && payShow !== 'PAID' ? h('button.btn', { type: 'button', text: 'Export list for bank transfers (CSV)', onclick: exportToPay }) : null,
        monthExportRow(),
      ];
    } else {
      body = [
        stats([
          { value: byStatus(['NEEDS_INFO']).length, label: 'Need info', alert: byStatus(['NEEDS_INFO']).length > 0 },
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
      if (mine.length) {
        body.push(showFilter(mineShow, [['', 'Everything (' + mine.length + ')']].concat(Object.keys(MINE_SHOW).map(function (k) {
          return [k, MINE_SHOW[k][0] + ' (' + byStatus(MINE_SHOW[k][1]).length + ')'];
        })), function (v) { mineShow = v; }));
      }
      if (MINE_SHOW[mineShow]) {
        body.push(section(MINE_SHOW[mineShow][0], byStatus(MINE_SHOW[mineShow][1]), { showEmpty: true, empty: 'Nothing here.' }));
      } else {
        body.push(
          section('Needs your info', byStatus(['NEEDS_INFO'])),
          section('In progress', byStatus(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL']), { showEmpty: true, empty: 'Nothing in progress.' }),
          section('Done', byStatus(['PAID', 'CLOSED', 'REJECTED', 'CANCELLED']), { collapsed: true })
        );
      }
    }
    body.push(state.user.telegramLinked ? telegramFooter() : telegramCard());
    const refreshed = h('p.refresh-line', {}, [
      'Updated ' + (state.refreshedAt ? state.refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—') + ' · ',
      h('button.link', { type: 'button', text: 'Refresh', onclick: function () { refreshViews(true); } }),
    ]);
    mount(page([tabs, refreshed].concat(body)), keepScroll);
  }

  /** Owner/admin timeline across every outlet (spec §8), loaded on first open. */
  function allView() {
    if (!allExpenses()) return [loading('Loading all expenses…')];
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

    const outletSel = h('select.input', { onchange: function () { allFilter.outlet = outletSel.value; renderHome(true); } },
      [h('option', { value: '', text: 'All outlets' })].concat(outletCodes().map(function (c) { return h('option', { value: c, text: c }); })));
    outletSel.value = allFilter.outlet;
    const statusSel = h('select.input', { onchange: function () { allFilter.status = statusSel.value; renderHome(true); } },
      [h('option', { value: 'OPEN', text: 'Open (not paid yet)' }), h('option', { value: '', text: 'Every status' })]
        .concat(state.ref.enums.filter(function (x) { return x.field === 'status'; }).map(function (x) { return h('option', { value: x.value, text: x.label }); })));
    statusSel.value = allFilter.status;
    const search = h('input.input', { type: 'search', placeholder: 'Search ID, supplier, person…', value: allFilter.q });
    search.addEventListener('change', function () { allFilter.q = search.value; renderHome(true); });

    // Timeline: grouped by submission day, newest first.
    const groups = [];
    rows.forEach(function (e) {
      const day = fmtDate(e.created_at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(e); else groups.push({ day: day, items: [e] });
    });
    return [
      h('div.filters', {}, [h('div.grid2', {}, [outletSel, statusSel]), search]),
      EXPORT_MONTH_ROLES.indexOf(state.user.role) !== -1 && state.user.role !== 'ACCOUNTANT' ? monthExportRow() : null,
      stats([
        { value: rows.length, label: 'Shown', brand: true },
        { value: fmtShort(total), label: 'Total' },
        { value: rows.filter(isOverdue).length, label: 'Overdue', alert: rows.filter(isOverdue).length > 0 },
      ]),
      rows.length ? null : h('p.empty', { text: 'Nothing matches.' }),
    ].concat(groups.map(function (g) {
      return h('section.section', {}, [h('h2.section-title', { text: g.day }), h('div.list', {}, g.items.map(function (e) { return expenseCard(e, true); }))]);
    }));
  }

  function outletCodes() {
    const seen = {};
    (state.views.all || []).forEach(function (e) { seen[e.outlet_code] = true; });
    return Object.keys(seen).sort();
  }

  // ----------------------------------------------------------- expense view

  function loading(text) {
    return h('div.center-block', { role: 'status', 'aria-live': 'polite' }, [h('div.spinner', { 'aria-hidden': 'true' }), h('p.sub', { text: text || 'Loading…' })]);
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function attachmentView(att) {
    if (!att) return h('div.doc-missing', { text: 'No document attached' });
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

  /** Full-size photo. The phone's Back button closes it (not the expense); tap to zoom in and out. */
  function openViewer(url) {
    const viewer = h('div.viewer');
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', close);
      viewer.remove();
    }
    history.pushState({ viewer: true }, '');
    window.addEventListener('popstate', close);
    const img = h('img', { src: url, alt: 'Invoice, full size', onclick: function () { img.classList.toggle('zoomed'); } });
    viewer.appendChild(img);
    viewer.appendChild(h('button.viewer-close', { type: 'button', text: 'Close', onclick: function () { history.back(); } }));
    document.body.appendChild(viewer);
  }

  const ACTION_LABEL = {
    SUBMIT: 'Submitted', SUBMIT_DIRECT_TO_ACCOUNTANT: 'Submitted to accountant', APPROVE: 'Approved',
    REJECT: 'Rejected', REQUEST_INFO: 'Asked for more info', RESUBMIT: 'Resubmitted',
    EDIT: 'Edited', EDIT_NEEDS_REAPPROVAL: 'Edited — needs approval again', CANCEL: 'Cancelled', POST_CHECK: 'Cash payment post-checked',
    PAY_FULL: 'Paid in full', PAY_PARTIAL: 'Partial payment',
    REVIEW_REQUEST: 'Accountant asked for a review', PAY_VOID: 'Payment record voided',
    POST_CHECK_PROBLEM: 'Problem reported at the cash check', SYSTEM_CLEAR_DEMO: 'Demo data cleared',
  };

  function timelineView(items) {
    // One line per action; the field-level rows of the same action are folded in.
    const lines = [];
    items.forEach(function (t) {
      const last = lines[lines.length - 1];
      if (last && last.at === t.at && last.action === t.action) { if (t.field) last.fields.push(t); return; }
      lines.push({ at: t.at, by: t.by, action: t.action, fields: t.field ? [t] : [] });
    });
    const isReason = function (f) { return ['info_request', 'rejection_reason', 'payment', 'cancel_reason', 'post_check_note', 'post_check_problem', 'review_request', 'void', 'void_reason'].indexOf(f.field) !== -1; };
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
  async function renderExpense(id, opts) {
    const silent = Boolean(opts && opts.silent);
    const backLink = function () { return h('a.back', { href: '#/', text: 'Back' }); };
    if (!silent) mount(page([backLink(), loading()]));
    let e;
    try {
      e = await Api.call('getExpense', { id: id });
    } catch (err) {
      if (!silent) mount(page([backLink(), h('p.empty', { text: err.message })]));
      return;
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
      ]),
      h('div.detail-side', {}, [
      e.flags.length ? h('div.flags', {}, e.flags.map(function (f) {
        return f.level === 'info' ? h('div.flag.info', { text: f.message }) : h('div.flag', { text: f.message });
      })) : null,
      h('div.card', { 'data-status': e.status }, [
        h('div.item-top', {}, [h('span.amount.big', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
        h('div.item-mid', { text: categoryLabel(e.expense_category) + ' · ' + label('request_type', e.request_type) }),
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
        row('ID', e.expense_id),
      ]),
      e.can.decide ? decisionPanel(e) : null,
      e.can.approveSupplier ? supplierApprovalCard(e) : null,
      e.pay_blocked ? h('div.flag', { text: e.pay_blocked }) : null,
      e.pay_to && e.can.pay ? payToCard(e.pay_to) : null,
      e.can.pay ? paymentPanel(e) : null,
      e.can.requestReview ? reviewRequestPanel(e) : null,
      e.can.postCheck ? postCheckPanel(e) : null,
      e.payments && e.payments.length ? h('h2.section-title', { text: 'Payments' }) : null,
      e.payments && e.payments.length ? h('div.list.single', {}, e.payments.map(function (p) { return paymentCard(p, e); })) : null,
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
      try {
        const res = await Api.call('decide', { id: e.expense_id, decision: decision, reason: reason, seen_updated_at: e.updated_at });
        removeFrom('to_approve', e.expense_id);
        if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
        toast({ APPROVE: 'Approved ', REJECT: 'Rejected ', REQUEST_INFO: 'Sent back for info: ' }[decision] + e.expense_id, 'ok');
        go('/');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        setDisabled(false);
      } finally {
        busy = false;
      }
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
      panel.appendChild(h('label.label', { for: 'decision_reason', text: reject ? 'Reason for rejecting (required)' : 'What is missing? (required)' }));
      panel.appendChild(reasonBox);
      panel.appendChild(err);
      panel.appendChild(h('div.row', {}, [
        h('button.btn', { type: 'button', text: 'Cancel', onclick: showMain }),
        h('button.btn' + (reject ? '.btn-danger' : '.btn-primary'), { type: 'button', text: reject ? 'Reject' : 'Send back', onclick: function () { send(decision); } }),
      ]));
      reasonBox.focus();
    }
    showMain();
    return panel;
  }

  // ------------------------------------------------------- lifecycle panels

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
      panel.appendChild(h('label.label', { for: boxId, text: opts.label }));
      panel.appendChild(box);
      panel.appendChild(err);
      const go2 = h('button.btn' + (opts.danger ? '.btn-danger' : '.btn-approve'), { type: 'button', text: opts.confirm });
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
    ['to_approve', 'to_pay', 'to_check'].forEach(function (v) { removeFrom(v, res.expense.expense_id); });
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
    wrap.appendChild(confirmPanel({
      open: 'Something is wrong? Report it', danger: true, required: true,
      intro: 'For example the goods did not arrive, the amount is different, or the receipt is wrong. The accountant and the owners are told; the item stays open.',
      label: 'What is wrong? (required)', placeholder: 'e.g. only 8 of 10 bags of ice arrived',
      confirm: 'Report the problem',
      run: async function (note) {
        const res = await Api.call('postCheck', { id: e.expense_id, note: note, problem: true });
        state.detail = null;
        toast('Problem reported for ' + res.expense.expense_id, 'ok');
        renderExpense(e.expense_id);
      },
    }));
    return wrap;
  }

  /** Accountant: "this looks wrong" → back to an owner/admin before anything is paid. */
  function reviewRequestPanel(e) {
    const opts = e.review_options || [];
    const panel = h('div.decide');
    const select = h('select.input', { id: 'review_to' }, [h('option', { value: '', text: 'Choose who should check it' })]
      .concat(opts.map(function (o) { return h('option', { value: o.value, text: o.label }); })));
    if (opts.length === 1) select.value = opts[0].value;
    const box = h('textarea.input', { id: 'review_reason', rows: 3, placeholder: 'e.g. The invoice total does not match the amount' });
    const err = h('p.error', { hidden: true });
    function collapsed() {
      panel.textContent = '';
      panel.appendChild(h('button.btn', { type: 'button', text: 'Something looks wrong? Ask an owner to review', onclick: expanded }));
    }
    function expanded() {
      panel.textContent = '';
      err.hidden = true;
      panel.appendChild(h('h2.section-title', { text: 'Ask an owner to review' }));
      panel.appendChild(h('p.hint', { text: 'It goes back to the person you choose and cannot be paid until they approve it again. The submitter is not told.' }));
      if (!opts.length) {
        panel.appendChild(h('p.error', { text: 'No other owner or admin is active to review this.' }));
        panel.appendChild(h('button.btn', { type: 'button', text: 'Back', onclick: collapsed }));
        return;
      }
      const send = h('button.btn.btn-primary', { type: 'button', text: 'Send for review' });
      send.addEventListener('click', async function () {
        const reason = box.value.trim();
        if (!select.value) { err.textContent = 'Choose who should review it.'; err.hidden = false; select.focus(); return; }
        if (!reason) { err.textContent = 'Write what looks wrong.'; err.hidden = false; box.focus(); return; }
        send.disabled = true;
        try {
          const res = await Api.call('requestReview', { id: e.expense_id, reviewer_id: select.value, reason: reason });
          afterAction(res, 'Sent to ' + select.options[select.selectedIndex].text + ' for review: ' + e.expense_id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
      });
      panel.appendChild(h('label.label', { for: 'review_to', text: 'Who should check it?' }));
      panel.appendChild(select);
      panel.appendChild(h('label.label', { for: 'review_reason', text: 'What looks wrong? (required)' }));
      panel.appendChild(box);
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

  function paymentCard(p, e) {
    const proofUrl = p.proof && p.proof.base64 ? URL.createObjectURL(base64ToBlob(p.proof.base64, p.proof.mime)) : null;
    const reversal = p.payment_seq === 'REVERSAL';
    const chip = reversal ? h('span.chip.bad', { text: 'Voids ' + p.reverses_payment_id })
      : p.voided ? h('span.chip.muted', { text: 'Voided' })
      : h('span.chip.ok', { text: label('payment_seq', p.payment_seq) });
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
      proofUrl && p.proof.mime.indexOf('image/') === 0 ? h('img.proof-thumb', { src: proofUrl, alt: 'Transfer confirmation', onclick: function () { openViewer(proofUrl); } }) : null,
      proofUrl && p.proof.mime === 'application/pdf' ? h('a.link', { href: proofUrl, target: '_blank', rel: 'noopener', text: 'Open transfer confirmation (PDF)' }) : null,
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
    amountInput.value = money.format(balance);
    const dateInput = h('input.input', { type: 'date', max: todayVN() });
    dateInput.value = todayVN();
    const methodSelect = h('select.input', {}, state.ref.enums.filter(function (x) { return x.field === 'payment_method'; })
      .map(function (x) { return h('option', { value: x.value, text: x.label }); }));
    methodSelect.value = e.payee_type === 'OUTLET_CASH' ? 'CASH' : (e.payment_method || 'BANK_TRANSFER');
    const sourceInput = h('input.input', { autocomplete: 'off', placeholder: 'e.g. VCB-8866 (optional)' });
    const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
    const proofBox = h('div.preview');
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
      paintButton();
    });

    function paintProof(status) {
      proofBox.textContent = '';
      if (status === 'working') proofBox.appendChild(h('p.hint', { text: 'Preparing photo…' }));
      if (proof) {
        proofBox.appendChild(h('div.preview-row', {}, [
          proof.mime.indexOf('image/') === 0 ? h('img.thumb', { src: 'data:' + proof.mime + ';base64,' + proof.base64, alt: 'Transfer confirmation' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: proof.name }), h('span.hint', { text: Math.round(proof.sizeAfter / 1024) + ' KB' })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { proof = null; fileInput.value = ''; paintProof(); } }),
        ]));
      }
    }
    fileInput.addEventListener('change', function () {
      const f = fileInput.files[0];
      if (!f) return;
      proof = null;
      err.hidden = true;
      paintProof('working');
      preparing = Attachment.prepare(f, state.limits.maxUploadMb)
        .then(function (a) { proof = a; })
        .catch(function (ex) { err.textContent = ex.message; err.hidden = false; })
        .finally(function () { preparing = null; paintProof(); });
    });

    const formWrap = h('div.stack');
    const reviewWrap = h('div.stack', { hidden: true });

    /** Step 1: catch the obvious mistakes before showing the summary. */
    async function review() {
      if (busy) return;
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
      if (cash && e.payee_type !== 'OUTLET_CASH') warnings.push('Cash: the outlet manager will be asked to confirm it afterwards.');

      const tick = h('input', { type: 'checkbox', id: 'pay_checked' });
      const confirmBtn = h('button.btn.btn-approve.btn-big', { type: 'button', text: partial ? 'Confirm partial payment' : 'Confirm and mark as paid', disabled: true });
      tick.addEventListener('change', function () { confirmBtn.disabled = !tick.checked || busy; });
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
        const res = await Api.call('recordPayment', {
          id: e.expense_id,
          amount: amount,
          paid_at: dateInput.value,
          payment_method: methodSelect.value,
          source_account: sourceInput.value.trim(),
          file: proof ? { name: proof.name, mime: proof.mime, base64: proof.base64, sha256: proof.sha256 } : null,
        });
        if (res.expense.status === 'PAID') removeFrom('to_pay', e.expense_id); else upsert('to_pay', res.expense);
        if (res.expense.submitted_by === state.user.userId) upsert('mine', res.expense);
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
    [fileInput, proofBox,
      h('button.btn.btn-photo', { type: 'button', onclick: function () { fileInput.click(); } }, ['Attach transfer confirmation']),
      h('div.field', {}, [h('label.label', { for: 'pay_amount', text: 'Amount paid' }), h('div.money-wrap', {}, [amountInput, h('span.suffix', { text: '₫' })]), words, hint]),
      h('div.grid2', {}, [
        h('div.field', {}, [h('label.label', { for: 'pay_date', text: 'Paid on' }), dateInput]),
        h('div.field', {}, [h('label.label', { for: 'pay_method', text: 'Method' }), methodSelect]),
      ]),
      h('details.more-inline', {}, [h('summary', { text: 'Paid from which account? (optional)' }), sourceInput]),
      btn,
    ].forEach(function (n) { formWrap.appendChild(n); });

    return h('div.decide', {}, [
      h('h2.section-title', { text: 'Record payment' }),
      h('p.hint', { text: 'Transfer the money in your bank app first, then record it here. You will see a summary to check before anything is saved.' }),
      formWrap,
      reviewWrap,
      err,
    ]);
  }

  // ------------------------------------------------------------------- form

  const NEW_SUPPLIER = '__new__';
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
    renderForm(e);
  }

  /**
   * New-expense form, or (with `existing`) the edit-and-resubmit form after the
   * approver asked for more info. Drafts are only kept for new expenses.
   */
  function renderForm(existing) {
    const editing = Boolean(existing);
    const draft = editing ? {} : loadDraft();
    // A draft is kept when someone leaves the form; say so, so an old amount isn't sent by mistake.
    const restored = ['amount_total', 'expense_category', 'payee_type', 'supplier_id', 'description'].some(function (k) { return draft[k]; });
    const values = editing
      ? Object.assign({}, existing.editable)
      : Object.assign({ request_type: 'INVOICE', outlet_code: state.user.outletCode, payment_method: 'BANK_TRANSFER' }, draft);
    if (!state.ref.outlets.some(function (o) { return o.value === values.outlet_code; })) values.outlet_code = state.ref.outlets[0].value;

    let attachment = null;      // newly prepared upload
    // The photo already on file (edit mode) stays unless replaced or removed.
    let keptAttachment = editing && existing.attachment && !existing.attachment.error ? existing.attachment : null;
    let removedAttachment = false;
    let preparing = null;       // promise while compressing
    let submitting = false;
    const fieldEls = {};        // field -> wrapper, for error display
    const summary = h('p.submit-summary', { hidden: true, 'aria-live': 'polite' });

    function set(field, value) { values[field] = value; if (!editing) saveDraft(values); clearError(field); paintSummary(); }

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
        const c = w.querySelector('#f_' + name);
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
      const c = w.querySelector('#f_' + name);
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
      }
      options.forEach(function (o) {
        wrap.appendChild(h('button.choice', { type: 'button', role: 'radio', 'data-value': o.value, onclick: function () { set(name, o.value); paint(); if (o.onpick) o.onpick(); } }, [
          h('span.choice-title', { text: o.label }),
          o.sub ? h('span.choice-sub', { text: o.sub }) : null,
        ]));
      });
      paint();
      return wrap;
    }

    /** A section card with a step number, so the form reads as four short steps. */
    function section(num, title, children) {
      return h('section.form-section', {}, [
        h('h2.form-step', {}, [h('span.step-num', { text: String(num), 'aria-hidden': 'true' }), h('span', { text: title })]),
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
      paintWords();
      const wrap = h('div.money-wrap', {}, [el, h('span.suffix', { text: '₫' })]);
      return words ? h('div', {}, [wrap, words]) : wrap;
    }

    // --- request type
    const typeField = field('request_type', null, choices('request_type', [
      { value: 'INVOICE', label: 'Already bought', sub: 'I have an invoice or receipt', onpick: function () { if (!editing) refreshSendTo(); } },
      { value: 'PURCHASE_REQUEST', label: 'Not bought yet', sub: 'Ask for approval before buying', onpick: function () { if (!editing) refreshSendTo(true); } },
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
    const fileField = field('file', 'Photo of the document', h('div', {}, [fileInput, preview, dropzone]));

    function paintAttachment(status) {
      preview.textContent = '';
      if (status === 'working') preview.appendChild(h('p.hint', { text: 'Preparing photo…' }));
      if (!attachment && keptAttachment) {
        const isImg = keptAttachment.mime.indexOf('image/') === 0;
        preview.appendChild(h('div.preview-row', {}, [
          isImg ? h('img.thumb', { src: 'data:' + keptAttachment.mime + ';base64,' + keptAttachment.base64, alt: 'Current document' }) : h('span.pdf', { text: 'PDF' }),
          h('div.preview-info', {}, [h('span', { text: 'Current document' }), h('span.hint', { text: 'Take a new photo to replace it' })]),
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { keptAttachment = null; removedAttachment = true; paintAttachment(); } }),
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
          h('button.link', { type: 'button', text: 'Remove', onclick: function () { attachment = null; fileInput.value = ''; paintAttachment(); } }),
        ]));
      }
      const hasDoc = Boolean(attachment || keptAttachment);
      dropzone.classList.toggle('compact', hasDoc);
      dropTitle.textContent = hasDoc ? 'Replace photo' : 'Take or choose a photo';
      noDocField.hidden = hasDoc || status === 'working' || !noDocOpen;
      noDocNoteField.hidden = noDocField.hidden || values.no_doc_reason !== 'OTHER';
      noDocToggle.hidden = hasDoc || status === 'working' || noDocOpen;
    }

    function pickFile(file) {
      clearError('file');
      attachment = null;
      paintAttachment('working');
      preparing = Attachment.prepare(file, state.limits.maxUploadMb).then(function (a) {
        attachment = a;
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
      const full = values.expense_category ? categoryLabel(values.expense_category) : '';
      catHint.textContent = full && full !== categoryShort(values.expense_category) ? 'Covers: ' + full : '';
    }
    tileCategories(values.expense_category).forEach(function (c) {
      catGrid.appendChild(h('button.chip-btn', { type: 'button', role: 'radio', 'data-value': c.value, text: categoryShort(c.value), title: c.label,
        onclick: function () { set('expense_category', c.value); paintCats(); } }));
    });
    paintCats();
    const catField = field('expense_category', 'Category', h('div', {}, [catGrid, catHint]));

    // --- send to
    const sendToList = h('div.radios');
    // Money back to the submitter, out of the cash box, or to a third party always needs an approver.
    const NEEDS_APPROVER = ['OTHER', 'SUBMITTER', 'OUTLET_CASH'];
    function refreshSendTo(purchaseDefault) {
      const opts = (state.ref.sendTo[values.outlet_code] || []).filter(function (o) {
        return !(o.kind === 'ACCOUNTANT' && NEEDS_APPROVER.indexOf(values.payee_type) !== -1);
      });
      if (purchaseDefault || !opts.some(function (o) { return o.value === values.send_to; })) {
        // Spec §6.1: purchase requests default to an owner; invoices to the accountant.
        const owner = opts.find(function (o) { return o.kind === 'OWNER'; }) || opts.find(function (o) { return o.kind === 'ADMIN'; });
        values.send_to = values.request_type === 'PURCHASE_REQUEST' && owner ? owner.value : (opts[0] || {}).value;
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
          h('input', { type: 'radio', name: 'send_to', id: id, value: o.value, checked: values.send_to === o.value, onchange: function () { set('send_to', o.value); } }),
          h('span', { text: o.label }),
        ]));
      });
      paintSummary();
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
    const supplierSelect = select('supplier_id', state.ref.suppliers.concat([{ value: NEW_SUPPLIER, label: '+ Add a new supplier…' }]), 'Not listed / none');
    const newSupplierBox = h('div.payee-other', { hidden: true }, [
      h('p.hint', { text: 'New suppliers need an owner\u2019s approval before the accountant can pay into their account.' }),
      field('new_supplier_name', 'Supplier name', input('new_supplier_name', { autocomplete: 'off' })),
      field('new_supplier_tax_id', 'Tax ID (MST)', input('new_supplier_tax_id', { inputmode: 'numeric', autocomplete: 'off' })),
      field('new_supplier_bank_name', 'Bank', input('new_supplier_bank_name', { autocomplete: 'off' })),
      field('new_supplier_bank_account', 'Account number', input('new_supplier_bank_account', { inputmode: 'numeric', autocomplete: 'off' })),
    ]);
    supplierSelect.addEventListener('change', function () {
      newSupplierBox.hidden = supplierSelect.value !== NEW_SUPPLIER;
      // A regular supplier suggests its usual category (one tap less for daily deliveries).
      const s = state.ref.suppliers.find(function (x) { return x.value === supplierSelect.value; });
      if (s && s.defaultCategory && !values.expense_category && catGrid.querySelector('[data-value="' + s.defaultCategory + '"]')) {
        set('expense_category', s.defaultCategory);
        paintCats();
      }
    });
    newSupplierBox.hidden = values.supplier_id !== NEW_SUPPLIER;
    const supplierField = field('supplier_id', 'Supplier', h('div', {}, [supplierSelect, newSupplierBox]));

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
        if (dup) { values.supplier_id = dup.existingId; }  // it already exists: use it
        else throw err;
      }
      saveDraft(values);
    }
    const otherFields = h('div.payee-other', {}, [
      field('payee_name', 'Their name', input('payee_name', { autocomplete: 'off' })),
      field('payee_account', 'Their account number', input('payee_account', { inputmode: 'numeric', autocomplete: 'off' })),
      field('payee_bank', 'Their bank', input('payee_bank', { autocomplete: 'off' })),
    ]);
    function paintPayee() {
      const t = values.payee_type;
      supplierField.querySelector('.label').textContent = t === 'SUPPLIER' ? 'Supplier' : 'Bought from (optional)';
      supplierField.hidden = !t;
      otherFields.hidden = t !== 'OTHER';
      payeeHint.textContent = t === 'SUBMITTER'
        ? (state.user.hasBankAccount ? 'The accountant pays you back into your bank account on file. Someone must approve it first.'
          : 'Your bank account is not on file yet: ask the admin to add it, or you will be paid back in cash. Someone must approve it first.')
        : t === 'OUTLET_CASH'
          ? 'Paid from the outlet cash box. The accountant tops the box up, so nobody is paid twice. Someone must approve it first.'
          : t === 'OTHER'
            ? 'e.g. a delivery driver. Money to someone other than the supplier always needs an approver.'
            : t === 'SUPPLIER' ? 'Paid to the supplier\u2019s registered bank account.' : '';
      // These can never go straight to the accountant: the list hides that option.
      if (!editing) refreshSendTo();
    }
    const payeeField = field('payee_type', null, h('div', {}, [
      choices('payee_type', [
        { value: 'SUPPLIER', label: 'The supplier', sub: 'Into their bank account', onpick: paintPayee },
        { value: 'OUTLET_CASH', label: 'Outlet cash box', sub: 'Already paid from the box', onpick: paintPayee },
        { value: 'SUBMITTER', label: 'Me', sub: 'I paid, pay me back', onpick: paintPayee },
        { value: 'OTHER', label: 'Someone else', sub: 'e.g. a delivery driver', onpick: paintPayee },
      ], 2, 'Who gets paid?'),
      payeeHint,
    ]));
    const payeeBlock = h('div.payee-block', {}, [payeeField, supplierField, otherFields]);
    paintPayee();

    // --- description
    const desc = h('textarea.input', { rows: 2, placeholder: 'What was bought, and for what?', oninput: function () { set('description', desc.value); } });
    desc.value = values.description || '';
    const descField = field('description', 'Description', desc, 'Required when the category or reason is "Other".');

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
    const warnBox = h('div.warnbox', { hidden: true });
    const submitBtn = h('button.btn.btn-primary.btn-big', { type: 'submit', text: 'Submit' });

    async function submit(confirmWarnings) {
      if (submitting) return;
      submitting = true;
      warnBox.hidden = true;
      stickyBar.hidden = false;
      errorSummary.hidden = true;
      Object.keys(fieldEls).forEach(clearError);
      submitBtn.disabled = true;
      try {
        if (preparing) { submitBtn.textContent = 'Preparing photo…'; await preparing; }
        submitBtn.textContent = attachment ? 'Uploading…' : 'Submitting…';
        const payload = {};
        DRAFT_FIELDS.forEach(function (f) { if (values[f] !== undefined) payload[f] = values[f]; });
        if (attachment) { payload.file = { name: attachment.name, mime: attachment.mime, base64: attachment.base64, sha256: attachment.sha256 }; payload.no_doc_reason = ''; }
        if (!attachment && keptAttachment) payload.no_doc_reason = '';
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
        state.detail = null;
        upsert('mine', res.expense);
        toast(!editing ? 'Submitted ' + res.expense.expense_id
          : res.action === 'RESUBMIT' ? 'Resubmitted ' + res.expense.expense_id
            : res.action === 'EDIT_NEEDS_REAPPROVAL' ? 'Saved — ' + res.expense.expense_id + ' goes back for approval'
              : 'Saved ' + res.expense.expense_id, 'ok');
        go('/');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details.length) {
          if (!editing && err.details.some(function (d) { return d.field === 'send_to'; })) reloadSendTo();
          err.details.forEach(function (d) { showError(d.field in fieldEls ? d.field : '_form', d.message); });
          if (err.details.some(function (d) { return more.contains(fieldEls[d.field] || null); })) more.open = true;
          showErrorSummary(err.details);
        } else {
          showError('_form', err.message || 'Something went wrong. Please try again.');
          showErrorSummary([{ field: '_form', message: err.message || 'Something went wrong. Please try again.' }], err.code === 'NETWORK' ? 'Not sent' : null);
        }
      } finally {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    }

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

    const stickyBar = h('div.sticky-submit', {}, [summary, submitBtn]);
    const form = h('form.form', { novalidate: true, onsubmit: function (ev) { ev.preventDefault(); submit(false); } }, [
      h('a.back', { href: editing ? '#/expense/' + encodeURIComponent(existing.expense_id) : '#/', text: editing ? 'Cancel' : 'Back' }),
      h('h1.title', {}, editing
        ? [(existing.status === 'NEEDS_INFO' ? 'Edit and resubmit ' : 'Edit '), h('span.id-nowrap', { text: existing.expense_id })]
        : ['New expense']),
      restored ? h('p.hint', {}, ['Filled in from your unsent expense. ',
        h('button.link', { type: 'button', text: 'Start empty', onclick: function () { clearDraft(); renderForm(null); } })]) : null,
      errorSummary,
      editing && existing.status === 'APPROVED' && existing.send_to !== 'ACCOUNTANT'
        ? h('div.item-note', { text: 'Already approved. Changing the amount, the supplier or who gets paid sends it back for approval.' }) : null,
      editing && existing.info_request ? h('div.item-note', { text: 'Requested: ' + existing.info_request }) : null,
      section(1, 'What is it?', [typeField, fileField, noDocToggle, noDocField, noDocNoteField]),
      section(2, 'How much?', [amountField, catField, descField]),
      section(3, 'Who gets paid?', [payeeBlock]),
      section(4, editing ? 'Who reviews it' : 'Send to', [sendField]),
      more,
      formErrors, warnBox,
      stickyBar,
    ]);
    paintAttachment();
    paintSummary();
    mount(page([form]));
  }

  // ---------------------------------------------------------- auto refresh
  // Apps Script can't push to the browser, so lists are re-fetched: when the
  // app comes back to the foreground (e.g. after tapping a Telegram alert),
  // every 60 s while the home screen is open, and on the Refresh button.

  const POLL_MS = 60000;
  const MIN_GAP_MS = 15000;
  let refreshing = false;

  function onHome() { return !location.hash || location.hash === '#/' || location.hash === '#'; }
  function userIsTyping() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
    return Array.prototype.some.call(document.querySelectorAll('textarea'), function (t) { return t.value.trim(); });
  }

  async function refreshViews(manual) {
    if (refreshing || !state.user) return;
    if (!manual && state.refreshedAt && Date.now() - state.refreshedAt.getTime() < MIN_GAP_MS) return;
    refreshing = true;
    try {
      const data = await Api.call('views');
      const hadAll = Boolean(state.views.all);
      state.views = data.views;
      if (data.sendTo) state.ref.sendTo = data.sendTo;
      if (hadAll) state.views.all = (await Api.call('listExpenses', { view: 'all' })).expenses;
      state.user.telegramLinked = data.telegramLinked;
      state.refreshedAt = new Date();
      if (onHome() && !userIsTyping() && !document.querySelector('.overlay, .viewer')) renderHome(true);
    } catch (err) {
      if (manual) toast(err.message);
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
    mount(h('div.page', {}, [h('main.content.center', {}, [h('div.spinner'), h('p.sub', { text: 'Loading…' })])]));
    try {
      const data = await Api.call('bootstrap');
      state.user = data.user;
      state.ref = data.ref;
      state.limits = data.limits;
      state.views = data.views;
      state.refreshedAt = new Date();
      window.addEventListener('hashchange', function () {
        route();
        if (onHome()) refreshViews(false); // coming back to the list: pick up changes made elsewhere
      });
      startAutoRefresh();
      route();
    } catch (err) {
      renderFatal(err);
    }
  }

  window.addEventListener('load', start);
})();
