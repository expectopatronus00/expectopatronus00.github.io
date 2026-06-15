document.addEventListener('DOMContentLoaded', function(){
  var loader = document.getElementById('loader');
  window.addEventListener('load', function(){
    setTimeout(function(){
      if(loader){ loader.style.opacity='0'; setTimeout(function(){ loader.remove(); }, 400); }
    }, 300);
  });

  var themeBtn = document.getElementById('theme-toggle');
  if(themeBtn){
    var i = themeBtn.querySelector('i');
    function applyTheme(){
      var d = document.documentElement.dataset.theme || 'dark';
      i.className = d==='light' ? 'fa-regular fa-sun' : 'fa-solid fa-moon';
    }
    applyTheme();
    themeBtn.addEventListener('click', function(){
      var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try{ localStorage.setItem('theme', next); }catch(e){}
      applyTheme();
    });
  }

  var back = document.getElementById('back');
  if(back){
    window.addEventListener('scroll', function(){
      if(window.scrollY > 500) back.classList.add('show'); else back.classList.remove('show');
    });
    back.addEventListener('click', function(){ window.scrollTo({top:0,behavior:'smooth'}); });
  }

  var scrollProgress = document.getElementById('progress');
  if(scrollProgress){
    window.addEventListener('scroll', function(){
      var h = document.documentElement;
      var p = h.scrollTop / (h.scrollHeight - h.clientHeight);
      scrollProgress.style.width = Math.round(p*100)+'%';
    });
  }

  var articles = (typeof window.articles !== 'undefined' ? window.articles : []);

  function fmtDate(s){ return s ? s.slice(0,10).replace(/-/g,'/') : ''; }

  function renderList(list){
    var grid = document.getElementById('grid');
    if(!grid) return;
    if(!list.length){
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--mute);padding:60px 0;">没有符合条件的文章</p>';
      return;
    }
    grid.innerHTML = list.map(function(a){
      var cat = (a.category||'').toLowerCase();
      var catcls = cat.replace(/[^a-z]/g,'');
      if(catcls==='') catcls = 'tech';
      if(cat==='抖音搬运') catcls = 'douyin';
      if(cat==='IT运维') catcls = 'itops';
      if(cat==='Web开发') catcls = 'webdev';
      return (
        '<a class="article-card" href="'+a.url+'" target="'+(a.url.startsWith('http')?'_blank':'_self')+'" rel="noopener">'+
          (a.feat?'<span class="feat-badge">FEATURED</span>':'')+
          '<div class="cat-tag '+catcls+'"><i class="fa-solid fa-folder"></i> '+a.category+'</div>'+
          '<div class="title">'+a.title+'</div>'+
          '<div class="summary">'+(a.summary||'')+'</div>'+
          '<div class="meta">'+
            '<span><i class="fa-regular fa-calendar"></i> '+fmtDate(a.date)+'</span>'+
            '<span><i class="fa-regular fa-clock"></i> '+(a.read||8)+' 分钟</span>'+
            '<span><i class="fa-regular fa-eye"></i> '+(a.views||0)+'</span>'+
          '</div>'+
        '</a>'
      );
    }).join('');

    // reveal on scroll
    var cards = grid.querySelectorAll('.article-card');
    if(cards.length){
      var obs = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(e.isIntersecting){
            e.target.style.opacity='1';
            e.target.style.transform='translateY(0)';
            obs.unobserve(e.target);
          }
        });
      },{threshold:.1});
      cards.forEach(function(el,i){
        el.style.opacity='0'; el.style.transform='translateY(16px)';
        obs.observe(el);
      });
    }
  }

  function renderPopular(list){
    var ul = document.getElementById('popular'); if(!ul) return;
    var hot = list.slice(0,10);
    ul.innerHTML = hot.map(function(a,i){
      return '<li><a href="'+a.url+'" target="'+(a.url.startsWith('http')?'_blank':'_self')+'" rel="noopener"><span class="idx">'+(i+1)+'</span><span class="t">'+a.title+'</span></a></li>';
    }).join('');
  }

  function renderTags(list){
    var box = document.getElementById('tags'); if(!box) return;
    var map = {};
    list.forEach(function(a){
      (a.tags||[]).forEach(function(t){ map[t]=(map[t]||0)+1; });
    });
    var tags = Object.entries(map).sort(function(a,b){return b[1]-a[1]}).slice(0,20);
    box.innerHTML = tags.map(function(t){ return '<span data-tag="'+t[0]+'">#'+t[0]+' ('+t[1]+')</span>'; }).join('');
    box.querySelectorAll('[data-tag]').forEach(function(el){
      el.addEventListener('click', function(){ setFilter('__tag__:'+el.dataset.tag); });
    });
  }

  function renderStats(list){
    var a = document.getElementById('stat-art'); var t = document.getElementById('stat-tag'); var c = document.getElementById('stat-cat');
    if(a) a.textContent = list.length;
    var tagMap = {}; list.forEach(function(x){ (x.tags||[]).forEach(function(t){ tagMap[t]=1; }); });
    if(t) t.textContent = Object.keys(tagMap).length;
    var catMap = {}; list.forEach(function(x){ catMap[x.category]=(catMap[x.category]||0)+1; });
    var topCat = Object.entries(catMap).sort(function(a,b){return b[1]-a[1]})[0];
    if(c) c.textContent = topCat ? (topCat[0]+' ('+topCat[1]+')') : '-';
  }

  var currentCat = '';
  var currentTag = '';
  var currentQuery = '';
  var catBtns = document.querySelectorAll('.filters button');
  catBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      catBtns.forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      setFilter(btn.dataset.cat||'');
    });
  });

  var search = document.getElementById('q');
  if(search){
    search.addEventListener('input', function(){ currentQuery = search.value.trim().toLowerCase(); applyFilters(); });
  }

  function setFilter(v){
    if(v && v.indexOf('__tag__:')===0){
      currentTag = v.replace(/^__tag__:/,'');
      currentCat = '';
      catBtns.forEach(function(b){ b.classList.remove('active'); });
    } else {
      currentTag = '';
      currentCat = v || '';
      if(!v) catBtns.forEach(function(b){ if(!b.dataset.cat) b.classList.add('active'); else b.classList.remove('active'); });
    }
    applyFilters();
  }

  function applyFilters(){
    var q = articles.slice();
    if(currentCat){ q = q.filter(function(a){ return a.category===currentCat; }); }
    if(currentTag){ q = q.filter(function(a){ return (a.tags||[]).indexOf(currentTag)>-1; }); }
    if(currentQuery){
      q = q.filter(function(a){
        return (a.title||'').toLowerCase().indexOf(currentQuery)>-1 ||
               (a.summary||'').toLowerCase().indexOf(currentQuery)>-1 ||
               (a.tags||[]).some(function(t){ return (''+t).toLowerCase().indexOf(currentQuery)>-1; });
      });
    }
    q.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    renderList(q);
  }

  renderStats(articles);
  renderTags(articles);
  renderPopular(articles.slice().sort(function(a,b){ return (b.views||0)-(a.views||0); }));
  applyFilters();
});
