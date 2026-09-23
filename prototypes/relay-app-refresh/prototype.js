/* Review-only state. This prototype has no API, authentication, or live-library connection. */
const sampleFiles = [
  {id:1,name:'Afternoon at the studio.jpg',image:'interior',album:'spaces',type:'photo',category:'original',size:'8.4 MB',device:'My phone',date:'Today, 14:32',today:true,description:'A sunlit living space with natural textures and generous windows.'},
  {id:2,name:'A quieter kind of space.jpg',image:'living',album:'spaces',type:'photo',category:'original',size:'6.2 MB',device:'My phone',date:'Today, 14:30',today:true,description:'A calm contemporary interior with soft neutral tones.'},
  {id:3,name:'Lines in the light.jpg',image:'architecture',album:'weekend',type:'photo',category:'original',size:'7.1 MB',device:'My phone',date:'Today, 14:28',today:true,description:'Architectural shapes and light against a clear sky.'},
  {id:4,name:'A place to pause.jpg',image:'chair',album:'details',type:'photo',category:'original',size:'5.8 MB',device:'My phone',date:'Yesterday, 17:42',today:false,description:'An accent chair with a sculptural silhouette.'},
  {id:5,name:'The finishing touches.jpg',image:'details',album:'details',type:'photo',category:'original',size:'4.6 MB',device:'My phone',date:'Yesterday, 17:38',today:false,description:'Considered interior details and small everyday objects.'},
  {id:6,name:'Room to create.jpg',image:'studio',album:'spaces',type:'photo',category:'original',size:'9.3 MB',device:'My phone',date:'Yesterday, 17:35',today:false,description:'A bright interior with clean lines and natural materials.'},
  {id:7,name:'Spaces — the final story.mp4',image:'interior',album:'spaces',type:'video',category:'final',size:'86 MB',device:'My desktop',date:'Sep 16, 11:20',today:false,duration:'0:42',description:'Poster for a short film about a sunlit interior.'},
  {id:8,name:'Details worth keeping.mp4',image:'details',album:'details',type:'video',category:'final',size:'56.6 MB',device:'My desktop',date:'Sep 16, 10:18',today:false,duration:'0:28',description:'Poster for a short film about interior details.'},
];
const albumNames = {spaces:'Spaces & stories',details:'The little details',weekend:'Weekend light',empty:'Next project'};
sampleFiles.forEach(file => { file.albums = [file.album]; });
const state = {location:'all',query:'',type:'all',date:'all',sort:'newest',view:'grid',selected:new Set(),trashed:new Set(),viewerId:null,viewerFiles:[],anchor:null,undo:null};
const element = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="assets/icons.svg#${name}"/></svg>`;
const escapeText = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let toastTimer;
let transferTimer;
let dragDepth = 0;

// Apply the same query to grid, list, counts, selection scope, and the viewer sequence.
function visibleFiles() {
  const files = sampleFiles.filter(file => {
    const matchesTrash = state.location === 'trash' ? state.trashed.has(file.id) : !state.trashed.has(file.id);
    const matchesLocation = ['all','trash'].includes(state.location) || file.category === state.location || file.albums.includes(state.location);
    return matchesTrash && matchesLocation && file.name.toLowerCase().includes(state.query.toLowerCase()) && (state.type === 'all' || file.type === state.type) && (state.date === 'all' || file.today === (state.date === 'today'));
  });
  if (state.sort === 'oldest') files.reverse();
  if (state.sort === 'name') files.sort((first, second) => first.name.localeCompare(second.name));
  return files;
}

function cardMarkup(file) {
  return `<article class="media-card ${state.selected.has(file.id) ? 'selected' : ''}"><label class="select-file"><input type="checkbox" data-select="${file.id}" aria-label="Select ${escapeText(file.name)}" ${state.selected.has(file.id) ? 'checked' : ''}></label><button class="cover" data-preview="${file.id}" aria-label="Preview ${escapeText(file.name)}"><img src="assets/${file.image}.jpg" alt="${escapeText(file.description)}" loading="${file.id <= 4 ? 'eager' : 'lazy'}">${file.category === 'final' ? '<span class="category-pill">Final cut</span>' : ''}${file.type === 'video' ? `<span class="media-type">${icon('Play')}${file.duration}</span>` : ''}</button><div class="card-caption"><div><h3>${escapeText(file.name)}</h3><p>${icon(file.device === 'My phone' ? 'Smartphone' : 'Laptop')}<span>${file.device}</span><span>·</span><span>${file.size}</span></p></div><button class="icon-button" data-file-menu="${file.id}" aria-label="Actions for ${escapeText(file.name)}">${icon('MoreHorizontal')}</button></div></article>`;
}

// Render only sample records and keep all view states consistent after local interactions.
function renderLibrary() {
  const files = visibleFiles();
  const title = albumNames[state.location] || ({all:'Shared library',original:'Originals',final:'Final cuts',trash:'Trash'}[state.location]) || 'Shared library';
  element('page-title').innerHTML = `${escapeText(title)}<span>.</span>`;
  element('breadcrumb-current').textContent = albumNames[state.location] ? 'Albums' : 'Library';
  element('upload-label').textContent = albumNames[state.location] ? 'Add to album' : 'Add files';
  document.querySelector('.page-heading [data-action="upload"]').hidden = state.location === 'trash';
  element('gallery').innerHTML = files.map(cardMarkup).join('');
  element('gallery').classList.toggle('list-view', state.view === 'list');
  element('gallery').hidden = files.length === 0;
  element('empty-state').hidden = files.length > 0;
  element('result-count').textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  element('section-title').textContent = state.query ? `Results for “${state.query}”` : state.location === 'trash' ? 'Recently removed' : 'Recent additions';
  element('footer-count').textContent = state.location === 'all' && files.length === 8 ? '8 files · 184 MB' : `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  document.querySelectorAll('[data-location]').forEach(button => {
    const current = button.dataset.location === state.location;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    const count = button.querySelector('small');
    if (count) count.textContent = sampleFiles.filter(file => !state.trashed.has(file.id) && (button.dataset.location === 'all' || file.albums.includes(button.dataset.location) || file.category === button.dataset.location)).length;
  });
  renderEmptyState();
  renderFilterChips();
  updateSelection();
}

