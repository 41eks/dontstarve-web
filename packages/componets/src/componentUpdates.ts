export interface UpdatingComponent {
  OnUpdate(dt: number): void;
}

/** StartUpdatingComponent/StopUpdatingComponent: visit only registered, live components. */
export class ComponentUpdates {
  private readonly components = new Set<UpdatingComponent>();

  register(component: UpdatingComponent): () => void {
    this.components.add(component);
    return () => { this.components.delete(component); };
  }

  update(dt: number): void {
    for (const component of this.components) component.OnUpdate(dt);
  }

  dispose(): void { this.components.clear(); }
}
