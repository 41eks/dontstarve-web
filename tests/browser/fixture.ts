import { mountGameUi } from '../../packages/ui/src';

const { crafting } = mountGameUi({ assetBaseUrl: '/dst/data/ui/' });
crafting.setMaterialSummary({ cutgrass: 3, twigs: 17 });
