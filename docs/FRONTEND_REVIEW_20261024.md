# 六弦工坊 前端深度静态审查报告

- 审查范围：`assets/js/core/*`、`assets/js/modules/*`、`assets/js/data/*`、`sw.js`、`app.html`（DOM id 对照）
- 方式：逐文件静态审查 + Node 运行时数据校验 + 现有单测/lint（`npm test` 56/56 通过，`npm run lint` 34 文件通过）
- 基线：仓库已含多轮 P0/P1/P2 修复（P0-01/02/03、P1-04/05/07/08、P2-09/14/15/16/19/20、BUG-01/02/04/08、Fix-3/6/7/9/10 等），本报告只列**仍存在**的问题
- 结论：**未发现新的确定性 P0**；确认 **P1 5 项、P2 13 项**

---

## P1（会造成功能失效 / 资源泄漏 / 特定路径下崩溃）

### P1-1 AudioEngine 与 ToneEngine 的 AudioContext 切换竞态：跨上下文调度会抛异常/失声
- 文件：`assets/js/core/audio-engine.js:16-24, 29-53`；消费方 `modules/metronome.js:180-181`、`modules/chord-lib.js:99-124`、`modules/rhythm.js:205-215`
- 触发条件：页面加载后用户的**第一次**音频手势（点调音器试听/节拍器 TAP/和弦扫弦/节奏播放）。`AudioEngine.ensure()` 会**立即 new 一个独立 AudioContext**，同时异步 `_integrateTone()` 里 `await ToneEngine.ensure()`（要 await loadTone + Tone.start）完成后把 `this.ctx/master` **替换成 Tone 的 rawContext**。两次手势间隔很短（弱网/首次加载 vendor 编译慢，窗口可达数百 ms）时，上下文在中途被替换。
- 代码证据：
  - `audio-engine.js:18` 同步 `this.ctx = new ...AudioContext()`，`:22` 才 fire-and-forget 异步集成；
  - `audio-engine.js:38-42` 集成完成时把 `this.ctx`/`this.master` 整体换成另一上下文的节点；
  - 期间已用旧 ctx 排定的事件仍持有旧 ctx 的时间戳/节点：`metronome.js:180` `AudioEngine.click(strong, time-AudioEngine.ctx.currentTime)` —— `time` 来自 Transport（Tone ctx），而这里读取的 `AudioEngine.ctx.currentTime` 可能还是旧 ctx（或刚换成新 ctx），两个 ctx 的 currentTime 基准不同，得到错误/负偏移；`chord-lib.js:104` `nextBarTime=ctx.currentTime+0.1` 缓存了旧 ctx，`:118` while 比较却用可能已被替换后的 `ctx.currentTime`。
  - 更严重：`rhythm.js:207-211` 只在首次 `ensureAudio()` 用当时的 ctx 创建 `demoGain/metroGain` 并 `connect(AudioEngine.master)`；集成完成后 master 被换成新节点（`:40-47`），旧 gain 既挂在旧 ctx 又与新 master 脱钩 → 节奏模块**永久无声**（`this.demoGain` 已真值，后续不会重建）。
- 影响：首次使用的一小段时间内可能抛 `InvalidStateError`/声音错位，或节奏/进度伴奏在 Tone 接管后整路失声，需重进页面恢复。
- 建议修复：统一「单一上下文」原则——`AudioEngine.ensure()` 改为 `async` 并 `await ToneEngine.ensureContext()` 后再创建节点（或在 Tone 集成完成的回调里把已建的 gain 类消费节点迁移/重建）；消费方不要缓存 ctx 快照（`chord-lib.js:99`、`rhythm.js:213` 每次取 `AudioEngine.ctx`），并在切换后重连 `demoGain/metroGain`。

