/* Escenario del teatro en inglés (The Three Little Pigs): pixel-art hecho con código.
 *
 * Todo se pinta en un lienzo pequeño (ALTO = 128 píxeles de arte de alto; el ancho sale de la pantalla) y
 * se amplía sin suavizado: los personajes (js/minijuegos/sprites.js), las partículas y el telón tienen así
 * los mismos píxeles gordos. Lo que se oye y cuándo pasa cada cosa lo decide js/teatro.js.
 *
 * window.TeatroEscena = {
 *   crear(canvas) → escena:
 *     preparar(id)          la escena l1..l9 como empieza: su casa, los cerditos que hay y dónde está el lobo
 *     lobo(estado)          'quieto' | 'llamar' | 'mofletes' | 'soplar' | 'agotado' | 'triste' | 'feliz'
 *     boca(n)               lo abierta que tiene el lobo la boca al hablar: 0, 1 o 2 (js/teatro.js, palabra a palabra)
 *     hablan(quien, n, {reir})  qué cerditos hablan ('pig1' | 'pigs' | null) y su boca (0-1); reir: ¡ja, ja!
 *     soplo(fuerza, carga)  el viento que sale del lobo (0-1) y lo que lleva la casa aguantado (0-1: se tambalea)
 *     derribar() → Promise  la casa de paja o de palos sale volando y los cerditos se van corriendo
 *     aguantar() → Promise  la de ladrillos tiembla y no se cae
 *     tocToc() → Promise    el lobo llama a la puerta (dos golpes)
 *     corazones(n), confeti(n), estrellas(n)
 *     telon(abierto) → Promise   cierra o abre el telón
 *     foco(si)              en el ensayo, un foco en el lobo: le toca a él
 *     reverencia()          al final de la función: todos contentos, saludando
 *     medir()               después de cambiar el tamaño del canvas
 *     detener()             para la animación (al salir del juego)
 *     estado()              para las pruebas: lo que hay en escena
 *   miniatura(canvas, id)   la escena id en pequeño, quieta (la tira de las 9 escenas)
 *   tarjeta(canvas, tipo)   el lobo haciendo eso, con su objeto: 'entrar' (puerta), 'soplar' (viento y paja),
 *                           'cansado' (pared de ladrillo), 'triste' (lágrima), 'amable' (corazones)
 * }
 * Sin window.Sprites (o con un navegador sin canvas) no pinta nada y las promesas se cumplen igual.
 */
