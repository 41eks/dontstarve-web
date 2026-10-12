import type { DecodedTexture } from './parseKtex';

export interface TextureWorkerRequest { id: number; url: string }
export type TextureWorkerResponse =
  | { id: number; texture: DecodedTexture }
  | { id: number; error: string };
