import type { ImageAtlasPage } from './imageAtlasParser';

export interface ImageAtlasWorkerRequest {
  id: number;
  archiveUrl: string;
  atlasPath: string;
}

export type ImageAtlasWorkerResponse =
  | { id: number; pages: readonly ImageAtlasPage[] }
  | { id: number; error: string };
