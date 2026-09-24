// Embedded in-app browsers (Zalo, Facebook, Instagram, Line…) block Google
// sign-in. Detect them and offer a way out to the real browser, keeping the
// full URL (including ?id=) so the user lands on the same expense.
//
// Telegram on Android opens links in a Chrome Custom Tab, which is real
// Chrome, so it is not caught here and sign-in works.

window.InApp = (function () {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  function detect() {
    if (/Zalo/i.test(ua)) return 'Zalo';
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/\bLine\//i.test(ua)) return 'Line';
    if (isAndroid && /; wv\)/.test(ua)) return 'an in-app browser';
    // iPhone apps' own browsers (Telegram's among them) are WebViews: no "Safari/" in the user agent.
    // Safari, Chrome/Edge/Firefox for iOS and the in-app Safari view all have it; a home-screen app sets standalone.
    if (isIOS && !/Safari\//.test(ua) && !navigator.standalone) return 'this app';
    return null;
  }

  // Android intent URL: opens the same https URL in Chrome; if Chrome is
  // missing, Android falls back to the default browser via browser_fallback_url.
  function androidIntentUrl(url) {
    const u = new URL(url);
    return 'intent://' + u.host + u.pathname + u.search + u.hash +
      '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
      encodeURIComponent(url) + ';end';
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(input);
      return ok;
    }
  }

  /**
   * Renders the "open in browser" panel into `container`.
   * onContinue() is called if the user chooses to try signing in here anyway.
   */
  function renderEscape(container, appName, onContinue) {
    const url = location.href;
    const iosHint = 'Tap the ••• menu at the top right, then "Open in browser".';
    container.innerHTML =
      '<div class="inapp">' +
        '<img src="logo-96.png" alt="" width="48" height="48" style="display:block;margin:0 auto 12px">' +
        '<p class="inapp-title">Open Pin Wei Spend in your browser</p>' +
        '<p>Google sign-in does not work inside ' + appName + '.</p>' +
        (isAndroid ? '<a class="btn btn-primary" id="inapp-open">Open in Chrome</a>' : '') +
        (isIOS ? '<p class="inapp-hint">' + iosHint + '</p>' : '') +
        '<button type="button" class="btn' + (isAndroid ? '' : ' btn-primary') + '" id="inapp-copy">Copy link</button>' +
        '<p class="inapp-hint" id="inapp-copied" hidden>Link copied. Paste it into Chrome or Safari.</p>' +
        '<button type="button" class="btn btn-link" id="inapp-continue">Try signing in here anyway</button>' +
      '</div>';
    const open = container.querySelector('#inapp-open');
    if (open) open.href = androidIntentUrl(url);
    container.querySelector('#inapp-copy').addEventListener('click', async function () {
      const ok = await copy(url);
      const note = container.querySelector('#inapp-copied');
      note.textContent = ok ? 'Link copied. Paste it into Chrome or Safari.' : url;
      note.hidden = false;
    });
    container.querySelector('#inapp-continue').addEventListener('click', onContinue);
  }

  return { detect: detect, renderEscape: renderEscape };
})();
