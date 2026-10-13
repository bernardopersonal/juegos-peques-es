// demo.mjs — prueba completa del kit de vídeo con datos de ejemplo.
//
//   node video/demo.mjs [carpetaSalida] [--solo-fotos [t1 t2 …]] [--reusar] [--sin-capturas]
//   (Playwright: el de npm install o PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright/index.mjs.
//   Sin carpetaSalida, video/salida/demo/.)
//
// 1. Captura pantallas reales del juego (../index.html) con Playwright a 1024×768
//    (si algo falla, crea una imagen de relleno de color).
// 2. Crea narraciones mudas de relleno (MP3 con anullsrc) de duración verosímil.
// 3. Genera la música (musica.mjs), monta el vídeo (montar.mjs) y extrae un fotograma por escena.
// --solo-fotos: no monta el MP4; pinta directamente los fotogramas de muestra (o los segundos dados).
// --reusar: reutiliza <salida>/capturas en vez de volver a capturar el juego. --sin-capturas: solo rellenos.

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generarMusica } from './musica.mjs';
import { montar } from './montar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const JUEGO = resolve(AQUI, '..', 'index.html');
const args = process.argv.slice(2);
const SALIDA = resolve(args.find((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a)) || join(AQUI, 'salida', 'demo'));
const SOLO_FOTOS = args.includes('--solo-fotos');
const SIN_CAPTURAS = args.includes('--sin-capturas');
const CAPS = join(SALIDA, 'capturas'), VOCES = join(SALIDA, 'voces');
for (const d of [SALIDA, CAPS, VOCES]) mkdirSync(d, { recursive: true });

async function chromiumPW() {
  for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
    try { const pw = await import(c); return pw.chromium || pw.default.chromium; } catch { /* siguiente */ }
  }
  throw new Error('playwright no encontrado');
}
const sh = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(cmd + ' ' + a.join(' ') + '\n' + r.stderr); return r.stdout; };

