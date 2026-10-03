/** Standing, built-in commands from scripts/emotes.lua (mounted-only pets excluded). */
export const WILSON_EMOTES = {
  wave: { label: '挥手', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_waving1'], ['emoteXL_waving2'], ['emoteXL_waving3']] },
  rude: { label: '挑衅', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_waving4']] },
  happy: { label: '欢呼', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_happycheer']] },
  angry: { label: '生气', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_angry']] },
  cry: { label: '哭泣', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_sad']] },
  no: { label: '摇头', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_annoyed']] },
  joy: { label: '开心', group: 'emotion', archive: 'player_actions.zip', variants: [['research']] },
  kiss: { label: '飞吻', group: 'emotion', archive: 'player_emotesxl.zip', variants: [['emoteXL_kiss']] },
  dance: { label: '跳舞', group: 'action', archive: 'player_emotes_dance0.zip', variants: [['emoteXL_pre_dance0', 'emoteXL_loop_dance0']], loop: true },
  sit: { label: '坐下', group: 'action', archive: 'player_emotes_sit.zip', variants: [['emote_pre_sit2', 'emote_loop_sit2'], ['emote_pre_sit4', 'emote_loop_sit4']], loop: true },
  squat: { label: '蹲下', group: 'action', archive: 'player_emotes_sit.zip', variants: [['emote_pre_sit1', 'emote_loop_sit1'], ['emote_pre_sit3', 'emote_loop_sit3']], loop: true },
  bonesaw: { label: '准备战斗', group: 'action', archive: 'player_emotesxl.zip', variants: [['emoteXL_bonesaw']] },
  facepalm: { label: '捂脸', group: 'action', archive: 'player_emotesxl.zip', variants: [['emoteXL_facepalm']] },
  pose: { label: '摆姿势', group: 'action', archive: 'player_emotes.zip', variants: [['emote_strikepose']] },
  toast: { label: '干杯', group: 'action', archive: 'player_emote_extra.zip', variants: [['emote_pre_toast', 'emote_loop_toast']], loop: true, props: true },
} as const satisfies Record<string, WilsonEmoteDefinition>;

export type WilsonEmote = keyof typeof WILSON_EMOTES;
export type EmoteGroup = 'emotion' | 'action';
export interface WilsonEmoteDefinition {
  readonly label: string;
  readonly group: EmoteGroup;
  readonly archive: string;
  readonly variants: readonly (readonly string[])[];
  readonly loop?: boolean;
  readonly props?: boolean;
}
