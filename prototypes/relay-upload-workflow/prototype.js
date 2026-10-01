const content = document.getElementById('content');
const panel = document.getElementById('upload-panel');
const uploadStatus = document.getElementById('upload-status');
const model = { page: 'Albums', workspace: 'Personal', album: 'Coast weekend', jobs: [], panel: false, cancelReview: false };
const attentionStates = ['missing', 'access', 'error'];
const stateLabels = { sending: 'Uploading', queued: 'Queued', paused: 'Paused by you', offline: 'Waiting for connection', missing: 'Original needed', access: 'File access needed', error: 'Storage full', complete: 'Uploaded' };
const escapeMarkup = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatSize = value => value >= 1000 ? `${(value / 1000).toFixed(1)} GB` : `${Math.round(value)} MB`;

// All jobs are fixtures; navigation changes the view, never the captured destination.
function createSampleJobs() {
  const destination = `${model.workspace} / ${model.album}`;
  return [
    { id: 1, name: 'Coast-001.mov', size: 2400, sent: 1050, state: 'sending', source: 'memory', destination },
    { id: 2, name: 'Coast-002.mov', size: 900, sent: 0, state: 'queued', source: 'memory', destination },
    { id: 3, name: 'Evening-014.heic', size: 18, sent: 18, state: 'complete', source: 'none', destination },
  ];
}

// Aggregate bytes represent acknowledged demo progress; needing attention is separate from active work.
function summarizeUploads() {
  const total = model.jobs.reduce((sum, job) => sum + job.size, 0);
  const sent = model.jobs.reduce((sum, job) => sum + job.sent, 0);
  const completed = model.jobs.filter(job => job.state === 'complete').length;
  const attention = model.jobs.filter(job => attentionStates.includes(job.state)).length;
  const active = model.jobs.filter(job => ['sending', 'queued'].includes(job.state)).length;
  let title = `${completed} of ${model.jobs.length} uploaded`;
  if (!model.jobs.length) title = 'No uploads';
  else if (completed === model.jobs.length) title = `${completed} uploaded`;
  else if (attention) title = `${completed} uploaded · ${attention} need attention`;
  else if (model.jobs.some(job => job.state === 'offline')) title = 'Waiting for connection';
  else if (!active) title = 'Uploads paused';
  return { total, sent, completed, attention, active, title };
}

function announce(message) { document.getElementById('feedback').textContent = message; }

// Scenario selection resets only this demonstration, and deliberately leaves returning users unobstructed.
function selectScenario(scenario) {
  model.jobs = scenario === 'fresh' ? [] : createSampleJobs();
  model.panel = false; model.cancelReview = false; model.page = 'Albums';
  for (const job of model.jobs.filter(item => item.state !== 'complete')) {
    if (scenario === 'offline') job.state = 'offline';
    if (scenario === 'returned') { job.source = 'handle'; job.state = job.id === 1 ? 'sending' : 'paused'; }
    if (scenario === 'access') { job.source = 'handle'; job.state = 'access'; }
    if (scenario === 'missing') { job.source = 'missing'; job.state = 'missing'; }
    if (scenario === 'mixed') job.state = job.id === 1 ? 'complete' : 'error';
    if (scenario === 'complete') job.state = 'complete';
    if (job.state === 'complete') job.sent = job.size;
  }
  announce(scenario === 'returned' ? 'Demo: retained file access restores one upload; your paused upload stays paused.' : '');
  renderApplication();
}

// Ordinary additions acknowledge the batch without opening a panel or moving keyboard focus.
function addSampleBatch() {
  const offset = model.jobs.reduce((maximum, job) => Math.max(maximum, job.id), 0);
  model.jobs.push(...createSampleJobs().map(job => ({ ...job, id: job.id + offset, sent: 0, state: 'queued' })));
  promoteNextUpload();
  announce(`3 sample files added to ${model.workspace} / ${model.album}.`);
  renderApplication();
}

function promoteNextUpload() {
  if (model.jobs.some(job => job.state === 'sending')) return;
  const next = model.jobs.find(job => job.state === 'queued');
  if (next) next.state = 'sending';
}

function advanceDemo() {
  const job = model.jobs.find(item => item.state === 'sending');
  if (!job) { announce('No active upload to advance. Open Uploads for available actions.'); return; }
  job.sent = Math.min(job.size, job.sent + Math.max(400, job.size / 3));
  if (job.sent === job.size) { job.state = 'complete'; job.source = 'none'; promoteNextUpload(); }
  renderApplication();
  if (model.jobs.every(item => item.state === 'complete')) announce('All originals uploaded.');
}

function showUploadDetails() {
  if (matchMedia('(max-width:600px)').matches) model.page = 'Uploads';
  else model.panel = !model.panel;
  renderApplication();
  if (model.panel) document.getElementById('hide-panel').focus();
}

function hideUploadDetails() {
  model.panel = false; renderApplication(); uploadStatus.focus();
}

