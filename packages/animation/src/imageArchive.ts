const archiveRequests = new Map<string, Promise<Uint8Array>>();

export function imageArchiveUrl(archiveUrl: string | URL): string {
  return typeof document === 'undefined'
    ? String(archiveUrl)
    : new URL(String(archiveUrl), document.baseURI).href;
}

export function preloadImageArchive(archiveUrl: string | URL): Promise<Uint8Array> {
  const key = imageArchiveUrl(archiveUrl);
  let request = archiveRequests.get(key);
  if (!request) {
    request = fetch(key).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load image archive ${key}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    archiveRequests.set(key, request);
    void request.catch(() => archiveRequests.delete(key));
  }
  return request;
}
