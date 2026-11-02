/* 开源 AI 星标榜 · 由 nav/index.html 引入，读 stars/data.json
   依赖页面容器：#stars #stars-meta #stars-chart #stars-tip #stars-shell
   #stars-legend #stars-rows #stars-note #stars-win-note
   两种视图：heat（矩形树图，面积=星标 颜色=周期增速）/ line（折线趋势） */
(function () {
  'use strict';

  var WIN_LABEL = { p1: '1 日', p7: '7 日', p30: '30 日' };
  var WIN_DAYS = { p1: 1, p7: 7, p30: 30 };
  var PALETTE = ['#d4692a', '#4a9e7f', '#b8915c', '#7f77dd', '#5a9bd4', '#d4537e', '#639922', '#8a8ea8'];
  var BASIS_LABEL = { week: '本周', month: '本月', lifetime: '创建以来', none: '无' };

  var state = {
    view: 'heat',
    win: 'p7',
    scale: 'abs',
    sort: 'stars',
    dir: -1,
    repos: [],
    days: [],
    rank: {},
  };

  function el(id) { return document.getElementById(id); }
  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 居中文字：热力图块内用，避免每处都拼一遍属性 */
  function txt(cx, cy, fs, color, opacity, str, family, weight) {
    return '<text x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '" text-anchor="middle"' +
      ' font-family="' + family + '" font-size="' + fs + '" font-weight="' + weight + '"' +
      ' fill="' + color + '" fill-opacity="' + opacity + '" pointer-events="none">' + esc(str) + '</text>';
  }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function deltaHtml(v) {
    if (v === null || v === undefined) return '<span class="delta-flat">—</span>';
    if (v > 0) return '<span class="delta-up">+' + fmt(v) + '</span>';
    if (v < 0) return '<span class="delta-down">' + fmt(v) + '</span>';
    return '<span class="delta-flat">0</span>';
  }

  function pctText(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    var s = v > 0 ? '+' : v < 0 ? '−' : '';
    var a = Math.abs(v);
    return s + a.toFixed(a >= 10 ? 1 : 2) + '%';
  }

  function deltaPair(abs, p, approx) {
    var pre = approx ? '≈' : '';
    var d = abs === null || abs === undefined
      ? '<span class="delta-flat">—</span>'
      : abs > 0
        ? '<span class="delta-up">' + pre + '+' + fmt(abs) + '</span>'
        : abs < 0
          ? '<span class="delta-down">' + pre + fmt(abs) + '</span>'
          : '<span class="delta-flat">0</span>';
    if (p === null || p === undefined) return d;
    return d + ' <span class="tip-pct">' + pre + pctText(p) + '</span>';
  }

  /* 表格里的增量格：折算值前面加 ≈，跟实测值区分开 */
  function deltaCell(row, days) {
    return deltaPair(row['d' + days], null, row['p' + days + 'src'] === 'rank');
  }

  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function valueAt(series, cutoff) {
    var v = null;
    for (var i = 0; i < series.length; i++) {
      if (series[i][0] <= cutoff) v = series[i][1];
      else break;
    }
    return v;
  }

  function pct(delta, base) {
    if (delta === null || delta === undefined) return null;
    if (!base || base <= 0) return null;
    return (delta / base) * 100;
  }

  function buildRows(data) {
    var rows = [];
    for (var i = 0; i < data.repos.length; i++) {
      var r = data.repos[i];
      var s = data.series[r.repo] || [];
      if (!s.length) continue;
      var now = s[s.length - 1][1];
      var span = spanDays(s);
      var v1 = valueAt(s, daysAgo(1));
      var v7 = valueAt(s, daysAgo(7));
      var v30 = valueAt(s, daysAgo(30));
      var rk = state.rank[String(r.repo).toLowerCase()] || null;

      var row = {
        repo: r.repo,
        fullName: r.fullName || r.repo,
        name: r.name || r.repo.split('/')[1],
        owner: r.owner || r.repo.split('/')[0],
        desc: r.desc || '',
        note: r.note || '',
        category: r.category || '未分类',
        license: r.license || '',
        stars: now,
        span: span,
        series: s,
        basis: rk ? rk.basis : null,
        basisLabel: rk ? (BASIS_LABEL[rk.basis] || '') : '',
        daily: rk && rk.daily !== undefined ? rk.daily : null,
      };

      fillWin(row, 'p1', 1, now, v1, span, rk);
      fillWin(row, 'p7', 7, now, v7, span, rk);
      fillWin(row, 'p30', 30, now, v30, span, rk);
      rows.push(row);
    }
    return rows;
  }

  /* 序列跨度（首末快照相差几天），不够长就不能算实测增速 */
  function spanDays(series) {
    if (!series.length) return 0;
    var a = Date.parse(series[0][0] + 'T00:00:00Z');
    var b = Date.parse(series[series.length - 1][0] + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return 0;
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  /**
   * 一个窗口的增速怎么来：
   *   1. 快照跨度 >= 窗口天数 → 实测（series）
   *   2. 否则用榜单的日均新增折算（rank）：dN = daily × N
   *   3. 都没有 → 留空，热力图涂灰，不猜
   * 这样页面今天就可用，快照满 30 天后自动全部切到实测。
   */
  function fillWin(row, key, days, now, base, span, rk) {
    var dk = 'd' + days;
    if (base !== null && base !== undefined && span >= days) {
      row[dk] = now - base;
      row[key] = pct(row[dk], base);
      row[key + 'src'] = 'series';
      return;
    }
    if (rk && rk.daily !== null && rk.daily !== undefined && rk.daily > 0) {
      row[dk] = rk.daily * days;
      row[key] = pct(row[dk], now);
      row[key + 'src'] = 'rank';
      return;
    }
    row[dk] = null;
    row[key] = null;
    row[key + 'src'] = null;
  }

  function sortRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      if (key === 'name') return a.name.toLowerCase() < b.name.toLowerCase() ? -dir : dir;
      var av = a[key], bv = b[key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }

  /* ── 色阶：红涨绿跌（A 股习惯），中点取主题中性色 ── */
  var UP = [214, 92, 40];
  var DOWN = [46, 150, 112];

  function midColor() { return isLight() ? [213, 205, 188] : [58, 60, 74]; }

  function mix(a, b, t) {
    var c = [0, 0, 0];
    for (var i = 0; i < 3; i++) c[i] = Math.round(a[i] + (b[i] - a[i]) * t);
    return c;
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function relLum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrast(a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  /* 深字/白字里挑对比度更高的那个，避免中间色带两边都不够 */
  function textOn(c) {
    var l = relLum(c);
    return contrast(l, relLum([31, 26, 18])) >= contrast(l, relLum([255, 253, 248])) ? '#1f1a12' : '#fffdf8';
  }

  function rateColor(v, dom) {
    var mid = midColor();
    if (v === null || v === undefined) return mid;
    var t = Math.max(-1, Math.min(1, v / dom));
    // 开方放大，让 2% 这种小增速也能看出差别
    var k = Math.pow(Math.abs(t), 0.55);
    return mix(mid, t >= 0 ? UP : DOWN, k);
  }

  function domainFor(rows, key) {
    var vals = [];
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][key];
      if (v !== null && v !== undefined && !isNaN(v)) vals.push(Math.abs(v));
    }
    if (!vals.length) return 1;
    vals.sort(function (a, b) { return a - b; });
    // 用 P85 而不是最大值，避免单个暴涨把其余全压成灰色
    var p = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.85))];
    return Math.max(p || vals[vals.length - 1], 0.05);
  }

  /* ── Squarified treemap ── */
  function squarify(items, x0, y0, w0, h0) {
    var out = [];
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += items[i].value;
    if (total <= 0 || w0 <= 0 || h0 <= 0) return out;

    var area = w0 * h0;
    var nodes = [];
    for (i = 0; i < items.length; i++) {
      nodes.push({ it: items[i], a: (items[i].value / total) * area });
    }

    var x = x0, y = y0, w = w0, h = h0;
    var row = [];

    function worst(r, side) {
      var sum = 0, mx = -Infinity, mn = Infinity;
      for (var k = 0; k < r.length; k++) {
        sum += r[k].a;
        if (r[k].a > mx) mx = r[k].a;
        if (r[k].a < mn) mn = r[k].a;
      }
      if (sum <= 0 || side <= 0) return Infinity;
      var s2 = sum * sum, side2 = side * side;
      return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
    }

    function flush() {
      var sum = 0, k;
      for (k = 0; k < row.length; k++) sum += row[k].a;
      if (sum <= 0) { row = []; return; }
      if (w >= h) {
        var cw = sum / h;
        var cy = y;
        for (k = 0; k < row.length; k++) {
          var ch = (row[k].a / sum) * h;
          out.push({ it: row[k].it, x: x, y: cy, w: cw, h: ch });
          cy += ch;
        }
        x += cw; w -= cw;
      } else {
        var rh = sum / w;
        var cx = x;
        for (k = 0; k < row.length; k++) {
          var cw2 = (row[k].a / sum) * w;
          out.push({ it: row[k].it, x: cx, y: y, w: cw2, h: rh });
          cx += cw2;
        }
        y += rh; h -= rh;
      }
      row = [];
    }

    var idx = 0;
    while (idx < nodes.length) {
      var side = Math.min(w, h);
      if (!row.length) { row.push(nodes[idx]); idx++; continue; }
      if (worst(row, side) >= worst(row.concat([nodes[idx]]), side)) {
        row.push(nodes[idx]); idx++;
      } else {
        flush();
      }
    }
    if (row.length) flush();
    return out;
  }

  function truncate(s, max) {
    var w = 0, out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var cw = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.56;
      if (w + cw > max) return out + '…';
      w += cw; out += ch;
    }
    return out;
  }

  /* ── 热力图：两级 treemap，外层按库龄切板块，板块内铺项目 ── */

  /**
   * 面积权重。100 个仓库的星标跨 4 个数量级（最大 41.9 万，最小 210），
   * 严格按星标画，后 50 名合计只占 2.7% 面积，34 个块小到点不中。
   * 开 0.65 次幂压缩：大块仍然明显更大，最小的块也还有 ~18px 可点。
   */
  function wOf(stars) {
    return Math.pow(Math.max(1, stars), 0.65);
  }

  function buildGroups(rows, key) {
    var order = [], map = {};
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].category;
      if (!map[name]) {
        map[name] = { name: name, rows: [], total: 0, pct: null };
        order.push(map[name]);
      }
      map[name].rows.push(rows[i]);
      map[name].total += wOf(rows[i].stars);
    }
    for (var g = 0; g < order.length; g++) {
      var grp = order[g];
      grp.rows.sort(function (a, b) { return b.stars - a.stars; });
      // 板块增速按星标加权，小项目不会带偏整块
      var ws = 0, wb = 0;
      for (var k = 0; k < grp.rows.length; k++) {
        var p = grp.rows[k][key];
        if (p === null || p === undefined) continue;
        ws += grp.rows[k].stars * p;
        wb += grp.rows[k].stars;
      }
      grp.pct = wb > 0 ? ws / wb : null;
    }
    order.sort(function (a, b) { return b.total - a.total; });
    return order;
  }

  function drawHeat(rows) {
    var shell = el('stars-shell');
    if (!shell) return;
    var W = Math.max(320, Math.round(shell.clientWidth || 900));
    var narrow = W < 640;
    // 100 个项目、星标跨 4 个数量级，画布矮了小项目就只剩一条线，所以给足高度
    var H = Math.round(narrow ? W * 1.9 : Math.min(680, W * 0.62));

    var key = state.win;
    var dom = domainFor(rows, key);
    var nSeries = 0, nRank = 0, nNone = 0;
    for (var q = 0; q < rows.length; q++) {
      var src = rows[q][key + 'src'];
      if (src === 'series') nSeries++;
      else if (src === 'rank') nRank++;
      else nNone++;
    }
    var hasPct = nSeries + nRank > 0;

    var totalW = 0;
    for (var s = 0; s < rows.length; s++) totalW += wOf(rows[s].stars);

    var groups;
    if (narrow) {
      // 手机端宽度不够分板块，最小组会被挤成一条竖缝；改成整块平铺，库龄看第 02 节
      groups = [{
        name: '',
        rows: rows.slice().sort(function (a, b) { return b.stars - a.stars; }),
        total: totalW,
        pct: null,
        flat: true,
      }];
    } else {
      groups = buildGroups(rows, key);
    }

    // 组间距明显大于组内块间距，否则看不出是分组
    var GAP = narrow ? 5 : 8;
    // 「30 天内」那批星标只占 1.4%，按真实面积会挤成一条看不见的缝，
    // 给每个板块一个最小面积保底（6%），组内相对面积仍然按权重
    var FLOOR = totalW * 0.06;
    var gRects = squarify(
      groups.map(function (x) { return { value: Math.max(x.total, FLOOR), g: x }; }),
      0, 0, W, H
    );

    var svg = ['<svg class="heat-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="开源项目星标热力图，面积代表星标量，颜色代表增速，按分类分块">'];
    var cells = [];

    for (var r = 0; r < gRects.length; r++) {
      var gr = gRects[r];
      var gdef = gr.it.g;
      var gx = gr.x + GAP / 2, gy = gr.y + GAP / 2;
      var gw = gr.w - GAP, gh = gr.h - GAP;
      if (gw < 8 || gh < 8) continue;

      // 板块底：用页面背景色做“凹陷”，缝隙才看得出来是分组
      svg.push('<rect x="' + gx.toFixed(1) + '" y="' + gy.toFixed(1) + '" width="' + gw.toFixed(1) +
        '" height="' + gh.toFixed(1) + '" rx="3" fill="var(--bg-soft)" stroke="var(--line)" stroke-width="0.8"/>');

      var hh = 0;
      if (!gdef.flat) {
        if (gh >= 58 && gw >= 62) hh = 21;
        else if (gh >= 42 && gw >= 46) hh = 17;
      }

      if (hh) {
        var nameFs = hh >= 21 ? 11.5 : 10;
        // 标题栏下划线：把板块头跟下面的色块分开
        svg.push('<line x1="' + gx.toFixed(1) + '" y1="' + (gy + hh).toFixed(1) +
          '" x2="' + (gx + gw).toFixed(1) + '" y2="' + (gy + hh).toFixed(1) +
          '" stroke="var(--line)" stroke-width="1"/>');
        var label = truncate(gdef.name, (gw - 14) / nameFs);
        svg.push('<text x="' + (gx + 7).toFixed(1) + '" y="' + (gy + hh * 0.7).toFixed(1) +
          '" font-family="var(--font-sans)" font-size="' + nameFs + '" font-weight="600" fill="var(--text-soft)">' +
          esc(label) + '</text>');
        if (gw >= 168) {
          var stat = gdef.rows.length + ' 个' + (gdef.pct === null ? '' : ' · ' + pctText(gdef.pct));
          svg.push('<text x="' + (gx + gw - 7).toFixed(1) + '" y="' + (gy + hh * 0.7).toFixed(1) +
            '" text-anchor="end" font-family="var(--font-mono)" font-size="9.5" fill="var(--text-dim)">' +
            esc(stat) + '</text>');
        }
      }

      var items = gdef.rows.map(function (x) { return { value: wOf(x.stars), r: x, pct: x[key] }; });
      var inner = squarify(items, gx, gy + hh, gw, gh - hh);

      for (var i = 0; i < inner.length; i++) {
        var c = inner[i];
        var pad = 1.2;
        var x = c.x + pad, y = c.y + pad;
        var w = c.w - pad * 2, h = c.h - pad * 2;
        if (w < 1 || h < 1) continue;

        var fill = rateColor(c.it.pct, dom);
        var tc = textOn(fill);
        var hasValue = c.it.pct !== null && c.it.pct !== undefined;
        var idx = cells.length;
        cells.push(c);

        svg.push('<g class="heat-cell" data-idx="' + idx + '">');
        svg.push('<rect data-idx="' + idx + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + rgb(fill) + '"/>');

        var fs = 0, tier = 0;
        if (w >= 132 && h >= 76) { fs = 15; tier = 3; }
        else if (w >= 132 && h >= 54) { fs = 14; tier = 2; }
        else if (w >= 86 && h >= 42) { fs = 12.5; tier = 2; }
        else if (w >= 56 && h >= 26) { fs = 10.5; tier = 1; }
        else if (w >= 36 && h >= 17) { fs = 9; tier = 1; }

        if (fs) {
          var label2 = truncate(c.it.r.name, (w - 10) / fs);
          var cx = x + w / 2;
          var cy = y + h / 2;
          var lineGap = fs * 1.15;

          if (tier === 3 && hasValue) {
            svg.push(txt(cx, cy - lineGap * 0.75, fs, tc, 0.96, label2, 'var(--font-sans)', 600));
            svg.push(txt(cx, cy + lineGap * 0.35, fs - 3.5, tc, 0.86, pctText(c.it.pct), 'var(--font-mono)', 400));
            svg.push(txt(cx, cy + lineGap * 1.15, fs - 5, tc, 0.7, fmt(c.it.r.stars), 'var(--font-mono)', 400));
          } else if (tier >= 2) {
            svg.push(txt(cx, cy - lineGap * 0.35, fs, tc, 0.96, label2, 'var(--font-sans)', 600));
            if (hasValue) svg.push(txt(cx, cy + lineGap * 0.72, fs - 3, tc, 0.86, pctText(c.it.pct), 'var(--font-mono)', 400));
            else svg.push(txt(cx, cy + lineGap * 0.72, fs - 3.5, tc, 0.72, fmt(c.it.r.stars), 'var(--font-mono)', 400));
          } else {
            svg.push(txt(cx, cy + fs * 0.34, fs, tc, 0.94, label2, 'var(--font-sans)', 600));
          }
        }
        svg.push('</g>');
      }
    }

    svg.push('</svg>');
    el('stars-chart').innerHTML = svg.join('');

    var mid = midColor();
    var lg = [];
    if (hasPct) {
      lg.push('<span class="heat-scale">');
      lg.push('<span class="heat-scale-end">' + pctText(-dom) + '</span>');
      lg.push('<span class="heat-scale-bar" style="background:linear-gradient(90deg,' + rgb(DOWN) + ',' + rgb(mid) + ',' + rgb(UP) + ')"></span>');
      lg.push('<span class="heat-scale-end">' + pctText(dom) + '</span>');
      lg.push('</span>');
      var srcText;
      if (nRank === 0) srcText = '颜色 = ' + WIN_LABEL[key] + '增速（逐日快照实测）';
      else if (nSeries === 0) srcText = '颜色 = ' + WIN_LABEL[key] + '增速（按榜单日均新增折算）';
      else srcText = '颜色 = ' + WIN_LABEL[key] + '增速（' + nSeries + ' 项实测 · ' + nRank + ' 项折算' + (nNone ? ' · ' + nNone + ' 项无数据' : '') + '）';
      var groupNote = narrow ? '手机端平铺，库龄见第 02 节' : '板块按库龄分档';
      lg.push('<span class="legend-item">' + srcText + '，红涨绿跌；面积 = 星标（0.65 次幂压缩）；' + groupNote + '</span>');
    } else {
      lg.push('<span class="legend-item">面积 = 星标（0.65 次幂压缩）；颜色要等快照攒够天数，或等榜单补上增速</span>');
    }
    el('stars-legend').innerHTML = lg.join('');

    var note = el('stars-win-note');
    if (note) note.textContent = WIN_LABEL[key] + '增速';

    bindHeat(cells, W, H);
  }

  function bindHeat(cells) {
    var svgEl = el('stars-chart').querySelector('svg');
    var tip = el('stars-tip');
    var shell = el('stars-shell');
    if (!svgEl || !tip || !shell) return;

    var active = null;

    function idxOf(node) {
      while (node && node !== svgEl) {
        if (node.getAttribute) {
          var v = node.getAttribute('data-idx');
          if (v !== null) return parseInt(v, 10);
        }
        node = node.parentNode;
      }
      return -1;
    }

    function paint(i) {
      if (active === i) return;
      var prev = svgEl.querySelector('.heat-cell.is-on');
      if (prev) prev.classList.remove('is-on');
      active = i;
      if (i >= 0) {
        var g = svgEl.querySelector('.heat-cell[data-idx="' + i + '"]');
        if (g) g.classList.add('is-on');
      }
    }

    function show(ev) {
      var i = idxOf(ev.target);
      if (i < 0 || !cells[i]) { hide(); return; }
      paint(i);
      var r = cells[i].it.r;
      var html = '<div class="tip-date">' + esc(r.fullName) + '</div>';
      html += '<div class="tip-row"><span class="tip-k">星标</span><span class="tip-val">' + fmt(r.stars) + '</span></div>';
      html += '<div class="tip-row"><span class="tip-k">日增</span><span class="tip-val">' + deltaPair(r.d1, r.p1, r.p1src === 'rank') + '</span></div>';
      html += '<div class="tip-row"><span class="tip-k">7 日</span><span class="tip-val">' + deltaPair(r.d7, r.p7, r.p7src === 'rank') + '</span></div>';
      html += '<div class="tip-row"><span class="tip-k">30 日</span><span class="tip-val">' + deltaPair(r.d30, r.p30, r.p30src === 'rank') + '</span></div>';
      if (r.basisLabel && r.basisLabel !== '无') {
        html += '<div class="tip-row"><span class="tip-k">增量口径</span><span class="tip-val">' + esc(r.basisLabel) + '</span></div>';
      }
      var srcNote = r[state.win + 'src'] === 'series' ? '实测' : r[state.win + 'src'] === 'rank' ? '折算' : '无数据';
      html += '<div class="tip-foot">' + esc(r.category) + ' · ' + srcNote + ' · 点击打开仓库</div>';
      tip.innerHTML = html;
      tip.classList.add('is-on');

      var rect = shell.getBoundingClientRect();
      var left = ev.clientX - rect.left + 16;
      var top = ev.clientY - rect.top + 12;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      if (left + tw > rect.width) left = Math.max(0, ev.clientX - rect.left - tw - 12);
      if (top + th > rect.height + 60) top = Math.max(0, ev.clientY - rect.top - th - 12);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    function hide() {
      paint(-1);
      tip.classList.remove('is-on');
    }

    svgEl.addEventListener('mousemove', show);
    svgEl.addEventListener('mouseleave', hide);

    /* 触屏：第一次点看数据，再点同一块才开仓库；点击事件被 touch 吃掉 */
    var lastTouch = -1;
    var touchedAt = 0;
    svgEl.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      if (!t) return;
      touchedAt = Date.now();
      var i = idxOf(e.target);
      if (i < 0) { hide(); lastTouch = -1; return; }
      if (i === lastTouch) {
        lastTouch = -1;
        hide();
        window.open('https://github.com/' + cells[i].it.r.fullName, '_blank', 'noopener');
        return;
      }
      lastTouch = i;
      show(t);
    }, { passive: true });

    svgEl.addEventListener('click', function (ev) {
      if (Date.now() - touchedAt < 700) return;
      var i = idxOf(ev.target);
      if (i < 0 || !cells[i]) return;
      window.open('https://github.com/' + cells[i].it.r.fullName, '_blank', 'noopener');
    });
  }

  /* ── 折线趋势 ── */
  function drawLine(rows) {
    var box = el('stars-chart');
    if (state.days.length < 2) {
      box.innerHTML = '<div class="stars-empty">趋势线要至少 2 天快照。<br>当前只有 ' + esc(state.days[0] || '—') + '，明天这个位置就有线了。</div>';
      el('stars-legend').innerHTML = '';
      return;
    }

    var W = 900, H = 380, ml = 62, mr = 18, mt = 18, mb = 34;
    var n = state.days.length;
    var series = [];
    for (var i = 0; i < rows.length; i++) {
      var map = {};
      for (var k = 0; k < rows[i].series.length; k++) map[rows[i].series[k][0]] = rows[i].series[k][1];
      var first = rows[i].series[0][1];
      var pts = [];
      for (var j = 0; j < n; j++) {
        var v = map[state.days[j]];
        if (v === undefined) continue;
        pts.push({ i: j, v: state.scale === 'norm' ? (v / first) * 100 : v, raw: v });
      }
      series.push({ name: rows[i].name, color: PALETTE[i % PALETTE.length], pts: pts });
    }

    var all = [];
    for (var a = 0; a < series.length; a++) for (var b = 0; b < series[a].pts.length; b++) all.push(series[a].pts[b].v);
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min = min * 0.98; max = max * 1.02; }
    var pad = (max - min) * 0.12;
    min -= pad; max += pad;
    if (state.scale === 'norm') { min = Math.min(min, 100); max = Math.max(max, 100); }

    function x(i) { return ml + (n <= 1 ? 0 : (i * (W - ml - mr)) / (n - 1)); }
    function y(v) { return mt + (1 - (v - min) / (max - min)) * (H - mt - mb); }

    var svg = ['<svg class="line-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="星标趋势折线图">'];

    for (var g = 0; g <= 4; g++) {
      var gv = min + ((max - min) * g) / 4;
      var gy = y(gv);
      svg.push('<line x1="' + ml + '" y1="' + gy.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>');
      var label = state.scale === 'norm' ? gv.toFixed(0) : fmt(Math.round(gv));
      svg.push('<text x="' + (ml - 10) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--text-dim)">' + label + '</text>');
    }

    var tickIdx = n <= 4 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (var t = 0; t < tickIdx.length; t++) {
      var ti = tickIdx[t];
      var anchor = t === 0 ? 'start' : t === tickIdx.length - 1 ? 'end' : 'middle';
      svg.push('<text x="' + x(ti).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + anchor + '" font-family="var(--font-mono)" font-size="11" fill="var(--text-dim)">' + state.days[ti].slice(5) + '</text>');
    }

    for (var s = 0; s < series.length; s++) {
      var pts = series[s].pts;
      if (!pts.length) continue;
      var d = '';
      for (var p = 0; p < pts.length; p++) {
        d += (p === 0 ? 'M' : 'L') + x(pts[p].i).toFixed(1) + ' ' + y(pts[p].v).toFixed(1) + ' ';
      }
      svg.push('<path d="' + d + '" fill="none" stroke="' + series[s].color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      var lastPt = pts[pts.length - 1];
      svg.push('<circle cx="' + x(lastPt.i).toFixed(1) + '" cy="' + y(lastPt.v).toFixed(1) + '" r="3" fill="' + series[s].color + '"/>');
    }

    svg.push('<line id="stars-guide" x1="0" y1="' + mt + '" x2="0" y2="' + (H - mb) + '" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>');
    svg.push('<rect id="stars-hit" x="' + ml + '" y="' + mt + '" width="' + (W - ml - mr) + '" height="' + (H - mt - mb) + '" fill="transparent"/>');
    svg.push('</svg>');

    box.innerHTML = svg.join('');

    var lg = [];
    for (var q = 0; q < series.length; q++) {
      lg.push('<span class="legend-item"><span class="legend-swatch" style="background:' + series[q].color + '"></span>' + series[q].name + '</span>');
    }
    el('stars-legend').innerHTML = lg.join('');

    bindLineHover(series, x, n, ml, mr, W);
  }

  function bindLineHover(series, x, n, ml, mr, W) {
    var hit = el('stars-hit');
    var guide = el('stars-guide');
    var tip = el('stars-tip');
    var shell = el('stars-shell');
    if (!hit || !shell) return;

    function move(ev) {
      var rect = shell.getBoundingClientRect();
      var svgEl = el('stars-chart').querySelector('svg');
      var box = svgEl.getBoundingClientRect();
      var scale = W / box.width;
      var px = (ev.clientX - box.left) * scale;
      var ratio = (px - ml) / (W - ml - mr);
      var idx = Math.round(ratio * (n - 1));
      if (idx < 0) idx = 0;
      if (idx > n - 1) idx = n - 1;

      guide.setAttribute('x1', x(idx).toFixed(1));
      guide.setAttribute('x2', x(idx).toFixed(1));
      guide.setAttribute('opacity', '0.5');

      var date = state.days[idx];
      var items = [];
      for (var i = 0; i < series.length; i++) {
        for (var p = 0; p < series[i].pts.length; p++) {
          if (series[i].pts[p].i === idx) {
            items.push({ name: series[i].name, color: series[i].color, v: series[i].pts[p].raw });
            break;
          }
        }
      }
      items.sort(function (a, b) { return b.v - a.v; });

      var html = '<div class="tip-date">' + date + '</div>';
      for (var m = 0; m < items.length && m < 8; m++) {
        html += '<div class="tip-row"><span class="tip-dot" style="background:' + items[m].color + '"></span><span class="tip-name">' + items[m].name + '</span><span class="tip-val">' + fmt(items[m].v) + '</span></div>';
      }
      tip.innerHTML = html;
      tip.classList.add('is-on');

      var left = ev.clientX - rect.left + 16;
      var top = ev.clientY - rect.top + 12;
      if (left + 210 > rect.width) left = ev.clientX - rect.left - 210;
      if (top + tip.offsetHeight > rect.height + 40) top = ev.clientY - rect.top - tip.offsetHeight - 12;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    function leave() {
      guide.setAttribute('opacity', '0');
      tip.classList.remove('is-on');
    }

    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchstart', function (e) { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    hit.addEventListener('touchmove', function (e) { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    hit.addEventListener('touchend', leave);
  }

  /* ── 明细表 ── */
  function drawTable(rows) {
    var sorted = sortRows(rows);
    var html = [];
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      html.push('<tr>');
      html.push(
        '<td><div class="stars-name"><a href="https://github.com/' + r.fullName + '" target="_blank" rel="noopener">' + esc(r.name) + '</a><span class="stars-sub-line">' + esc(r.owner) + (r.desc ? ' · ' + esc(r.desc.slice(0, 42)) : '') + '</span></div></td>'
      );
      html.push('<td><span class="stars-tag">' + esc(r.category) + '</span></td>');
      html.push('<td class="stars-num stars-num-strong">' + fmt(r.stars) + '</td>');
      html.push('<td class="stars-num">' + deltaCell(r, 1) + '</td>');
      html.push('<td class="stars-num">' + deltaCell(r, 7) + '</td>');
      html.push('<td class="stars-num">' + deltaCell(r, 30) + '</td>');
      html.push('<td>' + spark(r.series) + '</td>');
      html.push('<td class="stars-num">' + (r.license && r.license !== 'NOASSERTION' ? esc(r.license) : '—') + '</td>');
      html.push('</tr>');
    }
    el('stars-rows').innerHTML = html.join('');
    var cnt = el('stars-count');
    if (cnt) cnt.textContent = rows.length;

    var note = el('stars-note');
    if (note) {
      var ns = 0, nr = 0, nn = 0;
      for (var q = 0; q < sorted.length; q++) {
        var src = sorted[q][state.win + 'src'];
        if (src === 'series') ns++;
        else if (src === 'rank') nr++;
        else nn++;
      }
      note.innerHTML = '按' + WIN_LABEL[state.win] + '增速口径：<b>' + ns + '</b> 项来自逐日快照实测，' +
        '<b>' + nr + '</b> 项按榜单的日均新增折算（快照攒够 ' + WIN_DAYS[state.win] + ' 天后自动转为实测），' +
        (nn ? '<b>' + nn + '</b> 项库龄超过 90 天又没有周期增量，不参与增速排序。' : '其余项无增速数据。') +
        ' 星标会被刷，单看增速容易被营销活动带偏。';
    }
  }

  function spark(series) {
    var w = 92, h = 26, pad = 2;
    if (series.length < 2) return '<span class="delta-flat" style="font-family:var(--font-mono);font-size:11px">待积累</span>';
    var vals = series.map(function (p) { return p[1]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var pts = [];
    for (var i = 0; i < vals.length; i++) {
      var x = pad + (i * (w - pad * 2)) / (vals.length - 1);
      var y = h - pad - ((vals[i] - min) / (max - min)) * (h - pad * 2);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var up = vals[vals.length - 1] >= vals[0];
    var color = up ? '#d4692a' : '#4a9e7f';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  }

  /* ── 本期看点：最大 / 最快 / 最慢 ── */
  function renderPick(rows) {
    var box = el('stars-pick');
    if (!box || !rows.length) return;

    var biggest = rows[0];
    for (var i = 1; i < rows.length; i++) { if (rows[i].stars > biggest.stars) biggest = rows[i]; }

    var fast = null, slow = null;
    for (var j = 0; j < rows.length; j++) {
      var v = rows[j][state.win];
      if (v === null || v === undefined) continue;
      if (!fast || v > fast[state.win]) fast = rows[j];
      if (!slow || v < slow[state.win]) slow = rows[j];
    }

    var out = [];
    out.push('<div class="pick-item"><span class="pick-k">体量最大</span><span class="pick-v"><a href="https://github.com/' + biggest.fullName + '" target="_blank" rel="noopener">' + esc(biggest.name) + '</a> <b>' + fmt(biggest.stars) + '</b></span></div>');

    if (fast) {
      out.push('<div class="pick-item"><span class="pick-k">' + WIN_LABEL[state.win] + '最快</span><span class="pick-v"><a href="https://github.com/' + fast.fullName + '" target="_blank" rel="noopener">' + esc(fast.name) + '</a> <b class="' + (fast[state.win] >= 0 ? 'delta-up' : 'delta-down') + '">' + (fast[state.win + 'src'] === 'rank' ? '≈' : '') + pctText(fast[state.win]) + '</b></span></div>');
      if (slow && slow !== fast) {
        out.push('<div class="pick-item"><span class="pick-k">' + WIN_LABEL[state.win] + '最慢</span><span class="pick-v"><a href="https://github.com/' + slow.fullName + '" target="_blank" rel="noopener">' + esc(slow.name) + '</a> <b class="' + (slow[state.win] >= 0 ? 'delta-up' : 'delta-down') + '">' + (slow[state.win + 'src'] === 'rank' ? '≈' : '') + pctText(slow[state.win]) + '</b></span></div>');
      }
    } else {
      out.push('<div class="pick-item"><span class="pick-k">增速</span><span class="pick-v">等下一次采样</span></div>');
    }

    box.innerHTML = out.join('');
  }

  function render() {
    var block = el('stars');
    if (block) block.setAttribute('data-view', state.view);
    var rows = sortRows(state.repos);
    if (state.view === 'heat') drawHeat(rows);
    else drawLine(rows.slice(0, 8));
    drawTable(state.repos);
    renderPick(state.repos);
  }

  function bindSort() {
    var ths = document.querySelectorAll('.stars-block th.sortable');
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener('click', function () {
        var key = this.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        for (var j = 0; j < ths.length; j++) ths[j].removeAttribute('aria-sort');
        this.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
        render();
      });
    }
  }

  function bindSeg(role, attr, apply) {
    var seg = document.querySelector('.stars-seg[data-role="' + role + '"]');
    if (!seg) return;
    var btns = seg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', 'false');
        this.setAttribute('aria-pressed', 'true');
        apply(this.getAttribute(attr));
        render();
      });
    }
  }

  function boot(data, rank) {
    state.rank = {};
    if (rank && rank.items && rank.items.length) {
      for (var i = 0; i < rank.items.length; i++) {
        var it = rank.items[i];
        if (it && it.repo) state.rank[String(it.repo).toLowerCase()] = it;
      }
    }
    state.repos = buildRows(data);
    var all = {};
    for (var j = 0; j < state.repos.length; j++) {
      for (var k = 0; k < state.repos[j].series.length; k++) all[state.repos[j].series[k][0]] = 1;
    }
    state.days = Object.keys(all).sort();

    var meta = el('stars-meta');
    if (meta) meta.textContent = '更新 ' + (data.updated || '—') + ' · 采样 ' + state.days.length + ' 天 · ' + state.repos.length + ' 个项目';

    if (!state.days.length) {
      el('stars-chart').innerHTML = '<div class="stars-empty">还没有快照数据。<br>跑一次 <code>node scripts/stars-snapshot.cjs</code> 就有了。</div>';
      return;
    }

    bindSort();
    bindSeg('view', 'data-view', function (v) { state.view = v; });
    bindSeg('win', 'data-win', function (v) { state.win = v; });
    bindSeg('scale', 'data-scale', function (v) { state.scale = v; });
    render();

    var rt;
    window.addEventListener('resize', function () {
      if (state.view !== 'heat') return;
      clearTimeout(rt);
      rt = setTimeout(function () { drawHeat(sortRows(state.repos)); }, 180);
    });

    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (state.view === 'heat') drawHeat(sortRows(state.repos));
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  if (!el('stars-chart')) return;

  /* data.json 是每日快照，rank.json 是增速榜；两份都读，缺了 rank 就退回纯快照口径 */
  Promise.all([
    fetch('stars/data.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }),
    fetch('stars/rank.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }),
  ])
    .then(function (res) { boot(res[0], res[1]); })
    .catch(function (e) {
      if (window.console && console.error) console.error('[stars] 渲染失败：', e);
      el('stars-chart').innerHTML = '<div class="stars-empty">读不到 stars/data.json。<br>先跑一次 <code>node scripts/stars-snapshot.cjs</code>。</div>';
      var meta = el('stars-meta');
      if (meta) meta.textContent = '数据缺失';
    });
})();