// Render meaningful state-specific actions; a missing original never gets a misleading Resume button.
function renderUploadRow(job) {
  let actions = '';
  if (['sending', 'queued'].includes(job.state)) actions = `<button data-job="${job.id}" data-action="pause">Pause</button>`;
  if (job.state === 'paused') actions = `<button data-job="${job.id}" data-action="resume">Resume</button>`;
  if (job.state === 'complete') actions = `<button data-job="${job.id}" data-action="destination">Open album</button>`;
  const detail = job.state === 'missing' ? 'Locate the originals together to reuse saved progress.' : job.state === 'access' ? 'Permission can be renewed without selecting files again.' : job.state === 'error' ? '900 MB needed. Completed uploads are safe.' : '';
  return `<article class="upload-row"><span class="file-icon" aria-hidden="true">${job.state === 'complete' ? '✓' : '↑'}</span><div class="file-info"><strong>${escapeMarkup(job.name)}</strong><p class="destination">${escapeMarkup(job.destination)}</p><p>${stateLabels[job.state]} · ${formatSize(job.size)}</p><progress max="${job.size}" value="${job.sent}" aria-label="${escapeMarkup(job.name)} upload progress"></progress>${detail ? `<p>${detail}</p>` : ''}<div class="row-actions">${actions}</div></div></article>`;
}

// Batch controls preserve deliberate pauses and never cancel or delete completed originals.
function renderUploadContents() {
  if (!model.jobs.length) return '<div class="empty"><h3>You’re all caught up</h3><p>New uploads will appear here.</p><button data-page="Albums">Browse albums</button></div>';
  const summary = summarizeUploads();
  const states = model.jobs.map(job => job.state);
  let actions = '';
  if (summary.active) actions += '<button data-action="pause-all">Pause all</button>';
  if (states.includes('paused')) actions += '<button data-action="resume-all">Resume paused</button>';
  if (states.includes('offline')) actions += '<button data-action="reconnect">Restore connection (demo)</button>';
  if (states.includes('access')) actions += '<button class="primary" data-action="grant">Allow file access (demo)</button>';
  if (states.includes('missing')) actions += '<button class="primary" data-action="locate">Locate originals (demo)</button>';
  if (states.includes('error')) actions += '<button data-action="capacity">Resolve storage (demo)</button>';
  if (summary.completed < model.jobs.length) actions += '<button data-action="cancel-review">Cancel unfinished</button>';
  else actions += '<button data-action="clear">Clear history</button>';
  const review = model.cancelReview ? '<div class="cancel-review"><strong>Cancel unfinished uploads?</strong><p>Saved transfer progress will be discarded. Uploaded files and device originals stay safe.</p><button data-action="cancel-confirm">Cancel unfinished</button><button data-action="cancel-keep">Keep uploading</button></div>' : '';
  return `<div class="summary"><h3>${summary.title}</h3><progress aria-label="Total uploaded bytes" max="${summary.total}" value="${summary.sent}"></progress><div class="batch-meta"><span>${formatSize(summary.sent)} of ${formatSize(summary.total)}</span><span>${summary.active ? 'Uploading' : 'Saved progress'}</span></div><div class="toolbar">${actions}</div></div>${review}${model.jobs.map(renderUploadRow).join('')}<div class="recovery-note">You can browse Relay while uploading. Closing the browser or locking your phone may interrupt transfers.</div>`;
}

function renderAlbums() {
  return '<div class="heading"><div><span class="eyebrow">YOUR LIBRARY</span><h1>Albums</h1><p class="subheading">3 albums</p></div></div><div class="album-grid">' + ['Coast weekend', 'Family archive', 'Autumn portraits'].map((name, index) => `<button class="album" data-album="${name}"><div class="cover ${['', 'clay', 'slate'][index]}"><strong>${name}</strong></div><footer><span>${[48, 126, 32][index]} files</span><span>Sep 2026</span></footer></button>`).join('') + '</div>';
}

function renderAlbumDetail() {
  return `<button class="back" data-page="Albums">← Albums</button><div class="heading"><div><span class="eyebrow">${escapeMarkup(model.workspace)} / ALBUM</span><h1>${escapeMarkup(model.album)}</h1><p class="subheading">All files · 48 originals</p></div><button class="primary" data-action="add">Add sample files</button></div><div class="media-grid">${['Coast-008.heic', 'Coast-009.mov', 'Evening-011.heic', 'Coast-010.heic', 'Portrait-018.heic', 'Evening-012.mov'].map(name => `<div class="media-placeholder"><div class="media-art" aria-hidden="true"></div><p>${name}</p></div>`).join('')}</div>`;
}

