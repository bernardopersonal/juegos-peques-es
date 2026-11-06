// Genera las voces en inglés del teatro (js/teatro-guion.js: «The Three Little Pigs») con ElevenLabs, en
// inglés británico (gb) y americano (us), con el momento en que suena cada palabra. Las usa el juego del
// teatro para que el niño oiga sus frases, las repita y se grabe.
//
// Uso: node scripts/generar-teatro.mjs [--acento gb|us] [--force] [--dry-run] [--prueba]
//   (sin nada)  genera lo que falte de los dos acentos en audio/teatro/<acento>/, escribe
//               audio/teatro/manifest.js y borra los MP3 de audio/teatro/ que el manifiesto ya no usa.
//   --acento    solo ese acento; lo del otro se queda como está.
//   --force     vuelve a generar todos los audios (del acento elegido o de los dos), aunque ya estén.
//   --dry-run   cuenta audios y caracteres sin llamar a ElevenLabs ni tocar nada (con --prueba, los de
//               la prueba).
//   --prueba    las escenas 1 y 2 de cada acento (pie, frase y lenta) en prueba-teatro/, para escuchar
//               las voces antes de gastar en todo. Siempre las genera de nuevo; no toca audio/.
//
// Por cada escena y acento, tres audios: frase (la del lobo), lenta (la misma, más despacio) y pie (lo
// que dice antes el cerdito, para saber cuándo le toca). El nombre de cada MP3 lleva un hash de texto,
// voz, ajustes, modelo y formato: los textos repetidos (la frase de l2, l4 y l6; la de l3 y l5; el
// «Who's there?» de l1, l3 y l5…) comparten archivo, nada se paga dos veces y un texto cambiado genera
// solo lo suyo.
//
// El manifiesto (lo que lee el juego):
//   window.TEATRO_AUDIOS = { version: 1, gb: { l1: { frase: A, lenta: A, pie: A }, … }, us: { … } }
//   A = { src: 'audio/teatro/gb/….mp3', palabras: [[palabra, inicio_s, fin_s], …] }
// Las palabras, tal cual en el texto y con su puntuación (["pig,", 0.42, 0.71]). null mientras no hay
// audios; una escena solo está cuando tiene sus tres audios. Se escribe después de cada audio: si algo
// falla a medias (sin créditos, sin red…), lo hecho se queda y no se vuelve a pagar (lo de una escena
// sin acabar, en comentarios «// a medias:», que el navegador no lee).
//
// Los tiempos salen de la alineación por letras de /with-timestamps: la de «alignment», que va con el
// texto tal cual. La «normalized_alignment» es la del texto como lo lee (con «Mr» → «Mister»), y sus
// letras ya no casan con las palabras del guion. Cada palabra va del principio de su primera letra al
// final de la última: sin la puntuación de detrás, que a veces se alarga con la pausa.
//
// Voces: predefinidas de ElevenLabs (premade, las mismas en todas las cuentas) con acento nativo, elegidas
// por nombre y comprobadas con GET /v1/voices (que estén y que labels.accent sea el del acento). Si falta
// una, otra predefinida del mismo acento y sexo, y lo dice. Si la clave no tiene permiso para ver las
// voces (Voices: read), usa las de la pasada anterior o las de VOCES, sin comprobar. Las que se han usado
// quedan apuntadas en el manifiesto.
//
// Modelo: eleven_multilingual_v2, el estable de más calidad, con speed y /with-timestamps. Con voz nativa
// y texto en inglés suena inglés nativo, así que no se manda language_code. Para probar otro:
// ELEVENLABS_MODELO_TEATRO (cambia el hash: se regenera todo).
//
// La clave, de ELEVENLABS_API_KEY (.env en local, Secret en GitHub): nunca en el código ni en los logs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { raiz, KEY, salir, ttsConTiempos, listarVoces, ErrorEleven } from './elevenlabs.mjs';

const require = createRequire(import.meta.url);
const TEATRO = require(join(raiz, 'js/teatro-guion.js'));

