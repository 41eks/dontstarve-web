import { createRenderEffect, createSignal, readonlySignal, type GameTimeScheduler, type ReadonlySignal } from '@dontstarve-web/signals';
import { BASE_COOK_TIME, CalculateRecipe, GetRecipe } from './cooking';
import { ComponentTimer } from './timer';

export interface StewerContainer {
  canbeopened: boolean;
  IsFull(): boolean;
  IsOpen(): boolean;
  GetAllItems(): readonly { prefab: string }[];
  Close(): void;
  DestroyContents(): void;
  TrackContents(): void;
  readonly openCount: ReadonlySignal<number>;
}

export interface StewerInstance {
  prefab: string;
  components: { container: StewerContainer };
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getPosition(): { x: number; y: number; z: number };
}

export interface StewerHarvester {
  giveItem(prefab: string, count: number, position: { x: number; y: number; z: number }): boolean;
}

export interface StewerSaveData {
  product?: string;
  done?: boolean;
  remainingtime?: number;
  ingredient_prefabs?: readonly string[];
  chef_id?: string;
}

/** components/stewer.lua: owns the recipe, cooking task, container and save lifecycle. */
export class Stewer {
  readonly inst: StewerInstance;
  private readonly productState = createSignal<string | undefined>(undefined);
  private readonly doneState = createSignal(false);
  /** Read-only views for presentation effects; the fields below stay the component's own interface. */
  readonly state = Object.freeze({ product: readonlySignal(this.productState), done: readonlySignal(this.doneState) });
  get product(): string | undefined { return this.productState.peek(); }
  set product(value: string | undefined) { this.productState.set(value); }
  get done(): boolean { return this.doneState.peek(); }
  set done(value: boolean) { this.doneState.set(value); }
  cooktimemult = 1;
  ingredient_prefabs?: readonly string[];
  chef_id?: string;
  onstartcooking?: (inst: StewerInstance) => void;
  ondonecooking?: (inst: StewerInstance) => void;
  oncontinuecooking?: (inst: StewerInstance) => void;
  oncontinuedone?: (inst: StewerInstance) => void;
  onharvest?: (inst: StewerInstance) => void;
  /** self.task: DoTaskInTime(cooktime, dostew). Running means self.targettime is set. */
  private readonly cookTask: ComponentTimer;
  /** The task's whole duration: `end - now` can round above it, and a save rejects a time longer than its recipe's. */
  private cooktime = 0;
  private readonly stopContainer: () => void;
  private removed = false;
  private readonly dropProduct?: (prefab: string, count?: number) => void;

  constructor(inst: StewerInstance, scheduler: GameTimeScheduler, dropProduct?: (prefab: string, count?: number) => void) {
    this.inst = inst;
    this.cookTask = new ComponentTimer(scheduler, () => this.dostew());
    this.dropProduct = dropProduct;
    inst.addTag('stewer');
    // ItemGet / ItemLose / onopen / onclose: readytocook follows the container's contents and opening.
    this.stopContainer = createRenderEffect(() => {
      inst.components.container.TrackContents();
      inst.components.container.openCount.get();
      this.refreshReady();
    });
  }

  private refreshReady(): void {
    const container = this.inst.components.container;
    if (!container.IsOpen() && container.IsFull()) this.inst.addTag('readytocook');
    else this.inst.removeTag('readytocook');
  }

  CanCook(): boolean { return !this.removed && this.inst.components.container.IsFull(); }
  IsCooking(): boolean { return !this.done && this.cookTask.remainingSeconds !== undefined; }
  IsDone(): boolean { return this.done; }
  GetTimeToCook(): number { return this.IsCooking() ? Math.min(this.cookTask.remainingSeconds!, this.cooktime) : 0; }
  GetRecipeForProduct() { return this.product === undefined ? undefined : GetRecipe(this.inst.prefab, this.product); }

  /** stewer.lua:Harvest; the receiver gives the product to inventory or drops it. */
  Harvest(harvester?: StewerHarvester): boolean {
    if (this.removed || !this.done) return false;
    if (this.product) {
      const count = this.GetRecipeForProduct()?.stacksize ?? 1;
      if (harvester) {
        if (!harvester.giveItem(this.product, count, this.inst.getPosition())) return false;
      } else if (this.dropProduct) this.dropProduct(this.product, count);
      else return false;
    }
    this.onharvest?.(this.inst);
    this.product = undefined;
    this.cookTask.stop();
    this.done = false;
    this.inst.removeTag('donecooking');
    this.inst.components.container.canbeopened = true;
    return true;
  }

  StartCooking(doer?: { userid?: string }): boolean {
    if (this.removed || this.cookTask.remainingSeconds !== undefined) return false;
    const container = this.inst.components.container;
    const names = container.GetAllItems().map(item => item.prefab);
    const recipe = CalculateRecipe(this.inst.prefab, names);
    if (!recipe) return false;
    this.chef_id = doer?.userid;
    this.ingredient_prefabs = names;
    this.done = false;
    this.inst.removeTag('donecooking');
    this.onstartcooking?.(this.inst);
    this.product = recipe[0];
    this.startCookTask(BASE_COOK_TIME * recipe[1] * this.cooktimemult);
    container.Close();
    container.DestroyContents();
    container.canbeopened = false;
    return true;
  }

  private startCookTask(seconds: number): void {
    this.cooktime = seconds;
    this.cookTask.start(seconds);
  }

  private dostew(): void {
    this.ondonecooking?.(this.inst);
    this.done = true;
    this.inst.addTag('donecooking');
  }

  /** stewer.lua LongUpdate: time that passed outside the scheduler, such as a skipped stretch of the world. */
  LongUpdate(dt: number): void {
    if (this.removed || !this.IsCooking() || !Number.isFinite(dt) || dt <= 0) return;
    const remaining = this.GetTimeToCook() - dt;
    if (remaining > 0) { this.startCookTask(remaining); return; }
    this.cookTask.stop();
    this.dostew();
  }

  OnSave(): StewerSaveData {
    return {
      ...(this.product === undefined ? {} : { product: this.product }),
      ...(this.done ? { done: true } : {}),
      ...(this.IsCooking() ? { remainingtime: this.GetTimeToCook() } : {}),
      ...(this.ingredient_prefabs === undefined ? {} : { ingredient_prefabs: [...this.ingredient_prefabs] }),
      ...(this.chef_id === undefined ? {} : { chef_id: this.chef_id }),
    };
  }

  OnLoad(data: StewerSaveData): void {
    if (data.product === undefined) return;
    this.product = data.product;
    this.done = data.done ?? false;
    this.ingredient_prefabs = data.ingredient_prefabs ? [...data.ingredient_prefabs] : undefined;
    this.chef_id = data.chef_id;
    if (this.done) this.cookTask.stop();
    else this.startCookTask(Math.max(0, data.remainingtime ?? 0));
    this.inst.components.container.canbeopened = false;
    if (this.done) { this.inst.addTag('donecooking'); this.oncontinuedone?.(this.inst); }
    else this.oncontinuecooking?.(this.inst);
  }

  OnRemoveFromEntity(): void {
    if (this.removed) return;
    this.removed = true;
    this.cookTask.stop();
    this.stopContainer();
    for (const tag of ['stewer', 'donecooking', 'readytocook']) this.inst.removeTag(tag);
  }

  /** stewer.lua StopCooking("fire") drops its product even if cooking is unfinished. */
  StopCooking(reason?: string): void {
    this.cookTask.stop();
    if (this.product && reason === 'fire') this.dropProduct?.(this.product);
    this.product = undefined;
    this.done = false;
    this.inst.removeTag('donecooking');
  }
}
