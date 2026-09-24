const iconPaths = {
  albums: '<rect x="5" y="5" width="15" height="16" rx="2"/><path d="M15 5V2H2v15h3M9 10h7M9 14h4"/>',
  pin: '<path d="m15 3 6 6-4 1-4 6-2-2-6 6 5-7-2-2 6-4z"/>',
  inbox: '<path d="M3 4h18v16H3zM3 13h5l2 3h4l2-3h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8 6 4-6 4zM6 3v18M18 3v18"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.albums}</svg>`;
const escapeText = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const colours = [
  { name: 'Clay', cover: '#b9654c', ink: '#fff0d9', shape: '#d78e69' },
  { name: 'Olive', cover: '#d4d8b9', ink: '#414d38', shape: '#b2bd91' },
  { name: 'Blue', cover: '#b8cbd1', ink: '#354b58', shape: '#8bafb9' },
  { name: 'Sand', cover: '#e3d4b4', ink: '#665535', shape: '#c6b185' },
  { name: 'Plum', cover: '#c7bdce', ink: '#504158', shape: '#a190ae' },
  { name: 'Forest', cover: '#637b6c', ink: '#f0efd9', shape: '#91a48b' },
];
const sampleRoot = '../relay-app-refresh/assets/';
const files = [
  { id: 'f1', name: 'Morning light.jpg', image: 'interior.jpg', section: 'Moments', kind: 'Photo' },
  { id: 'f2', name: 'A quiet corner.jpg', image: 'chair.jpg', section: 'Details', kind: 'Photo' },
  { id: 'f3', name: 'Spaces between.jpg', image: 'architecture.jpg', section: 'Moments', kind: 'Photo' },
  { id: 'f4', name: 'The little things.jpg', image: 'details.jpg', section: 'Details', kind: 'Photo' },
  { id: 'f5', name: 'Sunday afternoon.mp4', section: 'Films', kind: 'Video', sampleVideo: true },
  { id: 'f6', name: 'At home.jpg', image: 'living.jpg', section: 'Moments', kind: 'Photo' },
  { id: 'f7', name: 'Studio study.jpg', image: 'studio.jpg', section: '', kind: 'Photo' },
  { id: 'f8', name: 'Window details.jpg', image: 'details.jpg', section: '', kind: 'Photo' },
  { id: 'f9', name: 'An afternoon walk.mp4', section: '', kind: 'Video', sampleVideo: true },
];
let albums = [
  { id: 'slow-sundays', name: 'Slow Sundays', description: 'Little moments, good light, and nowhere to rush.', colour: 0, pinned: true, sections: ['Moments', 'Details', 'Films'], files: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'], space: 'personal', updated: 6, date: 'Today' },
  { id: 'spaces', name: 'Spaces & stories', description: 'Rooms and places worth remembering.', colour: 1, pinned: true, sections: ['Interiors', 'Architecture'], files: ['f1', 'f3', 'f6'], space: 'personal', updated: 5, date: 'Yesterday' },
  { id: 'coast', name: 'Along the coast', description: 'A collection for the next escape.', colour: 2, pinned: false, sections: [], files: [], space: 'personal', updated: 4, date: '22 Sep' },
  { id: 'details', name: 'The little details', description: 'Shapes, textures and small discoveries.', colour: 3, pinned: false, sections: ['Details'], files: ['f2', 'f4'], space: 'personal', updated: 3, date: '20 Sep' },
  { id: 'everyday', name: 'Everyday, lately', description: 'The ordinary things that make a life.', colour: 4, pinned: false, sections: [], files: ['f6'], space: 'personal', updated: 2, date: '18 Sep' },
  { id: 'next-chapter', name: 'The next chapter', description: 'Something new starts here.', colour: 5, pinned: false, sections: [], files: [], space: 'personal', updated: 1, date: '16 Sep' },
  { id: 'studio', name: 'Studio journal', description: 'Ideas and observations from the studio.', colour: 1, pinned: true, sections: ['Sources', 'Shortlist', 'Finals'], files: ['f7'], space: 'shared', updated: 7, date: 'Today' },
];
const sectionPlacements = new Map();
const inbox = { personal: ['f7', 'f8', 'f9'], shared: [] };
const state = { space: 'personal', query: '', sort: 'recent', layout: 'grid', section: 'all', type: 'all' };
const main = document.querySelector('#main');
const currentSpaceName = () => state.space === 'personal' ? 'Personal space' : 'Studio space';
const currentRoute = () => decodeURIComponent(location.hash.slice(1));
const currentAlbum = () => albums.find(album => album.id === currentRoute() && album.space === state.space);
const spaceAlbums = () => albums.filter(album => album.space === state.space);
const getFile = id => files.find(file => file.id === id);
const albumSection = (album, file) => sectionPlacements.get(`${album.id}:${file.id}`) ?? (album.sections.includes(file.section) ? file.section : 'Unsectioned');
let toastTimeout;

function announce(message) {
  document.querySelector('#announcement').textContent = message;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { document.querySelector('#announcement').textContent = ''; }, 4500);
}

function coverMarkup(album, extraClass = '') {
  const colour = colours[album.colour];
  return `<div class="album-art art-${album.colour} ${extraClass}" style="--cover:${colour.cover};--cover-ink:${colour.ink};--shape:${colour.shape}" aria-hidden="true"><span class="cover-top">RELAY COLLECTION</span><span class="cover-shape"></span><span class="cover-number">${String(albums.indexOf(album) + 1).padStart(2, '0')}</span><span class="cover-bottom">${colour.name.toUpperCase()} / 26</span></div>`;
}

function albumCardMarkup(album) {
  return `<article class="album-card"><a class="album-open" href="#${album.id}" aria-label="Open ${escapeText(album.name)}">${coverMarkup(album)}<h2 class="card-title">${icon('albums')}<span>${escapeText(album.name)}</span></h2><p class="card-meta">${album.files.length} ${album.files.length === 1 ? 'file' : 'files'}<span class="dot">·</span>${album.sections.length} ${album.sections.length === 1 ? 'section' : 'sections'}<span class="dot">·</span>${album.date}</p></a><button class="pin-button" data-pin="${album.id}" aria-label="${album.pinned ? 'Unpin' : 'Pin'} ${escapeText(album.name)}" aria-pressed="${album.pinned}">${icon('pin')}</button></article>`;
}

function toolbarMarkup(isAlbum = false) {
  // Keep search semantics visibly scoped; the same control never searches other workspaces.
  const count = spaceAlbums().length;
  const tabs = isAlbum ? `<div class="tabs" aria-label="File type">${['all', 'Photo', 'Video'].map(type => `<button class="tab ${state.type === type ? 'active' : ''}" data-type="${type}" aria-pressed="${state.type === type}">${type === 'all' ? 'All media' : type + 's'}</button>`).join('')}</div>` : `<div class="tabs"><a class="tab ${currentRoute() !== 'pinned' ? 'active' : ''}" href="#" ${currentRoute() !== 'pinned' ? 'aria-current="page"' : ''}>All albums <span>${count}</span></a><a class="tab ${currentRoute() === 'pinned' ? 'active' : ''}" href="#pinned" ${currentRoute() === 'pinned' ? 'aria-current="page"' : ''}>Pinned <span>${spaceAlbums().filter(album => album.pinned).length}</span></a></div>`;
  return `<div class="toolbar">${tabs}<div class="toolbar-tools"><label class="search">${icon('search')}<input type="search" id="search" aria-label="${isAlbum ? 'Search this album' : 'Search albums'}" placeholder="${isAlbum ? 'Search this album…' : 'Find an album…'}" value="${escapeText(state.query)}"></label>${!isAlbum ? `<select class="sort" id="sort" aria-label="Sort albums"><option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Last updated</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>Name A–Z</option></select><div class="view-switch" aria-label="Album view"><button aria-label="Grid view" data-layout="grid" aria-pressed="${state.layout === 'grid'}">${icon('grid')}</button><button aria-label="List view" data-layout="list" aria-pressed="${state.layout === 'list'}">${icon('list')}</button></div>` : ''}</div></div>`;
}

function renderAlbumResults() {
  // Render collection metadata only: no file thumbnails or image elements exist on arrival.
  const visibleAlbums = spaceAlbums().filter(album => (currentRoute() !== 'pinned' || album.pinned) && `${album.name} ${album.description}`.toLowerCase().includes(state.query.toLowerCase()));
  visibleAlbums.sort((first, second) => state.sort === 'name' ? first.name.localeCompare(second.name) : second.updated - first.updated);
  document.querySelector('#result-count').textContent = `${visibleAlbums.length} ${visibleAlbums.length === 1 ? 'album' : 'albums'}${state.query ? ' found' : ' in your collection'}`;
  const results = document.querySelector('#album-results');
  results.className = `album-grid ${state.layout === 'list' ? 'list-view' : ''}`;
  results.innerHTML = visibleAlbums.map(albumCardMarkup).join('');
  if (!visibleAlbums.length) {
    results.className = '';
    results.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('albums')}</div><h2>${state.query ? 'No matching albums.' : currentRoute() === 'pinned' ? 'Keep your favourites close.' : 'Your first chapter starts here.'}</h2><p>${state.query ? 'Try a different album name or clear your search.' : currentRoute() === 'pinned' ? 'Pin an album from your collection to find it here.' : 'Create an album, then add the photos and videos that belong together.'}</p>${state.query ? '<button class="button" data-clear-search>Clear search</button>' : currentRoute() === 'pinned' ? '<a class="button" href="#">Browse albums</a>' : '<button class="button primary" data-create>Create your first album</button>'}</div>`;
  } else if (!state.query && currentRoute() !== 'pinned') results.insertAdjacentHTML('beforeend', '<button class="new-card" data-create><span class="plus-circle">+</span><strong>A new collection</strong><small>Make room for what’s next</small></button>');
}

function renderLibrary() {
  main.className = '';
  main.innerHTML = `<div class="heading"><div><span class="eyebrow">YOUR LIFE, WELL COLLECTED</span><h1>${currentRoute() === 'pinned' ? 'Close to <em>hand.</em>' : 'A home for <em>every story.</em>'}</h1><p>Choose an album. Pick up where you left off.</p></div><button class="button primary" data-create>${icon('plus')}New album <span>↗</span></button></div>${toolbarMarkup()}<div class="result-label"><span id="result-count" role="status"></span><span>Every collection, in its own place.</span></div><div id="album-results"></div>${inbox[state.space].length ? `<div class="organise-banner"><span class="organise-icon">${icon('inbox')}</span><div><strong>${inbox[state.space].length} files are waiting for a home.</strong><p>Give unorganised photos and videos a place in your collection.</p></div><a href="#inbox">Organise files <span>↗</span></a></div>` : ''}`;
  renderAlbumResults();
}

function fileCardMarkup(file) {
  return `<button class="file-card" data-file="${file.id}" aria-label="Preview ${escapeText(file.name)}">${file.image || file.url && file.kind === 'Photo' ? `<img src="${escapeText(file.url || sampleRoot + file.image)}" alt="" loading="lazy">` : `<div class="file-placeholder">${icon('film')}<span>${file.sampleVideo ? 'Video sample' : 'Video preview'}</span></div>`}<div class="file-info"><strong>${escapeText(file.name)}</strong><span>${file.kind.toUpperCase()}</span></div></button>`;
}

function renderFileResults() {
  const album = currentAlbum();
  const visibleFiles = album.files.map(getFile).filter(file => (state.section === 'all' || albumSection(album, file) === state.section) && (state.type === 'all' || file.kind === state.type) && file.name.toLowerCase().includes(state.query.toLowerCase()));
  document.querySelector('#file-count').textContent = `${visibleFiles.length} ${visibleFiles.length === 1 ? 'file' : 'files'} · ${state.section === 'all' ? 'All in this album' : state.section}`;
  document.querySelector('#file-results').innerHTML = visibleFiles.length ? `<div class="file-grid">${visibleFiles.map(fileCardMarkup).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icon('albums')}</div><h2>${album.files.length ? 'Nothing here just yet.' : 'A little space for your story.'}</h2><p>${state.query || state.type !== 'all' ? 'No files match these filters. Try clearing them.' : 'Add photos and videos to this ' + (state.section === 'all' ? 'album' : 'section') + '. They’ll be here when you open it.'}</p>${state.query || state.type !== 'all' ? '<button class="button" data-clear-filters>Clear filters</button>' : '<button class="button primary" data-add>Add photos & videos</button>'}</div>`;
}

function renderAlbum(album) {
  // Sections remain within this album; they are organisational labels, never privacy promises.
  main.className = 'album-detail';
  const photos = album.files.map(getFile).filter(file => file.kind === 'Photo').length;
  const sections = ['all', ...album.sections, 'Unsectioned'];
  main.innerHTML = `<a class="back-link" href="#">${icon('arrow')}Back to albums</a><div class="heading"><div class="album-intro">${coverMarkup(album, 'mini-cover')}<div><span class="eyebrow">${escapeText(currentSpaceName())} / ALBUM</span><h1>${escapeText(album.name)}</h1><p>${escapeText(album.description || 'Your new collection. Make it your own.')}</p></div></div><div class="album-actions"><button class="button quiet" data-pin="${album.id}" aria-pressed="${album.pinned}">${icon('pin')}${album.pinned ? 'Pinned' : 'Pin album'}</button><button class="button primary" data-add>${icon('plus')}Add files</button></div></div><div class="detail-summary"><span>${photos} ${photos === 1 ? 'photo' : 'photos'} · ${album.files.length - photos} ${album.files.length - photos === 1 ? 'video' : 'videos'}</span><span>${album.sections.length} sections</span><span>${state.space === 'personal' ? 'In your personal space' : 'In the shared Studio space'}</span></div><nav class="sections" aria-label="Album sections">${sections.map(section => `<button class="tab ${state.section === section ? 'active' : ''}" data-section="${escapeText(section)}" aria-pressed="${state.section === section}">${section === 'all' ? 'All in this album' : escapeText(section)} <span>${section === 'all' ? album.files.length : album.files.map(getFile).filter(file => albumSection(album, file) === section).length}</span></button>`).join('')}</nav>${toolbarMarkup(true)}<div class="result-label"><span id="file-count" role="status"></span><span>Inside this album only</span></div><div id="file-results"></div>`;
  renderFileResults();
}

function renderInbox() {
  main.className = 'album-detail';
  main.innerHTML = `<a class="back-link" href="#">${icon('arrow')}Back to albums</a><div class="heading"><div><span class="eyebrow">${escapeText(currentSpaceName())} / TO ORGANISE</span><h1>Waiting for a <em>home.</em></h1><p>These files aren’t in an album yet. Your originals stay safe.</p></div><button class="button primary" data-create>New album <span>↗</span></button></div><div class="result-label"><span>${inbox[state.space].length} unorganised files</span><span>Open an album → Add files to organise these.</span></div>${inbox[state.space].length ? `<div class="file-grid">${inbox[state.space].map(getFile).map(fileCardMarkup).join('')}</div>` : '<div class="empty-state"><h2>Everything has a home.</h2><p>There are no unorganised files in this space.</p><a class="button" href="#">Back to albums</a></div>'}`;
}

function renderRoute(focusHeading = false) {
  // Resolve routes against the active space before showing any file content.
  const route = currentRoute();
  const album = currentAlbum();
  document.querySelector('#nav-count').textContent = spaceAlbums().length;
  document.querySelector('#inbox-count').textContent = inbox[state.space].length;
  document.querySelector('#scope-label').innerHTML = `${icon(state.space === 'personal' ? 'lock' : 'albums')}${currentSpaceName()}`;
  document.querySelector('.space-avatar').textContent = state.space === 'personal' ? 'P' : 'S';
  for (const [id, active] of [['albums-link', !route || !!album], ['pinned-link', route === 'pinned'], ['inbox-link', route === 'inbox']]) {
    const link = document.getElementById(id);
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  document.querySelector('#breadcrumb').innerHTML = `<a href="#">${currentSpaceName()}</a><span class="separator">/</span>${album ? `<a href="#">Albums</a><span class="separator">/</span><strong>${escapeText(album.name)}</strong>` : `<strong>${route === 'inbox' ? 'Unorganised' : route === 'pinned' ? 'Pinned albums' : 'Albums'}</strong>`}`;
  if (album) renderAlbum(album);
  else if (route === 'inbox') renderInbox();
  else if (!route || route === 'pinned') renderLibrary();
  else main.innerHTML = '<div class="empty-state"><h1>Album unavailable</h1><p>This album isn’t in the current space.</p><a class="button" href="#">Back to albums</a></div>';
  document.title = `Relay — ${album ? album.name : route === 'inbox' ? 'Unorganised' : 'Your albums'}`;
  if (focusHeading) { main.focus(); window.scrollTo(0, 0); }
}

function openCreateDialog() {
  document.querySelector('#create-form').reset();
  document.querySelector('#create-destination').textContent = `New album in ${currentSpaceName()}`;
  document.querySelector('#audience-note').textContent = state.space === 'personal' ? 'Created in your personal space. Nothing is shared by creating an album.' : 'This album belongs to the shared Studio space. Sections inherit its access; they do not create private areas.';
  document.querySelector('#create-dialog').showModal();
  document.querySelector('#album-name').focus();
}

function openAddDialog() {
  const album = currentAlbum();
  document.querySelector('#upload-destination').textContent = `${currentSpaceName()} → ${album.name}${state.section !== 'all' ? ' → ' + state.section : ''}`;
  document.querySelector('#local-files').value = '';
  const available = inbox[state.space].map(getFile).filter(file => !album.files.includes(file.id));
  document.querySelector('#existing-files').innerHTML = available.length ? available.map(file => `<label class="sample-option"><input type="checkbox" value="${file.id}"><span>${escapeText(file.name)}</span><small>${file.kind}</small></label>`).join('') : '<p class="muted">No unorganised sample files in this space. Choose a local file above.</p>';
  document.querySelector('#add-samples').disabled = true;
  document.querySelector('#add-dialog').showModal();
}

function addFilesToCurrentAlbum(fileIds) {
  // Capture this album and section explicitly; do not reroute files to a broader library.
  const album = currentAlbum();
  const section = state.section === 'all' ? 'Unsectioned' : state.section;
  for (const id of fileIds) {
    if (!album.files.includes(id)) album.files.push(id);
    sectionPlacements.set(`${album.id}:${id}`, section);
  }
  inbox[state.space] = inbox[state.space].filter(id => !fileIds.includes(id));
  album.updated = Date.now();
  album.date = 'Today';
  state.query = ''; state.type = 'all';
  document.querySelector('#add-dialog').close();
  renderRoute();
  announce(`${fileIds.length} ${fileIds.length === 1 ? 'file' : 'files'} added to ${album.name}. Demo changes reset on reload.`);
}

function openFilePreview(fileId) {
  // Only files from the explicitly opened album or current-space inbox can be previewed.
  const allowed = currentAlbum()?.files || (currentRoute() === 'inbox' ? inbox[state.space] : []);
  if (!allowed.includes(fileId)) return;
  const file = getFile(fileId);
  document.querySelector('#viewer-title').textContent = file.name;
  document.querySelector('#viewer-content').innerHTML = file.sampleVideo ? '<div class="empty-state"><h2>A place for your films, too.</h2><p>This sample represents a video. Add a local video to try playback.</p></div>' : file.kind === 'Video' ? `<video src="${escapeText(file.url)}" controls autoplay></video>` : `<img src="${escapeText(file.url || sampleRoot + file.image)}" alt="${escapeText(file.name)}">`;
  document.querySelector('#viewer-caption').textContent = `${currentSpaceName()} / ${currentAlbum()?.name || 'Unorganised'} · ${file.url ? 'Local file preview · not uploaded' : 'Illustrative sample content'}`;
  document.querySelector('#viewer').showModal();
}

function setMobileNavigation(open) {
  const sidebar = document.querySelector('#sidebar');
  sidebar.classList.toggle('open', open);
  document.querySelector('#scrim').hidden = !open;
  document.querySelector('#open-menu').setAttribute('aria-expanded', String(open));
  sidebar.inert = !open && matchMedia('(max-width: 800px)').matches;
  document.querySelector('.workspace').inert = open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) document.querySelector('#close-menu').focus();
  else document.querySelector('#open-menu').focus({ preventScroll: true });
}

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
document.querySelector('#colour-options').innerHTML = colours.map((colour, index) => `<label title="${colour.name}" style="--swatch:${colour.cover}"><input type="radio" name="colour" value="${index}" aria-label="${colour.name}" ${index === 0 ? 'checked' : ''}><span></span></label>`).join('');

document.addEventListener('click', event => {
  // Delegate controls so rerendered views keep their interactions without duplicate listeners.
  const control = event.target.closest('button, a');
  if (!control) return;
  if (control.hasAttribute('data-create')) openCreateDialog();
  if (control.hasAttribute('data-add')) openAddDialog();
  if (control.hasAttribute('data-close')) control.closest('dialog').close();
  if (control.dataset.file) openFilePreview(control.dataset.file);
  if (control.dataset.pin) {
    const album = albums.find(item => item.id === control.dataset.pin);
    album.pinned = !album.pinned;
    if (currentAlbum()) renderAlbum(album); else renderLibrary();
    const replacement = main.querySelector(`[data-pin="${album.id}"]`);
    if (replacement) replacement.focus(); else main.focus();
    announce(`${album.name} ${album.pinned ? 'pinned' : 'unpinned'}.`);
  }
  if (control.dataset.layout) { state.layout = control.dataset.layout; renderLibrary(); main.querySelector(`[data-layout="${state.layout}"]`).focus(); }
  if (control.dataset.section) { state.section = control.dataset.section; state.query = ''; renderAlbum(currentAlbum()); [...main.querySelectorAll('[data-section]')].find(button => button.dataset.section === state.section).focus(); }
  if (control.dataset.type) { state.type = control.dataset.type; main.querySelectorAll('[data-type]').forEach(button => { button.classList.toggle('active', button.dataset.type === state.type); button.setAttribute('aria-pressed', String(button.dataset.type === state.type)); }); renderFileResults(); }
  if (control.hasAttribute('data-clear-search')) { state.query = ''; renderLibrary(); document.querySelector('#search').focus(); }
  if (control.hasAttribute('data-clear-filters')) { state.query = ''; state.type = 'all'; renderAlbum(currentAlbum()); document.querySelector('#search').focus(); }
  if (control.closest('#sidebar') && control.tagName === 'A' && document.querySelector('#sidebar').classList.contains('open')) setMobileNavigation(false);
});

main.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  state.query = event.target.value;
  if (currentAlbum()) renderFileResults(); else renderAlbumResults();
});
main.addEventListener('change', event => { if (event.target.id === 'sort') { state.sort = event.target.value; renderAlbumResults(); } });

document.querySelector('#create-form').addEventListener('submit', event => {
  // Create an empty collection first; adding content is a separate, explicitly scoped step.
  event.preventDefault();
  const form = new FormData(event.target);
  const name = form.get('name').trim();
  if (!name) { document.querySelector('#album-name').setCustomValidity('Enter an album name.'); document.querySelector('#album-name').reportValidity(); return; }
  const sections = form.get('template') === 'story' ? ['Moments', 'Details', 'Films'] : form.get('template') === 'project' ? ['Sources', 'Shortlist', 'Finals'] : [];
  const album = { id: 'album-' + crypto.randomUUID(), name, description: form.get('description').trim(), colour: Number(form.get('colour')), pinned: false, sections, files: [], space: state.space, updated: Date.now(), date: 'Today' };
  albums.push(album);
  document.querySelector('#create-dialog').close();
  location.hash = album.id;
  announce(`“${name}” created. Add files when you’re ready.`);
});
document.querySelector('#album-name').addEventListener('input', event => event.target.setCustomValidity(''));
document.querySelector('#existing-files').addEventListener('change', () => { document.querySelector('#add-samples').disabled = !document.querySelector('#existing-files input:checked'); });
document.querySelector('#add-samples').addEventListener('click', () => addFilesToCurrentAlbum([...document.querySelectorAll('#existing-files input:checked')].map(input => input.value)));
document.querySelector('#local-files').addEventListener('change', event => {
  const chosenFiles = [...event.target.files].filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
  if (!chosenFiles.length) { announce('Choose a photo or video to preview.'); return; }
  const localPreviews = chosenFiles.map(file => ({ id: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), kind: file.type.startsWith('image/') ? 'Photo' : 'Video', section: '' }));
  files.push(...localPreviews);
  addFilesToCurrentAlbum(localPreviews.map(file => file.id));
});
document.querySelector('#viewer').addEventListener('close', () => { document.querySelector('#viewer-content').innerHTML = ''; });
document.querySelector('#space').addEventListener('change', event => {
  state.space = event.target.value;
  state.query = ''; state.section = 'all'; state.type = 'all';
  if (location.hash) location.hash = ''; else renderRoute(true);
});
document.querySelector('#open-menu').addEventListener('click', () => setMobileNavigation(true));
document.querySelector('#close-menu').addEventListener('click', () => setMobileNavigation(false));
document.querySelector('#scrim').addEventListener('click', () => setMobileNavigation(false));
document.querySelector('#about').addEventListener('click', () => { if (document.querySelector('#sidebar').classList.contains('open')) setMobileNavigation(false); document.querySelector('#about-dialog').showModal(); });
document.addEventListener('keydown', event => {
  // Trap the mobile drawer's focus and support Escape without affecting native dialog handling.
  const sidebar = document.querySelector('#sidebar');
  if (!sidebar.classList.contains('open')) return;
  if (event.key === 'Escape') setMobileNavigation(false);
  if (event.key !== 'Tab') return;
  const focusable = [...sidebar.querySelectorAll('a, button, select')].filter(element => element.getClientRects().length);
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
matchMedia('(max-width: 800px)').addEventListener('change', () => {
  const mobile = matchMedia('(max-width: 800px)').matches;
  if (!mobile && document.querySelector('#sidebar').classList.contains('open')) setMobileNavigation(false);
  document.querySelector('#sidebar').inert = mobile && !document.querySelector('#sidebar').classList.contains('open');
});
window.addEventListener('hashchange', () => { state.query = ''; state.section = 'all'; state.type = 'all'; renderRoute(true); });
document.querySelector('#sidebar').inert = matchMedia('(max-width: 800px)').matches;
renderRoute();
