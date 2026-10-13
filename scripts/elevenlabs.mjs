// Acceso a ElevenLabs compartido por los audios del juego y la narración del vídeo.
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

export async function tts(texto, ajustes = VOZ_JUEGO, intento = 1) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOZ}?output_format=mp3_44100_64`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: texto, model_id: MODELO, voice_settings: ajustes }),
  });
  if (r.status === 429 && intento <= 5) {
    await new Promise((ok) => setTimeout(ok, 2000 * intento));
    return tts(texto, ajustes, intento + 1);
  }
  if (!r.ok) salir(`ElevenLabs respondió ${r.status} para "${texto}": ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}