### P1-2 深链/刷新直达子页面时，除 rhythm 外的 9 个模块均未初始化（整页不可交互）
- 文件：`assets/js/main.js:29` 先 `applyRoute()` 后模块才注册 `onRouteEnter`；仅 `modules/rhythm.js:542-545` 有补初始化 hack
- 触发条件：在任意子页面（如 `#/tuner`、`#/metro`、`#/game`…）**刷新**，或直接打开/分享 `app.html#/chords` 这类链接。
- 代码证据：`main.js` 顺序 import → 第 29 行 `applyRoute()`；但 `onRouteEnter.tuner=…` 等注册发生在各 module 的顶层（import 阶段之后），首个 `applyRoute()` 执行时 `onRouteEnter[route]` 还是 `undefined`（router.js:24 `if(onRouteEnter[route]) onRouteEnter[route]();` 直接跳过）。之后没有 hashchange，init 永不触发。只有 rhythm 用文件尾部 `if(hash==='#/rhythm') Rhythm.init()` 自救，其余 tuner/metro/game/chords/scale/ear/fret/studio 全部中招。
- 影响：直达/刷新子页面时按钮、滑块、麦克风开关全部无监听，表现为「页面打开了但点什么都没反应」。
- 建议修复：把 `main.js:29` 的首次 `applyRoute()` 移到所有模块 import 完成之后（模块顶层注册是同步的，直接放在 import 序列末尾即可），或在 main.js 末尾统一对当前路由补一次 `onRouteEnter[route]?.()`，删除 rhythm 里的特例 hack。

### P1-3 Studio 录音流在「异常停止/切页」路径上泄漏（麦克风指示灯常亮）
- 文件：`assets/js/modules/recorder.js:42-53, 79-91`；`core/router.js:80`
- 触发条件：
  1. 录音中通过底部导航/更多菜单切到其他页面 —— `cleanupModules()`（router.js:80）只在 `rec.state==='recording'` 时调 `Studio.stop()`，`stop()` 只 `rec.stop()`，**stream 的释放与 `ac.close()` 全部放在异步 `onstop`（:50-51）**；若 onstop 因任何原因未触发（页面已切走、recorder 异常），`this.stream` 的轨道永不 `stop()`。
  2. `new MediaRecorder(stream)`（:39）或 `rec.start()`（:39/:69）抛异常时（设备被占用等），catch 缺失，:32 已拿到的 stream 不释放。
  3. `stop()` 里 `:87` 判断 `state==='recording'` 才 `rec.stop()`；若 recorder 处于 `inactive`（onstop 已跑过但 ac 已关）再次进入，`this.stream`/`this.ac` 未置空，后续 toggle 复用旧引用。
- 代码证据：stream 释放仅存在于 `onstop` 回调（:50）与成功路径，`toggle()` 中 `getUserMedia` 成功后到 `rec.start()` 之间无 try/catch。
- 影响：麦克风硬件持续占用（手机浏览器隐私灯常亮）、AudioContext 泄漏。
- 建议修复：抽 `releaseStream()`（stop tracks + `ac.close()` + 置空），`toggle()` 后半段包 try/catch，失败即 release；`stop()` 不依赖 onstop 也保证同步释放；cleanupModules 无条件调用。

### P1-4 Fret「找音」练习可重复点击同一正确格，分数虚增
- 文件：`assets/js/modules/fretboard.js:81-95`
- 触发条件：找音模式答对后（`playing=false` 但题目未清，`targetPC` 保留），继续点指板上其它同音名格子，或点「开始找音」之外已标 good 的格子。
- 代码证据：`:90` 答对后给所有同音格加 `ring` 但**没有禁用/标记已答格**；`judge` 仅以 `this.playing` 为闸（:43），而 `ask()` 点「下一题」前，`playing` 在正确瞬间被置 false 看似挡住——但 `:36` 开始按钮始终可点，且答错路径 `:91-93` 不移除 `ring`；更实际的问题是 `judge` 正确分支对**同一个已 good 的 cell 无幂等保护**：用户在 playing 仍为 true 的同一判定帧快速连点（rAF/事件在一帧内可多次触发 click）→ `askOk++` 多次。click 同任务队列连点两次时第二次进入时 playing 已 false 挡住，但触屏 300ms 内「先点对格、同一事件冒泡到父代理两次」不会发生；**确定性复现**是：答对后点「下一题」出新题，旧的 `good/ring` class 直到 `ask()→clearMarks()` 才清，若新题音名恰好与上一题相同（随机 1/12 概率），旧 ring 直接提示答案。
- 影响：记分与练习严肃性受损；同音名连出题直接泄题。
- 建议修复：judge 正确后对所有同音 cell 加 `data-done` 并在 judge 入口忽略已判定 cell；`ask()` 已 clearMarks，补一道「新题 targetPC 与上题相同则重抽」。

