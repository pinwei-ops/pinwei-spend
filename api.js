// Google sign-in + backend calls.
//
// The ID token lives ~1 h. Before each call we check its expiry and, if it is
// close, get a fresh one silently (One Tap auto-select). If Google needs the
// user to click, a sign-in overlay appears on top of the current screen, so a
// half-filled form is never lost.

window.Api = (function () {
  const cfg = window.APP_CONFIG;
  const TOKEN_KEY = 'pw_id_token';
  const REFRESH_MARGIN_S = 120;

  let token = null;
  let tokenExp = 0;
  let waiters = [];
  let overlayEl = null;

  function claims(jwt) {
    try {
      return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (err) {
      return {};
    }
  }
  function decodeExp(jwt) { return Number(claims(jwt).exp) || 0; }

  /** The signed-in Google address (from the token Google gave this tab), or ''. */
  function currentEmail() {
    return token ? String(claims(token).email || '').toLowerCase() : '';
  }

  // Google's sign-in lasts about an hour. It is kept for that hour (also after the
  // tab is closed), so reopening the app doesn't wait for Google again. Sign out clears it.
  function storeToken(jwt) {
    token = jwt;
    tokenExp = decodeExp(jwt);
    try { localStorage.setItem(TOKEN_KEY, jwt); } catch (err) { /* private mode */ }
  }

  function loadStoredToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);   // older versions kept it per tab
      const jwt = localStorage.getItem(TOKEN_KEY);
      if (jwt) { token = jwt; tokenExp = decodeExp(jwt); }
    } catch (err) { /* private mode */ }
  }

  function tokenValid() {
    return token && tokenExp - Date.now() / 1000 > REFRESH_MARGIN_S;
  }

  function onCredential(response) {
    storeToken(response.credential);
    hideOverlay();
    const pending = waiters;
    waiters = [];
    pending.forEach(function (resolve) { resolve(token); });
  }

  function showOverlay(message) {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.className = 'overlay';
    const card = document.createElement('div');
    card.className = 'overlay-card';
    const p = document.createElement('p');
    p.textContent = message;
    const slot = document.createElement('div');
    slot.className = 'signin-slot';
    card.appendChild(p);
    card.appendChild(slot);
    overlayEl.appendChild(card);
    document.body.appendChild(overlayEl);
    google.accounts.id.renderButton(slot, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
  }

  function hideOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  /** Resolves with a valid token, asking Google silently first, then the user. */
  function getToken(message) {
    if (tokenValid()) return Promise.resolve(token);
    return new Promise(function (resolve) {
      waiters.push(resolve);
      if (waiters.length > 1) return;
      google.accounts.id.prompt(function (n) {
        if (n.isNotDisplayed() || n.isSkippedMoment()) showOverlay(message || 'Please sign in again to continue.');
      });
    });
  }

  function init() {
    loadStoredToken();
    google.accounts.id.initialize({
      client_id: cfg.CLIENT_ID,
      callback: onCredential,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
    });
  }

  function renderButton(el) {
    google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
  }

  function waitForSignIn() {
    return new Promise(function (resolve) {
      if (tokenValid()) return resolve(token);
      waiters.push(resolve);
      google.accounts.id.prompt();
    });
  }

  function signOut() {
    token = null;
    tokenExp = 0;
    try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* private mode */ }
    google.accounts.id.disableAutoSelect();
  }

  /** One request, given up after 90 s; a dropped connection is reported plainly (the form is kept). */
  async function post(action, idToken, payload) {
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 90000) : null;
    let res;
    try {
      const body = JSON.stringify({ action: action, idToken: idToken, payload: payload || {} });
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
        // Small requests (decisions, not photo uploads) still reach the server if the tab is closed right away.
        keepalive: body.length < 60000,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (err) {
      const e = new Error('No connection. Your form is kept: try again when you have signal.');
      e.code = 'NETWORK';
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error('The server is not responding (HTTP ' + res.status + '). Try again in a minute.');
    try {
      return await res.json();
    } catch (err) {
      const e = new Error('The server is not responding properly. Try again in a minute; if it keeps happening, tell the admin.');
      e.code = 'BAD_RESPONSE';
      throw e;
    }
  }

  /**
   * Calls a backend action. Resolves with `data`, or rejects with an Error
   * carrying .code and .details from the backend.
   */
  const debug = /[?&]debug=1/.test(location.search) || (function () { try { return sessionStorage.getItem('pw_debug') === '1'; } catch (e) { return false; } })();
  if (debug) { try { sessionStorage.setItem('pw_debug', '1'); } catch (e) { /* ok */ } }
  let debugBox = null;
  function logTiming(action, totalMs, serverMs) {
    const line = action + ': ' + (totalMs / 1000).toFixed(1) + ' s' + (serverMs ? ' (server ' + (serverMs / 1000).toFixed(1) + ' s)' : '');
    if (window.console) console.info('[timing] ' + line);
    if (!debug) return;
    if (!debugBox) {
      debugBox = document.createElement('div');
      debugBox.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;max-width:70vw;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font:12px/1.4 monospace;pointer-events:none;white-space:pre';
      document.body.appendChild(debugBox);
    }
    debugBox.textContent = (line + '\n' + debugBox.textContent).split('\n').slice(0, 6).join('\n');
  }

  async function call(action, payload) {
    const t0 = Date.now();
    const tok = await getToken();
    const tSend = Date.now();
    let body = await post(action, tok, payload);
    logTiming(action + (tSend - t0 > 300 ? ' [sign-in ' + ((tSend - t0) / 1000).toFixed(1) + ' s]' : ''), Date.now() - t0, body && body.ms);
    if (!body.ok && /^AUTH_(INVALID_TOKEN|EXPIRED|MISSING_TOKEN)$/.test(body.error)) {
      token = null;
      body = await post(action, await getToken('Your sign-in expired. Sign in to continue — your form is kept.'), payload);
    }
    if (!body.ok) {
      const err = new Error(body.message || body.error);
      err.code = body.error;
      err.details = body.details || [];
      throw err;
    }
    return body.data;
  }

  return { init: init, renderButton: renderButton, waitForSignIn: waitForSignIn, call: call, signOut: signOut, hasToken: tokenValid, currentEmail: currentEmail };
})();
