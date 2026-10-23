# 六弦工坊（guitar-studio）只读代码审查报告

审查方式：逐行通读 main.js、core/ 10 个文件、modules/ 9 个文件、data/ 3 个文件、i18n/ 4 个语言文件，并用 app.html（993 行）逐一核对全部 `$('#id')` / `data-*` 属性；对怀疑点用 Node ESM 沙箱（区分 `window===globalThis` 的浏览器语义）、Tone v15.8.6 vendor 源码、脚本化 DOM id / 字典键交叉比对。所有结论均回读磁盘当前文件复核（审查中发现部分疑点已被现有修复覆盖，已剔除）。

项目已经过多轮修复（P0-02/P0-03、P1-1、P1-3、P1-4、P1-8、P2-2、P2-6、P2-12、P2-13、P2-15、P2-16、P2-19、P2-20、BUG-02/04/08、Fix-3/6/7/9/10、RT-005/006/011 等均在代码中可见并有针对性注释）。以下是本轮确认仍存在的缺陷。

---

## P0 / P1

**未发现 P0 或 P1 级别的确定性缺陷。** 主路径（调音器、节拍器、节奏型、闯关、音阶、录音、Tone/原生双后端）的空指针、资源释放、跨上下文静音、定时器漂移等高危点均已有对应修复且经回读确认生效。

---

## P2（边界 / 健壮性 / 竞态），共 5 条

### Bug 1 — Mic 单例在「权限弹窗未决」时并发调用，泄漏一路麦克风流 + AudioContext + rAF
- **文件/行号**：`assets/js/core/audio-engine.js:140-176`（Mic.start，无在途承诺守卫，第 144 行只判断 `this.stream`）；调用点 `modules/tuner.js:95-98`、`modules/scale.js:170-177`、`modules/chord-game.js:42-47`
- **触发条件**：浏览器弹出麦克风权限选择框（`getUserMedia` 的 await 未决）期间再次点击开启按钮：
  - 调音器：`toggle()` 为 async，`this.active` 在 `await Mic.start(...)` 返回后才置 true（tuner.js:96-98），按钮文案虽变为「正在请求麦克风…」但未 disabled，弹窗期间再点一次会第二次进入开启分支；
  - 音阶跟弹：`this.mic` 在 await 之后才赋值（scale.js:173-174），同一按钮快速点两次即并发；
  - 闯关 `startRound` 同理（chord-game.js:44-46）。
- **代码证据**：
  ```js
  async start(onPitch){
    this.cb = onPitch;
    if(this.stream) return true;          // 只防「已 resolve」，防不住「请求在途」
    ...
    this.stream = await navigator.mediaDevices.getUserMedia({...}); // 两次并发调用
    ...
    this.micCtx = new AC();               // 第二次 resolve 覆盖：第一个 micCtx 泄漏（无 close）
    ...
    const loop=()=>{ this.raf=requestAnimationFrame(loop); ... };  // 第一个 rAF id 丢失（无 cancel）
    loop();
  }
  ```
  第一次 getUserMedia 若为首次会弹权限框（在途）；第二次并发调用在 Chrome/Edge 上（同文档同约束）通常直接排队/复用，但在权限已授予的场景（例如用户此前已允许、本次只是设备初始化慢，或 Safari 对重复申请返回独立流）会拿到**第二条 MediaStream**。两个 await 依次 resolve 后，第二次赋值覆盖 `stream/micCtx/analyser/raf`：第一条流的 tracks 永不 stop（麦灯常亮）、第一个 micCtx 不 close、第一个 rAF 的帧 id 丢失（`Mic.stop()` 180 行只能 cancel 最新的一个 id），双路 30fps 的 PitchDetect 持续占 CPU，直到页面卸载。
- **最小修复方向**：在途承诺复用——
  `this._starting ||= navigator.mediaDevices.getUserMedia({...}).then(stream=>{ this.stream=stream; /* 只建一套 micCtx/analyser/rAF */ return true; }).catch(e=>{...; return false;}).finally(()=>{this._starting=null;});`，并 `return this._starting`；三个调用方在 await 期间 disable 按钮。

### Bug 2 — 节奏型「手动停止」时完成循环数恒记 1（stop 先清零 loopDone 再统计）
- **文件/行号**：`assets/js/modules/rhythm.js:348-357`
- **触发条件**：循环次数选 2/4/8，播放超过 2 个完整循环后，直接点停止（`stop(true)` 记录统计，342-345 行）；查看「上次会话」记录里的「完成 N 遍」与累计循环数。
- **代码证据**：
  ```js
  stop(record){
    ...
    this.phase='idle'; this.loopDone=0; this.pausedElapsed=0;   // 第 353 行：先清零
    ...
    if(wasPlaying&&record) this._finishSession();               // 第 357 行：统计在后
  }
  _finishSession(loopsArg){
    const loops=Math.max(1,loopsArg||this.loopDone||1);          // 第 513 行：读到 0→1
  ```
  调度器运行时正确维护 `this.loopDone`（430-431 行），实时状态文案（467-470 行）显示也正确；但**自然结束**路径已有 P2-13 修复（`_finish` 496-502 行先快照 `finishedLoops` 再清零再传参），唯独**手动停止**路径仍沿用旧顺序，导致选 4 遍走了 3 遍手动停，记录恒为 1 遍，累计「完成循环」偏小。