const MODELO = process.env.ELEVENLABS_MODELO_TEATRO || 'eleven_multilingual_v2';
const FORMATO = 'mp3_44100_64';
const DIR = 'audio/teatro';
const MANIFIESTO = join(raiz, DIR, 'manifest.js');
const TIPOS = ['frase', 'lenta', 'pie'];
const PAPEL = { frase: 'lobo', lenta: 'lobo', pie: 'cerditos' };

// Voces por acento y papel: las preferidas, en orden ([nombre, id] de la predefinida), y el sexo para
// buscar otra si no está ninguna
const VOCES = {
  gb: {
    lobo: { sexo: 'male', preferidas: [['George', 'JBFqnCBsd6RMkjVDRZzb']] },
    cerditos: { sexo: 'female', preferidas: [['Lily', 'pFZP5JQG7iQjIQuC4Bku'], ['Alice', 'Xb7hH8MSUJpSbSDYk0k2']] },
  },
  us: {
    lobo: { sexo: 'male', preferidas: [['Brian', 'nPczCjzI2devNBz1zQrb']] },
    cerditos: { sexo: 'female', preferidas: [['Jessica', 'cgSgspJ2msm6clMCkdW9']] },
  },
};
// labels.accent de cada acento (en minúsculas)
const ACENTO = { gb: /\b(british|english)\b/, us: /\bamerican\b/ };

// Ajustes de voz. Lobo: algo teatral (style), pero estable y fiel a la voz (stability, similarity_boost)
// para que se entienda bien cómo se dice. Lenta: lo mismo a 0.75 (ElevenLabs admite speed de 0.7 a 1.2).
// Cerditos: más alegres (menos estabilidad, más estilo).
const LOBO = { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1 };
const AJUSTES = {
  frase: LOBO,
  lenta: { ...LOBO, speed: 0.75 },
  pie: { stability: 0.35, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true, speed: 1 },
};
for (const a of Object.values(AJUSTES)) if (!(a.speed >= 0.7 && a.speed <= 1.2)) salir('speed tiene que ir de 0.7 a 1.2');

