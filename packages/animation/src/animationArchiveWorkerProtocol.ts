import type { AnimationArchiveParts } from './animationArchive';

export interface AnimationArchiveWorkerRequest {
  id: number;
  file: string;
  assetBaseUrl: string;
  kind: keyof AnimationArchiveParts;
  /** Builds keep BC atlas pages as blocks instead of decoding them to RGBA. */
  compressedAtlases: boolean;
}

export type AnimationArchiveWorkerResponse =
  | { id: number; result: AnimationArchiveParts[keyof AnimationArchiveParts] }
  | { id: number; error: string };
