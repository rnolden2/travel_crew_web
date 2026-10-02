const runtimeConfig = globalThis.window?.__TRAVEL_CREW_CONFIG__ || {};

function readConfig(name, fallback = '') {
  return runtimeConfig[name] ?? import.meta.env?.[name] ?? fallback;
}

export const config = {
  appStoreUrl: readConfig('VITE_APP_STORE_URL', 'https://apps.apple.com/us/app/travel-crew/id1501930493'),
  // Only show a Google Play download when a released listing is configured.
  playStoreUrl: readConfig('VITE_PLAY_STORE_URL'),
  appScheme: readConfig('VITE_APP_SCHEME', 'travelcrew'),
  assistantBaseUrl: readConfig('VITE_ASSISTANT_BASE_URL'),
};

export function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

export function applyStoreLinks(root = document) {
  for (const [selector, value] of [['[data-app-store]', config.appStoreUrl], ['[data-play-store]', config.playStoreUrl]]) {
    root.querySelectorAll(selector).forEach((link) => {
      const url = httpsUrl(value);
      link.hidden = !url;
      if (url) link.href = url;
      else link.removeAttribute('href');
    });
  }
}
