import type { AnimationArchiveParts } from './animationArchive';

export interface AnimationArchiveWorkerRequest {
  id: number;
  file: string;
  assetBaseUrl: string;
  kind: keyof AnimationArchiveParts;
}

export type AnimationArchiveWorkerResponse =
  | { id: number; result: AnimationArchiveParts[keyof AnimationArchiveParts] }
  | { id: number; error: string };
