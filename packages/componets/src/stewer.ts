import { BASE_COOK_TIME, CalculateRecipe, GetRecipe } from './cooking';

export interface StewerContainer {
  canbeopened: boolean;
  IsFull(): boolean;
  IsOpen(): boolean;
  GetAllItems(): readonly { prefab: string }[];
  Close(): void;
  DestroyContents(): void;
  subscribeLifecycle(listener: () => void): () => void;
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
  product?: string;
  done = false;
  cooktimemult = 1;
  ingredient_prefabs?: readonly string[];
  chef_id?: string;
  onstartcooking?: (inst: StewerInstance) => void;
  ondonecooking?: (inst: StewerInstance) => void;
  oncontinuecooking?: (inst: StewerInstance) => void;
  oncontinuedone?: (inst: StewerInstance) => void;
  onharvest?: (inst: StewerInstance) => void;
  private remainingtime?: number;
  private readonly stopContainer: () => void;
  private removed = false;
  private readonly dropProduct?: (prefab: string, count?: number) => void;

  constructor(inst: StewerInstance, dropProduct?: (prefab: string, count?: number) => void) {
    this.inst = inst;
    this.dropProduct = dropProduct;
    inst.addTag('stewer');
    this.stopContainer = inst.components.container.subscribeLifecycle(() => this.refreshReady());
    this.refreshReady();
  }

  private refreshReady(): void {
    const container = this.inst.components.container;
    if (!container.IsOpen() && container.IsFull()) this.inst.addTag('readytocook');
    else this.inst.removeTag('readytocook');
  }

  CanCook(): boolean { return !this.removed && this.inst.components.container.IsFull(); }
  IsCooking(): boolean { return !this.done && this.remainingtime !== undefined; }
  IsDone(): boolean { return this.done; }
  GetTimeToCook(): number { return this.IsCooking() ? this.remainingtime! : 0; }
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
    this.remainingtime = undefined;
    this.done = false;
    this.inst.removeTag('donecooking');
    this.inst.components.container.canbeopened = true;
    return true;
  }

  StartCooking(doer?: { userid?: string }): boolean {
    if (this.removed || this.remainingtime !== undefined) return false;
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
    this.remainingtime = BASE_COOK_TIME * recipe[1] * this.cooktimemult;
    container.Close();
    container.DestroyContents();
    container.canbeopened = false;
    return true;
  }

  LongUpdate(dt: number): void {
    if (this.removed || !this.IsCooking() || !Number.isFinite(dt) || dt <= 0) return;
    this.remainingtime = Math.max(0, this.remainingtime! - dt);
    if (this.remainingtime > 0) return;
    this.remainingtime = undefined;
    this.ondonecooking?.(this.inst);
    this.done = true;
    this.inst.addTag('donecooking');
  }

  OnSave(): StewerSaveData {
    return {
      ...(this.product === undefined ? {} : { product: this.product }),
      ...(this.done ? { done: true } : {}),
      ...(this.remainingtime === undefined ? {} : { remainingtime: this.remainingtime }),
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
    this.remainingtime = this.done ? undefined : Math.max(0, data.remainingtime ?? 0);
    this.inst.components.container.canbeopened = false;
    if (this.done) { this.inst.addTag('donecooking'); this.oncontinuedone?.(this.inst); }
    else this.oncontinuecooking?.(this.inst);
  }

  OnRemoveFromEntity(): void {
    if (this.removed) return;
    this.removed = true;
    this.remainingtime = undefined;
    this.stopContainer();
    for (const tag of ['stewer', 'donecooking', 'readytocook']) this.inst.removeTag(tag);
  }

  /** stewer.lua StopCooking("fire") drops its product even if cooking is unfinished. */
  StopCooking(reason?: string): void {
    this.remainingtime = undefined;
    if (this.product && reason === 'fire') this.dropProduct?.(this.product);
    this.product = undefined;
    this.done = false;
    this.inst.removeTag('donecooking');
  }
}
