import { getAtlasImage, type AtlasImageRegion } from '@dontstarve-web/animation/atlasImage';

const atlasPath = 'images/crafting_menu.xml';
const names = ['top.tex', 'horizontal_bar.tex', 'bottom.tex', 'side.tex'] as const;

interface Layout {
  width: number;
  height: number;
  categoryDivider: number;
  detailDivider: number;
  pixelRatio: number;
}

/** Compose the six frame pieces and translucent fill into one CSS background. */
export function createCraftingBackground(root: ShadowRoot): { dispose(): void } {
  const panel = root.querySelector<HTMLElement>('.craft-panel')!;
  const background = root.querySelector<HTMLElement>('.craft-background')!;
  const categories = root.querySelector<HTMLElement>('.craft-categories')!;
  const marker = root.querySelector<HTMLElement>('.craft-scroll-marker')!;
  let disposed = false;
  let frame = 0;
  let version = 0;
  let layoutKey = '';
  let imageUrl: string | undefined;

  const assets = Promise.all(names.map((name) => getAtlasImage(atlasPath, name))).then(async (regions) => {
    const image = new Image();
    image.src = regions[0].imageUrl;
    await image.decode();
    return { image, regions };
  });

  const render = async (layout: Layout, requestVersion: number) => {
    const { image, regions: [top, bar, bottom, side] } = await assets;
    if (disposed || requestVersion !== version) return;
    const scale = layout.width / top.width;
    const topMargin = top.height * scale / 2;
    const bottomMargin = bottom.height * scale / 2;
    const height = layout.height + topMargin + bottomMargin;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(layout.width * layout.pixelRatio);
    canvas.height = Math.ceil(height * layout.pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.scale(canvas.width / layout.width, canvas.height / height);

    const draw = (region: AtlasImageRegion, x: number, y: number, width: number, height: number) => {
      context.drawImage(image, region.x, region.y, region.width, region.height, x, y, width, height);
    };

    // The corner stem's inner edge is x=34px; the side's painted strip is 20px wide.
    // Inset its centre to x=24px so their inner edges meet, rather than spacing by sprite bounds.
    // side.tex's painted strip is centred at x=17px (x=28px after rotation).
    const corner = 24 * scale;
    const sideWidth = side.width * scale;
    const left = corner - 28 * scale;
    const right = layout.width - corner - 17 * scale;
    context.fillStyle = 'rgba(0, 0, 0, 0.58)';
    context.fillRect(corner, topMargin, layout.width - corner * 2, layout.height);

    context.save();
    context.translate(left + sideWidth, topMargin + layout.height);
    context.rotate(Math.PI);
    draw(side, 0, 0, sideWidth, layout.height);
    context.restore();
    draw(side, right, topMargin, sideWidth, layout.height);

    // Overlap the side strips; the horizontal pieces always paint last.
    const barLeft = corner - 10 * scale;
    const barWidth = layout.width - barLeft * 2;
    const barHeight = bar.height * barWidth / bar.width;
    for (const divider of [layout.categoryDivider, layout.detailDivider]) {
      draw(bar, barLeft, topMargin + divider - barHeight / 2, barWidth, barHeight);
    }
    draw(top, 0, 0, layout.width, top.height * scale);
    draw(bottom, 0, topMargin + layout.height - bottomMargin, layout.width, bottom.height * scale);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode crafting background')));
    });
    if (disposed || requestVersion !== version) return;
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
      background.style.top = `${-topMargin}px`;
      background.style.height = `${height}px`;
      background.style.backgroundImage = `url("${nextUrl}")`;
      background.dataset.loaded = 'true';
      delete background.dataset.error;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      throw error;
    }
  };

  const refresh = () => {
    frame = 0;
    if (disposed) return;
    const layout: Layout = {
      width: panel.offsetWidth,
      height: panel.offsetHeight,
      categoryDivider: categories.offsetTop + categories.offsetHeight,
      detailDivider: marker.offsetTop + marker.offsetHeight / 2,
      pixelRatio: window.devicePixelRatio || 1,
    };
    if (!layout.width || !layout.height) return;
    const nextKey = JSON.stringify(layout);
    if (nextKey === layoutKey) return;
    layoutKey = nextKey;
    delete background.dataset.loaded;
    const requestVersion = ++version;
    void render(layout, requestVersion).catch((error: unknown) => {
      if (disposed || requestVersion !== version) return;
      layoutKey = '';
      background.dataset.error = error instanceof Error ? error.message : String(error);
    });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(refresh);
  };
  const observer = new ResizeObserver(schedule);
  for (const element of [panel, categories, marker]) observer.observe(element);
  window.addEventListener('resize', schedule);
  // Handle a failed source decode even while the panel remains collapsed.
  void assets.catch((error: unknown) => {
    if (!disposed) background.dataset.error = error instanceof Error ? error.message : String(error);
  });
  schedule();

  return {
    dispose() {
      disposed = true;
      version++;
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
  };
}