// Argumentos: lo que no se conoce para, así una errata no gasta créditos
const USO = 'Uso: node scripts/generar-teatro.mjs [--acento gb|us] [--force] [--dry-run] [--prueba]';
const op = { acentos: Object.keys(VOCES), forzar: false, simular: false, prueba: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--force') op.forzar = true;
  else if (a === '--dry-run') op.simular = true;
  else if (a === '--prueba') op.prueba = true;
  else if (a === '--acento') {
    const v = args[++i];
    if (!VOCES[v]) salir(`--acento tiene que ser ${Object.keys(VOCES).join(' o ')}${v ? ` (y es «${v}»)` : ''}`);
    op.acentos = [v];
  } else salir(`no conozco «${a}». ${USO}`);
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esLetra = (c) => /[\p{L}\p{N}]/u.test(c);
// Para el nombre del archivo: el principio del texto, sin apóstrofos ni signos ("Who's there?" → whos-there)
const slug = (t) => sinTildes(t).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 40).replace(/-+$/, '') || 'x';
const hash = (...partes) => createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 10);
const caracteres = (lista) => lista.reduce((n, a) => n + a.texto.length, 0);
const textoDe = (escena, tipo) => (tipo === 'pie' ? escena.pie.texto : escena.frase);
// "George - Warm, Captivating Storyteller" → "George"
const primerNombre = (n) => String(n || '').split(/\s+[-–—|(]/)[0].trim();
const pista = (e) => (e.status === 401
  ? (/quota/i.test(e.detalle) ? ' (no quedan créditos)' : ' (¿la clave está bien y tiene permiso de Text to Speech?)')
  : e.status === 404 ? ' (¿existe esa voz?)' : '');

// Las palabras del texto (separadas por espacios, con su puntuación) y cuándo suena cada una, a partir de
// los tiempos de cada letra. Recorre a la vez las letras del texto y las de la alineación, sin espacios ni
// signos (que pueden venir distintos, como un apóstrofo curvo); si no casan, para.
function palabrasDe(texto, al) {
  const ini = al.character_start_times_seconds;
  const fin = al.character_end_times_seconds;
  const letras = []; // [letra, posición en la alineación]
  al.characters.forEach((c, i) => {
    for (const l of sinTildes(c)) if (esLetra(l)) letras.push([l, i]);
  });
  let p = 0;
  let antes = 0;
  const palabras = texto.trim().split(/\s+/).map((w) => {
    const suyas = [...sinTildes(w)].filter(esLetra);
    if (!suyas.length) return [w, r3(antes), r3(antes)]; // sin letras (un guion suelto): sin duración
    const desde = p;
    for (const l of suyas) {
      if (!letras[p] || letras[p][0] !== l) throw new Error(`los tiempos de ElevenLabs no casan con el texto en «${w}»`);
      p++;
    }
    const a = ini[letras[desde][1]];
    antes = Math.max(fin[letras[p - 1][1]], a);
    return [w, r3(a), r3(antes)];
  });
  if (p !== letras.length) throw new Error('los tiempos de ElevenLabs traen letras que no están en el texto');
  return palabras;
}

// La voz de un papel entre las de la cuenta: la primera preferida que esté y sea del acento; si no, otra
// predefinida del mismo acento y sexo (por orden alfabético, para que salga siempre la misma)
function elegirVoz(lista, acento, papel) {
  const { sexo, preferidas } = VOCES[acento][papel];
  const etiqueta = (v, k) => String((v.labels || {})[k] || '').toLowerCase();
  const delAcento = (v) => ACENTO[acento].test(etiqueta(v, 'accent'));
  for (const [nombre, id] of preferidas) {
    const v = lista.find((x) => x.voice_id === id) ||
      lista.find((x) => x.category === 'premade' && primerNombre(x.name).toLowerCase() === nombre.toLowerCase());
    if (!v) console.warn(`AVISO: no está la voz «${nombre}» (${id}) en GET /v1/voices.`);
    else if (!delAcento(v)) console.warn(`AVISO: «${v.name}» no es de acento ${acento} (labels.accent: «${etiqueta(v, 'accent')}»).`);
    else return { nombre: primerNombre(v.name), id: v.voice_id };
  }
  const v = lista.filter((x) => x.category === 'premade' && delAcento(x) && etiqueta(x, 'gender') === sexo)
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!v) salir(`no hay ninguna voz predefinida de acento ${acento} y sexo ${sexo} para ${papel}.`);
  console.warn(`AVISO: para ${papel} (${acento}) uso «${v.name}» (${v.voice_id}), otra predefinida ${etiqueta(v, 'accent')} (${sexo}).`);
  return { nombre: primerNombre(v.name), id: v.voice_id };
}

// Las voces de cada acento: { gb: { lobo: { nombre, id }, cerditos: { nombre, id } }, … }. Con comprobar,
// de GET /v1/voices; si no (--dry-run o sin permiso para verlas), las de la pasada anterior o las preferidas
async function elegirVoces(acentos, { comprobar, anteriores }) {
  let lista = null;
  if (comprobar) {
    try {
      lista = await listarVoces();
    } catch (e) {
      if (!(e instanceof ErrorEleven && e.status === 401 && /missing_permissions/.test(e.detalle))) throw e;
      console.warn('AVISO: la clave no tiene permiso para ver las voces (Voices: read): uso las de siempre sin comprobarlas.');
    }
  }
  const voces = {};
  for (const ac of acentos) {
    voces[ac] = {};
    for (const papel of Object.keys(VOCES[ac])) {
      const [nombre, id] = VOCES[ac][papel].preferidas[0];
      voces[ac][papel] = lista ? elegirVoz(lista, ac, papel) : (anteriores[ac] && anteriores[ac][papel]) || { nombre, id };
    }
  }
  return voces;
}

// Los audios de un acento: por escena, sus tres audios { tipo, texto, voz, ajustes, src }
function planear(acento, voces) {
  return TEATRO.escenas.map((e) => ({
    id: e.id,
    audios: Object.fromEntries(TIPOS.map((tipo) => {
      const texto = textoDe(e, tipo);
      const voz = voces[PAPEL[tipo]];
      const ajustes = AJUSTES[tipo];
      const src = `${DIR}/${acento}/${slug(texto)}-${hash(texto, voz.id, ajustes, MODELO, FORMATO)}.mp3`;
      return [tipo, { tipo, texto, voz, ajustes, src }];
    })),
  }));
}

