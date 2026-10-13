// Monta el vídeo explicativo (~1 minuto):
//   1. captura pantallas reales del juego (scripts/video-capturas.mjs)
//   2. narración con la voz de ElevenLabs (se guarda en video/narracion/ y no se vuelve a pagar)
//   3. música chiptune hecha por código (video/musica.mjs)
//   4. mundo de bloques + unicornio + capturas, fotograma a fotograma (video/escena.html, video/montar.mjs)
//
// Uso: node scripts/hacer-video.mjs            (la clave de ElevenLabs solo hace falta si falta alguna narración)
//      node scripts/hacer-video.mjs --sin-voz  (prueba sin gastar créditos: narración muda)
// Las capturas salen de la web de esta carpeta: con los niños con voz de js/familia.js o, sin ellos,
// con dos perfiles inventados (scripts/video-capturas.mjs). Con toda la narración ya en video/narracion/,
// no hace falta la clave de ElevenLabs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { raiz, tts, comprobarClave, VOZ_VIDEO } from './elevenlabs.mjs';
import { capturar } from './video-capturas.mjs';
import { GUION } from './guion-video.mjs';
import { generarMusica } from '../video/musica.mjs';
import { montar } from '../video/montar.mjs';

const require = createRequire(import.meta.url);
const { slug } = require(join(raiz, 'js/frases.js'));
const sinVoz = process.argv.includes('--sin-voz');

// Guion (una frase por escena): scripts/guion-video.mjs

const dirVideo = join(raiz, 'video');
const dirNarr = join(dirVideo, 'narracion');
const dirSalida = join(dirVideo, 'salida');
mkdirSync(dirNarr, { recursive: true });
mkdirSync(dirSalida, { recursive: true });

const duracion = (archivo) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo]).toString());

// ---- 1. Narración ----
console.log('Narración…');
for (const e of GUION) e.audio = join(dirNarr, (sinVoz ? 'muda-' : '') + slug(e.texto) + '.mp3');
if (!sinVoz && GUION.some((e) => !existsSync(e.audio))) comprobarClave(); // solo si hay que pagar alguna
for (const e of GUION) {
  if (existsSync(e.audio)) continue;
  if (sinVoz) {
    const seg = (e.texto.length / 15).toFixed(2); // ~15 caracteres por segundo
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seg, '-q:a', '6', '-y', e.audio]);
  } else {
    writeFileSync(e.audio, await tts(e.texto, VOZ_VIDEO));
    console.log('  ' + e.texto);
  }
}

// ---- 2. Capturas del juego ----
console.log('Capturas del juego…');
const capturas = Object.fromEntries((await capturar(join(dirSalida, 'capturas'))).map((c) => [c.id, c]));

// ---- 3. Línea de tiempo: cada escena dura lo que su narración (+ aire) ----
const ENTRADA = 0.7; // segundos de escena antes de que empiece a hablar
const SALIDA = 0.9; // segundos tras la narración antes de cambiar de escena
let t = 0;
const escenas = [];
const narraciones = [];
for (const e of GUION) {
  const voz = duracion(e.audio);
  const dur = Math.max(e.min, ENTRADA + voz + SALIDA + (e.tipo === 'final' ? 1.5 : 0));
  const escena = { tipo: e.tipo || 'capturas', inicio: +t.toFixed(3), fin: +(t + dur).toFixed(3), titulo: e.titulo, texto: e.texto };
  const c = capturas[e.id];
  if (c) {
    escena.capturas = c.capturas.map((x) => ({ src: pathToFileURL(x.archivo).href, desde: +(x.desde * dur).toFixed(3), hasta: +(x.hasta * dur).toFixed(3) }));
    escena.dedo = c.dedo.map((d) => ({ t: +(d.f * dur).toFixed(3), x: d.x, y: d.y, toque: d.toque }));
  }
  escenas.push(escena);
  narraciones.push({ archivo: e.audio, inicio: +(t + ENTRADA).toFixed(3) });
  t += dur;
}
const timeline = { duracion: +t.toFixed(3), escenas };
writeFileSync(join(dirSalida, 'timeline.json'), JSON.stringify(timeline, null, 1));
console.log(`Duración total: ${timeline.duracion.toFixed(1)} s`);

// ---- 4. Música y montaje ----
console.log('Música…');
const musica = join(dirSalida, 'musica.wav');
await generarMusica(timeline.duracion, musica);

console.log('Montando el vídeo…');
const salida = join(dirVideo, sinVoz ? 'juegos-peques-prueba.mp4' : 'juegos-peques.mp4');
const res = await montar({ timeline, narraciones, musicaWav: musica, salida, fps: 30, carpetaTmp: join(dirSalida, 'tmp') });
console.log(`Listo: ${res.salida} (${res.duracion.toFixed(1)} s, ${res.frames} fotogramas)`);
