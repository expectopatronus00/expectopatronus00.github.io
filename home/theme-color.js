/* ============================================================
   theme-color.js · 让浏览器 UI 跟随站点主题
   ------------------------------------------------------------
   本站是 data-theme 手动切换的双主题站，纯 media 查询的 theme-color
   只跟随系统配色，用户点主题按钮时不会更新。这里直接读
   design-tokens.css 的 --bg，保持 token 是唯一色值来源。
   由 scripts/head-hints.cjs 注入到全站 head，defer 加载。
   ============================================================ */
(function () {
  'use strict';

  var FALLBACK = { dark: '#0b0d16', light: '#f4efe4' };

  function metaTag() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    return m;
  }

  function isColor(v) {
    return /^#[0-9a-fA-F]{3,8}$/.test(v);
  }

  function currentColor(root, cs) {
    var bg = (cs.getPropertyValue('--bg') || '').trim();
    if (isColor(bg)) return bg;
    /* 少数浏览器会保留 var() 未解析，退回读原始 token */
    var light = root.getAttribute('data-theme') === 'light';
    var raw = (cs.getPropertyValue(light ? '--paper' : '--ink-950') || '').trim();
    return isColor(raw) ? raw : (light ? FALLBACK.light : FALLBACK.dark);
  }

  var root = document.documentElement;
  var tag = metaTag();

  function sync() {
    tag.setAttribute('content', currentColor(root, getComputedStyle(root)));
  }

  sync();

  /* 主题按钮直接改 documentElement.dataset.theme */
  if (window.MutationObserver) {
    new MutationObserver(sync).observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  /* 另一个标签页切换主题时，本页也跟上 */
  window.addEventListener('storage', function (e) {
    if (e.key === 'theme' && e.newValue) {
      root.setAttribute('data-theme', e.newValue);
      sync();
    }
  });

  window.addEventListener('pageshow', sync);
})();