function renderEmptyState() {
  const filtered = state.query || state.type !== 'all' || state.date !== 'all';
  element('empty-title').textContent = filtered ? 'No matches' : state.location === 'trash' ? 'Trash is empty' : 'No files';
  element('empty-action').innerHTML = filtered ? `Clear filters ${icon('RotateCcw')}` : state.location === 'trash' ? `Back to library ${icon('ArrowRight')}` : `Add files ${icon('ArrowUpRight')}`;
}

function renderFilterChips() {
  const chips = [];
  if (state.type !== 'all') chips.push(`<button class="filter-chip" data-clear-filter="type">${state.type === 'photo' ? 'Photos' : 'Videos'} ${icon('X')}</button>`);
  if (state.date !== 'all') chips.push(`<button class="filter-chip" data-clear-filter="date">${state.date === 'today' ? 'Added today' : 'Before today'} ${icon('X')}</button>`);
  element('active-filters').innerHTML = chips.join('');
  element('active-filters').hidden = chips.length === 0;
  element('filter-count').hidden = chips.length === 0;
  element('filter-count').textContent = chips.length;
}

function updateSelection() {
  element('selection-bar').hidden = state.selected.size === 0;
  document.body.classList.toggle('has-selection', state.selected.size > 0);
  element('selection-count').textContent = `${state.selected.size} selected`;
  element('trash-selection').setAttribute('aria-label', state.location === 'trash' ? 'Restore selected files' : 'Move selected files to Trash');
  element('trash-selection').innerHTML = icon(state.location === 'trash' ? 'RotateCcw' : 'Trash2');
  document.querySelectorAll('[data-select]').forEach(input => {
    input.checked = state.selected.has(Number(input.dataset.select));
    input.closest('.media-card').classList.toggle('selected', input.checked);
  });
}

function setLocation(location) {
  state.location = location; state.query = ''; state.selected.clear(); state.anchor = null;
  element('search').value = ''; resetFilters(); closeNavigation(); renderLibrary();
}

function resetFilters() {
  state.type = 'all'; state.date = 'all';
  element('type-filter').value = 'all'; element('date-filter').value = 'all';
}

// Freeze the current browsing sequence so the viewer follows the user's filters and sort order.
function openViewer(id) {
  state.viewerId = id;
  state.viewerFiles = visibleFiles();
  element('viewer-details').hidden = true;
  element('toggle-details').setAttribute('aria-expanded','false');
  resetZoom(); renderViewer();
  element('viewer').showModal();
  element('close-viewer').focus();
}