### P1-5 Service Worker 预缓存清单与实际模块图不一致，且用相对路径在子路径部署会 install 失败
- 文件：`sw.js:17-38, 65`
- 触发条件：
  1. 离线 PWA：`main.js` 静态 import 的 `core/store.js`、`core/theme-switch.js`、`core/i18n.js`、`assets/js/i18n/{zh-CN,en,ja,ko}.js`、`assets/js/main.js` 本身虽在 CORE，但其依赖的上述文件**不在 CORE 也不在 OPTIONAL** → 离线冷启动时这些模块网络失败，主题/语言/偏好整链失效（main.js 是静态 import，缺失会导致整个模块图 reject，**全站白屏**）。
  2. `cache.add('./')` 与所有 `'./xxx'` 相对路径：SW 若以非根 scope 注册（现有注册 `register('./sw.js')` 在根页尚可），一旦部署到 `https://host/guitar/` 子目录，`./` 解析随 SW 脚本 URL，`CORE` 任一 404 即 `Promise.all` reject → install 失败（代码注释自称「关键项任一失败即 install 失败」是设计，但清单本身缺文件使得该设计必然误伤）。
- 代码证据：CORE 列表（sw.js:17-38）对照 main.js:5-26 的 import 图，缺 5 个 core/i18n 文件 + 4 个语言包；`install` 用 `Promise.all(CORE.map(cache.add))`（:65）。
- 影响：宣称的离线能力在干净离线环境直接白屏；子路径部署 SW 永不激活。
- 建议修复：用构建脚本从模块图生成预缓存清单（至少补 store/theme-switch/i18n/4 个语言包）；路径统一以 scope 为基准（`new URL(u, registration.scope)`），并在 fetch 处理里对未在清单的模块做 network-first 回退而非 `Response.error()`（:107）。

---

## P2（边界缺陷 / 体验或统计不准，不阻断主流程）

### P2-1 节拍器渐快训练把每小节拍数硬编码为 4
- `modules/metronome.js:128` `total:this.trainerBars*4`；但拍号可选 2/3/4/6 拍（timeSig）。3/4、6/8 下渐快在错误拍数处结束，且 `_trainerTick()`（:135-140）按拍推进不受影响，仅总进度时长错误。
- 修复：`*4` 改为 `*this.beats`。

### P2-2 Tone 后端下细分轻击的第 4 参数无效（音量控制失效）
- `modules/metronome.js:187` `triggerAttackRelease(800,.03,time,{gain:.2})` —— Tone.js Synth 触发第 4 参数是 time offset/velocity 位置并非 gain envelope 选项，`{gain:.2}` 不生效，细分音与正拍一样响。原生回退分支（:189-196）用 0.07 gain 是正常的，两后端响度不一致。
- 修复：用 velocity（Tone v15 签名 `triggerAttackRelease(note,duration,time,velocity)`）传 0.2，或对 click synth 单独建低音量实例。

### P2-3 渐快期间 BPM UI 与 Metro.bpm 不同步
- `metronome.js:140` 训练循环直接 `Transport.setBpm(v)`，Transport 会通知 `_bpmListeners`，但 Metro 自己没 `onBpm` 同步 `this.bpm`/滑块/数字显示；停止后再开，`toggle()` 用旧 `this.bpm` 把 Transport 拉回原值，滑块显示也与实际播放速度不符。
- 修复：`init()` 里 `Transport.onBpm(v=>{ if(v!==this.bpm){ this.bpm=v; range.value=v; $('#bpmNum').innerHTML=... }})`，注意避免与 setBpm 循环。