// The same state drives the compact control, non-modal panel and full phone/desktop Uploads page.
function renderApplication() {
  const summary = summarizeUploads();
  document.getElementById('breadcrumb').textContent = `${model.workspace} / ${model.page === 'Album' ? model.album : model.page}`;
  document.getElementById('nav-count').textContent = String(model.jobs.filter(job => job.state !== 'complete').length);
  document.getElementById('status-label').textContent = !model.jobs.length ? '0' : summary.attention ? `${summary.attention} need attention` : summary.active ? `${summary.completed} of ${model.jobs.length}` : summary.title;
  uploadStatus.classList.toggle('attention', summary.attention > 0);
  uploadStatus.setAttribute('aria-expanded', String(model.panel));
  document.querySelectorAll('nav [data-page]').forEach(button => button.classList.toggle('selected', button.dataset.page === model.page || button.dataset.page === 'Albums' && model.page === 'Album'));
  if (model.page === 'Albums') content.innerHTML = renderAlbums();
  if (model.page === 'Album') content.innerHTML = renderAlbumDetail();
  if (model.page === 'Uploads') content.innerHTML = `<button class="back" data-page="Albums">← Back to albums</button><div class="heading"><div><span class="eyebrow">ACROSS YOUR WORKSPACES</span><h1>Uploads</h1></div></div><div class="upload-page">${renderUploadContents()}</div>`;
  if (model.page === 'Account') content.innerHTML = '<div class="heading"><h1>Account</h1></div><div class="account-card"><h2>Personal & Studio</h2><p>This screen is separate from your upload destinations. Uploads keep running while you manage your account.</p></div>';
  if (model.page === 'Uploads') model.panel = false;
  panel.hidden = !model.panel;
  uploadStatus.setAttribute('aria-expanded', String(model.panel));
  document.querySelector('.workspace').classList.toggle('panel-open', model.panel);
  document.getElementById('panel-content').innerHTML = model.panel ? renderUploadContents() : '';
}

// Route delegated controls through a small deterministic state machine so every visible action works.
function applyUploadAction(action, jobId) {
  const job = model.jobs.find(item => item.id === Number(jobId));
  if (action === 'add') { addSampleBatch(); return; }
  if (action === 'pause' && job) job.state = 'paused';
  if (action === 'resume' && job) job.state = 'queued';
  if (action === 'destination' && job) { [model.workspace, model.album] = job.destination.split(' / '); model.page = 'Album'; model.panel = false; document.getElementById('workspace').value = model.workspace; }
  if (action === 'pause-all') model.jobs.forEach(item => { if (['sending', 'queued'].includes(item.state)) item.state = 'paused'; });
  if (action === 'resume-all') model.jobs.forEach(item => { if (item.state === 'paused') item.state = 'queued'; });
  if (action === 'reconnect') model.jobs.forEach(item => { if (item.state === 'offline') item.state = 'queued'; });
  if (action === 'grant' || action === 'locate' || action === 'capacity') {
    const expected = { grant: 'access', locate: 'missing', capacity: 'error' }[action];
    model.jobs.forEach(item => { if (item.state === expected) { item.state = 'queued'; item.source = 'memory'; } });
    announce(action === 'locate' ? 'Demo: 2 originals matched and verified together. Saved progress retained.' : 'Demo: issue resolved. Eligible uploads continue.');
  }
  if (action === 'cancel-review') model.cancelReview = true;
  if (action === 'cancel-keep') model.cancelReview = false;
  if (action === 'cancel-confirm') { model.jobs = model.jobs.filter(item => item.state === 'complete'); model.cancelReview = false; announce('Unfinished uploads cancelled. Completed originals kept.'); }
  if (action === 'clear') { model.jobs = model.jobs.filter(item => item.state !== 'complete'); announce('History cleared. Uploaded originals kept.'); }
  promoteNextUpload(); renderApplication();
}

// Preserve keyboard position across fixture rerenders when an equivalent control still exists.
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) { model.page = button.dataset.page; model.panel = false; model.cancelReview = false; renderApplication(); }
  if (button.dataset.album) { model.album = button.dataset.album; model.page = 'Album'; renderApplication(); }
  if (button.dataset.action) {
    const action = button.dataset.action;
    const jobId = button.dataset.job;
    applyUploadAction(action, jobId);
    const replacement = [...document.querySelectorAll('[data-action]')].find(item => item.dataset.action === action && item.dataset.job === jobId && item.getClientRects().length);
    if (replacement) replacement.focus(); else uploadStatus.focus();
  }
});
uploadStatus.addEventListener('click', showUploadDetails);
document.getElementById('hide-panel').addEventListener('click', hideUploadDetails);
document.getElementById('scenario').addEventListener('change', event => selectScenario(event.target.value));
document.getElementById('advance').addEventListener('click', advanceDemo);
document.getElementById('workspace').addEventListener('change', event => { model.workspace = event.target.value; model.page = 'Albums'; model.panel = false; renderApplication(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && model.panel) hideUploadDetails(); });
window.addEventListener('resize', () => { if (model.panel && matchMedia('(max-width:600px)').matches) { model.panel = false; model.page = 'Uploads'; renderApplication(); } });
renderApplication();
