import type { MinimapView } from './minimap-view';

/** World-space DOM shared by terrain, icons and the rendering comparison page. */
export class MinimapDomView {
  readonly root = document.createElement('div');
  readonly overview = document.createElement('div');
  readonly icons: ShadowRoot;
  private readonly world = document.createElement('div');
  private readonly iconRule: CSSStyleRule;
  private viewTransform = '';
  private iconTransform = '';

  constructor() {
    this.root.className = 'minimap__viewport';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
    this.world.className = 'minimap__world';
    Object.assign(this.world.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
    this.overview.className = 'minimap__terrain';
    const iconLayer = document.createElement('div');
    iconLayer.className = 'minimap__icons';
    for (const layer of [this.overview, iconLayer]) Object.assign(layer.style, { position: 'absolute', left: '0', top: '0' });
    const styles = new CSSStyleSheet();
    styles.replaceSync('.marker { position: absolute; display: block; width: 32px; height: auto; max-width: none; transform-origin: 0 0; } [hidden] { display: none !important; }');
    this.iconRule = styles.cssRules[0] as CSSStyleRule;
    this.icons = iconLayer.attachShadow({ mode: 'open' });
    this.icons.adoptedStyleSheets = [styles];
    this.world.append(this.overview, iconLayer);
    this.root.append(this.world);
  }

  update(view: MinimapView): void {
    const [a, b, c, d, e, f] = view.canvasTransform(0, 0, 1);
    const transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
    if (transform !== this.viewTransform) this.world.style.transform = this.viewTransform = transform;
    const determinant = a * d - b * c;
    const inverse = `matrix(${d / determinant}, ${-b / determinant}, ${-c / determinant}, ${a / determinant}, 0, 0)`;
    if (inverse !== this.iconTransform) {
      this.iconRule.style.transform = `${inverse} translate(-50%, -50%)`;
      this.iconTransform = inverse;
    }
  }
}