- **最小修复方向**：与 `_finish` 对齐——
  `const finishedLoops=Math.max(1,this.loopDone||1);` 放在清零之前，然后 `this._finishSession(finishedLoops)`。

### Bug 3 — 录音器「停止→立即重录」时，旧 onstop 异步回调会释放新录音的资源（录音中断 + 按钮假死 + 上一条丢失）
- **文件/行号**：`assets/js/modules/recorder.js:23-48`（toggle 覆盖共享字段）、`51-67`（onstop 无条件操作共享字段并 `_release()`）、`119-139`（stop 异步等 onstop，不清引用）
- **触发条件**：录音中点一次停止，在 MediaRecorder 的 `onstop` 事件派发前（异步，通常数毫秒；设备忙/GC 时可更久）立刻再点一次按钮开始新录音。
- **代码证据**：
  ```js
  this.rec.onstop=()=>{
    try{
      const blob=new Blob(this.chunks,{...});   // this.chunks 已被新一轮 toggle 第 48 行 this.chunks=[] 清空
      ... this.items.unshift(item); this.render();
    }finally{ this._release(); }                 // 释放的是「当前」this.stream/this.ac/this.rec —— 新录音那套
  };
  ```
  `stop()` 正常路径故意不立即清引用（130 行注释「onstop 会异步执行 _release」）。若旧 onstop 在新 `toggle()` 完成 getUserMedia/建 rec 之后才派发：
  1. 旧 onstop 用空 chunks 生成一条 0 数据录音项，**上一条真实录音丢失**；
  2. `_release()` 停掉**新 stream**、关掉**新 AudioContext**（`this.ac=null`）、`this.rec=null`——新 MediaRecorder 因流被停而 onerror，录音实际中断，电平 rAF 因 analyser=null 停转；
  3. 按钮外观停在「录音中」（95-100 行开始时已切），但再点一次时 `this.rec` 已是 null，走的是新建流程——表现为 UI 状态与真实状态错位，需要多次点击才能恢复。
- **最小修复方向**：给每次会话递增 token，onstop 闭包捕获 `const my=this._session, rec=this.rec, chunks=this.chunks, ac=this.ac, stream=this.stream`；回调开头 `if(my!==this._session){ /* 仅保存旧批次自身的 chunks 项，不碰当前资源 */ return; }`；或 `stop()` 在 onstop resolve 前 disable 录音按钮。

### Bug 4 — 主题面板首次打开时，非中文用户看到中文主题名（gsLang 不从持久化偏好初始化）
- **文件/行号**：`assets/js/core/theme-switch.js:61-62`（读取 gsLang）、`77-78`（硬编码初值，仅靠 gs:lang 事件更新）
- **触发条件**：`gs.prefs.lang` 已是 `en/ja/ko`（之前在 i18n 面板切过语言并写入 localStorage），刷新页面后不经过任何语言切换直接打开主题面板。
- **代码证据**：
  ```js
  ${THEMES.map(t => chip(t.key, t.name[gsLang] || t.key)).join('')}
  ...
  let gsLang = 'zh-CN';                                        // 刷新后恒为中文
  document.addEventListener('gs:lang', e=>{ gsLang=...; });   // 初始 setLang 在本文件之前执行，事件不会重放
  ```
  i18n 当前语言取自 `store.read().lang`（core/i18n.js），页面加载不再派发 `gs:lang`，英文用户首开面板看到「霓虹暗夜 / 晨曦浅色」；手动切一次语言后才恢复正确。
- **最小修复方向**：该文件已 import store，初值改为 `let gsLang = store.read().lang || 'zh-CN';`。

### Bug 5 — 未知 hash 路由内容区全空白，无回退/提示
- **文件/行号**：`assets/js/core/router.js:13-25`
- **触发条件**：手输或打开外链 `#/foobar`、`#/rhyth`（拼错）。
- **代码证据**：
  ```js
  $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+route)); // 无任何命中→主体全隐藏
  $('#topbarTitle').textContent = ROUTE_TITLES[route]||'六弦工坊';
  if(onRouteEnter[route]) onRouteEnter[route]();                              // 无初始化
  ```
  顶栏、底部导航仍在（用户可点导航恢复，非死页），但 `#views` 主体空白且无提示。
- **最小修复方向**：无 `.view` 命中时 `location.hash='#/home'` 并 return（或激活 view-home + toast「页面不存在」）。

---

## 重点复核后排除的疑点（不计入统计，附依据）

