/**
 * frontend.lua Fade, as player_classified applies inst:ScreenFade(isfadein, time): a full-screen black layer above the
 * world and HUD that fades out to black or back in over `time` seconds. The white fade and the fade callbacks are not
 * ported.
 */
export function createScreenFade(parent: HTMLElement = document.body): {
  fade(isfadein: boolean, time: number): void;
  dispose(): void;
} {
  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '1000',
  });
  parent.append(layer);
  return {
    fade(isfadein, time) {
      layer.style.transition = `opacity ${Math.max(0, time)}s linear`;
      layer.style.opacity = isfadein ? '0' : '1';
    },
    dispose() {
      layer.remove();
    },
  };
}
