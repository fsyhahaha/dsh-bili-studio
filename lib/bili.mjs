/** B 站 Web API 客户端（Node 原生 fetch）：
 *  WBI 签名 + 评论（列表/发/回复/点赞/删）+ 视频上传发布（biliup 同款 upos 流程）。 */
import { createHash } from 'node:crypto';

const API_BASE = 'https://api.bilibili.com';
const MEMBER_BASE = 'https://member.bilibili.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** WBI 映射表（与 biliup wbi.rs 一致）。 */
const KEY_MAP = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
  54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
const UPDATE_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function makeClient(cookieText) {
  const cookie = String(cookieText).trim();
  if (!cookie) throw new Error('缺少 B 站 Cookie：请先提供（设置 → /bili cookie <你的Cookie>）');
  const cookieMap = {};
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookieMap[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const csrf = cookieMap.bili_jct ?? cookieMap.bilili_jct; // 容错：常见手误字段名
  if (!csrf) throw new Error('Cookie 中缺少 bili_jct（未登录或 Cookie 不完整）');

  const wbi = { mixinKey: null, updatedAt: 0, disabled: false };

  async function nav() {
    const res = await fetchJson(`${API_BASE}/x/web-interface/nav`, {});
    return res.data ?? {};
  }

  async function refreshMixinKey() {
    const now = Date.now();
    if (wbi.mixinKey && now - wbi.updatedAt < UPDATE_INTERVAL_MS) return wbi.mixinKey;
    const navData = await nav();
    const img = (navData.wbi_img?.img_url ?? '').split('/').pop().split('.')[0] ?? '';
    const sub = (navData.wbi_img?.sub_url ?? '').split('/').pop().split('.')[0] ?? '';
    const full = `${img}${sub}`.split('');
    if (full.length < 32) throw new Error('无法获取 WBI 密钥（nav 未登录或接口变更）');
    wbi.mixinKey = KEY_MAP.slice(0, 32).map((i) => full[i] ?? '').join('');
    wbi.updatedAt = now;
    return wbi.mixinKey;
  }

  function signParams(params) {
    const p = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
    const cleaned = {};
    for (const [k, v] of Object.entries(p)) {
      cleaned[k] = String(v).replace(/[!'()*]/g, '');
    }
    const qs = Object.keys(cleaned)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(cleaned[k])}`)
      .join('&');
    p.w_rid = createHash('md5').update(qs + wbi.mixinKey).digest('hex');
    return p;
  }

  async function fetchJson(url, { method = 'GET', body, noCookie = false, contentType } = {}) {
    const headers = noCookie
      ? { 'User-Agent': UA, Referer: 'https://www.bilibili.com' }
      : {
        'User-Agent': UA,
        Origin: 'https://www.bilibili.com',
        Referer: 'https://www.bilibili.com',
        Cookie: cookie,
      };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/x-www-form-urlencoded';
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? (typeof body === 'string' ? body : new URLSearchParams(body).toString()) : undefined,
    });
    return res.json();
  }

  /** 带 wbi 自动重试/降级的通用请求（对齐参考实现的 -352 处理）。 */
  async function request(path, { method = 'GET', params = {}, body, useWbi = false, noCookie = false } = {}) {
    let wbiOff = false;
    let retries = 0;
    for (;;) {
      let p = { ...params };
      if (useWbi && !wbiOff) {
        try {
          wbi.mixinKey ??= await refreshMixinKey();
          p = signParams(p);
        } catch {
          wbiOff = true; // 拿不到密钥就降级
        }
      }
      const effectivePath = wbiOff ? path.replace(/\/wbi\//g, '/') : path;
      const qs = Object.keys(p)
        .filter((k) => p[k] !== undefined && p[k] !== null)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
        .join('&');
      const url = `${API_BASE}${effectivePath}${qs ? `?${qs}` : ''}`;
      const json = await fetchJson(url, { method, body, useWbi, noCookie });
      if (json.code === -352 && !wbiOff && retries < 2) {
        retries += 1;
        if (retries >= 2) {
          wbiOff = true;
          wbi.mixinKey = null;
        }
        continue;
      }
      return json;
    }
  }

  // ── 登录 / 用户 ────────────────────────────────────────
  async function checkLogin() {
    const json = await fetchJson(`${API_BASE}/x/web-interface/nav`, {});
    if (json.code !== 0) return { ok: false, reason: `nav 返回 code=${json.code} ${json.message ?? ''}`.trim() };
    const isLogin = json.data?.isLogin === true;
    return { ok: isLogin, uname: json.data?.uname ?? null, mid: json.data?.mid ?? null };
  }

  // ── 评论 ─────────────────────────────────────────────
  /** 评论列表：videoId 支持 BV 号或 aid。 */
  async function listComments(videoId, { count = 30, next = 0 } = {}) {
    const json = await request('/x/v2/reply/main', {
      params: { oid: videoId, type: '1', ps: String(count), next: String(next), mode: '3' },
    });
    if (json.code !== 0) throw new Error(`取评论失败 code=${json.code} ${json.message ?? ''}`);
    const replies = (json.data?.replies ?? []).map((r) => ({
      rpid: r.rpid,
      author: r.member?.uname,
      like: r.like,
      reply: r.reply_control?.replies ?? 0,
      msg: r.content?.message,
      created: new Date((r.ctime ?? 0) * 1000).toISOString(),
    }));
    return {
      replies,
      hasMore: Boolean(json.data?.cursor?.is_end === false),
      cursor: json.data?.cursor?.next ?? 0,
    };
  }

  /** 发评论（top-level）或回复（rootRpid = 根评论，parentRpid = 目标评论）。 */
  async function postComment({ videoId, message, rootRpid, parentRpid }) {
    const body = {
      type: '1',
      oid: videoId,
      message: String(message).slice(0, 1000),
      plat: '1',
      csrf,
    };
    if (rootRpid) body.root = String(rootRpid);
    if (parentRpid) body.parent = String(parentRpid);
    const json = await request('/x/v2/reply/add', { method: 'POST', body });
    if (json.code === -101 || json.code === -111) throw new Error(`Cookie 失效（code=${json.code}），请重新提供`);
    if (json.code === 40067 || json.code === 40008 || json.code === -352) {
      throw new Error(`B 站风控（code=${json.code} ${json.message ?? ''}）：评论频率过高或签名不被接受，稍后再试`);
    }
    if (json.code !== 0) throw new Error(`发评论失败 code=${json.code} ${json.message ?? ''}`);
    return { rpid: json.data?.rpid ?? null, message: body.message };
  }

  /** 回复某条评论。 */
  async function replyToComment({ videoId, rootRpid, targetRpid, message }) {
    return postComment({ videoId, message, rootRpid, parentRpid: targetRpid });
  }

  async function likeComment({ videoId, rpid, action = 1 }) {
    const json = await request('/x/v2/reply/action', {
      method: 'POST',
      body: { type: '1', oid: videoId, rpid: String(rpid), action: String(action), csrf },
    });
    if (json.code !== 0) throw new Error(`点赞失败 code=${json.code} ${json.message ?? ''}`);
    return { ok: true, rpid };
  }

  async function deleteComment({ videoId, rpid }) {
    const json = await request('/x/v2/reply/del', {
      method: 'POST',
      body: { type: '1', oid: videoId, rpid: String(rpid), csrf },
    });
    if (json.code !== 0) throw new Error(`删除失败 code=${json.code} ${json.message ?? ''}`);
    return { ok: true, rpid };
  }

  // ── 视频上传（biliup 同款 upos 流程）──────────────────
  async function uploadVideo({ filePath, title, desc = '', tag = '', tid = 21, source = '' }) {
    const fs = await import('node:fs');
    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
    const name = filePath.split('/').pop();

    // 1. probe：挑一条 upos 线路
    const probeRes = await fetchJson(`${MEMBER_BASE}/preupload?r=probe`, {});
    const lines = probeRes.lines ?? [];
    const line = lines.find((l) => l.os === 'upos') ?? lines[0];
    if (!line) throw new Error('probe 未返回可用上传线路');
    if (line.os !== 'upos') throw new Error(`上传线路类型 ${line.os} 暂不支持（v1 仅实现 upos），请重试`);

    // 2. preupload
    const preParams = new URLSearchParams({
      r: 'upos',
      profile: 'ugcupos/bup',
      ssl: '0',
      version: '2.8.12',
      build: '2081200',
      name,
      size: String(totalSize),
    });
    const preUrl = `${MEMBER_BASE}/preupload?${line.query}&${preParams}`;
    const pre = await fetchJson(preUrl, {});
    if (pre.upos_uri === undefined) throw new Error(`preupload 失败: ${JSON.stringify(pre).slice(0, 300)}`);

    // 3. upos 分片
    const endpoint = `https:${pre.endpoint}`;
    const uposPath = pre.upos_uri.replace('upos://', '');
    const uposUrl = `${endpoint}/${uposPath}`;
    const authHeader = { 'X-Upos-Auth': pre.auth };
    const initRes = await fetch(`${uposUrl}?uploads&output=json`, { method: 'POST', headers: authHeader, body: '' });
    const init = await initRes.json();
    const uploadId = init.upload_id;
    if (!uploadId) throw new Error(`upload_id 获取失败: ${JSON.stringify(init).slice(0, 300)}`);

    const chunkSize = pre.chunk_size || 4 * 1024 * 1024;
    const buf = fs.readFileSync(filePath);
    const chunks = Math.ceil(totalSize / chunkSize);
    const parts = [];
    for (let i = 0; i < chunks; i += 1) {
      const data = buf.subarray(i * chunkSize, (i + 1) * chunkSize);
      const params = new URLSearchParams({
        partNumber: String(i + 1),
        start: String(i * chunkSize),
        end: String(Math.min(totalSize, (i + 1) * chunkSize)),
        size: String(data.length),
        uploadId,
        biz_id: String(pre.biz_id),
        output: 'json',
        profile: 'ugcupos/bup',
        name,
      });
      const r = await fetch(`${uposUrl}?${params}`, {
        method: 'PUT',
        headers: authHeader,
        body: data,
      });
      if (!r.ok) throw new Error(`分片 ${i + 1}/${chunks} 上传失败 HTTP ${r.status}`);
      parts.push({ partNumber: i + 1, eTag: r.headers.get('etag') ?? 'etag' });
    }

    // 4. complete
    const completeParams = new URLSearchParams({
      name,
      uploadId,
      biz_id: String(pre.biz_id),
      output: 'json',
      profile: 'ugcupos/bup',
    });
    let merged = null;
    for (let attempt = 0; attempt < 3 && merged === null; attempt += 1) {
      const r = await fetch(`${uposUrl}?${completeParams}`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts }),
      });
      const j = await r.json().catch(() => null);
      if (j && j.OK === 1) merged = j;
      else await new Promise((res) => setTimeout(res, 3000));
    }
    if (!merged) throw new Error('合并分片失败（complete 未 OK）');

    // 5. 提交稿件
    const biliFilename = pre.upos_uri.split('/').pop().replace(/\.mp4$/, '') || name.replace(/\.[^.]+$/, '');
    const data = {
      copyright: 1,
      source: String(source).slice(0, 128),
      tid,
      cover: '',
      title: String(title).slice(0, 80),
      desc_format_id: 0,
      desc: String(desc).slice(0, 2500),
      desc_v2: [{ raw_text: String(desc).slice(0, 2500), biz_id: '', type: 1 }],
      dynamic: '',
      subtitle: { open: 0, lan: '' },
      tag: String(tag).slice(0, 128),
      videos: [{ cid: 0, filename: biliFilename, title: String(title).slice(0, 80) }],
      dtime: null,
    };
    const submitRes = await fetchJson(
      `${MEMBER_BASE}/x/vu/web/add?csrf=${csrf}`,
      { method: 'POST', body: JSON.stringify(data), contentType: 'application/json' },
    );
    if (submitRes.code !== 0) {
      throw new Error(`投稿提交失败 code=${submitRes.code} ${submitRes.message ?? ''}`);
    }
    return {
      bvid: submitRes.data?.bvid ?? null,
      aid: submitRes.data?.aid ?? null,
      cid: submitRes.data?.cid ?? null,
      message: '已提交，B 站转码/审核需要数分钟',
    };
  }

  return { checkLogin, listComments, postComment, replyToComment, likeComment, deleteComment, uploadVideo };
}
