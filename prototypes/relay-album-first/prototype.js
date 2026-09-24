const assets = '../relay-app-refresh/assets/';
const albums = [
  { id: 'spaces', name: 'Spaces & stories', description: 'Interiors, light and little moments.', cover: 'interior.jpg', updated: 4, sections: ['All in this album', 'Interiors', 'Details'] },
  { id: 'details', name: 'The little details', description: 'Textures and objects worth keeping.', cover: 'chair.jpg', updated: 3, sections: ['All in this album', 'Objects', 'Inspiration'] },
  { id: 'weekend', name: 'Weekend light', description: 'A quiet weekend through the lens.', cover: 'architecture.jpg', updated: 2, sections: ['All in this album', 'Out and about'] },
  { id: 'new', name: 'Next project', description: 'A fresh place to collect what comes next.', cover: '', updated: 1, sections: ['All in this album'] }
];
const files = [
  { id: 'f1', name: 'Morning room.jpg', image: 'interior.jpg', album: 'spaces', section: 'Interiors', type: 'photo', added: 9 },
  { id: 'f2', name: 'Soft shadows.jpg', image: 'living.jpg', album: 'spaces', section: 'Interiors', type: 'photo', added: 8 },
  { id: 'f3', name: 'Quiet corner.jpg', image: 'studio.jpg', album: 'spaces', section: 'Details', type: 'photo', added: 7 },
  { id: 'f4', name: 'Afternoon light.mp4', image: 'architecture.jpg', album: 'spaces', section: 'Details', type: 'video', added: 6 },
  { id: 'f5', name: 'The chair.jpg', image: 'chair.jpg', album: 'details', section: 'Objects', type: 'photo', added: 5 },
  { id: 'f6', name: 'Little things.jpg', image: 'details.jpg', album: 'details', section: 'Inspiration', type: 'photo', added: 4 },
  { id: 'f7', name: 'Calm interior.jpg', image: 'living.jpg', album: 'details', section: 'Objects', type: 'photo', added: 3 },
  { id: 'f8', name: 'A walk downtown.jpg', image: 'architecture.jpg', album: 'weekend', section: 'Out and about', type: 'photo', added: 2 },
  { id: 'f9', name: 'Reference still.jpg', image: 'studio.jpg', album: null, section: null, type: 'photo', added: 1 },
  { id: 'f10', name: 'Studio take.mp4', image: 'details.jpg', album: null, section: null, type: 'video', added: 0 },
  { id: 'f11', name: 'Window study.jpg', image: 'living.jpg', album: null, section: null, type: 'photo', added: -1 }
];
const state = { route: 'albums', albumId: null, section: 'All in this album', viewerIndex: 0, visibleFiles: [] };
const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="../relay-app-refresh/assets/icons.svg#${name}"/></svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const imageUrl = file => file.type === 'video' && file.localUrl ? `${assets}studio.jpg` : file.localUrl || `${assets}${file.image}`;

// Album counts reflect current sample placements so the index and opened album always agree.
function albumFiles(albumId) { return files.filter(file => file.album === albumId); }

// Rebuild only the album index; no file thumbnails are rendered on the arrival view.
function renderAlbumIndex() {
  const query = $('#album-search').value.trim().toLocaleLowerCase();
  const sorted = [...albums].sort((left, right) => $('#album-sort').value === 'name' ? left.name.localeCompare(right.name) : right.updated - left.updated);
  const visible = sorted.filter(album => album.name.toLocaleLowerCase().includes(query));
  $('#album-count').textContent = `${visible.length} ${visible.length === 1 ? 'album' : 'albums'}`;
  $('#album-nav-count').textContent = albums.length;
  const unorganisedCount = files.filter(file => !file.album).length;
  $('#unorganised-nav-count').textContent = unorganisedCount;
  $('#unorganised-summary').textContent = `${unorganisedCount} unorganised ${unorganisedCount === 1 ? 'file' : 'files'} · organise them when you’re ready`;
  $('#album-no-results').hidden = visible.length > 0;
  $('#album-grid').innerHTML = visible.map(album => {
    const count = albumFiles(album.id).length;
    const cover = album.cover ? `<img src="${assets}${album.cover}" alt="">` : icon('Folder');
    return `<article class="album-card"><button class="album-open" data-album="${escapeHtml(album.id)}" aria-label="Open ${escapeHtml(album.name)}, ${count} ${count === 1 ? 'file' : 'files'}"><div class="cover ${album.cover ? '' : 'empty-cover'}">${cover}<span class="cover-count">${count} ${count === 1 ? 'file' : 'files'}</span></div><div class="album-card-body"><div><h3>${escapeHtml(album.name)}</h3><p>${count ? 'Updated recently' : 'Ready for files'}</p></div>${icon('ArrowUpRight')}</div></button></article>`;
  }).join('');
  $('#album-grid').querySelectorAll('[data-album]').forEach(button => button.addEventListener('click', () => navigateToAlbum(button.dataset.album)));
}

