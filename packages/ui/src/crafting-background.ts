import { getAtlasImage, type AtlasImageRegion } from '@dontstarve-web/animation/atlasImage';

const atlasPath = 'images/crafting_menu.xml';

/** craftingmenu_hud.lua HEIGHT and craftingmenu_widget.lua MakeFrame(500, HEIGHT): the menu's content box in UI units. */
export const CRAFTING_FRAME = { width: 500, height: 600 } as const;

// constants.lua BROWN, the tint of the filter panel's line_horizontal_white divider.
const BROWN = 'rgb(97 73 46)';

/**
 * MakeFrame's images in their draw order, centred at (x, y) with +y up from the frame centre and sized by ScaleToSize
 * (a negative size mirrors the image). The two horizontal_bar dividers sit at the recipe grid's top and bottom.
 */
const PIECES: readonly { name: string; x: number; y: number; width: number; height: number; alpha?: number }[] = [
  { name: 'backing.tex', x: 0, y: 0, width: 510, height: 618, alpha: 0.5 },
  { name: 'side.tex', x: -258, y: 1, width: -26, height: -580 },
  { name: 'side.tex', x: 258, y: 1, width: 26, height: 580 },
  { name: 'top.tex', x: 0, y: 310, width: 534, height: 38 },
  { name: 'bottom.tex', x: 0, y: -308, width: 534, height: 38 },
  { name: 'horizontal_bar.tex', x: 0, y: 153, width: 502, height: 15 },
  { name: 'horizontal_bar.tex', x: 0, y: -80, width: 502, height: 15 },
];
/** MakeFilterPanel's divider under the top row: 460 × 4 at y = 252. */
const FILTER_LINE = { x: 0, y: 252, width: 460, height: 4 };
/** The painted extent of PIECES, in UI units about the frame centre. */
const BOUNDS = { left: -271, right: 271, top: 329, bottom: -327 } as const;

/** Paint MakeFrame's images into one CSS background around the 500 × 600 content box. */
export function createCraftingBackground(root: ShadowRoot): { setScale(scale: number): void; dispose(): void } {
  const background = root.querySelector<HTMLElement>('.craft-background')!;
  background.style.left = `${BOUNDS.left + CRAFTING_FRAME.width / 2}px`;
  background.style.top = `${CRAFTING_FRAME.height / 2 - BOUNDS.top}px`;
  background.style.width = `${BOUNDS.right - BOUNDS.left}px`;
  background.style.height = `${BOUNDS.top - BOUNDS.bottom}px`;
  let disposed = false;
  let version = 0;
  let ratio = 0;
  let imageUrl: string | undefined;

  const names = [...new Set(PIECES.map(({ name }) => name))];
  const assets = Promise.all(names.map(name => getAtlasImage(atlasPath, name))).then(async list => {
    const image = new Image();
    image.src = list[0].imageUrl;
    await image.decode();
    return { image, regions: new Map<string, AtlasImageRegion>(names.map((name, index) => [name, list[index]])) };
  });

  const render = async (pixelRatio: number, requestVersion: number) => {
    const { image, regions } = await assets;
    if (disposed || requestVersion !== version) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((BOUNDS.right - BOUNDS.left) * pixelRatio);
    canvas.height = Math.ceil((BOUNDS.top - BOUNDS.bottom) * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is unavailable');
    }
    // UI units about the frame centre, +y up.
    context.setTransform(pixelRatio, 0, 0, -pixelRatio, -BOUNDS.left * pixelRatio, BOUNDS.top * pixelRatio);
    for (const { name, x, y, width, height, alpha = 1 } of PIECES) {
      const region = regions.get(name)!;
      context.save();
      context.globalAlpha = alpha;
      context.translate(x, y);
      // Image rows run downwards: flip back so the texture is upright, then mirror by the size's signs.
      context.scale(Math.sign(width), -Math.sign(height));
      const w = Math.abs(width),
        h = Math.abs(height);
      context.drawImage(image, region.x, region.y, region.width, region.height, -w / 2, -h / 2, w, h);
      context.restore();
    }
    context.fillStyle = BROWN;
    context.fillRect(
      FILTER_LINE.x - FILTER_LINE.width / 2,
      FILTER_LINE.y - FILTER_LINE.height / 2,
      FILTER_LINE.width,
      FILTER_LINE.height,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => (value ? resolve(value) : reject(new Error('Unable to encode crafting background'))));
    });
    if (disposed || requestVersion !== version) {
      return;
    }
    const nextUrl = URL.createObjectURL(blob);
    try {
      const composed = new Image();
      composed.src = nextUrl;
      await composed.decode();
      if (disposed || requestVersion !== version) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      const previousUrl = imageUrl;
      imageUrl = nextUrl;
      background.style.backgroundImage = `url("${nextUrl}")`;
      background.dataset.loaded = 'true';
      delete background.dataset.error;
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      throw error;
    }
  };

  // Handle a failed source decode even while the panel remains collapsed.
  void assets.catch((error: unknown) => {
    if (!disposed) {
      background.dataset.error = error instanceof Error ? error.message : String(error);
    }
  });

  return {
    /** Repaint for the menu's on-screen scale, so the frame stays sharp at every HUD size. */
    setScale(scale: number) {
      const next = Math.max(scale * (window.devicePixelRatio || 1), 0.25);
      if (disposed || next === ratio) {
        return;
      }
      ratio = next;
      delete background.dataset.loaded;
      const requestVersion = ++version;
      void render(next, requestVersion).catch((error: unknown) => {
        if (disposed || requestVersion !== version) {
          return;
        }
        ratio = 0;
        background.dataset.error = error instanceof Error ? error.message : String(error);
      });
    },
    dispose() {
      disposed = true;
      version++;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    },
  };
}
