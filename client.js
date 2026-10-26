/** B站工作室 Client 半部：右栏「B站工作室」tab + 确认发布（用户专属操作）。 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    /** 词典（zh 为 key 源）。 */
    const NS = 'bili-studio';
    const zh = {
      'panel.title': 'B站工作室',
      'panel.subtitle': '写脚本 · 配音 · 剪辑 · 评论 · 一键发布',
      'section.cookie': 'B 站 Cookie',
      'cookie.configured': '已配置（{fields}）',
      'cookie.missing': '未配置：评论/发布不可用',
      'cookie.placeholder': '粘贴浏览器完整 Cookie（需含 SESSDATA、bili_jct）',
      'cookie.save': '保存',
      'cookie.saved': 'Cookie 已保存',
      'cookie.saveFailed': '保存失败',
      'section.deps': '依赖',
      'section.pending': '待发布',
      'section.published': '最近发布',
      'pending.empty': '队列为空。让 AI 调用 bili_studio action=make 生成一条视频。',
      'pending.publish': '确认发布',
      'pending.publishing': '发布中…',
      'pending.published': '已发布',
      'pending.publishFailed': '发布失败',
      'published.empty': '还没有发布记录。',
      'action.refresh': '刷新',
      'duration': '{n} 秒',
    };
    const en = {
      'panel.title': 'Bilibili Studio',
      'panel.subtitle': 'Script · TTS · Edit · Comment · One-tap publish',
      'section.cookie': 'Bilibili Cookie',
      'cookie.configured': 'configured ({fields})',
      'cookie.missing': 'not configured: comment/publish unavailable',
      'cookie.placeholder': 'Paste your full browser cookie (SESSDATA, bili_jct)',
      'cookie.save': 'Save',
      'cookie.saved': 'Cookie saved',
      'cookie.saveFailed': 'save failed',
      'section.deps': 'Dependencies',
      'section.pending': 'Pending publish',
      'section.published': 'Recently published',
      'pending.empty': 'Queue is empty. Ask the agent to run bili_studio action=make.',
      'pending.publish': 'Publish',
      'pending.publishing': 'Publishing…',
      'pending.published': 'Published',
      'pending.publishFailed': 'publish failed',
      'published.empty': 'No published videos yet.',
      'action.refresh': 'Refresh',
      'duration': '{n}s',
    };

    const pkg = 'dsh-bili-studio';
    const KIND = 'bili-studio';
    const inject = [
      'slots',
      'locale',
      'remote',
      'remote.commands',
      'sessions',
      'sidebarRightTabs',
    ];

    const token = (name, fallback) => `var(${name}, ${fallback})`;
    const style = {
      root: {
        display: 'flex', flexDirection: 'column', gap: 14, padding: 14,
        fontFamily: 'inherit', fontSize: 13, color: token('--dsw-alias-foreground', '#e8eaf0'),
      },
      h1: { margin: 0, fontSize: 16, fontWeight: 600 },
      sub: { margin: '2px 0 0', fontSize: 11, color: token('--dsw-alias-foreground-muted', '#9aa0b4') },
      section: {
        border: `1px solid ${token('--dsw-alias-border', 'rgba(128,128,128,0.25)')}`,
        borderRadius: 10, padding: 10, background: token('--dsw-alias-bg-soft', 'rgba(128,128,128,0.06)'),
      },
      sectionTitle: {
        fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
        color: token('--dsw-alias-foreground-muted', '#9aa0b4'), marginBottom: 8,
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      ok: { color: '#4ade80', fontSize: 11 },
      bad: { color: '#f87171', fontSize: 11 },
      tag: { fontSize: 11, color: token('--dsw-alias-foreground-muted', '#9aa0b4') },
      input: {
        flex: 1, minWidth: 160, boxSizing: 'border-box', padding: '6px 8px',
        border: `1px solid ${token('--dsw-alias-border', 'rgba(128,128,128,0.35)')}`,
        borderRadius: 8, background: token('--dsw-alias-bg', 'rgba(0,0,0,0.25)'),
        color: 'inherit', fontSize: 12,
      },
      btn: {
        padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
        border: 'none', background: '#fb7299', color: '#fff', fontWeight: 600,
      },
      btnGhost: {
        padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
        border: `1px solid ${token('--dsw-alias-border', 'rgba(128,128,128,0.35)')}`,
        background: 'transparent', color: 'inherit',
      },
      btnDisabled: { opacity: 0.55, cursor: 'default' },
      item: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
        borderTop: `1px solid ${token('--dsw-alias-border', 'rgba(128,128,128,0.18)')}`,
      },
      itemTitle: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      result: { fontSize: 11, marginTop: 4 },
    };

    function depChip(name, on) {
      return h('span', { key: name, style: on ? style.ok : style.bad }, `${name}: ${on ? 'ok' : 'missing'}`);
    }

    function runCommand(ctx, sessionId, line) {
      return ctx.remote.commands.execute(sessionId, line, []);
    }

    function StudioPanel(props) {
      const ctx = props.ctx;
      const sessionId = props.sessionId;
      const t = props.t;
      const [data, setData] = useState(null);
      const [cookie, setCookie] = useState('');
      const [cookieMsg, setCookieMsg] = useState('');
      const [results, setResults] = useState({});
      const timer = useRef(null);

      const refresh = useCallback(async () => {
        const r = await runCommand(ctx, sessionId, '/bili status');
        if (!r.ok) { setData(null); return; }
        try {
          setData(JSON.parse(String(r.value ?? '{}')));
        } catch {
          setData(null);
        }
      }, [ctx, sessionId]);

      useEffect(() => {
        refresh();
        timer.current = setInterval(refresh, 15000);
        return () => clearInterval(timer.current);
      }, [refresh]);

      const saveCookie = async () => {
        const clean = cookie.replace(/\s+/g, '');
        if (!clean) return;
        const r = await runCommand(ctx, sessionId, `/bili cookie ${clean}`);
        setCookieMsg(r.ok ? t('cookie.saved') : `${t('cookie.saveFailed')}: ${r.error?.message ?? ''}`);
        if (r.ok) setCookie('');
        refresh();
      };

      const publish = async (id) => {
        setResults((m) => ({ ...m, [id]: { state: 'busy' } }));
        const r = await runCommand(ctx, sessionId, `/bili publish ${id}`);
        setResults((m) => ({
          ...m,
          [id]: {
            state: r.ok ? 'done' : 'error',
            text: r.ok ? String(r.value ?? '') : (r.error?.message ?? String(r)),
          },
        }));
        refresh();
      };

      const pending = data?.pending ?? [];
      const published = (data?.published ?? []).slice(-5).reverse();

      return h('div', { style: style.root, role: 'region', 'aria-label': t('panel.title') },
        h('div', null,
          h('div', { style: { ...style.row, justifyContent: 'space-between' } },
            h('div', null,
              h('h1', { style: style.h1 }, t('panel.title')),
              h('p', { style: style.sub }, t('panel.subtitle')),
            ),
            h('button', { style: style.btnGhost, onClick: refresh, 'aria-label': t('action.refresh') }, t('action.refresh')),
          ),
        ),
        h('section', { style: style.section },
          h('div', { style: style.sectionTitle }, t('section.cookie')),
          data?.hasCookie
            ? h('div', { style: style.ok }, t('cookie.configured', { fields: (data?.cookieFields ?? []).join(', ') }))
            : h('div', { style: style.bad }, t('cookie.missing')),
          !data?.hasCookie ? h('div', { style: { ...style.row, marginTop: 8 } },
            h('input', {
              style: style.input, value: cookie, placeholder: t('cookie.placeholder'),
              onChange: (e) => setCookie(e.target.value),
            }),
            h('button', { style: { ...style.btn, ...(!cookie.trim() ? style.btnDisabled : {}) }, onClick: saveCookie, disabled: !cookie.trim() }, t('cookie.save')),
          ) : null,
          cookieMsg ? h('div', { style: { ...style.result, color: cookieMsg === t('cookie.saved') ? '#4ade80' : '#f87171' } }, cookieMsg) : null,
        ),
        h('section', { style: style.section },
          h('div', { style: style.sectionTitle }, t('section.deps')),
          h('div', { style: style.row },
            depChip('ffmpeg', data?.deps?.ffmpeg),
            depChip('edge-tts', data?.deps?.edgeTts),
            depChip('python', data?.deps?.python),
          ),
        ),
        h('section', { style: style.section },
          h('div', { style: style.sectionTitle }, t('section.pending')),
          pending.length === 0
            ? h('div', { style: style.tag }, t('pending.empty'))
            : pending.map((p) => {
              const r = results[p.id];
              return h('div', { key: p.id, style: style.item },
                h('div', { style: style.itemTitle, title: p.title }, p.title),
                p.durationSec ? h('span', { style: style.tag }, t('duration', { n: p.durationSec })) : h('span', { style: style.tag }, p.id),
                r?.state === 'done'
                  ? h('span', { style: style.ok }, t('pending.published'))
                  : r?.state === 'error'
                    ? h('span', { style: style.bad }, t('pending.publishFailed'))
                    : h('button', {
                      style: { ...style.btn, ...(r?.state === 'busy' ? style.btnDisabled : {}) },
                      onClick: () => publish(p.id),
                      disabled: r?.state === 'busy',
                    }, r?.state === 'busy' ? t('pending.publishing') : t('pending.publish')),
              );
            }),
          Object.entries(results).filter(([, v]) => v.state === 'error').map(([id, v]) =>
            h('div', { key: `${id}-err`, style: { ...style.result, color: '#f87171' } }, `${id}: ${String(v.text ?? '').slice(0, 160)}`),
          ),
        ),
        h('section', { style: style.section },
          h('div', { style: style.sectionTitle }, t('section.published')),
          published.length === 0
            ? h('div', { style: style.tag }, t('published.empty'))
            : published.map((p) => h('div', { key: `${p.id}-${p.at}`, style: style.item },
              h('div', { style: style.itemTitle }, p.bvid ?? p.id),
              p.at ? h('span', { style: style.tag }, new Date(p.at).toLocaleString()) : null,
            )),
        ),
      );
    }

    function StudioTitle(props) {
      return h('span', { style: { fontSize: 12, fontWeight: 600 } }, props.t('panel.title'));
    }

    function GuideIcon() {
      return h('svg', { viewBox: '0 0 64 64', width: 28, height: 28, 'aria-hidden': true },
        h('rect', { x: 6, y: 14, width: 52, height: 36, rx: 8, fill: '#fb7299' }),
        h('line', { x1: 24, y1: 8, x2: 32, y2: 16, stroke: '#fb7299', 'stroke-width': 3, 'stroke-linecap': 'round' }),
        h('line', { x1: 40, y1: 8, x2: 32, y2: 16, stroke: '#fb7299', 'stroke-width': 3, 'stroke-linecap': 'round' }),
        h('circle', { cx: 32, cy: 32, r: 13, fill: '#fff' }),
        h('path', { d: 'M28.5 25.5 L41 32 L28.5 38.5 Z', fill: '#fb7299' }));
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bili-studio: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => {
        if (!ctx.sidebarRightTabs?.register) return () => {};
        return ctx.sidebarRightTabs.register({
          id: pkg,
          kind: KIND,
          priority: 'builtin',
          title: () => t('panel.title'),
          guide: [{
            id: 'open',
            order: 30,
            title: () => t('panel.title'),
            description: () => t('panel.subtitle'),
            icon: GuideIcon,
          }],
        });
      }, 'bili-studio: tab type');
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: pkg,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, (props) => h(StudioPanel, { ...props, ctx, t })),
      );
      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: pkg,
        locale: NS,
      }, () => h(StudioTitle, { t })),
      );
    }

    return { inject, apply };
  },
});
