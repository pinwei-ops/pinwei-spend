// Step 0 spike: Google sign-in -> ID token -> Apps Script -> verified email.

(function () {
  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  function show(state, html) {
    const box = $('result');
    box.className = 'result ' + state;
    box.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function callApi(action, idToken, payload) {
    // text/plain keeps this a "simple" CORS request: no preflight, which
    // Apps Script web apps cannot answer.
    const res = await fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, idToken, payload: payload || {} }),
      redirect: 'follow',
    });
    return res.json();
  }

  async function onCredential(response) {
    show('pending', 'Verifying with backend…');
    const started = performance.now();
    try {
      const body = await callApi('whoami', response.credential);
      const ms = Math.round(performance.now() - started);
      if (body.ok) {
        show('ok',
          '<strong>PASS</strong> — backend verified: <code>' + escapeHtml(body.data.email) + '</code>' +
          '<br>Round trip: ' + ms + ' ms (backend ' + body.ms + ' ms)');
      } else {
        show('fail', '<strong>FAIL</strong> — ' + escapeHtml(body.error) + ': ' + escapeHtml(body.message));
      }
    } catch (err) {
      show('fail', '<strong>FAIL</strong> — network/CORS error: ' + escapeHtml(err.message));
    }
  }

  function renderEnvironment() {
    const params = new URLSearchParams(location.search);
    const ua = navigator.userAgent;
    const inApp = /Telegram|Zalo|FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(ua);
    $('env').innerHTML =
      '<div><b>Deep link id:</b> ' + escapeHtml(params.get('id') || '(none)') + '</div>' +
      '<div><b>Looks like in-app browser:</b> ' + (inApp ? 'yes' : 'no / unknown') + '</div>' +
      '<div class="ua"><b>User agent:</b> ' + escapeHtml(ua) + '</div>';
  }

  function init() {
    renderEnvironment();
    if (cfg.CLIENT_ID.indexOf('REPLACE_WITH') === 0 || cfg.API_URL.indexOf('REPLACE_WITH') !== -1) {
      show('fail', 'config.js still has placeholder values.');
      return;
    }
    if (!window.google || !google.accounts || !google.accounts.id) {
      show('fail', 'Google Identity Services failed to load (blocked script or in-app browser).');
      return;
    }
    google.accounts.id.initialize({ client_id: cfg.CLIENT_ID, callback: onCredential, auto_select: false });
    google.accounts.id.renderButton($('signin'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
    show('idle', 'Sign in to run the test.');
  }

  window.addEventListener('load', init);
})();
