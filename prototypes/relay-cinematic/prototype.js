const photoStories = [
  { id: "black-sand", image: "assets/black-sand-coast.png", title: "Into the wild", author: "Jonas M.", detail: "Black shore, 18:42", description: "The rain cleared for seven minutes. Long enough to walk down and make one frame." },
  { id: "cliffs", image: "assets/rust-coat-cliffs.png", title: "Where the land ends", author: "Lena O.", detail: "Atlantic edge, 16:07", description: "Wind moved over the ridge in long waves. We stayed until the weather turned." },
  { id: "cabin", image: "assets/coastal-cabin.png", title: "A light left on", author: "Studio North", detail: "Blue hour, 20:16", description: "A small concrete shelter holding a pool of warm light against the coast." },
  { id: "details", image: "assets/details.jpg", title: "Things we notice", author: "Noor A.", detail: "Morning study, 09:24", description: "The familiar shapes of a quiet room, held for a moment before the day began." },
  { id: "interior", image: "assets/interior.jpg", title: "Sunday quiet", author: "Amina K.", detail: "Soft room, 10:31", description: "A study in warm walls, open space, and the patience of morning light." },
  { id: "architecture", image: "assets/architecture.jpg", title: "Hard lines, soft sun", author: "Ezra P.", detail: "Concrete study, 14:02", description: "Geometry changes character when the afternoon sun reaches the wall." },
  { id: "chair", image: "assets/chair.jpg", title: "Objects with patience", author: "Mara K.", detail: "The blue chair, 11:48", description: "A single object can hold the mood of a whole room." }
];

let currentPhotoIndex = 0;
let toastTimer;
const viewer = document.querySelector("#viewer");
const activityPanel = document.querySelector("#activity-panel");
const accountMenu = document.querySelector("#account-menu");
const scrim = document.querySelector("#scrim");

// Switch the simulated product surface while keeping both navigation systems and focus in sync.
function setActiveView(viewName) {
  document.querySelectorAll("[data-page]").forEach(page => page.classList.toggle("is-active", page.dataset.page === viewName));
  document.querySelectorAll("[data-view]").forEach(button => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("is-active", isActive);
    if (button.closest(".rail-nav")) button.toggleAttribute("aria-current", isActive);
  });
  accountMenu.hidden = true;
  closePanels();
  window.scrollTo({ top: 0, behavior: "smooth" });
  document.querySelector("#main-content").focus({ preventScroll: true });
}

// Populate one shared viewer so every entry point preserves the same keyboard and details behaviour.
function renderViewerPhoto(photoIndex) {
  currentPhotoIndex = (photoIndex + photoStories.length) % photoStories.length;
  const photo = photoStories[currentPhotoIndex];
  const viewerImage = document.querySelector("#viewer-image");
  viewerImage.src = photo.image;
  viewerImage.alt = photo.detail;
  document.querySelector("#viewer-title").textContent = photo.title;
  document.querySelector("#viewer-author").textContent = photo.author;
  document.querySelector("#detail-title").textContent = photo.detail;
  document.querySelector("#detail-description").textContent = photo.description;
  document.querySelector("#viewer-index").textContent = String(currentPhotoIndex + 1).padStart(2, "0");
  document.querySelector(".viewer-progress b").style.width = `${((currentPhotoIndex + 1) / photoStories.length) * 100}%`;
}

function openViewer(photoId) {
  const photoIndex = photoStories.findIndex(photo => photo.id === photoId);
  renderViewerPhoto(photoIndex < 0 ? 0 : photoIndex);
  viewer.showModal();
}

function closeViewer() {
  const viewerDetails = document.querySelector("#viewer-details");
  viewerDetails.classList.remove("is-open");
  viewerDetails.setAttribute("aria-hidden", "true");
  viewerDetails.setAttribute("inert", "");
  document.querySelector('[data-action="viewer-details"]').setAttribute("aria-expanded", "false");
  viewer.close();
}

function closePanels() {
  activityPanel.classList.remove("is-open");
  activityPanel.setAttribute("aria-hidden", "true");
  activityPanel.setAttribute("inert", "");
  document.querySelectorAll('[data-action="notifications"]').forEach(button => button.setAttribute("aria-expanded", "false"));
  scrim.hidden = true;
}

function toggleActivityPanel() {
  const shouldOpen = !activityPanel.classList.contains("is-open");
  accountMenu.hidden = true;
  activityPanel.classList.toggle("is-open", shouldOpen);
  activityPanel.setAttribute("aria-hidden", String(!shouldOpen));
  activityPanel.toggleAttribute("inert", !shouldOpen);
  document.querySelectorAll('[data-action="notifications"]').forEach(button => button.setAttribute("aria-expanded", String(shouldOpen)));
  scrim.hidden = !shouldOpen;
}

