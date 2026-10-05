import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import type { DstEmoteWheelElement, EmoteRequestDetail, EmoteWheelToggleDetail } from '@dontstarve-web/ui';
import { input } from './InputManager';

export function setupEmoteWheel(
  wheel: DstEmoteWheelElement,
  canvas: HTMLCanvasElement,
  animation: WilsonAnimationController | undefined,
  stopMovement: () => void,
  cancelInteractions: () => void,
  updateCursor: () => void,
): () => void {
  const handleToggle = (event: Event) => {
    const { isOpen } = (event as CustomEvent<EmoteWheelToggleDetail>).detail;
    input.setBlocked(isOpen);
    if (isOpen) {
      stopMovement();
      cancelInteractions();
    }
    updateCursor();
  };
  const handleRequest = (event: Event) => {
    const { emote } = (event as CustomEvent<EmoteRequestDetail>).detail;
    stopMovement();
    void animation?.playEmote(emote).catch((error: unknown) => {
      console.error(`Unable to play emote ${emote}`, error);
    });
  };
  // Clicking the world interrupts both a looping emote and an in-flight asset load.
  const handleWorldPointer = (event: PointerEvent) => {
    if (event.button === 0 || event.button === 2) animation?.cancelEmote();
  };
  wheel.addEventListener('game:emote-wheel-toggle', handleToggle);
  wheel.addEventListener('game:emote-request', handleRequest);
  canvas.addEventListener('pointerdown', handleWorldPointer, true);
  return () => {
    wheel.close();
    wheel.removeEventListener('game:emote-wheel-toggle', handleToggle);
    wheel.removeEventListener('game:emote-request', handleRequest);
    canvas.removeEventListener('pointerdown', handleWorldPointer, true);
  };
}
