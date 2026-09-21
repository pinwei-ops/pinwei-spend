// Pin Wei Spend — single-page app. Every piece of data shown here was already
// filtered by the backend for this user; the frontend only lays it out.

(function () {
  const state = {
    user: null,
    ref: null,
    limits: null,
    views: { mine: [], to_approve: [] },
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

  const APPROVER_ROLES = ['OUTLET_MANAGER', 'OWNER', 'ADMIN'];
  let homeTab = null;

  /** Replaces or inserts an expense in a view list (keeps local state fresh without a reload). */
  function upsert(view, item) {
    const list = state.views[view];
    const i = list.findIndex(function (x) { return x.expense_id === item.expense_id; });
    if (i === -1) list.unshift(item); else list[i] = item;
  }
  function removeFrom(view, id) {
    state.views[view] = state.views[view].filter(function (x) { return x.expense_id !== id; });
  }

  function expenseCard(e, showSubmitter) {
    return h('a.item', { href: '#/expense/' + encodeURIComponent(e.expense_id) }, [
      h('div.item-top', {}, [h('span.amount', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
      h('div.item-mid', { text: categoryLabel(e.expense_category) + (e.supplier_name ? ' · ' + e.supplier_name : e.description ? ' · ' + e.description : '') }),
      h('div.item-meta', {}, [
        h('span', { text: e.expense_id }),
        h('span', { text: fmtDate(e.created_at) }),
        showSubmitter ? h('span', { text: e.submitted_by_name + ' · ' + e.outlet_code }) : h('span', { text: '→ ' + e.send_to_name }),
        e.due_date ? h('span.due', { text: 'Due ' + fmtDate(e.due_date) }) : null,
      ]),
      e.status === 'NEEDS_INFO' && e.info_request ? h('div.item-note', { text: 'Requested: ' + e.info_request }) : null,
      e.status === 'REJECTED' && e.rejection_reason ? h('div.item-note.bad', { text: 'Rejected: ' + e.rejection_reason }) : null,
    ]);
  }

  function section(title, items, opts) {
    opts = opts || {};
    if (!items.length && !opts.showEmpty) return null;
    const head = h('h2.section-title', {}, [title, items.length ? h('span.count', { text: String(items.length) }) : null]);
    const list = items.length ? h('div.list', {}, items.map(function (e) { return expenseCard(e, opts.showSubmitter); })) : h('p.empty', { text: opts.empty });
    if (opts.collapsed) return h('details.section', {}, [h('summary', {}, [head]), list]);
    return h('section.section', {}, [head, list]);
  }

  function renderHome() {
    const isApprover = APPROVER_ROLES.indexOf(state.user.role) !== -1;
    const toApprove = state.views.to_approve;
    if (!homeTab) homeTab = isApprover && toApprove.length ? 'approve' : 'mine';

    const mine = state.views.mine;
    const byStatus = function (list) { return mine.filter(function (e) { return list.indexOf(e.status) !== -1; }); };
    const needInfo = byStatus(['NEEDS_INFO']).length;
    const tabs = isApprover ? h('div.tabs', { role: 'tablist' }, [
      h('button.tab' + (homeTab === 'approve' ? '.on' : ''), { type: 'button', role: 'tab', onclick: function () { homeTab = 'approve'; renderHome(); } },
        ['To approve', toApprove.length ? h('span.count', { text: String(toApprove.length) }) : null]),
      h('button.tab' + (homeTab === 'mine' ? '.on' : ''), { type: 'button', role: 'tab', onclick: function () { homeTab = 'mine'; renderHome(); } },
        ['My expenses', needInfo ? h('span.count', { text: String(needInfo) }) : null]),
    ]) : null;

    const body = homeTab === 'approve'
      ? [section('Waiting for your decision', toApprove, { showEmpty: true, empty: 'Nothing waiting for you.', showSubmitter: true })]
      : [
        h('a.btn.btn-primary.btn-big', { href: '#/new' }, ['+ New expense']),
        section('Needs your info', byStatus(['NEEDS_INFO'])),
        section('In progress', byStatus(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL']), { showEmpty: true, empty: 'Nothing in progress.' }),
        section('Done', byStatus(['PAID', 'CLOSED', 'REJECTED', 'CANCELLED']), { collapsed: true }),
      ];
    mount(page([tabs].concat(body)));
  }

  // ----------------------------------------------------------- expense view

  function loading(text) {
    return h('div.center-block', {}, [h('div.spinner'), h('p.sub', { text: text || 'Loading…' })]);
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
      return h('a.btn.btn-doc', { href: url, target: '_blank', rel: 'noopener' }, ['📄  Open PDF document']);
    }
    const img = h('img.doc-img', { src: url, alt: 'Invoice', onclick: function () { openViewer(url); } });
    return h('div.doc', {}, [img, h('p.hint.center-text', { text: 'Tap the photo to zoom' })]);
  }

  function openViewer(url) {
    const viewer = h('div.viewer');
    const close = function () { viewer.remove(); };
    viewer.addEventListener('click', function (ev) { if (ev.target === viewer) close(); });
    viewer.appendChild(h('img', { src: url, alt: 'Invoice, full size' }));
    viewer.appendChild(h('button.viewer-close', { type: 'button', text: '✕ Close', onclick: close }));
    document.body.appendChild(viewer);
  }

  const ACTION_LABEL = {
    SUBMIT: 'Submitted', SUBMIT_DIRECT_TO_ACCOUNTANT: 'Submitted to accountant', APPROVE: 'Approved',
    REJECT: 'Rejected', REQUEST_INFO: 'Asked for more info', RESUBMIT: 'Resubmitted',
  };

  function timelineView(items) {
    // One line per action; the field-level rows of the same action are folded in.
    const lines = [];
    items.forEach(function (t) {
      const last = lines[lines.length - 1];
      if (last && last.at === t.at && last.action === t.action) { if (t.field) last.fields.push(t); return; }
      lines.push({ at: t.at, by: t.by, action: t.action, fields: t.field ? [t] : [] });
    });
    const isReason = function (f) { return f.field === 'info_request' || f.field === 'rejection_reason'; };
    return h('ol.timeline', {}, lines.map(function (l) {
      const note = l.fields.filter(isReason).map(function (f) { return '"' + f.value + '"'; }).join(' ');
      const changed = l.fields.filter(function (f) { return !isReason(f); }).map(function (f) { return f.field.replace(/_/g, ' '); }).join(', ');
      return h('li', {}, [
        h('span.tl-what', { text: (ACTION_LABEL[l.action] || l.action) + ' · ' + l.by }),
        h('span.tl-when', { text: fmtDateTime(l.at) }),
        note ? h('span.tl-note', { text: note }) : null,
        changed ? h('span.tl-when', { text: 'Changed: ' + changed }) : null,
      ]);
    }));
  }

  async function renderExpense(id) {
    const backLink = function () { return h('a.back', { href: '#/', text: '← Back' }); };
    mount(page([backLink(), loading()]));
    let e;
    try {
      e = await Api.call('getExpense', { id: id });
    } catch (err) {
      mount(page([backLink(), h('p.empty', { text: err.message })]));
      return;
    }
    if (location.hash !== '#/expense/' + encodeURIComponent(id)) return; // user navigated away meanwhile
    state.detail = e;

    const row = function (k, v) { return v ? h('div.kv', {}, [h('span.k', { text: k }), h('span.v', { text: v })]) : null; };
    const hasVat = e.amount_before_vat !== '' && e.amount_before_vat !== undefined && e.amount_before_vat !== null;
    mount(page([
      backLink(),
      attachmentView(e.attachment),
      e.flags.length ? h('div.flags', {}, e.flags.map(function (f) { return h('div.flag', { text: '⚠ ' + f.message }); })) : null,
      h('div.card', {}, [
        h('div.item-top', {}, [h('span.amount.big', { text: fmtMoney(e.amount_total) }), statusChip(e.status)]),
        h('div.item-mid', { text: categoryLabel(e.expense_category) + ' · ' + label('request_type', e.request_type) }),
        row('Submitted by', e.submitted_by_name + ' · ' + e.outlet_code),
        row('Submitted', fmtDateTime(e.created_at)),
        row('Sent to', e.send_to_name),
        row('Supplier', e.supplier ? e.supplier.name + (e.supplier.tax_id ? ' · Tax ID ' + e.supplier.tax_id : '') : ''),
        row('Payee', [e.payee_name, e.payee_bank, e.payee_account_masked].filter(Boolean).join(' · ')),
        row('Description', e.description),
        row('Due date', fmtDate(e.due_date)),
        row('Document', e.document_type ? e.document_type.replace(/_/g, ' ').toLowerCase() : ''),
        row('Invoice', [e.invoice_no, fmtDate(e.invoice_date), e.is_red_invoice === true ? 'VAT red invoice' : ''].filter(Boolean).join(' · ')),
        row('Before VAT', hasVat ? fmtMoney(e.amount_before_vat) + ' + VAT ' + fmtMoney(e.vat_amount) : ''),
        row('Payment method', e.payment_method ? label('payment_method', e.payment_method) : ''),
        row('Info requested', e.info_request),
        row('Rejection reason', e.rejection_reason),
        row('Decided by', e.approver_name),
        row('Balance due', e.status === 'PARTIAL' ? fmtMoney(e.balance_due) : ''),
        row('ID', e.expense_id),
      ]),
      e.can.decide ? decisionPanel(e) : null,
      e.can.resubmit ? h('a.btn.btn-primary.btn-big', { href: '#/edit/' + encodeURIComponent(e.expense_id) }, ['Edit and resubmit']) : null,
      h('h2.section-title', { text: 'History' }),
      timelineView(e.timeline),
    ]));
  }

  function decisionPanel(e) {
    const panel = h('div.decide');
    const reasonBox = h('textarea.input', { rows: 3 });
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
        const res = await Api.call('decide', { id: e.expense_id, decision: decision, reason: reason });
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
      panel.appendChild(h('label.label', { text: reject ? 'Reason for rejecting (required)' : 'What is missing? (required)' }));
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

  // ------------------------------------------------------------------- form

  const DRAFT_FIELDS = ['request_type', 'amount_total', 'expense_category', 'send_to', 'description', 'no_doc_reason',
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
        mount(page([h('a.back', { href: '#/', text: '← Back' }), h('p.empty', { text: err.message })]));
        return;
      }
    }
    if (!e.can.resubmit || !e.editable) { go('/expense/' + encodeURIComponent(id)); return; }
    renderForm(e);
  }

  /**
   * New-expense form, or (with `existing`) the edit-and-resubmit form after the
   * approver asked for more info. Drafts are only kept for new expenses.
   */
  function renderForm(existing) {
    const editing = Boolean(existing);
    const values = editing
      ? Object.assign({}, existing.editable)
      : Object.assign({ request_type: 'INVOICE', outlet_code: state.user.outletCode, payment_method: 'BANK_TRANSFER' }, loadDraft());
    if (!state.ref.outlets.some(function (o) { return o.value === values.outlet_code; })) values.outlet_code = state.ref.outlets[0].value;

    let attachment = null;      // newly prepared upload
    // The photo already on file (edit mode) stays unless replaced or removed.
    let keptAttachment = editing && existing.attachment && !existing.attachment.error ? existing.attachment : null;
    let removedAttachment = false;
    let preparing = null;       // promise while compressing
    let submitting = false;
    const fieldEls = {};        // field -> wrapper, for error display

    function set(field, value) { values[field] = value; if (!editing) saveDraft(values); clearError(field); }

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
      { value: 'INVOICE', label: 'I have an invoice', onpick: function () { if (!editing) refreshSendTo(); } },
      { value: 'PURCHASE_REQUEST', label: 'Purchase request', onpick: function () { if (!editing) refreshSendTo(true); } },
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
      noDocField.hidden = Boolean(attachment || keptAttachment) || status === 'working';
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
    const sendField = editing
      ? field('send_to', 'Goes back to', h('div.readonly', { text: existing.send_to_name }), 'The person who asked for more info reviews it again.')
      : field('send_to', 'Send to', sendToList);
    if (!editing) refreshSendTo();

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
        if (!attachment && keptAttachment) payload.no_doc_reason = '';
        payload.confirmWarnings = Boolean(confirmWarnings);
        if (editing) { payload.id = existing.expense_id; payload.removeAttachment = removedAttachment && !attachment; }
        const res = await Api.call(editing ? 'resubmitExpense' : 'submitExpense', payload);
        if (!res.saved) { showWarnings(res.warnings); return; }
        if (!editing) clearDraft();
        state.detail = null;
        upsert('mine', res.expense);
        toast((editing ? 'Resubmitted ' : 'Submitted ') + res.expense.expense_id, 'ok');
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
      h('a.back', { href: editing ? '#/expense/' + encodeURIComponent(existing.expense_id) : '#/', text: '← Cancel' }),
      h('h1.title', { text: editing ? 'Edit and resubmit ' + existing.expense_id : 'New expense' }),
      editing && existing.info_request ? h('div.item-note', { text: 'Requested: ' + existing.info_request }) : null,
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
      state.views = data.views;
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      renderFatal(err);
    }
  }

  window.addEventListener('load', start);
})();
