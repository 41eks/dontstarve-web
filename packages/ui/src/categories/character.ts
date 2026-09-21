import { createCategory } from './shared';

const character = createCategory('character', 'CHARACTER', '角色', 'avatar_wilson.tex', '#8b765c');
character.iconAtlas = 'images/crafting_menu_avatars.xml';

export default character;
