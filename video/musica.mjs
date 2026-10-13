// musica.mjs — chiptune "épico" sintetizado en JS puro (sin muestras, sin dependencias).
//
//   import { generarMusica } from './musica.mjs';
//   const info = generarMusica(62.5, '/tmp/musica.wav');   // SÍNCRONA
//   // -> { ruta, segundos, bpm, compases }
//   tempoMusica(62.5)  // -> { bpm, compases, negra, semi, compas, cola } sin generar nada
//                      //    (pulsos en k*negra desde t=0, para encajar cantinelas en el ritmo)
//
// Escribe un WAV PCM 44.1 kHz, 16 bit, estéreo, de exactamente `segundos`
// (round(segundos*44100) muestras). Todo es determinista (ruido con PRNG fijo).
//
// Estructura (se adapta a la duración ajustando ligeramente el tempo, ~130-142 BPM):
//   intro (2 compases, redoble + arpegio creciente) → tema A (8) → tema B (8)
//   → A' / B' con armonía y más batería … → fanfarria (4 compases)
//   → acorde final sostenido (~2.5 s) con fundido en los últimos 1.5 s.
// Tonalidad La menor (Am–F–C–G) que acaba en Do mayor heroico.

import { writeFileSync } from 'node:fs';

const SR = 44100;
const COLA = 2.6; // segundos de acorde final sostenido

// ---------- utilidades ----------
const NOTA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(n) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error('nota inválida ' + n);
  return 12 * (Number(m[3]) + 1) + NOTA[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
function parseFrase(s) {
  // "E5:2 A5:2 -:4" → [{m|null, d}] (d en semicorcheas)
  return s.trim().split(/\s+/).map((tok) => {
    const [n, d] = tok.split(':');
    return { m: n === '-' ? null : midi(n), d: Number(d) };
  });
}
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296 * 2 - 1;
  };
}

// ---------- acordes ----------
const ACORDES = {
  Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'], C: ['C', 'E', 'G'], G: ['G', 'B', 'D'],
  E: ['E', 'G#', 'B'], Dm: ['D', 'F', 'A'], Em: ['E', 'G', 'B'],
};
function pc(n) { return ((NOTA[n[0]] + (n[1] === '#' ? 1 : 0)) % 12 + 12) % 12; }
function tonosAcorde(nombre) { return ACORDES[nombre].map(pc); }
// tono del acorde más cercano por debajo (≥3 semitonos) para la armonía
function armonia(m, acorde) {
  const t = tonosAcorde(acorde);
  for (let k = m - 3; k > m - 12; k--) if (t.includes(((k % 12) + 12) % 12)) return k;
  return m - 12;
}

// ---------- partitura ----------
const A_ACORDES = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'];
const A_MELO = [
  'E5:2 A5:2 A5:2 B5:2 C6:4 B5:2 A5:2',
  'C6:2 A5:2 F5:4 G5:2 A5:2 G5:2 F5:2',
  'E5:2 G5:2 C6:4 D6:2 C6:2 G5:4',
  'B5:4 A5:2 G5:2 D5:6 -:2',
  'E5:2 A5:2 A5:2 B5:2 C6:4 B5:2 A5:2',
  'C6:2 A5:2 F5:2 A5:2 C6:4 D6:4',
  'D6:2 B5:2 G5:2 B5:2 D6:4 E6:4',
  'E6:6 D6:2 B5:4 G#5:4',
];
const B_ACORDES = ['F', 'G', 'C', 'Am', 'Dm', 'G', 'C', 'E'];
const B_MELO = [
  'A5:4 C6:4 F5:4 A5:2 C6:2',
  'D6:4 B5:4 G5:4 A5:2 B5:2',
  'C6:4 E6:4 G5:4 E6:2 C6:2',
  'E6:6 D6:2 C6:4 A5:4',
  'F5:2 A5:2 D6:4 F5:2 A5:2 D6:4',
  'G5:2 B5:2 D6:4 G5:2 B5:2 D6:4',
  'E6:4 D6:2 C6:2 D6:4 E6:4',
  'E6:4 B5:4 G#5:4 B5:4',
];
const FAN_ACORDES = ['F', 'G', 'F|G', 'G'];
const FAN_MELO = [
  'C5:1.3333 C5:1.3333 C5:1.3334 F5:4 A5:4 C6:4',
  'D5:1.3333 D5:1.3333 D5:1.3334 G5:4 B5:4 D6:4',
  'A5:2 F5:2 A5:2 C6:2 B5:2 G5:2 B5:2 D6:2',
  'G5:2 B5:2 D6:4 D6:1.3333 C6:1.3333 D6:1.3334 B5:4',
];

