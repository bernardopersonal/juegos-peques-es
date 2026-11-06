// Acceso a ElevenLabs compartido por los audios del juego, la narración del vídeo y las voces del teatro.
// La clave se lee de ELEVENLABS_API_KEY (archivo .env en local, Secret en GitHub).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env si existe (sin dependencias)
const envPath = join(raiz, '.env');
if (existsSync(envPath)) {
  for (const linea of readFileSync(envPath, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const KEY = process.env.ELEVENLABS_API_KEY;
export const VOZ = process.env.ELEVENLABS_VOICE_ID;
export const MODELO = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

// Para probar sin clave ni red: ELEVENLABS_BASE=http://127.0.0.1:PUERTO apunta a un servidor falso. Solo
// vale la API de ElevenLabs o este ordenador (127.0.0.1 o localhost): así la clave no puede ir a otro sitio.
export const BASE = (process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, '');
if (!/^(https:\/\/api(\.[a-z0-9-]+)*\.elevenlabs\.io|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(BASE)) {
  salir(`ELEVENLABS_BASE tiene que ser https://api.elevenlabs.io o http://127.0.0.1:PUERTO (y es «${BASE}»).`);
}

// Ajustes de voz: tranquila para el juego; el vídeo usa un tono más animado.
export const VOZ_JUEGO = { stability: 0.55, similarity_boost: 0.75, style: 0.25, speed: 0.9 };
export const VOZ_VIDEO = { stability: 0.4, similarity_boost: 0.75, style: 0.55, speed: 0.95 };

export function salir(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

export function comprobarClave() {
  if (!KEY) salir('Falta ELEVENLABS_API_KEY (ponla en .env o como Secret en GitHub).');
  if (!VOZ) salir('Falta ELEVENLABS_VOICE_ID. Ejecuta "npm run voces" para elegir una voz.');
}

// Un error de ElevenLabs: el código HTTP (0 si no ha habido respuesta) y lo que explica, nunca la clave
export class ErrorEleven extends Error {
  constructor(status, detalle) {
    super(`ElevenLabs respondió ${status || 'nada'}: ${detalle}`);
    this.status = status;
    this.detalle = detalle;
  }
}

// La explicación de una respuesta de error: {"detail": {"status": …, "message": …}}, una lista (422) o texto
function explicar(texto) {
  try {
    const d = JSON.parse(texto).detail;
    if (d && d.status) return d.status + (d.message ? ': ' + d.message : '');
    if (d) return (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300);
  } catch {}
  return texto.slice(0, 300);
}

// Llama a la API con la clave. Reintenta lo pasajero (429: demasiadas peticiones o el sistema ocupado;
// 5xx; sin conexión) hasta 5 veces, esperando lo que diga Retry-After o 2, 4, 6… segundos. Lo demás
// (401: la clave no vale, le falta un permiso o no quedan créditos; 404: la voz no existe; 422…), sin
// reintentar. Si no sale, lanza un ErrorEleven.
export async function pedir(ruta, { metodo = 'GET', cuerpo, aceptar = 'application/json' } = {}) {
  for (let intento = 1; ; intento++) {
    let r = null;
    let fallo;
    try {
      r = await fetch(BASE + ruta, {
        method: metodo,
        headers: { 'xi-api-key': KEY, Accept: aceptar, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
        body: cuerpo && JSON.stringify(cuerpo),
        redirect: 'manual', // una redirección no se sigue: así la clave nunca viaja a otro sitio
      });
      if (r.ok) return r;
      fallo = new ErrorEleven(r.status, explicar(await r.text()));
    } catch (e) {
      fallo = new ErrorEleven(0, 'sin conexión (' + ((e.cause && e.cause.code) || e.message) + ')');
    }
    if (intento > 5 || !(fallo.status === 0 || fallo.status === 429 || fallo.status >= 500)) throw fallo;
    const ra = r && r.headers.get('retry-after');
    const ms = ra && /^\d+(\.\d+)?$/.test(ra) ? Math.min(Number(ra) * 1000, 60000) : 2000 * intento;
    console.warn(`  ${fallo.message}. Reintento ${intento}/5 dentro de ${ms / 1000} s`);
    await new Promise((ok) => setTimeout(ok, ms));
  }
}

export async function tts(texto, ajustes = VOZ_JUEGO) {
  try {
    const r = await pedir(`/v1/text-to-speech/${VOZ}?output_format=mp3_44100_64`, {
      metodo: 'POST',
      cuerpo: { text: texto, model_id: MODELO, voice_settings: ajustes },
      aceptar: 'audio/mpeg',
    });
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e instanceof ErrorEleven) salir(`ElevenLabs respondió ${e.status} para "${texto}": ${e.detalle}`);
    throw e;
  }
}

// Texto a voz con los tiempos de cada letra (para saber cuándo suena cada palabra). Devuelve el audio y la
// alineación del texto tal cual: { characters, character_start_times_seconds, character_end_times_seconds }
// (y la normalizada: la del texto como lo lee, con los números y «Mr» en letra). Si falla, lanza un
// ErrorEleven en vez de salir: así quien llama guarda lo que lleva hecho.
export async function ttsConTiempos(texto, { voz, ajustes, modelo = MODELO, formato = 'mp3_44100_64' }) {
  const r = await pedir(`/v1/text-to-speech/${encodeURIComponent(voz)}/with-timestamps?output_format=${formato}`, {
    metodo: 'POST',
    cuerpo: { text: texto, model_id: modelo, voice_settings: ajustes },
  });
  const j = await r.json();
  if (!j.audio_base64 || !j.alignment) throw new ErrorEleven(r.status, 'la respuesta no trae el audio o los tiempos');
  return { audio: Buffer.from(j.audio_base64, 'base64'), alineacion: j.alignment, normalizada: j.normalized_alignment };
}

// Las voces que puede usar la cuenta, predefinidas incluidas:
// [{ voice_id, name, category: 'premade' | 'cloned' | …, labels: { accent, gender, … } }]
export async function listarVoces() {
  const r = await pedir('/v1/voices');
  return (await r.json()).voices || [];
}
