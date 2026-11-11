import { cancelEmote, playEmote, type WilsonPlayerInstance } from '@dontstarve-web/prefab/player';
import type { DstEmoteWheelElement, EmoteRequestDetail, EmoteWheelToggleDetail } from '@dontstarve-web/ui';
import { input } from './InputManager';
import type { EventEmitter } from '@dontstarve-web/signals';
import type { PlayerActionEvents } from '@dontstarve-web/stategraphs';

export function setupEmoteWheel(
  wheel: DstEmoteWheelElement,
  canvas: HTMLCanvasElement,
  player: WilsonPlayerInstance | undefined,
  actionEvents: EventEmitter<PlayerActionEvents> | undefined,
  updateCursor: () => void,
): () => void {
  const handleToggle = (event: Event) => {
    const { isOpen } = (event as CustomEvent<EmoteWheelToggleDetail>).detail;
    input.setBlocked(isOpen);
    if (isOpen) {
      actionEvents?.emit('action:interrupt', { reason: 'emote' });
    }
    updateCursor();
  };
  const handleRequest = (event: Event) => {
    const { emote } = (event as CustomEvent<EmoteRequestDetail>).detail;
    actionEvents?.emit('action:interrupt', { reason: 'emote' });
    try { if (player) playEmote(player, emote); } catch (error) {
      console.error(`Unable to play emote ${emote}`, error);
    }
  };
  // Clicking the world interrupts a looping emote.
  const handleWorldPointer = (event: PointerEvent) => {
    if (event.button === 0 || event.button === 2) { if (player) cancelEmote(player); }
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
