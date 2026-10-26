# B站工作室（bili-studio）

DSH 插件：自动写口播脚本 / edge-tts 配音 / ffmpeg 合成视频 / B站 评论互动 / 发布。
为 DSH 的 `bili_studio` 工具提供能力，AI 负责写脚本与编排，工具负责执行。

## 功能（`bili_studio` 工具动作）

| 动作 | 说明 |
|---|---|
| `make` | 输入分段口播文案（`sections[]`）或整段脚本（`script`）+ 标题/标签，生成 mp4 并加入「待发布」队列 |
| `comments` | 取指定视频（bvid/aid）的评论列表 |
| `comment` | 在视频下发顶层评论 |
| `reply` | 回复某条评论（顶层回复时 `rootRpid = targetRpid`） |
| `like` | 给评论点赞 / 取消点赞 |
| `status` | 依赖与队列状态（cookie、ffmpeg、edge-tts、待发布列表） |
| `cookie` | 保存你自己的 B站 Cookie（完整 Cookie 串，须含 `SESSDATA` 与 `bili_jct`） |

## 前置依赖（每台设备各装一次）

- **ffmpeg**：视频合成。
- **edge-tts**：配音（`make` 用到）。
- 可用 `bili_studio status` 自检是否就绪。

## 安装

### 方式一：DSH 插件市场 / 插件管理器（推荐，一键）

1. 设置 → 插件市场（或 插件管理器）→ 搜索包名 / 输入包名 → 安装。
2. 官方安装器会自动 pnpm 装好并注册进当前 profile，无需手改文件。

> 包名以实际发布的 npm 包名为准（见下方「发布到 npm」）。

### 方式二：git 仓库（发给指定朋友）

把依赖加进本机 DSH 的 `~/.dsh/profiles/web/package.json`：

```jsonc
{
  "dependencies": {
    "@you/bili-studio": "git+https://github.com/<github-user>/dsh-bili-studio.git"
  },
  "dsh": { "profile": { "bundles": [ "…已有的…", "@you/bili-studio" ] } }
}
```

然后重启 DSH（让 pnpm 重新 link）。

## 首次使用

```
bili_studio cookie   # 传你自己的 B站 Cookie（浏览器复制的完整串，须含 SESSDATA + bili_jct）
bili_studio status   # 确认依赖与队列
```

## 安全与合规

- **Cookie 各配各的**：`cookie.txt` 属于本机 `$DSH_HOME/bili-studio/`，不要分享、不要提交到 git。
- **发布是用户专属操作**：`make` 完成后需到「B站工作室」面板点「确认发布」，AI 不代发。
- 请遵守 B站 服务条款，控制评论/点赞频率，避免风控。

## 目录结构

- `index.js` / `lib-bridge.mjs`：宿主半（Node 进程，引擎侧工具实现）
- `client.js`：客户端半（web GUI）
- `lib/*.mjs`：bili API / tts / video / state 逻辑
- `locale/*.json`：多语言
- `icon.svg`：图标
- `cordis.patch.yml`：bundle 补丁（注册工具）
- `ref/`：各语言参考实现（仅参考，不随 npm 发布）
