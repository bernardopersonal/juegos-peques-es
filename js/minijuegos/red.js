/* Cliente de red del 1 contra 1 de la Batalla de bloques (docs/DUELO.md, sección D).
 *
 * Habla con api/sala.php (relativo a la página) con fetch. Sin dependencias.
 *
 * window.Red = {
 *   ANIMALES               los 12 dibujos del código de sala (el código son 4 índices de 0 a 11)
 *   disponible()           → Promise<bool>  ¿hay servidor con PHP? (ping). El sí se recuerda;
 *                            el no se vuelve a probar pasados 15 s (o con disponible(true)).
 *   crear(heroe)           → Promise<sesion {sala, token, codigo, yo:0, heroe}>
 *   unirse(codigo)         → Promise<sesion {sala, token, codigo, yo:1, heroe, heroeRival}>
 *                            Si falla, rechaza con un Error con .codigo:
 *                              'no-existe'  no hay partida con ese código (o ya caducó)
 *                              'llena'      esa partida ya ha empezado
 *                              'limite'     demasiados intentos: esperar un poco (.espera, en s)
 *                              'red'        sin conexión, o el servidor no contesta
 *                            (crear solo rechaza con 'limite' o 'red')
 *   conectar(sesion, {alMensaje(m), alRival(r), alCerrada(), alError(e)})
 *     → { enviar(tipo, datos) → Promise<n>, ritmo('rapido'|'lento'), salir() → Promise<bool>,
 *         cerrar(), estado() }
 * }
 *
 * conectar:
 * - Sondeo con 'leer': cada ~1 s en ritmo 'rapido' (esperando al rival; es el de partida) y cada
 *   ~3 s en 'lento' (mi turno: solo latido). Al ocultarse la página se para y al volver se lee
 *   enseguida (los iPad congelan las pestañas). Si falla, reintenta con espera creciente.
 * - alMensaje({n, tipo, datos}): los mensajes del rival, en orden y nunca repetidos. Va
 *   apuntando en sesion.desde el último n recibido (otro conectar con la misma sesión sigue
 *   desde ahí). Una sola conexión por sesión: conectar otra vez cierra la anterior.
 * - alRival({unido, conectado, visto, sinRed}): solo cuando cambia unido, conectado o sinRed
 *   (y la primera vez). sinRed = true si llevamos un rato (12 s) sin poder hablar con el
 *   servidor: entonces conectado va a false porque no lo sabemos.
 * - alCerrada(): el rival ha salido (después de entregar sus últimos mensajes). Deja de sondear.
 * - alError(e): la sala ya no sirve (e.codigo 'no-existe', 'token', 'tope'...). Lo deja todo
 *   parado. Los cortes de red nunca llegan aquí: se reintenta siempre (y se avisa con sinRed).
 *   Sin alError, se avisa con alCerrada.
 * - enviar: en orden, uno detrás de otro, con reintentos y espera creciente mientras no
 *   haya respuesta. Cada envío lleva su cid: un reintento nunca duplica. Rechaza con .codigo
 *   'cerrada' (sala cerrada, o conexión cerrada), 'grande' (más de 32 KB), 'invalido' (tipo o
 *   datos), o el error que paró la sala.
 * - salir(): espera un poco a que salga lo pendiente y avisa al servidor (el rival ve cerrada).
 *   Si la página se está cerrando (pagehide) u oculta, lo hace con sendBeacon. Nunca rechaza.
 *   Al cerrarse la página de verdad (pagehide sin caché), las conexiones vivas salen solas.
 * - cerrar(): para aquí sin avisar al servidor. estado(): para pruebas y depuración.
 *
 * Privacidad: por la red solo viaja lo que se pasa a crear (el héroe) y a enviar (las jugadas).
 */
