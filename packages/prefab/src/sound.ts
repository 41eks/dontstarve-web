import { Vector3 } from 'three';
import { TILE_SIZE } from './tile';

// dontstarve.fev file_index is zero-based; these vgmstream stream IDs are one-based.
const sounds = {
  // SGwilson portal_jumpout, sounddef 516, wilson file_index 1.
  'dontstarve/movement/bodyfall_dirt': { bank: 'wilson', streams: [2], loop: false },
  // SGwilson portal jump: dontstarve.fev sounddef 2210; together file_index 1487–1491.
  'dontstarve/creatures/together/toad_stool/infection_post': { bank: 'together', streams: [1488, 1489, 1490, 1491, 1492], loop: false },
  // sounddefs 2886 + 2722: soul spawn plus Fire_addFuelFlare, two simultaneous layers.
  'dontstarve/characters/wortox/soul/spawn': { bank: 'wortox', streams: [118], loop: false,
    layers: [{ bank: 'common', streams: [67] }] },
  // sounddef 2885: soul_hop_OUT_wortox_DST-001..024, file_index 69–92.
  'dontstarve/characters/wortox/soul/hop_out': { bank: 'wortox', streams: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
    82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93], loop: false },
  // scienceprototyper.lua / magicprototyper.lua → dontstarve.fev sounddefs 244/245/619/944; file_index + 1.
  'dontstarve/common/researchmachine_lvl1_idle_LP': { bank: 'common', streams: [248], loop: true, volume: .15848931670188904 },
  'dontstarve/common/researchmachine_lvl2_idle_LP': { bank: 'common', streams: [249], loop: true, volume: .15848931670188904 },
  'dontstarve/common/researchmachine_lvl3_idle_LP': { bank: 'common', streams: [251], loop: true, volume: .15848931670188904 },
  'dontstarve/common/researchmachine_lvl4_idle_LP': { bank: 'common', streams: [213], loop: true, volume: .10000000149011612, pitchOctaves: -.25 },
  // rock_avocado_bush.lua picksound → dontstarve.fev sounddef 86 → wilson file_index 19–21.
  'dontstarve/wilson/harvest_berries': { bank: 'wilson', streams: [20, 21, 22], loop: false },
  // flies.lua → dontstarve.fev sounddef 56 → common file_index 74–80 (Flies_soothed_DST_-001..007).
  'dontstarve/common/flies': { bank: 'common', streams: [75, 76, 77, 78, 79, 80, 81], loop: true },
  // grass.lua → dontstarve.fev sounddef 19 → wilson file_index 115–118.
  'dontstarve/wilson/pickup_reeds': { bank: 'wilson', streams: [116, 117, 118, 119], loop: false },
  // SGwilson.lua dolongaction → dontstarve.fev sounddefs 1758/1759, two layers.
  // Short whooshes are triggered by build_loop cycles; raw sample looping repeats too quickly.
  'dontstarve/wilson/make_trap': { bank: 'wilson', streams: [71, 72, 73, 74, 75], loop: false,
    layers: [{ bank: 'wilson', streams: [76, 77, 78, 79, 80] }] },
  // flower_cave.lua onpickedfn → dontstarve.fev sounddef 1023 → wilson file_index 66.
  'dontstarve/wilson/pickup_lightbulb': { bank: 'wilson', streams: [67], loop: false },
  // cookpot.lua → dontstarve.fev sounddefs 246 / 353 / 203 (file_index + 1).
  'dontstarve/common/cookingpot_rattle': { bank: 'common', streams: [49, 50, 51, 52, 53, 54, 55], loop: true },
  'dontstarve/common/cookingpot_close': { bank: 'common', streams: [340], loop: false },
  'dontstarve/common/cookingpot_finish': { bank: 'common', streams: [301], loop: false },
  // torch.lua → dontstarve.fev sound definitions 42/44 → file_index + 1.
  'dontstarve/wilson/torch_swing': { bank: 'wilson', streams: [95, 96], loop: false },
  // gunpowder.lua / explode_small.lua → dontstarve.fev sounddefs 614 (fuse loop, common file_index 146) and 615
  // (blackpowder_explo_1..3, file_index 143–145), each + 1 for vgmstream.
  'dontstarve/common/blackpowder_fuse_LP': { bank: 'common', streams: [147], loop: true },
  'dontstarve/common/blackpowder_explo': { bank: 'common', streams: [144, 145, 146], loop: false },
  // fence.lua ondeploywall → dontstarve.fev sounddef 472 (place_structure_wood.wav), common file_index 232.
  'dontstarve/common/place_structure_wood': { bank: 'common', streams: [233], loop: false },
  'dontstarve/common/fireOut': { bank: 'common', streams: [198], loop: false },
  // fx.lua halloween_moonpuff → dontstarve.fev sounddef 63 (Fire_addFuelFlare.wav), common file_index 66.
  'dontstarve/common/fireAddFuel': { bank: 'common', streams: [67], loop: false },
  // grottowaterfallsoundcontroller.lua → grotto.fev common/waterfall_LP: sounddef 41 (waterfall_grotto_DST_LP-004, grotto_sfx file_index 556)
  // plus sounddef 99 (waterfall_condensed_LP_DST-001..012, file_index 544–555), each + 1.
  'grotto/common/waterfall_LP': { bank: 'grotto_sfx', streams: [557], loop: true,
    layers: [{ bank: 'grotto_sfx', streams: [545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556] }] },
  // fire.lua → dontstarve.fev sounddefs 1762 / 1765 / 1766, three simultaneous layers.
  'dontstarve/common/campfire': { bank: 'common', streams: [149, 150, 151, 152], loop: true,
    layers: [{ bank: 'common', streams: [153, 154, 155, 156] }, { bank: 'common', streams: [158, 159, 160, 161] }] },
  // fire.lua firelevels 5–6 → dontstarve.fev sounddef 78 → common file_index 324 and 157–159 (+ 1).
  'dontstarve/common/forestfire': { bank: 'common', streams: [325, 158, 159, 160], loop: true },
  // evergreens.lua chop_down_burnt_tree → dontstarve.fev sounddef 118 → forest file_index 4 (+ 1).
  'dontstarve/forest/treeCrumble': { bank: 'forest', streams: [5], loop: false },
  // livinglog.lua onignite → dontstarve.fev sounddef 631 → leif file_index 66–69 (livinglog_burn_1..4).
  'dontstarve/creatures/leif/livinglog_burn': { bank: 'leif', streams: [67, 68, 69, 70], loop: false },
  // tent.lua → dontstarve.fev sounddefs 1334 (eleven tent_sleep_loop variants, sfx file_index 394–404), 171 and 172.
  'dontstarve/common/tent_sleep': { bank: 'sfx', streams: [395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405], loop: false },
  'dontstarve/common/tent_dis_pre': { bank: 'common', streams: [103], loop: false },
  'dontstarve/common/tent_dis_twirl': { bank: 'common', streams: [104], loop: false },
  // pigking.lua / SGpigking.lua → dontstarve.fev sounddefs 73 / 71 / 72 → pig file_index 0 / 1 / 2.
  'dontstarve/pig/PigKingThrowGold': { bank: 'pig', streams: [1], loop: false },
  'dontstarve/pig/PigKingHappy': { bank: 'pig', streams: [2], loop: false },
  'dontstarve/pig/PigKingReject': { bank: 'pig', streams: [3], loop: false },
  // nightmarerock / SGnightmarerock.lua → dontstarve.fev sounddefs 1777 (ghostup) / 1779 (down) layered with 1778 (rockup_1..4),
  // sanity file_index 47 / 46 / 48–51 (+ 1).
  'dontstarve/sanity/shadowrock_up': { bank: 'sanity', streams: [48], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_reveal': { bank: 'sanity', streams: [48], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_down': { bank: 'sanity', streams: [47], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  'dontstarve/sanity/shadowrock_conseal': { bank: 'sanity', streams: [47], loop: false, layers: [{ bank: 'sanity', streams: [49, 50, 51, 52] }] },
  // SGwilson.lua slip states → dontstarve.fev sounddefs 1689 / 3070 / 3069 (sfx file_index + 1) and 47 (wilson hurt).
  'dontstarve/movement/iceslab_slipping': { bank: 'sfx', streams: [309, 310, 311, 312, 313, 314, 315, 316], loop: false },
  'dontstarve/movement/slip_fall_whoop': { bank: 'sfx', streams: [332, 333, 334, 335], loop: false },
  'dontstarve/movement/slip_fall_thud': { bank: 'sfx', streams: [336, 337, 338, 339, 340], loop: false },
  'dontstarve/characters/wilson/hurt': { bank: 'wilson', streams: [107, 108, 109], loop: false },
  // SGwilson.lua death → dontstarve.fev wilson/death (sounddef 15, DST_death_body_fall_v2.wav, wilson file_index 35)
  // and waxwell.lua soundsname "maxwell" → characters/maxwell/death_voice (sounddef 758, maxwell file_index 91); each + 1.
  'dontstarve/wilson/death': { bank: 'wilson', streams: [36], loop: false },
  'dontstarve/characters/maxwell/death_voice': { bank: 'maxwell', streams: [92], loop: false },
  // SGwilson.lua amulet_rebirth → dontstarve.fev common/rebirth_amulet_raise (sounddef 281, ResurectAmulet_raise_1, common file_index 86)
  // and rebirth_amulet_poof (sounddef 282, ResurectAmulet_poof_1, file_index 85); each + 1.
  'dontstarve/common/rebirth_amulet_raise': { bank: 'common', streams: [87], loop: false, volume: 0.7079457640647888 },
  'dontstarve/common/rebirth_amulet_poof': { bank: 'common', streams: [86], loop: false, volume: 0.7943282127380371 },
  // fx.lua die_fx → dontstarve.fev common/deathpoof (sounddef 476, common file_index 186) + 1.
  'dontstarve/common/deathpoof': { bank: 'common', streams: [187], loop: false },
  // SGwilsonghost.lua appear/hit (no "girl" tag) → dontstarve.fev ghost/ghost_howl: two simultaneous layers, sounddef 1889
  // (Ghost_howl_1..4, ghost file_index 11–14) and 1891 (Ghost_howl_5..8, 15–18), each + 1.
  'dontstarve/ghost/ghost_howl': { bank: 'ghost', streams: [12, 13, 14, 15], loop: false,
    layers: [{ bank: 'ghost', streams: [16, 17, 18, 19] }] },
  // SGwilsonghost.lua haunt_pre → dontstarve.fev ghost/ghost_haunt: sounddef 1094 (Ghost_haunt_1..5, ghost file_index 6–10), each + 1.
  'dontstarve/ghost/ghost_haunt': { bank: 'ghost', streams: [7, 8, 9, 10, 11], loop: false },
  'dontstarve/wilson/equip_item_gold': { bank: 'wilson', streams: [115], loop: false },
  'dontstarve/wilson/dig': { bank: 'wilson', streams: [64, 65, 66], loop: false },
  'dontstarve_DLC001/creatures/mole/emerge': { bank: 'mole', streams: [2, 3, 4], loop: false, volume: 0.2818382978439331, pitchOctaves: 0.0 },
  // SGmole.lua → dontstarve_DLC001.fev sounddefs 12–18 / 68–70; file_index + 1.
  'dontstarve_DLC001/creatures/mole/death': { bank: 'mole', streams: [1], loop: false, volume: 0.17782793939113617, pitchOctaves: -0.125 },
  'dontstarve_DLC001/creatures/mole/emerge_voice': { bank: 'mole', streams: [5, 6, 7], loop: false, volume: 0.2818382978439331, pitchOctaves: -0.125 },
  'dontstarve_DLC001/creatures/mole/hurt': { bank: 'mole', streams: [8, 9, 10], loop: false, volume: 0.17782793939113617, pitchOctaves: -0.125 },
  'dontstarve_DLC001/creatures/mole/move': { bank: 'mole', streams: [26], loop: true, volume: 0.1412537544965744, pitchOctaves: -0.25 },
  'dontstarve_DLC001/creatures/mole/retract': { bank: 'mole', streams: [2, 3, 4], loop: false, volume: 0.25118863582611084, pitchOctaves: 0.0 },
  'dontstarve_DLC001/creatures/mole/jump': { bank: 'mole', streams: [11], loop: false, volume: 0.1412537544965744, pitchOctaves: 0.25 },
  'dontstarve_DLC001/creatures/mole/pickup': { bank: 'mole', streams: [12, 13], loop: false, volume: 0.1412537544965744, pitchOctaves: -0.1666666716337204 },
  'dontstarve_DLC001/creatures/mole/sniff': { bank: 'mole', streams: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], loop: false, volume: 0.07079457491636276, pitchOctaves: 0.0 },
  // FEV simple-event pitch is -0.25 octaves (sniff: 0); the short sample plays once per SG sleep timeline.
  'dontstarve_DLC001/creatures/mole/sleep': { bank: 'mole', streams: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], loop: false, volume: 0.07079457491636276, pitchOctaves: -0.25 },
  // farmplantable.lua / SGwilson.lua → dontstarve.fev (file_index + 1).
  // fertilizer.lua → dontstarve.fev common/fertilize, sounddef 1300, sfx file_index 122–125.
  'dontstarve/common/fertilize': { bank: 'sfx', streams: [123, 124, 125, 126], loop: false },
  'dontstarve/common/plant': { bank: 'common', streams: [170, 171, 172, 173, 174], loop: false },
  'dontstarve/wilson/eat': { bank: 'wilson', streams: [112, 113, 114], loop: false },
  // SGwilson.lua DoEatSound → dontstarve.fev sounddef 1712 → sfx file_index 1286.
  'dontstarve/wilson/sip': { bank: 'sfx', streams: [1287], loop: false },
  // phonograph.lua → dontstarve.fev → gramaphone banks (file_index + 1).
  'dontstarve/music/gramaphone_ragtime': { bank: 'gramaphone', streams: [10], loop: true },
  'dontstarve/music/gramaphone_creepyforest': { bank: 'gramaphone', streams: [4], loop: true },
  'dontstarve/music/gramaphone_drstyle': { bank: 'gramaphone', streams: [7], loop: true },
  'dontstarve/music/gramaphone_efs': { bank: 'gramaphone', streams: [9], loop: true },
  'dontstarve/music/gramaphone_hallowednights': { bank: 'music_frontend_hallowednights2024', streams: [1], loop: true },
  'dontstarve/music/gramaphone_end': { bank: 'gramaphone', streams: [12], loop: false },
  'farming/common/farm/plow/drill_pre': { bank: 'farming', streams: [90], loop: false },
  'farming/common/farm/plow/LP': { bank: 'farming', streams: [82, 83, 84], loop: true,
    layers: [{ bank: 'farming', streams: [85] }, { bank: 'farming', streams: [86] },
      { bank: 'farming', streams: [87] }, { bank: 'farming', streams: [88] }] },
  'farming/common/farm/plow/collapse': { bank: 'farming', streams: [89], loop: false },
  'farming/common/farm/plow/dirt_puff': { bank: 'farming', streams: [9], loop: false,
    layers: [{ bank: 'farming', streams: [10] }] },
  'dontstarve/common/staff_star_create': { bank: 'common', streams: [273], loop: false },
  'dontstarve/common/staff_star_LP': { bank: 'common', streams: [274], loop: true },
  'dontstarve/wilson/use_gemstaff': { bank: 'common', streams: [284], loop: false },
  'dontstarve/common/staffteleport': { bank: 'common', streams: [284], loop: false },
  // trident.lua / SGwilson.lua play_strum and fx.lua crab_king_waterspout → hookline_2.fev sounddefs 43 / 32
  // (trident_gnarwail_DST-001..003 at file_index 302–304; waterspike_V2_crabking_DST-001..015 at 286–300), each + 1.
  'hookline_2/characters/trident_attack': { bank: 'hookline_2', streams: [303, 304, 305], loop: false },
  'hookline_2/creatures/boss/crabking/waterspout': { bank: 'hookline_2',
    streams: [287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301], loop: false },
  // staff.lua → dontstarve.fev sounddefs 926 / 980 / 981 / 982, file_index + 1.
  'dontstarve/common/staff_dissassemble': { bank: 'common', streams: [272], loop: false },
  'dontstarve/common/destroy_magic': { bank: 'common', streams: [189], loop: false },
  'dontstarve/common/destroy_clothing': { bank: 'common', streams: [188], loop: false },
  'dontstarve/common/destroy_tool': { bank: 'common', streams: [190], loop: false },
  // staff.lua onfinished → sounddef 917 → gem_shatter.wav, zero-based file_index 202.
  'dontstarve/common/gem_shatter': { bank: 'common', streams: [203], loop: false },
  // FEV has three simultaneous layers, each with one sound definition.
  'dontstarve/common/staff_coldlight_LP': { bank: 'sfx', streams: [796], loop: true,
    layers: [{ bank: 'sfx', streams: [797] }, { bank: 'common', streams: [158] }] },
  'dontstarve/wilson/hit': { bank: 'sfx', streams: [423, 424], loop: false },
  // armor_snurtleshell.lua / SGwilson.lua shell_enter → dontstarve.fev movement/foley/hideshell: sounddef 859 (impact_shell_4.wav), sfx file_index 143.
  'dontstarve/movement/foley/hideshell': { bank: 'sfx', streams: [144], loop: false },
  // armor_snurtleshell.lua OnBlocked → dontstarve.fev wilson/hit_armour: two simultaneous layers, sounddef 1763
  // (chop_tree_V2_1..3, common file_index 336–338) and 1768 (chop_tree_1..5, 331–335), file_index + 1.
  'dontstarve/wilson/hit_armour': { bank: 'common', streams: [337, 338, 339], loop: false,
    layers: [{ bank: 'common', streams: [332, 333, 334, 335, 336] }] },
  'dontstarve/common/destroy_smoke': { bank: 'common', streams: [56, 57, 58, 59], loop: false,
    layers: [{ bank: 'common', streams: [62] }, { bank: 'common', streams: [187] }] },
  'dontstarve/common/destroy_wood': { bank: 'common', streams: [64], loop: false },
  // axe.lua / moontree.lua → dontstarve.fev use_axe_tree: sounddefs 1763 (common) + 1764 (sfx), file_index + 1.
  'dontstarve/wilson/use_axe_tree': { bank: 'common', streams: [337, 339, 338], loop: false,
    layers: [{ bank: 'sfx', streams: [1246, 1247, 1248, 1249, 1237, 1242, 1243, 1244, 1245, 1238, 1239, 1240, 1241] }] },
  // moontree.lua on_chop_tree_down → dontstarve.fev treeFall: tree_fall_1.wav, forest file_index 8.
  'dontstarve/forest/treeFall': { bank: 'forest', streams: [9], loop: false },
  // mushrooms.lua opentaskfn / closetaskfn → dontstarve.fev common/mushroom_up and mushroom_down: sounddefs 616 / 617,
  // common file_index 223–225 / 220–222, each + 1.
  'dontstarve/common/mushroom_up': { bank: 'common', streams: [224, 225, 226], loop: false },
  'dontstarve/common/mushroom_down': { bank: 'common', streams: [221, 222, 223], loop: false },
  // mushtree.lua / mushtree_moon.lua → dontstarve.fev wilson/use_axe_mushroom: sounddef 2183, sfx file_index 1252–1254, each + 1.
  'dontstarve/wilson/use_axe_mushroom': { bank: 'sfx', streams: [1253, 1254, 1255], loop: false },
  // mushtree.lua workfinishcallback uses the event spelled `forest/treefall`; the FEV event is treeFall (tree_fall_1.wav).
  'dontstarve/forest/treefall': { bank: 'forest', streams: [9], loop: false },
  // mushtree.lua DoGrow / startchange → dontstarve.fev cave/mushtree_tall_grow_1..3 and _shrink: sounddefs 1186 / 1189 / 1190 / 1191,
  // together file_index 290–293 / 294–297 / 298–301 / 302–304, each + 1.
  'dontstarve/cave/mushtree_tall_grow_1': { bank: 'together', streams: [291, 292, 293, 294], loop: false },
  'dontstarve/cave/mushtree_tall_grow_2': { bank: 'together', streams: [295, 296, 297, 298], loop: false },
  'dontstarve/cave/mushtree_tall_grow_3': { bank: 'together', streams: [299, 300, 301, 302], loop: false },
  'dontstarve/cave/mushtree_tall_shrink': { bank: 'together', streams: [303, 304, 305], loop: false },
  // moonbutterfly.lua / moontree.lua → dontstarve.fev sounddefs 91 / 92 / 130, file_index + 1.
  'dontstarve/wilson/plant_tree': { bank: 'wilson', streams: [24], loop: false },
  'dontstarve/forest/treeGrow': { bank: 'forest', streams: [6], loop: false },
  'dontstarve/forest/treeGrowFromWilt': { bank: 'forest', streams: [8], loop: false },
  // marbleshrub.lua statedata → dontstarve.fev common/together/marble_shrub/grow and wilt_to_grow: Tree_grow / Tree_wilttogrow
  // (forest file_index 5 / 7), DST_Meat_Effigy_Attune_on (together 1429) and spiderqueen_footstep_1..4 (spider 122–125), each + 1.
  'dontstarve/common/together/marble_shrub/grow': { bank: 'forest', streams: [6], loop: false, volume: .45185595750808716,
    layers: [{ bank: 'together', streams: [1430] }, { bank: 'spider', streams: [123, 124, 125, 126] }] },
  'dontstarve/common/together/marble_shrub/wilt_to_grow': { bank: 'forest', streams: [8], loop: false, volume: .4623810350894928,
    layers: [{ bank: 'together', streams: [1430] }, { bank: 'spider', streams: [123, 124, 125, 126] }] },
  // evergreens.lua GrowOld → dontstarve.fev sounddef 127 → forest file_index 6.
  'dontstarve/forest/treeWilt': { bank: 'forest', streams: [7], loop: false },
  // fx.lua leaf FX → dontstarve_DLC001.fev sounddef 39 → amb_stream file_index 88–97.
  'dontstarve_DLC001/fall/leaf_rustle': { bank: 'amb_stream', streams: [89, 91, 92, 93, 94, 95, 96, 97, 98, 90], loop: false },
  // winterometer.lua onbuilt → dontstarve.fev sounddef 1331 (Thermal_measurer_craft.wav) → common file_index 175.
  'dontstarve/common/winter_meter_craft': { bank: 'common', streams: [176], loop: false },
  // lightningrod.lua dozap / onbuilt → dontstarve.fev sounddefs 651 (lightningrod_1..3) and 1328 (lightning_rod_craft),
  // common file_index 208–210 and 180, each + 1.
  'dontstarve/common/lightningrod': { bank: 'common', streams: [209, 210, 211], loop: false },
  'dontstarve/common/lightning_rod_craft': { bank: 'common', streams: [181], loop: false },
  // lightning.lua → dontstarve.fev sounddef 612 (thunder_close_1..4), forest_stream file_index 93–96 + 1.
  'dontstarve/rain/thunder_close': { bank: 'forest_stream', streams: [94, 95, 96, 97], loop: false },
  // sculptingtable.lua onbuilt → dontstarve.fev sounddef sfx/together/sculpting_table/sculpting_station_craft-01.wav → sfx stream 910.
  'dontstarve/common/together/sculpting_table/craft': { bank: 'sfx', streams: [910], loop: false },
  // dock_kit.lua on_deploy PlaySoundWithParams(intensity = .8) → turnoftides.fev common/together/boat/damage: four layers,
  // sounddefs 160 (armoured_1..8), 165 (cargo_1..8), 128 (kickdrum_1..2), 142 (woodbreak_DST-001..026), turnoftides
  // file_index + 1. Volume envelopes (EPRP 24–25, 26–28, 29–30, 10 + 31) are linear in `intensity`; the layer-0
  // "FMOD Highpass Simple" filter envelope (EPRP 22–23) is not modelled.
  'dontstarve/common/together/boat/damage': { bank: 'turnoftides', streams: [89, 90, 91, 92, 93, 94, 95, 96], loop: false,
    layers: [{ bank: 'turnoftides', streams: [97, 98, 99, 100, 101, 102, 103, 104] }, { bank: 'turnoftides', streams: [40, 41] },
      { bank: 'turnoftides', streams: [869, 894, 870, 871, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 884, 885, 886,
        887, 888, 889, 890, 891, 892, 893] }],
    intensity: [[[0, .041763], [.993251, 0]], [[0, .01], [.257593, 0], [.986502, 1]], [[0, .23], [.990921, .67]],
      [[0, 0], [.994521, .41]]] },
  // moondial.lua / SGmoondial.lua → dontstarve.fev sounddefs 2361 (fill_2_1..4), 2362/2363 (full_LP, one sample),
  // 2367 (water_movement_1..5) and 2366 (place), together file_index 1324–1328, 1336–1341 (+ 1).
  'dontstarve/common/together/moondial/fill': { bank: 'together', streams: [1325, 1326, 1327, 1328], loop: false },
  'dontstarve/common/together/moondial/full_LP': { bank: 'together', streams: [1329], loop: true },
  'dontstarve/common/together/moondial/water_movement': { bank: 'together', streams: [1338, 1339, 1340, 1341, 1342], loop: false },
  'dontstarve/common/together/moondial/craft': { bank: 'together', streams: [1337], loop: false },
  // moonbase.lua / sculptingtable.lua → dontstarve.fev sounddefs 2381 + 2355, two simultaneous layers.
  // place_structure_wood (common file_index 232) + one of 18 Medium_rock_impact variants (sfx file_index + 1).
  'dontstarve/common/together/moonbase/moonstaff_place': { bank: 'common', streams: [233], loop: false,
    layers: [{ bank: 'sfx', streams: [857, 859, 861, 862, 863, 864, 865, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 858] }] },
  // moonbase.lua OnRepaired → dontstarve.fev sounddefs 2380 / 2354 / 2319, three simultaneous layers.
  'dontstarve/common/together/moonbase/repair': { bank: 'wilson', streams: [124], loop: false,
    layers: [{ bank: 'sfx', streams: [846, 857, 859, 860, 861, 862, 863, 864, 865, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 858] },
      { bank: 'sfx', streams: [1274] }] },
  // positronbeam.lua → FEV defs 2154–2156 (same file, adjacent intensity bands) + 2344.
  // FEV layer 1 volume envelope, EPRP points 357–359; layer 0 has no envelope.
  'dontstarve/common/together/moonbase/beam': { bank: 'sfx', streams: [790], loop: true,
    layers: [{ bank: 'sfx', streams: [794] }],
    intensity: [null, [[0, .63589698], [.526735, .702564], [.69965899, 1]]] },
  'dontstarve/common/together/moonbase/beam_level_up': { bank: 'sfx', streams: [792], loop: false },
  'dontstarve/common/together/moonbase/beam_stop': { bank: 'sfx', streams: [795], loop: false },
  'dontstarve/common/together/moonbase/beam_stop_fail': { bank: 'sfx', streams: [793], loop: false },
  // weather.lua StartAmbientRainSound → dontstarve.fev AMB/rain: sounddefs 2019 / 2018 / 2017 are
  // amb_rain_heavy / medium / light_LP (forest_stream file_index 73 / 75 / 74, checked with `-m -s`).
  // `intensity` volume envelopes are EPRP points 6,14,15 (heavy), 6,16,17 (medium) and 3,18,9 (light).
  'dontstarve/AMB/rain': { bank: 'forest_stream', streams: [74], loop: true,
    layers: [{ bank: 'forest_stream', streams: [76] }, { bank: 'forest_stream', streams: [75] }],
    intensity: [[[0, 0], [.404372, 0], [.696721, 1]], [[0, 0], [.342896, 1], [.500662, 1]],
      [[0, 1], [.381457, 1], [.598485, 1]]] },
  // dynamicmusic.lua's Wilson branch: defs 2266 / 2267. Wigfrid's parameter-gated opera layer stays off.
  'dontstarve/music/music_epicfight_moonbase': { bank: 'music', streams: [25], loop: true },
  'dontstarve/music/music_epicfight_moonbase_b': { bank: 'music', streams: [26], loop: true },
  // dontstarve.fev sounddefs 264 / 265: zero-based file_index 59 / 60.
  'dontstarve/common/destroy_metal': { bank: 'common', streams: [60], loop: false },
  'dontstarve/common/destroy_stone': { bank: 'common', streams: [61], loop: false },
  'dontstarve/common/destroy_straw': { bank: 'common', streams: [63], loop: false },
  // butterfly.lua OnWorked → FEV sounddef 183 → zero-based file_index 21–23.
  'dontstarve/common/butterfly_trap': { bank: 'common', streams: [22, 23, 24], loop: false },
  // birdcage.lua → dontstarve.fev sounddefs 307 (bird_wingflap_1..6, birds file_index 25–30) and 1338 (Birdcage_craft, sfx file_index 345).
  'dontstarve/birds/wingflap_cage': { bank: 'birds', streams: [26, 27, 28, 29, 30, 31], loop: false },
  'dontstarve/common/birdcage_craft': { bank: 'sfx', streams: [346], loop: false },
  // birds.lua BIRD_SOUNDS.chirp → sounddefs 304 / 305 / 306 (birds) and 2175 (together canary_chirp_dst_1..12), file_index + 1.
  'dontstarve/birds/chirp_crow': { bank: 'birds', streams: [14, 15, 16], loop: false },
  'dontstarve/birds/chirp_robin': { bank: 'birds', streams: [4, 5, 6], loop: false },
  'dontstarve/birds/chirp_junco': { bank: 'birds', streams: [1, 2, 3], loop: false },
  'dontstarve/birds/chirp_canary': { bank: 'together', streams: [748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759], loop: false },
  // birds.lua BIRD_SOUNDS.death → sounddefs 3171+3170 / 3169+3170 / 3196+3170 (chirp over bird_fall_drop_dead, sfx file_index 126–128)
  // and 2177+1370 (canary_death_2 over canary_cough_dst_4..6, together file_index 762–766).
  'dontstarve/birds/death_crow': { bank: 'birds', streams: [14, 15, 16], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_robin': { bank: 'birds', streams: [4, 5, 6], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_junco': { bank: 'birds', streams: [1, 2, 3], loop: false,
    layers: [{ bank: 'sfx', streams: [127, 128, 129] }] },
  'dontstarve/birds/death_canary': { bank: 'together', streams: [766, 767], loop: false,
    layers: [{ bank: 'together', streams: [763, 764, 765] }] },
  // SGwilson.lua shave → dontstarve.fev sounddef 82 (sfx/wilson/Shave_1..6.wav) → wilson file_index 87–92.
  'dontstarve/wilson/shave_LP': { bank: 'wilson', streams: [88, 89, 90, 91, 92, 93], loop: true },
  // SGwilson.lua toolbroke → dontstarve.fev sounddef 65 (sfx/wilson/Tool_Break.wav) → wilson file_index 93.
  'dontstarve/wilson/use_break': { bank: 'wilson', streams: [94], loop: false },
  'dontstarve/wilson/use_pick_rock': { bank: 'wilson', streams: [124], loop: false },
  // rock_break_fx.lua → dontstarve.fev sounddef 84 → wilson file_index 24 (Stone_break.wav).
  'dontstarve/wilson/rock_break': { bank: 'wilson', streams: [25], loop: false },
  'dontstarve/common/icebox_open': { bank: 'sfx', streams: [383], loop: false },
  'dontstarve/common/icebox_close': { bank: 'sfx', streams: [382], loop: false },
  'dontstarve/wilson/chest_open': { bank: 'wilson', streams: [15], loop: false },
  'dontstarve/wilson/chest_close': { bank: 'wilson', streams: [14], loop: false },
  'dontstarve/wilson/attack_weapon': { bank: 'sfx', streams: [1230, 1231, 1232, 1233], loop: false },
  // SGwilson.lua attack, firestaff → dontstarve.fev sounddef 624 (firestaff_swing_1..4) → sfx file_index 1260–1263.
  'dontstarve/wilson/attack_firestaff': { bank: 'sfx', streams: [1261, 1262, 1263, 1264], loop: false },
  // staff.lua onattack_red → sounddef 625 (fireball_explo.wav) → sfx file_index 1259.
  'dontstarve/wilson/fireball_explo': { bank: 'sfx', streams: [1260], loop: false },
  // SGwilson.lua attack punch / toolpunch → dontstarve.fev sounddef 441 → sfx file_index 1220–1223.
  'dontstarve/wilson/attack_whoosh': { bank: 'sfx', streams: [1221, 1222, 1223, 1224], loop: false },
  // SGwilson.lua attack, "shadow" weapons → sounddef 513 → sfx file_index 1224–1228.
  'dontstarve/wilson/attack_nightsword': { bank: 'sfx', streams: [1225, 1226, 1227, 1228, 1229], loop: false },
  'dontstarve/common/together/reskin_tool': { bank: 'sfx', streams: [827, 828, 829, 830, 831, 832], loop: false },
  'terraria1/skins/spectrepaintbrush': { bank: 'terraria1', streams: [241, 242, 243], loop: false },
  // FEV spawn_vines group: three simultaneous idle layers + one-shot variants.
  'dontstarve/common/together/spawn_vines/spawnportal_idle': { bank: 'sfx', streams: [356], loop: true,
    layers: [{ bank: 'sfx', streams: [357] }, { bank: 'sfx', streams: [358] }] },
  'dontstarve/common/together/spawn_vines/spawnportal_jacob': { bank: 'common', streams: [94, 95, 96], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_spawning': { bank: 'common', streams: [102], loop: true },
  'dontstarve/common/together/spawn_vines/spawnportal_shake': { bank: 'common', streams: [101], loop: false },
  'dontstarve/common/together/spawn_vines/spawnportal_open': { bank: 'common', streams: [97], loop: false },
  // SGwilson.lua book2 → dontstarve.fev sounddefs 1301 / 1280 / 902 (file_index + 1).
  'dontstarve/common/use_book_light': { bank: 'together', streams: [481, 482, 483, 484], loop: false },
  'dontstarve/common/use_book_close': { bank: 'sfx', streams: [347, 348, 349, 350], loop: false },
  // SGwilson.lua play_flute → dontstarve.fev wilson/flute_LP → sounddef 88 → wilson ReedFlute_1..7 (file_index 80–86).
  'dontstarve/wilson/flute_LP': { bank: 'wilson', streams: [81, 82, 83, 84, 85, 86, 87], loop: false },
  'dontstarve/common/book_spell': { bank: 'common', streams: [148], loop: false },
  // books.lua layer_sound / book_fx.lua OnFail → wickerbottom_rework.fev sounddefs 17+23 / 16.
  'wickerbottom_rework/book_spells/silviculture': { bank: 'wickerbottom_rework', streams: [13], loop: false,
    layers: [{ bank: 'wickerbottom_rework', streams: [20] }] },
  // fx.lua fx_book_rain → wickerbottom_rework.fev sounddefs 9 / 20 (file_index 9 / 10 → book_rain_DST, book_rain_sparkle).
  'wickerbottom_rework/book_spells/rain': { bank: 'wickerbottom_rework', streams: [10], loop: false,
    layers: [{ bank: 'wickerbottom_rework', streams: [11] }] },
  // bookstation.lua onbuilt → wickerbottom_rework.fev bookstation/place → sounddef 24 (bookstation_place_DST_v2, file_index 23).
  'wickerbottom_rework/bookstation/place': { bank: 'wickerbottom_rework', streams: [24], loop: false },
  // fx.lua fx_book_moon → wickerbottom_rework.fev book_spells/moon sounddefs 6 / 21 (file_index 7 / 8 → book_moon_DST, book_moon_sparkle).
  'wickerbottom_rework/book_spells/moon': { bank: 'wickerbottom_rework', streams: [8], loop: false,
    layers: [{ bank: 'wickerbottom_rework', streams: [9] }] },
  'wickerbottom_rework/book_spells/fail': { bank: 'wickerbottom_rework', streams: [3], loop: false },
  // SGwilson.lua fishing states → dontstarve.fev sounddefs 232 / 235 / 236 / 233 / 234 / 349 (common file_index + 1).
  // fishingpole_strain is absent from every FEV, so the engine plays nothing for it.
  'dontstarve/common/fishingpole_cast': { bank: 'common', streams: [303, 304, 305], loop: false, volume: .3548133969306946 },
  'dontstarve/common/fishingpole_baitsplash': { bank: 'common', streams: [302], loop: false, volume: .3548133969306946 },
  'dontstarve/common/fishingpole_fishinwater': { bank: 'common', streams: [306, 307, 308], loop: false, volume: .3235936462879181 },
  'dontstarve/common/fishingpole_fishcaught': { bank: 'common', streams: [309, 310, 311], loop: false, volume: .3548133969306946 },
  'dontstarve/common/fishingpole_fishland': { bank: 'common', streams: [312, 313, 314], loop: false, volume: .040738027542829514 },
  'dontstarve/common/fishingpole_lostrod': { bank: 'common', streams: [316], loop: false, volume: .3548133969306946 },
} as const;
export type SoundEventPath = keyof typeof sounds;
export interface SoundHandle {
  stop(): void;
  /** SoundEmitter:PlayingSound for this handle. */
  isPlaying(): boolean;
  /** SoundEmitter:SetVolume, multiplied with overall volume and distance attenuation. */
  setVolume(volume: number): void;
  setParameter?(name: string, value: number): void;
}
export const SOUND_MAX_DISTANCE = TILE_SIZE * 8;
const SOUND_VOLUME = 0.7;

/** Full volume within one tile, inverse-square falloff, then silence at the cutoff. */
export function inverseSquareAttenuation(
  position: Vector3, listenerPosition: Vector3, referenceDistance = TILE_SIZE, maxDistance = SOUND_MAX_DISTANCE,
): number {
  const distanceSquared = position.distanceToSquared(listenerPosition);
  if (distanceSquared >= maxDistance * maxDistance) return 0;
  const referenceSquared = referenceDistance * referenceDistance;
  return referenceSquared / Math.max(referenceSquared, distanceSquared);
}

let context: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer>();
const requests = new Map<string, Promise<AudioBuffer>>();
const playing = new Set<SoundHandle>();
const soundGains = new Map<SoundHandle, { position?: Vector3; gain: GainNode; volume: number }>();
const listener = new Vector3();

function updateGain({ position, gain, volume }: { position?: Vector3; gain: GainNode; volume: number }): void {
  gain.gain.value = SOUND_VOLUME * volume * (position ? inverseSquareAttenuation(position, listener) : 1);
}

/** Call each frame after movement; source positions are retained by reference. */
export function UpdateSoundListener(position: Vector3): void {
  listener.copy(position);
  for (const sound of soundGains.values()) updateGain(sound);
}

function unlock(): void {
  if (context?.state === 'suspended') void context.resume().catch(() => undefined);
}

function getContext(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  if (!context) {
    context = new AudioContext();
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }
  return context;
}

type Envelope = readonly (readonly [number, number])[];

/** Per-layer FEV `intensity` volume envelopes; `null` layers play at constant volume. */
function intensityEnvelopes(path: SoundEventPath): readonly (Envelope | null)[] | undefined {
  const event = sounds[path];
  return 'intensity' in event ? event.intensity : undefined;
}

/** FEV envelope points are linear between neighbours and hold the first/last value outside them. */
function evaluateEnvelope(points: Envelope, x: number): number {
  const next = points.findIndex((point) => point[0] >= x);
  if (next === 0) return points[0][1];
  if (next < 0) return points[points.length - 1][1];
  const [a, b] = [points[next - 1], points[next]];
  return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
}

function soundLayers(path: SoundEventPath): string[][] {
  const event = sounds[path];
  const layers = [event, ...('layers' in event ? event.layers : [])];
  return layers.map((layer) => layer.streams.map((stream) => `${layer.bank}.fsb-${stream}.wav`));
}

function loadSound(filename: string, audio: AudioContext): Promise<AudioBuffer> {
  let request = requests.get(filename);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}dst/data/sound/${filename}`);
      if (!response.ok) throw new Error(`Unable to load ${filename}: ${response.status}`);
      const buffer = await audio.decodeAudioData(await response.arrayBuffer());
      if (audio === context) buffers.set(filename, buffer);
      return buffer;
    })();
    requests.set(filename, request);
    void request.catch(() => { if (requests.get(filename) === request) requests.delete(filename); });
  }
  return request;
}

export async function PreloadSounds(...paths: SoundEventPath[]): Promise<void> {
  const audio = getContext();
  if (!audio) return;
  await Promise.all(paths.flatMap((path) => soundLayers(path).flat()).map((filename) => loadSound(filename, audio).catch((error: unknown) => {
    if (audio === context) console.warn(`Unable to prepare ${filename}`, error);
  })));
}

/** Optional ground position enables distance attenuation; all sounds use the overall volume multiplier. */
export function PlaySound(path: SoundEventPath, position?: Vector3, offsetSeconds = 0): SoundHandle {
  const audio = getContext();
  const filenames = soundLayers(path).map((files) => files.length === 1 ? files[0] : files[Math.floor(Math.random() * files.length)]);
  const sources = new Set<AudioBufferSourceNode>();
  const layerGains: GainNode[] = [];
  const envelopes = intensityEnvelopes(path);
  let remaining = filenames.length;
  let stopped = false;
  const gain = audio?.createGain();
  const definition = sounds[path];
  const eventVolume = 'volume' in definition ? definition.volume : 1;
  const sound = gain ? { position, gain, volume: eventVolume } : undefined;
  const handle: SoundHandle = {
    isPlaying: () => !stopped && audio !== undefined,
    setVolume(volume) {
      if (!Number.isFinite(volume) || volume < 0) throw new RangeError('Invalid sound volume');
      if (!sound) return;
      sound.volume = volume * eventVolume;
      updateGain(sound);
    },
    setParameter(name, value) {
      if (!Number.isFinite(value)) throw new RangeError('Invalid sound parameter');
      if (name !== 'intensity' || !envelopes) return;
      const x = Math.max(0, Math.min(1, value));
      envelopes.forEach((points, index) => { if (points && layerGains[index]) layerGains[index].gain.value = evaluateEnvelope(points, x); });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      playing.delete(handle);
      soundGains.delete(handle);
      for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
      sources.clear();
      for (const layer of layerGains) layer.disconnect();
      gain?.disconnect();
    },
  };
  if (!audio) return handle;
  playing.add(handle);
  if (gain && sound) {
    soundGains.set(handle, sound);
    updateGain(sound);
    gain.connect(audio.destination);
  }
  const start = (buffer: AudioBuffer, layerIndex: number) => {
    if (stopped || audio !== context) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = sounds[path].loop;
    const event = sounds[path];
    if ('pitchOctaves' in event && event.pitchOctaves !== 0) source.playbackRate.value = 2 ** event.pitchOctaves;
    source.connect(layerGains[layerIndex] ?? gain!);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (--remaining === 0) {
        stopped = true;
        playing.delete(handle);
        soundGains.delete(handle);
        gain?.disconnect();
        for (const layer of layerGains) layer.disconnect();
      }
    };
    if (offsetSeconds > 0 && buffer.duration > 0) source.start(0, offsetSeconds % buffer.duration);
    else source.start();
  };
  if (envelopes) {
    for (let i = 0; i < filenames.length; i++) { const layer = audio.createGain(); layer.connect(gain!); layerGains.push(layer); }
    handle.setParameter?.('intensity', 0);
  }
  for (const [layerIndex, filename] of filenames.entries()) {
    const buffer = buffers.get(filename);
    if (buffer) start(buffer, layerIndex);
    else void loadSound(filename, audio).then(buffer => start(buffer, layerIndex)).catch((error: unknown) => {
      handle.stop();
      if (audio === context) console.warn(`Unable to play ${path}`, error);
    });
  }
  return handle;
}

/** Release the shared audio service when the game is closed. */
export function DisposeSounds(): void {
  for (const sound of playing) sound.stop();
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  }
  void context?.close().catch(() => undefined);
  context = undefined;
  buffers.clear();
  requests.clear();
  listener.set(0, 0, 0);
}