(function () {
  'use strict';

  const ALTO = 128;          // alto del escenario en píxeles de arte
  const SUELO = 117;         // los pies de los personajes (sobre las tablas)
  const BASE_CASA = 111;     // la última fila de las casas (al fondo, sobre la hierba)
  const PRADO = 94;          // donde empieza la hierba del decorado
  const TABLAS = 109;        // donde empiezan las tablas del escenario
  const BORDE = 124;         // el borde de delante, con las candilejas
  const TELON = 12;          // ancho de cada lado del telón abierto
  const CARA = { normal: 0, triste: 1, feliz: 2, agotado: 3, mofletes: 4, soplar: 5, parpadeo: 6 };
  const POSE = { recto: 0, llamar: 1, cansado: 2, contento: 3, soplar: 4 };
  const POSE_CERDITO = { quieto: 0, hablar: 1, asustado: 2, reir: 3, correr1: 4, correr2: 5, parpadeo: 6 };
  const TAM_CASA = { paja: [50, 46], palos: [50, 48], ladrillos: [56, 52] };
  const COLORES_CONFETI = ['#ff5a6e', '#ffd23f', '#4fc3f7', '#7ed957', '#c77dff', '#ff9f43'];

  const S = () => window.Sprites;
  const sprite = (g, nombre, x, y, op) => { const s = S(); if (s) s.dibujar(g, nombre, Math.round(x), Math.round(y), 1, op); };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const guion = () => (window.TEATRO && window.TEATRO.escenas) || [];
  const escenaDe = (id) => guion().find((e) => e.id === id) || { id, casa: null, tipo: 'amable', pie: { quien: 'pigs' } };
  // Cuántos cerditos hay: en la casa de paja vive el primero; luego se van juntando
  const cerditosDe = (id) => (id === 'l1' || id === 'l2' ? [1] : id === 'l3' || id === 'l4' ? [1, 2] : [1, 2, 3]);

  // Números al azar con semilla (las miniaturas salen siempre iguales)
  function azar(semilla) {
    let s = semilla >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- el decorado (se pinta una vez por tamaño)
  function pintarDecorado(W, sencillo) {
    const c = document.createElement('canvas');
    c.width = W; c.height = ALTO;
    const g = c.getContext('2d');
    const img = g.createImageData(W, ALTO), d = img.data;
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const pon = (x, y, col) => { if (x < 0 || y < 0 || x >= W || y >= ALTO) return; const k = (y * W + x) * 4, v = hex(col); d[k] = v[0]; d[k + 1] = v[1]; d[k + 2] = v[2]; d[k + 3] = 255; };
    // Cielo: bandas con un tramado entre una y otra (como los cielos de las consolas de antes)
    const cielo = ['#62b6ef', '#78c3f3', '#8fcef6', '#a8daf8', '#c1e6fa', '#d6f0fc'];
    const tramado = [0, 2, 3, 1];
    for (let y = 0; y < PRADO; y++) {
      const f = (y / PRADO) * (cielo.length - 1), i = Math.floor(f), t = f - i;
      for (let x = 0; x < W; x++) {
        const umbral = (tramado[(x % 2) + (y % 2) * 2] + 0.5) / 4;
        pon(x, y, cielo[Math.min(cielo.length - 1, i + (t > umbral ? 1 : 0))]);
      }
    }
    // Colinas al fondo (dos capas), con algún árbol redondo
    const lejos = (x) => 74 + Math.round(5 * Math.sin(x / 21) + 3 * Math.sin(x / 8.5 + 1));
    const cerca = (x) => 85 + Math.round(4 * Math.sin(x / 29 + 2) + 2 * Math.sin(x / 11));
    for (let x = 0; x < W; x++) {
      for (let y = lejos(x); y < PRADO; y++) pon(x, y, y === lejos(x) ? '#b6e39a' : '#95d27c');
      for (let y = cerca(x); y < PRADO; y++) pon(x, y, y === cerca(x) ? '#8fd672' : '#6fbf5a');
    }
    const arbol = (cx, base) => {
      for (let y = base - 7; y <= base; y++) { pon(cx, y, '#7a4e27'); pon(cx + 1, y, '#5e3a1c'); }
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
        if (x * x + y * y * 1.25 > 52) continue;
        pon(cx + x, base - 14 + y, x + y < -6 ? '#7fd06a' : x + y > 6 ? '#3f8a3e' : '#56a84c');
      }
    };
    if (!sencillo) { arbol(Math.round(W * 0.13), cerca(Math.round(W * 0.13)) + 2); arbol(Math.round(W * 0.86), cerca(Math.round(W * 0.86)) + 2); }
    // Hierba del decorado, con matas y flores
    const r = azar(11);
    for (let y = PRADO; y < TABLAS; y++) for (let x = 0; x < W; x++) {
      const v = r();
      pon(x, y, y === PRADO ? '#8fd672' : v < 0.08 ? '#4f9a3f' : v < 0.16 ? '#7fcb62' : '#62b350');
    }
    for (let x = 3; x < W; x += 5 + Math.floor(r() * 7)) {
      const y = PRADO + 3 + Math.floor(r() * (TABLAS - PRADO - 5));
      const col = ['#ffffff', '#ffd23f', '#ff7aa8', '#c77dff'][Math.floor(r() * 4)];
      pon(x, y, col); pon(x - 1, y, col); pon(x + 1, y, col); pon(x, y - 1, col); pon(x, y, '#ffe27a');
    }
    // Las tablas del escenario: madera con juntas y el borde de delante con las candilejas
    for (let y = TABLAS; y < BORDE; y++) {
      const fila = Math.floor((y - TABLAS) / 4);
      for (let x = 0; x < W; x++) {
        const junta = (y - TABLAS) % 4 === 3 || (x + fila * 13) % 37 === 0;
        pon(x, y, y === TABLAS ? '#e3ad70' : junta ? '#9a6534' : (x * 7 + fila * 5) % 23 === 0 ? '#b87c45' : '#c98d52');
      }
    }
    for (let y = BORDE; y < ALTO; y++) for (let x = 0; x < W; x++) pon(x, y, y === BORDE ? '#3a2014' : '#5a3420');
    if (!sencillo) {
      for (let x = 14; x < W - 10; x += 22) {
        pon(x, BORDE + 1, '#fff4c2'); pon(x + 1, BORDE + 1, '#fff4c2'); pon(x, BORDE + 2, '#ffd23f'); pon(x + 1, BORDE + 2, '#ffd23f');
        pon(x - 1, BORDE, '#7a5a30'); pon(x + 2, BORDE, '#7a5a30');
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------- una escena
  function crear(cv, op) {
    op = op || {};
    const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    const buf = document.createElement('canvas');
    const g = buf.getContext('2d');
    let W = op.ancho || 200, decorado = null, raf = 0, ultimo = 0, vivo = !op.fijo;
    let t = 0;
    const st = {
      id: 'l1', casa: 'paja', casaEstado: 'pie', casaY: 0, casaVy: 0, montonDe: null,
      tejado: null, derrumbe: 0, temblorCasa: 0,
      lobo: { x: 60, objetivo: 60, estado: 'quieto', boca: 0, golpe: 0, salto: 0 },
      cerdos: [], hablan: null, bocaCerdos: 0, reir: false,
      soplo: 0, carga: 0, foco: 0, focoObjetivo: 0, telon: 1, telonObjetivo: 1, reverencia: false,
      particulas: [], tarjeta: null,
    };
    const xc = () => Math.round(W / 2) - 6; // centro de la casa
    const r = azar(7);
    let gen = 0; // sube en cada preparar(): lo que quedaba pendiente de la escena de antes ya no la toca

    function colocarCerdos(id) {
      const lista = cerditosDe(id), sinCasa = !escenaDe(id).casa;
      const x0 = sinCasa ? xc() + 2 : xc() + (lista.length === 1 ? 38 : lista.length === 2 ? 35 : 33);
      st.cerdos = lista.map((n, i) => ({ n, x: x0 + i * (sinCasa ? 19 : 17), y: 0, estado: 'quieto', dir: -1, huye: false, salto: r() * 6 }));
    }
    function sitioLobo(id) {
      const e = escenaDe(id);
      if (!e.casa) return xc() - 42;
      return xc() + ({ entrar: -30, soplar: -47, cansado: -44 }[e.tipo] || -40);
    }

    function preparar(id) {
      gen++;
      const e = escenaDe(id), antes = st.casa;
      st.id = id;
      st.casa = e.casa;
      st.casaEstado = 'pie';
      st.tejado = null; st.derrumbe = 0; st.temblorCasa = 0;
      // La casa nueva baja del techo del teatro, como un decorado (si cambia)
      if (e.casa && e.casa !== antes && vivo) { st.casaY = -70; st.casaVy = 0; } else st.casaY = 0;
      st.montonDe = null;
      colocarCerdos(id);
      st.lobo.objetivo = sitioLobo(id);
      if (!vivo) st.lobo.x = st.lobo.objetivo;
      st.lobo.estado = 'quieto'; st.lobo.boca = 0; st.lobo.golpe = 0;
      st.soplo = 0; st.carga = 0; st.hablan = null; st.reir = false; st.reverencia = false;
      st.particulas = st.particulas.filter((p) => p.tipo === 'confeti');
    }

    // ---------------------------------------------------------------- partículas
    function particula(p) { if (st.particulas.length < 400) st.particulas.push(Object.assign({ vida: 0, max: 1, vx: 0, vy: 0, g: 0 }, p)); }
    const bocaLobo = () => ({ x: st.lobo.x + 20, y: SUELO - 37 });
    const cabezaLobo = () => ({ x: st.lobo.x + 2, y: SUELO - 46 });
    function viento(n) {
      const b = bocaLobo();
      for (let i = 0; i < n; i++) {
        particula({ tipo: 'viento', x: b.x + r() * 4, y: b.y - 6 + r() * 14, vx: 110 + r() * 80, vy: (r() - 0.5) * 16,
          max: 0.5 + r() * 0.4, largo: 3 + Math.floor(r() * 6), col: r() < 0.5 ? '#ffffff' : '#d7efff' });
      }
    }
    function trozos(tipo, n, x, y, w, h) {
      for (let i = 0; i < n; i++) {
        particula({ tipo, x: x + r() * w, y: y + r() * h, vx: 40 + r() * 120, vy: -90 + r() * 70, g: tipo === 'palo' ? 150 : 90,
          max: 1.4 + r() * 0.8, giro: r() * 4, vgiro: 6 + r() * 8,
          col: tipo === 'palo' ? ['#9c6b3c', '#85582f', '#b5844d'][i % 3] : ['#f6d77e', '#e8bd4f', '#d6a63c'][i % 3] });
      }
    }
    function polvo(n, x, y, w) {
      for (let i = 0; i < n; i++) particula({ tipo: 'polvo', x: x + r() * w, y: y - r() * 6, vx: (r() - 0.3) * 30, vy: -8 - r() * 10, max: 0.9 + r() * 0.5 });
    }
    function corazones(n) {
      const c = cabezaLobo();
      for (let i = 0; i < (n || 5); i++) {
        particula({ tipo: 'corazon', x: c.x - 14 + r() * 40, y: c.y - 2 + r() * 10, vx: (r() - 0.5) * 8, vy: -14 - r() * 10,
          max: 1.8 + r() * 0.8, fase: r() * 6, retraso: i * 0.12 });
      }
    }
    function confeti(n) {
      for (let i = 0; i < (n || 60); i++) {
        particula({ tipo: 'confeti', x: TELON + r() * (W - TELON * 2), y: -4 - r() * 30, vx: (r() - 0.5) * 14, vy: 22 + r() * 22,
          max: 3.5 + r() * 1.5, fase: r() * 6, col: COLORES_CONFETI[i % COLORES_CONFETI.length] });
      }
    }
    function estrellas(n) {
      for (let i = 0; i < (n || 8); i++) {
        particula({ tipo: 'chispa', x: TELON + 10 + r() * (W - TELON * 2 - 20), y: 20 + r() * 60, max: 0.6 + r() * 0.5, retraso: r() * 0.6, col: '#fff3a6' });
      }
    }

    // ---------------------------------------------------------------- acciones
    function lobo(estado) {
      st.lobo.estado = estado;
      if (estado !== 'soplar' && estado !== 'mofletes') st.soplo = 0;
      if (estado === 'feliz') corazones(6);
    }
    function tocToc() {
      lobo('llamar');
      st.lobo.golpe = 0.001;
      return esperar(820).then(() => { if (st.lobo.estado === 'llamar') st.lobo.estado = 'quieto'; });
    }
    function derribar() {
      if (!st.casa || st.casa === 'ladrillos' || st.casaEstado !== 'pie') return esperar(300);
      const [w, h] = TAM_CASA[st.casa], x0 = xc() - w / 2, y0 = BASE_CASA - h;
      st.casaEstado = 'cae';
      st.derrumbe = 0;
      st.tejado = { x: xc(), y: y0 + 13, vx: 70, vy: -80, ang: 0, vang: 5.5, nombre: 'tejado_' + st.casa };
      trozos(st.casa === 'palos' ? 'palo' : 'paja', 46, x0 + 4, y0 + 18, w - 8, h - 20);
      polvo(10, x0, BASE_CASA, w);
      st.cerdos.forEach((c) => { c.estado = 'asustado'; });
      // Si mientras tanto empieza otra escena (o la misma otra vez), esa ya no se toca
      const g = gen;
      setTimeout(() => { if (g === gen) st.cerdos.forEach((c, i) => { c.huye = true; c.dir = 1; c.salto = i * 0.2; }); }, 450);
      return esperar(1700).then(() => { if (g === gen) { st.casaEstado = 'fuera'; st.montonDe = st.casa; } });
    }
    function aguantar() {
      st.temblorCasa = 0.9;
      const [w, h] = TAM_CASA.ladrillos;
      polvo(5, xc() - w / 2, BASE_CASA - h + 26, w);
      return esperar(900);
    }
    function telon(abierto) {
      st.telonObjetivo = abierto ? 1 : 0;
      if (!vivo) st.telon = st.telonObjetivo;
      return esperar(vivo ? 1100 : 0);
    }

    // ---------------------------------------------------------------- avanzar el tiempo
    function avanzar(dt) {
      t += dt;
      const L = st.lobo;
      // El lobo anda hasta su sitio (con saltitos de paso)
      const dx = L.objetivo - L.x;
      L.anda = Math.abs(dx) > 0.5;
      if (L.anda) L.x += Math.sign(dx) * Math.min(Math.abs(dx), 45 * dt);
      if (L.golpe) { L.golpe += dt; if (L.golpe > 0.8) L.golpe = 0; }
      // Viento al soplar, y la casa que aguanta lo que puede
      if (st.soplo > 0.05 && L.estado === 'soplar') {
        if (r() < st.soplo * dt * 55) viento(1);
        if (st.casa && st.casa !== 'ladrillos' && st.carga > 0.45 && r() < st.carga * dt * 10) {
          const [w, h] = TAM_CASA[st.casa];
          trozos(st.casa === 'palos' ? 'palo' : 'paja', 1, xc() - w / 2 + 4, BASE_CASA - h + 4, w - 8, 16);
        }
      }
      if (L.estado === 'mofletes' && r() < dt * 14) {
        const b = bocaLobo();
        particula({ tipo: 'viento', x: b.x + 22 + r() * 10, y: b.y - 6 + r() * 12, vx: -70, vy: 0, max: 0.3, largo: 3, col: '#eaf6ff' });
      }
      if (L.estado === 'feliz' && r() < dt * 2.2) corazones(1);
      if (L.estado === 'agotado' && r() < dt * 1.6) {
        const c = cabezaLobo();
        particula({ tipo: 'gota', x: c.x - 6 + r() * 4, y: c.y - 4, vx: -20 - r() * 15, vy: -30, g: 120, max: 0.7, col: '#bfe6ff' });
      }
      if (L.estado === 'triste' && r() < dt * 0.9) {
        particula({ tipo: 'gota', x: L.x + 2, y: SUELO - 38, vx: 0, vy: 0, g: 70, max: 0.9, col: '#8fd0ff' });
      }
      // La casa nueva baja con un botecito; el humo de la chimenea
      if (st.casaY < 0) {
        st.casaVy += 420 * dt; st.casaY += st.casaVy * dt;
        if (st.casaY >= 0) { st.casaY = 0; st.casaVy = st.casaVy > 60 ? -st.casaVy * 0.3 : 0; if (st.casaVy < 0) st.casaY = -0.01; }
      }
      if (st.casa === 'ladrillos' && st.casaEstado === 'pie' && r() < dt * 2.5) {
        const [w, h] = TAM_CASA.ladrillos;
        particula({ tipo: 'humo', x: xc() - w / 2 + 42, y: BASE_CASA - h + 2 + st.casaY, vx: 6 + r() * 4, vy: -9, max: 2.4 });
      }
      if (st.temblorCasa > 0) st.temblorCasa = Math.max(0, st.temblorCasa - dt);
      if (st.tejado) {
        const tj = st.tejado;
        tj.vy += 60 * dt; tj.x += tj.vx * dt; tj.y += tj.vy * dt; tj.ang += tj.vang * dt;
        if (tj.x > W + 40 || tj.y > ALTO + 30) st.tejado = null;
      }
      if (st.casaEstado === 'cae') st.derrumbe = Math.min(1, st.derrumbe + dt * 1.6);
      // Cerditos: los que huyen salen corriendo por la derecha
      st.cerdos.forEach((c) => {
        if (c.huye) { c.x += 62 * dt; c.estado = Math.floor(t * 10) % 2 ? 'correr1' : 'correr2'; }
      });
      st.cerdos = st.cerdos.filter((c) => c.x < W + 20);
      // Foco y telón
      st.foco += (st.focoObjetivo - st.foco) * Math.min(1, dt * 5);
      if (st.telon !== st.telonObjetivo) {
        const v = dt / 1.0;
        st.telon = st.telon < st.telonObjetivo ? Math.min(st.telonObjetivo, st.telon + v) : Math.max(st.telonObjetivo, st.telon - v);
      }
      // Partículas
      st.particulas.forEach((p) => {
        if (p.retraso > 0) { p.retraso -= dt; return; }
        p.vida += dt;
        p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vgiro) p.giro += p.vgiro * dt;
        if (p.tipo === 'confeti') p.x += Math.sin(t * 3 + p.fase) * 0.3;
        if ((p.tipo === 'paja' || p.tipo === 'palo') && p.y > SUELO + 4 && p.vy > 0) { p.y = SUELO + 4; p.vy *= -0.25; p.vx *= 0.5; p.vgiro *= 0.4; }
      });
      st.particulas = st.particulas.filter((p) => p.vida < p.max);
    }

    // ---------------------------------------------------------------- pintar
    function pintarCasa() {
      if (!st.casa || st.casaEstado === 'fuera') {
        if (st.montonDe) { // lo que queda: un montoncito de paja o de palos
          const col = st.montonDe === 'palos' ? ['#9c6b3c', '#6e4524'] : ['#e8bd4f', '#b98a2e'];
          for (let i = -12; i <= 12; i++) {
            const alto = Math.round(4 * Math.cos((i / 12) * 1.4));
            for (let y = 0; y < alto; y++) { g.fillStyle = (i + y) % 3 ? col[0] : col[1]; g.fillRect(xc() + i, BASE_CASA - y, 1, 1); }
          }
        }
        return;
      }
      const [w, h] = TAM_CASA[st.casa], x0 = xc() - Math.round(w / 2), y0 = BASE_CASA - h + Math.round(st.casaY);
      const s = S();
      if (!s) return;
      const nombre = 'casa_' + st.casa;
      if (st.casaEstado === 'cae') {
        // Sin tejado, aplastándose y desapareciendo
        const k = 1 - st.derrumbe;
        if (k <= 0.02) return;
        const hh = Math.max(1, Math.round(h * k));
        const tmp = tmpCasa(nombre, 1, w, h);
        g.save();
        g.globalAlpha = Math.min(1, k * 1.6);
        g.drawImage(tmp, 0, 0, tmp.width, tmp.height, x0 - 1, BASE_CASA - hh, w + 2, hh + 1);
        g.restore();
        return;
      }
      // En pie: se tambalea con el soplido (la parte de arriba más) o tiembla (la de ladrillo)
      const tmp = tmpCasa(nombre, 0, w, h);
      const meneo = st.casa === 'ladrillos' ? 0 : st.carga;
      const temblor = st.temblorCasa > 0 || (st.casa === 'ladrillos' && st.soplo > 0.2) ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0;
      if (!meneo) { g.drawImage(tmp, x0 - 1 + temblor, y0 - 1); return; }
      for (let y = 0; y < tmp.height; y++) {
        const alto = 1 - y / tmp.height;
        const off = Math.round(Math.sin(t * 16) * meneo * 3 * alto + meneo * 2 * alto);
        g.drawImage(tmp, 0, y, tmp.width, 1, x0 - 1 + off, y0 - 1 + y, tmp.width, 1);
      }
    }
    // Cada casa en un canvas suelto (con su contorno), para pintarla por filas al tambalearse
    const cacheCasas = {};
    function tmpCasa(nombre, f, w, h) {
      const k = nombre + f;
      if (cacheCasas[k]) return cacheCasas[k];
      const c = document.createElement('canvas');
      c.width = w + 2; c.height = h + 2;
      sprite(c.getContext('2d'), nombre, 1, 1, { frame: f });
      cacheCasas[k] = c;
      return c;
    }

    function pintarLobo() {
      const L = st.lobo;
      let pose = 'recto', cara = 'normal', boca = L.boca, dy = 0, cdx = 0, cdy = 0, tx = 0, cola = 0;
      const e = L.estado;
      if (e === 'llamar') {
        pose = 'llamar';
        const k = L.golpe ? L.golpe % 0.38 : 1;
        if (L.golpe && k < 0.08) tx = 1; // el empujón del golpe
      } else if (e === 'mofletes') { cara = 'mofletes'; pose = 'soplar'; dy = -1; tx = Math.floor(t * 24) % 2; }
      else if (e === 'soplar') { cara = 'soplar'; pose = 'soplar'; cdx = 1; tx = st.soplo > 0.3 ? Math.floor(t * 30) % 2 : 0; }
      else if (e === 'agotado') { cara = 'agotado'; pose = 'cansado'; cdy = 2 + (Math.floor(t * 3) % 2); }
      else if (e === 'triste') { cara = 'triste'; cdy = 1; }
      else if (e === 'feliz') { cara = 'feliz'; pose = 'contento'; dy = -Math.round(Math.abs(Math.sin(t * 5)) * 3); cola = [0, 1, 0, 2][Math.floor(t * 8) % 4]; }
      else {
        // quieto: respira, menea la cola y parpadea de vez en cuando
        cola = [0, 1, 0, 2][Math.floor(t * 2) % 4];
        if (!boca && t % 3.4 < 0.13) cara = 'parpadeo';
      }
      if (st.reverencia) { pose = 'contento'; cara = 'feliz'; cdy = Math.floor(t * 1.5) % 2 ? 3 : 0; }
      if (boca === 2) cdy -= 1; // al abrir mucho la boca, la cabeza sube un poco
      if (L.anda) dy -= Math.floor(t * 8) % 2;
      const respira = e === 'quieto' && Math.floor(t * 1.2) % 2 ? 1 : 0;
      const bx = Math.round(L.x - 17 + tx), by = SUELO - 43 + dy;
      sprite(g, 'lobo_cola', bx + 11 - 16, by + 31 - 15, { frame: cola });
      sprite(g, 'lobo_cuerpo', bx, by, { frame: POSE[pose] });
      sprite(g, 'lobo_cabeza', bx + 5 + cdx, by - 9 + cdy + respira, { frame: CARA[cara] * 3 + Math.max(0, Math.min(2, boca | 0)) });
      // Los golpes en la puerta: una estrellita en el puño
      if (e === 'llamar' && L.golpe) {
        const k = L.golpe % 0.38;
        if (k < 0.12) {
          const px = bx + 36, py = by + 19;
          g.fillStyle = '#fff3a6';
          [[0, -3], [0, 3], [-3, 0], [3, 0], [2, -2], [2, 2], [-2, -2], [-2, 2]].forEach(([a, b]) => g.fillRect(px + a, py + b, 1, 1));
          g.fillStyle = '#ffffff'; g.fillRect(px, py, 1, 1);
        }
      }
    }

    function pintarCerdos() {
      st.cerdos.forEach((c, i) => {
        const habla = st.hablan === 'pigs' || (st.hablan === 'pig1' && c.n === 1);
        let estado = c.estado;
        if (!c.huye) {
          if (st.reverencia) estado = 'reir';
          else if (habla) estado = st.reir ? 'reir' : st.bocaCerdos > 0.5 ? 'hablar' : 'quieto';
          else if (st.soplo > 0.15 || st.casaEstado === 'cae') estado = 'asustado';
          else if (st.lobo.estado === 'feliz') estado = 'reir';
          else estado = (t + i * 1.3) % 4 < 0.13 ? 'parpadeo' : 'quieto';
        }
        let y = 0;
        if (habla && !c.huye) y = -Math.round(Math.abs(Math.sin(t * 9 + i)) * 2);
        if (st.reverencia || (st.lobo.estado === 'feliz' && !c.huye)) y = -Math.round(Math.abs(Math.sin(t * 5 + i * 0.8)) * 3);
        if (c.huye) y = -(Math.floor(t * 10) % 2);
        if (estado === 'asustado') y += Math.floor(t * 20 + i) % 2;
        sprite(g, 'cerdito' + c.n, c.x - 10, SUELO - 25 + y, { frame: POSE_CERDITO[estado], voltear: c.dir > 0 });
      });
    }

    function pintarParticulas(capa) {
      st.particulas.forEach((p) => {
        if (p.retraso > 0) return;
        const delante = p.tipo !== 'humo';
        if ((capa === 'detras') === delante) return;
        const x = Math.round(p.x), y = Math.round(p.y), f = p.vida / p.max;
        g.save();
        switch (p.tipo) {
          case 'viento': // una ráfaga: raya con el rizo al final (las más largas, de 2 de alto)
            g.globalAlpha = Math.min(1, 1.4 * (1 - f));
            g.fillStyle = p.col;
            g.fillRect(x, y, p.largo, p.largo > 6 ? 2 : 1);
            g.fillRect(x + p.largo, y - 1, 1, 1);
            g.fillRect(x + p.largo - 1, y - 2, 1, 1);
            break;
          case 'paja': case 'palo': {
            const n = p.tipo === 'palo' ? 5 : 3, o = Math.floor(p.giro) % 4;
            g.fillStyle = p.col;
            for (let i = 0; i < n; i++) {
              const k = i - Math.floor(n / 2);
              g.fillRect(x + (o === 0 ? k : o === 1 ? k : o === 2 ? 0 : -k), y + (o === 0 ? 0 : o === 1 ? k : o === 2 ? k : k), 1, 1);
            }
            break;
          }
          case 'polvo':
            g.globalAlpha = 0.75 * (1 - f);
            sprite(g, 'humo', x - 8, y - 8, { frame: Math.min(3, Math.floor(f * 4)) });
            break;
          case 'humo':
            g.globalAlpha = 0.55 * (1 - f);
            sprite(g, 'humo', x - 8, y - 8, { frame: Math.min(3, Math.floor(f * 3)) });
            break;
          case 'corazon':
            g.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
            sprite(g, 'corazon', x - 4 + Math.round(Math.sin(t * 4 + p.fase) * 2), y - 4, {});
            break;
          case 'confeti':
            g.fillStyle = p.col;
            if (Math.floor(t * 8 + p.fase) % 2) g.fillRect(x, y, 2, 1); else g.fillRect(x, y, 1, 2);
            break;
          case 'gota':
            g.fillStyle = p.col;
            g.fillRect(x, y, 1, 2); g.fillRect(x - 1, y + 1, 1, 1);
            break;
          case 'chispa': {
            const k = f < 0.5 ? 1 : 2;
            g.globalAlpha = 1 - f * 0.6;
            g.fillStyle = p.col;
            g.fillRect(x, y - k, 1, k * 2 + 1); g.fillRect(x - k, y, k * 2 + 1, 1);
            break;
          }
          default: break;
        }
        g.restore();
      });
    }

    function pintarTejado() {
      const tj = st.tejado;
      if (!tj) return;
      g.save();
      g.translate(Math.round(tj.x), Math.round(tj.y));
      g.rotate(Math.round(tj.ang * 4) / 4);
      sprite(g, tj.nombre, -25, -13, {});
      g.restore();
    }

    // El telón: dos cortinas rojas con pliegues, recogidas a los lados con un lazo, y la bambalina de arriba
    // con ondas y flecos dorados. Las cortinas y la bambalina se pintan una vez por ancho (lienzos sueltos)
    // y luego se copian fila a fila, cada una del ancho que toque.
    let telas = null;
    function pintarTelas() {
      const pliegue = ['#7d0a1f', '#a5112b', '#c81e39', '#de3550', '#c81e39', '#a5112b'];
      const wp = Math.ceil(W / 2) + 6;
      const cortina = (espejo) => {
        const c = document.createElement('canvas');
        c.width = wp; c.height = ALTO;
        const x = c.getContext('2d');
        for (let i = 0; i < wp; i++) {
          for (let tramo = 0; tramo * 40 < ALTO; tramo++) {
            x.fillStyle = pliegue[(i + tramo) % pliegue.length];
            x.fillRect(espejo ? wp - 1 - i : i, tramo * 40, 1, 40);
          }
        }
        return c;
      };
      const bamb = document.createElement('canvas');
      bamb.width = W; bamb.height = 16;
      const b = bamb.getContext('2d');
      for (let x = 0; x < W; x++) {
        const onda = 9 + Math.round(2.5 * Math.abs(Math.sin((x / 12) * Math.PI)));
        b.fillStyle = '#7d0a1f'; b.fillRect(x, 0, 1, 2);
        b.fillStyle = x % 12 < 2 ? '#a5112b' : '#c81e39'; b.fillRect(x, 2, 1, onda - 2);
        b.fillStyle = '#f2c14e'; b.fillRect(x, onda, 1, 1);
        if (x % 2 === 0) { b.fillStyle = '#c8962a'; b.fillRect(x, onda + 1, 1, 1); }
      }
      telas = { W, wp, izq: cortina(false), der: cortina(true), bamb };
    }
    // El telón entero, en su propio lienzo: solo se vuelve a pintar (fila a fila) si se mueve o cambia el ancho
    let telonPintado = null; // { W, abierto, telas, c }
    function pintarTelon() {
      if (!telas || telas.W !== W) pintarTelas();
      const tp = telonPintado;
      if (!tp || tp.W !== W || tp.abierto !== st.telon || tp.telas !== telas) {
        const c = tp ? tp.c : document.createElement('canvas');
        c.width = W; c.height = ALTO; // (así también se borra)
        dibujarTelon(c.getContext('2d'));
        telonPintado = { W, abierto: st.telon, telas, c };
      }
      g.drawImage(telonPintado.c, 0, 0);
    }
    function dibujarTelon(g) {
      const abierto = st.telon, recogido = abierto > 0.5;
      const ancho = Math.round(TELON + (W / 2 + 1 - TELON) * (1 - abierto));
      for (let y = 0; y < ALTO; y++) {
        // Abierto: se estrecha en el lazo (y = 72) y se abre un poco hacia abajo
        const lazo = recogido ? Math.round(Math.max(0, 4 - Math.abs(y - 72) / 6) * abierto) : 0;
        const borde = Math.min(telas.wp, ancho - lazo + (y > 72 && recogido ? Math.round(Math.min(3, (y - 72) / 14)) : 0));
        if (borde <= 0) continue;
        g.drawImage(telas.izq, 0, y, borde, 1, 0, y, borde, 1);
        g.drawImage(telas.der, telas.wp - borde, y, borde, 1, W - borde, y, borde, 1);
        g.fillStyle = '#5c0716';
        g.fillRect(borde - 1, y, 1, 1);
        g.fillRect(W - borde, y, 1, 1);
      }
      if (recogido) { // los lazos dorados
        [ancho - 6, W - ancho + 1].forEach((x) => {
          g.fillStyle = '#f2c14e'; g.fillRect(x, 70, 5, 2);
          g.fillStyle = '#c8962a'; g.fillRect(x, 72, 5, 1);
          g.fillStyle = '#f2c14e'; g.fillRect(x + 2, 73, 1, 4);
        });
      }
      g.drawImage(telas.bamb, 0, 0);
    }

    // Foco del ensayo: todo un poco más oscuro menos un círculo alrededor del lobo
    function pintarFoco() {
      if (st.foco < 0.02) return;
      const cx = Math.round(st.lobo.x + 2), cy = SUELO - 28, rr = 33;
      g.save();
      g.globalAlpha = 0.5 * st.foco;
      g.fillStyle = '#120a1e';
      for (let y = 0; y < ALTO; y++) {
        const d = y - cy, ancho = d * d < rr * rr ? Math.round(Math.sqrt(rr * rr - d * d) * 1.1) : -1;
        if (ancho < 0) { g.fillRect(0, y, W, 1); continue; }
        g.fillRect(0, y, Math.max(0, cx - ancho), 1);
        g.fillRect(cx + ancho, y, W, 1);
      }
      g.globalAlpha = 0.18 * st.foco;
      g.fillStyle = '#fff6c8';
      for (let y = 10; y < SUELO; y++) {
        const ancho = Math.round(6 + ((y - 10) / (SUELO - 10)) * 26);
        g.fillRect(cx - ancho, y, ancho * 2, 1);
      }
      g.restore();
    }

    function pintarCielo() {
      // Nubes que pasan despacio y el sol que sonríe
      const ancho = W + 30;
      [[0.1, 16, 3], [0.55, 26, 2], [0.85, 12, 4]].forEach(([p, y, v]) => {
        const x = ((p * ancho + t * v) % ancho) - 26;
        sprite(g, 'nube', x, y, {});
      });
      sprite(g, 'sol', W - TELON - 30, 14, {});
    }

    function pintarTarjeta() {
      const tipo = st.tarjeta, L = st.lobo;
      if (tipo === 'entrar') sprite(g, 'puerta', L.x + 20, SUELO - 26, {});
      if (tipo === 'cansado') sprite(g, 'muro', L.x + 24, SUELO - 26, {});
    }

    function pintar() {
      if (!decorado || decorado.width !== W) decorado = pintarDecorado(W, !!st.tarjeta);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(decorado, 0, 0);
      pintarCielo();
      pintarParticulas('detras');
      if (st.tarjeta) pintarTarjeta(); else pintarCasa();
      pintarTejado();
      pintarCerdos();
      pintarLobo();
      pintarParticulas('delante');
      if (!st.tarjeta) { pintarFoco(); pintarTelon(); }
    }

    function volcar() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, W, ALTO, 0, 0, cv.width, cv.height);
    }

    function bucle(ahora) {
      raf = 0;
      if (!vivo) return;
      const dt = Math.min(0.05, Math.max(0, (ahora - (ultimo || ahora)) / 1000));
      ultimo = ahora;
      try { avanzar(dt); pintar(); volcar(); } catch (e) { /* un fallo de dibujo no para el teatro */ }
      if (!document.hidden) raf = requestAnimationFrame(bucle);
      else setTimeout(() => { if (vivo && !raf) raf = requestAnimationFrame(bucle); }, 250);
    }

    function medir() {
      if (op.fijo || !cv) return;
      const caja = cv.getBoundingClientRect();
      if (!caja.width || !caja.height) return;
      const xAntes = xc();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.round(caja.width * dpr);
      cv.height = Math.round(caja.height * dpr);
      W = Math.max(150, Math.round((ALTO * cv.width) / cv.height));
      buf.width = W; buf.height = ALTO;
      decorado = null;
      st.lobo.objetivo = sitioLobo(st.id);
      st.lobo.x = st.lobo.objetivo;
      // Los cerditos, a su sitio; si ya han salido corriendo (la casa ha caído), no vuelven: se mueven con la casa
      if (st.casaEstado === 'pie') colocarCerdos(st.id);
      else { const d = xc() - xAntes; st.cerdos.forEach((c) => { c.x += d; }); }
    }

    buf.width = W; buf.height = ALTO;
    if (!op.fijo) { medir(); raf = requestAnimationFrame(bucle); }

    return {
      preparar, lobo, tocToc, derribar, aguantar, telon, corazones, confeti, estrellas,
      boca(n) { st.lobo.boca = n; },
      hablan(quien, n, o) { st.hablan = quien; st.bocaCerdos = n || 0; st.reir = !!(o && o.reir); },
      soplo(fuerza, carga) { st.soplo = Math.max(0, Math.min(1, fuerza)); st.carga = Math.max(0, Math.min(1, carga)); },
      foco(si) { st.focoObjetivo = si ? 1 : 0; },
      reverencia() { st.reverencia = true; corazones(4); },
      medir,
      detener() { vivo = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
      estado: () => ({ id: st.id, casa: st.casa, casaEstado: st.casaEstado, lobo: st.lobo.estado, boca: st.lobo.boca,
        cerdos: st.cerdos.length, soplo: st.soplo, carga: st.carga, telon: st.telon, foco: st.focoObjetivo, particulas: st.particulas.length }),
      // Para las miniaturas: pintar una vez, quieto, con lo que se haya puesto
      __fijo: { st, pintar, avanzar, buf, viento, trozos, corazones, xc: () => xc() },
    };
  }

  // ---------------------------------------------------------------- miniaturas y tarjetas (dibujos quietos)
  // Lo característico de cada escena: el lobo llamando, soplando (con viento y paja volando), agotado...
  function momento(e, id) {
    const F = e.__fijo, sc = escenaDe(id);
    e.preparar(id);
    F.st.telon = F.st.telonObjetivo = 1;
    F.st.lobo.x = F.st.lobo.objetivo;
    const tipo = sc.tipo;
    if (tipo === 'entrar') { F.st.lobo.estado = 'llamar'; F.st.lobo.golpe = 0.02; }
    if (tipo === 'soplar') {
      F.st.lobo.estado = 'soplar'; F.st.soplo = 1; F.st.carga = sc.casa === 'ladrillos' ? 0 : 0.6;
      F.viento(10); F.avanzar(0.2); F.viento(8); F.avanzar(0.12);
      if (sc.casa !== 'ladrillos') { F.trozos(sc.casa === 'palos' ? 'palo' : 'paja', 7, F.xc() - 18, 68, 36, 14); F.avanzar(0.18); }
    }
    if (tipo === 'cansado') { F.st.lobo.estado = 'agotado'; F.st.hablan = 'pigs'; F.st.reir = true; }
    if (tipo === 'triste') F.st.lobo.estado = 'triste';
    if (tipo === 'amable') { F.st.lobo.estado = 'feliz'; F.corazones(5); F.avanzar(0.6); }
    F.st.cerdos.forEach((c) => { c.salto = 0; });
  }
  function volcarEn(canvas, F, x0, y0, w, h) {
    canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(F.buf, x0, y0, w, h, 0, 0, w, h);
  }
  function miniatura(canvas, id) {
    try {
      const e = crear(null, { fijo: true, ancho: 200 }), F = e.__fijo;
      momento(e, id);
      F.pintar();
      const x0 = Math.max(0, F.xc() - 66);
      volcarEn(canvas, F, x0, 46, 140, 76);
    } catch (err) { /* sin dibujo */ }
  }
  function tarjeta(canvas, tipo) {
    try {
      const e = crear(null, { fijo: true, ancho: 110 }), F = e.__fijo;
      const id = { entrar: 'l1', soplar: 'l2', cansado: 'l7', triste: 'l8', amable: 'l9' }[tipo] || 'l1';
      e.preparar(id);
      F.st.tarjeta = tipo;
      F.st.cerdos = [];
      F.st.lobo.x = F.st.lobo.objetivo = 36;
      momento(e, id);
      F.st.cerdos = []; F.st.hablan = null;
      F.st.lobo.x = F.st.lobo.objetivo = 36; // (si no, mientras salen las partículas andaría hasta su sitio de la escena)
      F.st.particulas = [];
      if (tipo === 'soplar') { // la ráfaga, aún cerca del hocico, y pajitas volando
        F.viento(10); F.avanzar(0.14); F.viento(10); F.avanzar(0.07); F.viento(6); F.avanzar(0.03);
        F.trozos('paja', 9, 66, 64, 24, 18); F.avanzar(0.12);
      }
      if (tipo === 'amable') { F.corazones(6); F.avanzar(0.7); }
      if (tipo === 'cansado') { F.st.lobo.estado = 'agotado'; }
      F.st.lobo.golpe = tipo === 'entrar' ? 0.02 : 0;
      F.pintar();
      volcarEn(canvas, F, 8, 54, 94, 68);
    } catch (err) { /* sin dibujo */ }
  }

  window.TeatroEscena = { crear, miniatura, tarjeta, ALTO };
})();
