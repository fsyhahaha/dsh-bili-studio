/** B站工作室 Host 入口：注册 bili_studio 工具 + /bili 命令。
 *  发布（publish）刻意不暴露给工具，仅 /bili publish <id>（面板按钮调用）可以执行。 */
import { state, bili } from './lib-bridge.mjs';

export const name = 'bili-studio';
export const inject = ['tools', 'commands'];

const TOOL_DESC = `B 站工作室：自动写脚本/TTS 配音/ffmpeg 合成视频/评论互动/发布。
actions:
- make: 输入 sections[]（分段口播文案）或 script（自动分段）+ 元数据，生成 mp4 并加入「待发布」队列（需要 edge-tts + ffmpeg，先 status 检查依赖）。
- comments: 取指定视频（bvid 或 aid）的评论列表，供选择回复目标。
- comment: 在视频下发顶层评论。
- reply: 回复某条评论（rootRpid=根评论, targetRpid=目标评论；顶层回复时 rootRpid=targetRpid）。
- like: 给评论点赞/取消（rpid + action 1/0）。
- status: 依赖与队列状态（cookie 是否配置、pending 列表、ffmpeg/edge-tts 可用性）。
- cookie: 保存 B 站 Cookie（cookieText 为浏览器完整 Cookie 串，须含 SESSDATA 与 bili_jct）。
发布是用户专属操作：make 完成后告诉用户「到 B站工作室 面板点确认发布」，你自己不要发布。`;

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'bili_studio',
    description: TOOL_DESC,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['make', 'comments', 'comment', 'reply', 'like', 'status', 'cookie'],
          description: '要执行的操作。',
        },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: 'make：分段口播文案（1-12 段，每段 ≤300 字）。与 script 二选一，优先使用。',
        },
        script: { type: 'string', description: 'make：完整脚本文本，按空行/段落自动分段。' },
        topic: { type: 'string', description: 'make：主题（未给 script/sections 时按主题生成一段兜底文案，通常由你写好脚本再传 script）。' },
        title: { type: 'string', description: 'make：视频标题（≤80 字）。' },
        tag: { type: 'string', description: 'make：标签，逗号分隔（≤128 字）。' },
        desc: { type: 'string', description: 'make：简介（≤2500 字）。' },
        tid: { type: 'integer', description: 'make：分区 id，默认 21。' },
        voice: { type: 'string', description: 'make：edge-tts 音色，默认 zh-CN-XiaoxiaoNeural。' },
        bvid: { type: 'string', description: 'comments/comment/reply/like：BV 号或纯数字 avid。' },
        message: { type: 'string', description: 'comment/reply：评论内容（≤1000 字）。' },
        rootRpid: { type: 'string', description: 'reply：根评论 rpid。' },
        targetRpid: { type: 'string', description: 'reply：被回复评论 rpid（顶层时与 rootRpid 相同）。' },
        rpid: { type: 'string', description: 'like：目标评论 rpid。' },
        likeAction: { type: 'integer', description: 'like：1 点赞 0 取消。' },
        count: { type: 'integer', description: 'comments：取多少条，默认 30。' },
        next: { type: 'integer', description: 'comments：翻页游标。' },
        cookieText: { type: 'string', description: 'cookie：B 站完整 Cookie 串。' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          result: { type: 'object' },
          hint: { type: 'string' },
        },
        required: ['ok', 'action'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `${value.action} 成功：${JSON.stringify(value.result)}${value.hint ? `\n${value.hint}` : ''}`
          : `${value.action} 失败：${JSON.stringify(value.result)}${value.hint ? `\n${value.hint}` : ''}`,
      }],
    },
    timeoutMs: 15 * 60 * 1000,
    async execute(args, exec) {
      const signal = exec?.signal;
      try {
        switch (String(args.action)) {
          case 'make':
            return ok('make', state.make({ ...args, signal }));
          case 'comments': {
            const c = bili.client();
            const r = await c.listComments(String(args.bvid), { count: Number(args.count) || 30, next: Number(args.next) || 0 });
            return ok('comments', r);
          }
          case 'comment': {
            const c = bili.client();
            const r = await c.postComment({ videoId: String(args.bvid), message: String(args.message ?? '') });
            return ok('comment', r, '评论已发布。');
          }
          case 'reply': {
            const c = bili.client();
            const r = await c.replyToComment({
              videoId: String(args.bvid),
              rootRpid: String(args.rootRpid ?? args.targetRpid ?? ''),
              targetRpid: String(args.targetRpid ?? args.rootRpid ?? ''),
              message: String(args.message ?? ''),
            });
            return ok('reply', r, '回复已发布。');
          }
          case 'like': {
            const c = bili.client();
            const r = await c.likeComment({ videoId: String(args.bvid), rpid: String(args.rpid), action: Number(args.likeAction) === 0 ? 0 : 1 });
            return ok('like', r);
          }
          case 'status':
            return ok('status', state.status());
          case 'cookie': {
            const before = state.hasCookie();
            state.saveCookie(String(args.cookieText ?? ''));
            return ok('cookie', { hasCookie: state.hasCookie(), previouslyConfigured: before }, 'Cookie 已保存。评论/发布功能现在可用。');
          }
          default:
            return fail('unknown', { action: args.action }, '未知 action，可用：make/comments/comment/reply/like/status/cookie。');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail(args.action, { error: msg }, hintForError(msg));
      } finally {
        signal?.throwIfAborted?.();
      }
    },
  }), 'bili-studio: tool');

  ctx.effect(() => ctx.commands.register({
    definitionId: name,
    name: 'bili',
    description: 'B站工作室：/bili cookie <cookie> 保存Cookie；/bili status 状态；/bili list 待发布列表；/bili publish <id> 确认发布（用户操作）',
    handler: async (invocation) => {
      const raw = String(invocation?.rawInput ?? '').trim();
      const [cmd, ...rest] = raw.split(/\s+/);
      const restText = raw.slice(cmd.length).trim();
      try {
        switch (cmd) {
          case 'cookie':
            if (!restText) return { kind: 'error', text: '用法：/bili cookie <完整Cookie>' };
            state.saveCookie(restText);
            return { kind: 'success', text: `Cookie 已保存（${Object.keys(state.loadCookie() ?? {}).join(', ')}）。` };
          case 'status':
            return { kind: 'success', text: JSON.stringify(state.status(), null, 1) };
          case 'list': {
            const s = state.loadState();
            const list = s.pending.map((p) => `${p.id}  [${p.status}] ${p.title}`).join('\n') || '（空）';
            return { kind: 'success', text: `待发布队列：\n${list}` };
          }
          case 'publish': {
            const id = restText || s0().pending[0]?.id;
            if (!id) return { kind: 'error', text: '没有待发布项。用法：/bili publish <id>' };
            const item = state.findPending(id);
            if (!item) return { kind: 'error', text: `未找到待发布项 ${id}` };
            const client = bili.client();
            const result = await client.uploadVideo({
              filePath: item.videoPath,
              title: item.title,
              desc: item.desc ?? '',
              tag: item.tag ?? '',
              tid: item.tid ?? 21,
            });
            state.removePending(item.id);
            state.markPublished(item.id, result);
            return { kind: 'success', text: `发布成功：${result.bvid ?? ''} ${result.message}` };
          }
          default:
            return { kind: 'error', text: '用法：/bili cookie <cookie> | /bili status | /bili list | /bili publish <id>' };
        }
      } catch (e) {
        return { kind: 'error', text: `B 站操作失败：${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }), 'bili-studio: command');
}

function s0() { return state.loadState(); }
// 所有返回字段必须是具体值（undefined 会让 JSON 往返不保真，被引擎拒绝）
function ok(action, result, hint) { return { ok: true, action, result, hint: hint ?? '' }; }
function fail(action, result, hint) { return { ok: false, action, result, hint: hint ?? '' }; }
function hintForError(msg) {
  if (msg.includes('Cookie') || msg.includes('cookie')) return '提示：用 /bili cookie <完整Cookie> 或 bili_studio action=cookie 提供 B 站 Cookie。';
  if (msg.includes('edge-tts') || msg.includes('edge_tts')) return '提示：pip 环境异常，检查 Termux python。';
  return '';
}
