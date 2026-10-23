/* ============================================================
   六弦工坊 V3 · 音阶数据 data/scales
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   模块 8：音阶练习（指板高亮 + 跟听示范 + 麦克风逐音跟弹）
   ============================================================ */
const SCALE_TYPES = {
  major:     {name:'大调',     iv:[0,2,4,5,7,9,11]},
  minor:     {name:'自然小调', iv:[0,2,3,5,7,8,10]},
  majorPent: {name:'大调五声', iv:[0,2,4,7,9]},
  minorPent: {name:'小调五声', iv:[0,3,5,7,10]},
  blues:     {name:'布鲁斯',   iv:[0,3,5,6,7,10]},
  dorian:    {name:'多利亚',   iv:[0,2,3,5,7,9,10]}
};
const SCALE_LIST = [
  {root:'C',type:'major',pos:0},
  {root:'G',type:'major',pos:0},
  {root:'D',type:'major',pos:0},
  {root:'A',type:'minor',pos:0},
  {root:'E',type:'minor',pos:0},
  {root:'C',type:'majorPent',pos:0},
  {root:'A',type:'minorPent',pos:0},
  {root:'A',type:'blues',pos:0},
  {root:'A',type:'minorPent',pos:5},
  {root:'E',type:'minorPent',pos:5},
  {root:'G',type:'major',pos:5},
  {root:'A',type:'dorian',pos:5}
];

Object.assign(window, { SCALE_TYPES, SCALE_LIST });
export { SCALE_TYPES, SCALE_LIST };
