import type { CategoryConfig } from './categories';
import { urlString } from './utils';

interface CategoryButtonMapperOptions {
  activeCategoryId: string;
  assetBaseUrl: string;
  atlasImage: (className: string, atlasPath: string, elementName: string) => HTMLCanvasElement;
  selectCategory: (category: CategoryConfig, button: HTMLButtonElement) => void;
}

export function createCategoryButtonMapper({
  activeCategoryId,
  assetBaseUrl,
  atlasImage,
  selectCategory,
}: CategoryButtonMapperOptions): (category: CategoryConfig) => HTMLButtonElement {
  return (category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-category';
    button.dataset.category = category.id;
    button.title = category.name;
    button.setAttribute('aria-label', category.name);
    button.setAttribute('aria-pressed', String(category.id === activeCategoryId));

    const inactiveBackground = urlString`${assetBaseUrl}/crafting/filter/filter_button_inactive.tex.png`;
    const activeBackground = urlString`${assetBaseUrl}/crafting/filter/filter_button_active.tex.png`;
    button.innerHTML = `
      <img class="craft-category-frame craft-category-frame-inactive" src="${inactiveBackground}" alt="" />
      <img class="craft-category-frame craft-category-frame-active" src="${activeBackground}" alt="" />
    `;
    button.append(atlasImage(
      'craft-category-icon',
      category.iconAtlas ?? 'images/crafting_menu_icons.xml',
      category.icon,
    ));
    button.addEventListener('click', () => selectCategory(category, button));
    return button;
  };
}