// The detail view contains only the chosen album or an explicitly selected fallback view.
function renderDetail() {
  const album = albums.find(candidate => candidate.id === state.albumId);
  const unorganised = state.route === 'unorganised';
  const broadLibrary = state.route === 'library';
  const title = album?.name || (unorganised ? 'Unorganised' : 'Browse all files');
  const related = album ? albumFiles(album.id) : unorganised ? files.filter(file => !file.album) : [...files];
  $('#detail-title').textContent = title;
  $('#topbar-location').textContent = title;
  $('#detail-eyebrow').textContent = album ? 'ALBUM / MY SPACE' : 'MY SPACE';
  $('#detail-description').textContent = album?.description || (unorganised ? 'Files that have not been added to an album yet.' : 'A deliberate view across your files in this space.');
  $('#detail-count').textContent = `${related.length} ${related.length === 1 ? 'file' : 'files'}`;
  $('#section-tabs').innerHTML = (album?.sections || ['All files']).map(section => `<button class="${section === state.section ? 'active' : ''}" data-section="${escapeHtml(section)}" aria-pressed="${section === state.section}">${escapeHtml(section)}</button>`).join('');
  $('#section-tabs').querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => { state.section = button.dataset.section; renderDetail(); }));
  state.visibleFiles = related.filter(file => !album || state.section === 'All in this album' || file.section === state.section)
    .sort((left, right) => $('#file-sort').value === 'name' ? left.name.localeCompare(right.name) : right.added - left.added);
  $('#file-grid').innerHTML = state.visibleFiles.map((file, index) => `<article class="file-card"><button data-file-index="${index}" aria-label="Open ${escapeHtml(file.name)}"><div class="file-thumb"><img src="${escapeHtml(imageUrl(file))}" alt="">${file.type === 'video' ? `<span class="video-badge">${icon('Play')} Video</span>` : ''}</div><div class="file-caption"><strong>${escapeHtml(file.name)}</strong><small>${file.type === 'video' ? 'Video' : 'Photo'} · ${album ? 'This album' : file.album ? escapeHtml(albums.find(item => item.id === file.album)?.name || 'Album') : 'Unorganised'}</small></div></button></article>`).join('');
  $('#file-grid').querySelectorAll('[data-file-index]').forEach(button => button.addEventListener('click', () => openViewer(Number(button.dataset.fileIndex))));
  $('#album-empty').hidden = state.visibleFiles.length > 0;
  $('#empty-title').textContent = album && !related.length ? 'Your album is ready' : 'No files in this section';
  $('#empty-copy').textContent = album && !related.length ? 'Add photos and videos to start filling it.' : 'Choose another section to see more files.';
  $('#empty-add-files').hidden = Boolean(related.length);
  $('#add-files').hidden = broadLibrary;
}

// Route changes clear section scope and close the mobile drawer before rendering the next view.
function navigate(route, albumId = null) {
  state.route = route; state.albumId = albumId; state.section = albumId ? 'All in this album' : 'All files';
  $('#albums-view').hidden = route !== 'albums'; $('#detail-view').hidden = route === 'albums';
  $('#topbar-location').textContent = route === 'albums' ? 'Albums' : $('#topbar-location').textContent;
  document.querySelectorAll('.nav-item[data-route]').forEach(button => { const active = button.dataset.route === (albumId ? 'albums' : route); button.classList.toggle('active', active); active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current'); });
  closeNavigation();
  if (route === 'albums') renderAlbumIndex(); else renderDetail();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('#main-content').focus({ preventScroll: true });
}
function navigateToAlbum(albumId) { navigate('album', albumId); }

function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500); }
function closeNavigation() { $('#sidebar').classList.remove('is-open'); $('#navigation-scrim').hidden = true; $('#open-navigation').setAttribute('aria-expanded', 'false'); }
function openNavigation() { $('#sidebar').classList.add('is-open'); $('#navigation-scrim').hidden = false; $('#open-navigation').setAttribute('aria-expanded', 'true'); $('#close-navigation').focus(); }

