import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';

/**
 * inst.entity:AddSoundEmitter(). Named sounds live in slots and every sound follows the entity's transform.
 * The emitter belongs to the engine, so what the scripts cannot show is an assumption: replaying a name replaces its slot
 * (the scripts always kill first or test PlayingSound). Scripts that create an entity only to PlaySound and Remove it
 * (yoth_knightwarningsound.lua, wormwarning.lua) show that an unnamed one-shot outlives its entity.
 */
export class SoundEmitter {
  /** Unset for an emitter at the listener, which no distance attenuates. */
  private readonly position?: ReadonlyVector3;
  private readonly named = new Map<string, SoundHandle>();
  private readonly unnamed = new Set<SoundHandle>();
  private volumeMultiplier = 1;

  constructor(position?: ReadonlyVector3) { this.position = position; }

  /** PlaySound(path, name, volume, ispredicted): `ispredicted` only concerns a network client, which the port has none of. */
  PlaySound(path: SoundEventPath, name?: string | null, volume?: number | null): void {
    this.play(path, name, volume);
  }

  /** PlaySoundWithParams(path, params, volume, ispredicted) has no name. */
  PlaySoundWithParams(path: SoundEventPath, params?: Readonly<Record<string, number>> | null, volume?: number | null): void {
    const handle = this.play(path, undefined, volume);
    for (const [param, value] of Object.entries(params ?? {})) handle.setParameter?.(param, value);
  }

  KillSound(name: string): void {
    this.named.get(name)?.stop();
    this.named.delete(name);
  }

  KillAllSounds(): void {
    for (const handle of [...this.named.values(), ...this.unnamed]) handle.stop();
    this.named.clear();
    this.unnamed.clear();
  }

  PlayingSound(name: string): boolean { return this.named.get(name)?.isPlaying() ?? false; }

  SetVolume(name: string, volume: number): void { this.named.get(name)?.setVolume(volume * this.volumeMultiplier); }

  SetParameter(name: string, parameter: string, value: number): void { this.named.get(name)?.setParameter?.(parameter, value); }

  /** fx.lua sets this as the fx is made, before its sounds; it scales the sounds played after it. */
  OverrideVolumeMultiplier(multiplier: number): void { this.volumeMultiplier = multiplier; }

  /** Nothing can reach a named or looping sound once its entity is gone. */
  OnRemoveEntity(): void {
    for (const handle of this.named.values()) handle.stop();
    this.named.clear();
    for (const handle of this.unnamed) if (handle.looping) handle.stop();
    this.unnamed.clear();
  }

  private play(path: SoundEventPath, name: string | null | undefined, volume: number | null | undefined): SoundHandle {
    for (const handle of this.unnamed) if (!handle.isPlaying()) this.unnamed.delete(handle);
    if (name) this.KillSound(name);
    const handle = PlaySound(path, this.position);
    if (volume != null || this.volumeMultiplier !== 1) handle.setVolume((volume ?? 1) * this.volumeMultiplier);
    if (name) this.named.set(name, handle); else this.unnamed.add(handle);
    return handle;
  }
}