async function generar(a) {
  try {
    const { audio, alineacion } = await ttsConTiempos(a.texto, { voz: a.voz.id, ajustes: a.ajustes, modelo: MODELO, formato: FORMATO });
    return { audio, palabras: palabrasDe(a.texto, alineacion) };
  } catch (e) {
    e.message += ` (con «${a.texto}», voz ${a.voz.nombre})`;
    throw e;
  }
}

// ---------- Manifiesto ----------
// Lo que dejó la pasada anterior: { datos (null si no hay), voces de cada acento y audios a medias (de sus
// comentarios) }
function leerManifiesto() {
  const nada = { datos: null, voces: {}, aMedias: {} };
  if (!existsSync(MANIFIESTO)) return nada;
  const t = readFileSync(MANIFIESTO, 'utf8');
  const voces = {};
  const aMedias = {};
  for (const m of t.matchAll(/^\/\/ voces (\w+): lobo (.+?) \((\w+)\) · cerditos (.+?) \((\w+)\)$/gm)) {
    voces[m[1]] = { lobo: { nombre: m[2], id: m[3] }, cerditos: { nombre: m[4], id: m[5] } };
  }
  try {
    for (const m of t.matchAll(/^\/\/ a medias: (\S+) (\[.*\])$/gm)) aMedias[m[1]] = JSON.parse(m[2]);
    return { datos: JSON.parse(t.match(/window\.TEATRO_AUDIOS\s*=\s*([\s\S]*?);?\s*$/)[1]), voces, aMedias };
  } catch {
    console.warn(`AVISO: no entiendo ${DIR}/manifest.js: lo rehago (lo que no esté en él se vuelve a generar).`);
    return nada;
  }
}

function escribirManifiesto({ datos, voces, aMedias = {} }) {
  const lineas = [
    '// Generado por scripts/generar-teatro.mjs. No editar a mano.',
    '// Voces en inglés del teatro (js/teatro-guion.js). Por acento y escena: frase (la del lobo), lenta (la',
    '// misma, más despacio) y pie (lo que dice antes el cerdito), con el inicio y el fin de cada palabra (s).',
  ];
  for (const [ac, v] of Object.entries(voces)) {
    if (v) lineas.push(`// voces ${ac}: lobo ${v.lobo.nombre} (${v.lobo.id}) · cerditos ${v.cerditos.nombre} (${v.cerditos.id})`);
  }
  // Audios ya pagados de escenas sin acabar (se cortó a medias): sus palabras, para no volver a pedirlos
  for (const [src, palabras] of Object.entries(aMedias)) lineas.push(`// a medias: ${src} ${JSON.stringify(palabras)}`);
  // Una línea por audio, para que se lea
  let json = 'null';
  if (datos) {
    const acentos = Object.keys(datos).filter((k) => k !== 'version').map((ac) => `  ${JSON.stringify(ac)}: {\n` +
      Object.entries(datos[ac]).map(([id, e]) => `    ${JSON.stringify(id)}: {\n` +
        TIPOS.map((t) => `      ${JSON.stringify(t)}: ${JSON.stringify(e[t])}`).join(',\n') + '\n    }').join(',\n') + '\n  }');
    json = `{\n  "version": ${datos.version},\n${acentos.join(',\n')}\n}`;
  }
  lineas.push(`window.TEATRO_AUDIOS = ${json};`);
  mkdirSync(dirname(MANIFIESTO), { recursive: true });
  writeFileSync(MANIFIESTO, lineas.join('\n') + '\n');
}

// Los MP3 que hay en una carpeta y las de dentro (rutas desde la raíz, con /)
function mp3s(rel) {
  const dir = join(raiz, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? mp3s(`${rel}/${n}`) : n.endsWith('.mp3') ? [`${rel}/${n}`] : []));
}

