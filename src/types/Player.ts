// src/types/Player.ts
import * as CANNON from "cannon-es";
export type PlayerBody = CANNON.Body & { canJump: boolean };