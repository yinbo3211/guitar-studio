// Presentation helpers for lyrics — framework-agnostic HTML strings.
// V4.2.5 P1-01：词级渲染 lineFillHTML 按产品决策退役（演奏视图不再消费逐字填色）。
// ⚠️ 这不是 N-5 的回退：karaoke-timeline.js 的 tokenizeLine / allocate /
//    buildLyricTimeline / activeAt / timelineDuration 全部保留，且 play.js 仍在
//    消费（用 activeAt() 做「当前行」定位）。退役的只是「逐字 span 填色 +
//    下一行弱化预览」这段渲染，不是切词能力本身。
// 保留 escapeHTML：play.js 多处用它做纯文本转义（GP-XSS-3 亦直接用例化）。

export function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
