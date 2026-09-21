import { mountGameUi } from '../src';

const { crafting } = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
crafting.setInventoryCounts({ cutgrass: 3, twigs: 17 });
