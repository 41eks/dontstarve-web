import { expect, it } from 'vitest';
import { SpriteState, StaticImageSpriteState, type ArchiveSpriteSource } from '@dontstarve-web/display';
import { createArchiveEntity, PrefabInstance, type PrefabEntityDefinition } from '../../prefab/src/prefabInstance';

const animated = () => new PrefabInstance('animated', new SpriteState({ name: 'idle' }));
const staticImage = () => new PrefabInstance('static', new StaticImageSpriteState({ name: 'half', held: true }));
const assets = { animationArchive: 'grass.zip', buildArchives: ['grass1.zip'], bank: 'grass' };
const staticImages = { buildArchive: 'wall_stone.zip', options: { imageIndices: [0, 1] } };

it('pairs each definition with one kind of art, and static image commands with static image art', () => {
  // One art source per definition, matched to the sprite that can draw its commands.
  const definitions: PrefabEntityDefinition<PrefabInstance>[] = [
    { fn: animated, assets },
    { fn: staticImage, staticImages },
    { fn: animated, icon: { atlas: 'images/inventoryimages.xml', image: 'grass.tex' } },
    { fn: animated },
  ];
  // @ts-expect-error Two art sources: the manager would draw only one of them.
  const both: PrefabEntityDefinition<PrefabInstance> = { fn: animated, assets, icon: { atlas: 'a', image: 'b' } };
  // @ts-expect-error A static image sprite drawn from archive art: its setPose and showImage would throw.
  const staticFromArchive: PrefabEntityDefinition<PrefabInstance> = { fn: staticImage, assets };
  // @ts-expect-error Static images drawn for a sprite that cannot select their poses and images.
  const animatedFromStatic: PrefabEntityDefinition<PrefabInstance> = { fn: animated, staticImages };
  // @ts-expect-error Instanced-batch options belong to archive art.
  const optionsWithoutArchive: PrefabEntityDefinition<PrefabInstance> = { fn: animated, assetOptions: { staticBillboard: true } };
  // @ts-expect-error Static image commands exist only on the static image sprite.
  const pose = () => animated().sprite.setPose('full');
  const archive = { create: () => { throw new Error('not drawn'); } } as unknown as ArchiveSpriteSource;
  // @ts-expect-error An archive entity cannot be given a static image sprite.
  const archived = () => createArchiveEntity('static', archive, { name: 'half', instance: staticImage() });
  expect([definitions.length, both, staticFromArchive, animatedFromStatic, optionsWithoutArchive, pose, archived].length).toBe(7);
  // The static sprite declares a pose and per-facing images in its sprite json.
  const sprite = new StaticImageSpriteState({ name: 'half', held: true });
  sprite.setPose('full'); sprite.setFacingImages(new Map([[1, 0]]));
  expect(sprite.sprite.peek()).toMatchObject({ clip: { name: 'full', pose: { name: 'full' } }, facingImages: new Map([[1, 0]]) });
});