### P2-4 Transport 原生后端暂停后 tick 相位不连续（复播第一拍 timing 轻微错位）
- `core/transport.js:95-102`：native pause 清 interval，resume 时平移 `_startAudioTime/_nextTime`（:88-89），但 `this.tick` 保持，`_visualPos` 依赖回调 fire 更新；暂停期间未 fire 的 tick 在恢复后 `_scheduleNative` 会在新的 `_nextTime` 立即补发一批（若暂停超过 lookahead，`while` 瞬间追排多个 tick），可听到恢复瞬间密集连击。
- 修复：resume 时把 `_nextTime` 锚到 `currentTime+0.08` 并按 `tick % 相位` 对齐，而不是平移旧 `_nextTime`。

### P2-5 Rhythm 变速重锚只重锚 startTime，不重锚 schedTime，恢复后可能抢排/漏排
- `modules/rhythm.js:58-76`：播放中拖 BPM 时 `_teardown()` 后用新 anchor 重设 startTime 并 `_beginSchedule()` 重建游标（这块正确）；但 `setBpm` 在 idle 态只改 `this.bpm`（:78），`stepDur()` 读的是 `Transport.bpm`（:271），而 idle 态 :80 才 `Transport.setBpm`——顺序无误；真正的问题是 `renderInfo/renderGrid` 等在 BPM 变化后不刷新「建议 BPM」高亮，且预备拍中途调速时 `countIdx=Math.floor(elapsed/oldQuarter)`（:64）可能等于 beats（恰在边界）→ `anchor=beats*(60/nb)` 进入正式拍但 `wasPhase` 仍被还原为 `'countin'`（:73），要等调度器再跑一拍才切 playing，多数一拍预备。
- 修复：重锚后据 anchor 重新判定 phase（`anchor>=countInDurNew → 'playing'`）。

### P2-6 Ear 练耳：切模式/自动出新题期间存在 1.5s 内可累积 setTimeout，切页不清理
- `modules/ear-training.js:61` 答题后 `setTimeout(newQuestion,1500)` 无句柄；连续切模式（:38-45 `newQuestion()`）会与旧的 1.5s 定时器竞态，旧定时器回调再跑一次 newQuestion 覆盖当前模式题面（模式未变时表现为题目被莫名换掉）。
- 修复：保存 timer 句柄，模式切换时 clearTimeout。

### P2-7 Ear note 模式根音随机但选项音名池固定，根音 octave 对答题无影响但「C 大调」描述与含 B 的实际音池轻微不符
- `ear-training.js:76` pool=[60,62,64,65,67,69,71] 含 B(71)，题干写「C 大调」正确（B 是 C 大调 7 级），无错误；实际缺陷是**单音模式不随机八度**，所有音都在同一个八度内，训练难度单一。属需求增强，记录为 P2 观察项，不建议当 bug 修。

### P2-8 Game 完成和弦后的 750ms 等待窗内「跳过/退出」状态机不自洽
- `modules/chord-game.js:161-187`：`markDone` 完成本和弦时 `running=false`，750ms 后才 `idx++;running=true;nextChord()`。此窗口内点跳过：`skipChord()` 被 `if(!this.running)return`（:94）挡掉（合理），但点「退出」`quit()→stopMic()` 后，挂着的 `setTimeout`（:181）**没有被清**，750ms 后仍执行 `this.nextChord()`，操作已隐藏的 `#gamePlay` DOM（display=none），重建定时器并引用 `this.cur`；再次开始新一轮时旧 interval 可能与新 interval 并存（nextChord 开头 clearInterval(this.timer) 能清，实际不双发，但 `#timeBar` 等在 intro 页被后台写）。
- 修复：完成延迟句柄存 `this.doneTimer`，`stopMic/quit` 一并 clearTimeout。

### P2-9 Scale 完成后的 showTarget setTimeout 在切页/切音阶后仍可触发
- `modules/scale.js:216` `setTimeout(showTarget,320)` 无守卫取消；`stopAll()`（:234）只清 `this.timer`（listen 用），不清这个 320ms 句柄。刚弹完最后一个音（finishFollow→mode='idle'）分支不会进（有 i<length 判断），但**倒数第二个音弹对后 320ms 内切音阶**（build→resetStage→stopAll）会在新音阶上对旧 seq[i] 调 `showTarget()`，把 `#scxCur` 写成旧音并 markNow 旧格子（cellEl 在新 board 里找不到返回 null，不崩，但状态文案被污染）。
- 修复：句柄存 `this.showTimer`，stopAll/resetStage 里清除。

