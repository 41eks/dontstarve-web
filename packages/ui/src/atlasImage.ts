import { loadImageAtlas } from '@three-roaming/animation/imageAtlas';

export function createAtlasImage(
  archiveUrl: string,
): (className: string, atlasPath: string, elementName: string) => HTMLCanvasElement {
  return (className, atlasPath, elementName) => {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.archive = archiveUrl;
    canvas.dataset.atlas = atlasPath;
    canvas.dataset.element = elementName;
    canvas.setAttribute('aria-hidden', 'true');

    void loadImageAtlas(archiveUrl, atlasPath).then((atlas) => {
      if (!canvas.isConnected) return;
      const sprite = atlas.require(elementName);
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.putImageData(
        new ImageData(Uint8ClampedArray.from(sprite.pixels), sprite.width, sprite.height),
        0,
        0,
      );
      canvas.dataset.loaded = 'true';
    }).catch((error: unknown) => {
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
      canvas.dispatchEvent(new Event('error'));
    });
    return canvas;
  };
}