import type { CategoryConfig } from './types';

const fire: CategoryConfig = {
  id: 'fire',
  name: '光源',
  icon: 'crafting/filter/filter_fire.tex.png',
  recipes: [{
    name: '火炬',
    description: '便携式光源。',
    color: '#df884b',
    asset: 'crafting/filter/fire/torch.tex.png',
    ingredients: [
      { name: '草', color: '#b4a55f', asset: 'crafting/item/cutgrass.tex.png', available: 3, required: 2 },
      { name: '树枝', color: '#b08a4d', asset: 'crafting/item/twigs.tex.png', available: 17, required: 2 },
    ],
  }],
};

export default fire;
