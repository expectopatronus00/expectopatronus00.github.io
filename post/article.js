/* ══════════════════════════════════════════════════════════════
   article.js · 文章页共享增强脚本
   ──────────────────────────────────────────────────────────────
   由 scripts/enhance-articles.cjs 批量注入到每个 post 目录下的文章页。
   文章 HTML 本身不需要包含任何 TOC / 上下篇 / 相关文章结构 ——
   全部在这里运行时生成，所以新增文章只要被注入一次就自动获得。

   提供四样东西：
     1. 顶部阅读进度条
     2. 侧边目录（宽屏显示，从正文 h2 生成，滚动高亮）
     3. 上一篇 / 下一篇（按日期排序，来自 home/articles.js）
     4. 相关文章（同分类 + 标签交集，最多 3 篇）
     5. 缺失时补一条来源声明（仅转载文章）

   依赖：home/articles.js（提供 window.BLOG）。
   若 articles.js 加载失败，前三样里只有目录和进度条生效，
   上下篇与相关文章会静默跳过 —— 不影响正文阅读。
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 站点根路径 ───────────────────────────
     文章页可能在 post/x/x.html 或 post/deepseek/doc/doc.html，
     层级不固定，所以从 pathname 里切出 /post/ 之前的部分当根。 */
  function siteRoot() {
    var p = window.location.pathname;
    var i = p.indexOf('/post/');
    if (i >= 0) return p.slice(0, i + 1);
    // 兜底：往上两级
    return '../../';
  }

  var ROOT = siteRoot();

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ══════════════════════════════════════════
     1. 阅读进度条
     ══════════════════════════════════════════ */
  function initProgress() {
    var bar = document.createElement('div');
    bar.className = 'read-progress';
    document.body.appendChild(bar);

    var ticking = false;
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
      bar.style.width = Math.min(100, Math.max(0, pct * 100)) + '%';
      ticking = false;
    }
    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    update();
  }

  /* ══════════════════════════════════════════
     2. 侧边目录
     ══════════════════════════════════════════ */
  function initToc(articleEl) {
    if (!articleEl) return;

    var heads = articleEl.querySelectorAll('h2');
    if (heads.length < 3) return; // 太短的文章不值得放目录

    var layout = articleEl.parentNode;
    var toc = document.createElement('nav');
    toc.className = 'article-toc';
    toc.setAttribute('aria-label', '文章目录');

    var items = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var text = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!h.id) h.id = 'sec-' + (i + 1);
      items.push({ id: h.id, text: text, el: h });
    }
    if (items.length < 3) return;

    var ol = document.createElement('ol');
    for (var j = 0; j < items.length; j++) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + items[j].id;
      a.textContent = items[j].text;
      li.appendChild(a);
      ol.appendChild(li);
    }

    toc.innerHTML = '<div class="toc-inner"><div class="toc-label">on this page</div></div>';
    toc.querySelector('.toc-inner').appendChild(ol);
    layout.appendChild(toc);

    var links = toc.querySelectorAll('a');
    var tocInner = toc.querySelector('.toc-inner');

    /* 点击时用平滑滚动，避开固定导航 */
    for (var k = 0; k < links.length; k++) {
      links[k].addEventListener('click', function (e) {
        var target = document.getElementById(this.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        var top = target.getBoundingClientRect().top + window.pageYOffset - 96;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.replaceState(null, '', this.getAttribute('href'));
      });
    }

    /* 滚动时高亮当前章节 + 目录吸顶 */
    var current = -1;
    var ticking = false;

    function sync() {
      var scrollY = window.pageYOffset;
      var active = 0;
      for (var m = 0; m < items.length; m++) {
        if (items[m].el.getBoundingClientRect().top + window.pageYOffset - 120 <= scrollY) {
          active = m;
        }
      }
      if (active !== current) {
        current = active;
        for (var n = 0; n < links.length; n++) {
          links[n].classList.toggle('is-current', n === active);
        }
      }

      /* 目录原始位置滚出视口后转为 fixed 吸顶 */
      var baseTop = toc.getBoundingClientRect().top;
      toc.classList.toggle('is-stuck', baseTop <= 0);

      ticking = false;
    }

    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(sync);
        }
      },
      { passive: true }
    );
    sync();
  }

  /* ══════════════════════════════════════════
     3 & 4. 上下篇 + 相关文章
     ══════════════════════════════════════════ */
  function initNav(articleEl, data) {
    var path = window.location.pathname;
    var list = data.visible; // 已按日期倒序、已剔除合并项
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      var u = list[i].url.replace(/^\.\.\//, '');
      if (path.indexOf(u) !== -1) {
        idx = i;
        break;
      }
    }

    /* 当前页不在可见列表里：多半是被合并掉的同题文章。
       这种情况下页面还在（不能 404），但没有上下篇和相关文章可算，
       所以在正文顶部挂一条「已合并」提示，把读者送去保留的那一篇。 */
    if (idx < 0) {
      var selfHidden = null;
      for (var q = 0; q < data.all.length; q++) {
        if (path.indexOf(data.all[q].url.replace(/^\.\.\//, '')) !== -1) {
          selfHidden = data.all[q];
          break;
        }
      }
      if (selfHidden && selfHidden.mergedInto) {
        var target = data.get(selfHidden.mergedInto);
        var box = document.createElement('div');
        box.className = 'merged-note';
        box.innerHTML =
          '<div class="mn-head">merged</div>' +
          '<p>这篇和' +
          (target ? '《' + target.title + '》' : '同系列的另一篇') +
          '内容重复，已经合并成一篇长文，这里只留作旧链接的落点。' +
          (target ? '<a href="' + ROOT + target.url.replace(/^\.\.\//, '') + '">去读合并后的版本 →</a>' : '') +
          '</p>';
        /* 插在封面大图之前，读者一进来就能看到，
           不用先滚过整张 hero 图才发现内容已合并 */
        var hero = document.querySelector('.hero-image');
        var anchorEl = hero || articleEl;
        anchorEl.parentNode.insertBefore(box, anchorEl);
      }
      return;
    }

    var self = list[idx];
    var newer = idx > 0 ? list[idx - 1] : null;
    var older = idx < list.length - 1 ? list[idx + 1] : null;

    function link(a) {
      return ROOT + a.url.replace(/^\.\.\//, '');
    }

    /* ── 上一篇 / 下一篇 ── */
    if (newer || older) {
      var pn = document.createElement('div');
      pn.className = 'prev-next';

      var left = newer
        ? '<a href="' +
          link(newer) +
          '"><span class="pn-label">← 上一篇（较新）</span><span class="pn-title">' +
          newer.title +
          '</span></a>'
        : '<a class="pn-empty" href="#"><span class="pn-label">← 上一篇</span><span class="pn-title">已经是最新一篇</span></a>';

      var right = older
        ? '<a class="is-next" href="' +
          link(older) +
          '"><span class="pn-label">下一篇（更早）→</span><span class="pn-title">' +
          older.title +
          '</span></a>'
        : '<a class="is-next pn-empty" href="#"><span class="pn-label">下一篇 →</span><span class="pn-title">已经是最后一篇</span></a>';

      pn.innerHTML = left + right;
      articleEl.parentNode.insertBefore(pn, articleEl.nextSibling);
    }

    /* ── 相关文章：同分类 + 标签交集，取前 3 ── */
    var selfTags = {};
    var st = self.tags || [];
    for (var t = 0; t < st.length; t++) selfTags[st[t]] = true;

    var scored = [];
    for (var s = 0; s < list.length; s++) {
      if (s === idx) continue;
      var a = list[s];
      var score = 0;
      if (a.categoryId === self.categoryId) score += 1;
      var at = a.tags || [];
      for (var x = 0; x < at.length; x++) {
        if (selfTags[at[x]]) score += 2;
      }
      if (score > 0) scored.push({ a: a, score: score });
    }
    scored.sort(function (p, q) {
      return q.score - p.score;
    });

    var top = scored.slice(0, 3);
    if (top.length) {
      var rel = document.createElement('div');
      rel.className = 'related';
      var html = '<div class="rel-label">相关阅读</div><ul>';
      for (var r = 0; r < top.length; r++) {
        html +=
          '<li><a href="' +
          link(top[r].a) +
          '"><span class="rel-title">' +
          top[r].a.title +
          '</span><span class="rel-date">' +
          top[r].a.date.slice(0, 10).replace(/-/g, ' · ') +
          '</span></a></li>';
      }
      html += '</ul>';
      rel.innerHTML = html;
      var anchor = articleEl.parentNode.querySelector('.prev-next');
      articleEl.parentNode.insertBefore(rel, anchor ? anchor.nextSibling : articleEl.nextSibling);
    }

    /* ── 5. 来源声明：转载文章若正文里没有来源块，补一条纯文字说明 ── */
    if (!self.original) {
      var hasSource = articleEl.querySelector('.info-box, .cta-box, .source-note');
      if (!hasSource) {
        var note = document.createElement('div');
        note.className = 'source-note';
        note.innerHTML =
          '<div class="sn-head">source</div>' +
          '<p>本文为转载整理，原文来自' +
          self.source +
          '。本站仅做学习归档，不做商用，内容版权归原作者所有；' +
          '若原作者不希望被收录，联系本站会立即删除。</p>';
        articleEl.appendChild(note);
      }
    }

    /* ── 阅读时长：正文里没有就按字数估算补上 ──
       老文章的元信息行用的是 .meta，新模板用 .meta-row，两种都认。 */
    var meta = document.querySelector('.page-head .meta-row') || document.querySelector('.page-head .meta');
    if (meta && !/分钟阅读/.test(meta.textContent)) {
      var chars = (articleEl.textContent || '').replace(/\s/g, '').length;
      var mins = Math.max(1, Math.round(chars / 400));
      var span = document.createElement('span');
      span.textContent = '约 ' + mins + ' 分钟阅读';
      meta.appendChild(span);
    }
  }

  /* ══════════════════════════════════════════
     启动
     ══════════════════════════════════════════ */
  ready(function () {
    var articleEl = document.querySelector('.article-body');
    if (!articleEl) return;

    /* 给正文套一层相对定位容器，供 TOC 绝对定位 */
    var layout = document.createElement('div');
    layout.className = 'article-layout';
    articleEl.parentNode.insertBefore(layout, articleEl);
    layout.appendChild(articleEl);

    initProgress();
    initToc(articleEl);

    if (window.BLOG) {
      initNav(articleEl, window.BLOG);
      return;
    }

    /* articles.js 还没加载时，自己补一次 */
    var s = document.createElement('script');
    s.src = ROOT + 'home/articles.js';
    s.onload = function () {
      if (window.BLOG) initNav(articleEl, window.BLOG);
    };
    s.onerror = function () {
      /* 静默失败：正文阅读不受影响 */
    };
    document.body.appendChild(s);
  });
})();