// ---------- --prueba ----------
// Las dos primeras escenas de cada acento en prueba-teatro/<acento>/, con tiempos.txt para ver las palabras
async function prueba(voces) {
  const dir = join(raiz, 'prueba-teatro');
  const lista = [];
  for (const ac of op.acentos) {
    planear(ac, voces[ac]).slice(0, 2).forEach((e, i) => {
      for (const tipo of TIPOS) lista.push({ ...e.audios[tipo], acento: ac, archivo: `${ac}/${i + 1}-${tipo}-${slug(e.audios[tipo].texto)}.mp3` });
    });
  }
  console.log(`Prueba (escenas ${TEATRO.escenas.slice(0, 2).map((e) => e.id).join(' y ')}): ${lista.length} audios · caracteres: ${caracteres(lista)}`);
  if (op.simular) return console.log('--dry-run: no se genera nada.');
  rmSync(dir, { recursive: true, force: true });
  const tiempos = [`Modelo ${MODELO}, ${FORMATO}. Inicio y fin de cada palabra, en segundos.`];
  for (const [i, a] of lista.entries()) {
    const { audio, palabras } = await generar(a);
    mkdirSync(join(dir, a.acento), { recursive: true });
    writeFileSync(join(dir, a.archivo), audio);
    tiempos.push(`\n${a.archivo}  (${a.voz.nombre}, speed ${a.ajustes.speed})\n` +
      palabras.map(([w, x, y]) => `  ${x.toFixed(2)}-${y.toFixed(2)}  ${w}`).join('\n'));
    console.log(`  [${i + 1}/${lista.length}] ${a.acento} ${a.tipo.padEnd(5)} ${a.texto}`);
  }
  writeFileSync(join(dir, 'tiempos.txt'), tiempos.join('\n') + '\n');
  console.log('Listo: prueba-teatro/ (escúchala; audio/ no se ha tocado).');
}

