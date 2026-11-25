import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../../assetUrl';
import { parseAtlas } from '../GeneratingWorldPage/kleiAnimation';

type ElementBounds = {
  u1: number;
  u2: number;
  v1: number;
  v2: number;
};

type AtlasData = {
  image: HTMLCanvasElement;
  elements: Map<string, ElementBounds>;
};

type AtlasSpriteProps = {
  atlas: string;
  sprite: string;
  assetRoot?: string;
  alt?: string;
  className?: string;
  tint?: [number, number, number];
};

const atlasCache = new Map<string, Promise<AtlasData>>();
/** Mounted sprites per atlas: the menu pages unmount when the game starts, and their atlas canvases go with them. */
const atlasUsers = new Map<string, number>();

/** Loads an atlas for one mounted sprite; the returned release frees it once no sprite uses it. */
function retainAtlas(name: string, assetRoot: string): { atlas: Promise<AtlasData>; release(): void } {
  const cacheKey = `${assetRoot}/${name}`;
  atlasUsers.set(cacheKey, (atlasUsers.get(cacheKey) ?? 0) + 1);
  return {
    atlas: loadAtlas(name, assetRoot),
    release() {
      atlasUsers.set(cacheKey, atlasUsers.get(cacheKey)! - 1);
      // A re-render that swaps sprites releases and retains in one commit; only a lasting release frees the atlas.
      setTimeout(() => {
        if (atlasUsers.get(cacheKey) !== 0) {
          return;
        }
        atlasUsers.delete(cacheKey);
        const cached = atlasCache.get(cacheKey);
        atlasCache.delete(cacheKey);
        void cached?.then(
          ({ image }) => {
            image.width = image.height = 0;
          },
          () => undefined,
        );
      }, 0);
    },
  };
}

function loadAtlas(name: string, assetRoot: string) {
  const cacheKey = `${assetRoot}/${name}`;
  const cached = atlasCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = Promise.all([
    fetch(`${assetRoot}/${name}.tex`).then(response => {
      if (!response.ok) {
        throw new Error(`无法读取 ${name}.tex`);
      }
      return response.arrayBuffer();
    }),
    fetch(`${assetRoot}/${name}.xml`).then(response => {
      if (!response.ok) {
        throw new Error(`无法读取 ${name}.xml`);
      }
      return response.text();
    }),
  ]).then(([textureBuffer, xml]) => {
    const texture = parseAtlas(textureBuffer);
    const image = document.createElement('canvas');
    image.width = texture.width;
    image.height = texture.height;
    image
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(texture.pixels), texture.width, texture.height), 0, 0);

    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    const elements = new Map<string, ElementBounds>();
    documentXml.querySelectorAll('Element').forEach(element => {
      const spriteName = element.getAttribute('name');
      if (!spriteName) {
        return;
      }
      elements.set(spriteName, {
        u1: Number(element.getAttribute('u1')),
        u2: Number(element.getAttribute('u2')),
        v1: Number(element.getAttribute('v1')),
        v2: Number(element.getAttribute('v2')),
      });
    });
    return { image, elements };
  });

  atlasCache.set(cacheKey, promise);
  return promise;
}

export default function AtlasSprite({
  atlas,
  sprite,
  assetRoot = assetUrl('mainscreen-assets'),
  alt = '',
  className,
  tint,
}: AtlasSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const retained = retainAtlas(atlas, assetRoot);
    retained.atlas
      .then(({ image, elements }) => {
        if (cancelled || !canvasRef.current) {
          return;
        }
        const bounds = elements.get(sprite);
        if (!bounds) {
          throw new Error(`${atlas}.xml 中不存在 ${sprite}`);
        }

        const sx = Math.floor(bounds.u1 * image.width);
        const sy = Math.floor((1 - bounds.v2) * image.height);
        const ex = Math.ceil(bounds.u2 * image.width);
        const ey = Math.ceil((1 - bounds.v1) * image.height);
        const width = Math.max(1, ex - sx);
        const height = Math.max(1, ey - sy);
        const canvas = canvasRef.current;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }
        context.clearRect(0, 0, width, height);
        context.drawImage(image, sx, sy, width, height, 0, 0, width, height);

        if (tint) {
          const pixels = context.getImageData(0, 0, width, height);
          for (let offset = 0; offset < pixels.data.length; offset += 4) {
            pixels.data[offset] = pixels.data[offset] * tint[0];
            pixels.data[offset + 1] = pixels.data[offset + 1] * tint[1];
            pixels.data[offset + 2] = pixels.data[offset + 2] * tint[2];
          }
          context.putImageData(pixels, 0, 0);
        }
      })
      .catch(reason => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
      retained.release();
    };
  }, [assetRoot, atlas, sprite, tint]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      title={error || undefined}
    />
  );
}
