// Runs before the first paint so the page opens in the right theme instead of flashing the other one.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('glava-theme') || 'auto'; } catch (e) { /* private mode */ }
  var dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
