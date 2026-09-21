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

  function decodeExp(jwt) {
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return Number(payload.exp) || 0;
    } catch (err) {
      return 0;
    }
  }

  function storeToken(jwt) {
    token = jwt;
    tokenExp = decodeExp(jwt);
    try { sessionStorage.setItem(TOKEN_KEY, jwt); } catch (err) { /* private mode */ }
  }

  function loadStoredToken() {
    try {
      const jwt = sessionStorage.getItem(TOKEN_KEY);
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
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* private mode */ }
    google.accounts.id.disableAutoSelect();
  }

  async function post(action, idToken, payload) {
    const res = await fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: idToken, payload: payload || {} }),
    });
    if (!res.ok) throw new Error('Server error (HTTP ' + res.status + ')');
    return res.json();
  }

  /**
   * Calls a backend action. Resolves with `data`, or rejects with an Error
   * carrying .code and .details from the backend.
   */
  async function call(action, payload) {
    let body = await post(action, await getToken(), payload);
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

  return { init: init, renderButton: renderButton, waitForSignIn: waitForSignIn, call: call, signOut: signOut, hasToken: tokenValid };
})();