// ---------- Todo ----------
async function todo(voces, anterior) {
  // Las palabras de cada archivo que ya está (del manifiesto anterior): con el archivo y sus palabras, no se pide
  const hechos = new Map();
  for (const [ac, escenas] of Object.entries(anterior.datos || {})) {
    if (ac === 'version' || !escenas) continue;
    for (const e of Object.values(escenas)) {
      for (const a of Object.values(e)) if (a && a.src && Array.isArray(a.palabras)) hechos.set(a.src, a.palabras);
    }
  }
  for (const [src, palabras] of Object.entries(anterior.aMedias)) if (Array.isArray(palabras)) hechos.set(src, palabras);
  const hecho = (src) => hechos.has(src) && existsSync(join(raiz, src));

  // De los otros acentos, lo que ya había, si sigue al día (mismo texto y su archivo está)
  const otros = {};
  for (const ac of Object.keys(VOCES).filter((x) => !op.acentos.includes(x))) {
    const antes = (anterior.datos && anterior.datos[ac]) || {};
    otros[ac] = {};
    for (const e of TEATRO.escenas) {
      const v = antes[e.id];
      if (!v) continue;
      const alDia = TIPOS.every((t) => v[t] && hecho(v[t].src) &&
        v[t].palabras.map((p) => p[0]).join(' ') === textoDe(e, t).trim().split(/\s+/).join(' '));
      if (alDia) otros[ac][e.id] = v;
      else console.warn(`AVISO: ${ac}/${e.id} ha cambiado o le falta un audio: se queda sin voz hasta que generes ${ac}.`);
    }
  }

  // Cada archivo una vez, por orden de escena (así se completan de una en una)
  const planes = Object.fromEntries(op.acentos.map((ac) => [ac, planear(ac, voces[ac])]));
  const unicos = new Map();
  for (const ac of op.acentos) {
    for (const e of planes[ac]) {
      for (const tipo of TIPOS) {
        const a = e.audios[tipo];
        if (!unicos.has(a.src)) unicos.set(a.src, { ...a, acento: ac, usos: [] });
        unicos.get(a.src).usos.push(e.id + (tipo === 'frase' ? '' : ' ' + tipo));
      }
    }
  }
  const pendientes = [...unicos.values()].filter((a) => op.forzar || !hecho(a.src));
  for (const ac of op.acentos) {
    const suyos = [...unicos.values()].filter((a) => a.acento === ac);
    const pend = pendientes.filter((a) => a.acento === ac);
    console.log(`${ac}: ${planes[ac].length} escenas · ${suyos.length} audios distintos (${caracteres(suyos)} caracteres) · por generar: ${pend.length} (${caracteres(pend)} caracteres)`);
  }
  console.log(`Total por generar: ${pendientes.length} audios · ${caracteres(pendientes)} caracteres`);

  // El manifiesto con lo que hay: de los acentos elegidos, las escenas con sus tres audios (y aparte, los
  // audios hechos de las que aún no los tienen); de los otros, lo de antes
  const manifiesto = () => {
    const datos = { version: 1 };
    const usadas = {};
    const enEscena = new Set();
    for (const ac of Object.keys(VOCES)) {
      let escenas = otros[ac];
      if (planes[ac]) {
        escenas = {};
        for (const e of planes[ac]) {
          if (TIPOS.every((t) => hecho(e.audios[t].src))) {
            escenas[e.id] = Object.fromEntries(TIPOS.map((t) => [t, { src: e.audios[t].src, palabras: hechos.get(e.audios[t].src) }]));
            for (const t of TIPOS) enEscena.add(e.audios[t].src);
          }
        }
      }
      if (Object.keys(escenas).length) {
        datos[ac] = escenas;
        usadas[ac] = planes[ac] ? voces[ac] : anterior.voces[ac];
      }
    }
    const aMedias = Object.fromEntries([...unicos.keys()].filter((src) => hecho(src) && !enEscena.has(src)).map((src) => [src, hechos.get(src)]));
    return Object.keys(datos).length > 1 ? { datos, voces: usadas, aMedias } : { datos: null, voces: {}, aMedias };
  };

  // Lo que sobra: los MP3 de audio/teatro que no van a estar en el manifiesto
  const usados = new Set([...unicos.keys(), ...Object.values(otros).flatMap((es) => Object.values(es).flatMap((e) => TIPOS.map((t) => e[t].src)))]);
  const sobran = mp3s(DIR).filter((rel) => !usados.has(rel));
  if (op.simular) {
    for (const rel of sobran) console.log('  sobra (no se borra con --dry-run): ' + rel);
    return console.log('--dry-run: no se genera nada.');
  }

  let n = 0;
  for (const a of pendientes) {
    const { audio, palabras } = await generar(a);
    mkdirSync(join(raiz, DIR, a.acento), { recursive: true });
    writeFileSync(join(raiz, a.src), audio);
    hechos.set(a.src, palabras);
    escribirManifiesto(manifiesto());
    console.log(`  [${++n}/${pendientes.length}] ${a.acento} ${a.tipo.padEnd(5)} ${a.texto}  (${a.usos.join(', ')})`);
  }
  const final = manifiesto();
  escribirManifiesto(final);
  for (const rel of sobran) {
    unlinkSync(join(raiz, rel));
    console.log('  sobra: ' + rel);
  }
  const total = TEATRO.escenas.length;
  console.log('Listo: ' + Object.keys(VOCES).map((ac) => `${ac} ${Object.keys((final.datos && final.datos[ac]) || {}).length}/${total} escenas`).join(' · '));
}

// ---------- Uso directo ----------
const anterior = leerManifiesto();
try {
  if (!op.simular && !KEY) salir('Falta ELEVENLABS_API_KEY (ponla en .env o como Secret en GitHub).');
  const voces = await elegirVoces(op.acentos, { comprobar: !op.simular, anteriores: anterior.voces });
  for (const ac of op.acentos) {
    const v = voces[ac];
    console.log(`Voces ${ac}: lobo «${v.lobo.nombre}» (${v.lobo.id}) · cerditos «${v.cerditos.nombre}» (${v.cerditos.id})${op.simular ? ' (sin comprobar)' : ''}`);
  }
  if (op.prueba) await prueba(voces);
  else await todo(voces, anterior);
} catch (e) {
  salir((e instanceof ErrorEleven ? e.message + pista(e) : e.message) +
    (op.prueba ? '' : `\n  Lo generado hasta aquí se queda en ${DIR}/ y en su manifiesto: no se vuelve a pagar.`));
}