function toggleAccountMenu() {
  closePanels();
  accountMenu.hidden = !accountMenu.hidden;
  document.querySelector('[data-action="account"]').setAttribute("aria-expanded", String(!accountMenu.hidden));
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.querySelector("span").textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2400);
}

function toggleReaction(button) {
  const isAppreciated = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(isAppreciated));
  button.textContent = isAppreciated ? "♥" : "♡";
  const nearbyCount = button.parentElement?.querySelector(".reaction-count");
  if (nearbyCount) nearbyCount.textContent = isAppreciated ? "185" : "184";
  showToast(isAppreciated ? "Added to your appreciations" : "Removed from appreciations");
}

// Search only the illustrative discovery catalogue and expose a recoverable empty result state.
function filterDiscoverResults(searchValue) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  setActiveView("discover");
  const cards = [...document.querySelectorAll(".discovery-card")];
  let visibleCount = 0;
  cards.forEach(card => {
    const isMatch = !normalizedSearch || card.textContent.toLowerCase().includes(normalizedSearch) || card.querySelector("img").alt.toLowerCase().includes(normalizedSearch);
    card.hidden = !isMatch;
    if (isMatch) visibleCount += 1;
  });
  document.querySelector("#discover-grid").hidden = visibleCount === 0;
  document.querySelector(".empty-search").hidden = visibleCount !== 0;
}

// A single delegated listener keeps the prototype controls coherent across desktop and responsive navigation.
document.addEventListener("click", event => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.dataset.view) setActiveView(target.dataset.view);
  if (target.dataset.openPhoto) openViewer(target.dataset.openPhoto);
  if (target.classList.contains("reaction")) toggleReaction(target);
  const action = target.dataset.action;
  if (action === "notifications") toggleActivityPanel();
  if (action === "close-panels") closePanels();
  if (action === "account") toggleAccountMenu();
  if (action === "upload") document.querySelector("#upload-dialog").showModal();
  if (action === "close-viewer") closeViewer();
  if (action === "previous-photo") renderViewerPhoto(currentPhotoIndex - 1);
  if (action === "next-photo") renderViewerPhoto(currentPhotoIndex + 1);
  if (action === "viewer-details") {
    const details = document.querySelector("#viewer-details");
    details.classList.toggle("is-open");
    const detailsAreOpen = details.classList.contains("is-open");
    target.setAttribute("aria-expanded", String(detailsAreOpen));
    details.setAttribute("aria-hidden", String(!detailsAreOpen));
    details.toggleAttribute("inert", !detailsAreOpen);
  }
  if (action === "clear-search") {
    document.querySelector("#site-search").value = "";
    filterDiscoverResults("");
  }
  if (action === "publish-demo") showToast("Draft ready to review");
});

scrim.addEventListener("click", closePanels);

document.querySelector("#site-search").addEventListener("search", event => filterDiscoverResults(event.target.value));
document.querySelector("#site-search").addEventListener("keydown", event => {
  if (event.key === "Enter") filterDiscoverResults(event.currentTarget.value);
});

document.querySelectorAll(".filter-pills button, .profile-tabs button").forEach(button => button.addEventListener("click", () => {
  button.parentElement.querySelectorAll("button").forEach(option => option.classList.toggle("is-active", option === button));
}));

document.querySelector("#upload-drop").addEventListener("click", event => {
  const uploadDrop = event.currentTarget;
  uploadDrop.classList.add("is-loading");
  uploadDrop.querySelector("b").textContent = "Preparing your selection…";
  window.setTimeout(() => {
    uploadDrop.classList.remove("is-loading");
    uploadDrop.querySelector("b").textContent = "4 photographs ready";
    uploadDrop.querySelector("small").textContent = "18.7 MB · original quality";
  }, 900);
});

// Keyboard shortcuts mirror familiar gallery controls without taking over typing in form fields.
document.addEventListener("keydown", event => {
  const isTyping = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#site-search").focus();
  }
  if (viewer.open && event.key === "ArrowLeft") renderViewerPhoto(currentPhotoIndex - 1);
  if (viewer.open && event.key === "ArrowRight") renderViewerPhoto(currentPhotoIndex + 1);
  if (!isTyping && event.key === "/") {
    event.preventDefault();
    document.querySelector("#site-search").focus();
  }
});