// Swap media and metadata together; thumbnail navigation always reflects the active file.
function renderViewer() {
  const file = sampleFiles.find(candidate => candidate.id === state.viewerId);
  const index = state.viewerFiles.findIndex(candidate => candidate.id === file.id);
  element('viewer-title').textContent = file.name;
  element('viewer-subtitle').textContent = `${file.category === 'original' ? 'Original' : 'Final cut'} · ${file.size} · ${file.device}`;
  element('viewer-image').src = `assets/${file.image}.jpg`;
  element('viewer-image').alt = file.description;
  element('viewer-position').textContent = `${index + 1} of ${state.viewerFiles.length}`;
  element('previous-file').disabled = index === 0;
  element('next-file').disabled = index === state.viewerFiles.length - 1;
  element('video-note').hidden = file.type !== 'video';
  element('filmstrip').innerHTML = state.viewerFiles.map(item => `<button data-filmstrip="${item.id}" class="${item.id === file.id ? 'active' : ''}" aria-label="View ${escapeText(item.name)}" aria-pressed="${item.id === file.id}"><img src="assets/${item.image}.jpg" alt=""></button>`).join('');
  element('file-metadata').innerHTML = `<dt>Filename</dt><dd>${escapeText(file.name)}</dd><dt>Albums</dt><dd>${escapeText(file.albums.map(album => albumNames[album]).join(', ') || 'Unorganised')}</dd><dt>Added</dt><dd>${file.date}</dd><dt>Shared from</dt><dd>${file.device}</dd><dt>File type</dt><dd>${file.type === 'photo' ? 'JPEG image' : 'MP4 video'}</dd><dt>Size</dt><dd>${file.size}</dd>`;
}

function navigateViewer(direction) {
  const index = state.viewerFiles.findIndex(file => file.id === state.viewerId);
  const next = state.viewerFiles[index + direction];
  if (next) { state.viewerId = next.id; resetZoom(); renderViewer(); }
}

function resetZoom() {
  document.querySelector('.viewer-image-scroll').classList.remove('zoomed');
  element('zoom-viewer').setAttribute('aria-pressed','false');
  element('zoom-viewer').setAttribute('aria-label','Zoom in');
  element('zoom-viewer').innerHTML = icon('ZoomIn');
}

function showToast(message, undo) {
  clearTimeout(toastTimer); state.undo = undo || null;
  element('toast-message').textContent = message;
  element('undo-action').hidden = !undo;
  element('toast').hidden = false;
  if (!undo) toastTimer = setTimeout(() => { element('toast').hidden = true; }, 5000);
}

function showActionDialog(title, content) {
  element('action-title').textContent = title;
  element('action-content').innerHTML = content;
  element('action-dialog').showModal();
}

// Simulate transfer feedback without reading, storing, or uploading dropped local files.
function simulateTransfer() {
  element('action-dialog').close(); clearInterval(transferTimer);
  element('transfer-tray').hidden = false;
  element('transfer-title').textContent = 'Preparing files';
  element('transfer-description').textContent = 'Demo transfer';
  element('transfer-progress').value = 0;
  let progress = 0;
  transferTimer = setInterval(() => {
    progress = Math.min(100, progress + 8);
    element('transfer-progress').value = progress;
    element('transfer-title').textContent = progress < 24 ? 'Preparing files' : progress < 100 ? 'Adding files' : 'Complete';
    element('transfer-description').textContent = progress < 100 ? `${progress}%` : 'Demo only';
    if (progress === 100) clearInterval(transferTimer);
  }, 230);
}

function closeNavigation() {
  const wasOpen = document.querySelector('.sidebar').classList.contains('open');
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.workspace').inert = false;
  element('nav-scrim').hidden = true;
  document.querySelector('[data-action="menu"]').setAttribute('aria-expanded','false');
  if (wasOpen) document.querySelector('[data-action="menu"]').focus();
}