// ---------- síntesis ----------
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

class Bus {
  constructor(n) { this.L = new Float32Array(n); this.R = new Float32Array(n); this.n = n; }
}

function tocarPulso(bus, { t0, dur, m, vol, pan = 0, duty = 0.25, vib = 0, ataque = 0.006, liberar = 0.04, sostener = 0.75, decaer = 0.12, glide = 0 }) {
  const i0 = Math.max(0, Math.round(t0 * SR));
  const nOn = Math.round(dur * SR);
  const nRel = Math.round(liberar * SR);
  const i1 = Math.min(bus.n, i0 + nOn + nRel);
  const f0 = hz(m);
  const gL = Math.sqrt((1 - pan) / 2) * Math.SQRT2, gR = Math.sqrt((1 + pan) / 2) * Math.SQRT2;
  let fase = 0;
  for (let i = i0; i < i1; i++) {
    const k = i - i0, tt = k / SR;
    let f = f0;
    if (vib && tt > 0.12) f *= Math.pow(2, (vib * Math.sin(2 * Math.PI * 5.6 * (tt - 0.12)) * Math.min(1, (tt - 0.12) * 4)) / 12);
    if (glide && tt < glide) f *= Math.pow(2, (-1 + tt / glide) * 1 / 12);
    const dt = f / SR;
    fase += dt; if (fase >= 1) fase -= 1;
    let v = (fase < duty ? 1 : -1);
    v += polyblep(fase, dt);
    let fd = fase - duty; if (fd < 0) fd += 1;
    v -= polyblep(fd, dt);
    // envolvente
    let env;
    if (k < ataque * SR) env = k / (ataque * SR);
    else if (tt < ataque + decaer) env = 1 - (1 - sostener) * ((tt - ataque) / decaer);
    else env = sostener;
    if (k >= nOn) env *= Math.max(0, 1 - (k - nOn) / nRel);
    const s = v * env * vol;
    bus.L[i] += s * gL; bus.R[i] += s * gR;
  }
}

function tocarTriangulo(bus, { t0, dur, m, vol }) {
  const i0 = Math.round(t0 * SR), nOn = Math.round(dur * SR), nRel = Math.round(0.02 * SR);
  const i1 = Math.min(bus.n, i0 + nOn + nRel);
  const f = hz(m);
  let fase = 0;
  for (let i = i0; i < i1; i++) {
    const k = i - i0;
    fase += f / SR; if (fase >= 1) fase -= 1;
    // triángulo cuantizado a 16 niveles (sabor 8-bit)
    let tri = fase < 0.5 ? fase * 4 - 1 : 3 - fase * 4;
    tri = Math.round(tri * 7.5) / 7.5;
    let env = Math.min(1, k / (0.003 * SR));
    if (k >= nOn) env *= Math.max(0, 1 - (k - nOn) / nRel);
    const s = tri * env * vol;
    bus.L[i] += s; bus.R[i] += s;
  }
}

