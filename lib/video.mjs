/** ffmpeg 视频合成：每个「图+配音」段落渲染成短视频，再 concat 成成品。
 *  规格：1280x720 h264 30fps + aac。中文字体用系统 NotoSansCJK。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const FONT_CJK = '/system/fonts/NotoSansCJK-Regular.ttc';
const W = 1280;
const H = 720;
const TAIL_PAD = 0.8;

function esc(p) {
  // 路径含空格时给 ffmpeg 参数加引号
  return p.includes(' ') ? `'${p}'` : p;
}

/** 写一个文本文件，供 drawtext 的 textfile 使用（规避转义地狱）。 */
function writeTextFile(dir, name, text) {
  const p = join(dir, name);
  writeFileSync(p, text, 'utf8');
  return p;
}

function wrap(text, width) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    let line = raw;
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
    lines.push(line);
  }
  return lines.slice(0, 4);
}

/** 生成一张 720p 幻灯图 PNG：深色渐变底 + 居中大标题（可选）+ 正文行。 */
function renderSlide(dir, index, slide, outPng) {
  const prefix = `slide-${index + 1}`;
  const titleFile = slide.title ? writeTextFile(dir, `${prefix}.title.txt`, slide.title) : null;
  const bodyLines = wrap(slide.body, 22);
  const bodyFile = writeTextFile(dir, `${prefix}.body.txt`, bodyLines.join('\n'));
  const hasTitle = Boolean(titleFile);
  const bodyY = hasTitle ? 330 : 260;
  const vf = [
    `scale=${W}:${H},format=yuv420p`,
    ...(hasTitle ? [`drawtext=fontfile=${FONT_CJK}:textfile=${esc(titleFile)}:fontsize=68:fontcolor=white:x=(w-text_w)/2:y=240`] : []),
    `drawtext=fontfile=${FONT_CJK}:textfile=${esc(bodyFile)}:fontsize=34:fontcolor=0xCBD5E1:x=(w-text_w)/2:y=${bodyY}`,
  ].join(',');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `gradients=size=${W}x${H}:c0=0x10131a:c1=0x2a3247:type=circular:speed=0`,
    '-vf', vf,
    '-frames:v', '1', esc(outPng),
  ], { stdio: 'pipe' });
}

/** 单段：图片循环 + 配音（尾部静音 0.8s）→ mp4。 */
function renderSegment(dir, png, mp3, dur, outMp4) {
  const total = Math.max(1, Math.round(dur + TAIL_PAD));
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-i', esc(png),
    '-i', esc(mp3),
    '-filter_complex', '[0:v]scale=1280:720,fps=30,format=yuv420p[v];[1:a]apad=pad_dur=0.8[a]',
    '-map', '[v]', '-map', '[a]',
    '-t', String(total),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-c:a', 'aac', '-b:a', '96k',
    '-shortest', esc(outMp4),
  ], { stdio: 'pipe' });
}

/**
 * 合成成品视频。
 * @param slides {title: string, body: string}[]
 * @param ttsFiles string[]（与 slides 一一对应的 mp3）
 * @param durations (number|null)[]
 * @param dir 工作目录
 * @returns 成品 mp4 绝对路径
 */
export function assemble(slides, ttsFiles, durations, dir) {
  mkdirSync(dir, { recursive: true });
  const segs = [];
  for (let i = 0; i < slides.length; i += 1) {
    const png = join(dir, `slide-${i + 1}.png`);
    const seg = join(dir, `seg-${i + 1}.mp4`);
    renderSlide(dir, i, slides[i], png);
    const dur = durations[i] ?? 4;
    renderSegment(dir, png, ttsFiles[i], dur, seg);
    segs.push(seg);
  }
  const listFile = join(dir, 'concat.txt');
  // ffmpeg concat demuxer 行语法：file 'path'（单引号包裹，单引号本身需转义为 '\''）
  writeFileSync(listFile, segs.map((s) => `file '${s.replace(/'/g, `'\\''`)}'`).join('\n') + '\n', 'utf8');
  const out = join(dir, 'final.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', esc(listFile),
    '-c', 'copy', esc(out),
  ], { stdio: 'pipe' });
  if (!existsSync(out)) throw new Error(`final.mp4 was not produced in ${dir}`);
  return out;
}

export function ffmpegInfo(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,size:stream=codec_name,width,height',
      '-of', 'json', file,
    ], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function outName(title) {
  const safe = String(title).replace(/[\\/:*?"<>|]/g, '').trim() || 'video';
  return `${safe.slice(0, 40)}.mp4`;
}

export function base(p) { return basename(p); }