// Present review-safe stand-ins for flows that would otherwise mutate the live workspace.
function runAction(action) {
  if (action === 'upload') showActionDialog(albumNames[state.location] ? `Add to ${albumNames[state.location]}` : 'Add files', `<p class="dialog-note">Demo only. No files will be uploaded.</p><button class="button primary" id="simulate-transfer">${icon('Upload')}Start demo</button>`);
  if (action === 'devices') showActionDialog('Devices', `<div class="dialog-device">${icon('Laptop')}<div><strong>My desktop</strong><p>Owner · this device</p></div><span>YOU</span></div><div class="dialog-device">${icon('Smartphone')}<div><strong>My phone</strong><p>Member · paired device</p></div></div>`);
  if (action === 'help') showActionDialog('Prototype', '<p class="dialog-note">Sample data. Downloads, video playback, and pairing are not connected.</p>');
  if (action === 'demo-download') { if (element('viewer').open) showActionDialog('Download', '<p class="dialog-note">Not connected in this prototype.</p>'); else showToast('Download is not connected.'); }
  if (action === 'menu') { document.querySelector('.sidebar').classList.add('open'); element('nav-scrim').hidden = false; document.querySelector('[data-action="menu"]').setAttribute('aria-expanded','true'); document.querySelector('.workspace').inert = true; document.querySelector('.sidebar .wordmark').focus(); }
  if (action === 'new-album') showActionDialog('New album', '<form id="album-form"><label>Album name<input id="album-name" required maxlength="60" placeholder="Album name" autocomplete="off"></label><p id="album-error" class="form-error" hidden></p><button class="button primary" type="submit">Create album</button></form>');
  if (action === 'add-to-album') showActionDialog('Add to album', `${['spaces','details','weekend'].map((album,index) => `<button class="dialog-album" data-assign-album="${album}"><img src="assets/${['interior','chair','architecture'][index]}.jpg" alt=""><span>${albumNames[album]}</span>${icon('ChevronRight')}</button>`).join('')}`);
  if (action === 'reset') window.location.reload();
}

// Delegate local controls so freshly rendered cards retain the same accessible interactions.
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.location) setLocation(button.dataset.location);
  if (button.dataset.preview) openViewer(Number(button.dataset.preview));
  if (button.dataset.action) runAction(button.dataset.action);
  if (button.dataset.view) { state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(control => { control.setAttribute('aria-pressed',control === button); control.classList.toggle('active',control === button); }); renderLibrary(); }
  if (button.dataset.filmstrip) { state.viewerId = Number(button.dataset.filmstrip); resetZoom(); renderViewer(); }
  if (button.dataset.clearFilter) { state[button.dataset.clearFilter] = 'all'; element(`${button.dataset.clearFilter}-filter`).value = 'all'; renderLibrary(); }
  if (button.id === 'simulate-transfer') simulateTransfer();
  if (button.dataset.fileMenu) {
    const file = sampleFiles.find(item => item.id === Number(button.dataset.fileMenu));
    showActionDialog(file.name, `<button class="dialog-album" data-open-from-menu="${file.id}">${icon('Image')}Open preview ${icon('ArrowRight')}</button><button class="dialog-album" data-select-from-menu="${file.id}">${icon('CheckCheck')}Select file ${icon('Plus')}</button><p class="dialog-note">Select files to explore album actions and reversible Trash.</p>`);
  }
  if (button.dataset.openFromMenu) { element('action-dialog').close(); openViewer(Number(button.dataset.openFromMenu)); }
  if (button.dataset.selectFromMenu) { state.selected.add(Number(button.dataset.selectFromMenu)); element('action-dialog').close(); updateSelection(); }
  if (button.dataset.assignAlbum) {
    const originals = sampleFiles.filter(file => state.selected.has(file.id)).map(file => ({id:file.id,albums:[...file.albums]}));
    originals.forEach(previous => { const file = sampleFiles.find(file => file.id === previous.id); if (!file.albums.includes(button.dataset.assignAlbum)) file.albums.push(button.dataset.assignAlbum); });
    state.selected.clear(); element('action-dialog').close(); renderLibrary();
    showToast(`Added to ${albumNames[button.dataset.assignAlbum]}. Demo only.`, () => { originals.forEach(previous => { sampleFiles.find(file => file.id === previous.id).albums = previous.albums; }); renderLibrary(); });
  }
});

// Range selection follows the visible order and never selects filtered-out records.
element('gallery').addEventListener('click', event => {
  if (!event.target.matches('[data-select]')) return;
  const id = Number(event.target.dataset.select);
  const files = visibleFiles();
  const anchorIndex = files.findIndex(file => file.id === state.anchor);
  const clickedIndex = files.findIndex(file => file.id === id);
  const range = event.shiftKey && anchorIndex >= 0 ? files.slice(Math.min(anchorIndex,clickedIndex),Math.max(anchorIndex,clickedIndex) + 1) : files.filter(file => file.id === id);
  range.forEach(file => event.target.checked ? state.selected.add(file.id) : state.selected.delete(file.id));
  state.anchor = id; updateSelection();
});

