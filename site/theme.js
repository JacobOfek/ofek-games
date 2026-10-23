/* Light / dark switch shared by the home page, the dashboard and every game.
   <script src="/theme.js" data-native="both|dark|light" [data-default="dark|light"]></script>  — first thing in <head>.
   native="both":  the page has its own light and dark colours (keyed on html[data-theme]); we just set the attribute.
   native="dark"/"light": the page has one look; the other mode is made by inverting the colours (photos stay as they are).
   The choice is remembered for the whole site (localStorage "ofek-theme"), so all games follow it.
   Canvas games that read their colours once listen to the system colour-scheme query; we capture those listeners
   and call them on every switch, so they repaint in the new colours without a reload. */
(() => {
  const me = document.currentScript, cfg = (me && me.dataset) || {};
  const native = cfg.native || 'dark', K = 'ofek-theme';
  const get = () => { try { return localStorage.getItem(K); } catch (e) { return null; } };
  const set = v => { try { localStorage.setItem(K, v); } catch (e) {} };
  const sysQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const def = () => cfg.default || (native === 'both' ? (sysQ && sysQ.matches ? 'dark' : 'light') : native);
  const mode = () => { const p = get(); return p === 'light' || p === 'dark' ? p : def(); };

  // colour-scheme listeners the game registers (so a switch can make it re-read its colours)
  const hooks = [];
  if (window.matchMedia) {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = q => {
      const m = mm(q);
      if (/prefers-color-scheme/.test(q)) {
        const add = m.addEventListener ? m.addEventListener.bind(m) : null, old = m.addListener ? m.addListener.bind(m) : null;
        if (add) m.addEventListener = (t, f, o) => { if (t === 'change') hooks.push(f); return add(t, f, o); };
        if (old) m.addListener = f => { hooks.push(f); return old(f); };
      }
      return m;
    };
  }

  const css = document.createElement('style');
  css.textContent =
    'html.ofk-inv{filter:invert(1) hue-rotate(180deg)}' +
    'html.ofk-inv img,html.ofk-inv video,html.ofk-inv picture{filter:invert(1) hue-rotate(180deg)}' +
    '#ofkTheme{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(16,18,24,.55);color:#fff;' +
    'display:grid;place-items:center;padding:0;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:.8;font:inherit}' +
    '#ofkTheme:hover,#ofkTheme:focus-visible{opacity:1}#ofkTheme svg{width:20px;height:20px}' +
    '#ofkTheme.inbar{background:transparent;border:0;color:inherit;opacity:1;-webkit-backdrop-filter:none;backdrop-filter:none}' +
    '#ofkTheme.slot{background:var(--panel,#191C25);border:1px solid var(--line,rgba(255,255,255,.12));color:var(--ink,#ECEEF3);opacity:1;border-radius:999px;-webkit-backdrop-filter:none;backdrop-filter:none}';
  document.head ? document.head.appendChild(css) : document.documentElement.appendChild(css);

  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  let btn = null;
  function apply() {
    const m = mode(), h = document.documentElement;
    if (native === 'both') { h.dataset.theme = m; h.style.colorScheme = m; h.classList.remove('ofk-inv'); }
    else h.classList.toggle('ofk-inv', m !== native);
    if (btn) { btn.innerHTML = m === 'dark' ? SUN : MOON; const t = m === 'dark' ? 'מצב מואר' : 'מצב חשוך'; btn.title = t; btn.setAttribute('aria-label', t); }
  }
  apply();

  function toggle(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    set(mode() === 'dark' ? 'light' : 'dark'); apply();
    hooks.forEach(f => { try { f({ matches: mode() === 'dark', media: '(prefers-color-scheme: dark)' }); } catch (err) {} });
    window.dispatchEvent(new Event('resize'));   // redraw canvases right away
    if (btn) btn.blur();
  }
  sysQ && (sysQ.addEventListener ? sysQ.addEventListener('change', apply) : sysQ.addListener(apply));
  addEventListener('storage', ev => { if (ev.key === K) apply(); });   // another tab switched

  function place() {
    btn = document.createElement('button'); btn.id = 'ofkTheme'; btn.type = 'button';
    ['pointerdown', 'touchstart', 'mousedown'].forEach(t => btn.addEventListener(t, e => e.stopPropagation(), { passive: true }));
    btn.addEventListener('click', toggle);
    const slot = document.querySelector('[data-theme-slot]'), bar = document.getElementById('homeBtn'), fl = document.getElementById('siteHome');
    if (slot) { btn.classList.add('slot'); slot.appendChild(btn); }
    else if (bar) { btn.className = bar.className; btn.classList.add('inbar'); bar.after(btn); }
    else if (fl) {   // next to the floating home button, same corner
      const cs = getComputedStyle(fl), r = fl.getBoundingClientRect(), right = r.left > innerWidth / 2;
      btn.style.cssText = `position:${cs.position};z-index:${cs.zIndex};top:${cs.top};bottom:${cs.bottom};` +
        (right ? `right:${innerWidth - r.left + 8}px` : `left:${r.right + 8}px`);
      fl.after(btn);
    } else { btn.style.cssText = 'position:fixed;z-index:2147482000;top:calc(env(safe-area-inset-top,0px) + 8px);left:calc(env(safe-area-inset-left,0px) + 8px)'; document.body.appendChild(btn); }
    apply();
  }
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', place) : place();
  window.OFEK_THEME = { mode, toggle };
})();
