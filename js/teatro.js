/* Teatro en inglés: «The Three Little Pigs». Quien juega es el lobo y se aprende sus 9 frases (js/teatro-guion.js).
 *
 * Tres modos, todo con iconos y voz (el niño no lee inglés):
 *   escuchar  frase a frase: suena el pie del cerdito y el lobo dice su frase (karaoke); 🐢 despacio y a trozos;
 *             🎤 ¡Ahora tú!: se graba y luego suenan su grabación y la del lobo; en «huff and puff», ¡a soplar!
 *   ensayo    la obra entera: suena cada pie y le toca a él (💡 el apuntador se la dice; ✅ ¡Lo he dicho!)
 *   adivina   «¿Qué viene ahora?»: suena un pie y elige entre 3 dibujos qué dice el lobo
 *
 * El inglés: los mp3 de audio/teatro/manifest.js (window.TEATRO_AUDIOS, con los tiempos de cada palabra):
 *   { version: 1, gb: { l1: { frase: A, lenta: A, pie: A }, ... }, us: { ... } }, A = { src, palabras: [[p, ini, fin], ...] }
 * Lo que falte (o sin manifiesto), con la voz del navegador en en-GB / en-US y los tiempos estimados.
 *
 * Micrófono: solo al tocar 🎤 o 💨, nunca al entrar. La grabación se queda en memoria (la URL
 * de un Blob), no se guarda en ningún sitio ni sale del aparato, y se borra al salir; las pistas del micro se
 * paran en cuanto acaba de grabar o de soplar. Sin micro (denegado, http, vista previa) se juega igual: sin
 * grabar, y el soplido se hace tocando muchas veces.
 *
 * window.Teatro = {
 *   abrir(app)   app.js, al entrar (en el toque de la tarjeta): { caja, dato, guardarDato, ganarEstrella(n),
 *                hablar, bravo, animo, fiesta, pip, frases (CONTENIDO.teatro), avatar(el) }
 *   cerrar()     al salir: para el sonido y el micro y borra las grabaciones
 *   repintar()   si ha cambiado algo del niño (la copia en la nube)
 *   __prueba     para las pruebas automáticas
 * }
 * Lo que se guarda del niño (con el prefijo jp- y su id, como lo demás; la copia en la nube lo lleva):
 *   teatro-acento ('gb' | 'us'), teatro-modo, teatro-escena (la última de «escuchar») y teatro-dia
 *   ({dia, frases}: las frases que ya le han dado ⭐ hoy). Las grabaciones, nunca.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const MODOS = ['escuchar', 'ensayo', 'adivina'];
  const ACENTOS = ['gb', 'us'];
  // Qué hace el lobo en cada tipo de frase: el dibujo de su tarjeta (¿Qué viene ahora?) y su emoji
  const TIPOS = {
    entrar: { emoji: '🚪', nombre: 'Llama a la puerta' },
    soplar: { emoji: '💨', nombre: 'Sopla' },
    cansado: { emoji: '🧱😮', nombre: 'No puede' },
    triste: { emoji: '😢', nombre: 'Perdón' },
    amable: { emoji: '💖', nombre: 'Bueno' },
  };
  const UMBRAL_VOZ = 0.035;     // volumen (RMS) a partir del cual cuenta como que habla
  const ESPERA_VOZ = 4;         // s que espera a que empiece a hablar
  const MAX_GRABAR = 6.2;       // s de grabación desde que empieza a hablar
  const TOPE_GRABAR = 10.5;     // s de grabación como mucho, en total
  const SILENCIO_FIN = 1.8;     // s callado (después de hablar) para dar la frase por dicha
  // Soplar: cuenta lo que suenan los graves (el aire que da en el micro; el viento de la app, por el altavoz,
  // y la voz casi no llegan ahí) por encima del ruido de fondo, medido al abrir el micro. Hay que afinarlo en
  // el iPad (Teatro.__prueba.estado().soplo: los niveles del último soplido)
  const CORTE_SOPLO = 250;      // Hz: los graves
  const CALIBRAR_SOPLO = 300;   // ms al abrir el micro para medir el ruido de fondo
  const UMBRAL_SOPLO_MIN = 0.008, UMBRAL_SOPLO_MAX = 0.03; // RMS de los graves: entre esto, 3 veces el ruido
  const RITMO_SOPLO = 1;        // lo que llena por segundo un soplido a tope
  const CARGA_LADRILLO = 0.6;   // la de ladrillo no se cae: con esto ya se ve que aguanta
  const MAX_SOPLAR = 15;        // s con el micro abierto para soplar
  const TOQUE_SOPLO = 0.085;    // lo que llena un toque del botón de soplar (12 toques)

  let app = null;
  let abierto = false;
  let turno = 0;                // cada cosa nueva (escena, modo, botón) lo sube: lo de antes se para
  let modo = 'escuchar', n = 0, acento = 'gb';
  let escena = null;
  let dichoEscucha = false;     // «Escucha al lobo» solo la primera vez
  let siguienteEnsayo = null;   // ✅ en el ensayo: pasa a la siguiente
  const grabaciones = new Map(); // id de escena → URL del Blob (solo en memoria)
  const guion = () => (window.TEATRO && window.TEATRO.escenas) || [];
  const actual = () => guion()[n] || guion()[0];
  const nuevoTurno = () => {
    turno++;
    callar();
    cerrarMicro();
    if (siguienteEnsayo) { const s = siguienteEnsayo; siguienteEnsayo = null; s(); } // el ensayo que esperaba, se acaba
    // Lo que avisaba de la acción de antes (el «te toca», los botones que laten), fuera
    cartel(null);
    ['#tt-sig', '#tt-grabar'].forEach((q) => { const b = $(q); if (b) b.classList.remove('latir'); });
    return turno;
  };
  // Los efectos del teatro suenan aunque esté puesto el 🔇 de la Batalla (aquí no hay botón para quitarlo)
  const sfx = (nombre, arg) => {
    try {
      const S = window.Sfx;
      if (!S) return;
      if (S.teatro) S.teatro(nombre, arg); else if (S[nombre]) S[nombre](arg);
    } catch { /* sin sonido */ }
  };
  const frases = () => (app && app.frases) || {};
  // Las frases en español (js/frases.js): si no avisa de que ha acabado (iOS la ha pausado), se sigue igual
  const hablarEs = (texto) => {
    if (!texto || !app) return Promise.resolve();
    callar();
    return Promise.race([Promise.resolve(app.hablar(texto)).catch(() => {}), esperar(8000)]);
  };

  // =====================================================
  // INGLÉS: mp3 del manifiesto o voz del navegador, con karaoke
  // =====================================================
  const reproductor = new Audio();
  reproductor.preload = 'auto';
  reproductor.setAttribute('playsinline', '');
  let parar = null; // termina lo que esté sonando (y cumple su promesa)
  // Calla todo: el inglés, la voz del navegador y también la frase en español (window.Voz, otro reproductor)
  function callar() {
    if (parar) parar();
    try { reproductor.pause(); } catch { /* nada */ }
    try { if (window.Voz && window.Voz.callar) window.Voz.callar(); } catch { /* nada */ }
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* nada */ }
  }
  // iOS solo deja sonar después de un toque: en el primero se «desbloquea» el reproductor (y la voz)
  let desbloqueado = false;
  function desbloquear() {
    if (desbloqueado) return;
    desbloqueado = true;
    // El play() en el toque basta; el pause() justo detrás, para que no quede nada pendiente que corte la
    // primera frase
    try {
      reproductor.muted = true;
      const p = reproductor.play();
      reproductor.pause();
      if (p && p.catch) p.catch(() => {});
    } catch { /* nada */ }
    reproductor.muted = false;
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      }
    } catch { /* nada */ }
  }

  const palabrasDe = (texto) => String(texto).split(/\s+/).filter(Boolean);
  const silabas = (p) => Math.max(1, (p.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) || []).length);
  // La entrada del manifiesto (o null): con su src dentro de audio/teatro/ y los tiempos bien formados
  function audioDe(id, cual) {
    const M = window.TEATRO_AUDIOS;
    if (!M || typeof M !== 'object' || M.version !== 1) return null;
    const a = M[acento] && M[acento][id] && M[acento][id][cual];
    if (!a || typeof a.src !== 'string' || !/^audio\/teatro\/(gb|us)\/[\w.-]+\.mp3$/.test(a.src)) return null;
    const pal = Array.isArray(a.palabras) ? a.palabras.filter((p) => Array.isArray(p) && Number.isFinite(+p[1]) && Number.isFinite(+p[2])) : [];
    return { src: a.src, palabras: pal.map((p) => ({ p: String(p[0]), ini: +p[1], fin: Math.max(+p[1], +p[2]) })) };
  }
  // Los tiempos de cada palabra del texto: los del manifiesto si cuadran (las mismas palabras), si no estimados
  // (por sílabas, con una pausa en cada coma o punto), escalados al largo del audio si se sabe
  function estimar(pal, ritmo, largo) {
    const pesos = pal.map((p) => silabas(p) + 0.6);
    const pausas = pal.map((p) => (/[.!?]$/.test(p) ? 0.36 : /,$/.test(p) ? 0.24 : 0.05));
    let s = 0;
    const r = pal.map((p, i) => { const ini = s; s += pesos[i] * 0.17 * ritmo; const fin = s; s += pausas[i] * ritmo; return { p, ini, fin }; });
    if (largo && s > 0) { const k = (largo * 0.94) / s; r.forEach((x) => { x.ini *= k; x.fin *= k; }); }
    return r;
  }
  function tiemposDe(pal, a, ritmo, largo) {
    const limpia = (p) => p.toLowerCase().replace(/[^a-z']/g, '');
    if (a && a.palabras.length === pal.length && a.palabras.every((x, i) => limpia(x.p) === limpia(pal[i]))) return a.palabras;
    if (a && a.palabras.length) { // no cuadran del todo: se reparten entre la primera y la última
      const ini = a.palabras[0].ini, fin = a.palabras[a.palabras.length - 1].fin;
      return estimar(pal, ritmo, fin - ini).map((x) => ({ p: x.p, ini: x.ini + ini, fin: x.fin + ini }));
    }
    return estimar(pal, ritmo, largo);
  }
  // Boca del que habla en el instante s: abierta y cerrada una vez por sílaba; cerrada entre palabras
  function bocaEn(tiempos, s) {
    const w = tiempos.find((x) => s >= x.ini && s < x.fin);
    if (!w) return 0;
    const v = Math.abs(Math.sin(Math.PI * ((s - w.ini) / Math.max(0.05, w.fin - w.ini)) * silabas(w.p)));
    return v > 0.62 ? 2 : v > 0.22 ? 1 : 0;
  }
  const palabraEn = (tiempos, s) => { let i = -1; tiempos.forEach((x, k) => { if (s >= x.ini - 0.02) i = k; }); return i; };

  // La voz del navegador: una inglesa del acento elegido si la hay (las conocidas primero), si no la que dé
  // el navegador para en-GB / en-US
  const PREFERIDAS = {
    'en-GB': ['Daniel', 'Arthur', 'Oliver', 'Google UK English Male', 'Serena', 'Kate', 'Martha', 'Google UK English Female'],
    'en-US': ['Aaron', 'Samantha', 'Alex', 'Tom', 'Google US English', 'Allison', 'Ava'],
  };
  // Las voces de broma de Apple (robóticas, con música...): esas no
  const DE_BROMA = /^(Fred|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;
  function elegirVoz(lang) {
    let voces = [];
    try { voces = speechSynthesis.getVoices() || []; } catch { return null; }
    const norm = (l) => String(l || '').replace('_', '-').toLowerCase();
    const de = voces.filter((v) => norm(v.lang) === lang.toLowerCase());
    for (const nombre of PREFERIDAS[lang]) { const v = de.find((x) => String(x.name).includes(nombre)); if (v) return v; }
    const normales = de.filter((v) => !DE_BROMA.test(String(v.name)));
    return normales.find((v) => v.localService) || normales[0] || null;
  }

  // Dice un texto en inglés. o: { id, cual ('frase' | 'lenta' | 'pie'), texto, quien ('lobo' | 'cerdo'), lento,
  // desde/hasta (índices de palabra: un trozo), alPalabra(i), alBoca(n) }. Se cumple al acabar o al callarlo.
  function decir(t, o) {
    callar();
    return new Promise((cumplir) => {
      const pal = palabrasDe(o.texto);
      let hecho = false, raf = 0, reloj = 0;
      const terminar = () => {
        if (hecho) return;
        hecho = true;
        cancelAnimationFrame(raf); clearTimeout(reloj);
        reproductor.onended = reproductor.onerror = null;
        if (parar === terminar) parar = null;
        if (o.alBoca) o.alBoca(0);
        cumplir();
      };
      parar = terminar;
      if (t !== turno) { terminar(); return; }
      const a = o.desde == null ? audioDe(o.id, o.cual) : null;
      const avisar = (tiempos, s) => {
        const i = palabraEn(tiempos, s);
        if (o.alPalabra) o.alPalabra(i);
        if (o.alBoca) o.alBoca(bocaEn(tiempos, s));
      };
      const conVoz = () => {
        if (hecho) return;
        const texto = pal.slice(o.desde || 0, o.hasta == null ? pal.length : o.hasta + 1);
        const base = o.desde || 0;
        const ritmo = o.lento ? 1.55 : 1;
        const tiempos = estimar(texto, ritmo);
        const total = tiempos.length ? tiempos[tiempos.length - 1].fin : 1;
        let t0 = performance.now(), desfase = 0;
        const paso = () => {
          if (hecho) return;
          const s = (performance.now() - t0) / 1000 + desfase;
          const i = palabraEn(tiempos, s);
          if (o.alPalabra) o.alPalabra(i < 0 ? -1 : i + base);
          if (o.alBoca) o.alBoca(bocaEn(tiempos, s));
          raf = requestAnimationFrame(paso);
        };
        if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
          // Sin voz: el karaoke solo, para que se vea el ritmo
          paso();
          reloj = setTimeout(terminar, total * 1000 + 600);
          return;
        }
        const u = new SpeechSynthesisUtterance(texto.join(' '));
        u.lang = acento === 'us' ? 'en-US' : 'en-GB';
        const v = elegirVoz(u.lang);
        if (v) u.voice = v;
        u.rate = o.lento ? 0.58 : 0.88;
        u.pitch = o.quien === 'cerdo' ? 1.5 : 0.78; // los cerditos, más agudos; el lobo, grave
        // Al empezar de verdad, el reloj del karaoke; con los avisos de palabra (si los da), se sincroniza
        u.onstart = () => { t0 = performance.now(); desfase = 0; };
        const inicios = []; let c = 0;
        texto.forEach((p) => { inicios.push(c); c += p.length + 1; });
        u.onboundary = (ev) => {
          if (ev.name && ev.name !== 'word') return;
          let i = 0;
          inicios.forEach((x, k) => { if (ev.charIndex >= x) i = k; });
          if (tiempos[i]) desfase = tiempos[i].ini - (performance.now() - t0) / 1000;
        };
        u.onend = u.onerror = terminar;
        setTimeout(() => { if (!hecho) { try { speechSynthesis.speak(u); } catch { /* sin voz */ } } }, 40);
        paso();
        reloj = setTimeout(terminar, total * 1800 + 3000); // por si la voz no avisa de que ha acabado
      };
      if (!a) { conVoz(); return; }
      // Con mp3 (si no se puede cargar, con la voz del navegador: una sola vez)
      let tiempos = null, caido = false;
      const aVoz = () => {
        if (caido || hecho) return;
        caido = true;
        reproductor.onended = reproductor.onerror = null;
        try { reproductor.pause(); } catch { /* nada */ }
        cancelAnimationFrame(raf); clearTimeout(reloj);
        conVoz();
      };
      reproductor.onerror = aVoz;
      reproductor.onended = terminar;
      if (!reproductor.src.endsWith(a.src)) reproductor.src = a.src;
      try { reproductor.currentTime = 0; } catch { /* aún sin cargar */ }
      ponerRitmo(1);
      reloj = setTimeout(aVoz, 5000); // si el mp3 no llega (la red colgada), la voz del navegador
      const p = reproductor.play();
      const empezar = () => {
        if (hecho || caido) return;
        clearTimeout(reloj);
        tiempos = tiemposDe(pal, a, 1, reproductor.duration);
        const paso = () => {
          if (hecho) return;
          avisar(tiempos, reproductor.currentTime);
          raf = requestAnimationFrame(paso);
        };
        paso();
        const largo = Number.isFinite(reproductor.duration) ? reproductor.duration : 8;
        reloj = setTimeout(terminar, largo * 1000 + 2500);
      };
      if (p && p.then) p.then(empezar, aVoz);
      else empezar();
    });
  }

  // Los trozos de una frase (separados por comas o puntos): [[primera palabra, última], ...]. Si la escena
  // trae los suyos (js/teatro-guion.js, para partir una frase larga sin comas) y cuadran, esos
  function trozos(texto) {
    const pal = palabrasDe(texto), r = [];
    const e = guion().find((x) => x.frase === texto && Array.isArray(x.trozos));
    if (e) {
      let sigue = 0;
      const bien = e.trozos.every((x) => Array.isArray(x) && x[0] === sigue && Number.isInteger(x[1]) && x[1] >= x[0] && (sigue = x[1] + 1));
      if (bien && sigue === pal.length) return e.trozos.map((x) => [x[0], x[1]]);
    }
    let desde = 0;
    pal.forEach((p, i) => { if (/[,.!?]$/.test(p) || i === pal.length - 1) { r.push([desde, i]); desde = i + 1; } });
    return r;
  }
  // 🐢 La versión lenta, si no es bastante más lenta que la normal (la británica casi no lo es), algo más despacio
  function ritmoLenta(id) {
    const fin = (x) => (x && x.palabras.length ? x.palabras[x.palabras.length - 1].fin : 0);
    const f = fin(audioDe(id, 'frase')), l = fin(audioDe(id, 'lenta'));
    return f > 0 && l > 0 ? Math.max(0.8, Math.min(1, l / f / 1.4)) : 1;
  }
  function ponerRitmo(k) {
    try {
      if ('preservesPitch' in reproductor) reproductor.preservesPitch = true;
      else if ('webkitPreservesPitch' in reproductor) reproductor.webkitPreservesPitch = true;
      reproductor.playbackRate = k;
    } catch { /* a su ritmo */ }
  }
  // Un trozo del mp3 lento: suena desde donde esté hasta el final de la palabra «hasta» y se para (el siguiente
  // trozo sigue desde ahí: sin saltos, que en el iPad no siempre van bien). En la voz lenta no hay silencio
  // entre trozos: se para justo al acabar su última palabra (un poco antes, lo que tarda un fotograma), para
  // no llevarse el principio de la siguiente
  function trozoMp3(t, a, pal, hasta, o) {
    callar();
    return new Promise((cumplir) => {
      let hecho = false, raf = 0, reloj = 0;
      const terminar = (bien) => {
        if (hecho) return;
        hecho = true;
        cancelAnimationFrame(raf); clearTimeout(reloj);
        reproductor.onended = reproductor.onerror = null;
        try { reproductor.pause(); } catch { /* nada */ }
        if (parar === terminar) parar = null;
        if (o.alBoca) o.alBoca(0);
        cumplir(!!bien);
      };
      parar = terminar;
      if (t !== turno) { terminar(); return; }
      reproductor.onended = () => terminar(true);
      reproductor.onerror = () => terminar(false);
      let tiempos = null;
      if (o.ritmo) ponerRitmo(o.ritmo);
      reloj = setTimeout(() => terminar(false), 5000); // si no llega, ese trozo y los demás con la voz del navegador
      const p = reproductor.play();
      const empezar = () => {
        if (hecho) return;
        clearTimeout(reloj);
        tiempos = tiemposDe(pal, a, 1.55, reproductor.duration);
        const ultimo = hasta >= pal.length - 1;
        const fin = tiempos[hasta] ? tiempos[hasta].fin + (ultimo ? 0.08 : -0.01) : Infinity;
        const paso = () => {
          if (hecho) return;
          const s = reproductor.currentTime;
          if (o.alPalabra) o.alPalabra(Math.max(o.desde || 0, Math.min(palabraEn(tiempos, s), hasta))); // las de este trozo
          if (o.alBoca) o.alBoca(bocaEn(tiempos, s));
          if (s >= fin) { terminar(true); return; }
          raf = requestAnimationFrame(paso);
        };
        paso();
        reloj = setTimeout(() => terminar(true), 12000);
      };
      if (p && p.then) p.then(empezar, () => terminar(false)); else empezar();
    });
  }

  // =====================================================
  // MICRÓFONO: solo en memoria, solo al tocar, y se cierra en cuanto acaba
  // =====================================================
  let ctxAudio = null;
  let micro = null; // { stream, fuente, analizador, datos, oido; para soplar: filtros, graves, datosGraves }
  let microNo = false; // denegado o no hay: ya no se vuelve a pedir en esta visita
  // En el toque (iOS): el contexto de audio para medir el volumen. Suspendido (al cerrar el micro) o, en iOS,
  // «interrupted» (tras una llamada o Siri): se reanuda
  function asegurarCtx() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctxAudio) ctxAudio = new AC();
      if (ctxAudio.state !== 'running' && ctxAudio.state !== 'closed' && ctxAudio.resume) ctxAudio.resume().catch(() => {});
      return ctxAudio;
    } catch { return null; }
  }
  // iOS 16.4 o más: «playback» para que los efectos (Web Audio) suenen también con el modo silencio, como las
  // voces; para el micro, «auto» (si no, puede no grabar)
  function tipoSesion(tipo) {
    try { if (navigator.audioSession) navigator.audioSession.type = tipo; } catch { /* nada */ }
  }
  const puedeMicro = () => !microNo && window.isSecureContext !== false && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  async function abrirMicro(paraSoplar) {
    if (!puedeMicro()) { microNo = true; return null; }
    const t = turno;
    cerrarMicro(true);
    tipoSesion('auto');
    let stream;
    try {
      // Para soplar, sin los filtros del micro (quitarían el ruido del soplido y bajarían el volumen)
      stream = await navigator.mediaDevices.getUserMedia({
        audio: paraSoplar ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true,
      });
    } catch (e) {
      microNo = true;
      if (abierto && !micro) tipoSesion('playback');
      return null;
    }
    if (t !== turno || !abierto) {
      stream.getTracks().forEach((p) => p.stop());
      if (abierto && !micro) tipoSesion('playback');
      return null;
    }
    cerrarMicro(true);
    micro = { stream };
    const c = asegurarCtx();
    if (c) {
      try {
        micro.fuente = c.createMediaStreamSource(stream);
        micro.analizador = c.createAnalyser();
        micro.analizador.fftSize = 1024;
        micro.datos = new Uint8Array(micro.analizador.fftSize);
        micro.fuente.connect(micro.analizador);
        if (paraSoplar) {
          // Los graves: dos pasos bajos seguidos (lo de encima de CORTE_SOPLO, casi nada) y su propio medidor.
          // En Web Audio, la Q del paso bajo va en dB: −3,01 dB es la de Butterworth (sin pico en el corte)
          micro.filtros = [c.createBiquadFilter(), c.createBiquadFilter()];
          micro.filtros.forEach((f) => { f.type = 'lowpass'; f.frequency.value = CORTE_SOPLO; f.Q.value = -3.01; });
          micro.graves = c.createAnalyser();
          micro.graves.fftSize = 2048;
          micro.datosGraves = micro.graves.getFloatTimeDomainData ? new Float32Array(2048) : new Uint8Array(2048);
          micro.fuente.connect(micro.filtros[0]);
          micro.filtros[0].connect(micro.filtros[1]);
          micro.filtros[1].connect(micro.graves);
        }
        if (c.state !== 'running') c.resume().catch(() => {});
      } catch { /* sin medidor */ }
    }
    return micro;
  }
  // El volumen (RMS) de lo que oye el micro. micro.oido: el medidor da algo (un micro de verdad siempre tiene algo
  // de ruido; si todo es 128, es que el medidor no funciona)
  function nivelMicro() {
    if (!micro || !micro.analizador) return 0;
    const d = micro.datos;
    micro.analizador.getByteTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; }
    if (s > 0) micro.oido = true;
    return Math.sqrt(s / d.length);
  }
  // El volumen (RMS) de los graves, para soplar
  function nivelGraves() {
    const a = micro && micro.graves;
    if (!a) return 0;
    const d = micro.datosGraves;
    let s = 0;
    if (d instanceof Float32Array) { a.getFloatTimeDomainData(d); for (let i = 0; i < d.length; i++) s += d[i] * d[i]; }
    else { a.getByteTimeDomainData(d); for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; } }
    return Math.sqrt(s / d.length);
  }
  // Apaga el micro (y el contexto del medidor, y la sesión de audio vuelve a la de solo sonar). seguir: se va a
  // abrir otro enseguida
  function cerrarMicro(seguir) {
    if (!micro) return;
    try { micro.stream.getTracks().forEach((p) => p.stop()); } catch { /* nada */ }
    try { if (micro.fuente) micro.fuente.disconnect(); } catch { /* nada */ }
    try { (micro.filtros || []).forEach((f) => f.disconnect()); } catch { /* nada */ }
    micro = null;
    pintarNivel(0);
    if (seguir) return;
    try { if (ctxAudio && ctxAudio.state === 'running') ctxAudio.suspend().catch(() => {}); } catch { /* nada */ }
    if (abierto) tipoSesion('playback');
  }
  function formatoGrabacion() {
    if (typeof MediaRecorder === 'undefined') return null;
    const lista = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    try { return lista.find((f) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(f)) || ''; } catch { return ''; }
  }
  function borrarGrabaciones() {
    grabaciones.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* nada */ } });
    grabaciones.clear();
  }

  // =====================================================
  // PANTALLA: el guion (karaoke), los botones y la tira de escenas
  // =====================================================
  function mostrarLinea(texto, es, quien, { oculta = false } = {}) {
    const linea = $('#tt-linea');
    linea.innerHTML = '';
    linea.classList.remove('sonando');
    linea.dataset.quien = quien;
    const icono = document.createElement('span');
    icono.className = 'tt-quien';
    icono.setAttribute('aria-hidden', 'true');
    icono.textContent = quien === 'lobo' ? '🐺' : '🐷';
    linea.appendChild(icono);
    // Las palabras de cada trozo, juntas (si cabe, el trozo pasa entero a la línea siguiente: como en 🐢)
    const pal = palabrasDe(texto);
    trozos(texto).forEach(([desde, hasta]) => {
      const grupo = document.createElement('span');
      grupo.className = 'tt-trozo';
      pal.slice(desde, hasta + 1).forEach((p, k) => {
        if (k) grupo.appendChild(document.createTextNode(' '));
        const s = document.createElement('span');
        s.className = 'tt-p';
        s.textContent = p;
        grupo.appendChild(s);
      });
      linea.appendChild(grupo);
      linea.appendChild(document.createTextNode(' '));
    });
    linea.classList.toggle('oculta', oculta);
    $('#tt-es').textContent = es || '';
    $('#tt-es').classList.toggle('oculta', oculta);
  }
  // Karaoke: la palabra que suena, encendida; las ya dichas, normales; las que faltan, más claritas
  function marcar(i) {
    const linea = $('#tt-linea');
    linea.classList.add('sonando');
    linea.querySelectorAll('.tt-p').forEach((s, k) => { s.classList.toggle('ahora', k === i); s.classList.toggle('dicha', k < i); });
  }
  function limpiarMarcas() {
    const linea = $('#tt-linea');
    linea.classList.remove('sonando');
    linea.querySelectorAll('.tt-p').forEach((s) => s.classList.remove('ahora', 'dicha'));
  }

  function pintarCabecera() {
    document.querySelectorAll('[data-tt-modo]').forEach((b) => {
      const si = b.dataset.ttModo === modo;
      b.classList.toggle('activo', si);
      b.setAttribute('aria-pressed', si ? 'true' : 'false');
    });
    document.querySelectorAll('[data-acento]').forEach((b) => {
      const si = b.dataset.acento === acento;
      b.classList.toggle('activo', si);
      b.setAttribute('aria-pressed', si ? 'true' : 'false');
    });
    $('#tt-escuchar').hidden = modo !== 'escuchar';
    $('#tt-ensayo').hidden = modo !== 'ensayo';
    $('#tt-adivina').hidden = modo !== 'adivina';
    $('#v-teatro').dataset.modo = modo;
  }

  // La tira de las 9 escenas: con su dibujo; ✓ las frases que ya ha repetido hoy (en «escuchar»)
  function pintarTira() {
    const tira = $('#tt-tira');
    if (!tira.children.length) {
      guion().forEach((e, i) => {
        const b = document.createElement('button');
        b.className = 'tt-mini';
        b.dataset.i = i;
        b.setAttribute('aria-label', 'Escena ' + (i + 1));
        b.innerHTML = '<canvas aria-hidden="true"></canvas><span class="tt-num" aria-hidden="true"></span>';
        b.lastChild.textContent = i + 1;
        if (window.TeatroEscena) window.TeatroEscena.miniatura(b.firstChild, e.id);
        b.addEventListener('click', () => { if (modo === 'escuchar') verEscena(i); });
        tira.appendChild(b);
      });
    }
    const hechas = frasesDeHoy();
    [...tira.children].forEach((b, i) => {
      const e = guion()[i];
      b.classList.toggle('activa', i === n);
      b.classList.toggle('hecha', modo === 'escuchar' ? hechas.includes(claveFrase(e)) : modo === 'ensayo' && i < n);
      b.disabled = modo !== 'escuchar';
      b.setAttribute('aria-current', i === n ? 'step' : 'false');
    });
    // En el móvil la tira se desplaza: la escena de ahora, en el centro (sin scrollIntoView, que en iOS mueve
    // también la página)
    const b = tira.children[n];
    if (b && tira.scrollWidth > tira.clientWidth + 1) {
      const izq = tira.scrollLeft + b.getBoundingClientRect().left - tira.getBoundingClientRect().left - (tira.clientWidth - b.offsetWidth) / 2;
      try { tira.scrollTo({ left: izq, behavior: 'smooth' }); } catch { tira.scrollLeft = izq; }
    }
  }

  // El cartel encima del escenario: ⭐⭐⭐, el micro grabando o el «te toca»
  function cartel(contenido, clase) {
    const c = $('#tt-cartel');
    c.hidden = !contenido;
    c.className = 'tt-cartel' + (clase ? ' ' + clase : '');
    c.textContent = contenido || '';
  }
  function pintarNivel(v) {
    const k = Math.max(0, Math.min(1, v * 6));
    document.querySelectorAll('.tt-nivel i').forEach((i) => { i.style.transform = 'scaleX(' + k.toFixed(3) + ')'; });
    const c = $('#tt-cartel');
    if (c && c.classList.contains('grabando')) c.style.setProperty('--nivel', k.toFixed(3));
  }
  function pintarSoplo(carga) {
    document.querySelectorAll('.tt-medidor i').forEach((i) => { i.style.transform = 'scaleX(' + Math.max(0, Math.min(1, carga)).toFixed(3) + ')'; });
  }
  function pintarEscuchar() {
    const e = actual();
    $('#tt-ant').disabled = n <= 0;
    $('#tt-sig').disabled = n >= guion().length - 1;
    $('#tt-tuyo').hidden = !grabaciones.has(e.id);
    $('#tt-grabar').classList.toggle('sin-micro', microNo);
    $('#tt-grabar').classList.remove('grabando');
  }
  function mostrarSoplar(si) {
    const b = $('#tt-soplar');
    b.hidden = !si;
    b.classList.toggle('latir', !!si);
    pintarSoplo(0);
  }

  // =====================================================
  // LO QUE SE GUARDA (del niño)
  // =====================================================
  const dato = (k, def) => (app ? app.dato(k, def) : def);
  const guardar = (k, v) => { if (app) app.guardarDato(k, v); };
  const hoyTexto = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  // Las frases iguales (l2, l4 y l6; l3 y l5) cuentan como una: la ⭐ es por frase aprendida, no por escena
  const claveFrase = (e) => { const p = guion().find((x) => x.frase === e.frase); return p ? p.id : e.id; };
  function frasesDeHoy() {
    const d = dato('teatro-dia', null);
    return d && d.dia === hoyTexto() && Array.isArray(d.frases) ? d.frases.filter((x) => typeof x === 'string') : [];
  }
  // ⭐ la primera vez en el día que repite una frase (con el micro, si se le ha oído hablar)
  function premiarFrase(e) {
    const hechas = frasesDeHoy(), k = claveFrase(e);
    if (hechas.includes(k)) return false;
    guardar('teatro-dia', { dia: hoyTexto(), frases: [...hechas, k] });
    if (app) { app.ganarEstrella(1); app.pip(880); app.fiesta(); }
    pintarTira();
    return true;
  }

  // =====================================================
  // LO QUE PASA EN CADA ESCENA
  // =====================================================
  // El lobo antes del pie y mientras dice su frase
  const animoAntes = (e) => (e.tipo === 'cansado' ? 'agotado' : e.tipo === 'amable' ? 'triste' : 'quieto');
  const animoFrase = (e) => ({ triste: 'triste', amable: 'feliz', cansado: 'agotado' }[e.tipo] || 'quieto');

  function prepararEscena(e) {
    if (!escena) return;
    escena.preparar(e.id);
    escena.lobo(animoAntes(e));
  }
  // El pie: toc, toc (si llaman) y la frase del cerdito (o de los cerditos)
  async function decirPie(t, e) {
    if (e.pie.ruido === 'toc') {
      sfx('tocToc');
      if (escena) await escena.tocToc();
      if (t !== turno) return;
      if (escena) escena.lobo(animoAntes(e));
    }
    mostrarLinea(e.pie.texto, e.pie.es, 'cerdo');
    const reir = /^ha ha/i.test(e.pie.texto);
    await decir(t, {
      id: e.id, cual: 'pie', texto: e.pie.texto, quien: 'cerdo', alPalabra: marcar,
      alBoca: (b) => { if (escena) escena.hablan(e.pie.quien, b ? 1 : 0, { reir }); },
    });
    if (escena) escena.hablan(null, 0);
  }
  // La frase del lobo (cual: 'frase' o 'lenta')
  async function decirLobo(t, e, cual) {
    mostrarLinea(e.frase, e.es, 'lobo');
    if (escena) escena.lobo(animoFrase(e));
    if (e.tipo === 'amable') { sfx('victoria'); if (escena) escena.confeti(50); }
    await decir(t, { id: e.id, cual: cual || 'frase', texto: e.frase, quien: 'lobo', lento: cual === 'lenta', alPalabra: marcar, alBoca: (b) => escena && escena.boca(b) });
    if (escena) escena.boca(0);
  }
  // Lo que pasa después de la frase, sin soplar de verdad (ensayo, ¿Qué viene ahora?): sopla él solo
  async function accionSola(t, e) {
    if (!escena) return;
    if (e.tipo === 'soplar') {
      escena.lobo('mofletes'); sfx('inflar');
      await esperar(700);
      if (t !== turno) return;
      escena.lobo('soplar');
      for (let k = 0; k <= 10; k++) {
        if (t !== turno) return;
        escena.soplo(1, k / 10);
        if (k % 2 === 0) sfx('viento', 1);
        await esperar(120);
      }
      await tirarCasa(t, e);
    } else if (e.tipo === 'cansado') { escena.lobo('agotado'); sfx('uf'); }
    else if (e.tipo === 'amable') escena.corazones(8);
  }
  // La casa no aguanta más: la de paja y la de palos salen volando; la de ladrillo, no (y el lobo, agotado)
  async function tirarCasa(t, e) {
    if (!escena) return;
    escena.soplo(0, 0);
    if (e.casa === 'ladrillos') {
      sfx('golpe');
      await escena.aguantar();
      if (t !== turno) return;
      escena.lobo('agotado');
      sfx('uf');
      await esperar(500);
      return;
    }
    escena.lobo('soplar');
    sfx('casaCae');
    await escena.derribar();
    if (t !== turno) return;
    escena.lobo('quieto');
  }

  // =====================================================
  // MODO 1: ESCUCHAR Y REPETIR
  // =====================================================
  async function verEscena(i, { callado = false } = {}) {
    const t = nuevoTurno();
    n = Math.max(0, Math.min(guion().length - 1, i));
    const e = actual();
    guardar('teatro-escena', e.id);
    prepararEscena(e);
    mostrarSoplar(false);
    cartel(null);
    pintarEscuchar();
    pintarTira();
    mostrarLinea(e.frase, e.es, 'lobo');
    if (callado) return;
    if (!dichoEscucha) { dichoEscucha = true; await hablarEs(frases().escucha); }
    if (t === turno) await escucharEscena(t);
  }
  async function escucharEscena(t) {
    const e = actual();
    prepararEscenaSinMover(e);
    await decirPie(t, e);
    if (t !== turno) return;
    await esperar(250);
    if (t !== turno) return;
    await decirLobo(t, e, 'frase');
    if (t !== turno) return;
    limpiarMarcas();
    await trasLaFrase(t, e);
  }
  // Volver a empezar la escena sin que la casa vuelva a bajar (si ya está)
  function prepararEscenaSinMover(e) {
    if (!escena) return;
    const st = escena.estado();
    if (st.id !== e.id || st.casaEstado !== 'pie' || (e.casa && st.casa !== e.casa)) escena.preparar(e.id);
    escena.lobo(animoAntes(e));
    escena.soplo(0, 0);
  }
  async function trasLaFrase(t, e) {
    if (e.tipo === 'soplar') {
      if (escena) escena.lobo('mofletes');
      mostrarSoplar(true);
      await hablarEs(frases().sopla);
    } else {
      if (e.tipo === 'cansado') sfx('uf');
      if (t === turno) $('#tt-grabar').classList.add('latir'); // y ahora él: 🎤
    }
  }

  // 🐢 Despacio y a trozos: cada trozo de la versión lenta y una pausa para que lo repita
  async function despacio() {
    const t = nuevoTurno();
    const e = actual();
    prepararEscenaSinMover(e);
    mostrarSoplar(false);
    mostrarLinea(e.frase, e.es, 'lobo');
    if (escena) escena.lobo(animoFrase(e));
    const pal = palabrasDe(e.frase);
    const a = audioDe(e.id, 'lenta');
    let mp3 = !!a;
    const ritmo = mp3 ? ritmoLenta(e.id) : 1;
    if (mp3) { if (!reproductor.src.endsWith(a.src)) reproductor.src = a.src; try { reproductor.currentTime = 0; } catch { /* nada */ } ponerRitmo(ritmo); }
    const tiempos = tiemposDe(pal, a, 1.55, null);
    for (const [desde, hasta] of trozos(e.frase)) {
      if (t !== turno) return;
      const alBoca = (b) => escena && escena.boca(b);
      if (mp3) mp3 = await trozoMp3(t, a, pal, hasta, { alPalabra: marcar, alBoca, desde, ritmo });
      if (t !== turno) return;
      if (!mp3) await decir(t, { texto: e.frase, desde, hasta, quien: 'lobo', lento: true, alPalabra: marcar, alBoca });
      if (t !== turno) return;
      // Te toca: un hueco algo más largo que el trozo (lo que dura, más lo que tarda en arrancar)
      const dura = tiempos[desde] && tiempos[hasta] ? Math.max(0, tiempos[hasta].fin - tiempos[desde].ini) / (mp3 ? ritmo : 1) : 1;
      const largo = Math.max(2.2, 1.3 * dura + 1);
      cartel('🗣️', 'tu-turno');
      await esperar(largo * 1000);
      if (t === turno) cartel(null);
    }
    if (t === turno) limpiarMarcas();
  }

  // 🎤 ¡Ahora tú!: graba (hasta que se calla), y suenan su grabación y la del lobo
  let pararGrabacion = null;
  let microPedido = false; // la primera vez en cada visita, el micro se pide antes de «¡Ahora tú!» (abajo)
  async function ahoraTu() {
    if (pararGrabacion) { pararGrabacion(); return; } // tocar otra vez: ya está
    const t = nuevoTurno();
    const e = actual();
    asegurarCtx();
    mostrarSoplar(false);
    prepararEscenaSinMover(e);
    mostrarLinea(e.frase, e.es, 'lobo');
    // iOS pregunta por el micro la primera vez: así el aviso sale antes de la frase y no mientras la dice
    // (la grabación empezaría tarde). Las demás veces, el micro se abre al acabar la frase
    let m = null;
    const elMio = () => { if (m && micro === m) cerrarMicro(); }; // (el de otra acción, no)
    if (!microPedido && puedeMicro()) {
      microPedido = true;
      m = await abrirMicro(false);
      if (t !== turno) { elMio(); return; }
    }
    await hablarEs(frases().ahoraTu);
    if (t !== turno) { elMio(); return; }
    if (!m) m = await abrirMicro(false);
    if (t !== turno) { elMio(); return; }
    const boton = $('#tt-grabar');
    let oido = false; // se le ha oído (o no se puede saber): ⭐ y ¡bravo!
    if (!m) {
      // Sin micro: un rato para que la diga, y luego el lobo otra vez
      pintarEscuchar();
      cartel('🗣️', 'tu-turno');
      await esperar(4200);
      if (t !== turno) return;
      cartel(null);
      oido = true;
      await decirLobo(t, e, 'frase');
    } else {
      const formato = formatoGrabacion();
      let rec = null; const trozosRec = [];
      if (formato !== null) {
        try { rec = new MediaRecorder(m.stream, formato ? { mimeType: formato } : undefined); } catch { try { rec = new MediaRecorder(m.stream); } catch { rec = null; } }
      }
      if (rec) { rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) trozosRec.push(ev.data); }; try { rec.start(); } catch { rec = null; } }
      boton.classList.add('grabando');
      cartel('🎤', 'grabando');
      const r = await escucharHasta(t);
      boton.classList.remove('grabando');
      if (t === turno) cartel(null);
      const parado = rec ? new Promise((ok) => { rec.onstop = ok; setTimeout(ok, 1500); }) : Promise.resolve();
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* nada */ }
      await parado;
      elMio(); // el micro se apaga ya (el indicador del iPad también)
      if (t !== turno) return;
      // Sin medidor (todo plano) no se sabe si ha hablado: como sin micro, se le da por dicha
      oido = r.voz > 0.3 || r.plano;
      if (oido && rec && trozosRec.length) {
        const blob = new Blob(trozosRec, { type: rec.mimeType || formato || 'audio/mp4' });
        if (grabaciones.has(e.id)) URL.revokeObjectURL(grabaciones.get(e.id));
        grabaciones.set(e.id, URL.createObjectURL(blob));
        pintarEscuchar();
        // Un respiro: en iOS el audio tarda un poco en salir del modo grabar (con auriculares bluetooth, más)
        await esperar(350);
        if (t !== turno) return;
        await compararGrabacion(t, e);
      } else await decirLobo(t, e, 'frase'); // no ha dicho nada: sin oír el silencio, el lobo otra vez
    }
    if (t !== turno) return;
    limpiarMarcas();
    if (oido) premiarFrase(e);
    await hablarEs(app ? (oido ? app.bravo() : app.animo()) : '');
    if (t !== turno) return;
    if (!oido) $('#tt-grabar').classList.add('latir'); // ¡otra vez!
    if (e.tipo === 'soplar') { if (escena) escena.lobo('mofletes'); mostrarSoplar(true); }
    else if (oido && n < guion().length - 1) $('#tt-sig').classList.add('latir'); // y a la siguiente
  }
  // Escucha el micro hasta que se calla después de hablar: espera hasta ESPERA_VOZ s a que empiece y, desde que
  // empieza, como mucho MAX_GRABAR s (y TOPE_GRABAR en total). Devuelve { voz: cuánto ha hablado (s), plano: el
  // medidor no ha dado nada }
  function escucharHasta(t) {
    return new Promise((ok) => {
      const m = micro;
      const ini = performance.now();
      let ultimo = ini, voz = 0, silencio = 0, primera = null, hecho = false;
      const acabar = () => { if (hecho) return; hecho = true; pararGrabacion = null; ok({ voz, plano: !(m && m.oido) }); };
      pararGrabacion = acabar;
      const paso = () => {
        if (hecho) return;
        if (t !== turno || !micro) { acabar(); return; }
        const ahora = performance.now(), dt = (ahora - ultimo) / 1000;
        ultimo = ahora;
        const v = nivelMicro();
        pintarNivel(v);
        const total = (ahora - ini) / 1000;
        if (v > UMBRAL_VOZ) { voz += dt; silencio = 0; if (primera == null) primera = total; } else silencio += dt;
        // Con el medidor plano (no da nada) no se sabe cuándo empieza: se graba MAX_GRABAR s enteros, para no
        // cortar a un niño que empieza tarde
        const espera = m && m.oido ? ESPERA_VOZ : MAX_GRABAR;
        if ((voz > 0.35 && silencio > SILENCIO_FIN) || (primera != null && total - primera > MAX_GRABAR) ||
          (primera == null && total > espera) || total > TOPE_GRABAR) { acabar(); return; }
        requestAnimationFrame(paso);
      };
      paso();
    });
  }
  // ▶ su grabación y ▶ el lobo, uno detrás de otro
  async function compararGrabacion(t, e) {
    const url = grabaciones.get(e.id);
    if (!url) return;
    callar();
    $('#tt-tuyo').classList.add('sonando');
    await new Promise((ok) => {
      let hecho = false;
      const fin = () => { if (hecho) return; hecho = true; reproductor.onended = reproductor.onerror = null; if (parar === fin) parar = null; ok(); };
      parar = fin;
      reproductor.onended = reproductor.onerror = fin;
      reproductor.src = url;
      ponerRitmo(1);
      const p = reproductor.play();
      if (p && p.catch) p.catch(fin);
      setTimeout(fin, (TOPE_GRABAR + 2) * 1000);
    });
    $('#tt-tuyo').classList.remove('sonando');
    if (t !== turno) return;
    await esperar(350);
    if (t !== turno) return;
    await decirLobo(t, e, 'frase');
  }

  // 💨 ¡Sopla!: con el micro (lo fuerte que sopla) y también tocando muchas veces el botón
  let soplando = null; // { carga, toques, fuerza }
  let ultimoSoplo = null; // los niveles del último soplido con micro (para afinar en el iPad)
  const mediana = (l) => { if (!l.length) return 0; const o = [...l].sort((x, y) => x - y); return o[Math.floor(o.length / 2)]; };
  async function soplar() {
    const e = actual();
    if (e.tipo !== 'soplar') return;
    if (soplando) { soplando.toques += 1; return; }
    callar(); // también «¡Sopla muy fuerte!»: que no la oiga el micro
    const t = turno;
    asegurarCtx();
    if (window.Sfx) window.Sfx.activar();
    soplando = { carga: 0, toques: 1, fuerza: 0 };
    if (escena) escena.lobo('mofletes');
    const conMicro = puedeMicro();
    if (!conMicro) sfx('inflar'); // con el micro, nada sonando mientras mide el ruido de fondo
    const m = await abrirMicro(true); // sin micro (o sin permiso), se sopla tocando
    if (t !== turno) { soplando = null; return; }
    // La de ladrillo no se cae: con CARGA_LADRILLO ya ha soplado bastante
    const meta = e.casa === 'ladrillos' ? CARGA_LADRILLO : 1;
    const ini = performance.now();
    // El ruido de fondo: la mediana de los primeros CALIBRAR_SOPLO ms y, luego, lo más bajo que se oiga (si
    // ya estaba soplando al abrirse, el umbral baja en cuanto coge aire)
    const mide = { ruido: [], base: null, suelo: 0, liso: 0, umbral: UMBRAL_SOPLO_MAX, niveles: [], max: 0 };
    let ultimo = ini, ultimoViento = 0;
    await new Promise((ok) => {
      const paso = () => {
        if (t !== turno) { ok(); return; }
        const ahora = performance.now(), dt = Math.min(0.1, (ahora - ultimo) / 1000);
        ultimo = ahora;
        const s = soplando;
        // Cada toque es un soplido corto; el micro, lo que sople de verdad
        let deMicro = 0;
        if (micro) {
          const nivel = nivelGraves();
          if (ahora - ini < CALIBRAR_SOPLO) mide.ruido.push(nivel);
          else {
            if (mide.base == null) { mide.base = mediana(mide.ruido); mide.suelo = mide.liso = mide.base; }
            mide.liso += (nivel - mide.liso) * Math.min(1, dt * 10);
            mide.suelo = Math.min(mide.suelo, mide.liso);
            mide.umbral = Math.max(UMBRAL_SOPLO_MIN, Math.min(UMBRAL_SOPLO_MAX, mide.suelo * 3));
            const tramo = Math.max(0.03, Math.min(0.12, mide.umbral * 3)); // de nada a soplar a tope
            deMicro = Math.max(0, Math.min(1, (nivel - mide.umbral) / tramo));
            if (mide.niveles.length < 2000) mide.niveles.push(nivel);
            mide.max = Math.max(mide.max, nivel);
          }
          pintarNivel(nivel);
        }
        if (s.toques) { s.carga += s.toques * TOQUE_SOPLO; s.fuerza = 1; s.toques = 0; }
        s.fuerza = Math.max(deMicro, s.fuerza - dt * 2.5);
        s.carga = Math.min(meta, s.carga + deMicro * dt * RITMO_SOPLO);
        pintarSoplo(s.carga / meta);
        if (escena) {
          escena.lobo(s.fuerza > 0.1 || ahora - ini > 600 ? 'soplar' : 'mofletes');
          escena.soplo(s.fuerza, s.carga / meta);
        }
        // El viento, más bajito con el micro abierto (que no se oiga a sí mismo)
        if (s.fuerza > 0.15 && ahora - ultimoViento > 230) { ultimoViento = ahora; sfx('viento', micro ? s.fuerza * 0.5 : s.fuerza); }
        if (s.carga >= meta) { ok(); return; }
        if (micro && ahora - ini > MAX_SOPLAR * 1000) cerrarMicro(); // se sigue tocando
        requestAnimationFrame(paso);
      };
      paso();
    });
    if (mide.base != null) {
      ultimoSoplo = { ruido: +mide.base.toFixed(4), umbral: +mide.umbral.toFixed(4), max: +mide.max.toFixed(4),
        mediana: +mediana(mide.niveles).toFixed(4), s: +((performance.now() - ini) / 1000).toFixed(2) };
    }
    if (m && micro === m) cerrarMicro();
    soplando = null;
    if (t !== turno) return;
    mostrarSoplar(false);
    await tirarCasa(t, e);
    if (t !== turno) return;
    await hablarEs(app ? app.bravo() : '');
    if (t === turno) $('#tt-sig').classList.add('latir');
  }

  // =====================================================
  // MODO 2: ENSAYO (la obra entera)
  // =====================================================
  function abrirEnsayo() {
    const t = nuevoTurno();
    n = 0;
    prepararEscena(guion()[0]);
    if (escena) escena.telon(false);
    mostrarLinea(guion()[0].pie.texto, guion()[0].pie.es, 'cerdo', { oculta: true });
    cartel(null);
    botonesEnsayo('empezar');
    pintarTira();
    void t;
  }
  function botonesEnsayo(fase) {
    $('#tt-empezar').hidden = fase !== 'empezar';
    $('#tt-apuntador').hidden = fase !== 'toca';
    $('#tt-dicho').hidden = fase !== 'toca';
    $('#tt-otra').hidden = fase !== 'fin';
    $('#tt-dicho').classList.toggle('latir', fase === 'toca');
  }
  async function empezarEnsayo() {
    const t = nuevoTurno();
    botonesEnsayo(null);
    n = 0;
    prepararEscena(guion()[0]);
    pintarTira();
    if (escena) await escena.telon(true);
    if (t !== turno) return;
    await hablarEs(frases().ensayo);
    for (let i = 0; i < guion().length; i++) {
      if (t !== turno) return;
      n = i;
      const e = actual();
      prepararEscenaSinMover(e);
      pintarTira();
      await esperar(i ? 400 : 150);
      if (t !== turno) return;
      await decirPie(t, e);
      if (t !== turno) return;
      // Le toca: foco en el lobo y a esperar a que diga su frase
      if (escena) { escena.foco(true); escena.lobo(animoFrase(e)); }
      mostrarLinea(e.frase, e.es, 'lobo', { oculta: true });
      botonesEnsayo('toca');
      cartel('🗣️', 'tu-turno');
      await new Promise((ok) => { siguienteEnsayo = ok; });
      siguienteEnsayo = null;
      botonesEnsayo(null);
      if (escena) escena.foco(false);
      if (t !== turno) return;
      cartel(null);
      mostrarLinea(e.frase, e.es, 'lobo');
      sfx('click');
      await accionSola(t, e);
      if (t !== turno) return;
    }
    // ¡La función!: telón, aplausos y estrellas
    n = guion().length;
    pintarTira();
    if (escena) await escena.telon(false);
    if (t !== turno) return;
    sfx('aplausos');
    if (app) { app.ganarEstrella(3); app.fiesta(); }
    cartel('⭐⭐⭐', 'estrellas');
    await hablarEs(frases().funcion);
    if (t !== turno) return;
    if (escena) { escena.preparar('l9'); escena.lobo('feliz'); escena.reverencia(); escena.confeti(80); }
    sfx('victoria');
    if (escena) await escena.telon(true);
    if (t !== turno) return;
    cartel(null);
    botonesEnsayo('fin');
  }
  // 💡 El apuntador: le dice la frase (y sigue esperando a que la diga él)
  async function apuntador() {
    const e = actual();
    if (!siguienteEnsayo) return;
    const t = turno;
    cartel(null); // mientras habla el apuntador, no le toca
    mostrarLinea(e.frase, e.es, 'lobo');
    await decir(t, { id: e.id, cual: 'frase', texto: e.frase, quien: 'lobo', alPalabra: marcar, alBoca: (b) => escena && escena.boca(b) });
    if (t !== turno) return;
    limpiarMarcas();
    if (siguienteEnsayo) cartel('🗣️', 'tu-turno'); // y ahora, él
  }

  // =====================================================
  // MODO 3: ¿QUÉ VIENE AHORA? (para el orden)
  // =====================================================
  let ronda = null; // { e, intentos, hecha }
  let preguntado = false;
  async function rondaAdivina(i) {
    const t = nuevoTurno();
    n = ((i % guion().length) + guion().length) % guion().length;
    const e = actual();
    prepararEscena(e);
    ronda = { e, intentos: 0, hecha: false };
    pintarPuntos();
    pintarTarjetas(e, true);
    mostrarLinea(e.pie.texto, e.pie.es, 'cerdo');
    await esperar(350);
    if (t !== turno) return;
    await decirPie(t, e);
    if (t !== turno) return;
    limpiarMarcas();
    if (!preguntado) { preguntado = true; await hablarEs(frases().queDice); }
    if (t !== turno) return;
    pintarTarjetas(e, false);
  }
  // La frase de cada tipo que se oye en su 🔊: la de la escena más cercana de ese tipo (la buena, la de esta)
  function escenaDeTipo(tipo) {
    let mejor = null;
    guion().forEach((x, k) => { if (x.tipo === tipo && (!mejor || Math.abs(k - n) < Math.abs(mejor.k - n))) mejor = { x, k }; });
    return mejor && mejor.x;
  }
  function pintarTarjetas(e, apagadas) {
    const caja = $('#tt-tarjetas');
    if (!apagadas && caja.dataset.para === e.id && caja.children.length) {
      caja.querySelectorAll('.tt-tarjeta').forEach((b) => { b.disabled = false; });
      return;
    }
    caja.innerHTML = '';
    caja.dataset.para = e.id;
    const otras = Object.keys(TIPOS).filter((x) => x !== e.tipo).sort(() => Math.random() - 0.5).slice(0, 2);
    [e.tipo, ...otras].sort(() => Math.random() - 0.5).forEach((tipo) => {
      const b = document.createElement('button');
      b.className = 'tt-tarjeta';
      b.dataset.tipo = tipo;
      b.disabled = apagadas;
      b.setAttribute('aria-label', TIPOS[tipo].nombre);
      b.innerHTML = '<canvas aria-hidden="true"></canvas><span class="tt-tipo" aria-hidden="true"></span><span class="tt-oir" role="button" aria-label="Escuchar">🔊</span>';
      b.querySelector('.tt-tipo').textContent = TIPOS[tipo].emoji;
      if (window.TeatroEscena) window.TeatroEscena.tarjeta(b.firstChild, tipo);
      b.querySelector('.tt-oir').addEventListener('click', (ev) => { ev.stopPropagation(); oirTipo(tipo); });
      b.addEventListener('click', () => elegirTarjeta(b, tipo));
      caja.appendChild(b);
    });
  }
  async function oirTipo(tipo) {
    const x = escenaDeTipo(tipo);
    if (!x || !ronda || ronda.hecha) return;
    const t = nuevoTurno();
    pintarTarjetas(ronda.e, false);
    mostrarLinea(x.frase, x.es, 'lobo');
    await decir(t, { id: x.id, cual: 'frase', texto: x.frase, quien: 'lobo', alPalabra: marcar, alBoca: (b) => escena && escena.boca(b) });
    if (t === turno) limpiarMarcas();
  }
  async function elegirTarjeta(b, tipo) {
    if (!ronda || ronda.hecha) return;
    const e = ronda.e;
    if (tipo !== e.tipo) {
      ronda.intentos++;
      b.classList.remove('mal'); void b.offsetWidth; b.classList.add('mal');
      if (app) { app.pip(220); hablarEs(app.animo()); }
      pintarTarjetas(e, false);
      return;
    }
    ronda.hecha = true;
    const t = nuevoTurno();
    b.classList.add('bien');
    document.querySelectorAll('.tt-tarjeta').forEach((x) => { if (x !== b) x.classList.add('apagada'); });
    // ⭐ solo si acierta a la primera (tocar al azar no da estrellas)
    if (!ronda.intentos && app) { app.ganarEstrella(1); app.fiesta(); }
    if (app) app.pip(880);
    await decirLobo(t, e, 'frase');
    if (t !== turno) return;
    limpiarMarcas();
    await accionSola(t, e);
    if (t !== turno) return;
    // La última (las 9 acertadas): la fila de puntos entera, aplausos y fiesta, y se vuelve a empezar
    const ultima = n === guion().length - 1;
    if (ultima) {
      [...$('#tt-puntos').children].forEach((x) => { x.className = 'hecho'; });
      sfx('aplausos');
      if (app) app.fiesta();
      cartel('🎉', 'estrellas');
    }
    await hablarEs(app ? (ultima ? frases().funcion : app.bravo()) : '');
    if (t !== turno) return;
    await esperar(ultima ? 1000 : 400);
    if (t === turno) rondaAdivina(ultima ? 0 : n + 1);
  }
  function pintarPuntos() {
    const caja = $('#tt-puntos');
    if (!caja.children.length) guion().forEach(() => caja.appendChild(document.createElement('span')));
    [...caja.children].forEach((s, i) => { s.className = i < n ? 'hecho' : i === n ? 'ahora' : ''; });
  }

  // =====================================================
  // CAMBIAR DE MODO O DE ACENTO; ENTRAR Y SALIR
  // =====================================================
  function ponerModo(m) {
    if (!MODOS.includes(m)) m = 'escuchar';
    modo = m;
    guardar('teatro-modo', m);
    nuevoTurno();
    if (escena) { escena.foco(false); escena.telon(true); }
    cartel(null);
    mostrarSoplar(false);
    pintarCabecera();
    if (m === 'escuchar') {
      const id = dato('teatro-escena', 'l1');
      const i = guion().findIndex((x) => x.id === id);
      verEscena(i < 0 ? 0 : i, { callado: false });
    } else if (m === 'ensayo') abrirEnsayo();
    else rondaAdivina(0);
    pintarTira();
  }
  let enPausa = false;
  function reanudar() {
    if (escena) { escena.foco(false); escena.soplo(0, 0); }
    if (modo === 'escuchar') verEscena(n, { callado: true });
    else if (modo === 'ensayo') abrirEnsayo();
    else rondaAdivina(ronda && ronda.hecha ? n + 1 : n);
  }
  function ponerAcento(a) {
    if (!ACENTOS.includes(a) || a === acento) return;
    acento = a;
    guardar('teatro-acento', a);
    pintarCabecera();
    sfx('click');
    // Para que se oiga la diferencia: la escena otra vez con el acento nuevo
    if (modo === 'escuchar') { const t = nuevoTurno(); mostrarSoplar(false); escucharEscena(t); }
  }

  let conectado = false;
  function conectar() {
    if (conectado) return;
    conectado = true;
    document.querySelectorAll('[data-tt-modo]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.ttModo !== modo) ponerModo(b.dataset.ttModo); }));
    document.querySelectorAll('[data-acento]').forEach((b) => b.addEventListener('click', () => ponerAcento(b.dataset.acento)));
    $('#tt-ant').addEventListener('click', () => verEscena(n - 1));
    $('#tt-sig').addEventListener('click', () => { $('#tt-sig').classList.remove('latir'); verEscena(n + 1); });
    $('#tt-oir').addEventListener('click', () => { const t = nuevoTurno(); mostrarSoplar(false); escucharEscena(t); });
    $('#tt-despacio').addEventListener('click', () => despacio());
    $('#tt-grabar').addEventListener('click', () => ahoraTu());
    $('#tt-tuyo').addEventListener('click', () => { const t = nuevoTurno(); compararGrabacion(t, actual()).then(() => { if (t === turno) limpiarMarcas(); }); });
    $('#tt-soplar').addEventListener('click', () => soplar());
    $('#tt-empezar').addEventListener('click', () => empezarEnsayo());
    $('#tt-otra').addEventListener('click', () => empezarEnsayo());
    $('#tt-dicho').addEventListener('click', () => { if (siguienteEnsayo) { callar(); siguienteEnsayo(); } });
    $('#tt-apuntador').addEventListener('click', () => apuntador());
    $('#tt-repetir').addEventListener('click', () => { if (ronda && !ronda.hecha) { const t = nuevoTurno(); decirPie(t, ronda.e).then(() => { if (t === turno) { limpiarMarcas(); pintarTarjetas(ronda.e, false); } }); } });
    // En el primer toque dentro del teatro, el audio (iOS)
    $('#v-teatro').addEventListener('pointerdown', () => { desbloquear(); asegurarCtx(); }, { passive: true });
    window.addEventListener('resize', () => { if (abierto && escena) escena.medir(); });
    // Si la app pasa a segundo plano: se calla y se apaga el micro. Al volver, el modo sigue donde estaba (lo que
    // se cortó, con su botón para seguir)
    document.addEventListener('visibilitychange', () => {
      if (!abierto) return;
      if (document.visibilityState === 'hidden') { nuevoTurno(); cartel(null); soplando = null; enPausa = true; }
      else if (enPausa) { enPausa = false; reanudar(); }
    });
  }

  function abrir(a) {
    app = a || null;
    if (!guion().length || !$('#v-teatro')) return false;
    conectar();
    abierto = true;
    desbloquear(); // estamos en el toque de la tarjeta del menú
    asegurarCtx();
    if (window.Sfx) window.Sfx.activar();
    acento = ACENTOS.includes(dato('teatro-acento', 'gb')) ? dato('teatro-acento', 'gb') : 'gb';
    microNo = false;
    microPedido = false;
    enPausa = false;
    dichoEscucha = false;
    preguntado = false;
    tipoSesion('playback');
    if (app && app.avatar) app.avatar($('#tt-tuyo .tt-avatar'));
    if (window.TeatroEscena && !escena) escena = window.TeatroEscena.crear($('#tt-lienzo'));
    else if (escena) { escena.detener(); escena = window.TeatroEscena.crear($('#tt-lienzo')); }
    requestAnimationFrame(() => { if (escena) escena.medir(); });
    ponerModo(dato('teatro-modo', 'escuchar'));
    return true;
  }
  function cerrar() {
    if (!abierto) return;
    abierto = false;
    nuevoTurno();
    soplando = null;
    if (pararGrabacion) pararGrabacion();
    borrarGrabaciones();
    if (escena) { escena.detener(); escena = null; }
    try { reproductor.removeAttribute('src'); reproductor.load(); } catch { /* nada */ }
    try { if (ctxAudio) ctxAudio.close().catch(() => {}); } catch { /* nada */ }
    ctxAudio = null; // el del medidor: al volver, otro nuevo (en el toque)
    desbloqueado = false; // al volver a entrar (en un toque) se desbloquea otra vez
    cartel(null);
    tipoSesion('auto');
  }
  function repintar() {
    if (!abierto) return;
    const a = dato('teatro-acento', acento);
    if (ACENTOS.includes(a)) acento = a;
    pintarCabecera();
    pintarTira();
  }

  window.Teatro = {
    abrir, cerrar, repintar,
    __prueba: {
      estado: () => ({ modo, n, acento, turno, microNo, grabaciones: grabaciones.size, soplando: !!soplando,
        micro: !!micro, escena: escena ? escena.estado() : null, hoy: frasesDeHoy(), soplo: ultimoSoplo }),
      escena: () => escena,
      sonando: () => !!parar || !!pararGrabacion || !!soplando,
      verEscena: (i) => verEscena(i, { callado: true }),
      trozos, tiemposDe, palabrasDe,
    },
  };
})();
