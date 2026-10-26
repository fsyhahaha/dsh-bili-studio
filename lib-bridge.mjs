/** Host 聚合层：make 管线（分段 → TTS → ffmpeg 合成 → 待发布队列）+ B 站 API 工厂。 */
import { join } from 'node:path';
import {
  loadState, saveState, addPending, findPending, removePending,
  hasCookie, saveCookie, loadCookie, loadCookieText, dataDirOut,
} from './lib/state.mjs';
import { dubSections, probe as ttsProbe } from './lib/tts.mjs';
import { assemble, outName } from './lib/video.mjs';
import { makeClient } from './lib/bili.mjs';

export const state = {
  hasCookie,
  saveCookie,
  loadCookieText,
  findPending,
  removePending,
  dataDirOut,

  status() {
    const s = loadState();
    return {
      hasCookie: hasCookie(),
      cookieFields: Object.keys(loadCookie() ?? {}),
      deps: ttsProbe(),
      pending: s.pending,
      published: s.published ?? [],
      settings: s.settings,
    };
  },

  markPublished(id, result) {
    const s = loadState();
    s.published = s.published ?? [];
    s.published.push({ id, ...result, at: new Date().toISOString() });
    saveState(s);
  },

  /** 生成视频并加入待发布队列。 */
  async make({ sections, script, topic, title, tag, desc, tid, voice, signal } = {}) {
    const deps = ttsProbe();
    if (!deps.ffmpeg) throw new Error('缺少 ffmpeg（安装：pkg install ffmpeg）');
    if (!deps.edgeTts) throw new Error('缺少 edge-tts（安装：python3 -m pip install edge-tts）');

    let segs = Array.isArray(sections) && sections.length ? sections.map(String) : null;
    if (!segs) segs = script ? splitScript(String(script)) : topic ? [String(topic)] : null;
    if (!segs) throw new Error('请提供 sections[]、script 或 topic 之一');

    const clean = segs
      .map((s) => String(s).trim())
      .filter(Boolean)
      .map((s) => s.slice(0, 300))
      .slice(0, 12);
    if (!clean.length) throw new Error('分段后无可用内容');

    const slug = outName(title || topic || 'video').replace(/\.mp4$/, '');
    const dir = join(dataDirOut(), slug);
    const voiceUsed = voice || loadState().settings.voice;
    const { files, durations } = await dubSections(clean, dir, voiceUsed, signal);
    const slides = clean.map((s, i) => ({ title: i === 0 ? String(title || topic || '') : '', body: s }));
    await assemble(slides, files, durations, dir);

    const totalSec = Math.round(durations.reduce((a, d) => a + (d ?? 0), 0) + 0.8 * clean.length);
    const item = addPending({
      title: String(title || topic || slug).slice(0, 80),
      desc: String(desc ?? '').slice(0, 2500),
      tag: String(tag ?? '').slice(0, 128),
      tid: Number(tid) || 21,
      voice: voiceUsed,
      durationSec: totalSec,
      videoPath: join(slug, 'final.mp4'),
      status: 'pending',
      script: clean.join('\n\n'),
    });
    return {
      id: item.id,
      videoPath: item.videoPath,
      durationSec: totalSec,
      sections: clean.length,
      note: '已加入待发布队列。请让用户在 B站工作室 面板点击「确认发布」。',
    };
  },
};

export const bili = {
  client() {
    const text = loadCookieText();
    if (!text) throw new Error('B 站 Cookie 未配置（用 /bili cookie <Cookie> 或工具 action=cookie 提供）');
    return makeClient(text);
  },
};

/** 脚本文本 → 分段数组（空行分段，长段按标点切 ≤300 字）。 */
function splitScript(script) {
  const paras = script.split(/\n{2,}/).map((s) => s.replace(/\n/g, ' ').trim()).filter(Boolean);
  if (!paras.length) return [String(script).trim()];
  const out = [];
  for (const p of paras) {
    let rest = p;
    while (rest.length > 280) {
      const head = rest.slice(0, 280);
      const cut = head.search(/[。！？；!?;]$/);
      const at = cut > 60 ? cut + 1 : 280;
      out.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    if (rest.trim()) out.push(rest);
  }
  return out;
}
