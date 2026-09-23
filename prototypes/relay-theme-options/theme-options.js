const relayPreview = document.querySelector('.relay-preview');
const themeLabel = document.getElementById('selected-theme');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const themeNames = { midnight: 'Midnight', cobalt: 'Cobalt', plum: 'Plum', graphite: 'Graphite', clay: 'Clay' };
const themeColors = { midnight: '#282545', cobalt: '#102b59', plum: '#3c203f', graphite: '#1d2430', clay: '#3a2928' };

function selectRelayTheme(themeKey) {
  relayPreview.dataset.theme = themeKey;
  themeLabel.textContent = themeNames[themeKey];
  themeColorMeta.content = themeColors[themeKey];
  document.querySelectorAll('[data-theme-option]').forEach(option => {
    const selected = option.dataset.themeOption === themeKey;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
}

document.querySelector('.theme-options').addEventListener('click', event => {
  const themeOption = event.target.closest('[data-theme-option]');
  if (themeOption) selectRelayTheme(themeOption.dataset.themeOption);
});
