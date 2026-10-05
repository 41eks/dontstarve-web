import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';

/** Keep the recipe viewport and its separate, atlas-backed scrollbar in sync. */
export function createCraftingScrollbar(root: ShadowRoot): { refresh(): void; dispose(): void } {
  const viewport = root.querySelector<HTMLElement>('.craft-recipes')!;
  const scrollbar = root.querySelector<HTMLElement>('.craft-recipe-scrollbar')!;
  const up = scrollbar.querySelector<HTMLButtonElement>('.craft-scroll-up')!;
  const down = scrollbar.querySelector<HTMLButtonElement>('.craft-scroll-down')!;
  const track = scrollbar.querySelector<HTMLElement>('.craft-scroll-track')!;
  const thumb = scrollbar.querySelector<HTMLElement>('.craft-scroll-thumb')!;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let frame = 0;
  let disposed = false;
  let drag: { pointerId: number; y: number; scrollTop: number } | undefined;

  for (const [button, direction] of [[up, 'up'], [down, 'down']] as const) {
    button.append(
      createAtlasImage('craft-scroll-arrow-normal', 'images/crafting_menu.xml', `scrollbar_arrow_${direction}.tex`),
      createAtlasImage('craft-scroll-arrow-highlight', 'images/crafting_menu.xml', `scrollbar_arrow_${direction}_hl.tex`),
    );
  }

  const refresh = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const height = Math.min(track.clientHeight, Math.max(24, track.clientHeight * viewport.clientHeight / Math.max(1, viewport.scrollHeight)));
    const travel = track.clientHeight - height;
    thumb.style.height = `${height}px`;
    thumb.style.top = `${maximum ? viewport.scrollTop / maximum * travel : 0}px`;
    up.disabled = viewport.scrollTop <= 0;
    down.disabled = viewport.scrollTop >= maximum - 1;
    scrollbar.hidden = maximum <= 1;
    track.setAttribute('aria-valuemax', String(maximum));
    track.setAttribute('aria-valuenow', String(Math.round(viewport.scrollTop)));
    track.tabIndex = maximum > 1 ? 0 : -1;
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(refresh);
  };
  const rowStep = () => {
    const row = viewport.querySelector<HTMLElement>('.craft-recipe-category:not([hidden]) .craft-recipe-row');
    return (row ? parseFloat(getComputedStyle(row).height) : 62) + parseFloat(getComputedStyle(viewport).rowGap);
  };
  const scrollBy = (amount: number) => {
    viewport.scrollTop += amount;
    refresh();
  };
  up.addEventListener('click', () => scrollBy(-rowStep()), options);
  down.addEventListener('click', () => scrollBy(rowStep()), options);
  viewport.addEventListener('scroll', schedule, options);
  track.addEventListener('keydown', (event) => {
    const amounts: Record<string, number> = {
      ArrowUp: -rowStep(), ArrowDown: rowStep(),
      PageUp: -viewport.clientHeight, PageDown: viewport.clientHeight,
      Home: -viewport.scrollHeight, End: viewport.scrollHeight,
    };
    if (!(event.key in amounts)) return;
    event.preventDefault();
    event.stopPropagation();
    scrollBy(amounts[event.key]);
  }, options);
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target !== track) return;
    event.preventDefault();
    const bounds = thumb.getBoundingClientRect();
    scrollBy(event.clientY < bounds.top ? -viewport.clientHeight : viewport.clientHeight);
  }, options);
  thumb.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag = { pointerId: event.pointerId, y: event.clientY, scrollTop: viewport.scrollTop };
    thumb.setPointerCapture(event.pointerId);
  }, options);
  thumb.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = track.getBoundingClientRect();
    const travel = track.clientHeight - thumb.offsetHeight;
    if (bounds.height <= 0 || travel <= 0) return;
    const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = drag.scrollTop + (event.clientY - drag.y) * track.clientHeight / bounds.height / travel * maximum;
    refresh();
  }, options);
  const endDrag = () => {
    if (drag && thumb.hasPointerCapture(drag.pointerId)) thumb.releasePointerCapture(drag.pointerId);
    drag = undefined;
  };
  thumb.addEventListener('pointerup', endDrag, options);
  thumb.addEventListener('pointercancel', endDrag, options);
  thumb.addEventListener('lostpointercapture', () => { drag = undefined; }, options);

  const resize = new ResizeObserver(schedule);
  resize.observe(viewport);
  resize.observe(track);
  const mutation = new MutationObserver(schedule);
  mutation.observe(viewport, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  schedule();
  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      endDrag();
      listeners.abort();
      resize.disconnect();
      mutation.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
