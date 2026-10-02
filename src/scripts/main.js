import { applyStoreLinks, config, httpsUrl } from '../config.js';

applyStoreLinks();
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
function closeMenu() { nav?.classList.remove('is-open'); menu?.setAttribute('aria-expanded', 'false'); }
menu?.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  menu.setAttribute('aria-expanded', String(open));
});
nav?.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeMenu(); menu?.focus(); } });

// Deployment supplies this URL only once assistant account linking is live.
const assistantBase = httpsUrl(config.assistantBaseUrl)?.replace(/\/$/, '');
const assistantSection = document.querySelector('[data-assistant]');
if (assistantBase && assistantSection) {
  assistantSection.hidden = false;
  document.querySelector('#manage-assistants').href = `${assistantBase}/connect`;
  document.querySelector('#copy-assistant-url').addEventListener('click', async () => {
    const status = document.querySelector('#connection-status');
    try {
      await navigator.clipboard.writeText(`${assistantBase}/mcp`);
      status.textContent = 'Connection URL copied. Add it as a custom MCP connection in your assistant.';
    } catch {
      status.textContent = `Copy this connection URL: ${assistantBase}/mcp`;
    }
  });
}