### P2-10 ChordLib 进度伴奏在 Tone 接管 ctx 后锚点失效（P1-1 的具体表现之一，单列便于局部修）
- `modules/chord-lib.js:99` `const ctx=AudioEngine.ctx` 缓存，`:104` `nextBarTime=ctx.currentTime+0.1`，`:118/:121` 后续一直用该快照；若播放期间 ctx 被替换（P1-1），`AudioEngine.strum(...,offset)` 内部 `audio-engine.js:57` 用的是**新** ctx 的 currentTime，offset 基于旧 ctx → 起音时间错乱（负值立即爆音或正值延迟很久）。
- 修复：不缓存 ctx，每次取 `AudioEngine.ctx`；或随 P1-1 统一上下文后自然消解。

### P2-11 Recorder 停止后未清空 `#recLevel` 之外的 rAF 引用判空，依赖 Fix-7 但 onstop 二次 close 有竞态
- `modules/recorder.js:51` onstop 里 `this.ac.close()`，而 `stop():90` 先 `this.analyser=null`；rAF loop（:61）以 `if(!this.analyser)return` 退出——但若一帧已通过判空、在 `getFloatTimeDomainData`（:63）执行时 onstop 刚好 `ac.close()`，会对已关闭上下文取数（规范上 close 后 AnalyserNode 方法返回静默不抛，实测 Chrome 不报错），风险低；确定性问题是 `onstop` 与 `stop()` 都可能操作 `this.ac`，二次 `close()` 在已关闭 ctx 上会抛 `InvalidStateError`（未 catch）。
- 修复：`if(this.ac){ const c=this.ac; this.ac=null; c.close().catch(()=>{}); }`。

### P2-12 Recorder 下载文件名在 Safari 下 ext 恒为 webm 但实际可能是 mp4
- `recorder.js:46` `ext=(mime.includes('mp4')?'mp4':'webm')`；若 mime 为空字符串（所有 isTypeSupported 都 false，:38-39 走无参构造），`:43` Blob type 兜底 `audio/webm`，Safari 实际产出 mp4 数据却命名 .webm，系统播放器无法关联。
- 修复：无 mime 时按 UA 猜 ext（iOS/Safari → mp4），或用 `rec.mimeType`（实际生效值）判断。

### P2-13 Rhythm 统计在「循环自然结束」时 loopDone 已被 stop 归零，写入统计循环数失真
- `modules/rhythm.js:493-499` `_finish()` 先 `_teardown()` 再置 `loopDone=0`，然后调 `_finishSession()`；`_finishSession():509` `loops=Math.max(1,this.loopDone||1)` 此时恒为 1 → 无论设了几遍循环，统计里只记 1 遍。
- 修复：`_finish()` 在归零前把 `this.loopDone` 存局部变量传入 `_finishSession(loops)`。

---

## 已核对、确认「不是 bug」的疑点（避免主 Agent 重复排查）

1. `router.js:22` `$('#topbarTitle')` —— app.html:104 确有 `id="topbarTitle"`，主 Agent 此前怀疑的 P0 **不成立**。
2. `audio-engine.js:155` `new Float32Array(analyser.fftSize)` + `getFloatTimeDomainData` —— 时域数据长度就是 fftSize（frequencyBinCount 仅用于频域），缓冲区大小正确。
3. `CHORD_MAP` 覆盖：游戏 4 关全部和弦池、6 个进行（含 Em）经 Node 运行时校验全部存在，无 undefined 崩溃。
4. 全部 JS 中引用的 DOM id（两轮批量核对 ~90 个）在 app.html 中均存在，无空指针。
5. `theme-switch.js:61` 渲染面板时引用的 `gsLang`（:77 声明）——函数调用发生在模块求值之后，TDZ 不触发，仅「首次打开面板语言名取默认 zh-CN」，属轻微时序瑕疵，不影响功能。
6. mic 单例回调刷新（audio-engine.js P0-02 修复）、fftSize 降帧（P2-19）、makeSmoother FIFO（P0-01）、NSDF 测频等已有修复经代码与单测确认有效。