function relleno(nombre, color) {
  const ruta = join(CAPS, nombre + '.png');
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=1024x768`, '-frames:v', '1', ruta]);
  return ruta;
}

// ---------------------------------------------------------------- 1. capturas del juego
async function capturar() {
  const R = {};
  const chromium = await chromiumPW();
  const nav = await chromium.launch();
  const ctxNav = await nav.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: false });
  const p = await ctxNav.newPage();
  p.setDefaultTimeout(3000);
  p.on('pageerror', (e) => console.warn('[juego] error:', e.message));
  const foto = async (n) => { const r = join(CAPS, n + '.png'); await p.screenshot({ path: r }); R[n] = r; return r; };
  const inicio = async () => { await p.goto(pathToFileURL(JUEGO).href); await p.waitForTimeout(600); };
  const paso = async (nombre, fn) => { try { await fn(); } catch (e) { console.warn(`[capturas] ${nombre}: ${e.message.split('\n')[0]}`); } };
  const entrarPerfil = async (i) => { await p.locator('.perfil .entrar').nth(i).click(); await p.waitForTimeout(700); };
  // abre un juego por su data-juego o por el texto de la tarjeta (el juego cambia a menudo)
  const juego = async (id, texto) => {
    const porId = p.locator(`[data-juego="${id}"]`);
    const loc = (await porId.count()) ? porId.first() : p.locator('.tarjeta', { hasText: new RegExp(texto, 'i') }).first();
    await loc.click(); await p.waitForTimeout(1100);
  };
  // localiza un perfil "mayor" (menú normal) y uno "peque"
  let iMayor = 0, iPeque = -1;
  await paso('perfiles', async () => {
    await inicio();
    const n = await p.locator('.perfil:not(.nuevo) .entrar').count();
    for (let i = 0; i < n; i++) {
      await inicio(); await entrarPerfil(i);
      const peque = await p.evaluate(() => !!document.querySelector('.peques'));
      if (peque && iPeque < 0) iPeque = i;
      if (!peque) iMayor = i;
    }
  });
  await paso('inicio', async () => { await inicio(); await foto('inicio'); });
  await paso('menu', async () => { await entrarPerfil(iMayor); await foto('menu'); });
  await paso('peques', async () => {
    if (iPeque < 0) return;
    await inicio(); await entrarPerfil(iPeque); await foto('peques');
    const t = p.locator('.tarjeta').nth(1);
    if (await t.count()) { await t.click(); await p.waitForTimeout(1100); await foto('peques-2'); }
  });
  await paso('trazar', async () => {
    await inicio(); await entrarPerfil(iMayor); await juego('trazar', 'trazar'); await foto('elegir');
    const b = p.locator('#rejilla-numeros > *').nth(1);
    await b.click(); await p.waitForTimeout(900); await foto('trazar');
    const caja = await p.locator('#lienzo').boundingBox();
    if (!caja) throw new Error('sin lienzo');
    // trazo de un "1": diagonal corta y bajada, en 10 fotogramas
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const k = i / 30;
      const x = k < 0.25 ? 0.42 + (k / 0.25) * 0.1 : 0.52, y = k < 0.25 ? 0.32 - (k / 0.25) * 0.1 : 0.22 + ((k - 0.25) / 0.75) * 0.6;
      pts.push([caja.x + caja.width * x, caja.y + caja.height * y]);
    }
    await p.mouse.move(...pts[0]); await p.mouse.down();
    let f = 0;
    for (let i = 1; i < pts.length; i++) {
      await p.mouse.move(...pts[i], { steps: 2 });
      if (i % 3 === 0) await foto('trazo-' + String(f++).padStart(2, '0'));
    }
    await p.mouse.up(); await p.waitForTimeout(900); await foto('trazo-fin');
  });
  for (const [j, txt] of [['sonidos', 'sonidos'], ['silabas', 's[ií]labas'], ['palabras', 'palabras']]) {
    await paso(j, async () => {
      await inicio(); await entrarPerfil(iMayor); await juego(j, txt); await foto(j);
      const op = p.locator('#opciones > *').first();
      if (await op.count()) { await op.click(); await p.waitForTimeout(700); await foto(j + '-2'); }
    });
  }
  await nav.close();
  return R;
}

// ---------------------------------------------------------------- 2. timeline
function construirTimeline(C) {
  const f = (n, color) => pathToFileURL(C[n] || relleno(n, color)).href;
  const trazos = Object.keys(C).filter((k) => k.startsWith('trazo-') && k !== 'trazo-fin').sort();
  const flip = [];
  let t = 3.2;
  for (const k of trazos) { flip.push({ src: f(k), desde: t, hasta: t + 0.3 }); t += 0.3; }
  const escenas = [
    { tipo: 'titulo', inicio: 0, fin: 6.5, titulo: 'JUEGOS PEQUES', texto: '¡Bienvenidos a Juegos peques! Juegos para aprender letras, números y palabras.' },
    { tipo: 'capturas', inicio: 6.5, fin: 13.5, titulo: 'Elige tu jugador', texto: 'Primero, elige tu jugador. Cada niño tiene su foto, su tema y sus estrellas.',
      capturas: [{ src: f('inicio', '#ffd6a5'), desde: 0, hasta: 3.4 }, { src: f('menu', '#caffbf'), desde: 3.4, hasta: 7 }],
      dedo: [{ t: 1.2, x: 0.3, y: 0.45 }, { t: 2.4, x: 0.36, y: 0.48, toque: true }, { t: 4.6, x: 0.55, y: 0.5 }] },
    { tipo: 'capturas', inicio: 13.5, fin: 23.5, titulo: 'Trazar', texto: 'En Trazar, sigue el camino con el dedo y aprende a escribir números y letras. ¡Muy bien!',
      capturas: [{ src: f('elegir', '#9bf6ff'), desde: 0, hasta: 2.2 }, { src: f('trazar', '#a0c4ff'), desde: 2.2, hasta: 3.2 }, ...flip,
        { src: f('trazo-fin', '#bdb2ff'), desde: t, hasta: 10 }],
      dedo: [{ t: 0.9, x: 0.4, y: 0.3 }, { t: 1.6, x: 0.25, y: 0.3, toque: true }] },
    { tipo: 'capturas', inicio: 23.5, fin: 31, titulo: 'Para los más peques', texto: 'Para los más peques, todo es más sencillo: botones grandes y mucha ayuda.',
      capturas: [{ src: f('peques', '#ffc6ff'), desde: 0, hasta: 3.6 }, { src: f('peques-2', '#ffc6ff'), desde: 3.6, hasta: 7.5 }],
      dedo: [{ t: 2.2, x: 0.5, y: 0.25 }, { t: 3.2, x: 0.5, y: 0.55, toque: true }] },
    { tipo: 'capturas', inicio: 31, fin: 38.5, titulo: 'Sonidos', texto: 'En Sonidos, escucha con atención y toca la letra que suena.',
      capturas: [{ src: f('sonidos', '#fdffb6'), desde: 0, hasta: 3.8 }, { src: f('sonidos-2', '#fdffb6'), desde: 3.8, hasta: 7.5 }],
      dedo: [{ t: 2.4, x: 0.5, y: 0.6 }, { t: 3.6, x: 0.3, y: 0.75, toque: true }] },
    { tipo: 'capturas', inicio: 38.5, fin: 46, titulo: 'Sílabas', texto: 'En Sílabas, juntamos sonidos para formar palabras.',
      capturas: [{ src: f('silabas', '#caffbf'), desde: 0, hasta: 3.8 }, { src: f('silabas-2', '#caffbf'), desde: 3.8, hasta: 7.5 }] },
    { tipo: 'capturas', inicio: 46, fin: 54, titulo: 'Palabras', texto: 'Y en Palabras, lee y elige el dibujo correcto. ¡Cada acierto suma estrellas!',
      capturas: [{ src: f('palabras', '#ffd6a5'), desde: 0, hasta: 4 }, { src: f('palabras-2', '#ffd6a5'), desde: 4, hasta: 8 }],
      dedo: [{ t: 2.6, x: 0.6, y: 0.55 }, { t: 3.7, x: 0.7, y: 0.75, toque: true }] },
    { tipo: 'final', inicio: 54, fin: 62.5, titulo: '¡A JUGAR!', texto: '¡Gana estrellas y diviértete aprendiendo! ¡A jugar!' },
  ];
  return { duracion: 62.5, escenas };
}

// ---------------------------------------------------------------- 3. narraciones de relleno
function narracionesFalsas(tl) {
  return tl.escenas.map((e, i) => {
    const d = Math.min(e.fin - e.inicio - 1.0, Math.max(1.5, e.texto.length / 15));
    const archivo = join(VOCES, `voz-${i}.mp3`);
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', d.toFixed(2), '-c:a', 'libmp3lame', '-b:a', '64k', archivo]);
    return { archivo, inicio: e.inicio + 0.4 };
  });
}

function tiemposMuestra(tl) {
  return tl.escenas.map((e) => {
    if (e.tipo === 'titulo') return Math.min(e.fin - 0.5, e.inicio + 4.2);
    if (e.tipo === 'final') return e.inicio + 2.4;
    return e.inicio + (e.fin - e.inicio) * 0.45;
  }).concat([tl.duracion - 0.3]);
}

async function fotosDirectas(tl, tiempos) {
  const chromium = await chromiumPW();
  const nav = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const p = await nav.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.error('[escena]', e.message));
  p.on('console', (m) => console.log('[escena]', m.text()));
  await p.goto(pathToFileURL(join(AQUI, 'escena.html')).href);
  console.log(await p.evaluate((x) => window.cargar(x), tl));
  const rutas = [];
  for (const t of tiempos) {
    await p.evaluate((tt) => window.pintar(tt), t);
    const r = join(SALIDA, `foto-${t.toFixed(2).padStart(5, '0')}.png`);
    await p.locator('canvas').screenshot({ path: r });
    rutas.push(r);
  }
  await nav.close();
  return rutas;
}

// ---------------------------------------------------------------- main
const t0 = Date.now();
const REUSAR = args.includes('--reusar'); // reutiliza las capturas ya guardadas en <salida>/capturas
const C = SIN_CAPTURAS ? {} : REUSAR
  ? Object.fromEntries(readdirSync(CAPS).filter((f) => f.endsWith('.png')).map((f) => [f.slice(0, -4), join(CAPS, f)]))
  : await capturar();
console.log('[demo] capturas:', Object.keys(C).join(', ') || '(ninguna, se usan rellenos)');
const timeline = construirTimeline(C);
writeFileSync(join(SALIDA, 'timeline.json'), JSON.stringify(timeline, null, 2));
const extra = args.filter((a) => /^\d+(\.\d+)?$/.test(a)).map(Number);
if (SOLO_FOTOS) {
  const rutas = await fotosDirectas(timeline, extra.length ? extra : tiemposMuestra(timeline));
  console.log('[demo] fotos:\n' + rutas.join('\n'));
} else {
  const narraciones = narracionesFalsas(timeline);
  const musicaWav = join(SALIDA, 'musica.wav');
  const tm = Date.now();
  const info = generarMusica(timeline.duracion, musicaWav);
  console.log(`[demo] música ${info.bpm.toFixed(1)} BPM, ${info.compases} compases en ${((Date.now() - tm) / 1000).toFixed(1)}s`);
  const tr = Date.now();
  const r = await montar({ timeline, narraciones, musicaWav, salida: join(SALIDA, 'demo.mp4'), fps: 30, carpetaTmp: join(SALIDA, 'tmp') });
  console.log(`[demo] render ${((Date.now() - tr) / 1000).toFixed(1)}s →`, r);
  tiemposMuestra(timeline).forEach((t, i) => {
    const ruta = join(SALIDA, `fotograma-${i + 1}-${t.toFixed(1)}s.png`);
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', r.salida, '-frames:v', '1', ruta]);
    console.log('[demo] fotograma', ruta);
  });
  console.log(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'compact', r.salida]));
}
console.log(`[demo] total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!existsSync(SALIDA)) process.exit(1);
