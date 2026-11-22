import type { ImageAtlasPage } from './imageAtlasParser';
import type { DecodedTexture } from './parseKtex';

/** Parse an atlas of an image archive, or decode one page's KTEX (copied, the page keeps its own) to RGBA. */
export type ImageAtlasWorkerRequest =
  | { id: number; archiveUrl: string; atlasPath: string }
  | { id: number; ktex: Uint8Array; label: string };

export type ImageAtlasWorkerResponse =
  | { id: number; pages: readonly ImageAtlasPage[] }
  | { id: number; texture: DecodedTexture }
  | { id: number; error: string };
