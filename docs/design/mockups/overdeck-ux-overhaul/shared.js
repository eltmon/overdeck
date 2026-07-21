// Shared mockup furniture: light/dark theme toggle, persisted per browser.
// The mocks demonstrate BOTH themes — the design system is token-based, so
// every screen must read correctly in either. (Real tokens from
// src/dashboard/frontend/src/index.css, both blocks.)
(function () {
  const KEY = 'ovr-mock-theme';
  const apply = (t) => { document.documentElement.dataset.theme = t; };
  apply(localStorage.getItem(KEY) || 'dark');
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.querySelector('.mock-banner');
    if (!banner) return;
    const btn = document.createElement('button');
    btn.style.cssText = 'margin-left:10px;padding:4px 10px;font-size:11px;border-radius:6px;border:1px solid var(--input);background:none;color:var(--muted-foreground);cursor:pointer';
    const label = () => { btn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀ light' : '☾ dark'; };
    btn.onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEY, next);
      apply(next);
      label();
    };
    label();
    banner.appendChild(btn);
  });
})();
