/* ============================================================
   六弦工坊 V4.1 · 头像徽标（移植自 GuitarPicker cosmetics）
   ------------------------------------------------------------
   Play HUD 左上角的演奏者头像徽标。宿主不移植整套 Locker 装扮系统，
   这里用默认装扮渲染，保证 HUD 版式与 GuitarPicker 一致。
   ============================================================ */
'use strict';
import { composeAvatar, DEFAULT_AVATAR } from './avatars.js';
import { getVar } from './components.js';

export function renderAvatar(loadout) {
  let accent = '#6ea8fe';
  try { accent = getVar('--accent') || accent; } catch (e) { /* 无 DOM 环境用默认色 */ }
  try { return composeAvatar(loadout || DEFAULT_AVATAR, accent); }
  catch (e) { return ''; }
}

export { DEFAULT_AVATAR };
export default renderAvatar;
