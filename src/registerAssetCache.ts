/** Resource caching starts in the menu, before the game and its workers load. */
export function registerAssetCache(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: 'none',
  }).catch((error: unknown) => {
    console.warn('Unable to register asset cache', error);
  });
}