(function () {
  'use strict';

  const URL_SALA = 'api/sala.php';
  const ANIMALES = ['🐷', '🐮', '🐔', '🐶', '🐱', '🐰', '🐸', '🐵', '🦁', '🐻', '🐼', '🦊'];
  const HEROES = ['steve', 'alex'];
  const TIPOS = ['inicio', 'jugada', 'turno', 'otra', 'adios'];

  const RAPIDO = 1000;            // sondeo esperando al rival (ms)
  const LENTO = 3000;             // sondeo en mi turno (solo latido)
  const HUECO_MIN = 250;          // entre un leer y el siguiente, como poco
  const ESPERA_MAX = 8000;        // los reintentos esperan 1, 2, 4, 8, 8... s
  const SIN_RED = 12000;          // tanto tiempo sin poder leer → alRival({sinRed: true})
  const T_PING = 8000;            // tiempos máximos de cada petición
  const T_PEDIR = 10000;          // (crear, unirse, leer)
  const T_ENVIAR = 15000;
  const T_SALIR = 6000;
  const INTENTOS_ENTRAR = 3;      // crear y unirse: intentos si se corta la red
  const INTENTOS_SALIR = 3;
  const ESPERA_VACIAR = 3000;     // salir() espera como mucho esto a que salgan los envíos
  const REPETIR_PING = 15000;     // un ping fallido se vuelve a probar pasado esto
  const VIDA_CID_UNIRSE = 100000; // el servidor da el mismo token a un unirse repetido 120 s
  const MAX_CUERPO = 32768;       // lo que acepta el servidor por petición
  const ATASCO = 2000;            // al volver a la página, lo que lleve más en vuelo se repite
  const FRESCO = 300;             // un leer que salió hace menos de esto ya trae lo último
  const T_SALIR_MAX = 6000;       // salir() contesta como mucho en esto (y sigue por detrás)
  const BALIZAS_MAX = 48000;      // bytes de envíos pendientes que caben en las balizas

  const conexiones = new Set();   // conexiones vivas (para los eventos de la página)
  let cerrandoPagina = false;     // entre pagehide y pageshow

  // ---------------------------------------------------------------- utilidades
  function fallo(codigo, extra) {
    const e = new Error('Red: ' + codigo);
    e.codigo = codigo;
    if (extra) Object.keys(extra).forEach((k) => { if (extra[k] !== undefined) e[k] = extra[k]; });
    return e;
  }

  const esHex = (v, largo) => typeof v === 'string' && v.length === largo && /^[0-9a-f]+$/.test(v);
  const oculta = () => document.visibilityState === 'hidden';
  const paginaCerrando = () => cerrandoPagina || oculta();
  const cuerpo = (accion, campos) => JSON.stringify(Object.assign({ accion }, campos));
  const otroHeroe = (h) => (h === 'alex' ? 'steve' : 'alex');

  // Hex aleatorio de n bytes (cid de los envíos)
  function aleatorio(n) {
    const b = new Uint8Array(n);
    try {
      (window.crypto || window.msCrypto).getRandomValues(b);
    } catch (e) {
      for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    }
    let s = '';
    for (let i = 0; i < n; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }

  function sinAvisoSiNadieEspera(p) {
    p.catch(() => {});
    return p;
  }

  function bytes(texto) {
    try { return new Blob([texto]).size; } catch (e) { return texto.length * 3; }
  }

  // Código de sala: 4 enteros de 0 a 11 (acepta también '3'); null si no lo es
  function normalizarCodigo(c) {
    if (!Array.isArray(c) || c.length !== 4) return null;
    const r = c.map((x) => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x));
    return r.every((x) => Number.isInteger(x) && x >= 0 && x < ANIMALES.length) ? r : null;
  }

  // Espera creciente (con algo de azar, para que dos aparatos no se acompasen). Si el servidor
  // dice cuánto esperar (Retry-After), se le hace caso, hasta un minuto.
  function espera(fallos, e) {
    const base = Math.min(ESPERA_MAX, 1000 * Math.pow(2, Math.max(0, fallos - 1)));
    const ms = base * (0.8 + Math.random() * 0.4);
    const pide = e && e.espera ? Math.min(60, e.espera) * 1000 : 0;
    return Math.max(ms, pide);
  }

  // ¿Un error que no se arregla reintentando? Los de la propia sala (4xx con JSON del servidor).
  // Cortes, tiempos agotados, respuestas que no son JSON, 5xx, 408 y 429 se reintentan.
  function esDefinitivo(e) {
    return e.codigo !== 'red' && e.estado >= 400 && e.estado < 500 && e.estado !== 408 && e.estado !== 429;
  }

  // Corre hacer(señal) con un tiempo máximo. Si se acaba, aborta (si el navegador sabe) y
  // rechaza con 'red'. Con control, control.cancelar() hace lo mismo cuando se quiera.
  function conTiempo(ms, hacer, control) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    return new Promise((resolver, rechazar) => {
      let reloj = null;
      const cortar = (detalle) => {
        clearTimeout(reloj);
        try { if (ctrl) ctrl.abort(); } catch (e) { /* nada */ }
        rechazar(fallo('red', { detalle }));
      };
      reloj = setTimeout(() => cortar('tiempo'), ms);
      if (control) control.cancelar = () => cortar('cancelada');
      let p;
      try { p = hacer(ctrl ? ctrl.signal : undefined); } catch (e) { p = Promise.reject(e); }
      p.then((r) => { clearTimeout(reloj); resolver(r); }, (e) => { clearTimeout(reloj); rechazar(e); });
    });
  }

  // Una petición POST a la sala. Resuelve con el JSON; si no, rechaza con .codigo = el error
  // del servidor ('no-existe', 'llena'...) o 'red', y .estado (HTTP) y .espera (Retry-After, s).
  function peticion(accion, texto, ms, control) {
    if (typeof fetch !== 'function') return Promise.reject(fallo('red', { detalle: 'fetch' }));
    return conTiempo(ms, (senal) => fetch(URL_SALA + '?accion=' + accion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: texto,
      cache: 'no-store',
      credentials: 'same-origin',
      // El servidor exige un Origin de la propia web: así va aunque la página tuviera
      // <meta name="referrer" content="no-referrer"> (con eso un POST manda «Origin: null»)
      referrerPolicy: 'same-origin',
      signal: senal,
    }).then((res) => res.text().then((t) => {
      let r = null;
      try { r = JSON.parse(t); } catch (e) { r = null; }
      if (res.ok && r && typeof r === 'object') return r;
      // (una página de error del hosting o de un portal wifi no es JSON: es la red)
      const tras = parseInt(res.headers.get('Retry-After'), 10);
      throw fallo(r && typeof r.error === 'string' ? r.error : 'red', {
        estado: res.status,
        espera: tras > 0 ? tras : undefined,
        detalle: r ? r.campo : undefined,
      });
    })), control).catch((e) => {
      throw e && e.codigo ? e : fallo('red', { detalle: e && e.name }); // corte, aborto...
    });
  }

  // Para crear y unirse: reintenta solo los cortes de red (y los 5xx), unas pocas veces
  function conReintentos(hacer, intentos) {
    let n = 0;
    const probar = () => hacer().catch((e) => {
      n++;
      const deRed = e.codigo === 'red' || (e.estado >= 500 && e.estado !== 503);
      if (!deRed || n >= intentos) throw e;
      return new Promise((r) => setTimeout(r, 600 * Math.pow(2, n - 1))).then(probar);
    });
    return probar();
  }

  // Lo que ve la app al fallar crear o unirse: 'no-existe', 'llena', 'limite', 'puerta' (la cookie de la
  // contraseña de la web ya no vale: hay que volver a escribirla) o 'red'
  function simplificar(e, alUnirse) {
    let c = 'red';
    if (e.estado === 429 || e.estado === 503) c = 'limite';
    else if (e.estado === 401 && e.codigo === 'puerta') c = 'puerta';
    else if (alUnirse && (e.codigo === 'no-existe' || e.codigo === 'llena')) c = e.codigo;
    return fallo(c, { estado: e.estado, espera: e.espera || (c === 'limite' ? 60 : undefined), detalle: e.codigo });
  }

  // sendBeacon (lo único que sale seguro con la página cerrándose). Va como text/plain, que el
  // servidor acepta. Si no se puede, fetch con keepalive.
  function baliza(accion, texto) {
    const url = URL_SALA + '?accion=' + accion;
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, texto)) return true;
    } catch (e) { /* sigue */ }
    try {
      fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: texto,
        keepalive: true, cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'same-origin',
      }).catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- ping
  let ping = null; // {t, ok (null mientras se pregunta), promesa}

  function disponible(forzar) {
    if (ping && !forzar && (ping.ok !== false || Date.now() - ping.t < REPETIR_PING)) return ping.promesa;
    const p = { t: Date.now(), ok: null, promesa: null };
    ping = p;
    // (sin PHP, por ejemplo en GitHub Pages o en la vista previa, sala.php llega como texto o
    // no llega: solo vale un {ok:true} de verdad)
    p.promesa = (typeof fetch !== 'function' || location.protocol === 'file:'
      ? Promise.resolve(false)
      : conTiempo(T_PING, (senal) => fetch(URL_SALA + '?accion=ping', { cache: 'no-store', credentials: 'same-origin', signal: senal })
        .then((res) => (res.ok ? res.json() : null))
        .then((r) => !!(r && r.ok === true))).catch(() => false)
    ).then((ok) => {
      p.ok = ok;
      p.t = Date.now();
      return ok;
    });
    return p.promesa;
  }

  // ---------------------------------------------------------------- crear y unirse
  let creando = null;          // {heroe, promesa} mientras se crea (dos toques = una sala)
  const uniendo = {};          // 'a-b-c-d' → promesa mientras se intenta entrar
  const cidUnirse = {};        // 'a-b-c-d' → {cid, t}

  function crear(heroe) {
    if (HEROES.indexOf(heroe) < 0) return Promise.reject(fallo('invalido', { detalle: 'heroe' }));
    if (creando && creando.heroe === heroe) return creando.promesa;
    const texto = cuerpo('crear', { heroe });
    const promesa = conReintentos(() => peticion('crear', texto, T_PEDIR), INTENTOS_ENTRAR).then((r) => {
      if (!esHex(r.sala, 16) || !esHex(r.token, 32) || !normalizarCodigo(r.codigo)) throw fallo('red', { detalle: 'respuesta' });
      return { sala: r.sala, token: r.token, codigo: normalizarCodigo(r.codigo), yo: 0, heroe };
    }).catch((e) => { throw simplificar(e, false); });
    const yo = { heroe, promesa };
    creando = yo;
    const soltar = () => { if (creando === yo) creando = null; };
    promesa.then(soltar, soltar);
    return promesa;
  }

  // Cada código lleva su cid (el mismo durante 100 s): si se pierde la respuesta y se reintenta,
  // o el niño vuelve a poner los animales, el servidor devuelve la misma plaza en vez de «llena».
  function unirse(codigo) {
    const c = normalizarCodigo(codigo);
    if (!c) return Promise.reject(fallo('no-existe', { detalle: 'codigo' }));
    const clave = c.join('-');
    if (uniendo[clave]) return uniendo[clave];
    let g = cidUnirse[clave];
    if (!g || Date.now() - g.t > VIDA_CID_UNIRSE) g = cidUnirse[clave] = { cid: 'u' + aleatorio(12), t: Date.now() };
    const texto = cuerpo('unirse', { codigo: c, cid: g.cid });
    const promesa = conReintentos(() => peticion('unirse', texto, T_PEDIR), INTENTOS_ENTRAR).then((r) => {
      if (!esHex(r.sala, 16) || !esHex(r.token, 32) || HEROES.indexOf(r.heroeRival) < 0) throw fallo('red', { detalle: 'respuesta' });
      delete cidUnirse[clave]; // ya dentro: otro unirse con este código es otra persona
      return { sala: r.sala, token: r.token, codigo: c, yo: 1, heroe: otroHeroe(r.heroeRival), heroeRival: r.heroeRival };
    }).catch((e) => { throw simplificar(e, true); });
    uniendo[clave] = promesa;
    const soltar = () => { if (uniendo[clave] === promesa) delete uniendo[clave]; };
    promesa.then(soltar, soltar);
    return promesa;
  }

  // ---------------------------------------------------------------- conectar
  function conectar(sesion, manejadores) {
    const man = manejadores || {};
    const valida = !!sesion && esHex(sesion.sala, 16) && esHex(sesion.token, 32);
    const sala = valida ? sesion.sala : '';
    const token = valida ? sesion.token : '';

    // Una sola conexión por sesión
    if (valida) Array.from(conexiones).forEach((c) => { if (c.sala === sala && c.token === token) c.cerrar(); });

    let desde = valida && Number.isInteger(sesion.desde) && sesion.desde > 0 ? sesion.desde : 0;
    let parado = false;          // nada más: ni sondeo, ni envíos, ni avisos
    let callado = false;         // ya no se avisa a la app (al salir)
    let sinSondeo = false;       // sala cerrada o saliendo: ya no se lee
    let cerrada = false;         // ya se avisó con alCerrada
    let perdida = false;         // la sala ya no existe o no es nuestra: salir no hace falta
    let ritmoActual = 'rapido';

    // sondeo
    let reloj = null;
    let relojHasta = 0;          // cuándo toca el próximo leer
    let leyendo = null;          // el leer en vuelo: {inicio, cancelar}
    let leerOtraVez = false;     // al acabar el leer en vuelo, otro enseguida
    let fallosLeer = 0;
    let ultimoBien = Date.now(); // último leer bueno (o vuelta a la página): para sinRed
    let rivalAntes = null;       // lo último avisado con alRival
    let lecturas = 0;            // (para estado())

    // envíos
    const cola = [];             // {tipo, cid, texto, resolver, rechazar}
    let enviando = null;         // el envío en vuelo: {inicio, cancelar}
    let relojEnvio = null;
    let fallosEnvio = 0;
    let alVaciar = [];           // quien espera a que la cola quede vacía (salir)

    let interna = null;          // lo que ven los eventos de la página (abajo)

    // salir
    let saliendo = null;         // promesa de salir()
    let salirConfirmado = false; // el servidor ya contestó al salir
    let balizaHecha = false;

    function avisar(nombre, arg) {
      if (callado || parado) return;
      const fn = man[nombre];
      if (typeof fn !== 'function') return;
      try { fn(arg); } catch (e) { console.error('Red.' + nombre, e); }
    }

    // --- sondeo

    function programar(ms) {
      clearTimeout(reloj);
      reloj = null;
      if (parado || sinSondeo || oculta()) return;
      relojHasta = Date.now() + Math.max(0, ms);
      reloj = setTimeout(leer, Math.max(0, ms));
    }

    function leer() {
      clearTimeout(reloj);
      reloj = null;
      if (parado || sinSondeo || oculta()) return;
      if (leyendo) { leerOtraVez = true; return; }
      const yo = { inicio: Date.now(), cancelar: null };
      leyendo = yo;
      leerOtraVez = false;
      lecturas++;
      peticion('leer', cuerpo('leer', { sala, token, desde }), T_PEDIR, yo).then((r) => {
        if (!Array.isArray(r.mensajes) || !r.rival || typeof r.rival !== 'object') throw fallo('red', { detalle: 'respuesta' });
        return r;
      }).then((r) => {
        if (leyendo !== yo) return; // (cancelado: ya hay otro)
        leyendo = null;
        if (!parado) leido(r, yo.inicio);
      }, (e) => {
        if (leyendo !== yo) return;
        leyendo = null;
        if (!parado) falloLeer(e);
      });
    }

    function leido(r, inicio) {
      fallosLeer = 0;
      ultimoBien = Date.now();
      // 1) Los mensajes del rival, en orden y sin repetir
      const lista = r.mensajes.filter((m) => m && Number.isInteger(m.n) && m.n > desde).sort((a, b) => a.n - b.n);
      for (let i = 0; i < lista.length; i++) {
        const m = lista[i];
        if (parado || callado) return;
        if (m.n <= desde) continue;
        desde = m.n;
        try { sesion.desde = desde; } catch (e) { /* sesión congelada: da igual */ }
        avisar('alMensaje', { n: m.n, tipo: m.tipo, datos: m.datos === undefined ? null : m.datos });
      }
      if (parado || callado || sinSondeo) return;
      // 2) Sala cerrada: el rival se ha ido (sus últimos mensajes ya se han entregado)
      if (r.cerrada === true) {
        sinSondeo = true;
        cerrada = true;
        avisar('alCerrada');
        return;
      }
      // 3) Cómo está el rival
      const v = r.rival;
      avisarRival({ unido: v.unido === true, conectado: v.conectado === true, visto: typeof v.visto === 'number' ? v.visto : null, sinRed: false });
      if (parado || sinSondeo) return;
      if (leerOtraVez) { leer(); return; }
      const intervalo = ritmoActual === 'lento' ? LENTO : RAPIDO;
      // (cuenta desde que salió la petición; acotado por si el reloj del aparato salta)
      programar(Math.min(intervalo, Math.max(HUECO_MIN, intervalo - (Date.now() - inicio))));
    }

    function falloLeer(e) {
      if (esDefinitivo(e)) { terminar(e); return; }
      fallosLeer++;
      // Mucho rato sin poder hablar con el servidor: no sabemos nada del rival
      if (Date.now() - ultimoBien >= SIN_RED) {
        const a = rivalAntes;
        avisarRival({ unido: a ? a.unido : false, conectado: false, visto: a ? a.visto : null, sinRed: true });
        if (parado) return;
      }
      if (leerOtraVez) { leerOtraVez = false; fallosLeer = 0; leer(); return; }
      programar(espera(fallosLeer, e));
    }

    function avisarRival(r) {
      const a = rivalAntes;
      rivalAntes = r;
      if (a && a.unido === r.unido && a.conectado === r.conectado && a.sinRed === r.sinRed) return;
      avisar('alRival', { unido: r.unido, conectado: r.conectado, visto: r.visto, sinRed: r.sinRed });
    }

    // --- envíos

    // (La promesa ya lleva un catch vacío: si la app envía sin esperar la respuesta, un rechazo
    // al salir no ensucia la consola. Quien la espera recibe el rechazo igual.)
    function enviar(tipo, datos) {
      return sinAvisoSiNadieEspera(encolar(tipo, datos));
    }

    function encolar(tipo, datos) {
      if (parado || saliendo || !valida) return Promise.reject(fallo('cerrada'));
      if (TIPOS.indexOf(tipo) < 0) return Promise.reject(fallo('invalido', { detalle: 'tipo' }));
      const cid = 'm' + aleatorio(8);
      let texto;
      try {
        texto = cuerpo('enviar', { sala, token, tipo, datos: datos === undefined ? null : datos, cid });
      } catch (e) {
        return Promise.reject(fallo('invalido', { detalle: 'datos' })); // (por ejemplo, un ciclo)
      }
      if (bytes(texto) > MAX_CUERPO) return Promise.reject(fallo('grande'));
      return new Promise((resolver, rechazar) => {
        cola.push({ tipo, cid, texto, resolver, rechazar });
        bombear();
      });
    }

    function bombear() {
      if (parado || enviando || relojEnvio || !cola.length) {
        if (!cola.length) vaciada();
        return;
      }
      const it = cola[0];
      const yo = { inicio: Date.now(), cancelar: null };
      enviando = yo;
      peticion('enviar', it.texto, T_ENVIAR, yo).then((r) => {
        if (!Number.isInteger(r.n) || r.n < 1) throw fallo('red', { detalle: 'respuesta' });
        return r;
      }).then((r) => {
        if (enviando !== yo) return; // (cancelado: el reintento lleva el mismo cid)
        enviando = null;
        if (parado) return;
        if (cola[0] === it) cola.shift();
        fallosEnvio = 0;
        it.resolver(r.n);
        bombear();
      }, (e) => {
        if (enviando !== yo) return;
        enviando = null;
        if (parado) return;
        if (!esDefinitivo(e)) {
          // Corte o servidor ocupado: el mismo envío (mismo cid) otra vez, más tarde
          fallosEnvio++;
          relojEnvio = setTimeout(() => { relojEnvio = null; bombear(); }, espera(fallosEnvio, e));
          return;
        }
        if (e.codigo === 'invalido' || e.codigo === 'grande' || e.codigo === 'json') {
          // Solo este mensaje está mal: fuera, y sigue la cola
          if (cola[0] === it) cola.shift();
          it.rechazar(e);
          bombear();
        } else if (e.codigo === 'cerrada') {
          // El rival ha salido: nada más va a entrar. Se lee ya para entregar lo último y
          // avisar con alCerrada.
          rechazarCola(e);
          leerYa();
        } else {
          terminar(e); // no-existe, token, tope...: la sala ya no sirve
        }
      });
    }

    function rechazarCola(e) {
      const lista = cola.splice(0, cola.length);
      lista.forEach((it) => it.rechazar(e));
      vaciada();
    }

    function vaciada() {
      const l = alVaciar;
      alVaciar = [];
      l.forEach((f) => f());
    }

    // Promesa que se cumple cuando no queda nada por enviar (o pasado ms)
    function esperarCola(ms) {
      if (!cola.length || parado) return Promise.resolve();
      return new Promise((r) => {
        alVaciar.push(r);
        setTimeout(r, ms);
      });
    }

    // --- salir y cerrar

    // Para del todo. Lo que quedase por enviar se rechaza con e.
    function parar(e) {
      if (parado) return;
      rechazarCola(e || fallo('cerrada'));
      parado = true;
      sinSondeo = true;
      clearTimeout(reloj);
      clearTimeout(relojEnvio);
      reloj = null;
      relojEnvio = null;
      conexiones.delete(interna);
    }

    // La sala ya no sirve: se avisa a la app (una vez) y se para
    function terminar(e) {
      if (e.codigo === 'no-existe' || e.codigo === 'token') perdida = true;
      if (typeof man.alError === 'function') avisar('alError', e);
      else avisar('alCerrada');
      parar(e);
    }

    // Lo pendiente y el salir, con sendBeacon (la página se cierra: no hay tiempo de esperar).
    // Las balizas comparten un cupo (64 KB): lo pendiente solo hasta BALIZAS_MAX, para que el
    // salir, que es lo importante, siempre quepa.
    function despedidaConBaliza() {
      if (balizaHecha || salirConfirmado || perdida || !valida) return true;
      balizaHecha = true;
      let cupo = BALIZAS_MAX;
      cola.forEach((it) => {
        const b = bytes(it.texto);
        if (b > cupo) return;
        cupo -= b;
        baliza('enviar', it.texto);
      });
      const ok = baliza('salir', cuerpo('salir', { sala, token }));
      callado = true;
      parar(fallo('cerrada'));
      return ok;
    }

    function salirConReintentos() {
      const texto = cuerpo('salir', { sala, token });
      let n = 0;
      const probar = () => peticion('salir', texto, T_SALIR).then(() => true, (e) => {
        if (e.codigo === 'no-existe') return true; // ya no estaba: como si hubiera salido
        n++;
        if (esDefinitivo(e) || n >= INTENTOS_SALIR || balizaHecha) return false;
        return new Promise((r) => setTimeout(r, 500 * Math.pow(3, n - 1))).then(probar);
      });
      return probar();
    }

    function salir() {
      if (saliendo) return saliendo;
      if (!valida || perdida) {
        callado = true;
        parar(fallo('cerrada'));
        saliendo = Promise.resolve(true);
        return saliendo;
      }
      if (paginaCerrando()) {
        saliendo = Promise.resolve(despedidaConBaliza());
        return saliendo;
      }
      callado = true;
      sinSondeo = true;
      clearTimeout(reloj);
      reloj = null;
      // Primero lo que quede por enviar (por ejemplo un 'adios'), y luego salir. La app no
      // espera más de T_SALIR_MAX (el niño quiere irse): sin red, se sigue intentando por detrás.
      const trabajo = esperarCola(ESPERA_VACIAR).then(() => {
        if (balizaHecha) return true;
        return salirConReintentos();
      }).then((ok) => {
        salirConfirmado = ok;
        parar(fallo('cerrada'));
        return ok;
      });
      saliendo = Promise.race([trabajo, new Promise((r) => setTimeout(() => r(false), T_SALIR_MAX))]);
      return saliendo;
    }

    function cerrar() {
      callado = true;
      parar(fallo('cerrada'));
    }

    // --- eventos de la página (los reparte la parte de abajo a todas las conexiones)

    // Lee ya (y reintenta ya los envíos): vuelta a la página, red recuperada...
    function leerYa() {
      if (parado || sinSondeo || oculta()) return;
      if (!leyendo) leer();
      else if (Date.now() - leyendo.inicio > FRESCO) leerOtraVez = true; // (si acaba de salir, ya vale)
    }

    // Al volver a la página. Una petición que lleva un rato en vuelo seguramente se quedó
    // congelada con la pestaña (iPad): se abandona y se repite ya (un envío, con su mismo cid).
    function despertar() {
      if (parado) return;
      const ahora = Date.now();
      ultimoBien = Math.max(ultimoBien, ahora); // el rato oculta no cuenta para sinRed
      fallosLeer = 0;
      if (leyendo && ahora - leyendo.inicio > ATASCO) {
        const l = leyendo;
        leyendo = null;
        if (l.cancelar) l.cancelar();
      }
      leerYa();
      if (enviando && ahora - enviando.inicio > ATASCO) {
        const en = enviando;
        enviando = null;
        if (en.cancelar) en.cancelar();
      }
      if (relojEnvio) {
        clearTimeout(relojEnvio);
        relojEnvio = null;
      }
      fallosEnvio = 0;
      bombear();
    }

    function dormir() {
      clearTimeout(reloj);
      reloj = null;
    }

    interna = {
      sala, token, despertar, dormir,
      cerrarPagina: despedidaConBaliza,
      cerrar,
    };

    const con = {
      enviar,
      ritmo(r) {
        if (r !== 'rapido' && r !== 'lento') return;
        const antes = ritmoActual;
        ritmoActual = r;
        // Al pasar a rápido, si el próximo leer estaba lejos, se acerca
        if (r === 'rapido' && antes === 'lento' && reloj && !fallosLeer && relojHasta - Date.now() > RAPIDO) programar(RAPIDO);
      },
      salir,
      cerrar,
      estado() {
        return {
          sala, desde, ritmo: ritmoActual, parado, cerrada, saliendo: !!saliendo,
          pendientes: cola.length, lecturas, fallosLeer, fallosEnvio, rival: rivalAntes ? Object.assign({}, rivalAntes) : null,
        };
      },
    };

    if (!valida) {
      parado = true;
      setTimeout(() => {
        const e = fallo('invalido', { detalle: 'sesion' });
        if (typeof man.alError === 'function') {
          try { man.alError(e); } catch (x) { console.error('Red.alError', x); }
        }
      }, 0);
      return con;
    }

    conexiones.add(interna);
    leer(); // (si la página está oculta, empieza al volver)
    return con;
  }

  // ---------------------------------------------------------------- eventos de la página
  const todas = (fn) => Array.from(conexiones).forEach((c) => { try { fn(c); } catch (e) { console.error('Red', e); } });

  document.addEventListener('visibilitychange', () => todas((c) => (oculta() ? c.dormir() : c.despertar())));
  window.addEventListener('pageshow', () => {
    cerrandoPagina = false;
    if (!oculta()) todas((c) => c.despertar());
  });
  window.addEventListener('pagehide', (ev) => {
    cerrandoPagina = true;
    // persisted: la página se queda en la caché del navegador y puede volver tal cual (pageshow).
    // Si no, se va de verdad: se avisa al servidor para que el rival no se quede esperando.
    if (ev.persisted) todas((c) => c.dormir());
    else todas((c) => c.cerrarPagina());
  });
  window.addEventListener('online', () => { if (!oculta()) todas((c) => c.despertar()); });
  // Chrome congela y descongela pestañas sin ocultarlas (Page Lifecycle)
  document.addEventListener('freeze', () => todas((c) => c.dormir()));
  document.addEventListener('resume', () => { if (!oculta()) todas((c) => c.despertar()); });

  window.Red = { ANIMALES, disponible, crear, unirse, conectar };
})();
