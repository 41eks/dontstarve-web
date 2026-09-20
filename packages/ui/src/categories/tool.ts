import type { CategoryConfig } from './types';

const tool: CategoryConfig = {
  id: 'tool',
  name: '工具',
  icon: 'crafting/filter/filter_tool.tex.png',
  recipes: [{
    name: '斧头',
    description: '砍倒树木，收集木材。',
    color: '#8d877c',
    asset: 'crafting/filter/tool/axe.tex.png',
    ingredients: [
      { name: '树枝', color: '#b08a4d', asset: 'crafting/item/twigs.tex.png', available: 0, required: 1 },
      { name: '燧石', color: '#b7c5d0', asset: 'crafting/item/flint.tex.png', available: 0, required: 1 },
    ],
  }],
};

export default tool;
