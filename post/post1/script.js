(function () {
  const stars = document.getElementById('stars-bg');
  const ctx = stars.getContext('2d');
  let W = 0,
    H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const count = 100;
  const arr = [];
  const mouse = { x: 9999, y: 9999 };

  function resize() {
    W = stars.clientWidth = window.innerWidth;
    H = stars.clientHeight = window.innerHeight;
    stars.width = W * DPR;
    stars.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function init() {
    arr.length = 0;
    for (let i = 0; i < count; i++) {
      arr.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random() * 1 + 0.2,
        r: Math.random() * 1.2 + 0.3,
        hue: 200 + Math.random() * 90,
        off: Math.random() * Math.PI * 2,
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of arr) {
      s.off += 0.02;
      const tw = 0.6 + Math.sin(s.off) * 0.4;
      const dx = mouse.x - s.x,
        dy = mouse.y - s.y;
      const d2 = dx * dx + dy * dy;
      let fx = 0,
        fy = 0;
      if (d2 < 16000) {
        const f = ((16000 - d2) / 16000) * 10;
        fx = (-dx / Math.sqrt(d2)) * f;
        fy = (-dy / Math.sqrt(d2)) * f;
      }
      s.x += (Math.sin(s.off * 0.3) * 0.2 + fx) * s.z;
      s.y += (Math.cos(s.off * 0.27) * 0.2 + fy) * s.z;
      if (s.x < 0) s.x += W;
      if (s.x > W) s.x -= W;
      if (s.y < 0) s.y += H;
      if (s.y > H) s.y -= H;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * tw, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
      g.addColorStop(0, `hsla(${s.hue}, 90%, 70%, ${0.8 * tw})`);
      g.addColorStop(0.4, `hsla(${s.hue + 20}, 80%, 60%, ${0.2 * tw})`);
      g.addColorStop(1, 'hsla(220,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  let raf = 0;
  function loop() {
    draw();
    raf = requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => {
    resize();
    init();
  });
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mouseleave', () => {
    mouse.x = mouse.y = 9999;
  });
  resize();
  init();
  loop();
})();

hljs.configure({ classPrefix: 'hljs-' });
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('pre code').forEach((el) => {
    hljs.highlightElement(el);
  });
});

document.querySelectorAll('pre').forEach((pre) => {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';
  btn.title = '点击复制代码';
  btn.addEventListener('click', async () => {
    const code = pre.querySelector('code');
    const text = code ? code.textContent : pre.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      btn.innerHTML = '<i class="fa-solid fa-check"></i> 已复制';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';
      }, 1600);
    } catch {
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 失败';
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';
      }, 1600);
    }
  });
  pre.appendChild(btn);
});

(function buildToc() {
  const list = document.getElementById('toc-list');
  const hs = document.querySelectorAll('.article-body h2');
  const map = [];
  hs.forEach((h, i) => {
    const id = h.id || `sec-${i + 1}`;
    if (!h.id) h.id = id;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = h.textContent;
    a.dataset.id = id;
    li.appendChild(a);
    list.appendChild(li);
    map.push({ id, el: a, header: h });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          map.forEach((m) => m.el.classList.toggle('active', m.header === e.target));
        }
      });
    },
    { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
  );
  hs.forEach((h) => observer.observe(h));
})();

(function scrollUI() {
  const progress = document.getElementById('progress');
  const back = document.getElementById('back');
  window.addEventListener(
    'scroll',
    () => {
      const p = Math.min(1, window.scrollY / Math.max(1, document.body.scrollHeight - innerHeight));
      progress.style.width = (p * 100).toFixed(1) + '%';
      back.classList.toggle('show', window.scrollY > 260);
    },
    { passive: true },
  );
  back.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

(function visitCounter() {
  let n = parseInt(localStorage.getItem('pv-post1') || '0') + 1;
  localStorage.setItem('pv-post1', String(n));
  document.getElementById('view-count').textContent = n.toLocaleString();
})();

(function stars() {
  const key = 'rating-post1';
  const save = JSON.parse(localStorage.getItem(key) || 'null');
  const stars = document.querySelectorAll('#stars .fa-star');
  const count = document.getElementById('rating-count');
  let avg = 0,
    total = 0;
  if (save) {
    avg = save.avg;
    total = save.n;
    renderStars(save.v);
    count.textContent = `(${total} 人评分 · 平均 ${avg.toFixed(1)})`;
  }
  function renderStars(v) {
    stars.forEach((s, i) => {
      if (i < v) {
        s.classList.add('fa-solid');
        s.classList.remove('fa-regular');
        s.classList.add('active');
      } else {
        s.classList.remove('fa-solid');
        s.classList.add('fa-regular');
        s.classList.remove('active');
      }
    });
  }
  stars.forEach((s) => {
    s.addEventListener('click', () => {
      const v = parseInt(s.dataset.v);
      const newTotal = total + 1;
      const newAvg = total ? (avg * total + v) / newTotal : v;
      localStorage.setItem(key, JSON.stringify({ v, n: newTotal, avg: newAvg }));
      renderStars(v);
      count.textContent = `(${newTotal} 人评分 · 平均 ${newAvg.toFixed(1)})`;
      total = newTotal;
      avg = newAvg;
    });
    s.addEventListener('mouseenter', () => renderStars(parseInt(s.dataset.v)));
    s.addEventListener('mouseleave', () => save && renderStars(save.v));
  });
})();

document.getElementById('share-weibo')?.addEventListener('click', () => {
  const u = encodeURIComponent(location.href);
  const t = encodeURIComponent(document.title);
  window.open(`https://service.weibo.com/share/share.php?url=${u}&title=${t}`, '_blank');
});
document.getElementById('share-wechat')?.addEventListener('click', (e) => {
  e.preventDefault();
  alert('微信号: expectopatronus00');
});
document.getElementById('share-link')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    alert('链接已复制');
  } catch {
    alert('请手动复制');
  }
});

document.getElementById('wechat-footer')?.addEventListener('click', (e) => {
  e.preventDefault();
  alert('微信号: expectopatronus00');
});

document.getElementById('comment-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('comment-name').value.trim();
  const email = document.getElementById('comment-email').value.trim();
  const text = document.getElementById('comment-content').value.trim();
  if (!text) {
    document.getElementById('comment-content').focus();
    return;
  }
  const all = JSON.parse(localStorage.getItem('comments-post1') || '[]');
  all.unshift({ name: name || '匿名', email, text, time: new Date().toLocaleString() });
  localStorage.setItem('comments-post1', JSON.stringify(all));
  document.getElementById('comment-name').value = '';
  document.getElementById('comment-email').value = '';
  document.getElementById('comment-content').value = '';
  alert('留言已保存（纯本地）。');
});

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  const icon = document.querySelector('#theme-toggle i');
  if (icon) {
    icon.className = next === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
});
(function restoreTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.documentElement.dataset.theme = 'light';
    const i = document.querySelector('#theme-toggle i');
    if (i) i.className = 'fa-solid fa-sun';
  }
})();
