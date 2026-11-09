/* OpeboboTV TV — written in plain ES5 so it also runs on older smart-TV browsers
   (Tizen, webOS, Android TV, Fire TV, Vidaa...). Focus is managed by us (not the browser):
   arrow keys move between on-screen items spatially, OK/Enter activates, Back goes back. */
(function () {
  'use strict';

  var IMG = 'https://image.tmdb.org/t/p/';
  var app = document.getElementById('app');
  var modalEl = document.getElementById('modal');
  var modalBody = document.getElementById('modal-body');
  var toastEl = document.getElementById('toast');

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  var S = {
    list: lsGet('cj_list', []),
    region: lsGet('cj_region', 'US'),
    genres: { movie: [], tv: [] },
    demo: false, auth: 'none',
    token: 0, route: '', navCount: 0,
    cur: null, mem: {}, want: null, wantY: 0, wantTimer: null, keep: null,
    timer: null, cache: {}, modalOn: false, modalPrev: null,
    query: '', searchSeq: 0, searchTimer: null
  };

  /* ---------------------------------------------------------------- helpers */
  function add(e, c) {
    var i;
    if (c === null || c === undefined || c === false) { return; }
    if (Object.prototype.toString.call(c) === '[object Array]') { for (i = 0; i < c.length; i++) { add(e, c[i]); } }
    else if (c.nodeType) { e.appendChild(c); }
    else { e.appendChild(document.createTextNode(String(c))); }
  }
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v, i;
    if (attrs) {
      for (k in attrs) {
        if (!attrs.hasOwnProperty(k)) { continue; }
        v = attrs[k];
        if (v === null || v === undefined || v === false) { continue; }
        if (k === 'class') { e.className = v; }
        else if (k === 'style') { e.style.cssText = v; }
        else if (k === 'text') { e.textContent = v; }
        else if (k === 'html') { e.innerHTML = v; }
        else if (k.indexOf('on') === 0) { e.addEventListener(k.slice(2), v); }
        else { e.setAttribute(k, v === true ? '' : v); }
      }
    }
    for (i = 2; i < arguments.length; i++) { add(e, arguments[i]); }
    return e;
  }
  function clear(e) { while (e.firstChild) { e.removeChild(e.firstChild); } }
  function closest(el, cls) {
    while (el && el.classList) { if (el.classList.contains(cls)) { return el; } el = el.parentNode; }
    return null;
  }
  function raf(fn) { return (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }
  function titleOf(x) { return x.title || x.name || 'Untitled'; }
  function yearOf(x) { return String(x.release_date || x.first_air_date || '').slice(0, 4); }
  function typeOf(x, fb) {
    if (x.media_type === 'tv' || x.media_type === 'movie') { return x.media_type; }
    if (x.first_air_date !== undefined && x.release_date === undefined) { return 'tv'; }
    return fb || 'movie';
  }
  function hueOf(x) { return x.hue === undefined || x.hue === null ? (x.id * 47) % 360 : x.hue; }
  function hueBg(hue) { return 'linear-gradient(160deg,hsl(' + hue + ',55%,32%),hsl(' + ((hue + 50) % 360) + ',60%,14%))'; }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.style.display = 'none'; }, 2200);
  }
  function inList(id, type) { var i; for (i = 0; i < S.list.length; i++) { if (S.list[i].id === id && S.list[i].type === type) { return true; } } return false; }
  function toggleList(x, type) {
    var i, found = -1;
    for (i = 0; i < S.list.length; i++) { if (S.list[i].id === x.id && S.list[i].type === type) { found = i; } }
    if (found >= 0) { S.list.splice(found, 1); toast('Removed from My List'); }
    else {
      S.list.unshift({ id: x.id, type: type, title: titleOf(x), poster_path: x.poster_path || null, hue: hueOf(x), year: yearOf(x), vote: x.vote_average || 0 });
      toast('Added to My List');
    }
    lsSet('cj_list', S.list);
    return found < 0;
  }

  function api(path, params, cb) {
    var q = [], k;
    params = params || {};
    for (k in params) {
      if (params.hasOwnProperty(k) && params[k] !== null && params[k] !== undefined && params[k] !== '') {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    var cfg = window.OPEBOBO_CONFIG || {};
    q.push('api_key=' + encodeURIComponent(cfg.tmdbKey || ''));
    var url = 'https://api.themoviedb.org/3/' + path + '?' + q.join('&');
    if (S.cache[url]) { setTimeout(function () { cb(null, S.cache[url]); }, 0); return; }
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.onreadystatechange = function () {
      var d;
      if (x.readyState !== 4) { return; }
      if (x.status >= 200 && x.status < 300) {
        try { d = JSON.parse(x.responseText); } catch (e) { cb(e); return; }
        S.cache[url] = d; cb(null, d);
      } else { cb(new Error('HTTP ' + x.status)); }
    };
    x.send();
  }

  function ensureGenres(cb) {
    if (S.genres.movie.length) { cb(); return; }
    var left = 2;
    function done() { left--; if (left === 0) { cb(); } }
    api('genre/movie/list', {}, function (e, d) { if (!e && d) { S.genres.movie = d.genres || []; } done(); });
    api('genre/tv/list', {}, function (e, d) { if (!e && d) { S.genres.tv = d.genres || []; } done(); });
  }
  function genreName(type, id) {
    var g = S.genres[type], i;
    for (i = 0; i < g.length; i++) { if (g[i].id === id) { return g[i].name; } }
    return null;
  }

  /* --------------------------------------------------------- focus + scrolling */
  var animId = 0;
  function scrollToY(y, instant) {
    y = Math.max(0, Math.round(y));
    var from = window.pageYOffset, t0 = new Date().getTime(), dur = 230, id;
    if (Math.abs(y - from) < 2) { return; }
    animId++; id = animId;
    if (instant) { window.scrollTo(0, y); return; }
    function step() {
      if (id !== animId) { return; }
      var p = Math.min(1, (new Date().getTime() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      window.scrollTo(0, from + (y - from) * e);
      if (p < 1) { raf(step); }
    }
    step();
  }
  function ensureVisible(el, instant) {
    var hs = closest(el, 'hs'), r, vh = window.innerHeight, cs, padL, padR, l, w, sl;
    if (hs) {
      cs = window.getComputedStyle(hs);
      padL = parseFloat(cs.paddingLeft) || 0; padR = parseFloat(cs.paddingRight) || 0;
      l = el.offsetLeft; w = el.offsetWidth; sl = hs.scrollLeft;
      if (l - sl < padL) { hs.scrollLeft = Math.max(0, l - padL); }
      else if (l + w - sl > hs.clientWidth - padR) { hs.scrollLeft = l + w - hs.clientWidth + padR; }
    }
    if (closest(el, 'top')) { scrollToY(0, instant); return; }
    r = el.getBoundingClientRect();
    if (r.top < vh * 0.16 || r.bottom > vh * 0.9) {
      scrollToY(window.pageYOffset + r.top + r.height / 2 - vh * 0.46, instant);
    }
  }
  function setFocus(el, instant, noScroll) {
    if (S.cur && S.cur !== el) { S.cur.classList.remove('focus'); }
    S.cur = el; el.classList.add('focus');
    if (!noScroll) { ensureVisible(el, instant); }
    var k = el.getAttribute('data-k');
    if (k) { if (!S.mem[S.route]) { S.mem[S.route] = {}; } S.mem[S.route].key = k; }
    if (el._onfocus) { el._onfocus(); }
  }
  function focusables() {
    var root = S.modalOn ? modalEl : document, list = root.querySelectorAll('.f'), out = [], i, r;
    for (i = 0; i < list.length; i++) {
      r = list[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { out.push(list[i]); }
    }
    return out;
  }
  function move(dir) {
    var cur = S.cur, list, c, cx, cy, best = null, bs = 1e12, i, e, r, rx, ry, prim, cross, overlap, score;
    S.userMoved = true;
    if (!cur || !document.body.contains(cur) || cur.getBoundingClientRect().width === 0) {
      list = focusables(); if (list.length) { setFocus(list[0]); } return;
    }
    c = cur.getBoundingClientRect(); cx = (c.left + c.right) / 2; cy = (c.top + c.bottom) / 2;
    list = focusables();
    for (i = 0; i < list.length; i++) {
      e = list[i]; if (e === cur) { continue; }
      r = e.getBoundingClientRect(); rx = (r.left + r.right) / 2; ry = (r.top + r.bottom) / 2;
      if (dir === 'left' || dir === 'right') {
        if (dir === 'right' ? rx <= cx + 2 : rx >= cx - 2) { continue; }
        prim = Math.abs(rx - cx); cross = Math.abs(ry - cy); overlap = !(r.bottom <= c.top + 2 || r.top >= c.bottom - 2);
      } else {
        if (dir === 'down' ? ry <= cy + 2 : ry >= cy - 2) { continue; }
        prim = Math.abs(ry - cy); cross = Math.abs(rx - cx); overlap = !(r.right <= c.left + 2 || r.left >= c.right - 2);
      }
      score = prim + cross * 2.5 + (overlap ? 0 : 4000);
      if (score < bs) { bs = score; best = e; }
    }
    if (best) { setFocus(best); }
  }
  function settle() {
    var t, d;
    if (S.modalOn) { return; }
    if (S.want) {
      t = document.querySelector('[data-k="' + S.want + '"]');
      if (t && t.getBoundingClientRect().width > 0) {
        S.want = null; S.userMoved = true; setFocus(t, true);
        if (S.wantY) { window.scrollTo(0, S.wantY); }
      }
      return;
    }
    if (!S.cur || !document.body.contains(S.cur)) {
      d = app.querySelector('.f.def') || app.querySelector('.f') || document.querySelector('#nav .f');
      if (d) { setFocus(d, true); }
      return;
    }
    // Before the user has pressed anything: if focus is parked on the nav bar (because the page was
    // still loading), hand it to the page's main button / first item as soon as one exists.
    if (!S.userMoved) {
      d = app.querySelector('.f.def');
      if (d && d !== S.cur && d.getBoundingClientRect().width > 0) { setFocus(d, true); return; }
      if (!d) {
        // pages without a primary button (Movies, Shows, My List): start on the first poster
        d = app.querySelector('.card.f');
        if (d && d !== S.cur && d.getBoundingClientRect().width > 0) { setFocus(d, true); return; }
        if (!d && document.getElementById('nav').contains(S.cur)) {
          d = app.querySelector('.f');
          if (d && d.getBoundingClientRect().width > 0) { setFocus(d, true); }
        }
      }
    }
  }

  /* ----------------------------------------------------------------- modal */
  function closeModal(silent) {
    if (!S.modalOn) { return; }
    clear(modalBody);
    modalEl.className = ''; S.modalOn = false;
    if (!silent && S.modalPrev && document.body.contains(S.modalPrev)) { setFocus(S.modalPrev, true, true); }
    S.modalPrev = null;
  }
  function openModal(node) {
    S.modalPrev = S.cur;
    clear(modalBody); modalBody.appendChild(node);
    modalEl.className = 'on'; S.modalOn = true;
    setFocus(document.getElementById('modal-x'), true, true);
  }
  document.getElementById('modal-x').addEventListener('click', function () { closeModal(); });
  function pickTrailer(videos) {
    var v = [], all = (videos && videos.results) || [], i;
    for (i = 0; i < all.length; i++) { if (all[i].site === 'YouTube') { v.push(all[i]); } }
    for (i = 0; i < v.length; i++) { if (v[i].type === 'Trailer' && v[i].official) { return v[i]; } }
    for (i = 0; i < v.length; i++) { if (v[i].type === 'Trailer') { return v[i]; } }
    for (i = 0; i < v.length; i++) { if (v[i].type === 'Teaser') { return v[i]; } }
    return v[0] || null;
  }
  function showTrailer(video) {
    openModal(h('iframe', {
      src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(video.key) + '?autoplay=1&rel=0&playsinline=1',
      allow: 'autoplay; encrypted-media; fullscreen', allowfullscreen: true, title: 'Trailer'
    }));
  }
  function openTrailer(type, id) {
    api(type + '/' + id + '/videos', {}, function (e, d) {
      var v = e ? null : pickTrailer(d);
      if (v) { showTrailer(v); } else { toast(S.demo ? 'No trailers in demo mode' : 'No trailer found'); }
    });
  }

  /* ------------------------------------------------------------ components */
  function poster(x) {
    var box = h('div', { class: 'poster', style: 'background:' + hueBg(hueOf(x)) });
    box.appendChild(h('div', { class: 'ph', text: titleOf(x) }));
    if (x.poster_path) {
      box.appendChild(h('img', {
        src: IMG + 'w342' + x.poster_path, alt: '', onerror: function () { if (this.parentNode) { this.parentNode.removeChild(this); } }
      }));
    }
    return box;
  }
  function card(x, fb, key) {
    var type = typeOf(x, fb), sub = [];
    if (yearOf(x)) { sub.push(yearOf(x)); }
    if (x.vote_average) { sub.push(Number(x.vote_average).toFixed(1)); }
    return h('a', { class: 'card f', href: '#/' + type + '/' + x.id, 'data-k': key },
      poster(x), h('div', { class: 't', text: titleOf(x) }), h('div', { class: 's', text: sub.join('  ·  ') }));
  }
  function skeletons(track, n) {
    var i; for (i = 0; i < n; i++) { track.appendChild(h('div', { class: 'card sk' }, h('div', { class: 'poster' }))); }
  }
  function rowShell(title) {
    var track = h('div', { class: 'hs' });
    skeletons(track, 10);
    return { track: track, sec: h('section', { class: 'sec' }, h('h2', { text: title }), track) };
  }
  function withPoster(arr) {
    var out = [], i; arr = arr || [];
    for (i = 0; i < arr.length; i++) { if (arr[i].poster_path !== undefined) { out.push(arr[i]); } }
    return out;
  }
  function fillRow(shell, path, params, type, tok, idx) {
    api(path, params, function (err, d) {
      var items, i;
      if (tok !== S.token) { return; }
      items = err || !d ? [] : withPoster(d.results).slice(0, 20);
      if (!items.length) { if (shell.sec.parentNode) { shell.sec.parentNode.removeChild(shell.sec); } return; }
      clear(shell.track);
      for (i = 0; i < items.length; i++) { shell.track.appendChild(card(items[i], type, 'r' + idx + '-' + i)); }
      settle();
    });
  }

  /* ------------------------------------------------------------------ pages */
  function stopHero() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  function buildHero(hero, items, tok) {
    var slides = [], n = items.length, cur = 0, i, x;
    if (!n) { return; }
    for (i = 0; i < n; i++) {
      x = items[i];
      slides.push(h('div', { class: 'slide', style: x.backdrop_path ? 'background-image:url(' + IMG + 'w1280' + x.backdrop_path + ')' : 'background:' + hueBg(hueOf(x)) }));
    }
    var title = h('h1'), meta = h('div', { class: 'meta' }), ov = h('p', { class: 'ov' });
    var bTrailer = h('button', { class: 'btn f def', type: 'button', 'data-k': 'h-trailer', html: '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z" fill="currentColor"/></svg>Trailer' });
    var bDetails = h('a', { class: 'btn f', 'data-k': 'h-details', href: '#/', text: 'Details' });
    var bList = h('button', { class: 'btn f', type: 'button', 'data-k': 'h-list', text: '+ My List' });
    var bNext = h('button', { class: 'btn f', type: 'button', 'data-k': 'h-next', text: 'Next >' });
    function show(k) {
      var it, type, g, gs = [], j;
      cur = (k + n) % n; it = items[cur]; type = typeOf(it);
      for (j = 0; j < n; j++) { if (j === cur) { slides[j].classList.add('on'); } else { slides[j].classList.remove('on'); } }
      title.textContent = titleOf(it);
      clear(meta);
      if (it.vote_average) { meta.appendChild(h('span', { class: 'badge', text: it.vote_average.toFixed(1) })); meta.appendChild(document.createTextNode('  ')); }
      if (yearOf(it)) { meta.appendChild(h('span', { text: yearOf(it) })); }
      meta.appendChild(h('span', { text: type === 'tv' ? 'Series' : 'Movie' }));
      for (j = 0; j < (it.genre_ids || []).length && gs.length < 2; j++) { g = genreName(type, it.genre_ids[j]); if (g) { gs.push(g); } }
      if (gs.length) { meta.appendChild(h('span', { text: gs.join(' · ') })); }
      ov.textContent = it.overview || '';
      bDetails.setAttribute('href', '#/' + type + '/' + it.id);
      bList.textContent = inList(it.id, type) ? 'In My List' : '+ My List';
    }
    bTrailer.addEventListener('click', function () { var it = items[cur]; openTrailer(typeOf(it), it.id); });
    bList.addEventListener('click', function () { var it = items[cur], type = typeOf(it); bList.textContent = toggleList(it, type) ? 'In My List' : '+ My List'; });
    bNext.addEventListener('click', function () { show(cur + 1); restart(); });
    function restart() {
      stopHero();
      S.timer = setInterval(function () { if (!S.modalOn && tok === S.token) { show(cur + 1); } }, 9000);
    }
    for (i = 0; i < slides.length; i++) { hero.appendChild(slides[i]); }
    hero.appendChild(h('div', { class: 'hero-info' }, title, meta, ov, h('div', {}, bTrailer, bDetails, bList, bNext)));
    show(0); restart(); settle();
  }

  function home(tok) {
    var hero = h('section', { class: 'hero top' });
    var provTrack = h('div', { class: 'hs' });
    var provSec = h('section', { class: 'sec' }, h('h2', { text: 'Browse by provider' }), provTrack);
    var rows = [
      ['Trending Movies', 'trending/movie/day', {}, 'movie'],
      ['Trending Shows', 'trending/tv/day', {}, 'tv'],
      ['Top Rated Movies', 'movie/top_rated', {}, 'movie'],
      ['Top Rated Shows', 'tv/top_rated', {}, 'tv'],
      ['Action & Adventure', 'discover/movie', { with_genres: '28', sort_by: 'popularity.desc' }, 'movie'],
      ['Comedy', 'discover/movie', { with_genres: '35', sort_by: 'popularity.desc' }, 'movie'],
      ['Horror', 'discover/movie', { with_genres: '27', sort_by: 'popularity.desc' }, 'movie'],
      ['Sci-Fi', 'discover/movie', { with_genres: '878', sort_by: 'popularity.desc' }, 'movie'],
      ['Crime Series', 'discover/tv', { with_genres: '80', sort_by: 'popularity.desc' }, 'tv']
    ], shells = [], i;
    app.appendChild(hero); app.appendChild(provSec);
    for (i = 0; i < rows.length; i++) { shells.push(rowShell(rows[i][0])); app.appendChild(shells[i].sec); }

    ensureGenres(function () {
      api('trending/movie/day', {}, function (e1, m) {
        api('trending/tv/day', {}, function (e2, t) {
          var a, b, items = [], k;
          if (tok !== S.token) { return; }
          a = (m && m.results) || []; b = (t && t.results) || [];
          for (k = 0; k < 6; k++) {
            if (a[k]) { a[k].media_type = 'movie'; items.push(a[k]); }
            if (b[k] && items.length < 8) { b[k].media_type = 'tv'; items.push(b[k]); }
          }
          if (!items.length) { hero.style.height = '9rem'; return; }
          buildHero(hero, items.slice(0, 7), tok);
        });
      });
    });
    api('watch/providers/movie', { watch_region: S.region }, function (err, d) {
      var list, j, p;
      if (tok !== S.token) { return; }
      list = err || !d ? [] : (d.results || []).sort(function (x, y) { return (x.display_priority || 99) - (y.display_priority || 99); }).slice(0, 20);
      if (!list.length) { if (provSec.parentNode) { provSec.parentNode.removeChild(provSec); } return; }
      for (j = 0; j < list.length; j++) {
        p = list[j];
        provTrack.appendChild(h('a', { class: 'prov f', href: '#/movies?p=' + p.provider_id, 'data-k': 'p' + p.provider_id, title: p.provider_name },
          p.logo_path ? h('img', { src: IMG + 'w154' + p.logo_path, alt: p.provider_name }) : p.provider_name.slice(0, 6)));
      }
      settle();
    });
    for (i = 0; i < rows.length; i++) { fillRow(shells[i], rows[i][1], rows[i][2], rows[i][3], tok, i); }
  }

  function qs(o) {
    var out = [], k;
    for (k in o) { if (o.hasOwnProperty(k) && o[k]) { out.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); } }
    return out.length ? '?' + out.join('&') : '';
  }

  function browse(type, q, tok) {
    var genre = q.g || '', sort = q.s || 'popularity.desc', prov = q.p || '';
    var base = type === 'tv' ? '#/shows' : '#/movies';
    var dateSort = type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc';
    var page = 0, total = 1, loading = false;
    var sorts = [['popularity.desc', 'Popular'], ['vote_average.desc', 'Top rated'], [dateSort, 'Newest']];
    var sortTrack = h('div', { class: 'hs in-page' }), genreTrack = h('div', { class: 'hs in-page' });
    var holder = h('div', {}, h('p', { class: 'empty', text: 'Loading…' }));
    var grid = null, i, g, on;
    function chip(label, href, key, active) {
      return h('a', { class: 'chip f' + (active ? ' on' : ''), href: href, 'data-k': key, onclick: function () { S.keep = key; } }, label);
    }
    ensureGenres(function () {
      if (tok !== S.token) { return; }
      for (i = 0; i < sorts.length; i++) {
        sortTrack.appendChild(chip(sorts[i][1], base + qs({ g: genre, s: sorts[i][0] === 'popularity.desc' ? '' : sorts[i][0], p: prov }), 'sort-' + i, sorts[i][0] === sort));
      }
      if (prov) { sortTrack.appendChild(chip('Clear provider  ×', base + qs({ g: genre, s: sort === 'popularity.desc' ? '' : sort }), 'clear-p', false)); }
      genreTrack.appendChild(chip('All genres', base + qs({ s: sort === 'popularity.desc' ? '' : sort, p: prov }), 'genre-all', !genre));
      for (i = 0; i < S.genres[type].length; i++) {
        g = S.genres[type][i]; on = String(g.id) === genre;
        genreTrack.appendChild(chip(g.name, base + qs({ g: g.id, s: sort === 'popularity.desc' ? '' : sort, p: prov }), 'genre-' + g.id, on));
      }
      settle();
    });
    app.appendChild(h('div', { class: 'page' }, h('h1', { text: type === 'tv' ? 'Shows' : 'Movies' }), sortTrack, genreTrack, holder));
    function load() {
      if (loading || page >= total) { return; }
      loading = true; page++;
      api('discover/' + type, {
        page: page, sort_by: sort, with_genres: genre, include_adult: 'false',
        'vote_count.gte': sort.indexOf('vote_average') === 0 ? 200 : '', with_watch_providers: prov, watch_region: prov ? S.region : ''
      }, function (err, d) {
        var items, k, c, start;
        loading = false;
        if (tok !== S.token) { return; }
        if (err || !d) { if (page === 1) { clear(holder); holder.appendChild(h('p', { class: 'empty', text: 'Could not load titles.' })); } return; }
        total = Math.min(d.total_pages || 1, 25);
        items = withPoster(d.results);
        if (page === 1) {
          clear(holder);
          if (!items.length) { holder.appendChild(h('p', { class: 'empty', text: 'Nothing found with these filters.' })); return; }
          grid = h('div', { class: 'grid' }); holder.appendChild(grid);
        }
        start = grid.children.length;
        for (k = 0; k < items.length; k++) {
          c = card(items[k], type, 'g' + (start + k));
          (function (node, idx) { node._onfocus = function () { if (idx >= grid.children.length - 15) { load(); } }; })(c, start + k);
          grid.appendChild(c);
        }
        settle();
      });
    }
    load();
  }

  function search(q, tok) {
    var KEYS = 'abcdefghijklmnopqrstuvwxyz0123456789', i;
    var qbox = h('div', { class: 'qbox' });
    var kb = h('div', { class: 'kb' });
    var results = h('div', { class: 's-right' });
    var label = h('h1', { text: 'Search' });
    S.query = q.q || '';
    function paintQuery() {
      qbox.textContent = S.query || 'Type with the keyboard below';
      qbox.className = 'qbox' + (S.query ? '' : ' ph');
    }
    function showItems(heading, items) {
      var gridEl = h('div', { class: 'grid' }), k;
      clear(results);
      results.appendChild(h('h2', { text: heading, style: 'font-size:1.6rem;margin-bottom:1rem;font-weight:600' }));
      if (!items.length) { results.appendChild(h('p', { class: 'empty', text: 'No results for “' + S.query + '”.' })); return; }
      for (k = 0; k < items.length && k < 24; k++) { gridEl.appendChild(card(items[k], 'movie', 'sr' + k)); }
      results.appendChild(gridEl);
    }
    function runSearch() {
      var my = ++S.searchSeq, term = S.query.replace(/^\s+|\s+$/g, '');
      if (!term) {
        api('trending/movie/day', {}, function (e, d) { if (my === S.searchSeq && tok === S.token && !e) { showItems('Trending now', withPoster(d.results)); } });
        return;
      }
      api('search/multi', { query: term, include_adult: 'false' }, function (e, d) {
        var items = [], all, k;
        if (my !== S.searchSeq || tok !== S.token) { return; }
        all = e || !d ? [] : (d.results || []);
        for (k = 0; k < all.length; k++) {
          if ((all[k].media_type === 'movie' || all[k].media_type === 'tv' || all[k].media_type === undefined) && all[k].poster_path !== undefined) { items.push(all[k]); }
        }
        showItems('Results for “' + term + '”', items);
      });
    }
    function setQuery(s) {
      S.query = s; paintQuery();
      try { history.replaceState(null, '', '#/search' + (s ? '?q=' + encodeURIComponent(s) : '')); S.route = location.hash; } catch (e) { /* ignore */ }
      clearTimeout(S.searchTimer); S.searchTimer = setTimeout(runSearch, 450);
    }
    S.setQuery = setQuery;
    function key(label2, cls, key2, fn) {
      return h('button', { class: 'key f' + cls, type: 'button', 'data-k': key2, onclick: fn }, label2);
    }
    for (i = 0; i < KEYS.length; i++) {
      (function (ch) { kb.appendChild(key(ch, '', 'k-' + ch, function () { setQuery(S.query + ch); })); })(KEYS.charAt(i));
    }
    kb.appendChild(key('Space', ' wide', 'k-space', function () { if (S.query && S.query.slice(-1) !== ' ') { setQuery(S.query + ' '); } }));
    kb.appendChild(key('Delete', ' wide', 'k-del', function () { setQuery(S.query.slice(0, -1)); }));
    kb.appendChild(key('Clear', ' wide', 'k-clear', function () { setQuery(''); }));
    paintQuery();
    app.appendChild(h('div', { class: 'page' }, label, h('div', { class: 's-wrap' }, h('div', { class: 's-left' }, qbox, kb), results)));
    runSearch();
    var first = kb.querySelector('.key'); if (first) { first.classList.add('def'); }
    settle();
  }

  function myList() {
    var gridEl = h('div', { class: 'grid' }), i, x;
    if (!S.list.length) {
      app.appendChild(h('div', { class: 'page' }, h('h1', { text: 'My List' }),
        h('p', { class: 'empty', text: 'Nothing here yet. Open any title and choose “+ My List”.' }),
        h('a', { class: 'btn f def', href: '#/movies', 'data-k': 'ml-browse', text: 'Browse movies' })));
      settle(); return;
    }
    for (i = 0; i < S.list.length; i++) {
      x = S.list[i];
      gridEl.appendChild(card({ id: x.id, media_type: x.type, title: x.title, poster_path: x.poster_path, hue: x.hue, vote_average: x.vote, release_date: x.year ? x.year + '-01-01' : '' }, x.type, 'l' + i));
    }
    app.appendChild(h('div', { class: 'page' }, h('h1', { text: 'My List' }), gridEl));
    settle();
  }

  function detail(type, id, tok) {
    app.appendChild(h('div', { class: 'page' }, h('p', { class: 'empty', text: 'Loading…' })));
    api(type + '/' + id, { append_to_response: 'credits,videos,similar,watch/providers' }, function (err, d) {
      var trailer, run = '', reg, prov = [], cast, bg, info, btns, bTrailer, bList, i, sim, shell, castRow, gl, wp;
      if (tok !== S.token) { return; }
      clear(app);
      if (err || !d) {
        app.appendChild(h('div', { class: 'page' }, h('h1', { text: 'Not found' }), h('p', { class: 'empty', text: 'That title could not be loaded.' }),
          h('a', { class: 'btn f def', href: '#/', 'data-k': 'nf-home', text: 'Back home' })));
        settle(); return;
      }
      trailer = pickTrailer(d.videos);
      if (type === 'movie' && d.runtime) { run = Math.floor(d.runtime / 60) + 'h ' + (d.runtime % 60) + 'm'; }
      if (type === 'tv' && d.number_of_seasons) { run = d.number_of_seasons + (d.number_of_seasons > 1 ? ' seasons' : ' season'); }
      wp = d['watch/providers'] || {};
      reg = (wp.results || {})[S.region] || {};
      for (i = 0; i < (reg.flatrate || []).length; i++) { prov.push(reg.flatrate[i].provider_name); }
      cast = ((d.credits || {}).cast || []).slice(0, 8);
      bg = d.backdrop_path ? 'background-image:url(' + IMG + 'w1280' + d.backdrop_path + ')' : 'background:' + hueBg(hueOf(d));
      bTrailer = h('button', { class: 'btn f def', type: 'button', 'data-k': 'd-trailer', html: '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z" fill="currentColor"/></svg>Trailer' });
      bTrailer.addEventListener('click', function () { if (trailer) { showTrailer(trailer); } else { toast(S.demo ? 'No trailers in demo mode' : 'No trailer found'); } });
      bList = h('button', { class: 'btn f', type: 'button', 'data-k': 'd-list', text: inList(d.id, type) ? 'In My List' : '+ My List' });
      bList.addEventListener('click', function () { bList.textContent = toggleList(d, type) ? 'In My List' : '+ My List'; });
      gl = [];
      for (i = 0; i < (d.genres || []).length; i++) { gl.push(h('span', { class: 'gchip', text: d.genres[i].name })); }
      info = h('div', { class: 'd-info' },
        h('h1', { text: titleOf(d) }),
        d.tagline ? h('div', { class: 'tag', text: d.tagline }) : null,
        h('div', { class: 'meta' },
          d.vote_average ? h('span', { class: 'badge', text: d.vote_average.toFixed(1) }) : null,
          d.vote_average ? '  ' : null,
          yearOf(d) ? h('span', { text: yearOf(d) }) : null,
          run ? h('span', { text: run }) : null,
          h('span', { text: type === 'tv' ? 'Series' : 'Movie' })),
        h('div', { class: 'chips' }, gl),
        h('p', { class: 'd-ov', text: d.overview || 'No synopsis available.' }),
        h('div', {}, bTrailer, bList),
        prov.length ? h('div', { class: 'where' }, 'Streaming in ' + S.region + ':  ', h('b', { text: prov.join(', ') })) : null);
      app.appendChild(h('section', { class: 'd-hero top', style: bg }, h('div', { class: 'd-wrap' }, h('div', { class: 'd-poster' }, poster(d)), info)));
      if (cast.length) {
        castRow = h('div', { class: 'cast' });
        for (i = 0; i < cast.length; i++) {
          castRow.appendChild(h('div', { class: 'person' },
            h('div', { class: 'avatar' }, cast[i].profile_path ? h('img', { src: IMG + 'w185' + cast[i].profile_path, alt: '' }) : (cast[i].name || '?').charAt(0)),
            h('div', { class: 'n', text: cast[i].name }), h('div', { class: 'c', text: cast[i].character || '' })));
        }
        app.appendChild(h('section', { class: 'sec' }, h('h2', { text: 'Cast' }), castRow));
      }
      sim = withPoster((d.similar || {}).results).slice(0, 20);
      if (sim.length) {
        shell = rowShell('More like this'); clear(shell.track);
        for (i = 0; i < sim.length; i++) { shell.track.appendChild(card(sim[i], type, 'sim' + i)); }
        app.appendChild(shell.sec);
      }
      document.title = titleOf(d) + ' · OpeboboTV TV';
      settle();
    });
  }

  var REGIONS = [['US', 'United States'], ['NG', 'Nigeria'], ['GH', 'Ghana'], ['GB', 'United Kingdom'], ['PK', 'Pakistan'], ['IN', 'India'], ['CA', 'Canada'], ['AU', 'Australia'], ['ZA', 'South Africa'], ['AE', 'UAE'], ['DE', 'Germany'], ['FR', 'France']];
  function regionName(c) { var i; for (i = 0; i < REGIONS.length; i++) { if (REGIONS[i][0] === c) { return REGIONS[i][1]; } } return c; }
  function settings() {
    var bRegion = h('button', { class: 'btn f def', type: 'button', 'data-k': 's-region', text: 'Streaming region:  ' + regionName(S.region) });
    bRegion.addEventListener('click', function () {
      var i, idx = 0;
      for (i = 0; i < REGIONS.length; i++) { if (REGIONS[i][0] === S.region) { idx = i; } }
      S.region = REGIONS[(idx + 1) % REGIONS.length][0]; lsSet('cj_region', S.region);
      S.cache = {}; bRegion.textContent = 'Streaming region:  ' + regionName(S.region);
    });
    var bClear = h('button', { class: 'btn f', type: 'button', 'data-k': 's-clear', text: 'Clear My List' });
    bClear.addEventListener('click', function () { S.list = []; lsSet('cj_list', []); toast('My List cleared'); });
    var inApp = !!window.OpeboboTVApp;   // running inside the standalone Android TV app
    var bDesk = null;   // VIDAA build: no desktop site to link to
    var note = h('p', { class: 'note', text: S.demo
      ? 'Demo mode: showing sample data. Add your TMDB key to the .env file on your PC and restart the server.'
      : 'Live mode: movie data comes from TMDB (' + S.auth + '). This product uses the TMDB API but is not endorsed or certified by TMDB.' });
    var bPc = null;
    app.appendChild(h('div', { class: 'page' }, h('h1', { text: 'Settings' }), h('div', { class: 'set' }, bRegion, bClear, bPc, bDesk, note,
      h('p', { class: 'note', text: 'Remote: arrows move, OK selects, Back goes back. On the Search page you can also type with a USB or Bluetooth keyboard.' }))));
    settle();
  }

  /* ----------------------------------------------------------------- router */
  function parseHash() {
    var hh = (location.hash || '').replace(/^#/, '') || '/', q = {}, i, parts, kv, j;
    i = hh.indexOf('?');
    if (i >= 0) {
      parts = hh.slice(i + 1).split('&');
      for (j = 0; j < parts.length; j++) {
        kv = parts[j].split('=');
        if (kv[0]) { try { q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } catch (e) { /* ignore */ } }
      }
      hh = hh.slice(0, i);
    }
    return { path: hh.replace(/\/+$/, '') || '/', q: q };
  }
  function setNav(name) {
    var items = document.querySelectorAll('#nav .navi'), i;
    for (i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-nav') === name) { items[i].classList.add('on'); } else { items[i].classList.remove('on'); }
    }
  }
  function render() {
    var prev = S.route, key = location.hash || '#/', tok, p, m, old, i, mm;
    if (prev && S.mem[prev]) { S.mem[prev].y = window.pageYOffset; }
    S.route = key; S.navCount++;
    tok = ++S.token; S.searchSeq++;
    stopHero(); closeModal(true);
    old = document.querySelectorAll('.focus'); for (i = 0; i < old.length; i++) { old[i].classList.remove('focus'); }
    S.cur = null; S.setQuery = null; S.userMoved = false; clearTimeout(S.searchTimer);
    clear(app); document.title = 'OpeboboTV TV';
    mm = S.mem[key]; S.want = mm && mm.key ? mm.key : null; S.wantY = mm && mm.y ? mm.y : 0;
    if (S.keep) { S.want = S.keep; S.keep = null; S.wantY = 0; }
    clearTimeout(S.wantTimer);
    S.wantTimer = setTimeout(function () { if (tok === S.token) { S.want = null; settle(); } }, 2200);
    window.scrollTo(0, 0);
    p = parseHash();
    if (p.path === '/') { setNav('home'); home(tok); }
    else if (p.path === '/movies') { setNav('movies'); browse('movie', p.q, tok); }
    else if (p.path === '/shows') { setNav('shows'); browse('tv', p.q, tok); }
    else if (p.path === '/search') { setNav('search'); search(p.q, tok); }
    else if (p.path === '/list') { setNav('list'); myList(); }
    else if (p.path === '/settings') { setNav('settings'); settings(); }
    else if ((m = p.path.match(/^\/(movie|tv)\/(\d+)$/))) { setNav(m[1] === 'tv' ? 'shows' : 'movies'); ensureGenres(function () { detail(m[1], m[2], tok); }); }
    else { setNav(''); app.appendChild(h('div', { class: 'page' }, h('h1', { text: 'Page not found' }), h('a', { class: 'btn f def', href: '#/', 'data-k': 'nf', text: 'Go home' }))); }
    settle();
  }
  window.addEventListener('hashchange', render);

  /* ------------------------------------------------------- remote / keyboard */
  function goBack() {
    if (S.modalOn) { closeModal(); return true; }
    if (S.route === '' || S.route === '#/' || S.route === '#') { return false; }
    if (S.navCount > 1 && window.history.length > 1) { window.history.back(); } else { location.hash = '#/'; }
    return true;
  }
  // The Android TV app calls this when the remote's Back is pressed; false means "nothing to go back to" (exit app).
  window.__tvBack = function () { return goBack(); };
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, dir = null, p, ch;
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (k === 37) { dir = 'left'; } else if (k === 38) { dir = 'up'; } else if (k === 39) { dir = 'right'; } else if (k === 40) { dir = 'down'; }
    if (dir) { e.preventDefault(); move(dir); return; }
    p = parseHash();
    if (p.path === '/search' && S.setQuery && !S.modalOn) {
      if (k === 8 && S.query) { e.preventDefault(); S.setQuery(S.query.slice(0, -1)); return; }
      ch = e.key && e.key.length === 1 ? e.key.toLowerCase() : '';
      if (ch && /[a-z0-9 '\-]/.test(ch)) { e.preventDefault(); S.setQuery(S.query + ch); return; }
    }
    if (k === 13) { e.preventDefault(); if (S.cur && document.body.contains(S.cur)) { S.cur.click(); } else { settle(); } return; }
    // Back: Backspace, Escape, Tizen 10009, webOS 461, Android/Fire TV 4, named keys
    if (k === 8 || k === 27 || k === 10009 || k === 461 || k === 4 || e.key === 'GoBack' || e.key === 'BrowserBack' || e.key === 'XF86Back') {
      if (goBack()) { e.preventDefault(); }
    }
  });
  // Magic-remote / mouse pointer: hover focuses, click activates. Only real movement counts.
  var lastX = -1, lastY = -1;
  document.addEventListener('mousemove', function (e) {
    var el;
    if (Math.abs(e.clientX - lastX) < 4 && Math.abs(e.clientY - lastY) < 4) { return; }
    lastX = e.clientX; lastY = e.clientY;
    S.userMoved = true;
    el = closest(e.target, 'f');
    if (el && el !== S.cur && (!S.modalOn || modalEl.contains(el))) { setFocus(el, true, true); }
  });

  /* ------------------------------------------------------------------ boot */
  (function boot() {
    var cfg = window.OPEBOBO_CONFIG || {};
    S.demo = false; S.auth = 'api_key';
    if (!cfg.tmdbKey || cfg.tmdbKey.indexOf('PASTE') === 0) {
      setTimeout(function () { toast('TMDB key missing: edit config.js'); }, 800);
    }
    render();
  })();
})();
