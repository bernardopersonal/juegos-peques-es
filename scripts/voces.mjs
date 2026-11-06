// Lista voces masculinas en español de la biblioteca de ElevenLabs
// y las voces que ya tienes en tu cuenta, para elegir ELEVENLABS_VOICE_ID.
import { KEY, salir } from './elevenlabs.mjs';

if (!KEY) salir('Falta ELEVENLABS_API_KEY en .env');
const h = { 'xi-api-key': KEY };

const mias = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: h, redirect: 'manual' }).then((r) => r.json());
console.log('\n== Voces en tu cuenta (puedes usarlas ya) ==');
for (const v of mias.voices || []) {
  const l = v.labels || {};
  console.log(`${v.voice_id}  ${v.name}  [${[l.gender, l.accent, l.language].filter(Boolean).join(', ')}]`);
}

const q = new URLSearchParams({ language: 'es', gender: 'male', page_size: '30', sort: 'usage_character_count_1y' });
const lib = await fetch('https://api.elevenlabs.io/v1/shared-voices?' + q, { headers: h, redirect: 'manual' }).then((r) => r.json());
console.log('\n== Biblioteca: voces masculinas en español ==');
console.log('(Para usar una, ábrela en elevenlabs.io > Voices > Library y pulsa "Add to my voices")\n');
for (const v of lib.voices || []) {
  console.log(`${v.voice_id}  ${v.name}  [acento: ${v.accent || '?'}]  ${v.description?.slice(0, 70) || ''}`);
  if (v.preview_url) console.log(`    muestra: ${v.preview_url}`);
}
console.log('\nBusca las de acento "peninsular" o "castilian" (España). Copia el voice_id en ELEVENLABS_VOICE_ID.');
