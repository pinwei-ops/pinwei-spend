// Pin Wei Spend — single-page app. Every piece of data shown here was already
// filtered by the backend for this user; the frontend only lays it out.

(function () {
  const state = {
    user: null,
    ref: null,
    limits: null,
    expenses: [],
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
  function mount(node) { const root = $app(); root.textContent = ''; root.appendChild(node); window.scrollTo(0, 0); }

  function toast(message, kind) {
    const el = h('div.toast' + (kind ? '.' + kind : ''), { role: 'status', text: message });
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 3500);
  }

  // --------------------------------------------------------------- formats

  const money = new Intl.NumberFormat('en-US');
  function fmtMoney(n) { return n === '' || n === null || n === undefined ? '' : money.format(Number(n)) + ' ₫'; }
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

  const STATUS_TONE = {
    NEEDS_INFO: 'warn', PENDING_APPROVAL: 'info', APPROVED: 'info', PARTIAL: 'info',
    PAID: 'ok', CLOSED: 'ok', REJECTED: 'bad', CANCELLED: 'muted', DRAFT: 'muted',
  };
  function statusChip(status) {
    return h('span.chip.' + (STATUS_TONE[status] || 'muted'), { text: label('status', status) });
  }

  // ----------------------------------------------------------------- router

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    if (hash === '/new') return renderForm();
    const m = hash.match(/^\/expense\/(.+)$/);
    if (m) return renderExpense(decodeURIComponent(m[1]));
    return renderHome();
  }
  function go(path) { if (location.hash === '#' + path) route(); else location.hash = path; }

  // ------------------------------------------------------------------ shell

  function header() {
    return h('header.topbar', {}, [
      h('a.brand', { href: '#/', text: 'Pin Wei Spend' }),
      h('div.who', {}, [
        h('span.who-name', { text: state.user.name }),
        h('span.who-role', { text: label('role', state.user.role) }),
      ]),
      h('button.link', { type: 'button', text: 'Sign out', onclick: function () { Api.signOut(); location.reload(); } }),
    ]);
  }

  function page(children) {
    return h('div.page', {}, [header(), h('main.content', {}, children)]);
  }

  // ------------------------------------------------------------------- home

  function expenseCard(e) {
    return h('a.item', { href: '#/expense/' + encodeURIComponent(e.expense_id) }, [
      h('div.item-top', {}, [h('span.amount', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
      h('div.item-mid', { text: categoryLabel(e.expense_category) + (e.supplier_name ? ' · ' + e.supplier_name : e.description ? ' · ' + e.description : '') }),
      h('div.item-meta', {}, [
        h('span', { text: e.expense_id }),
        h('span', { text: fmtDate(e.created_at) }),
        h('span', { text: '→ ' + e.send_to_name }),
      ]),
      e.status === 'NEEDS_INFO' && e.info_request ? h('div.item-note', { text: 'Requested: ' + e.info_request }) : null,
    ]);
  }

  function section(title, items, opts) {
    if (!items.length && !(opts && opts.showEmpty)) return null;
    const head = h('h2.section-title', {}, [title, items.length ? h('span.count', { text: String(items.length) }) : null]);
    const list = items.length ? h('div.list', {}, items.map(expenseCard)) : h('p.empty', { text: opts.empty });
    if (opts && opts.collapsed) return h('details.section', {}, [h('summary', {}, [head]), list]);
    return h('section.section', {}, [head, list]);
  }

  function renderHome() {
    const mine = state.expenses.filter(function (e) { return e.submitted_by === state.user.userId; });
    const byStatus = function (list) { return mine.filter(function (e) { return list.indexOf(e.status) !== -1; }); };
    mount(page([
      h('a.btn.btn-primary.btn-big', { href: '#/new' }, ['+ New expense']),
      section('Needs your info', byStatus(['NEEDS_INFO'])),
      section('In progress', byStatus(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL']), { showEmpty: true, empty: 'Nothing in progress.' }),
      section('Done', byStatus(['PAID', 'CLOSED', 'REJECTED', 'CANCELLED']), { collapsed: true }),
    ]));
  }

  // ----------------------------------------------------------- expense view

  function renderExpense(id) {
    const e = state.expenses.find(function (x) { return x.expense_id === id; });
    if (!e) {
      mount(page([h('p.empty', { text: 'Expense ' + id + ' was not found, or you do not have access to it.' }), h('a.btn', { href: '#/', text: 'Back' })]));
      return;
    }
    const row = function (k, v) { return v ? h('div.kv', {}, [h('span.k', { text: k }), h('span.v', { text: v })]) : null; };
    mount(page([
      h('a.back', { href: '#/', text: '← Back' }),
      h('div.card', {}, [
        h('div.item-top', {}, [h('span.amount.big', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
        row('ID', e.expense_id),
        row('Type', label('request_type', e.request_type)),
        row('Category', categoryLabel(e.expense_category)),
        row('Outlet', e.outlet_code),
        row('Sent to', e.send_to_name),
        row('Submitted by', e.submitted_by_name),
        row('Submitted', fmtDateTime(e.created_at)),
        row('Supplier', e.supplier_name),
        row('Payee', e.payee_name),
        row('Description', e.description),
        row('Due date', fmtDate(e.due_date)),
        row('No document', e.no_doc_reason ? label('no_doc_reason', e.no_doc_reason) : ''),
        row('Balance due', e.status === 'PARTIAL' ? fmtMoney(e.balance_due) : ''),
        row('Info requested', e.info_request),
        row('Rejection reason', e.rejection_reason),
        row('Attachment', e.has_attachment ? 'Yes (viewer comes in the approval step)' : 'None'),
      ]),
    ]));
  }

  // ------------------------------------------------------------------- form

  const DRAFT_FIELDS = ['request_type', 'amount_total', 'expense_category', 'send_to', 'description', 'no_doc_reason',
    'outlet_code', 'supplier_id', 'document_type', 'due_date', 'invoice_no', 'invoice_date', 'is_red_invoice',
    'amount_before_vat', 'vat_amount', 'payment_method', 'payee_name', 'payee_account', 'payee_bank'];

  function draftKey() { return 'pw_draft_' + state.user.userId; }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch (err) { return {}; } }
  function saveDraft(values) { try { localStorage.setItem(draftKey(), JSON.stringify(values)); } catch (err) { /* ignore */ } }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (err) { /* ignore */ } }

  function renderForm() {
    const draft = loadDraft();
    const values = Object.assign({
      request_type: 'INVOICE',
      outlet_code: state.user.outletCode,
      payment_method: 'BANK_TRANSFER',
    }, draft);
    if (!state.ref.outlets.some(function (o) { return o.value === values.outlet_code; })) values.outlet_code = state.ref.outlets[0].value;

    let attachment = null;      // prepared upload
    let preparing = null;       // promise while compressing
    let submitting = false;
    const fieldEls = {};        // field -> wrapper, for error display

    function set(field, value) { values[field] = value; saveDraft(values); clearError(field); }

    function field(name, labelText, control, hint) {
      const wrap = h('div.field', { 'data-field': name }, [
        labelText ? h('label.label', { text: labelText }) : null,
        control,
        hint ? h('p.hint', { text: hint }) : null,
        h('p.error', { hidden: true }),
      ]);
      fieldEls[name] = wrap;
      return wrap;
    }
    function clearError(name) {
      const w = fieldEls[name];
      if (w) { w.classList.remove('has-error'); w.querySelector('.error').hidden = true; }
    }
    function showError(name, message) {
      const w = fieldEls[name] || fieldEls._form;
      w.classList.add('has-error');
      const p = w.querySelector('.error');
      p.textContent = message;
      p.hidden = false;
    }

    function segmented(name, options) {
      const wrap = h('div.segmented', { role: 'radiogroup' });
      function paint() {
        wrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.value === values[name]); b.setAttribute('aria-checked', b.dataset.value === values[name]); });
      }
      options.forEach(function (o) {
        wrap.appendChild(h('button', { type: 'button', role: 'radio', 'data-value': o.value, text: o.label, onclick: function () { set(name, o.value); paint(); if (o.onpick) o.onpick(); } }));
      });
      paint();
      return wrap;
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

    function moneyInput(name) {
      const el = h('input.input.money', { inputmode: 'numeric', autocomplete: 'off', placeholder: '0', oninput: function () {
        const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        el.value = digits ? money.format(Number(digits)) : '';
        set(name, digits);
      } });
      el.value = values[name] ? money.format(Number(values[name])) : '';
      return h('div.money-wrap', {}, [el, h('span.suffix', { text: '₫' })]);
    }

    // --- request type
    const typeField = field('request_type', 'What is this?', segmented('request_type', [
      { value: 'INVOICE', label: 'I have an invoice', onpick: function () { refreshSendTo(); } },
      { value: 'PURCHASE_REQUEST', label: 'Purchase request', onpick: function () { refreshSendTo(true); } },
    ]));

    // --- attachment
    const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: function () { if (fileInput.files[0]) pickFile(fileInput.files[0]); } });
    const preview = h('div.preview');
    const noDocSelect = select('no_doc_reason', state.ref.enums.filter(function (e) { return e.field === 'no_doc_reason'; }), 'Why is there no document?');
    const noDocField = field('no_doc_reason', 'No photo?', noDocSelect);
    const fileField = field('file', 'Invoice photo', h('div', {}, [
      fileInput,
      preview,
      h('button.btn.btn-photo', { type: 'button', onclick: function () { fileInput.click(); } }, ['📷  Take or choose photo']),
    ]), 'A clear photo of the invoice, delivery note or quote. PDF works too.');

    function paintAttachment(status) {
      preview.textContent = '';
      if (status === 'working') preview.appendChild(h('p.hint', { text: 'Preparing photo…' }));
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
      noDocField.hidden = Boolean(attachment) || status === 'working';
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
    const amountField = field('amount_total', 'Total amount (incl. VAT)', moneyInput('amount_total'));
    const catGrid = h('div.chips');
    function paintCats() { catGrid.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.value === values.expense_category); }); }
    state.ref.categories.forEach(function (c) {
      catGrid.appendChild(h('button.chip-btn', { type: 'button', 'data-value': c.value, text: c.label, onclick: function () { set('expense_category', c.value); paintCats(); } }));
    });
    paintCats();
    const catField = field('expense_category', 'Category', catGrid);

    // --- send to
    const sendToList = h('div.radios');
    function refreshSendTo(purchaseDefault) {
      const opts = state.ref.sendTo[values.outlet_code] || [];
      if (purchaseDefault || !opts.some(function (o) { return o.value === values.send_to; })) {
        // Spec §6.1: purchase requests default to an owner; invoices to the accountant.
        const owner = opts.find(function (o) { return o.kind === 'OWNER'; }) || opts.find(function (o) { return o.kind === 'ADMIN'; });
        values.send_to = values.request_type === 'PURCHASE_REQUEST' && owner ? owner.value : (opts[0] || {}).value;
        saveDraft(values);
      }
      sendToList.textContent = '';
      opts.forEach(function (o) {
        const id = 'sendto_' + o.value;
        sendToList.appendChild(h('label.radio', { for: id }, [
          h('input', { type: 'radio', name: 'send_to', id: id, value: o.value, checked: values.send_to === o.value, onchange: function () { set('send_to', o.value); } }),
          h('span', { text: o.label }),
        ]));
      });
    }
    const sendField = field('send_to', 'Send to', sendToList);
    refreshSendTo();

    // --- description
    const desc = h('textarea.input', { rows: 2, placeholder: 'What was bought, and for what?', oninput: function () { set('description', desc.value); } });
    desc.value = values.description || '';
    const descField = field('description', 'Description', desc, 'Required when the category or reason is "Other".');

    // --- more details
    const outletField = state.ref.outlets.length > 1
      ? field('outlet_code', 'Outlet', (function () {
        const el = select('outlet_code', state.ref.outlets);
        el.addEventListener('change', function () { refreshSendTo(); });
        return el;
      })())
      : null;
    const redBox = h('input', { type: 'checkbox', checked: Boolean(values.is_red_invoice), onchange: function () { set('is_red_invoice', redBox.checked); } });
    const more = h('details.more', { open: DRAFT_FIELDS.slice(6).some(function (f) { return f !== 'payment_method' && f !== 'outlet_code' && values[f]; }) }, [
      h('summary', { text: 'More details (optional)' }),
      outletField,
      field('supplier_id', 'Supplier', select('supplier_id', state.ref.suppliers, 'Not listed / none')),
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
      h('p.hint', { text: 'Fill the payee only if the money goes to someone other than the supplier (e.g. a delivery driver). This always needs an approver.' }),
      field('payee_name', 'Payee name', input('payee_name', { autocomplete: 'off' })),
      field('payee_account', 'Payee account number', input('payee_account', { inputmode: 'numeric', autocomplete: 'off' })),
      field('payee_bank', 'Payee bank', input('payee_bank', { autocomplete: 'off' })),
    ]);

    // --- warnings panel + submit
    const formErrors = field('_form', null, h('div'));
    const warnBox = h('div.warnbox', { hidden: true });
    const submitBtn = h('button.btn.btn-primary.btn-big', { type: 'submit', text: 'Submit' });

    async function submit(confirmWarnings) {
      if (submitting) return;
      submitting = true;
      warnBox.hidden = true;
      Object.keys(fieldEls).forEach(clearError);
      submitBtn.disabled = true;
      try {
        if (preparing) { submitBtn.textContent = 'Preparing photo…'; await preparing; }
        submitBtn.textContent = attachment ? 'Uploading…' : 'Submitting…';
        const payload = {};
        DRAFT_FIELDS.forEach(function (f) { if (values[f] !== undefined) payload[f] = values[f]; });
        if (attachment) { payload.file = { name: attachment.name, mime: attachment.mime, base64: attachment.base64, sha256: attachment.sha256 }; payload.no_doc_reason = ''; }
        payload.confirmWarnings = Boolean(confirmWarnings);
        const res = await Api.call('submitExpense', payload);
        if (!res.saved) { showWarnings(res.warnings); return; }
        clearDraft();
        state.expenses.unshift(res.expense);
        toast('Submitted ' + res.expense.expense_id, 'ok');
        go('/');
      } catch (err) {
        if (err.code === 'VALIDATION' && err.details.length) {
          err.details.forEach(function (d) { showError(d.field in fieldEls ? d.field : '_form', d.message); });
          if (err.details.some(function (d) { return more.contains(fieldEls[d.field] || null); })) more.open = true;
        } else {
          showError('_form', err.message || 'Something went wrong. Please try again.');
        }
        const first = form.querySelector('.has-error');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        h('button.btn', { type: 'button', text: 'Go back', onclick: function () { warnBox.hidden = true; } }),
        h('button.btn.btn-primary', { type: 'button', text: 'Submit anyway', onclick: function () { submit(true); } }),
      ]));
      warnBox.hidden = false;
      warnBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const form = h('form.form', { novalidate: true, onsubmit: function (ev) { ev.preventDefault(); submit(false); } }, [
      h('a.back', { href: '#/', text: '← Cancel' }),
      h('h1.title', { text: 'New expense' }),
      typeField, fileField, noDocField, amountField, catField, sendField, descField, more,
      formErrors, warnBox,
      h('div.sticky-submit', {}, [submitBtn]),
    ]);
    paintAttachment();
    mount(page([form]));
  }

  // -------------------------------------------------------------- bootstrap

  function renderSignIn(message) {
    const slot = h('div.signin-slot');
    mount(h('div.page', {}, [h('main.content.center', {}, [
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
      state.expenses = data.expenses;
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      renderFatal(err);
    }
  }

  window.addEventListener('load', start);
})();
