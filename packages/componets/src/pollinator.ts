export interface PollinatorInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface PollinationFlower {
  hasTag(tag: string): boolean;
}

/** components/pollinator.lua: flowers visited so far and the flower currently being approached. */
export class Pollinator<Flower extends PollinationFlower = PollinationFlower> {
  readonly flowers: Flower[] = [];
  readonly distance = 5;
  readonly maxdensity = 4;
  collectcount = 5;
  target: Flower | undefined;
  private readonly inst: PollinatorInst;

  constructor(inst: PollinatorInst) {
    this.inst = inst;
    inst.addTag('pollinator');
  }

  Pollinate(flower: Flower): void {
    if (this.CanPollinate(flower)) {
      this.flowers.push(flower);
      this.target = undefined;
    }
  }

  CanPollinate(flower: Flower | undefined): boolean {
    return flower !== undefined && flower.hasTag('flower') && !this.flowers.includes(flower);
  }

  HasCollectedEnough(): boolean { return this.flowers.length > this.collectcount; }

  dispose(): void { this.inst.removeTag('pollinator'); }
}