element('search').addEventListener('input', event => { state.query = event.target.value; state.selected.clear(); renderLibrary(); });
element('sort').addEventListener('change', event => { state.sort = event.target.value; state.anchor = null; renderLibrary(); });
element('type-filter').addEventListener('change', event => { state.type = event.target.value; state.selected.clear(); renderLibrary(); });
element('date-filter').addEventListener('change', event => { state.date = event.target.value; state.selected.clear(); renderLibrary(); });
element('filter-toggle').addEventListener('click', () => { element('filter-panel').hidden = !element('filter-panel').hidden; element('filter-toggle').setAttribute('aria-expanded',!element('filter-panel').hidden); });
element('reset-filters').addEventListener('click', () => { resetFilters(); renderLibrary(); });
element('clear-selection').addEventListener('click', () => { state.selected.clear(); updateSelection(); });
element('select-visible').addEventListener('click', () => { visibleFiles().forEach(file => state.selected.add(file.id)); updateSelection(); });
element('close-viewer').addEventListener('click', () => element('viewer').close());
element('close-action').addEventListener('click', () => element('action-dialog').close());
element('previous-file').addEventListener('click', () => navigateViewer(-1));
element('next-file').addEventListener('click', () => navigateViewer(1));
element('nav-scrim').addEventListener('click', closeNavigation);
element('close-transfer').addEventListener('click', () => { element('transfer-tray').hidden = true; });
element('toggle-details').addEventListener('click', () => { element('viewer-details').hidden = !element('viewer-details').hidden; element('toggle-details').setAttribute('aria-expanded',!element('viewer-details').hidden); });
element('zoom-viewer').addEventListener('click', () => { const zoomed = document.querySelector('.viewer-image-scroll').classList.toggle('zoomed'); element('zoom-viewer').setAttribute('aria-pressed',zoomed); element('zoom-viewer').setAttribute('aria-label',zoomed ? 'Zoom out' : 'Zoom in'); element('zoom-viewer').innerHTML = icon(zoomed ? 'ZoomOut' : 'ZoomIn'); });
element('empty-action').addEventListener('click', () => { if (state.query || state.type !== 'all' || state.date !== 'all') { state.query = ''; element('search').value = ''; resetFilters(); renderLibrary(); } else if (state.location === 'trash') setLocation('all'); else runAction('upload'); });
element('trash-selection').addEventListener('click', () => { const ids = [...state.selected]; const restoring = state.location === 'trash'; ids.forEach(id => restoring ? state.trashed.delete(id) : state.trashed.add(id)); state.selected.clear(); renderLibrary(); showToast(`${ids.length} ${ids.length === 1 ? 'file' : 'files'} ${restoring ? 'restored' : 'moved to Trash'}. Demo only.`, () => { ids.forEach(id => restoring ? state.trashed.add(id) : state.trashed.delete(id)); renderLibrary(); }); });
element('undo-action').addEventListener('click', () => { if (state.undo) state.undo(); state.undo = null; element('toast').hidden = true; });

// Creating an album only adds a local navigation item; reload restores the original sample set.
document.addEventListener('submit', event => {
  if (event.target.id !== 'album-form') return;
  event.preventDefault();
  const name = element('album-name').value.trim();
  if (!name) { element('album-error').textContent = 'Give your album a name.'; element('album-error').hidden = false; return; }
  const id = `sample-${Object.keys(albumNames).length}`;
  albumNames[id] = name;
  document.querySelector('.album-nav').insertAdjacentHTML('beforeend', `<button class="nav-item" data-location="${id}">${icon('Folder')}<span>${escapeText(name)}</span><small>0</small></button>`);
  element('action-dialog').close(); setLocation(id); showToast('Sample album created.');
});

// Keep typing shortcuts out of form fields and confine viewer navigation to its active dialog.
document.addEventListener('keydown', event => {
  const editing = event.target.matches('input,select,textarea');
  if (element('action-dialog').open) return;
  if (element('viewer').open) {
    if (event.key === 'ArrowRight') { event.preventDefault(); navigateViewer(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); navigateViewer(-1); }
    return;
  }
  if (!editing && event.key === '/') { event.preventDefault(); element('search').focus(); }
  if (event.key === 'Escape') { closeNavigation(); state.selected.clear(); updateSelection(); }
});

document.addEventListener('dragenter', event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth++; element('drop-overlay').hidden = false; });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0,dragDepth - 1); if (!dragDepth) element('drop-overlay').hidden = true; });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; element('drop-overlay').hidden = true; simulateTransfer(); });
renderLibrary();
