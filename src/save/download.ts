export function downloadSaveJson(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'initial-world.json';
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser start reading the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
