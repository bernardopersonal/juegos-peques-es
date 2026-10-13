// Monta el vídeo "Los días de la semana" (~65 s), estilo youtuber en un mundo de bloques:
//   1. narración con la voz de ElevenLabs (cacheada en video/narracion/, no se vuelve a pagar)
//   2. un tren de 7 vagones (uno por día, con la rutina de js/familia.js) que llega vagón a vagón,
//      se para en la estación del FIN DE SEMANA y acaba con una cantinela de 3 rondas
//      (cada vez más rápida) encajada en el pulso de la música
//   3. la cantinela reutiliza los audios del juego: audio/<slug('¡Lunes!')>.mp3 … (no gasta TTS)
//   4. música chiptune (video/musica.mjs) y montaje fotograma a fotograma (video/montar.mjs)
//
// La rutina (actividad e icono de cada día) y la narración de lunes a viernes salen de js/familia.js
// (rutina.dias y videoDias.guion): sin ellas no hay vídeo de los días. El vídeo hecho se copia a mano
// a donde diga videoDias.archivo (media/dias.mp4).
//
// Uso: node scripts/hacer-video-dias.mjs              → video/dias.mp4 (necesita ElevenLabs y los audios del juego)
//      node scripts/hacer-video-dias.mjs --sin-voz    → video/dias-prueba.mp4 (narración muda y "blips" en la cantinela)
//      node scripts/hacer-video-dias.mjs --sin-voz --fotos 3 12.5 40   → solo fotogramas PNG en video/salida/fotos-dias/
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { raiz, tts, comprobarClave, VOZ_VIDEO, salir } from './elevenlabs.mjs';
import { generarMusica, tempoMusica } from '../video/musica.mjs';
import { montar, fotogramas } from '../video/montar.mjs';

const require = createRequire(import.meta.url);
const { slug } = require(join(raiz, 'js/frases.js'));
const args = process.argv.slice(2);
const sinVoz = args.includes('--sin-voz');
const iFotos = args.indexOf('--fotos');
const fotos = iFotos >= 0 ? args.slice(iFotos + 1).filter((a) => /^\d+(\.\d+)?$/.test(a)).map(Number) : null;

// La semana de la familia (mismo orden que el juego): actividad e icono de cada día, de js/familia.js
const FAMILIA = existsSync(join(raiz, 'js/familia.js')) ? require(join(raiz, 'js/familia.js')) : {};
const rutina = (FAMILIA.rutina && FAMILIA.rutina.dias) || [];
const guion = (FAMILIA.videoDias && FAMILIA.videoDias.guion) || {};
if (rutina.length !== 7 || rutina.some((d) => !d.actividad || !d.icono) || !guion.lm || !guion.mj || !guion.vi) {
  salir('js/familia.js no trae la rutina para el vídeo (rutina.dias: 7 días con actividad e icono) o el guion ' +
    '(videoDias.guion: lm, mj y vi). Sin eso no hay vídeo de los días.');
}
const SEMANA = [
  { nombre: 'Lunes', color: '#e53935', cole: true },
  { nombre: 'Martes', color: '#fb8c00', cole: true },
  { nombre: 'Miércoles', color: '#fdd835', cole: true },
  { nombre: 'Jueves', color: '#43a047', cole: true },
  { nombre: 'Viernes', color: '#1e88e5', cole: true },
  { nombre: 'Sábado', color: '#8e24aa', cole: false },
  { nombre: 'Domingo', color: '#f06292', cole: false },
];
const DIAS = SEMANA.map((d, i) => ({ nombre: d.nombre, actividad: rutina[i].actividad, color: d.color, icono: rutina[i].icono, cole: d.cole }));

// Guion: una frase por escena (caracteres de ElevenLabs contados; si cambias un texto, solo se regenera esa frase).
// Las de lunes a viernes (lm, mj, vi) son las de la familia y tienen que nombrar sus días.
const GUION = [
  { id: 'titulo', texto: '¡Hola, campeones! Hoy vamos a aprender los días de la semana. ¿Preparados?' },
  { id: 'tren', texto: 'La semana es como un tren con siete vagones. ¡Siempre van en el mismo orden!' },
  { id: 'lm', texto: guion.lm },
  { id: 'mj', texto: guion.mj },
  { id: 'vi', texto: guion.vi },
  { id: 'finde', texto: 'Sábado y domingo no hay cole: ¡es fin de semana!' },
  { id: 'cantinela', texto: '¡Ahora todos juntos!' },
  { id: 'final', texto: '¡Lo has conseguido! Ahora, a jugar con el tren de los días.' },
];
const G = Object.fromEntries(GUION.map((g) => [g.id, g]));