1. **chord-game 完成和弦后 750ms 定时器退出仍触发**：已修复——chord-game.js:183 `this.doneTimer=setTimeout(...)`，`stopMic()` 209 行 `clearTimeout(this.doneTimer)` 成对清理。
2. **节奏型自然结束循环数恒记 1**：已由 P2-13 修复（rhythm.js:496-502 先快照 `finishedLoops`、清零后再传参）；仅手动停止路径漏同样处理（即 Bug 2）。
3. **AudioEngine 异步接管 Tone 上下文导致早期声部静音**：audio-engine.js:38-57 的 P1-1 修复保留旧 master→旧 destination 输出并双挂接新 master，demoGain 等早期节点不悬空。
4. **Transport（Tone 后端）stop/start 后 scheduleRepeat 重复叠加**：`scheduleRepeat` 仅在 `init()` 的 `backend!=='none'` 幂等守卫内注册一次；已在 vendor（Tone v15.8.6）源码确认 RepeatEvent 存于 `_repeatedEvents`，Transport stop/start 只停/恢复时钟并把 tick 归零，同一回调跨周期复用；metro tick 有 `if(!this.playing) return` 门控。
5. **节拍器原生回退 swing 失效（一度怀疑）**：逐行对齐 transport.js:121-126 排除——native tick 的 time 是 `_nextTime` 绝对 ctx 时间；metro `_hit(when)` 内 `AudioEngine.click(strong, time-ctx.currentTime)` 经 click 内 `currentTime+when` 还原到摇摆时刻；细分振荡器 `setValueAtTime/start(time)` 直接吃绝对时间也正确，两条路径均消费 swing 偏移。
6. **ESM 顶层裸引用跨模块标识符会 ReferenceError**：浏览器中 `window===globalThis`，`Object.assign(window,…)`/`window.X=` 挂出的属性可被裸标识符解析（用 `globalThis.window=globalThis` 的 Node ESM 沙箱实测确认）。
7. **渐快训练 total=trainerBars×beats 对 3/4、6/8 拍数不对**：beats 即每小节拍数（2/3/4/6），_trainerTick 每拍推进，乘积正是总拍数。
8. **recorder 扩展名错配 / 构造失败泄漏 stream / 删最后一条 DOM 残留**：分别由 P2-12（按 rec.mimeType 定 ext）、P1-3（try/catch + 幂等 _release）、P1-07（空列表清空容器）修复并回读在位。
9. **练耳切模式定时器串题、指板相邻同题、切模式记分残留、HTTP 明文崩溃、Game 超时/跳过卡题、Rhythm 播放中调速错位/挂起态卡转圈**：P2-6、P1-4、P2-16、P0-03(micGuard)、P0-03(skipChord)、RT-005/006/011 均在位且逻辑闭环。
10. **DOM id / data-* 不匹配**：脚本全量比对 JS 引用的 120+ 个 id 与 app.html，无静态缺失；`playStrum/playArpeggio/lhSwitch` 由 chord-lib `select()` 动态 innerHTML 创建后立即绑定。
11. **i18n 词条缺失**：zh/en/ja/ko 四份 DICT 键集合脚本比对完全一致；app.html 全部 data-i18n 键均在字典内。
12. **`accent?.42:.28` 语法错误**：合法（可选链 + 冒号表达式），accent=false 时值为 0.28。
13. **localStorage JSON 解析崩溃**：store.js、rhythm.js 的读取均有 try/catch 降级。
14. **Mic.stop 误关播放上下文**：BUG-04 使用独立 micCtx 字段，与 AudioEngine.ctx 分离。

---

## 结论

本轮共发现 **5 条确定缺陷：P0 0 条、P1 0 条、P2 5 条**。

| # | 级别 | 文件:行 | 摘要 |
|---|------|---------|------|
| 1 | P2 | core/audio-engine.js:140-176 | getUserMedia 在途无承诺复用：并发申请泄漏 stream/AudioContext/rAF，麦灯常亮 |
| 2 | P2 | modules/rhythm.js:348-357 | 手动停止先清零 loopDone 再统计，完成循环数恒记 1（自然结束路径已修） |
| 3 | P2 | modules/recorder.js:51-67,23-48 | 停止后立即重录，旧 onstop 误释放新录音资源：录音中断、UI 假死、上一条丢失 |
| 4 | P2 | core/theme-switch.js:61-62,77-78 | gsLang 不从 store 初始化，刷新后首开主题面板非中文显示中文名 |
| 5 | P2 | core/router.js:13-25 | 未知 hash 无 404 回退，内容区全空白 |

共性：3 条（Bug 1/3）属同一类**异步竞态**——在途 Promise / 异步事件回调与用户快速操作交错时缺少会话标识与句柄管理；Bug 2 是**状态重置先于统计快照**（与已修的自然结束路径同源，照 P2-13 模式补齐即可）；Bug 4/5 是**初始化来源/边界回退**缺失。核心功能与算法扎实，建议优先 Bug 1（系统资源泄漏）和 Bug 3（用户数据丢失+状态错乱）。
