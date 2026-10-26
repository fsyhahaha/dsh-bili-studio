/** 数据目录（cookie / state.json / 生成物 out/）。
 *  锚定顺序：$DSH_HOME/bili-studio（引擎进程，插件包也装在 $DSH_HOME/node_modules 下，跨 profile 共享）
 *  → $DSH_PROFILE_DIR/bili-studio（agent bash 环境）→ ./.bili-studio（裸 Node 兜底）。 */
const dataDir = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'bili-studio')
  : process.env.DSH_PROFILE_DIR
    ? join(process.env.DSH_PROFILE_DIR, 'bili-studio')
    : join(process.cwd(), '.bili-studio');
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

mkdirSync(join(dataDir, 'out'), { recursive: true });

export { dataDir };

/** Cookie 字符串（浏览器完整 Cookie 头或 "K=V; K2=V2"）。 */
export function cookiePath() { return join(dataDir, 'cookie.txt'); }

export function loadCookie() {
  try {
    const raw = readFileSync(cookiePath(), 'utf8').trim();
    if (!raw) return null;
    const out = {};
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out.SESSDATA || out.bili_jct ? out : null;
  } catch {
    return null;
  }
}

export function saveCookie(cookieText) {
  writeFileSync(cookiePath(), String(cookieText).trim());
}

export function hasCookie() { return loadCookie() !== null; }

/** 原始 Cookie 文本（makeClient 需要完整串）。 */
export function loadCookieText() {
  try {
    return readFileSync(cookiePath(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** pending 发布队列 + 设置。 */
export function loadState() {
  const file = join(dataDir, 'state.json');
  if (!existsSync(file)) return { pending: [], settings: { voice: 'zh-CN-XiaoxiaoNeural', tid: 21 } };
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return {
      pending: Array.isArray(s.pending) ? s.pending : [],
      settings: { voice: 'zh-CN-XiaoxiaoNeural', tid: 21, ...(s.settings ?? {}) },
    };
  } catch {
    return { pending: [], settings: { voice: 'zh-CN-XiaoxiaoNeural', tid: 21 } };
  }
}

export function saveState(state) {
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(state, null, 2));
}

export function addPending(item) {
  const state = loadState();
  item.id = `bili-${Date.now().toString(36)}`;
  item.status = item.status ?? 'pending';
  item.createdAt = new Date().toISOString();
  item.videoPath = join(dataDir, 'out', item.videoPath);
  state.pending.push(item);
  saveState(state);
  return item;
}

export function findPending(id) {
  return loadState().pending.find((p) => p.id === id || p.id.endsWith(id));
}

export function removePending(id) {
  const state = loadState();
  const keep = state.pending.filter((p) => p.id !== id);
  if (keep.length !== state.pending.length) saveState({ ...state, pending: keep });
  return keep;
}

export function dataDirOut() { return join(dataDir, 'out'); }
