import type { MinimapView } from './minimap-view';

/** Percentage world coordinates share a resized container. Only rotation reaches the icons. */
export class MinimapDomView {
  readonly root = document.createElement('div');
  readonly overview = document.createElement('div');
  readonly icons: ShadowRoot;
  private readonly world = document.createElement('div');
  private readonly iconRule: CSSStyleRule;
  private viewTransform = '';
  private iconTransform = '';
  private side = 0;
  private heading = NaN;
  private orientation = [1, 0, 0, 1];
  private readonly worldSize: number;

  constructor(worldSize: number) {
    this.worldSize = worldSize;
    this.root.className = 'minimap__viewport';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
    this.world.className = 'minimap__world';
    Object.assign(this.world.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
    this.overview.className = 'minimap__terrain';
    const iconLayer = document.createElement('div');
    iconLayer.className = 'minimap__icons';
    for (const layer of [this.overview, iconLayer]) Object.assign(layer.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
    });
    const styles = new CSSStyleSheet();
    styles.replaceSync('.marker { position: absolute; display: block; width: 32px; height: auto; max-width: none; transform-origin: 0 0; } [hidden] { display: none !important; }');
    this.iconRule = styles.cssRules[0] as CSSStyleRule;
    this.icons = iconLayer.attachShadow({ mode: 'open' });
    this.icons.adoptedStyleSheets = [styles];
    this.world.append(this.overview, iconLayer);
    this.root.append(this.world);
  }

  update(view: MinimapView): void {
    const side = this.worldSize * view.scale;
    if (side !== this.side) {
      this.world.style.width = this.world.style.height = `${side}px`;
      this.side = side;
    }
    // Cache by heading: zoom must never rewrite the shared marker rule, even
    // when normalizing a floating-point matrix would produce tiny differences.
    if (view.heading !== this.heading) {
      this.heading = view.heading;
      const [a, b, c, d] = view.canvasTransform(0, 0, 1 / view.scale);
      this.orientation = [a, b, c, d];
      const determinant = a * d - b * c;
      const inverse = `matrix(${d / determinant}, ${-b / determinant}, ${-c / determinant}, ${a / determinant}, 0, 0)`;
      if (inverse !== this.iconTransform) {
        this.iconRule.style.transform = `${inverse} translate(-50%, -50%)`;
        this.iconTransform = inverse;
      }
    }
    const [a, b, c, d] = this.orientation;
    const { x: e, z: f } = view.worldToScreen(0, 0);
    const transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
    if (transform !== this.viewTransform) this.world.style.transform = this.viewTransform = transform;
  }
}
