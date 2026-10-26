/** edge-tts 配音：spawn `python3 -m edge_tts`，每段脚本一个 mp3，并读回时长。 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PYTHON = 'python3';
const FFPROBE = 'ffprobe';

function ttsOnce(text, outMp3, voice, signal) {
  const args = ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', outMp3];
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function ffprobeDuration(mp3) {
  try {
    const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' });
    const d = Number.parseFloat(out.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/**
 * 分段配音。
 * @param sections string[] 分段文案（每段独立配音）
 * @param dir 输出目录
 * @param voice 语音名（edge-tts 音色）
 * @param signal AbortSignal
 * @returns { files: string[], durations: (number|null)[] }
 */
export async function dubSections(sections, dir, voice, signal) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  const durations = [];
  for (let i = 0; i < sections.length; i += 1) {
    signal?.throwIfAborted();
    const out = join(dir, `seg-${String(i + 1).padStart(2, '0')}.mp3`);
    await ttsOnce(sections[i], out, voice, signal);
    files.push(out);
    durations.push(ffprobeDuration(out));
  }
  return { files, durations };
}

/** 依赖可用性探测（status 用）。 */
export function probe() {
  const whichOk = (cmd) => {
    try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  let edgeTts = false;
  try { execFileSync(PYTHON, ['-c', 'import edge_tts'], { stdio: 'ignore' }); edgeTts = true; } catch { /* not installed */ }
  return {
    python: whichOk(PYTHON),
    ffmpeg: whichOk('ffmpeg'),
    edgeTts,
  };
}
