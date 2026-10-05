export abstract class AssetElement extends HTMLElement {
  static readonly observedAttributes = ['asset-base'];

  protected get assetBaseUrl(): string {
    const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
    return this.getAttribute('asset-base') ?? new URL(`${baseUrl}dst/data/ui/`, document.baseURI).href;
  }

  protected asset(path: string): string {
    const base = this.assetBaseUrl.endsWith('/') ? this.assetBaseUrl : `${this.assetBaseUrl}/`;
    return `${base}${path}`;
  }

  protected dataAsset(path: string): string {
    const base = new URL(this.assetBaseUrl.endsWith('/') ? this.assetBaseUrl : `${this.assetBaseUrl}/`, document.baseURI);
    return new URL(`../${path}`, base).href;
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'asset-base' && oldValue !== newValue && this.isConnected) {
      this.render();
    }
  }

  protected abstract render(): void;
}
