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

  function floatNextToHome(fl) {   // the switch floats next to the floating home button, same corner
    const cs = getComputedStyle(fl), r = fl.getBoundingClientRect(), right = r.left > innerWidth / 2;
    btn.style.cssText = `position:${cs.position};z-index:${cs.zIndex};top:${cs.top};bottom:${cs.bottom};` +
      (right ? `right:${innerWidth - r.left + 8}px` : `left:${r.right + 8}px`);
  }
  function place() {
    btn = document.createElement('button'); btn.id = 'ofkTheme'; btn.type = 'button';
    ['pointerdown', 'touchstart', 'mousedown'].forEach(t => btn.addEventListener(t, e => e.stopPropagation(), { passive: true }));
    btn.addEventListener('click', toggle);
    const slot = document.querySelector('[data-theme-slot]'), bar = document.getElementById('homeBtn'), fl = document.getElementById('siteHome');
    if (slot) { btn.classList.add('slot'); slot.appendChild(btn); }
    else if (bar) { btn.className = bar.className; btn.classList.add('inbar'); bar.after(btn); }
    else if (fl) { fl.after(btn); floatNextToHome(fl); }
    else { btn.style.cssText = 'position:fixed;z-index:2147482000;top:calc(env(safe-area-inset-top,0px) + 8px);left:calc(env(safe-area-inset-left,0px) + 8px)'; document.body.appendChild(btn); }
    apply();
    layout();
  }

  /* ---------- top bars: a fixed place for every button and indicator ----------
     data-dock="selector|selector": the home and light/dark buttons sit inside the first of these that is on screen
       (a game's own top bar), instead of floating over it; when none is on screen they float in their corner.
     data-bars='[{"bar":"header","shrink":".stat","within":"header"}]': in each bar the indicators (shrink) are kept together; when the
       bar runs out of room their font gets smaller step by step (down to 70%), and if that is still not enough they move
       to a second row of the bar, so buttons are never pushed off the screen or covered. Runs again on every change. */
  const dockSel = cfg.dock ? cfg.dock.split('|') : [];
  let bars = []; try { bars = cfg.bars ? JSON.parse(cfg.bars) : []; } catch (e) {}
  const lay = document.createElement('style');
  lay.textContent =
    '.ofk-docked{position:static!important;z-index:auto!important;flex:none!important;width:36px!important;height:36px!important;margin:0!important;' +
    'opacity:1!important;background:transparent!important;color:inherit!important;border:1px solid currentColor!important;' +
    'border-color:color-mix(in srgb,currentColor 35%,transparent)!important;border-radius:10px!important;' +
    '-webkit-backdrop-filter:none!important;backdrop-filter:none!important;display:grid!important;place-items:center;padding:0!important}' +
    '.ofk-grp{display:flex;align-items:center;gap:inherit;min-width:0;flex:0 1 auto}' +
    '.ofk-wrap{flex-wrap:wrap!important;row-gap:2px!important}' +
    '.ofk-wrap>.ofk-grp{order:9;flex:1 0 100%;justify-content:space-around}';
  (document.head || document.documentElement).appendChild(lay);
  const shown = e => !!(e && e.isConnected && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');

  let homeEl = null;   // kept here: a game that redraws its bar throws the docked buttons away, and we put them back
  function dock() {
    const home = homeEl = document.getElementById('siteHome') || homeEl;
    if (!dockSel.length || !home || !btn) return;
    const t = dockSel.map(s => document.querySelector(s)).find(shown);
    if (t) {
      if (home.parentNode !== t || btn.parentNode !== t) { t.append(home, btn); }
      home.classList.add('ofk-docked'); btn.classList.add('ofk-docked'); btn.style.cssText = '';
    } else if (home.classList.contains('ofk-docked') || !home.isConnected) {
      home.classList.remove('ofk-docked'); btn.classList.remove('ofk-docked');
      document.body.append(home, btn); floatNextToHome(home);
    }
  }
  function overflows(bar, grp, wrap) {
    if (bar.scrollWidth > bar.clientWidth + 1) return true;
    // a bar that grows with its content (a row of buttons) is measured against the box it must fit in (within)
    const B = (wrap || bar).getBoundingClientRect(), out = e => { const r = e.getBoundingClientRect(); return r.width && (r.left < B.left - 1 || r.right > B.right + 1); };
    if ([...bar.querySelectorAll('button')].some(out)) return true;
    if (!grp) return false;
    // indicators must stay inside their own group (and so never run under the buttons)
    const G = grp.getBoundingClientRect();
    return [...grp.children].some(e => { const r = e.getBoundingClientRect(); return r.width && (out(e) || r.left < G.left - 1 || r.right > G.right + 1); });
  }
  function fitBar(c) {
    const bar = document.querySelector(c.bar);
    if (!shown(bar)) return;
    let grp = bar.querySelector(':scope>.ofk-grp');
    if (!grp && c.shrink) {
      const items = [...bar.children].filter(e => e.matches(c.shrink));
      if (items.length) { grp = document.createElement('div'); grp.className = 'ofk-grp'; items[0].before(grp); items.forEach(i => grp.appendChild(i)); }
    }
    if (!grp) return;
    const W = c.within ? bar.closest(c.within) : null, over = () => overflows(bar, grp, W);
    const z = k => { grp.style.zoom = k === 1 ? '' : String(k); };
    bar.classList.remove('ofk-wrap'); z(1);
    if (!over()) return;
    for (let k = 0.95; k >= 0.699; k -= 0.05) { z(k); if (!over()) return; }
    bar.classList.add('ofk-wrap'); z(1);   // still too wide: indicators get a row of their own
    for (let k = 0.95; k >= 0.599 && over(); k -= 0.05) z(k);
  }
  let last = 0, timer = 0;
  function layout() {
    try { dock(); bars.forEach(fitBar); } catch (e) {}
    last = Date.now();
  }
  function soon() {   // at most a few times a second, so a score that changes every frame costs nothing
    if (timer) return;   // (our own changes settle after one extra pass, so nothing loops)
    timer = setTimeout(() => { timer = 0; layout(); }, Math.max(0, 200 - (Date.now() - last)));
  }
  if (dockSel.length || bars.length) {
    addEventListener('resize', () => { clearTimeout(timer); timer = 0; layout(); });
    addEventListener('orientationchange', () => setTimeout(layout, 300));
    const startObs = () => new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    document.body ? startObs() : addEventListener('DOMContentLoaded', startObs);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);   // web fonts change text widths
  }
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', place) : place();
  window.OFEK_THEME = { mode, toggle, layout };
})();
