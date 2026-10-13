// montar.mjs — renderiza escena.html fotograma a fotograma con Chromium (Playwright)
// y lo mezcla con música + narraciones en un MP4 (H.264 + AAC) con ffmpeg.
//
//   import { montar } from './montar.mjs';
//   const r = await montar({
//     timeline,                                   // ver escena.js / demo.mjs
//     narraciones: [{ archivo: '/abs/x.mp3', inicio: 6.4 }],
//     musicaWav: '/abs/musica.wav',               // generarMusica(timeline.duracion, …)
//     salida: '/abs/video.mp4',
//     fps: 30, ancho: 1280, alto: 720, carpetaTmp: '/abs/tmp',
//   });
//   // -> { salida, duracion, frames }
//
// Opciones extra (opcionales): paralelo (nº de pestañas que renderizan a la vez, def. 3),
// volumenMusica (0.5), volumenMusicaVoz (0.16, música bajo la voz), volumenVoz (1.0),
// volumenMusicaCantinela (0.34, música bajo los clips con tipo 'cantinela').
// Cada narración admite además (todo opcional):
//   volumen: multiplica volumenVoz para ese clip
//   tipo: 'cantinela' → no baja la música a volumenMusicaVoz sino a volumenMusicaCantinela
//   recortar: true → quita el silencio inicial (para que la palabra caiga justo en el pulso)
//   velocidad: 1.2 → la acelera (atempo, sin cambiar el tono)
//   maxDur: segundos → la corta (con fundido corto) para que no pise al clip siguiente
// Playwright: import(process.env.PLAYWRIGHT_MODULE || 'playwright'): el de npm install o, si está
// instalado en otro sitio, PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright/index.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

async function cargarChromium() {
  const candidatos = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  let ultimo;
  for (const c of candidatos) {
    try {
      const pw = await import(c);
      const chromium = pw.chromium || (pw.default && pw.default.chromium);
      if (chromium) return chromium;
    } catch (e) { ultimo = e; }
  }
  throw new Error('No encuentro playwright (define PLAYWRIGHT_MODULE): ' + (ultimo && ultimo.message));
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
// Convierte las capturas locales (file:// o ruta absoluta) en data: URLs para que el canvas
// no quede "tainted" y toDataURL funcione.
function incrustarCapturas(timeline) {
  const tl = JSON.parse(JSON.stringify(timeline));
  const cache = new Map();
  for (const e of tl.escenas) {
    for (const c of e.capturas || []) {
      const src = c.src;
      if (!src || src.startsWith('data:') || /^https?:/.test(src)) continue;
      const ruta = src.startsWith('file:') ? fileURLToPath(src) : resolve(src);
      if (!cache.has(ruta)) {
        if (!existsSync(ruta)) { console.warn('[montar] falta captura', ruta); cache.set(ruta, src); continue; }
        const mime = MIME[extname(ruta).toLowerCase()] || 'image/png';
        cache.set(ruta, `data:${mime};base64,${readFileSync(ruta).toString('base64')}`);
      }
      c.src = cache.get(ruta);
    }
  }
  return tl;
}

function duracionAudio(archivo) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', archivo], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : 0;
}

// Envolvente de volumen para la música: baja bajo la voz con rampas suaves.
function expresionDucking(intervalos, base, bajo) {
  if (!intervalos.length) return String(base);
  return `${base}-(${base - bajo})*${envolvente(intervalos)}`;
}
// 0..1: cuánto "dentro" de algún intervalo está t (con rampas)
function envolvente(intervalos) {
  // fusiona huecos cortos (<1.2 s) para que la música no "bombee" entre frases
  const ord = [...intervalos].sort((a, b) => a[0] - b[0]);
  const fus = [];
  for (const [a, b] of ord) {
    const u = fus[fus.length - 1];
    if (u && a - u[1] < 1.2) u[1] = Math.max(u[1], b); else fus.push([a, b]);
  }
  const SUBE = 0.6, BAJA = 0.3;
  const term = ([a, b]) => `clip(min((t-${(a - BAJA).toFixed(3)})/${BAJA},(${(b + SUBE).toFixed(3)}-t)/${SUBE}),0,1)`;
  let d = term(fus[0]);
  for (let i = 1; i < fus.length; i++) d = `max(${d},${term(fus[i])})`;
  return d;
}

