/* Prototype Vault interaction tracker. Injected into prototype pages on the content origin.
 * Always: tells the tester shell (parent window, main origin) which screen the tester is on, so tasks and feedback can refer to it.
 * When recording is on: clicks (element description + relative position), navigation, input focus (field type only), scroll depth, JS errors, custom events.
 * Typed text is recorded ONLY when the share enables "record typed text" (never for password fields, never keystrokes: the value on change). */
(function () {
  var cfg = window.__VAULT_CFG || {};
  var q = [],
    start = Date.now(),
    lastScroll = 0,
    lastHref = location.href;
  function rel() {
    return location.pathname.replace(cfg.appBase, '') + location.search + location.hash;
  }
  function tell() {
    try {
      if (parent !== window) parent.postMessage({ vault: 'location', path: rel() }, cfg.shell || '*');
    } catch (e) {}
  }
  function push(type, data) {
    if (!cfg.record) return;
    q.push({ t: Date.now() - start, type: type, path: rel(), data: data || {} });
    if (q.length >= 50) flush();
  }
  function flush(beacon) {
    if (!q.length) return;
    var body = JSON.stringify(q.splice(0));
    if (beacon && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: 'application/json' }));
        return;
      } catch (e) {}
    }
    try {
      fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(function () {});
    } catch (e) {}
  }
  function desc(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase(),
      s = tag;
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string')
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    if (/^(input|textarea|select)$/.test(tag)) {
      var t = el.getAttribute('type') || tag;
      s += '[' + t + (el.name ? ':' + el.name : '') + ']';
      if (el.placeholder) s += ' "' + el.placeholder.slice(0, 40) + '"';
      return s.slice(0, 160);
    }
    var label =
      el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (label) s += ' "' + label.slice(0, 50) + '"';
    return s.slice(0, 160);
  }
  document.addEventListener(
    'click',
    function (e) {
      var el = e.target;
      if (el && el.closest) {
        var hit = el.closest('a,button,[role=button],[role=tab],[role=menuitem],[onclick],input,select,label,summary');
        if (!hit) {
          var n = el;
          while (n && n !== document.body && !hit) {
            if (typeof n.onclick === 'function' || (n.getAttribute && n.getAttribute('tabindex') !== null)) hit = n;
            n = n.parentElement;
          }
        }
        el = hit || el.closest('li,[class*=card],[class*=item],[class*=tile]') || e.target;
      }
      push('click', {
        target: desc(el),
        x: Math.round((e.clientX / window.innerWidth) * 1000) / 10,
        y: Math.round((e.clientY / window.innerHeight) * 1000) / 10,
      });
    },
    true
  );
  document.addEventListener(
    'focusin',
    function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) push('focus', { target: desc(e.target) });
    },
    true
  );
  document.addEventListener(
    'submit',
    function (e) {
      push('submit', { target: desc(e.target) });
    },
    true
  );
  if (cfg.recordText)
    document.addEventListener(
      'change',
      function (e) {
        var el = e.target;
        if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
        var type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'password' || el.getAttribute('autocomplete') === 'cc-number') return;
        var v = type === 'checkbox' || type === 'radio' ? (el.checked ? 'on' : 'off') : String(el.value || '');
        push('input', { target: desc(el), value: v.slice(0, 200) });
      },
      true
    );
  function nav(how) {
    if (location.href === lastHref) return;
    lastHref = location.href;
    tell();
    setTimeout(function () {
      push('navigate', { title: document.title.slice(0, 100), how: how });
    }, 0);
  }
  window.addEventListener('hashchange', function () {
    nav('hash');
  });
  window.addEventListener('popstate', function () {
    nav('history');
  });
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (!orig) return;
    history[m] = function () {
      var r = orig.apply(this, arguments);
      nav(m);
      return r;
    };
  });
  window.addEventListener(
    'scroll',
    function () {
      var h = document.documentElement,
        depth = Math.round(((window.scrollY + window.innerHeight) / Math.max(1, h.scrollHeight)) * 100);
      if (depth - lastScroll >= 25 || (depth >= 100 && lastScroll < 100)) {
        lastScroll = depth;
        push('scroll', { depth: Math.min(100, depth) });
      }
    },
    { passive: true }
  );
  window.addEventListener('error', function (e) {
    push('error', { message: String(e.message || '').slice(0, 200) });
  });
  window.vault = {
    event: function (name, data) {
      push(
        'custom:' + String(name).slice(0, 50),
        data && typeof data === 'object' ? data : { value: String(data == null ? '' : data).slice(0, 200) }
      );
    },
  };
  function pageview() {
    tell();
    push('pageview', { title: document.title.slice(0, 100), w: window.innerWidth, h: window.innerHeight });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageview);
  else pageview();
  setInterval(flush, 3000);
  window.addEventListener('pagehide', function () {
    flush(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) flush(true);
  });
})();
