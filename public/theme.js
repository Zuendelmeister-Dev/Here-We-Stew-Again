(() => {
  const storageKey = 'here-we-stew-again-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const browserTheme = document.querySelector('meta[name="theme-color"]');
  let preference;

  try { preference = window.localStorage.getItem(storageKey); } catch { /* The switch works for this visit without storage. */ }

  function applyTheme() {
    const dark = preference === 'dark' || (preference !== 'light' && systemTheme.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    if (browserTheme) browserTheme.content = dark ? '#242620' : '#f8f5ee';
    const toggle = document.getElementById('theme-switch');
    if (toggle) toggle.checked = dark;
  }

  document.addEventListener('change', (event) => {
    if (event.target.id !== 'theme-switch') return;
    preference = event.target.checked ? 'dark' : 'light';
    applyTheme();
    try { window.localStorage.setItem(storageKey, preference); } catch { /* The current selection remains active. */ }
  });
  systemTheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = event.newValue;
    applyTheme();
  });

  applyTheme();
})();
