// 선택 모듈: 이 서버 컴퓨터에 로그인된 AI 클라이언트(Codex CLI = ChatGPT 계정)로 그림 분석을 돌린다.
// 정적 웹앱만 올리면 없어도 된다 -- 그때는 화면에서 "AI 분석"이 꺼진다.
//
//   SKETCH_AI=codex   (기본: codex 가 있으면 codex)  · SKETCH_AI=off 로 끔 · SKETCH_AI=mock 은 시험용
//   SKETCH_AI_MODEL=<모델>  (없으면 Codex 기본 모델)
//
// 공유기 안 다른 기기에서도 열리므로, 분석 요청에는 이 컴퓨터에만 있는 토큰이 필요하다
// (~/.config/ai-screen-sketch/ai-token, `npm run ai-token` 으로 보기). 남이 내 ChatGPT 사용량을 쓰지 못하게.
import type { Plugin, Connect } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const ELEMENT_KINDS = ['region', 'text', 'button', 'input', 'list', 'card', 'image', 'note', 'shape'] as const;
const PROMPT_VERSION = 1;
const DISABLED_FEATURES = ['apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'multi_agent', 'plugins', 'skill_search', 'goals', 'hooks', 'shell_tool', 'unified_exec', 'sleep_tool', 'tool_suggest', 'worktrees'];
const MAX_BODY = 4 * 1024 * 1024;
const TIMEOUT_MS = 180_000;

export interface Candidate {
  id: number;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AiElement {
  candidate: number | null;
  type: (typeof ELEMENT_KINDS)[number];
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  role: string;
}

export interface AiResult {
  screenName: string;
  elements: AiElement[];
}

/** Codex 가 알려 주는 사용량 (turn.completed) */
export interface AiUsage {
  input: number;
  cachedInput: number;
  output: number;
}

type Provider = 'codex' | 'mock' | 'off';

const configDir = join(homedir(), '.config', 'ai-screen-sketch');
const tokenFile = join(configDir, 'ai-token');
const cacheDir = join(configDir, 'ai-cache');

export function readOrCreateToken(): string {
  mkdirSync(configDir, { recursive: true });
  if (!existsSync(tokenFile)) {
    writeFileSync(tokenFile, randomBytes(9).toString('base64url') + '\n');
    chmodSync(tokenFile, 0o600);
  }
  return readFileSync(tokenFile, 'utf8').trim();
}

function hasCommand(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

function pickProvider(): Provider {
  const v = (process.env.SKETCH_AI ?? '').toLowerCase();
  if (v === 'off' || v === 'mock') return v;
  if (v === 'codex' || v === '') return hasCommand('codex') ? 'codex' : 'off';
  return 'off';
}

/** Codex 가 지켜야 할 답 모양 (구조화 출력) -- 짧은 JSON 만 돌아오게 해 토큰을 줄인다 */
export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['screenName', 'elements'],
  properties: {
    screenName: { type: 'string' },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate', 'type', 'x', 'y', 'w', 'h', 'text', 'role'],
        properties: {
          candidate: { type: ['integer', 'null'] },
          type: { type: 'string', enum: [...ELEMENT_KINDS] },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          text: { type: 'string' },
          role: { type: 'string' },
        },
      },
    },
  },
};