const ruido = prng(0xC0FFEE);
function bombo(bus, t0, vol) {
  const i0 = Math.round(t0 * SR), n = Math.round(0.28 * SR);
  let fase = 0;
  for (let k = 0; k < n && i0 + k < bus.n; k++) {
    const tt = k / SR;
    const f = 45 + 120 * Math.exp(-tt * 28);
    fase += f / SR;
    let s = Math.sin(2 * Math.PI * fase) * Math.exp(-tt * 11);
    if (k < 0.004 * SR) s += ruido() * 0.5 * (1 - k / (0.004 * SR));
    s *= vol;
    bus.L[i0 + k] += s; bus.R[i0 + k] += s;
  }
}
function caja(bus, t0, vol) {
  const i0 = Math.round(t0 * SR), n = Math.round(0.2 * SR);
  let lp = 0, fase = 0;
  for (let k = 0; k < n && i0 + k < bus.n; k++) {
    const tt = k / SR;
    const r = ruido();
    lp += 0.45 * (r - lp);
    fase += (190 - 60 * Math.min(1, tt * 20)) / SR;
    const s = (lp * 0.9 * Math.exp(-tt * 18) + Math.sin(2 * Math.PI * fase) * 0.5 * Math.exp(-tt * 30)) * vol;
    bus.L[i0 + k] += s; bus.R[i0 + k] += s;
  }
}
function charles(bus, t0, vol, largo = 0.05) {
  const i0 = Math.round(t0 * SR), n = Math.round(largo * 1.5 * SR);
  let prev = 0;
  for (let k = 0; k < n && i0 + k < bus.n; k++) {
    const tt = k / SR;
    const r = ruido();
    const hp = r - prev; prev = r;
    const s = hp * Math.exp(-tt / largo * 4) * vol;
    bus.L[i0 + k] += s * 0.8; bus.R[i0 + k] += s * 1.1;
  }
}
function platillo(bus, t0, vol, largo = 1.6) {
  const i0 = Math.round(t0 * SR), n = Math.round(largo * SR);
  let prev = 0, lp = 0;
  for (let k = 0; k < n && i0 + k < bus.n; k++) {
    const tt = k / SR;
    const r = ruido();
    const hp = r - prev; prev = r;
    lp += 0.6 * (hp - lp);
    const s = lp * Math.exp(-tt * 3.2 / largo * 1.6) * vol;
    bus.L[i0 + k] += s * (1 + 0.15 * Math.sin(tt * 9)); bus.R[i0 + k] += s * (1 - 0.15 * Math.sin(tt * 9));
  }
}

function pasoBajo(L, R, fc) {
  // 2 polos en cascada (12 dB/oct) para suavizar las ondas cuadradas
  const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
  for (const x of [L, R]) {
    let y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { y1 += a * (x[i] - y1); y2 += a * (y1 - y2); x[i] = y2; }
  }
}

// ---------- secuenciador ----------
// Tempo que usará generarMusica(segundos): sirve para encajar cosas (p. ej. una cantinela)
// en el pulso. Los tiempos de pulso son k*negra desde t=0; los compases, k*compas.
export function tempoMusica(segundos) {
  if (!(segundos > 0)) throw new Error('segundos debe ser > 0');
  const cola = Math.min(COLA, segundos * 0.25);
  const util = Math.max(0.5, segundos - cola);
  let compases = Math.max(1, Math.round(util / (240 / 136)));
  let bpm = 240 * compases / util;
  // mantén el tempo en un rango razonable
  while (bpm > 145 && compases > 1) { compases--; bpm = 240 * compases / util; }
  while (bpm < 125 && util / compases > 1.4 && compases < 999) { compases++; bpm = 240 * compases / util; if (bpm > 145) { compases--; bpm = 240 * compases / util; break; } }
  const negra = 60 / bpm;
  return { bpm, compases, negra, semi: negra / 4, compas: negra * 4, cola };
}