const dirVideo = join(raiz, 'video');
const dirNarr = join(dirVideo, 'narracion');
const dirSalida = join(dirVideo, 'salida');
const dirBlips = join(dirSalida, 'cantinela');
for (const d of [dirNarr, dirSalida, dirBlips]) mkdirSync(d, { recursive: true });

const duracion = (archivo) =>
  parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo]).toString());

// ---- 1. Clips de la cantinela: los audios del juego ("¡Lunes!" …) ----
const clipsDia = DIAS.map((d, i) => {
  const texto = '¡' + d.nombre + '!';
  const archivo = join(raiz, 'audio', slug(texto) + '.mp3');
  if (existsSync(archivo)) return { texto, archivo, real: true };
  if (!sinVoz) return { texto, archivo, falta: true };
  // prueba: un "blip" con una nota distinta por día para oír el ritmo
  const blip = join(dirBlips, `blip-${i}.wav`);
  if (!existsSync(blip)) {
    const f = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5][i];
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=f=${f}:d=0.2:r=44100`, '-af', 'afade=t=in:d=0.005,afade=t=out:st=0.08:d=0.12,volume=0.6', '-y', blip]);
  }
  return { texto, archivo: blip, real: false };
});
const faltan = clipsDia.filter((c) => c.falta);
if (faltan.length) {
  salir('Faltan los audios del juego para la cantinela:\n' + faltan.map((c) => `  ${c.texto}  →  audio/${slug(c.texto)}.mp3`).join('\n') +
    '\nGenera antes los audios del juego (npm run audios) con esas frases, o prueba con --sin-voz.');
}

// ---- 2. Narración ----
console.log('Narración…');
if (!sinVoz && !fotos) comprobarClave();
for (const e of GUION) {
  e.audio = join(dirNarr, (sinVoz ? 'muda-' : '') + slug(e.texto) + '.mp3');
  if (existsSync(e.audio)) continue;
  if (sinVoz) {
    const seg = (e.texto.length / 15).toFixed(2); // ~15 caracteres por segundo
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seg, '-q:a', '6', '-y', e.audio]);
  } else {
    if (fotos) salir('Para --fotos sin la narración ya generada, usa --sin-voz.');
    writeFileSync(e.audio, await tts(e.texto, VOZ_VIDEO));
    console.log('  ' + e.texto);
  }
  e.voz = undefined;
}
for (const e of GUION) e.voz = duracion(e.audio);

// ---- 3. Línea de tiempo ----
const ENTRADA = 0.7; // segundos de escena antes de que empiece a hablar
const SALIDA = 0.9; // segundos tras la narración antes de cambiar de escena
// instante (local) aproximado en que se dice una palabra: reparto proporcional a las letras
const cuando = (g, palabra, entrada = ENTRADA) => {
  const i = g.texto.toLowerCase().indexOf(palabra.toLowerCase());
  if (i < 0) throw new Error(`"${palabra}" no está en "${g.texto}"`);
  return +(entrada + g.voz * (i / g.texto.length)).toFixed(3);
};
const habla = (g, entrada = ENTRADA) => [[entrada, +(entrada + g.voz).toFixed(3)]];
const durNarr = (g, min, extra = 0) => Math.max(min, ENTRADA + g.voz + SALIDA + extra);

function construir(tempo) {
  const escenas = [];
  const narraciones = [];
  let t = 0;
  const poner = (g, escena, dur, entrada = ENTRADA) => {
    escenas.push({ inicio: +t.toFixed(3), fin: +(t + dur).toFixed(3), texto: g.texto, habla: habla(g, entrada), ...escena });
    narraciones.push({ archivo: g.audio, inicio: +(t + entrada).toFixed(3) });
    t += dur;
  };

  // Título con el presentador
  poner(G.titulo, { tipo: 'titulo', titulo: 'LOS DÍAS', subtitulo: '¡de la semana!', presentador: { x: 1000, desde: 0.5 }, megusta: { desde: 1.2, toque: 3.4 } }, durNarr(G.titulo, 6.5));

  // El tren llega vagón a vagón
  const llegadas = DIAS.map((_, i) => +(1.0 + i * 0.62).toFixed(2));
  poner(G.tren, { tipo: 'tren', velocidad: -120, llegadaLoco: 0.05, llegadas, numeros: true, contador: true, facecam: true },
    Math.max(durNarr(G.tren, 8), llegadas[6] + 2.2));

  // Lunes y martes
  const tl1 = cuando(G.lm, 'lunes'), tm = cuando(G.lm, 'martes');
  poner(G.lm, {
    tipo: 'tren', velocidad: -90, facecam: true,
    foco: [{ t: tl1, dias: [0] }, { t: tm, dias: [1] }],
    camara: [{ t: 0, dias: [0, 1], zoom: 1.35, dur: 0.8 }, { t: tm - 0.3, dias: [1], zoom: 1.45, dur: 0.7 }],
  }, durNarr(G.lm, 6.5, 0.4));

  // Miércoles y jueves
  const tx = cuando(G.mj, 'miércoles'), tj = cuando(G.mj, 'jueves');
  poner(G.mj, {
    tipo: 'tren', velocidad: -90, facecam: true,
    foco: [{ t: tx, dias: [2] }, { t: tj, dias: [3] }],
    camara: [{ t: 0, dias: [2], zoom: 1.45, dur: 0.8 }, { t: tj - 0.3, dias: [3], zoom: 1.45, dur: 0.7 }],
  }, durNarr(G.mj, 6.5, 0.4));

  // Viernes
  const tv = cuando(G.vi, 'viernes');
  poner(G.vi, {
    tipo: 'tren', velocidad: -90, facecam: true,
    foco: [{ t: tv, dias: [4] }],
    camara: [{ t: 0, dias: [3, 4], zoom: 1.2, dur: 0.6 }, { t: Math.max(0.6, tv - 0.3), dias: [4], zoom: 1.5, dur: 0.7 }],
  }, durNarr(G.vi, 4.5, 0.6));

  // Fin de semana: el tren frena en la estación (sábado y domingo en el andén) y aparece el cartel COLE
  const parada = 2.4;
  const tsd = cuando(G.finde, 'sábado'), tcole = cuando(G.finde, 'no hay cole'), tfin = Math.max(parada + 0.2, cuando(G.finde, 'es fin de semana'));
  poner(G.finde, {
    tipo: 'tren', facecam: true,
    velocidad: [[0, -380], [0.4, -380], [parada, 0]],
    estacion: { t: parada, cole: tcole, finde: tfin },
    foco: [{ t: tsd, dias: [5, 6], etiqueta: false }, { t: tcole, dias: [0, 1, 2, 3, 4], etiqueta: false }, { t: tfin, dias: [5, 6], etiqueta: false }],
  }, durNarr(G.finde, 7.5, 0.8));

  // Cantinela: "¡Ahora todos juntos!" + 3 rondas encajadas en el pulso (semicorcheas de la música)
  const ini = t;
  const entradaC = 0.5;
  const finNarr = ini + entradaC + G.cantinela.voz;
  const rejilla = 2 * tempo.negra; // medio compás
  const sigRejilla = (x) => Math.ceil(x / rejilla - 1e-6) * rejilla;
  const pasos = [0.75, 0.55, 0.42].map((s) => Math.max(2, Math.round(s / tempo.semi)));
  const vels = [-130, -250, -400];
  const golpes = [], carteles = [], clips = [], velocidad = [];
  let tr = sigRejilla(finNarr + 0.35);
  let ultimo = 0;
  for (let r = 0; r < 3; r++) {
    const paso = pasos[r] * tempo.semi;
    if (r > 0) {
      // hueco entre rondas: cartel "¡MÁS RÁPIDO!" y acelerón
      const hueco0 = ultimo + 0.7;
      tr = sigRejilla(hueco0 + 1.25);
      carteles.push({ t: +(hueco0 - ini).toFixed(3), texto: '¡MÁS RÁPIDO!', dur: +(tr - hueco0 - 0.1).toFixed(3) });
      velocidad.push([+(hueco0 - ini).toFixed(3), vels[r - 1]], [+(tr - ini - 0.15).toFixed(3), vels[r]]);
    } else velocidad.push([0, vels[0]]);
    for (let k = 0; k < 7; k++) {
      const tg = tr + k * paso;
      golpes.push({ t: +(tg - ini).toFixed(3), dia: k, ronda: r });
      clips.push({ archivo: clipsDia[k].archivo, inicio: +tg.toFixed(3), tipo: 'cantinela', recortar: true,
        velocidad: [1, 1.1, 1.22][r], maxDur: +(paso * 1.35).toFixed(3) });
      ultimo = tg;
    }
  }
  const durC = ultimo + 1.7 - ini;
  escenas.push({
    tipo: 'cantinela', inicio: +ini.toFixed(3), fin: +(ini + durC).toFixed(3), texto: G.cantinela.texto, textoHasta: +(golpes[0].t - 0.35).toFixed(3),
    facecam: true, habla: [[entradaC, +(entradaC + G.cantinela.voz).toFixed(3)], ...golpes.map((g) => [g.t, +(g.t + 0.28).toFixed(3)])],
    golpes, carteles, velocidad,
  });
  narraciones.push({ archivo: G.cantinela.audio, inicio: +(ini + entradaC).toFixed(3) });
  narraciones.push(...clips);
  t = ini + durC;

  // Final
  poner(G.final, { tipo: 'final', titulo: '¡LO HAS CONSEGUIDO!', presentador: { x: 1010, desde: 0.3 }, megusta: { desde: 0.6, toque: 2.2, base: 1999 } }, durNarr(G.final, 7.5, 1.5));

  return { timeline: { duracion: +t.toFixed(3), escenas, dias: DIAS, logo: 'Juegos peques' }, narraciones, golpes, pasos };
}

// El tempo depende de la duración total (generarMusica lo ajusta a ella) y la cantinela depende
// del tempo. Se elige un tempo y luego se alarga un poco el final para que la duración total
// sea justo la que produce ese tempo: así los golpes caen en la rejilla de la música.
const tempoDe = (bpm, compases) => { const negra = 60 / bpm; return { bpm, compases, negra, semi: negra / 4, compas: negra * 4 }; };
let tempo = tempoMusica(65), plan;
for (let i = 0; i < 8; i++) tempo = tempoMusica(construir(tempo).timeline.duracion);
for (let bpm = tempo.bpm; ; bpm *= 0.9995) {
  const tp = tempoDe(bpm, tempo.compases);
  plan = construir(tp);
  const tObj = 240 * tp.compases / bpm + tempoMusica(plan.timeline.duracion).cola;
  if (tObj + 1e-6 >= plan.timeline.duracion && tempoMusica(tObj).compases === tp.compases) {
    const fin = plan.timeline.escenas[plan.timeline.escenas.length - 1];
    fin.fin = plan.timeline.duracion = +tObj.toFixed(4);
    break;
  }
  if (bpm < 120) throw new Error('No encuentro un tempo que encaje con la cantinela');
}
{ // comprobación: desfase de los golpes respecto a la rejilla de la música final
  const tf = tempoMusica(plan.timeline.duracion);
  const ini = plan.timeline.escenas.find((e) => e.tipo === 'cantinela').inicio;
  const err = Math.max(...plan.golpes.map((g) => { const x = (ini + g.t) / tf.semi; return Math.abs(x - Math.round(x)) * tf.semi; }));
  console.log(`Tempo ${tf.bpm.toFixed(2)} BPM; cantinela cada ${plan.pasos.map((p) => (p * tf.semi).toFixed(2) + ' s').join(' / ')}; desfase máx. ${(err * 1000).toFixed(1)} ms`);
}
const { timeline, narraciones } = plan;
writeFileSync(join(dirSalida, 'timeline-dias.json'), JSON.stringify(timeline, null, 1));
console.log(`Duración total: ${timeline.duracion.toFixed(1)} s`);
const reales = clipsDia.filter((c) => c.real).length;
console.log(`Cantinela: ${reales}/7 audios del juego${reales < 7 ? ' (el resto, blips de prueba)' : ''}`);

if (fotos) {
  const rutas = await fotogramas({ timeline, tiempos: fotos, carpeta: join(dirSalida, 'fotos-dias'), prefijo: 'dias' });
  console.log(rutas.join('\n'));
  process.exit(0);
}

// ---- 4. Música y montaje ----
console.log('Música…');
const musica = join(dirSalida, 'musica-dias.wav');
const infoMus = generarMusica(timeline.duracion, musica);
console.log(`  ${infoMus.bpm.toFixed(2)} BPM, ${infoMus.compases} compases`);

console.log('Montando el vídeo…');
const salida = join(dirVideo, sinVoz ? 'dias-prueba.mp4' : 'dias.mp4');
const t0 = Date.now();
const res = await montar({ timeline, narraciones, musicaWav: musica, salida, fps: 30, carpetaTmp: join(dirSalida, 'tmp-dias') });
console.log(`Listo: ${res.salida} (${res.duracion.toFixed(1)} s, ${res.frames} fotogramas, ${((Date.now() - t0) / 1000).toFixed(0)} s de montaje)`);
