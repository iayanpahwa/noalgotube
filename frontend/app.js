'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  videos:        [],
  articles:      [],
  channels:      [],
  feeds:         [],
  channelFilter: '',
  feedFilter:    '',
  view:          'videos',
  hideWatched: false,
  hideRead: false,
  videoAgeFilter: 0,   // days; 0 = all
  articleAgeFilter: 0,
  videoSearch: '',
  articleSearch: '',
  viewMode: 'grid',    // 'grid' | 'list'
  autoRefreshHours: 0,
  _autoRefreshTimer: null,
  itemsPerChannel: { global: 5 },
  itemsPerFeed:    { global: 5 },
  articleSortDir: 'desc',  // 'desc' = newest first, 'asc' = oldest first
};

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
  async post(path, data) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
    return body;
  },
  async del(path) {
    const res = await fetch(path, {method: 'DELETE'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async patch(path) {
    const res = await fetch(path, {method: 'PATCH'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function relDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s <    60) return 'just now';
  if (s <  3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Item limits (per-channel / per-feed) ──────────────────────────────────────
function loadItemLimits() {
  try {
    state.itemsPerChannel = JSON.parse(localStorage.getItem('itemsPerChannel') || '{"global":5}');
    state.itemsPerFeed    = JSON.parse(localStorage.getItem('itemsPerFeed')    || '{"global":5}');
  } catch { /* keep defaults */ }
}

function saveItemLimits() {
  localStorage.setItem('itemsPerChannel', JSON.stringify(state.itemsPerChannel));
  localStorage.setItem('itemsPerFeed',    JSON.stringify(state.itemsPerFeed));
}

function getChannelLimit(channelId) {
  return Number(state.itemsPerChannel[channelId] ?? state.itemsPerChannel.global ?? 5);
}

function getFeedLimit(feedId) {
  return Number(state.itemsPerFeed[String(feedId)] ?? state.itemsPerFeed.global ?? 5);
}

function setGlobalChannelLimit(val) {
  state.itemsPerChannel.global = parseInt(val, 10);
  saveItemLimits();
  renderVideos();
}

function setGlobalFeedLimit(val) {
  state.itemsPerFeed.global = parseInt(val, 10);
  saveItemLimits();
  renderArticles();
}

function setChannelLimit(channelId, val) {
  if (val === '') {
    delete state.itemsPerChannel[channelId];
  } else {
    state.itemsPerChannel[channelId] = parseInt(val, 10);
  }
  saveItemLimits();
  renderVideos();
}

function setFeedLimit(feedId, val) {
  if (val === '') {
    delete state.itemsPerFeed[String(feedId)];
  } else {
    state.itemsPerFeed[String(feedId)] = parseInt(val, 10);
  }
  saveItemLimits();
  renderArticles();
}

function applyDateFilter(items, days, field) {
  if (!days) return items;
  const cutoff = Date.now() - days * 86400 * 1000;
  return items.filter(i => new Date(i[field]).getTime() >= cutoff);
}

// ── Nav badges ────────────────────────────────────────────────────────────────
function updateNavBadges() {
  const unwatched = state.videos.filter(v => !v.watched).length;
  const unread    = state.articles.filter(a => !a.is_read).length;
  const vb = document.getElementById('badge-videos');
  const ab = document.getElementById('badge-blogs');
  if (vb) vb.textContent = unwatched > 0 ? unwatched : '';
  if (ab) ab.textContent = unread    > 0 ? unread    : '';
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(view) {
  state.view = view;
  localStorage.setItem('view', view);
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${view}`).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.setAttribute('hidden', ''));
  document.getElementById(`view-${view}`).removeAttribute('hidden');
  if (view === 'feeds') renderManagePage();
}

// ── Channel filter ────────────────────────────────────────────────────────────
function populateChannelFilter() {
  const sel  = document.getElementById('channel-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Channels</option>' +
    state.channels.map(c =>
      `<option value="${esc(c.channel_id)}">${esc(c.name)}</option>`
    ).join('');
  if (prev && state.channels.some(c => c.channel_id === prev)) {
    sel.value = prev;
    state.channelFilter = prev;
  } else {
    sel.value = '';
    state.channelFilter = '';
  }
}

function onChannelFilterChange() {
  state.channelFilter = document.getElementById('channel-filter').value;
  renderVideos();
}

// ── Feed filter ───────────────────────────────────────────────────────────────
function populateFeedFilter() {
  const sel  = document.getElementById('feed-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Feeds</option>' +
    state.feeds.map(f =>
      `<option value="${f.id}">${esc(f.title)}</option>`
    ).join('');
  if (prev && state.feeds.some(f => String(f.id) === prev)) {
    sel.value = prev;
    state.feedFilter = prev;
  } else {
    sel.value = '';
    state.feedFilter = '';
  }
}

function onFeedFilterChange() {
  state.feedFilter = document.getElementById('feed-filter').value;
  renderArticles();
}

function onVideoAgeChange() {
  state.videoAgeFilter = parseInt(document.getElementById('video-age-filter').value, 10);
  renderVideos();
}

function onArticleAgeChange() {
  state.articleAgeFilter = parseInt(document.getElementById('article-age-filter').value, 10);
  renderArticles();
}

function onVideoSearchChange() {
  state.videoSearch = document.getElementById('video-search').value.trim();
  renderVideos();
}

function onArticleSearchChange() {
  state.articleSearch = document.getElementById('article-search').value.trim();
  renderArticles();
}

function toggleHideWatched() {
  state.hideWatched = !state.hideWatched;
  document.getElementById('hide-watched-btn').classList.toggle('on', state.hideWatched);
  localStorage.setItem('hideWatched', state.hideWatched ? '1' : '0');
  renderVideos();
}

function toggleArticleSort() {
  state.articleSortDir = state.articleSortDir === 'desc' ? 'asc' : 'desc';
  localStorage.setItem('articleSortDir', state.articleSortDir);
  const btn = document.getElementById('article-sort-btn');
  if (btn) btn.textContent = state.articleSortDir === 'desc' ? 'Newest first' : 'Oldest first';
  renderArticles();
}

function toggleHideRead() {
  state.hideRead = !state.hideRead;
  document.getElementById('hide-read-btn').classList.toggle('on', state.hideRead);
  localStorage.setItem('hideRead', state.hideRead ? '1' : '0');
  renderArticles();
}

function setViewMode(mode) {
  state.viewMode = mode;
  const grid = document.getElementById('video-grid');
  grid.classList.toggle('list-view', mode === 'list');
  document.getElementById('view-grid-btn').classList.toggle('active', mode === 'grid');
  document.getElementById('view-list-btn').classList.toggle('active', mode === 'list');
  localStorage.setItem('viewMode', mode);
}

function setAutoRefresh(hours) {
  state.autoRefreshHours = parseInt(hours, 10);
  localStorage.setItem('autoRefreshHours', hours);
  if (state._autoRefreshTimer) clearInterval(state._autoRefreshTimer);
  state._autoRefreshTimer = null;
  if (state.autoRefreshHours > 0) {
    state._autoRefreshTimer = setInterval(async () => {
      await api.post('/api/refresh', {});
      [state.videos, state.articles] = await Promise.all([
        api.get('/api/videos'),
        api.get('/api/articles'),
      ]);
      renderVideos();
      renderArticles();
      toast('Auto-refreshed', 'success');
    }, state.autoRefreshHours * 3600 * 1000);
  }
}

// ── Videos ────────────────────────────────────────────────────────────────────
async function loadVideos() {
  const grid = document.getElementById('video-grid');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    state.videos = await api.get('/api/videos');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    return;
  }
  renderVideos();
}

function renderVideos() {
  const grid = document.getElementById('video-grid');

  let filtered;
  if (state.channelFilter) {
    const limit = getChannelLimit(state.channelFilter);
    filtered = state.videos.filter(v => v.channel_id === state.channelFilter);
    if (limit > 0) filtered = filtered.slice(0, limit);
  } else {
    const byChannel = {};
    for (const v of state.videos) (byChannel[v.channel_id] ??= []).push(v);
    filtered = [];
    for (const [cid, vids] of Object.entries(byChannel)) {
      const limit = getChannelLimit(cid);
      filtered.push(...(limit > 0 ? vids.slice(0, limit) : vids));
    }
    filtered.sort((a, b) => new Date(b.published) - new Date(a.published));
  }
  filtered = applyDateFilter(filtered, state.videoAgeFilter, 'published');
  if (state.hideWatched) filtered = filtered.filter(v => !v.watched);
  if (state.videoSearch) {
    const q = state.videoSearch.toLowerCase();
    filtered = filtered.filter(v => v.title.toLowerCase().includes(q));
  }

  document.getElementById('video-count').textContent = filtered.length
    ? `${filtered.length} video${filtered.length !== 1 ? 's' : ''}` : '';

  if (!filtered.length) {
    const msg = state.channelFilter
      ? 'No videos from this channel yet — try Refresh.'
      : 'Add YouTube channels in Manage to get started.';
    grid.innerHTML = `<div class="empty-state"><h3>No videos yet</h3><p>${msg}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(v => `
    <div class="video-card ${v.watched ? 'watched' : ''}" onclick='openVideo(${JSON.stringify(v.video_id)}, ${JSON.stringify(v.title)})'>
      <div class="video-thumb">
        <img src="${esc(v.thumbnail)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">
        <div class="play-icon">
          <svg viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="video-info">
        <div class="video-title">${esc(v.title)}</div>
        <div class="video-meta">
          ${esc(v.channel_name)} &middot; ${relDate(v.published)}
          ${v.watched ? ` &middot; <button class="mark-btn" onclick="event.stopPropagation();markUnwatched('${esc(v.video_id)}')">Mark unwatched</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
  updateNavBadges();
}

// ── Video modal ───────────────────────────────────────────────────────────────
function openVideo(videoId, title) {
  document.getElementById('video-iframe').src =
    `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  document.getElementById('video-modal-title').textContent = title;
  document.getElementById('video-yt-link').href =
    `https://www.youtube.com/watch?v=${videoId}`;
  document.getElementById('video-modal').removeAttribute('hidden');
  document.body.classList.add('no-scroll');

  // Mark as watched
  const vid = state.videos.find(v => v.video_id === videoId);
  if (vid && !vid.watched) {
    vid.watched = true;
    api.patch(`/api/videos/${videoId}/watched`);
    renderVideos();
  }
}

function closeVideo() {
  document.getElementById('video-iframe').src = '';
  document.getElementById('video-modal').setAttribute('hidden', '');
  document.body.classList.remove('no-scroll');
}

function markUnwatched(videoId) {
  const vid = state.videos.find(v => v.video_id === videoId);
  if (!vid) return;
  vid.watched = false;
  api.patch(`/api/videos/${videoId}/unwatched`);
  renderVideos();
}

// ── Articles ──────────────────────────────────────────────────────────────────
async function loadArticles() {
  const list = document.getElementById('article-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    state.articles = await api.get('/api/articles');
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    return;
  }
  renderArticles();
}

function renderArticles() {
  const list = document.getElementById('article-list');

  let filtered;
  if (state.feedFilter) {
    const limit = getFeedLimit(state.feedFilter);
    filtered = state.articles.filter(a => String(a.feed_id) === state.feedFilter);
    if (limit > 0) filtered = filtered.slice(0, limit);
  } else {
    const byFeed = {};
    for (const a of state.articles) (byFeed[a.feed_id] ??= []).push(a);
    filtered = [];
    for (const [fid, arts] of Object.entries(byFeed)) {
      const limit = getFeedLimit(fid);
      filtered.push(...(limit > 0 ? arts.slice(0, limit) : arts));
    }
    filtered.sort((a, b) => new Date(b.published) - new Date(a.published));
  }
  filtered = applyDateFilter(filtered, state.articleAgeFilter, 'published');
  if (state.hideRead) filtered = filtered.filter(a => !a.is_read);
  if (state.articleSearch) {
    const q = state.articleSearch.toLowerCase();
    filtered = filtered.filter(a => a.title.toLowerCase().includes(q));
  }

  if (state.articleSortDir === 'asc') filtered = [...filtered].reverse();

  document.getElementById('article-count').textContent = filtered.length
    ? `${filtered.length} article${filtered.length !== 1 ? 's' : ''}` : '';

  if (!filtered.length) {
    const msg = state.feedFilter
      ? 'No articles from this feed yet — try Refresh.'
      : 'Add blog RSS feeds in Manage to get started.';
    list.innerHTML = `<div class="empty-state"><h3>No articles yet</h3><p>${msg}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(a => {
    const origIdx = state.articles.indexOf(a);
    const raw     = a.summary ? stripHtml(a.summary).trim() : '';
    const excerpt = raw.length > 160 ? raw.slice(0, 160) + '\u2026' : raw;
    return `
      <div class="article-card ${a.is_read ? 'is-read' : ''}" onclick="openArticle(${origIdx})">
        <div class="article-title">${esc(a.title)}</div>
        <div class="article-meta">
          ${esc(a.feed_title)} &middot; ${relDate(a.published)}
          ${a.is_read ? ` &middot; <button class="mark-btn" onclick="event.stopPropagation();markUnread(${a.id})">Mark unread</button>` : ''}
        </div>
        ${excerpt ? `<div class="article-excerpt">${esc(excerpt)}</div>` : ''}
      </div>`;
  }).join('');
  updateNavBadges();
}

// ── Article modal ─────────────────────────────────────────────────────────────
function openArticle(idx) {
  const a = state.articles[idx];
  if (!a) return;

  document.getElementById('article-modal-title').textContent = a.title;
  document.getElementById('article-modal-meta').textContent =
    `${a.feed_title} \u00b7 ${relDate(a.published)}`;

  const content = a.content || a.summary || '';
  const el = document.getElementById('article-modal-content');
  if (content) {
    el.innerHTML = content;
    el.querySelectorAll('img').forEach(img => { img.style.maxWidth = '100%'; });
    el.querySelectorAll('a').forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    });
  } else {
    el.innerHTML = '<p style="color:var(--text-muted)">No content in feed \u2014 read the original article.</p>';
  }

  document.getElementById('article-read-more').href = a.url;
  document.getElementById('article-reader').scrollTop = 0;
  document.getElementById('article-modal').removeAttribute('hidden');
  document.body.classList.add('no-scroll');

  // Mark as read
  const art = state.articles[idx];
  if (art && !art.is_read) {
    art.is_read = 1;
    api.patch(`/api/articles/${art.id}/read`);
    renderArticles();
  }
}

function closeArticle() {
  document.getElementById('article-modal').setAttribute('hidden', '');
  document.body.classList.remove('no-scroll');
  document.getElementById('article-modal-content').innerHTML = '';
}

function markUnread(articleId) {
  const art = state.articles.find(a => a.id === articleId);
  if (!art) return;
  art.is_read = 0;
  api.patch(`/api/articles/${articleId}/unread`);
  renderArticles();
}

// ── Manage page (channels + feeds combined) ───────────────────────────────────
function renderManagePage() {
  renderChannelsList();
  renderFeedsList();
  const arSelect = document.getElementById('auto-refresh-select');
  if (arSelect) arSelect.value = String(state.autoRefreshHours);
  const icSelect = document.getElementById('items-per-channel-select');
  if (icSelect) icSelect.value = String(state.itemsPerChannel.global ?? 5);
  const ifSelect = document.getElementById('items-per-feed-select');
  if (ifSelect) ifSelect.value = String(state.itemsPerFeed.global ?? 5);
}

function renderChannelsList() {
  const el = document.getElementById('channel-list');
  if (!el) return;
  el.innerHTML = state.channels.length
    ? state.channels.map(c => {
        const cur = state.itemsPerChannel[c.channel_id];
        const sel = v => (cur !== undefined ? String(cur) : '') === v ? 'selected' : '';
        return `
        <div class="list-item">
          <div style="min-width:0">
            <div class="list-item-name">${esc(c.name)}</div>
            <div class="list-item-meta">${esc(c.channel_id)}</div>
          </div>
          <div class="list-item-actions">
            <select class="limit-select" title="Videos to show" onchange="setChannelLimit('${esc(c.channel_id)}', this.value)">
              <option value="" ${sel('')}>default</option>
              <option value="3"  ${sel('3')}>3</option>
              <option value="5"  ${sel('5')}>5</option>
              <option value="10" ${sel('10')}>10</option>
              <option value="20" ${sel('20')}>20</option>
              <option value="0"  ${sel('0')}>all</option>
            </select>
            <button class="btn-delete" onclick="deleteChannel('${esc(c.channel_id)}')" title="Remove">&times;</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="empty-list">No channels added yet.</p>';
}

function renderFeedsList() {
  const el = document.getElementById('feed-list');
  if (!el) return;
  el.innerHTML = state.feeds.length
    ? state.feeds.map(f => {
        const cur = state.itemsPerFeed[String(f.id)];
        const sel = v => (cur !== undefined ? String(cur) : '') === v ? 'selected' : '';
        return `
        <div class="list-item">
          <div style="min-width:0">
            <div class="list-item-name">${esc(f.title)}</div>
            <div class="list-item-meta">${esc(f.url)}</div>
          </div>
          <div class="list-item-actions">
            <select class="limit-select" title="Articles to show" onchange="setFeedLimit(${f.id}, this.value)">
              <option value="" ${sel('')}>default</option>
              <option value="3"  ${sel('3')}>3</option>
              <option value="5"  ${sel('5')}>5</option>
              <option value="10" ${sel('10')}>10</option>
              <option value="20" ${sel('20')}>20</option>
              <option value="0"  ${sel('0')}>all</option>
            </select>
            <button class="btn-delete" onclick="deleteFeed(${f.id})" title="Remove">&times;</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="empty-list">No feeds added yet.</p>';
}

// ── Add / remove channels ─────────────────────────────────────────────────────
async function addChannel() {
  const input = document.getElementById('channel-input');
  const btn   = document.getElementById('add-channel-btn');
  const url   = input.value.trim();
  if (!url) return;

  btn.disabled    = true;
  btn.textContent = 'Resolving\u2026';
  try {
    const ch = await api.post('/api/channels', {url});
    input.value = '';

    const count = ch.video_count ?? 0;
    toast(
      count > 0
        ? `Added: ${ch.name} \u2014 ${count} video${count !== 1 ? 's' : ''} loaded`
        : `Added: ${ch.name} \u2014 hit Refresh to load videos`,
      'success'
    );

    await reloadChannelData();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Add';
  }
}

async function deleteChannel(channelId) {
  const ch = state.channels.find(c => c.channel_id === channelId);
  if (!confirm(`Remove "${ch?.name ?? channelId}" and all its videos?`)) return;
  try {
    await api.del(`/api/channels/${channelId}`);
    toast('Channel removed');
    if (state.channelFilter === channelId) {
      state.channelFilter = '';
      document.getElementById('channel-filter').value = '';
    }
    await reloadChannelData();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reloadChannelData() {
  [state.channels, state.videos] = await Promise.all([
    api.get('/api/channels'),
    api.get('/api/videos'),
  ]);
  populateChannelFilter();
  renderVideos();
  renderChannelsList();
}

// ── Add / remove feeds ────────────────────────────────────────────────────────
async function addFeed() {
  const input = document.getElementById('feed-input');
  const btn   = document.getElementById('add-feed-btn');
  const url   = input.value.trim();
  if (!url) return;

  btn.disabled    = true;
  btn.textContent = 'Adding\u2026';
  try {
    const f = await api.post('/api/feeds', {url});
    input.value = '';
    toast(`Added: ${f.title}`, 'success');
    await reloadFeedData();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Add';
  }
}

async function deleteFeed(feedId) {
  const f = state.feeds.find(f => f.id === feedId);
  if (!confirm(`Remove "${f?.title ?? feedId}" and all its articles?`)) return;
  try {
    await api.del(`/api/feeds/${feedId}`);
    toast('Feed removed');
    if (state.feedFilter === String(feedId)) {
      state.feedFilter = '';
      document.getElementById('feed-filter').value = '';
    }
    await reloadFeedData();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reloadFeedData() {
  [state.feeds, state.articles] = await Promise.all([
    api.get('/api/feeds'),
    api.get('/api/articles'),
  ]);
  populateFeedFilter();
  renderArticles();
  renderFeedsList();
}

// ── Mark all ─────────────────────────────────────────────────────────────────
async function markAllWatched() {
  const toMark = state.videos.filter(v =>
    !v.watched && (!state.channelFilter || v.channel_id === state.channelFilter)
  );
  if (!toMark.length) { toast('Nothing to mark', 'info'); return; }
  toMark.forEach(v => { v.watched = true; });
  renderVideos();
  await Promise.all(toMark.map(v => api.patch(`/api/videos/${v.video_id}/watched`)));
  toast(`Marked ${toMark.length} video${toMark.length !== 1 ? 's' : ''} watched`, 'success');
}

async function markAllRead() {
  const toMark = state.articles.filter(a =>
    !a.is_read && (!state.feedFilter || String(a.feed_id) === state.feedFilter)
  );
  if (!toMark.length) { toast('Nothing to mark', 'info'); return; }
  toMark.forEach(a => { a.is_read = 1; });
  renderArticles();
  await Promise.all(toMark.map(a => api.patch(`/api/articles/${a.id}/read`)));
  toast(`Marked ${toMark.length} article${toMark.length !== 1 ? 's' : ''} read`, 'success');
}

// ── Refresh ───────────────────────────────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled    = true;
  btn.textContent = 'Refreshing\u2026';
  try {
    await api.post('/api/refresh', {});
    [state.videos, state.articles] = await Promise.all([
      api.get('/api/videos'),
      api.get('/api/articles'),
    ]);
    renderVideos();
    renderArticles();
    toast('All feeds refreshed', 'success');
  } catch (e) {
    toast('Refresh failed', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '\u21BB Refresh';
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  const next = isLight ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem('theme', next);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.getElementById('theme-btn').textContent = '\u263E'; // ☾
  } else {
    delete document.documentElement.dataset.theme;
    document.getElementById('theme-btn').textContent = '\u2600'; // ☀
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeVideo(); closeArticle(); }
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  const [videos, articles, channels, feeds] = await Promise.all([
    api.get('/api/videos').catch(() => []),
    api.get('/api/articles').catch(() => []),
    api.get('/api/channels').catch(() => []),
    api.get('/api/feeds').catch(() => []),
  ]);
  state.videos   = videos;
  state.articles = articles;
  state.channels = channels;
  state.feeds    = feeds;

  // Restore persisted preferences
  loadItemLimits();
  // Sync global items-per-source selects to stored values immediately —
  // renderManagePage() would do this too, but only when the user navigates to Manage
  const _icSel = document.getElementById('items-per-channel-select');
  if (_icSel) _icSel.value = String(state.itemsPerChannel.global ?? 5);
  const _ifSel = document.getElementById('items-per-feed-select');
  if (_ifSel) _ifSel.value = String(state.itemsPerFeed.global ?? 5);
  applyTheme(localStorage.getItem('theme') || 'dark');
  state.hideWatched = localStorage.getItem('hideWatched') === '1';
  state.hideRead = localStorage.getItem('hideRead') === '1';
  state.viewMode = localStorage.getItem('viewMode') || 'grid';
  state.autoRefreshHours = parseInt(localStorage.getItem('autoRefreshHours') || '0', 10);
  state.articleSortDir = localStorage.getItem('articleSortDir') || 'desc';

  // Apply restored preferences to UI
  if (state.hideWatched) document.getElementById('hide-watched-btn')?.classList.add('on');
  if (state.hideRead) document.getElementById('hide-read-btn')?.classList.add('on');
  const sortBtn = document.getElementById('article-sort-btn');
  if (sortBtn) sortBtn.textContent = state.articleSortDir === 'asc' ? 'Oldest first' : 'Newest first';
  setViewMode(state.viewMode);
  if (state.autoRefreshHours > 0) setAutoRefresh(String(state.autoRefreshHours));

  populateChannelFilter();
  populateFeedFilter();
  renderVideos();
  renderArticles();

  // Restore last active view (navigate also calls renderManagePage if view is 'feeds')
  const savedViews = ['videos', 'blogs', 'feeds'];
  navigate(savedViews.includes(localStorage.getItem('view')) ? localStorage.getItem('view') : 'videos');

  // Offline indicator
  const offlineBanner = document.getElementById('offline-banner');
  window.addEventListener('offline', () => offlineBanner?.removeAttribute('hidden'));
  window.addEventListener('online',  () => offlineBanner?.setAttribute('hidden', ''));
  if (!navigator.onLine) offlineBanner?.removeAttribute('hidden');
})();
