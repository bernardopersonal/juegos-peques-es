// Captura pantallas reales del juego para el vídeo explicativo.
// Devuelve, por escena, una lista de capturas (con su "peso" de tiempo) y los
// movimientos del dedo (en fracción de la escena y coordenadas 0-1 de la captura).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { raiz } from './elevenlabs.mjs';

const ANCHO = 1024;
const ALTO = 768;
// Sin niños con voz en js/familia.js, el vídeo usa dos perfiles inventados: uno peque (Trazar y los
// juegos de peques) y otro mayor (Sonidos, Sílabas, Palabras).
const PERFILES_EJEMPLO = {
  'ejemplo-peque': { id: 'ejemplo-peque', nombre: 'Mateo', edad: 4, tema: 'coches', emoji: '🐯', foto: null },
  'ejemplo-mayor': { id: 'ejemplo-mayor', nombre: 'Ana', edad: 9, tema: 'princesas', emoji: '🦊', foto: null },
};

export async function capturar(dir) {
  mkdirSync(dir, { recursive: true });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const navegador = await chromium.launch();
  const p = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO }, hasTouch: true, deviceScaleFactor: 1 });
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));

  // Azar con semilla (vídeo reproducible), voz instantánea y sin sonido
  await p.addInitScript(() => {
    let s = 20261002;
    Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    window.__dichas = [];
    const voz = { speak(u) { window.__dichas.push(u.text); setTimeout(() => u.onend && u.onend(), 20); }, cancel() {}, getVoices() { return []; } };
    Object.defineProperty(window, 'speechSynthesis', { value: voz });
    let porArchivo = null; // nombre de mp3 -> frase, para saber qué se ha dicho
    HTMLMediaElement.prototype.play = function () {
      if (!porArchivo) porArchivo = Object.fromEntries(window.CONTENIDO.listaFrases().map((t) => [window.Voz.slug(t) + '.mp3', t]));
      const archivo = decodeURIComponent(this.src || '').split('/').pop();
      window.__dichas.push(porArchivo[archivo] || '[audio] ' + archivo);
      setTimeout(() => this.onended && this.onended(), 20);
      return Promise.resolve();
    };
  });
  await p.goto(pathToFileURL(join(raiz, 'index.html')).href);
  await p.evaluate(() => { try { localStorage.clear(); } catch { /* nada */ } });
  // Qué tarjeta del inicio es el peque y cuál el mayor (los perfiles con voz salen primero, en su orden)
  const idx = await p.evaluate(() => {
    const lista = Object.values(window.CONTENIDO.PERFILES_CON_VOZ);
    const peque = lista.findIndex((x) => x.edad <= window.CONTENIDO.EDAD_PEQUES);
    const mayor = lista.findIndex((x) => x.edad > window.CONTENIDO.EDAD_PEQUES);
    return { peque, mayor, n: lista.length };
  });
  if (idx.peque < 0 || idx.mayor < 0) {
    await p.evaluate((ej) => localStorage.setItem('jp-perfiles', JSON.stringify(ej)), PERFILES_EJEMPLO);
    Object.assign(idx, { peque: idx.n, mayor: idx.n + 1 });
  }
  const pPeque = `.perfil:nth-child(${idx.peque + 1})`;
  const pMayor = `.perfil:nth-child(${idx.mayor + 1})`;
  await p.reload();
  await p.evaluate(() => document.fonts && document.fonts.ready);
  if (await p.isVisible('#intro')) await p.click('#intro-saltar');

  let n = 0;
  const foto = async (nombre, { limpiarFiesta = true } = {}) => {
    await p.waitForTimeout(120);
    if (limpiarFiesta) await p.evaluate(() => { document.getElementById('fiesta').innerHTML = ''; });
    const archivo = join(dir, String(++n).padStart(2, '0') + '-' + nombre + '.png');
    await p.screenshot({ path: archivo });
    return archivo;
  };
  // Centro de un elemento en coordenadas 0-1
  const centro = async (sel) => {
    const r = await p.locator(sel).first().boundingBox();
    return { x: (r.x + r.width / 2) / ANCHO, y: (r.y + r.height / 2) / ALTO };
  };
  const ultima = (prefijo) => p.evaluate((pre) => window.__dichas.filter((t) => t.startsWith(pre)).pop(), prefijo);
  // La app no hace caso a los toques del primer medio segundo después de cambiar de pantalla (para los
  // dobles toques de los niños): antes de cada toque se espera ese rato
  const clic = async (sel, op) => { await p.waitForTimeout(500); await p.click(sel, op); };
  const atras = async (veces = 1) => { for (let i = 0; i < veces; i++) await clic('#btn-atras'); };
  // Traza un carácter en un lienzo en `pasos` tramos, haciendo una foto en cada uno
  const trazarPorPasos = async (selLienzo, c, pasos, nombre) => {
    const caja = await p.locator(selLienzo).boundingBox();
    const tramos = await p.evaluate(([c, pasos]) => {
      const pts = window.Trazos.GLIFOS[c].flatMap((t, i) => window.Trazos.controles(t).map((q) => [i, ...q]));
      const out = [];
      for (let k = 1; k <= pasos; k++) out.push(pts.slice(Math.floor(((k - 1) * pts.length) / pasos), Math.floor((k * pts.length) / pasos)));
      return out;
    }, [c, pasos]);
    const fotos = [];
    let trazoActual = -1;
    for (const [k, tramo] of tramos.entries()) {
      await p.evaluate(([sel, tramo, trazoActual]) => {
        const l = document.querySelector(sel);
        const r = l.getBoundingClientRect();
        const ev = (t, x, y) => l.dispatchEvent(new PointerEvent(t, { clientX: r.left + (x / 100) * r.width, clientY: r.top + (y / 100) * r.height, pointerId: 1, bubbles: true }));
        let actual = trazoActual;
        for (const [i, x, y] of tramo) {
          if (i !== actual) { if (actual >= 0) ev('pointerup', x, y); ev('pointerdown', x, y); actual = i; }
          ev('pointermove', x, y);
        }
        return actual;
      }, [selLienzo, tramo, trazoActual]).then((a) => { trazoActual = a; });
      const [, x, y] = tramo[tramo.length - 1];
      fotos.push({
        archivo: await foto(`${nombre}-${k + 1}`, { limpiarFiesta: k < tramos.length - 1 }),
        dedo: { x: (caja.x + (x / 100) * caja.width) / ANCHO, y: (caja.y + (y / 100) * caja.height) / ALTO },
      });
    }
    await p.evaluate((sel) => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })), selLienzo);
    return fotos;
  };
  // Convierte una lista de pasos {archivo, peso, dedo?, toque?} en el formato de escena
  const escena = (id, pasos) => {
    const total = pasos.reduce((s, x) => s + x.peso, 0);
    let acc = 0;
    const capturas = [];
    const dedo = [];
    for (const paso of pasos) {
      capturas.push({ archivo: paso.archivo, desde: acc / total, hasta: (acc + paso.peso) / total });
      if (paso.dedo) dedo.push({ f: (acc + paso.peso * (paso.toque ? 0.55 : 0)) / total, ...paso.dedo, toque: !!paso.toque });
      acc += paso.peso;
    }
    return { id, capturas, dedo };
  };

  const escenas = [];

  // ---- 1. Elige tu jugador ----
  {
    const pasos = [];
    pasos.push({ archivo: await foto('inicio'), peso: 2, dedo: await centro(pMayor + ' .editar'), toque: true });
    await clic(pMayor + ' .editar');
    await p.locator('#pf-temas').scrollIntoViewIfNeeded();
    pasos.push({ archivo: await foto('perfil-mayor'), peso: 1.4, dedo: await centro('#pf-temas .tema:has-text("Bloques")'), toque: true });
    await clic('#pf-temas .tema:has-text("Bloques")');
    pasos.push({ archivo: await foto('perfil-mayor-bloques'), peso: 1.4, dedo: await centro('#pf-guardar'), toque: true });
    await clic('#pf-guardar');
    pasos.push({ archivo: await foto('menu-mayor'), peso: 2 });
    escenas.push(escena('jugador', pasos));
    await atras();
  }

  // ---- 2. Trazar (el peque) ----
  {
    const pasos = [];
    await clic(pPeque + ' .entrar');
    pasos.push({ archivo: await foto('peque-menu'), peso: 1.2, dedo: await centro('#juegos .tarjeta.ancha'), toque: true });
    await clic('#juegos .tarjeta.ancha');
    pasos.push({ archivo: await foto('peque-elegir'), peso: 1, dedo: await centro('#rejilla-letras button:nth-child(6)'), toque: true });
    await clic('#rejilla-letras button:nth-child(6)');
    await p.waitForTimeout(150);
    pasos.push({ archivo: await foto('trazar-m-0'), peso: 0.8 });
    for (const f of await trazarPorPasos('#lienzo', 'M', 10, 'trazar-m')) pasos.push({ archivo: f.archivo, peso: 0.32, dedo: f.dedo });
    pasos[pasos.length - 1].peso = 2; // la M terminada, con confeti
    escenas.push(escena('trazar', pasos));
    await atras(2);
  }

  // ---- 3. Para los más peques: contar, colores, letras ----
  {
    const pasos = [];
    await clic('#juegos .tarjeta:has-text("Contar")'); // Contar
    await p.waitForSelector('.cosa');
    const cosas = await p.locator('.cosa').count();
    pasos.push({ archivo: await foto('contar'), peso: 0.8, dedo: await centro('.cosa'), toque: true });
    await p.waitForTimeout(500);
    for (let i = 0; i < cosas; i++) await p.locator('.cosa').nth(i).click();
    const correcto = `#opciones .ficha:text-is("${cosas}")`;
    pasos.push({ archivo: await foto('contar-contado'), peso: 1, dedo: await centro(correcto), toque: true });
    await clic(correcto);
    pasos.push({ archivo: await foto('contar-bien'), peso: 0.8 });
    await atras();
    await clic('#juegos .tarjeta:has-text("Colores")'); // Colores
    await p.waitForSelector('#opciones .color');
    const color = (await ultima('Toca el ')).replace('Toca el ', '').replace('.', '');
    pasos.push({ archivo: await foto('colores'), peso: 1.2, dedo: await centro(`#opciones .color[aria-label="${color}"]`), toque: true });
    await clic(`#opciones .color[aria-label="${color}"]`);
    pasos.push({ archivo: await foto('colores-bien'), peso: 0.8 });
    await atras();
    await clic('#juegos .tarjeta:has-text("Letras")'); // Letras
    await p.waitForSelector('#opciones .ficha');
    const nombre = (await ultima('¿Dónde está la ')).replace('¿Dónde está la ', '').replace('?', '');
    const letra = await p.evaluate((nom) => Object.entries(window.CONTENIDO.NOMBRE_LETRA).find(([, v]) => v === nom)[0], nombre);
    pasos.push({ archivo: await foto('letras'), peso: 1.2, dedo: await centro(`#opciones .ficha:text-is("${letra}")`), toque: true });
    await clic(`#opciones .ficha:text-is("${letra}")`);
    pasos.push({ archivo: await foto('letras-bien'), peso: 0.8 });
    escenas.push(escena('peques', pasos));
    await atras(2);
  }

  // ---- 4. Sonidos (el mayor, bloques) ----
  await clic(pMayor + ' .entrar');
  {
    const pasos = [];
    await clic('#juegos .tarjeta:has-text("Sonidos")');
    await p.waitForSelector('#opciones .ficha');
    const palabra = (await ultima('¿Con qué sonido empieza ')).replace('¿Con qué sonido empieza ', '').replace('?', '');
    const letra = await p.evaluate((pal) => Object.entries(window.CONTENIDO.PALABRAS_INICIO).find(([, l]) => l.some(([w]) => w === pal))[0], palabra);
    const sel = `#opciones .ficha:has-text("${letra.toUpperCase()}")`;
    pasos.push({ archivo: await foto('sonidos'), peso: 2, dedo: await centro(sel), toque: true });
    await clic(sel, { position: { x: 20, y: 70 } });
    pasos.push({ archivo: await foto('sonidos-bien'), peso: 1.2 });
    escenas.push(escena('sonidos', pasos));
    await atras();
  }

  // ---- 5. Sílabas: buscar y escribir ----
  {
    const pasos = [];
    await clic('#juegos .tarjeta:has-text("Sílabas")');
    await p.waitForSelector('#opciones .ficha');
    const sil = (await ultima('Busca: ')).replace('Busca: ', '').replace('.', '');
    const sel = `#opciones .ficha:has-text("${sil.toUpperCase()}")`;
    pasos.push({ archivo: await foto('silabas'), peso: 1.4, dedo: await centro(sel), toque: true });
    await clic(sel, { position: { x: 20, y: 70 } });
    pasos.push({ archivo: await foto('silabas-bien'), peso: 0.7, dedo: await centro('[data-modo=escribir]'), toque: true });
    await p.waitForTimeout(400);
    await clic('[data-modo=escribir]');
    await p.waitForSelector('.cuaderno canvas');
    await p.waitForTimeout(300);
    const esc = (await ultima('Escribe: ')).replace('Escribe: ', '').replace('.', '').toUpperCase();
    pasos.push({ archivo: await foto('escribir'), peso: 0.8 });
    for (const [i, L] of [...esc].entries()) {
      for (const f of await trazarPorPasos(`.cuaderno .lienzo-caja:nth-child(${i + 1}) canvas`, L, 5, 'escribir-' + L)) pasos.push({ archivo: f.archivo, peso: 0.3, dedo: f.dedo });
    }
    pasos[pasos.length - 1].peso = 1.4;
    escenas.push(escena('silabas', pasos));
    await clic('[data-modo=buscar]'); // deja Sílabas como estaba
    await atras();
  }

  // ---- 6. Palabras ----
  {
    const pasos = [];
    await clic('#juegos .tarjeta:has-text("Palabras")');
    await p.waitForSelector('.hueco');
    const palabra = (await ultima('Forma la palabra: ')).replace('Forma la palabra: ', '').replace('.', '');
    const silabas = await p.evaluate((pal) => window.CONTENIDO.PALABRAS.find((w) => w.p === pal).s, palabra);
    for (const [i, s] of silabas.entries()) {
      const sel = `#opciones .ficha:not(.usada):has-text("${s.toUpperCase()}")`;
      pasos.push({ archivo: await foto('palabras-' + i), peso: i ? 1 : 1.4, dedo: await centro(sel), toque: true });
      await p.waitForTimeout(500);
      await p.locator(sel).first().click({ position: { x: 20, y: 70 } });
      await p.waitForTimeout(200);
    }
    pasos.push({ archivo: await foto('palabras-hecha', { limpiarFiesta: false }), peso: 2 });
    escenas.push(escena('palabras', pasos));
  }

  await navegador.close();
  if (errores.length) throw new Error('Errores en la página durante las capturas: ' + errores.join(' | '));
  return escenas;
}

// Uso directo: node scripts/video-capturas.mjs [carpeta]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || join(raiz, 'video', 'salida', 'capturas');
  const escenas = await capturar(dir);
  console.log(JSON.stringify(escenas.map((e) => ({ id: e.id, capturas: e.capturas.length, dedo: e.dedo.length })), null, 1));
}
