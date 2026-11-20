import { cancelEmote, playEmote, type PlayerInstance } from '@dontstarve-web/prefab/player_common';
import type { DstEmoteWheelElement, GameUiEventMap } from '@dontstarve-web/ui';
import { input } from './InputManager';
import type { EventEmitter } from '@dontstarve-web/signals';
import type { PlayerActionEvents } from '@dontstarve-web/stategraphs';

export function setupEmoteWheel(
  wheel: DstEmoteWheelElement,
  canvas: HTMLCanvasElement,
  player: PlayerInstance | undefined,
  actionEvents: EventEmitter<PlayerActionEvents> | undefined,
  updateCursor: () => void,
): () => void {
  const handleToggle = (event: GameUiEventMap['game:emote-wheel-toggle']) => {
    const { isOpen } = event.detail;
    input.setBlocked(isOpen);
    if (isOpen) {
      actionEvents?.emit('action:interrupt', { reason: 'emote' });
    }
    updateCursor();
  };
  const handleRequest = (event: GameUiEventMap['game:emote-request']) => {
    const { emote } = event.detail;
    actionEvents?.emit('action:interrupt', { reason: 'emote' });
    try { if (player) { playEmote(player, emote); } } catch (error) {
      console.error(`Unable to play emote ${emote}`, error);
    }
  };
  // Clicking the world interrupts a looping emote.
  const handleWorldPointer = (event: PointerEvent) => {
    if (event.button === 0 || event.button === 2) { if (player) { cancelEmote(player); } }
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
