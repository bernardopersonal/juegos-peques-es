// Genera un MP3 por cada frase de js/contenido.js usando ElevenLabs (con los nombres y la
// rutina de js/familia.js). Solo genera las que faltan (usa --force para regenerarlas todas).
//
// La clave NUNCA va en el código: se lee de la variable de entorno
// ELEVENLABS_API_KEY (en local, desde el archivo .env; en GitHub, desde un Secret).
import { writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { raiz, tts, comprobarClave } from './elevenlabs.mjs';

const require = createRequire(import.meta.url);
const { listaFrases } = require(join(raiz, 'js/contenido.js'));
const { slug } = require(join(raiz, 'js/frases.js'));

const forzar = process.argv.includes('--force');
const simular = process.argv.includes('--dry-run');

// --prueba: genera unas pocas frases de muestra en prueba-voz/ para escuchar la voz
// antes de gastar créditos en todo. No toca audio/ ni el manifiesto.
if (process.argv.includes('--prueba')) {
  const C = require(join(raiz, 'js/contenido.js'));
  // Con los niños con voz de js/familia.js (los dos primeros); sin ellos, frases sin nombre
  const [nino1 = null, nino2 = nino1] = Object.keys(C.PERFILES_CON_VOZ);
  const muestra = [
    C.bienvenida(nino1),
    C.bienvenida(null),
    C.trazar.fin('M'),
    C.felicitaciones(nino1)[0],
    C.sonidos.pregunta('oso'),
    C.sonidos.acierto('mono', 'm'),
    C.FONEMA.p,
    C.palabras.fin('pato'),
    C.felicitaciones(nino2)[1],
    'ma', 'pa', 'mo', 'mmmm',
  ];
  comprobarClave();
  const dir = join(raiz, 'prueba-voz');
  mkdirSync(dir, { recursive: true });
  console.log(`Prueba: ${muestra.length} frases, ${muestra.reduce((n, t) => n + t.length, 0)} caracteres`);
  for (const [i, texto] of muestra.entries()) {
    writeFileSync(join(dir, String(i + 1).padStart(2, '0') + '-' + slug(texto) + '.mp3'), await tts(texto));
    console.log(`  ${i + 1}. ${texto}`);
  }
  process.exit(0);
}

const dirAudio = join(raiz, 'audio');
mkdirSync(dirAudio, { recursive: true });

const frases = listaFrases();
const pendientes = frases.filter((t) => forzar || !existsSync(join(dirAudio, slug(t) + '.mp3')));
const caracteres = pendientes.reduce((n, t) => n + t.length, 0);
console.log(`Frases: ${frases.length} · por generar: ${pendientes.length} · caracteres: ${caracteres}`);

if (!simular && pendientes.length) {
  comprobarClave();

  let hechas = 0;
  for (const texto of pendientes) {
    const mp3 = await tts(texto);
    writeFileSync(join(dirAudio, slug(texto) + '.mp3'), mp3);
    hechas++;
    console.log(`  [${hechas}/${pendientes.length}] ${texto}`);
  }
}

// Borra audios que ya no se usan y escribe el manifiesto que lee la web
const usados = new Set(frases.map((t) => slug(t) + '.mp3'));
for (const f of readdirSync(dirAudio)) {
  if (f.endsWith('.mp3') && !usados.has(f)) {
    if (!simular) unlinkSync(join(dirAudio, f));
    console.log('  sobra: ' + f);
  }
}
const disponibles = frases.map(slug).filter((id) => existsSync(join(dirAudio, id + '.mp3')));
if (!simular) {
  writeFileSync(
    join(dirAudio, 'manifest.js'),
    '// Generado por scripts/generar-audios.mjs. No editar a mano.\n' +
      'window.AUDIOS_DISPONIBLES = ' + JSON.stringify(disponibles, null, 0) + ';\n'
  );
}
console.log(`Listo: ${disponibles.length}/${frases.length} frases con audio.`);