export async function montar({
  timeline, narraciones = [], musicaWav, salida, fps = 30, ancho = 1280, alto = 720, carpetaTmp,
  paralelo, volumenMusica = 0.5, volumenMusicaVoz = 0.16, volumenVoz = 1.0, calidadJpeg = 0.92,
  volumenMusicaCantinela = 0.34,
}) {
  if (!timeline || !timeline.duracion) throw new Error('timeline.duracion obligatorio');
  if (!salida) throw new Error('salida obligatoria');
  const duracion = Number(timeline.duracion);
  const frames = Math.round(duracion * fps);
  carpetaTmp = carpetaTmp || mkdtempSync(join(tmpdir(), 'montar-'));
  mkdirSync(carpetaTmp, { recursive: true });
  mkdirSync(dirname(resolve(salida)), { recursive: true });
  const nPest = Math.max(1, paralelo || Math.min(3, Math.max(1, cpus().length - 1)));

  // ---------------- audio: grafo de filtros
  const entradas = [];
  const filtros = [];
  let idx = 1; // 0 = vídeo por tubería
  const intervalos = [];
  const intervalosCant = [];
  let musicaLbl = null;
  if (musicaWav && existsSync(musicaWav)) {
    entradas.push('-i', musicaWav);
    musicaLbl = `[${idx}:a]`; idx++;
  }
  const voces = [];
  for (const n of narraciones) {
    if (!n || !n.archivo || !existsSync(n.archivo)) { console.warn('[montar] narración no encontrada', n && n.archivo); continue; }
    const vel = Number(n.velocidad) > 0 ? Number(n.velocidad) : 1;
    let d = duracionAudio(n.archivo) / vel;
    const ini = Math.max(0, Number(n.inicio) || 0);
    const extra = [];
    if (n.recortar) extra.push('silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.02');
    if (vel !== 1) extra.push(`atempo=${vel.toFixed(4)}`);
    if (Number(n.maxDur) > 0) {
      const m = Number(n.maxDur), f = Math.min(0.08, m / 3);
      extra.push(`atrim=0:${m.toFixed(3)}`, `afade=t=out:st=${(m - f).toFixed(3)}:d=${f.toFixed(3)}`);
      d = Math.min(d, m);
    }
    (n.tipo === 'cantinela' ? intervalosCant : intervalos).push([ini, ini + d]);
    entradas.push('-i', n.archivo);
    const ms = Math.round(ini * 1000);
    const vol = volumenVoz * (n.volumen != null ? Number(n.volumen) : 1);
    filtros.push(`[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,${extra.map((x) => x + ',').join('')}adelay=${ms}|${ms},volume=${vol}[v${voces.length}]`);
    voces.push(`[v${voces.length}]`);
    idx++;
  }
  let mezcla;
  if (musicaLbl) {
    let expr = voces.length ? expresionDucking(intervalos, volumenMusica, volumenMusicaVoz) : String(volumenMusica);
    if (intervalosCant.length) {
      const ec = expresionDucking(intervalosCant, volumenMusica, volumenMusicaCantinela);
      expr = intervalos.length ? `min(${expr},${ec})` : ec;
    }
    filtros.push(`${musicaLbl}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume='${expr}':eval=frame[mus]`);
  } else {
    filtros.push(`anullsrc=r=44100:cl=stereo,atrim=0:${duracion}[mus]`);
  }
  if (voces.length) {
    filtros.push(`${voces.join('')}amix=inputs=${voces.length}:normalize=0:duration=longest[voz]`);
    filtros.push(`[mus][voz]amix=inputs=2:normalize=0:duration=first[mez]`);
    mezcla = '[mez]';
  } else mezcla = '[mus]';
  filtros.push(`${mezcla}apad=whole_dur=${duracion},atrim=0:${duracion},alimiter=limit=0.89:attack=5:release=80:level=false,aresample=44100[aout]`);

  const escalar = ancho !== 1280 || alto !== 720 ? ['-vf', `scale=${ancho}:${alto}:flags=lanczos`] : [];
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    ...entradas,
    '-filter_complex', filtros.join(';'),
    '-map', '0:v', '-map', '[aout]',
    ...escalar,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-t', String(duracion), '-movflags', '+faststart',
    salida,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'pipe'] });
  let errFF = '';
  ff.stderr.on('data', (d) => { errFF += d; });
  const finFF = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg salió con ' + c + '\n' + errFF)))));
  ff.stdin.on('error', () => {});

  // ---------------- vídeo: Chromium
  const chromium = await cargarChromium();
  const navegador = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-gpu-vsync', '--force-color-profile=srgb'] });
  const t0 = Date.now();
  try {
    const tl = incrustarCapturas(timeline);
    const url = pathToFileURL(join(AQUI, 'escena.html')).href;
    const pestanas = [];
    for (let i = 0; i < nPest; i++) {
      const ctxNav = await navegador.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const p = await ctxNav.newPage();
      p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.warn('[escena]', m.text()); });
      p.on('pageerror', (e) => console.error('[escena] error', e.message));
      await p.goto(url);
      const info = await p.evaluate((tlx) => window.cargar(tlx), tl);
      if (i === 0) console.log(`[montar] escena cargada: ${info.imagenes} imágenes, fuente pixel ${info.fuente ? 'OK' : 'NO (respaldo)'}; ${nPest} pestañas`);
      pestanas.push(p);
    }
    const renderLote = (p, desde, hasta) => p.evaluate(({ desde, hasta, fps, q }) => {
      const out = [];
      const c = window.__escena.lienzo;
      for (let i = desde; i < hasta; i++) { window.pintar(i / fps); out.push(c.toDataURL('image/jpeg', q)); }
      return out;
    }, { desde, hasta, fps, q: calidadJpeg });

    const LOTE = 6; // fotogramas por pestaña y vuelta
    const porVuelta = LOTE * nPest;
    const vuelta = (inicio) => Promise.all(pestanas.map((p, k) => {
      const a = Math.min(frames, inicio + k * LOTE), b = Math.min(frames, a + LOTE);
      return a < b ? renderLote(p, a, b) : Promise.resolve([]);
    }));
    const escribir = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });
    let siguiente = vuelta(0);
    let hecho = 0, ultimoLog = 0;
    for (let inicio = 0; inicio < frames; inicio += porVuelta) {
      const lotes = await siguiente;
      if (inicio + porVuelta < frames) siguiente = vuelta(inicio + porVuelta);
      for (const lote of lotes) for (const durl of lote) {
        await escribir(Buffer.from(durl.slice(durl.indexOf(',') + 1), 'base64'));
        hecho++;
      }
      if (hecho - ultimoLog >= 5 * fps || hecho === frames) {
        ultimoLog = hecho;
        const seg = (Date.now() - t0) / 1000;
        console.log(`[montar] ${(hecho / fps).toFixed(1)}/${duracion}s de vídeo (${hecho}/${frames} fotogramas) — ${seg.toFixed(1)}s, ${(hecho / seg).toFixed(1)} fps`);
      }
    }
  } finally {
    ff.stdin.end();
    await navegador.close();
  }
  await finFF;
  console.log(`[montar] listo: ${salida} en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { salida, duracion, frames };
}

// Pinta fotogramas sueltos (PNG) de una línea de tiempo, sin montar el vídeo. Útil para revisar.
//   await fotogramas({ timeline, tiempos: [1.5, 12], carpeta: '/abs/fotos' })  // -> [rutas]
export async function fotogramas({ timeline, tiempos, carpeta, prefijo = 'f' }) {
  const { writeFileSync } = await import('node:fs');
  mkdirSync(carpeta, { recursive: true });
  const chromium = await cargarChromium();
  const navegador = await chromium.launch({ args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
  const rutas = [];
  try {
    const p = await (await navegador.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
    p.on('pageerror', (e) => console.error('[escena] error', e.message));
    await p.goto(pathToFileURL(join(AQUI, 'escena.html')).href);
    await p.evaluate((tlx) => window.cargar(tlx), incrustarCapturas(timeline));
    for (const t of tiempos) {
      const durl = await p.evaluate((t) => { window.pintar(t); return window.__escena.lienzo.toDataURL('image/png'); }, t);
      const ruta = join(carpeta, `${prefijo}-${String(t.toFixed(2)).padStart(6, '0')}.png`);
      writeFileSync(ruta, Buffer.from(durl.slice(durl.indexOf(',') + 1), 'base64'));
      rutas.push(ruta);
    }
  } finally { await navegador.close(); }
  return rutas;
}
