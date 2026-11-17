import { expect, it } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type PrefabEntityDefinition } from '../../prefab/src/prefabInstance';

const animated = () => new PrefabInstance('animated', new SpriteState({ name: 'idle' }));
const assets = { animationArchive: 'grass.zip', buildArchives: ['grass1.zip'], bank: 'grass' };

it('pairs each definition with one kind of art', () => {
  const definitions: PrefabEntityDefinition<PrefabInstance>[] = [
    { fn: animated, assets },
    { fn: animated, icon: { atlas: 'images/inventoryimages.xml', image: 'grass.tex' } },
    { fn: animated },
  ];
  // @ts-expect-error Two art sources: the manager would draw only one of them.
  const both: PrefabEntityDefinition<PrefabInstance> = { fn: animated, assets, icon: { atlas: 'a', image: 'b' } };
  // @ts-expect-error Instanced-batch options belong to archive art.
  const optionsWithoutArchive: PrefabEntityDefinition<PrefabInstance> = { fn: animated, assetOptions: { staticBillboard: true } };
  expect([definitions.length, both, optionsWithoutArchive].length).toBe(3);
});