export function generarMusica(segundos, rutaWav) {
  if (!(segundos > 0)) throw new Error('segundos debe ser > 0');
  const N = Math.round(segundos * SR);
  const { bpm, compases, negra, semi, compas } = tempoMusica(segundos);
  const tFinal = compases * compas; // inicio del acorde final

  const pulsos = new Bus(N), bajo = new Bus(N), bateria = new Bus(N), eco = new Bus(N);

  // plan de compases
  const plan = []; // {tipo, acorde, melo, armonia, energia}
  const nFan = Math.min(4, compases);
  const nIntro = compases - nFan >= 4 ? 2 : 0;
  const nMedio = compases - nFan - nIntro;
  for (let i = 0; i < nIntro; i++) plan.push({ tipo: 'intro', acorde: i === nIntro - 1 ? 'E' : 'Am', idx: i });
  for (let i = 0; i < nMedio; i++) {
    const vuelta = Math.floor(i / 16), enSec = i % 16;
    const esB = enSec >= 8, j = enSec % 8;
    plan.push({
      tipo: esB ? 'B' : 'A', acorde: (esB ? B_ACORDES : A_ACORDES)[j], melo: (esB ? B_MELO : A_MELO)[j],
      idx: j, vuelta, energia: vuelta > 0 || esB ? 2 : 1, armonia: vuelta > 0 || (esB && j >= 4),
      finFrase: j === 7 || i === nMedio - 1,
    });
  }
  for (let i = 0; i < nFan; i++) {
    const k = 4 - nFan + i;
    plan.push({ tipo: 'fan', acorde: FAN_ACORDES[k], melo: FAN_MELO[k], idx: k, armonia: true, energia: 3 });
  }

  const acordeEn = (p, s16) => (p.acorde.includes('|') ? p.acorde.split('|')[s16 < 8 ? 0 : 1] : p.acorde);

  plan.forEach((p, b) => {
    const t0 = b * compas;
    // --- melodía ---
    if (p.melo) {
      let s = 0;
      for (const nota of parseFrase(p.melo)) {
        if (nota.m != null) {
          const d = nota.d * semi;
          const largo = nota.d >= 4;
          tocarPulso(pulsos, { t0: t0 + s * semi, dur: d * (largo ? 0.92 : 0.8), m: nota.m, vol: 0.2, duty: p.tipo === 'B' ? 0.33 : 0.25, vib: largo ? 0.22 : 0, pan: 0 });
          tocarPulso(eco, { t0: t0 + s * semi, dur: d * 0.8, m: nota.m, vol: 0.2, duty: 0.25 });
          if (p.armonia) {
            const h = armonia(nota.m, acordeEn(p, s));
            tocarPulso(pulsos, { t0: t0 + s * semi, dur: d * (largo ? 0.92 : 0.8), m: h, vol: 0.095, duty: 0.125, pan: 0.35, vib: largo ? 0.15 : 0 });
          }
        }
        s += nota.d;
      }
    }
    // --- arpegio (semicorcheas) ---
    for (let s = 0; s < 16; s++) {
      const ac = tonosAcorde(acordeEn(p, s));
      const raiz = 57 + ((ac[0] - 9 + 12) % 12); // alrededor de A3..G#4
      const notas = [raiz, raiz + ((ac[1] - ac[0] + 12) % 12), raiz + ((ac[2] - ac[0] + 12) % 12), raiz + 12];
      const orden = [0, 1, 2, 3, 2, 1, 2, 3];
      let vol = 0.05;
      if (p.tipo === 'intro') vol = 0.02 + 0.045 * ((b * 16 + s) / (nIntro * 16));
      if (p.tipo === 'fan') vol = 0.045;
      if (p.tipo === 'A' && p.vuelta === 0 && p.idx < 4) vol = 0.04;
      tocarPulso(pulsos, { t0: t0 + s * semi, dur: semi * 0.7, m: notas[orden[s % 8]] + 12, vol, duty: 0.5, pan: -0.4, ataque: 0.003, decaer: 0.05, sostener: 0.5, liberar: 0.02 });
    }
    // --- bajo (triángulo) ---
    for (let c = 0; c < 8; c++) {
      const ac = tonosAcorde(acordeEn(p, c * 2));
      const r = 33 + ((ac[0] - 9 + 12) % 12); // A1..G#2
      const r2 = r + 12;
      let m;
      if (p.tipo === 'intro') m = r2;
      else if (p.tipo === 'fan') m = c % 2 ? r2 + 12 : r2;
      else m = [r2, r2 + 12, r2, r2 + 12, r2 + 7, r2 + 12, r2, r2 + 12][c];
      tocarTriangulo(bajo, { t0: t0 + c * 2 * semi, dur: semi * 1.7, m, vol: 0.27 });
    }
    // --- batería ---
    const t = (s16) => t0 + s16 * semi;
    if (p.tipo === 'intro') {
      for (let q = 0; q < 4; q++) bombo(bateria, t(q * 4), 0.35 + 0.1 * b);
      if (b === nIntro - 1) for (let s = 0; s < 16; s++) caja(bateria, t(s), 0.06 + 0.22 * (s / 16));
      else for (let s = 8; s < 16; s += 2) caja(bateria, t(s), 0.05 + 0.08 * ((s - 8) / 8));
      for (let s = 0; s < 16; s += 2) charles(bateria, t(s), 0.05);
    } else if (p.tipo === 'fan') {
      if (p.idx === 0) platillo(bateria, t(0), 0.2);
      for (let q = 0; q < 4; q++) bombo(bateria, t(q * 4), 0.55);
      if (p.idx === 3) {
        for (let s = 8; s < 16; s++) caja(bateria, t(s), 0.12 + 0.2 * ((s - 8) / 8));
        for (let s = 0; s < 8; s += 2) caja(bateria, t(s), 0.15);
      } else { caja(bateria, t(4), 0.3); caja(bateria, t(12), 0.3); }
      for (let s = 0; s < 16; s += 2) charles(bateria, t(s), 0.06);
    } else {
      if (p.idx === 0) platillo(bateria, t(0), p.vuelta === 0 && p.tipo === 'A' ? 0.18 : 0.13);
      bombo(bateria, t(0), 0.55); bombo(bateria, t(6), 0.45); bombo(bateria, t(8), 0.5);
      if (p.energia >= 2) bombo(bateria, t(10), 0.35);
      if (p.finFrase) {
        caja(bateria, t(4), 0.3);
        for (let s = 12; s < 16; s++) caja(bateria, t(s), 0.14 + 0.05 * (s - 12));
      } else { caja(bateria, t(4), 0.3); caja(bateria, t(12), 0.3); }
      const paso = p.energia >= 2 ? 1 : 2;
      for (let s = 0; s < 16; s += paso) charles(bateria, t(s), s % 4 === 2 ? 0.075 : 0.045, s % 4 === 2 ? 0.07 : 0.035);
    }
  });

  // --- acorde final (Do mayor) ---
  if (tFinal < segundos) {
    const d = segundos - tFinal;
    platillo(bateria, tFinal, 0.22, Math.min(2.4, d));
    bombo(bateria, tFinal, 0.65);
    tocarPulso(pulsos, { t0: tFinal, dur: d, m: midi('C6'), vol: 0.2, vib: 0.25, duty: 0.25, decaer: 0.6, sostener: 0.55 });
    tocarPulso(eco, { t0: tFinal, dur: d * 0.5, m: midi('C6'), vol: 0.2, duty: 0.25 });
    tocarPulso(pulsos, { t0: tFinal, dur: d, m: midi('G5'), vol: 0.1, duty: 0.125, pan: 0.35, decaer: 0.6, sostener: 0.5 });
    tocarPulso(pulsos, { t0: tFinal, dur: d, m: midi('E5'), vol: 0.09, duty: 0.5, pan: -0.35, decaer: 0.6, sostener: 0.5 });
    tocarTriangulo(bajo, { t0: tFinal, dur: d, m: midi('C3'), vol: 0.34 });
    // trémolo arpegiado rápido que se apaga
    const notas = ['C5', 'E5', 'G5', 'C6'].map(midi);
    for (let k = 0, tt = tFinal; tt < segundos; k++, tt += semi / 2) {
      tocarPulso(pulsos, { t0: tt, dur: semi * 0.4, m: notas[k % 4], vol: 0.05 * Math.exp(-(tt - tFinal) * 1.2), duty: 0.5, pan: -0.4, ataque: 0.002, liberar: 0.01 });
    }
  }

  // --- eco estéreo de la melodía (3/16 de compás), filtrado ---
  const dly = Math.round(semi * 3 * SR);
  pasoBajo(eco.L, eco.R, 2500);
  const ecoL = new Float32Array(N), ecoR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = i - dly >= 0 ? eco.L[i - dly] + ecoR[i - dly] * 0.35 : 0;
    const bb = i - dly * 2 >= 0 ? eco.R[i - dly * 2] + ecoL[i - dly] * 0.35 : 0;
    ecoL[i] = a; ecoR[i] = bb;
  }

  pasoBajo(pulsos.L, pulsos.R, 5200);

  // --- mezcla ---
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    L[i] = pulsos.L[i] + bajo.L[i] + bateria.L[i] * 0.9 + ecoL[i] * 0.22;
    R[i] = pulsos.R[i] + bajo.R[i] + bateria.R[i] * 0.9 + ecoR[i] * 0.22;
  }
  // filtro paso-alto suave (quita DC / <25 Hz)
  for (const x of [L, R]) {
    let px = 0, py = 0; const a = Math.exp(-2 * Math.PI * 25 / SR);
    for (let i = 0; i < N; i++) { const y = a * (py + x[i] - px); px = x[i]; py = y; x[i] = y; }
  }

  // --- master: normaliza RMS (~-15 dBFS) y limitador suave a -1 dBFS ---
  let suma = 0;
  for (let i = 0; i < N; i++) suma += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(suma / (2 * N)) || 1e-9;
  const objetivo = Math.pow(10, -15.5 / 20);
  const g = objetivo / rms;
  const techo = Math.pow(10, -1 / 20);
  // limitador con anticipación (envolvente de pico con ataque instantáneo y suelta lenta)
  const ventana = Math.round(0.005 * SR), suelta = Math.exp(-1 / (0.12 * SR));
  const ganancia = new Float32Array(N);
  let env = 0;
  for (let i = 0; i < N; i++) ganancia[i] = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g;
  // máximo móvil hacia delante
  const pico = new Float32Array(N);
  { const dq = []; let h = 0;
    for (let i = 0; i < N + ventana; i++) {
      if (i < N) { while (dq.length > h && ganancia[dq[dq.length - 1]] <= ganancia[i]) dq.pop(); dq.push(i); }
      const j = i - ventana;
      if (j >= 0) { while (dq[h] < j) h++; pico[j] = ganancia[dq[h]]; }
    }
  }
  const fadeIni = Math.max(0, N - Math.round(1.5 * SR));
  const buf = Buffer.alloc(44 + N * 4);
  for (let i = 0; i < N; i++) {
    const p = pico[i];
    env = p > env ? p : env * suelta + p * (1 - suelta);
    const gl = env > techo ? techo / env : 1;
    let fade = 1;
    if (i >= fadeIni) { const x = (i - fadeIni) / (N - fadeIni); fade = Math.cos(x * Math.PI / 2) ** 2; }
    if (i < 0.02 * SR) fade *= i / (0.02 * SR);
    const l = Math.max(-1, Math.min(1, L[i] * g * gl * fade));
    const r = Math.max(-1, Math.min(1, R[i] * g * gl * fade));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  // cabecera WAV
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  writeFileSync(rutaWav, buf);
  return { ruta: rutaWav, segundos: N / SR, bpm, compases };
}

// uso directo: node musica.mjs 62.5 /tmp/musica.wav
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = Number(process.argv[2] || 60), r = process.argv[3] || 'musica.wav';
  console.log(generarMusica(s, r));
}