// Dialog validation mirrors a real creation flow while keeping all data in this browser session.
function createAlbum(event) {
  event.preventDefault();
  const name = $('#new-album-name').value.trim();
  if (!name) { $('#name-error').textContent = 'Enter an album name.'; $('#new-album-name').focus(); return; }
  if (albums.some(album => album.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { $('#name-error').textContent = 'An album with this name already exists.'; $('#new-album-name').focus(); return; }
  const id = `album-${Date.now()}`;
  albums.unshift({ id, name, description: 'A new place for your photos and videos.', cover: '', updated: Date.now(), sections: ['All in this album'] });
  $('#create-dialog').close(); $('#new-album-name').value = ''; $('#name-error').textContent = ''; $('#album-search').value = '';
  navigateToAlbum(id); showToast(`“${name}” is ready for files.`);
}

// File selection is a local prototype action; selected images can be previewed without uploading.
function addLocalFiles(event) {
  const selected = [...event.target.files];
  if (!selected.length) return;
  const destination = state.albumId;
  selected.forEach((file, index) => files.unshift({ id: `local-${Date.now()}-${index}`, name: file.name, localUrl: URL.createObjectURL(file), album: destination, section: null, type: file.type.startsWith('video/') ? 'video' : 'photo', added: Date.now() + index }));
  event.target.value = ''; renderDetail(); renderAlbumIndex(); showToast(`${selected.length} ${selected.length === 1 ? 'file' : 'files'} added to this local preview.`);
}

// Viewer navigation stays inside the current album or deliberately chosen file scope.
function renderViewer() {
  const file = state.visibleFiles[state.viewerIndex];
  if (!file) return;
  $('#viewer-album').textContent = albums.find(album => album.id === state.albumId)?.name || (state.route === 'unorganised' ? 'Unorganised' : 'Browse all files');
  $('#viewer-title').textContent = file.name;
  $('#viewer-video').pause();
  $('#viewer-video').hidden = !(file.type === 'video' && file.localUrl);
  $('#viewer-image').hidden = !$('#viewer-video').hidden;
  if ($('#viewer-video').hidden) { $('#viewer-image').src = imageUrl(file); $('#viewer-image').alt = file.type === 'video' ? 'Illustrative still for video preview' : file.name; }
  else $('#viewer-video').src = file.localUrl;
  $('#viewer-position').textContent = `${state.viewerIndex + 1} of ${state.visibleFiles.length}${file.type === 'video' && !file.localUrl ? ' · illustrative video still' : ''}`;
  $('#viewer-previous').disabled = state.viewerIndex === 0;
  $('#viewer-next').disabled = state.viewerIndex === state.visibleFiles.length - 1;
}
function openViewer(index) { state.viewerIndex = index; renderViewer(); $('#viewer').showModal(); }

document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));
document.querySelectorAll('[data-demo-notice]').forEach(button => button.addEventListener('click', () => showToast(button.dataset.demoNotice)));
$('#album-search').addEventListener('input', renderAlbumIndex);
$('#album-sort').addEventListener('change', renderAlbumIndex);
$('#file-sort').addEventListener('change', renderDetail);
$('#clear-album-search').addEventListener('click', () => { $('#album-search').value = ''; renderAlbumIndex(); $('#album-search').focus(); });
$('.space-switcher').addEventListener('click', () => showToast('This concept shows My space. The full app keeps the space switcher.'));
$('#create-album').addEventListener('click', () => { $('#name-error').textContent = ''; $('#create-dialog').showModal(); $('#new-album-name').focus(); });
$('#close-dialog').addEventListener('click', () => $('#create-dialog').close());
$('#cancel-create').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', createAlbum);
$('#open-navigation').addEventListener('click', openNavigation);
$('#close-navigation').addEventListener('click', closeNavigation);
$('#navigation-scrim').addEventListener('click', closeNavigation);
$('#close-viewer').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('close', () => $('#viewer-video').pause());
$('#viewer-previous').addEventListener('click', () => { state.viewerIndex--; renderViewer(); });
$('#viewer-next').addEventListener('click', () => { state.viewerIndex++; renderViewer(); });
const filePicker = document.createElement('input'); filePicker.type = 'file'; filePicker.multiple = true; filePicker.accept = 'image/*,video/*'; filePicker.hidden = true; document.body.append(filePicker);
filePicker.addEventListener('change', addLocalFiles);
$('#add-files').addEventListener('click', () => filePicker.click());
$('#empty-add-files').addEventListener('click', () => filePicker.click());
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && state.route === 'albums') { event.preventDefault(); $('#album-search').focus(); } if ($('#viewer').open && event.key === 'ArrowRight' && state.viewerIndex < state.visibleFiles.length - 1) { state.viewerIndex++; renderViewer(); } if ($('#viewer').open && event.key === 'ArrowLeft' && state.viewerIndex > 0) { state.viewerIndex--; renderViewer(); } });
renderAlbumIndex();
