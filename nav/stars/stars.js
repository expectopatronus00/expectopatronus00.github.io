/* 开源 AI 星标榜 · 由 nav/index.html 引入，读 stars/data.json
   依赖页面里这几个容器：#stars-meta #stars-chart #stars-tip #stars-legend
   #stars-rows #stars-count #stars-note #stars-shell */
(function () {
  'use strict';

  var PALETTE = ['#d4692a', '#4a9e7f', '#b8915c', '#7f77dd', '#5a9bd4', '#d4537e', '#639922', '#8a8ea8'];
  var state = { sort: 'stars', dir: -1, mode: 'abs', repos: [], days: [] };

  function el(id) { return document.getElementById(id); }

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

  function buildRows(data) {
    var rows = [];
    for (var i = 0; i < data.repos.length; i++) {
      var r = data.repos[i];
      var s = data.series[r.repo] || [];
      if (!s.length) continue;
      var now = s[s.length - 1][1];
      var d1 = valueAt(s, daysAgo(1));
      var d7 = valueAt(s, daysAgo(7));
      var d30 = valueAt(s, daysAgo(30));
      rows.push({
        repo: r.repo,
        name: r.name || r.repo.split('/')[1],
        owner: r.owner || r.repo.split('/')[0],
        desc: r.desc || '',
        category: r.category || '未分类',
        license: r.license || '',
        stars: now,
        d1: d1 === null ? null : now - d1,
        d7: d7 === null ? null : now - d7,
        d30: d30 === null ? null : now - d30,
        series: s,
      });
    }
    return rows;
  }

  function sortRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      if (key === 'name') {
        return a.name.toLowerCase() < b.name.toLowerCase() ? -dir : dir;
      }
      var av = a[key];
      var bv = b[key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }

  /* ── 折线图 ── */
  function drawLine(rows) {
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
        pts.push({ i: j, v: state.mode === 'norm' ? (v / first) * 100 : v, raw: v });
      }
      series.push({ name: rows[i].name, color: PALETTE[i % PALETTE.length], pts: pts });
    }

    var all = [];
    for (var a = 0; a < series.length; a++) for (var b = 0; b < series[a].pts.length; b++) all.push(series[a].pts[b].v);
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min = min * 0.98; max = max * 1.02; }
    var pad = (max - min) * 0.12;
    min -= pad; max += pad;
    if (state.mode === 'norm') { min = Math.min(min, 100); max = Math.max(max, 100); }

    function x(i) { return ml + (n <= 1 ? 0 : (i * (W - ml - mr)) / (n - 1)); }
    function y(v) { return mt + (1 - (v - min) / (max - min)) * (H - mt - mb); }

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="星标趋势折线图">');

    for (var g = 0; g <= 4; g++) {
      var gv = min + ((max - min) * g) / 4;
      var gy = y(gv);
      svg.push('<line x1="' + ml + '" y1="' + gy.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + gy.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>');
      var label = state.mode === 'norm' ? gv.toFixed(0) : fmt(Math.round(gv));
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

    el('stars-chart').innerHTML = svg.join('');

    var lg = [];
    for (var q = 0; q < series.length; q++) {
      lg.push('<span class="legend-item"><span class="legend-swatch" style="background:' + series[q].color + '"></span>' + series[q].name + '</span>');
    }
    el('stars-legend').innerHTML = lg.join('');

    bindHover(series, x, n, ml, mr, W);
  }

  function bindHover(series, x, n, ml, mr, W) {
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

  /* ── 只有一天数据时的横向条形图 ── */
  function drawBars(rows) {
    var top = rows.slice(0, 12);
    var max = top.length ? top[0].stars : 1;
    var W = 900, rowH = 30, ml = 180, mr = 70;
    var H = top.length * rowH + 20;
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="当前星标横向条形图">'];
    for (var i = 0; i < top.length; i++) {
      var y = 10 + i * rowH;
      var w = ((W - ml - mr) * top[i].stars) / max;
      svg.push('<text x="' + (ml - 10) + '" y="' + (y + 13) + '" text-anchor="end" font-family="var(--font-sans)" font-size="13" fill="var(--text-soft)">' + top[i].name + '</text>');
      svg.push('<rect x="' + ml + '" y="' + (y + 2) + '" width="' + w.toFixed(1) + '" height="16" rx="3" fill="' + PALETTE[i % PALETTE.length] + '" opacity="0.85"/>');
      svg.push('<text x="' + (ml + w + 8) + '" y="' + (y + 14) + '" font-family="var(--font-mono)" font-size="12" fill="var(--text-dim)">' + fmt(top[i].stars) + '</text>');
    }
    svg.push('</svg>');
    el('stars-chart').innerHTML = svg.join('');
    el('stars-legend').innerHTML = '';
    el('stars-note').textContent = '当前只有 1 天快照，先看总量；明天起切换为折线趋势';
  }

  /* ── 表格 ── */
  function drawTable(rows) {
    var sorted = sortRows(rows);
    var html = [];
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      html.push('<tr>');
      html.push(
        '<td><div class="stars-name"><a href="https://github.com/' + r.repo + '" target="_blank" rel="noopener">' + r.name + '</a><span class="stars-sub-line">' + r.owner + (r.desc ? ' · ' + r.desc.slice(0, 42) : '') + '</span></div></td>'
      );
      html.push('<td><span class="stars-tag">' + r.category + '</span></td>');
      html.push('<td class="stars-num stars-num-strong">' + fmt(r.stars) + '</td>');
      html.push('<td class="stars-num">' + deltaHtml(r.d1) + '</td>');
      html.push('<td class="stars-num">' + deltaHtml(r.d7) + '</td>');
      html.push('<td class="stars-num">' + deltaHtml(r.d30) + '</td>');
      html.push('<td>' + spark(r.series) + '</td>');
      html.push('<td class="stars-num">' + (r.license && r.license !== 'NOASSERTION' ? r.license : '—') + '</td>');
      html.push('</tr>');
    }
    el('stars-rows').innerHTML = html.join('');
    var cnt = el('stars-count');
    if (cnt) cnt.textContent = rows.length;
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

  function render() {
    var rows = sortRows(state.repos);
    if (state.days.length < 2) drawBars(rows);
    else drawLine(rows.slice(0, 8));
    drawTable(state.repos);
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

  function bindMode() {
    var btns = document.querySelectorAll('.stars-seg button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', 'false');
        this.setAttribute('aria-pressed', 'true');
        state.mode = this.getAttribute('data-mode');
        render();
      });
    }
  }

  function boot(data) {
    state.repos = buildRows(data);
    var all = {};
    for (var i = 0; i < state.repos.length; i++) {
      for (var k = 0; k < state.repos[i].series.length; k++) all[state.repos[i].series[k][0]] = 1;
    }
    state.days = Object.keys(all).sort();
    el('stars-meta').textContent = '更新 ' + (data.updated || '—') + ' · 采样 ' + state.days.length + ' 天 · ' + state.repos.length + ' 个项目';
    if (!state.days.length) {
      el('stars-chart').innerHTML = '<div class="stars-empty">还没有快照数据。<br>跑一次 <code>node scripts/stars-snapshot.cjs</code> 就有了。</div>';
      return;
    }
    bindSort();
    bindMode();
    render();
  }

  if (!el('stars-chart')) return;

  fetch('stars/data.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(boot)
    .catch(function () {
      el('stars-chart').innerHTML = '<div class="stars-empty">读不到 stars/data.json。<br>先跑一次 <code>node scripts/stars-snapshot.cjs</code>。</div>';
      el('stars-meta').textContent = '数据缺失';
    });
})();