export function buildPrompt(width: number, height: number, candidates: Candidate[], hint: string): string {
  const list = candidates.map((c) => `${c.id} ${c.kind} ${Math.round(c.x)} ${Math.round(c.y)} ${Math.round(c.w)} ${Math.round(c.h)}`).join('\n');
  return [
    `Label this UI sketch/screenshot for a wireframe tool. Image is ${width}x${height} px.`,
    'Local analysis already found these candidate boxes ("id kind x y w h", image px):',
    list || '(none)',
    'For each candidate: choose its UI type and copy its visible text exactly (any language; "" if none).',
    'Add an element only if it is clearly visible and missing above (candidate=null). Skip decoration.',
    'Types: region(area/panel), text, button, input, list, card, image, note(sticky memo), shape(plain drawn shape).',
    'role: short snake_case purpose in English or "". screenName: short name in the image language.',
    hint ? `User note: ${hint.slice(0, 300)}` : '',
    'Do not run commands or read files. Answer only with the JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

function clampResult(raw: unknown, width: number, height: number): AiResult {
  const r = raw as Partial<AiResult>;
  const els = Array.isArray(r?.elements) ? r.elements : [];
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  return {
    screenName: typeof r?.screenName === 'string' ? r.screenName.slice(0, 80) : '',
    elements: els.slice(0, 400).flatMap((e): AiElement[] => {
      if (!e || !ELEMENT_KINDS.includes(e.type)) return [];
      const w = num(e.w, width);
      const h = num(e.h, height);
      if (w < 2 || h < 2) return [];
      return [
        {
          candidate: typeof e.candidate === 'number' ? Math.round(e.candidate) : null,
          type: e.type,
          x: num(e.x, width),
          y: num(e.y, height),
          w,
          h,
          text: typeof e.text === 'string' ? e.text.slice(0, 500) : '',
          role: typeof e.role === 'string' ? e.role.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) : '',
        },
      ];
    }),
  };
}

/** 시험용: 후보를 그대로 요소로 */
function mockAnalyze(candidates: Candidate[]): AiResult {
  return {
    screenName: '분석한 화면',
    elements: candidates.map((c) => ({
      candidate: c.id,
      type: c.kind === 'text' ? 'text' : c.kind === 'fill' ? 'button' : 'region',
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      text: c.kind === 'text' ? `글 ${c.id}` : c.kind === 'fill' ? '버튼' : '',
      role: '',
    })),
  };
}

async function codexAnalyze(image: Buffer, ext: string, prompt: string, model: string | undefined): Promise<{ raw: unknown; usage?: AiUsage }> {
  const dir = await mkdtemp(join(tmpdir(), 'sketch-ai-'));
  try {
    const img = join(dir, `screen.${ext}`);
    await writeFile(img, image);
    await writeFile(join(dir, 'schema.json'), JSON.stringify(RESULT_SCHEMA));
    const args = [
      'exec',
      '--json', // 진행 이벤트 -- 마지막의 사용량(토큰)을 읽는다
      '--ephemeral', // 대화 기록을 남기지 않는다
      '--skip-git-repo-check',
      '-s', 'read-only', // 명령을 돌려도 아무것도 바꾸지 못하게
      '-C', dir, // 빈 임시 폴더에서
      '-c', 'model_reasoning_effort="low"', // 생각을 짧게 → 토큰 절약
      // 그림 분석에 필요 없는 도구를 끈다: 매번 붙는 도구 설명이 줄고(약 14.3k → 11.9k 토큰, 2026-11-03 측정),
      // 셸을 끄므로 명령을 아예 실행할 수 없다
      ...DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
      '-i', img,
      '--output-schema', join(dir, 'schema.json'),
      '-o', join(dir, 'out.json'),
      ...(model ? ['-m', model] : []),
      prompt,
    ];
    let usage: AiUsage | undefined;
    await new Promise<void>((resolve, reject) => {
      const p = spawn('codex', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => {
        out += d;
        let nl;
        while ((nl = out.indexOf('\n')) >= 0) {
          const line = out.slice(0, nl);
          out = out.slice(nl + 1);
          if (!line.includes('"usage"')) continue;
          try {
            const u = JSON.parse(line).usage;
            usage = { input: u.input_tokens ?? 0, cachedInput: u.cached_input_tokens ?? 0, output: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0) };
          } catch {
            // 사용량을 못 읽어도 분석은 그대로
          }
        }
      });
      let err = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      const timer = setTimeout(() => {
        p.kill('SIGTERM');
        reject(new Error('AI 분석이 너무 오래 걸려 멈췄습니다'));
      }, TIMEOUT_MS);
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`codex 가 실패했습니다 (${code}): ${err.split('\n').filter(Boolean).slice(-3).join(' / ')}`));
      });
    });
    return { raw: JSON.parse(await readFile(join(dir, 'out.json'), 'utf8')), usage };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function aiBridge(): Plugin {
  const provider = pickProvider();
  const model = process.env.SKETCH_AI_MODEL || undefined;
  const token = provider === 'off' ? '' : readOrCreateToken();
  let busy = false;

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    if (url === '/api/ai/status' && req.method === 'GET') {
      return send(res, 200, { available: provider !== 'off', provider, model: model ?? null, reason: provider === 'off' ? '이 서버에 AI 클라이언트(codex)가 없거나 SKETCH_AI=off 입니다' : null });
    }
    if (url !== '/api/ai/analyze') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'POST 만 됩니다' });
    if (provider === 'off') return send(res, 503, { error: 'AI 분석이 꺼져 있습니다' });
    const given = String(req.headers['x-sketch-token'] ?? '');
    if (!given || !sameToken(given, token)) return send(res, 401, { error: '토큰이 맞지 않습니다 -- 서버에서 npm run ai-token 으로 확인하세요' });
    if (busy) return send(res, 429, { error: '다른 분석이 진행 중입니다. 잠시 뒤 다시 해 주세요' });
    busy = true;
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { image?: string; width?: number; height?: number; candidates?: Candidate[]; hint?: string };
        const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? '');
        const width = Number(body.width);
        const height = Number(body.height);
        if (!m || !(width > 0 && width <= 4096) || !(height > 0 && height <= 4096)) return send(res, 400, { error: '그림 형식이 올바르지 않습니다' });
        const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 300).map((c, i) => ({
          id: Number.isInteger(c.id) ? c.id : i,
          kind: String(c.kind ?? '').replace(/[^a-z_]/g, '').slice(0, 20),
          x: +c.x || 0,
          y: +c.y || 0,
          w: +c.w || 0,
          h: +c.h || 0,
        }));
        const hint = typeof body.hint === 'string' ? body.hint : '';
        const image = Buffer.from(m[2], 'base64');
        const key = createHash('sha256').update(JSON.stringify([PROMPT_VERSION, provider, model ?? '', hint, candidates])).update(image).digest('hex');
        const cacheFile = join(cacheDir, `${key}.json`);
        if (existsSync(cacheFile)) return send(res, 200, { ...JSON.parse(readFileSync(cacheFile, 'utf8')), cached: true, ms: 0 });
        const t0 = Date.now();
        const run = provider === 'mock' ? { raw: mockAnalyze(candidates), usage: { input: 0, cachedInput: 0, output: 0 } } : await codexAnalyze(image, m[1] === 'jpeg' ? 'jpg' : m[1], buildPrompt(width, height, candidates, hint), model);
        const result = clampResult(run.raw, width, height);
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(result));
        send(res, 200, { ...result, usage: run.usage ?? null, cached: false, ms: Date.now() - t0 });
      } catch (e) {
        send(res, 500, { error: (e as Error).message });
      } finally {
        busy = false;
      }
    })();
  };

  return {
    name: 'sketch-ai-bridge',
    configureServer(server) {
      server.middlewares.use(handler);
      if (provider !== 'off') server.config.logger.info(`  ➜  AI 분석: ${provider}${model ? ` (${model})` : ''} -- 토큰은 npm run ai-token`);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
