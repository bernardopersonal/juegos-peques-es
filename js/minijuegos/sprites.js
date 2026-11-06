/* Sprites pixel-art de los minijuegos.
 *
 * Todo el arte está definido aquí, en código: matrices de caracteres + paleta
 * (o pequeñas rutinas que pintan píxel a píxel). Nada se descarga.
 * Cada dibujo se pinta una vez en un canvas pequeño (tamaño de arte) y se
 * escala al dibujar con imageSmoothingEnabled = false (píxeles nítidos).
 *
 * window.Sprites = {
 *   nombres: [...],
 *   tam(nombre) → {w, h}            tamaño del arte sin escalar
 *   frames(nombre) → nº de frames
 *   dibujar(ctx, nombre, x, y, escala, {voltear, frame, alfa, destello})
 *            x, y = esquina superior izquierda; destello 0..1 = tinte blanco
 *   textura(tipoBloque, tamPx, variante=0) → canvas tamPx × tamPx (cacheado)
 *            tipos: hierba, tierra, piedra, arena, madera, hojas, agua
 *            variante: en 'agua' es el frame de las olas (0-3); en los demás, 1 = espejo
 * }
 *
 * Personajes (12×24, mirando a la derecha; voltear = mirar a la izquierda):
 *   steve, alex   frames 0 quieto, 1-2 andar, 3 brazo al frente (sujetar el bazooka)
 *   zombi         frames 0 quieto, 1-2 andar (brazos siempre al frente)
 *   creeper       frames 0 quieto, 1-2 andar (usa destello para el siseo)
 *   esqueleto     frames 0 quieto, 1-2 andar, 3 tensando el arco
 * Objetos (apuntan a la derecha; para orientarlos: ctx.translate/rotate y dibujar centrado):
 *   cohete 14×7 (0-1 llama), tnt 16×16 (0 normal, 1 parpadeo), flecha 12×5, orbe 7×7 (0-1),
 *   humo 16×16 (0-3), explosion 16×16 (0-3, extra), bazooka 16×7, corazon 9×9 (0 lleno, 1 vacío),
 *   viento 16×9 (flecha a la derecha).
 * Bloques 16×16: hierba, tierra, piedra, arena, madera, hojas, agua (0-3), madera_corte (anillos).
 * Teatro (js/teatro-escena.js; más detalle junto a su código, al final):
 *   lobo_cabeza 32×27  frame = cara × 3 + boca (boca 0 cerrada, 1 entreabierta, 2 abierta); caras: 0 normal,
 *                      1 triste, 2 feliz, 3 agotado, 4 mofletes, 5 soplar, 6 parpadeo. Mirando a la derecha.
 *   lobo_cuerpo 38×44  0 recto, 1 llamar, 2 cansado, 3 contento, 4 soplar.   lobo_cola 18×18 (0-2, meneo)
 *   cerdito1..3 20×26  0 quieto, 1 hablar, 2 asustado, 3 reír, 4-5 correr, 6 parpadeo. Mirando a la izquierda.
 *   casa_paja 50×46, casa_palos 50×48 (0 entera, 1 sin tejado), casa_ladrillos 56×52; tejado_paja 50×26,
 *   tejado_palos 50×27; puerta 14×24, muro 18×24; nube 24×9, sol 16×16.
 * Los personajes y objetos llevan un contorno oscuro de 1 px de arte que sobresale de la caja
 * (no cuenta en tam()). Nunca lanza excepciones: nombre desconocido → no dibuja, tam() → 16×16.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- color
  const cacheRGBA = {};
  function rgba(c) {
    if (cacheRGBA[c]) return cacheRGBA[c];
    let h = c.charAt(0) === '#' ? c.slice(1) : c;
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
      h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
    cacheRGBA[c] = v;
    return v;
  }
  const hex2 = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
  function aHex(v) { return '#' + hex2(v[0]) + hex2(v[1]) + hex2(v[2]) + (v[3] < 255 ? hex2(v[3]) : ''); }
  function mezclar(c1, c2, t) {
    const a = rgba(c1), b = rgba(c2);
    return aHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
  }
  function oscurecer(c, f) { const a = rgba(c); return aHex([a[0] * f, a[1] * f, a[2] * f, a[3]]); }

  // Generador pseudoaleatorio con semilla (el arte procedimental sale siempre igual)
  function azar(semilla) {
    let s = semilla >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- lienzo de arte
  function Arte(w, h) { this.w = w; this.h = h; this.p = new Array(w * h).fill(null); }
  Arte.prototype.pon = function (x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.p[y * this.w + x] = c;
  };
  Arte.prototype.toma = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.p[y * this.w + x];
  };
  Arte.prototype.rect = function (x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.pon(x + i, y + j, c);
  };
  // Pinta una matriz de caracteres. '.' o ' ' = transparente.
  // o.cizalla: desplazamiento horizontal de la última fila respecto a la primera (pivote arriba)
  // o.espejo: invierte en horizontal; o.sombra: factor de oscurecido; o.alto: recorta filas
  Arte.prototype.mapa = function (filas, pal, dx, dy, o) {
    o = o || {};
    const n = o.alto != null ? Math.min(o.alto, filas.length) : filas.length;
    for (let r = 0; r < n; r++) {
      const fila = filas[r];
      const off = o.cizalla ? Math.round(o.cizalla * r / Math.max(1, filas.length - 1)) : 0;
      for (let i = 0; i < fila.length; i++) {
        const ch = fila.charAt(i);
        if (ch === '.' || ch === ' ') continue;
        let col = pal[ch];
        if (!col) continue;
        if (o.sombra) col = oscurecer(col, o.sombra);
        const xx = o.espejo ? fila.length - 1 - i : i;
        this.pon(dx + xx + off, dy + r, col);
      }
    }
    return this;
  };
  Arte.prototype.copia = function () { const a = new Arte(this.w, this.h); a.p = this.p.slice(); return a; };

  // ---------------------------------------------------------------- registro
  const REG = {};
  const NOMBRES = [];
  // opc.contorno: color del borde de 1 px alrededor de la silueta (o null)
  function registrar(nombre, artes, opc) {
    opc = opc || {};
    REG[nombre] = {
      w: artes[0].w, h: artes[0].h, artes,
      contorno: opc.contorno || null,
      margen: opc.contorno ? 1 : 0,
      canv: [], blancos: [],
    };
    NOMBRES.push(nombre);
  }

  const hayDOM = typeof document !== 'undefined' && typeof document.createElement === 'function';
  function nuevoCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function pintarCanvas(arte, contorno, margen, blanco) {
    const W = arte.w + margen * 2, H = arte.h + margen * 2;
    const c = nuevoCanvas(W, H);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const opaco = (x, y) => { const v = arte.toma(x, y); return v && rgba(v)[3] > 40; };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ax = x - margen, ay = y - margen;
        let col = arte.toma(ax, ay);
        if (!col && contorno && (opaco(ax - 1, ay) || opaco(ax + 1, ay) || opaco(ax, ay - 1) || opaco(ax, ay + 1))) col = contorno;
        if (!col) continue;
        const v = rgba(col);
        const k = (y * W + x) * 4;
        if (blanco) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; } else { d[k] = v[0]; d[k + 1] = v[1]; d[k + 2] = v[2]; }
        d[k + 3] = v[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  function canvasDe(s, f) {
    if (!s.canv[f]) s.canv[f] = pintarCanvas(s.artes[f], s.contorno, s.margen, false);
    return s.canv[f];
  }
  function blancoDe(s, f) {
    if (!s.blancos[f]) s.blancos[f] = pintarCanvas(s.artes[f], s.contorno, s.margen, true);
    return s.blancos[f];
  }

  // ================================================================ PERSONAJES
  // Caja 12×24 mirando a la derecha. Vista casi de frente, girada un poco hacia
  // donde mira: se ve la cara entera (8 px) y una franja del lateral (1 px) detrás.
  //   cabeza  x 2..10 (lateral en x=2)   y 0..7
  //   torso   x 3..9  (lateral en x=3)   y 8..15
  //   brazos  x 1..2 (el de atrás) y x 10..11 (el de delante)   y 8..15
  //   piernas x 3..6 (con lateral) y x 7..9                       y 16..23

  // Construye los frames de un humanoide a partir de sus piezas.
  // def.ox desplaza todo el cuerpo en x (para dejar sitio a lo que sobresale por delante).
  // Pose: pi/pd = [cizalla, alto] de las piernas izquierda/derecha de la imagen (alto 7 = pie levantado),
  //       bi/bd = cizalla de los brazos, biFrente/bdFrente = brazo estirado al frente {x0, x1, y, manga}.
  function humanoide(def) {
    const P = def.pal;
    const ox = def.ox || 0;
    function pose(o) {
      const a = new Arte(12, 24);
      const pd = o.pd || [0, 8], pi = o.pi || [0, 8];
      if (def.detras) def.detras(a, o, ox);
      a.mapa(def.piernaD, P, 7 + ox, 16 + (8 - pd[1]), { cizalla: pd[0] });
      a.mapa(def.piernaI, P, 3 + ox, 16 + (8 - pi[1]), { cizalla: pi[0] });
      if (!o.biFrente) a.mapa(def.brazo, P, 1 + ox, 8, { cizalla: o.bi || 0, sombra: 0.8 });
      a.mapa(def.torso, P, 3 + ox, 8);
      a.mapa(def.cabeza, P, 2 + ox, 0);
      if (o.bdFrente) brazoFrente(a, def, P, o.bdFrente, 0.85);
      else a.mapa(def.brazo, P, 10 + ox, 8, { cizalla: o.bd || 0 });
      if (o.biFrente) brazoFrente(a, def, P, o.biFrente, 1);
      if (def.delante) def.delante(a, o, ox);
      return a;
    }
    const poses = def.poses || [
      {},
      { pi: [-1, 8], pd: [1, 8], bi: 1, bd: -1 },   // zancada: piernas abiertas
      { pi: [0, 7], pd: [0, 8], bi: -1, bd: 1 },    // paso: piernas juntas, un pie en el aire
    ];
    return poses.concat(def.extra || []).map(pose);
  }
  // Brazo estirado hacia delante (horizontal, 2 px de grueso): manga + piel; la mano un poco más oscura.
  function brazoFrente(a, def, P, b, sombra) {
    const manga = b.manga != null ? b.manga : def.manga;
    for (let x = b.x0; x <= b.x1; x++) {
      const enManga = x - b.x0 < manga;
      const mano = x === b.x1;
      a.pon(x, b.y, oscurecer(enManga ? P.C : (mano ? P.s : P.S), sombra));
      a.pon(x, b.y + 1, oscurecer(enManga ? P.d : (P.k || P.s), sombra));
    }
  }

  // ---------------------------------------------------------------- Steve
  const palSteve = {
    H: '#2a190c', h: '#3b2513', j: '#4f331b',
    S: '#c48d63', s: '#a8754d', k: '#8c5d3a',
    W: '#f4f4f4', B: '#4b3da0', N: '#8a5434', M: '#5a2c1a', b: '#3b2513',
    C: '#2fb4c2', c: '#2393a1', d: '#1a737f',
    P: '#3b3da8', p: '#2d2f8a', q: '#22236a',
    Z: '#6f6f6f', z: '#4d4d4d',
  };
  const steve = humanoide({
    pal: palSteve, manga: 3,
    cabeza: [
      'Hhhhhhhhh',
      'Hhhjhhhjh',
      'HhSSSSSSh',
      'kSSSSSSSS',
      'kSWBSSWBS',
      'kSSSNNSSS',
      'kSSbMMbSS',
      'kSSbbbbSS',
    ],
    torso: [
      'dCCCCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dCCcCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dcCCCCc',
      'dcccccc',
    ],
    brazo: ['CC', 'Cc', 'cc', 'SS', 'Ss', 'Ss', 'Ss', 'ss'],
    piernaI: ['qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'zZZz', 'zZZz'],
    piernaD: ['PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'ZZz', 'ZZz'],
    extra: [{ biFrente: { x0: 4, x1: 11, y: 10 } }],
  });
  registrar('steve', steve, { contorno: '#1b1424a0' });

  // ---------------------------------------------------------------- Alex
  const palAlex = {
    H: '#a8501a', h: '#dd7726', j: '#f29a3f',
    S: '#f1c39a', s: '#d9a47b', k: '#bf8a63',
    W: '#f4f4f4', G: '#2e8a3c', M: '#c9776a',
    C: '#6cbd4b', c: '#56a03c', d: '#3f7f2c',
    P: '#6d4727', p: '#593a1f', q: '#432b16',
    Z: '#4a3423', z: '#33231a',
  };
  const alex = humanoide({
    pal: palAlex, manga: 3,
    cabeza: [
      'Hhhhhjhhh',
      'Hhjhhhhjh',
      'HhhhhhSSh',
      'HhhSSSSSh',
      'HhWGSSWGh',
      'HhSSSSSSS',
      'HhSSSMMSS',
      'HhSSSSSSS',
    ],
    torso: [
      'dCCCCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dCCCCCc',
      'dcCCCCc',
      'dcccccc',
    ],
    brazo: ['CC', 'Cc', 'cc', 'SS', 'Ss', 'Ss', 'Ss', 'ss'],
    piernaI: ['qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'zZZz', 'zZZz'],
    piernaD: ['PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'ZZz', 'ZZz'],
    detras: function (a) { // melena larga cayendo por la espalda
      a.mapa([
        '.H',
        'HH',
        'Hh',
        'Hh',
        'Hh',
        'Hh',
        'Hh',
        'Hh',
        'Hh',
        'HH',
        '.H',
      ], palAlex, 0, 1);
    },
    extra: [{ biFrente: { x0: 4, x1: 11, y: 10 } }],
  });
  registrar('alex', alex, { contorno: '#1b1424a0' });

  // ---------------------------------------------------------------- Zombi
  const palZombi = {
    G: '#5c9e40', g: '#4b8634', k: '#3a6a28', E: '#16220f', e: '#2b4420', N: '#3d6e2c',
    S: '#5c9e40', s: '#4b8634',
    C: '#2aa5a5', c: '#218a8a', d: '#196b6b',
    P: '#473a9c', p: '#3a2f82', q: '#2c2464',
    Z: '#4a4a6a', z: '#363650',
  };
  // brazos siempre estirados al frente (el de detrás más arriba)
  const zArr = { x0: 8, x1: 11, y: 9, manga: 1 }, zAba = { x0: 2, x1: 11, y: 11, manga: 3 };
  const zArr2 = { x0: 8, x1: 11, y: 10, manga: 1 }, zAba2 = { x0: 2, x1: 11, y: 12, manga: 3 };
  const zombi = humanoide({
    pal: palZombi, manga: 3, ox: -1,
    cabeza: [
      'kgkgggkgg',
      'kgGgGGgGg',
      'kGGGGGGGG',
      'kGGGGGGGG',
      'kGEEGGEEG',
      'kGGGNNGGG',
      'kGGkkkkGG',
      'kGGGGGGGG',
    ],
    torso: [
      'dCCCCCc',
      'dCCCCCc',
      'dCCcCCc',
      'dCCCCCc',
      'dCCCCcc',
      'dCCCCCc',
      'dcCCCCc',
      'dcccccc',
    ],
    brazo: ['CC', 'Cc', 'cc', 'GG', 'Gg', 'Gg', 'Gg', 'gg'],
    piernaI: ['qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'qPPp', 'zZZz', 'zZZz'],
    piernaD: ['PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'PPp', 'ZZz', 'ZZz'],
    poses: [
      { biFrente: zAba, bdFrente: zArr },
      { biFrente: zAba2, bdFrente: zArr, pi: [-1, 8], pd: [1, 8] },
      { biFrente: zAba, bdFrente: zArr2, pi: [0, 7], pd: [0, 8] },
    ],
  });
  registrar('zombi', zombi, { contorno: '#1b1424a0' });

  // ---------------------------------------------------------------- Creeper
  function creeperFrames() {
    const verdes = ['#5bbd47', '#4ea83c', '#6fd157', '#43952f', '#86e070', '#3b8a2a'];
    const E = '#0f0f0f', e = '#2a2a2a';
    const r = azar(7);
    const textura = [];
    for (let i = 0; i < 12 * 24; i++) {
      const v = r();
      textura.push(v < 0.35 ? verdes[0] : v < 0.6 ? verdes[1] : v < 0.75 ? verdes[2] : v < 0.88 ? verdes[3] : v < 0.95 ? verdes[4] : verdes[5]);
    }
    const tx = (x, y) => textura[y * 12 + x];
    const cara = [
      '........',
      '........',
      '.EE..Ee.',
      '.eE..EE.',
      '...EE...',
      '..EEEE..',
      '..EeEE..',
      '..E..E..',
    ];
    function pose(paso) {
      const a = new Arte(12, 24);
      // patas: delanteras x3..5 y x7..9; traseras (más oscuras) asoman detrás.
      // Al andar se levantan en diagonal (delantera de un lado + trasera del otro) y avanzan 1 px.
      const A = paso === 1, B = paso === 2;
      const pata = (x, y0, sombra) => {
        for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 3; xx++) {
          a.pon(x + xx, y0 + yy, oscurecer(tx(Math.min(11, x + xx), Math.min(23, y0 + yy)), sombra));
        }
      };
      pata(2 + (B ? 1 : 0), 17 - (B ? 1 : 0), 0.62);
      pata(8 + (A ? 1 : 0), 17 - (A ? 1 : 0), 0.62);
      pata(3 + (A ? 1 : 0), 18 - (A ? 2 : 0), 1);
      pata(7 + (B ? 1 : 0), 18 - (B ? 2 : 0), 1);
      // cuerpo
      for (let y = 8; y < 18; y++) for (let x = 3; x < 10; x++) a.pon(x, y, x === 3 ? oscurecer(tx(x, y), 0.75) : tx(x, y));
      // cabeza
      for (let y = 0; y < 8; y++) for (let x = 2; x < 11; x++) a.pon(x, y, x === 2 ? oscurecer(tx(x, y), 0.75) : tx(x, y));
      a.mapa(cara, { E, e }, 3, 0);
      return a;
    }
    return [pose(0), pose(1), pose(2)];
  }
  registrar('creeper', creeperFrames(), { contorno: '#1b1424a0' });

  // ---------------------------------------------------------------- Esqueleto
  // Mismo encuadre que los demás pero desplazado 1 px atrás para que quepa el arco delante.
  function esqueletoFrames() {
    const pal = {
      L: '#dcdcdc', l: '#bdbdbd', a: '#979797', D: '#222222', d: '#474747', W: '#f4f4f4',
      m: '#7a5030', n: '#a06c3c', o: '#4f321b', t: '#f0f0f0', g: '#9a9a9a', G: '#cfcfcf', f: '#e6e6e6',
    };
    const cabeza = [
      'aLLLLWLLL',
      'aLLLLLLLL',
      'alLLLLLLL',
      'alDDLLDDL',
      'alDdLLDdL',
      'alLLLdLLL',
      'alLDDDDLL',
      'alLLLLLLL',
    ];
    const torso = [
      'aLLLLLL',
      '.dLLLLd',
      '..LdL..',
      '.lLLLL.',
      '..LdL..',
      '.lLLLL.',
      '..LdL..',
      '.lLLLl.',
    ];
    const hueso = ['Ll', 'Ll', 'Ll', 'Ll', 'Ll', 'Ll', 'Ll', 'll'];
    // arco: de (9,4) a (9,16), panza hacia delante en x=11
    const arco = [
      'o..',
      '.m.',
      '.m.',
      '..m',
      '..m',
      '..n',
      '..n',
      '..n',
      '..m',
      '..m',
      '.m.',
      '.m.',
      'o..',
    ];
    const brazoH = (A, x0, x1, y, sombra) => {
      for (let x = x0; x <= x1; x++) { A.pon(x, y, oscurecer(pal.L, sombra)); A.pon(x, y + 1, oscurecer(pal.a, sombra)); }
    };
    function linea(A, x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) A.pon(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c);
    }
    function pose(o) {
      const A = new Arte(12, 24);
      const pi = o.pi || [0, 8], pd = o.pd || [0, 8];
      A.mapa(hueso, pal, 6, 16 + (8 - pd[1]), { cizalla: pd[0], sombra: 0.8 });
      A.mapa(hueso, pal, 3, 16 + (8 - pi[1]), { cizalla: pi[0] });
      A.mapa(torso, pal, 2, 8);
      A.mapa(cabeza, pal, 1, 0);
      if (!o.tensa) {
        linea(A, 9, 4, 9, 16, pal.t);            // cuerda recta
        A.mapa(arco, pal, 9, 4);
        brazoH(A, 7, 10, 9, 0.8);                // brazo de detrás
        brazoH(A, 2, 10, 11, 1);                 // brazo de delante
      } else {
        // cuerda tirada hacia atrás y flecha montada
        linea(A, 9, 4, 5, 10, pal.t);
        linea(A, 5, 11, 9, 16, pal.t);
        A.mapa(arco, pal, 9, 4);
        brazoH(A, 7, 10, 9, 0.8);                // sujeta el arco
        for (let x = 4; x <= 9; x++) A.pon(x, 10, x < 6 ? pal.f : pal.n);   // plumas + astil
        A.pon(10, 10, pal.G); A.pon(11, 10, pal.g); A.pon(10, 9, pal.g); A.pon(10, 11, pal.g); // punta
        brazoH(A, 2, 5, 11, 1);                  // tira de la cuerda
      }
      return A;
    }
    return [
      pose({}),
      pose({ pi: [-1, 8], pd: [1, 8] }),
      pose({ pi: [0, 7], pd: [0, 8] }),
      pose({ tensa: true }),
    ];
  }
  registrar('esqueleto', esqueletoFrames(), { contorno: '#1b1424a0' });

  // ================================================================ OBJETOS
  // Cohete 14×7 apuntando a la derecha
  function coheteFrames() {
    const pal = { R: '#d8392a', r: '#a12619', W: '#ececec', w: '#b9b9b9', g: '#6f6f6f', Y: '#ffd83a', O: '#ff8a1e', y: '#fff6b0' };
    const base = [
      '...rr.........',
      '...rRR........',
      '..gwWWWWRWWrR.',
      '..gWWWWWRWWRRr',
      '..gwwwwwrwwrR.',
      '...rRR........',
      '...rr.........',
    ];
    const f0 = new Arte(14, 7).mapa(base, pal, 0, 0);
    f0.mapa(['.O', 'YY', '.O'], pal, 0, 2);
    const f1 = new Arte(14, 7).mapa(base, pal, 0, 0);
    f1.mapa(['.OO', 'yYY', '.OO'], pal, -1, 2);
    f1.pon(0, 3, pal.O);
    return [f0, f1];
  }
  registrar('cohete', coheteFrames(), { contorno: '#1b1424a0' });

  // TNT 16×16
  function tntFrames() {
    const R = '#d9392a', r = '#a8291c', Rl = '#ec5a43', B = '#e9e9e9', b = '#c9c9c9', K = '#1d1d1d';
    function pintar(destello) {
      const a = new Arte(16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let c = (x % 4 === 3) ? r : (x % 4 === 0 ? Rl : R);
        if (y === 0 || y === 15) c = r;
        a.pon(x, y, c);
      }
      a.rect(0, 5, 16, 6, B);
      a.rect(0, 10, 16, 1, b);
      a.rect(0, 5, 16, 1, b);
      const letras = [
        '###..#..#..###',
        '.#...##.#...#.',
        '.#...#.##...#.',
        '.#...#..#...#.',
      ];
      a.mapa(letras, { '#': K }, 1, 6);
      if (destello) for (let i = 0; i < a.p.length; i++) if (a.p[i]) a.p[i] = mezclar(a.p[i], '#ffffff', 0.6);
      return a;
    }
    return [pintar(false), pintar(true)];
  }
  registrar('tnt', tntFrames(), { contorno: '#1b1424a0' });

  // Flecha 12×5 apuntando a la derecha
  registrar('flecha', [new Arte(12, 5).mapa([
    'Ww..........',
    '.Ww......G..',
    '..mmmmmmmGGg',
    '.Ww......g..',
    'Ww..........',
  ], { W: '#f2f2f2', w: '#bdbdbd', m: '#7a5232', G: '#b8b8b8', g: '#7a7a7a' }, 0, 0)], { contorno: '#1b142490' });

  // Orbe de experiencia 7×7
  registrar('orbe', [
    new Arte(7, 7).mapa([
      '..ggg..',
      '.gYYYg.',
      'gYWyYYg',
      'gYyYYYg',
      'gYYYYyg',
      '.gYYyg.',
      '..ggg..',
    ], { g: '#4f9a12', Y: '#bff03a', y: '#e9ff8f', W: '#ffffff' }, 0, 0),
    new Arte(7, 7).mapa([
      '..ggg..',
      '.gyyyg.',
      'gyWWyyg',
      'gyWyyyg',
      'gyyyyYg',
      '.gyyYg.',
      '..ggg..',
    ], { g: '#6fbf1a', Y: '#d5ff5a', y: '#f2ffb0', W: '#ffffff' }, 0, 0),
  ], { contorno: '#2a4a0a80' });

  // Humo 16×16, 4 frames (sale, crece y se deshace)
  function humoFrames() {
    const cols = ['#fafafa', '#e2e2e2', '#c4c4c4', '#a2a2a2', '#828282'];
    const bolas = [
      [[8, 9, 3.4], [6.5, 7.5, 2.4], [9.5, 7, 2.4]],
      [[6, 9.5, 3.8], [10, 9, 3.6], [8, 6, 3.4]],
      [[5, 10, 4.2], [11, 9.5, 4.0], [8, 5.5, 4.0], [8, 11, 3.6]],
      [[4.5, 10, 4.3], [11.5, 9.5, 4.1], [8, 5, 4.2], [8, 11.5, 3.6]],
    ];
    const out = [];
    for (let f = 0; f < 4; f++) {
      const a = new Arte(16, 16);
      const r = azar(31 + f);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let mejor = 99, luz = 0;
        bolas[f].forEach((b) => {
          const d = Math.hypot(x + 0.5 - b[0], y + 0.5 - b[1]) / b[2];
          if (d < mejor) { mejor = d; luz = ((x + 0.5 - b[0]) * 0.7 + (y + 0.5 - b[1])) / b[2]; }
        });
        if (mejor > 1) continue;
        // se deshace: cada vez más huecos (tramado), primero por los bordes
        const hueco = f === 2 ? (mejor > 0.75 ? 0.35 : 0.08) : f === 3 ? (mejor > 0.6 ? 0.7 : 0.4) : 0;
        if (r() < hueco) continue;
        let i = luz < -0.55 ? 0 : luz < 0.05 ? 1 : luz < 0.55 ? 2 : 3;
        if (mejor > 0.8) i++;
        i += f === 3 ? 1 : 0;
        a.pon(x, y, cols[Math.min(4, i)]);
      }
      out.push(a);
    }
    return out;
  }
  registrar('humo', humoFrames(), { contorno: '#3a3a4a55' });

  // Explosión 16×16, 4 frames (extra): fogonazo blanco → bola amarilla/naranja → anillo que se apaga en gris
  function explosionFrames() {
    const fuego = ['#ffffff', '#fff6b5', '#ffd84a', '#ffaa2e', '#f47c22'];
    const radios = [4.6, 6.4, 7.6, 7.9];
    const out = [];
    for (let f = 0; f < 4; f++) {
      const a = new Arte(16, 16);
      const r = azar(81 + f);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
        const ang = Math.atan2(dy, dx);
        const R = radios[f] * (0.84 + 0.16 * Math.sin(ang * 6 + f * 1.3));
        const d = Math.hypot(dx, dy) / R;
        if (d > 1) continue;
        let c;
        if (f === 0) c = d < 0.55 ? fuego[0] : d < 0.85 ? fuego[1] : fuego[2];
        else if (f === 1) c = d < 0.35 ? fuego[0] : d < 0.6 ? fuego[1] : d < 0.85 ? fuego[2] : fuego[3];
        else if (f === 2) { if (r() < 0.08) continue; c = d < 0.3 ? fuego[1] : d < 0.6 ? fuego[2] : d < 0.85 ? fuego[3] : fuego[4]; }
        else { if (d < 0.5 || r() < 0.3) continue; c = d < 0.7 ? fuego[3] : d < 0.85 ? '#c9a07a' : '#a8a8a8'; }
        a.pon(x, y, c);
      }
      out.push(a);
    }
    return out;
  }
  registrar('explosion', explosionFrames());

  // Bazooka 16×7 (icono, apunta a la derecha)
  registrar('bazooka', [new Arte(16, 7).mapa([
    'kk.......ss...OO',
    'kkLLLLLLLLLLLLOo',
    'kkGGGGGGGGGGGGOo',
    'kkggggggggggggOo',
    'kk....mm.m....OO',
    '......mm.m......',
    '......mm........',
  ], { k: '#33363d', L: '#9aa3ad', G: '#6c7480', g: '#4b525c', O: '#e0622b', o: '#b0461c', m: '#6e4a2a', s: '#26282d' }, 0, 0)], { contorno: '#1b1424a0' });

  // Corazón 9×9 (0 lleno, 1 vacío)
  const corazonM = [
    '.KK...KK.',
    'KhRK.KRRK',
    'KhRRKRRRK',
    'KRRRRRRRK',
    'KRRRRRRrK',
    '.KRRRRrK.',
    '..KRRrK..',
    '...KrK...',
    '....K....',
  ];
  registrar('corazon', [
    new Arte(9, 9).mapa(corazonM, { K: '#3b0c0c', R: '#e3262c', r: '#a5161b', h: '#ff9e9e' }, 0, 0),
    new Arte(9, 9).mapa(corazonM, { K: '#3b0c0c', R: '#5a4646', r: '#463434', h: '#6e5a5a' }, 0, 0),
  ]);

  // Viento 16×9 (flecha a la derecha; voltear = viento a la izquierda)
  registrar('viento', [new Arte(16, 9).mapa([
    '..........W.....',
    '..........WW....',
    'bb..bbb...WWW...',
    '....WWWWWWWWWW..',
    'bbb.WWWWWWWWWWW.',
    '....WWWWWWWWWW..',
    'bb..bbb...WWB...',
    '..........WB....',
    '..........B.....',
  ], { W: '#ffffff', B: '#bfe1ff', b: '#e8f5ff' }, 0, 0)], { contorno: '#2a5a8acc' });

  // ================================================================ BLOQUES 16×16
  // Ruido con grumos (cada píxel mira a sus vecinos, con vuelta: la textura enlaza bien)
  function ruido(semilla, grumo) {
    const r = azar(semilla);
    let v = [];
    for (let i = 0; i < 256; i++) v.push(r());
    for (let pasada = 0; pasada < (grumo || 0); pasada++) {
      const n = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const g = (dx, dy) => v[((y + dy + 16) % 16) * 16 + ((x + dx + 16) % 16)];
        n.push(g(0, 0) * 0.4 + (g(1, 0) + g(-1, 0) + g(0, 1) + g(0, -1)) * 0.15);
      }
      v = n;
    }
    // normalizar 0..1
    let mn = 1, mx = 0;
    v.forEach((x) => { mn = Math.min(mn, x); mx = Math.max(mx, x); });
    return v.map((x) => (x - mn) / (mx - mn || 1));
  }
  const elegir = (paleta, t) => paleta[Math.min(paleta.length - 1, Math.floor(t * paleta.length))];

  function tierraArte(semilla) {
    const a = new Arte(16, 16);
    const pal = ['#5f3c1c', '#73491f', '#7f5228', '#8b5d30', '#986a3a', '#a87a48'];
    const n = ruido(semilla, 1), m = azar(semilla + 5);
    for (let i = 0; i < 256; i++) {
      let c = elegir(pal, n[i] * 0.85 + m() * 0.15);
      a.p[i] = c;
    }
    // piedrecitas
    const r = azar(semilla + 9);
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      a.pon(x, y, '#8c8070'); a.pon(x + 1, y, '#6f6555');
    }
    return a;
  }
  function hierbaArte() {
    const a = tierraArte(21);
    const verdes = ['#3d8a28', '#4c9c32', '#5aae3b', '#69bf45'];
    const caida = [3, 4, 3, 2, 3, 5, 4, 3, 3, 4, 2, 3, 5, 3, 4, 3];
    const r = azar(4);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < caida[x]; y++) {
        let c = elegir(verdes, r() * 0.7 + (y === 0 ? 0.3 : 0.1));
        if (y === caida[x] - 1) c = '#3a7f26';
        if (y === 0) c = r() < 0.5 ? '#74cb4f' : '#66bc45';
        a.pon(x, y, c);
      }
    }
    return a;
  }
  function piedraArte() {
    const a = new Arte(16, 16);
    const pal = ['#6e6e6e', '#7b7b7b', '#868686', '#8f8f8f', '#999999', '#a4a4a4'];
    const n = ruido(11, 2), m = azar(12);
    for (let i = 0; i < 256; i++) a.p[i] = elegir(pal, n[i] * 0.7 + m() * 0.3);
    // vetas: trazos cortos oscuros con un brillo encima (la piedra "de siempre")
    const r = azar(13);
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(r() * 16), y = 1 + Math.floor(r() * 15), largo = 2 + Math.floor(r() * 2);
      for (let i = 0; i < largo; i++) {
        const xx = (x + i) % 16;
        a.pon(xx, y, '#6c6c6c');
        if (i === 0 && r() < 0.6) a.pon(xx, y - 1, '#a6a6a6');
      }
    }
    return a;
  }
  function arenaArte() {
    const a = new Arte(16, 16);
    const pal = ['#cdbf7e', '#d8cb8c', '#e0d398', '#e7dca4', '#eee5b4'];
    const n = ruido(41, 1), m = azar(42);
    for (let i = 0; i < 256; i++) a.p[i] = elegir(pal, n[i] * 0.5 + m() * 0.5);
    const r = azar(43);
    for (let k = 0; k < 6; k++) a.pon(Math.floor(r() * 16), Math.floor(r() * 16), k % 2 ? '#c2b26c' : '#f6efc8');
    return a;
  }
  function maderaArte() { // tronco: corteza con vetas verticales y grietas
    const a = new Arte(16, 16);
    const r = azar(51);
    const tonos = ['#3d2813', '#503517', '#634220', '#76512a', '#8a6234'];
    const veta = [2, 1, 3, 2, 1, 3, 3, 1, 2, 3, 1, 2, 3, 2, 1, 3];
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
      let t = veta[x];
      if (r() < 0.15) t = Math.max(1, Math.min(4, t + (r() < 0.5 ? -1 : 1)));
      a.pon(x, y, tonos[t]);
    }
    // grietas oscuras y brillos (enlazan de arriba abajo)
    [[1, 2, 6], [4, 9, 5], [7, 0, 4], [10, 5, 7], [13, 11, 6], [15, 1, 4]].forEach(([x, y0, l]) => {
      for (let i = 0; i < l; i++) a.pon(x, (y0 + i) % 16, tonos[0]);
    });
    [[3, 4, 3], [8, 10, 4], [12, 2, 3]].forEach(([x, y0, l]) => {
      for (let i = 0; i < l; i++) a.pon(x, (y0 + i) % 16, tonos[4]);
    });
    return a;
  }
  function maderaCorteArte() { // tronco cortado: anillos y corteza alrededor
    const a = new Arte(16, 16);
    const anillos = ['#b8924f', '#a07d40', '#b8924f', '#c9a462', '#a07d40', '#b8924f'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
      const d = Math.pow(Math.pow(dx, 3) + Math.pow(dy, 3), 1 / 3);
      let c = anillos[Math.min(5, Math.floor(d / 1.3))];
      if (d < 1.2) c = '#8a6a34';
      if (x === 0 || y === 0 || x === 15 || y === 15) c = (x + y) % 3 ? '#503517' : '#634220';
      a.pon(x, y, c);
    }
    return a;
  }
  function hojasArte() {
    const a = new Arte(16, 16);
    const pal = ['#25611b', '#2f7423', '#3b8a2b', '#4aa035', '#5cb743'];
    const n = ruido(61, 1), m = azar(62);
    for (let i = 0; i < 256; i++) {
      const t = n[i] * 0.6 + m() * 0.4;
      a.p[i] = t < 0.16 ? '#173f12' : elegir(pal, (t - 0.16) / 0.84);
    }
    return a;
  }
  function aguaArte(f) {
    const a = new Arte(16, 16);
    const base = ['#2f5fc4dd', '#3a6fd6dd', '#4a80e2dd', '#6b9ff0dd', '#a6c9ffdd'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const t = 0.5 + 0.25 * Math.sin((x + f * 4) / 16 * Math.PI * 2 + y * 0.9) + 0.2 * Math.sin((y + f * 2) / 16 * Math.PI * 4);
      a.pon(x, y, elegir(base, Math.max(0, Math.min(0.99, t * 0.8))));
    }
    // brillos
    const r = azar(71 + f);
    for (let k = 0; k < 3; k++) {
      const x = Math.floor(r() * 14), y = Math.floor(r() * 16);
      a.pon(x, y, base[4]); a.pon(x + 1, y, base[4]);
    }
    return a;
  }

  registrar('hierba', [hierbaArte()]);
  registrar('tierra', [tierraArte(3)]);
  registrar('piedra', [piedraArte()]);
  registrar('arena', [arenaArte()]);
  registrar('madera', [maderaArte()]);
  registrar('hojas', [hojasArte()]);
  registrar('agua', [aguaArte(0), aguaArte(1), aguaArte(2), aguaArte(3)]);
  registrar('madera_corte', [maderaCorteArte()]);

  const BLOQUES = ['hierba', 'tierra', 'piedra', 'arena', 'madera', 'hojas', 'agua'];

  // ================================================================ TEATRO (The Three Little Pigs)
  // Para js/teatro-escena.js. Más grande y redondo que el de la Batalla: las formas son elipses,
  // polígonos y cápsulas con la luz arriba a la izquierda; los detalles (ojos, cejas, boca), a mano.

  // ---------------------------------------------------------------- pinceles
  // col: un color o una función (nx, ny) → color, con nx, ny de -1 a 1 dentro de la forma
  function elipse(a, cx, cy, rx, ry, col) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) a.pon(x, y, typeof col === 'function' ? col(nx, ny) : col);
      }
    }
  }
  // Polígono relleno (por el centro de cada píxel). col: un color o una función (x, y) → color
  function poligono(a, pts, col) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const yc = y + 0.5, xs = [];
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      });
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) a.pon(x, y, typeof col === 'function' ? col(x, y) : col);
      }
    }
  }
  // Un trazo grueso con las puntas redondas (brazos, patas, cola, palos). col como en elipse()
  function capsula(a, x0, y0, x1, y1, r, col) {
    const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy || 1;
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
        const px = x + 0.5 - x0, py = y + 0.5 - y0;
        const t = Math.max(0, Math.min(1, (px * vx + py * vy) / l2));
        const dx = px - t * vx, dy = py - t * vy;
        if (dx * dx + dy * dy <= r * r) a.pon(x, y, typeof col === 'function' ? col(dx / r, dy / r) : col);
      }
    }
  }
  // Línea de 1 px (Bresenham)
  function raya(a, x0, y0, x1, y1, col) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let n = 0; n < 200; n++) {
      a.pon(x0, y0, col);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  const puntos = (a, lista, col) => lista.forEach((p) => a.pon(p[0], p[1], col));
  // Tres tonos con la luz arriba a la izquierda (para elipse y capsula)
  const luz = (claro, medio, oscuro) => (nx, ny) => {
    const l = -nx * 0.6 - ny * 0.8;
    return l > 0.45 ? claro : (l < -0.55 || (nx * nx + ny * ny > 0.82 && l < -0.05)) ? oscuro : medio;
  };
  const CONTORNO_TEATRO = '#2a1f2ee6';

  // ---------------------------------------------------------------- Lobo
  // Gris azulado con hocico crema y un pantalón vaquero con remiendo. Cabeza, cuerpo y cola van
  // aparte: la escena los junta (cabeza con su punto del cuello (12, 21) sobre el del cuerpo (17, 12);
  // cola con su raíz (16, 15) en el (11, 31) del cuerpo, detrás). Así la cabeza se mueve al hablar.
  const PL = {
    L: '#bcc3d2', G: '#8d96aa', g: '#687087', o: '#4d5368',
    C: '#f6ead4', c: '#dfcdab',
    N: '#28232e', n: '#8a8592',
    W: '#ffffff', P: '#231e2b', B: '#363a4b',
    R: '#ef97aa', r: '#c56c82', M: '#4e1a29', T: '#f2758f', t: '#cf5470', D: '#fffbf0', K: '#f7a2b2',
    A: '#4f7bcc', a: '#3c60a6', z: '#2c4882', Q: '#f2c450', q: '#8a5a2b', E: '#9fd8ff',
  };
  const CARAS_LOBO = ['normal', 'triste', 'feliz', 'agotado', 'mofletes', 'soplar', 'parpadeo'];
  const POSES_LOBO = ['recto', 'llamar', 'cansado', 'contento', 'soplar'];

  function loboCabeza(cara, boca) {
    const P = PL, a = new Arte(32, 27);
    const pelo = luz(P.L, P.G, P.g);
    const gachas = cara === 'triste' || cara === 'agotado';
    const inflado = cara === 'mofletes' ? 2 : cara === 'soplar' ? 1 : 0;
    if (cara === 'agotado') boca = Math.max(1, boca); // jadea: siempre con la boca abierta
    if (inflado) boca = 0;
    // Oreja de detrás (más oscura). Gachas: tumbadas hacia atrás
    if (gachas) { poligono(a, [[8, 6], [0.5, 12], [2.5, 14], [8.5, 9.5]], P.g); poligono(a, [[7, 7.5], [2, 12], [3, 12.8], [7.5, 9.2]], P.r); }
    else { poligono(a, [[5.5, -0.5], [2, 10], [11.5, 8]], P.g); poligono(a, [[6, 2.6], [4, 9], [9.4, 8]], P.r); }
    // La cabeza: un óvalo con mechones abajo, la mejilla crema
    elipse(a, 12.5, 13.2, 10.2, 9, pelo);
    puntos(a, [[5, 21], [6, 22], [8, 22], [9, 23], [11, 22], [12, 23], [13, 22]], P.g);
    puntos(a, [[2, 15], [2, 17], [1, 16]], P.G);
    elipse(a, 15.5, 18.6, 4.6, 3.2, (nx, ny) => (ny > 0.5 ? P.c : P.C));
    // Oreja de delante
    if (gachas) {
      poligono(a, [[17, 4.5], [10.5, 3.8], [3.5, 8.5], [5, 10], [10.5, 8]], (x, y) => (y < 6 ? P.L : P.G));
      poligono(a, [[15, 5.2], [10.5, 5], [6, 8], [10, 7.4]], P.R);
    } else {
      poligono(a, [[16.5, -1], [10.5, 8.5], [21, 7.5]], (x) => (x < 15 ? P.L : P.G));
      poligono(a, [[16.2, 2.2], [13, 7.8], [18.8, 7.5]], (x, y) => (y > 6 ? P.r : P.R));
    }
    if (!gachas) puntos(a, [[9, 5], [10, 4], [11, 5], [12, 3], [13, 4]], P.L); // mechón de la frente
    // Hocico: arriba pelo, abajo la mandíbula crema (baja al abrir la boca)
    const baja = [0, 2, 4][boca];
    poligono(a, [[15.5, 9.5], [28.5, 10.5], [31.6, 12.6], [31, 15.6], [29, 16.6], [17, 17], [15, 14]],
      (x, y) => (y < 11.5 ? P.L : y > 15.5 ? P.g : P.G));
    if (baja) {
      poligono(a, [[16.5, 16.2], [30.2, 15.8], [29.4, 16.8 + baja * 0.75], [17, 17.8 + baja]], P.M); // dentro de la boca
      elipse(a, 23.5, 17.4 + baja * 0.8, 3.8, 1.3 + baja * 0.2, P.T); // la lengua
      puntos(a, [[20, 17], [26, 17], [28, 16]], P.D); // colmillos de arriba
      if (boca === 2) puntos(a, [[20, 18], [26, 18]], P.D);
    }
    poligono(a, [[17, 17 + baja], [29.4, 16.6 + baja * 0.75], [26.8, 19.6 + baja * 0.8], [19.4, 20.6 + baja]], (x, y) => (y > 19 + baja ? P.c : P.C));
    if (!baja && !inflado) {
      // Boca cerrada: la raya, con la comisura según la cara, y un colmillo asomando
      raya(a, 18, 17, 28, 16, P.M);
      if (cara === 'triste') puntos(a, [[17, 18], [17, 17]], P.M);
      else puntos(a, [[17, 16], [16, 15]], P.M);
      if (cara !== 'triste') a.pon(25, 17, P.D);
    }
    elipse(a, 29.8, 12.4, 2.1, 1.7, P.N); // la nariz
    puntos(a, [[29, 11], [30, 11]], P.n);
    // Mofletes inflados (huff) o soplando (puff): un globo de pelo que tapa la base del hocico
    if (inflado) {
      const r = inflado === 2 ? 6.2 : 4.4;
      elipse(a, 20.5, 16.8, r, r * 0.86, luz(P.L, P.G, P.g));
      puntos(a, inflado === 2 ? [[17, 13], [18, 13], [19, 13], [16, 14], [17, 14]] : [[18, 14], [19, 14]], '#dfe4ee'); // brillo
      if (inflado === 2) { puntos(a, [[21, 19], [22, 19], [23, 19], [20, 20], [21, 20], [22, 20]], P.K); raya(a, 27, 16, 29, 16, P.M); }
      else { elipse(a, 30.4, 15.6, 1.6, 1.5, P.R); a.pon(30, 15, P.M); a.pon(31, 15, P.M); a.pon(30, 16, P.M); } // labios en «o»
    }
    // Ojos y cejas
    const blanco = (cx, cy, rx, ry) => elipse(a, cx, cy, rx, ry, P.W);
    const pupila = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.pon(x + i, y + j, P.P); a.pon(x, y, P.W); };
    const ceja = (x0, y0, x1, y1) => { raya(a, x0, y0, x1, y1, P.B); raya(a, x0, y0 - 1, x1, y1 - 1, P.B); };
    if (cara === 'feliz') {
      puntos(a, [[11, 11], [12, 10], [13, 9], [14, 9], [15, 10], [16, 11]], P.B);
      puntos(a, [[18, 10], [19, 9], [20, 9], [21, 10]], P.B);
      ceja(11, 6, 15, 5); ceja(18, 5, 21, 6);
      puntos(a, [[12, 15], [13, 15], [14, 15], [11, 16], [12, 16], [13, 16]], P.K); // colorete
    } else if (cara === 'parpadeo' || cara === 'soplar') {
      if (cara === 'soplar') { // aprieta los ojos: > <
        puntos(a, [[11, 9], [12, 10], [13, 11], [12, 12], [11, 13]], P.B);
        puntos(a, [[21, 9], [20, 10], [19, 11], [20, 12], [21, 13]], P.B);
        ceja(10, 7, 15, 8); ceja(18, 8, 22, 7);
      } else {
        raya(a, 11, 11, 16, 11, P.B); raya(a, 18, 11, 21, 11, P.B);
        ceja(10, 6, 15, 7.5); ceja(18, 7.5, 22, 6);
      }
    } else {
      blanco(13.6, 10.6, 2.8, 3.3);
      blanco(19.7, 10.4, 2, 3.1);
      if (cara === 'triste') {
        pupila(13, 11, 2, 2); pupila(19, 11, 2, 2);
        raya(a, 11, 8, 16, 8, P.G); raya(a, 18, 8, 21, 8, P.G); // párpados un poco caídos
        ceja(10, 7, 15, 5); ceja(18, 5, 22, 7);
        puntos(a, [[12, 14], [12, 15], [11, 16], [12, 16], [13, 16], [11, 17], [12, 17], [13, 17], [12, 18]], P.E); // una lágrima
        a.pon(11, 16, '#ffffff');
      } else if (cara === 'agotado') {
        for (let x = 11; x <= 16; x++) for (let y = 7; y <= 10; y++) a.pon(x, y, P.G);
        for (let x = 18; x <= 21; x++) for (let y = 7; y <= 10; y++) a.pon(x, y, P.G);
        raya(a, 11, 10, 16, 10, P.B); raya(a, 18, 10, 21, 10, P.B);
        pupila(14, 11, 2, 2); pupila(20, 11, 1, 2);
        ceja(10, 6, 15, 8); ceja(18, 8, 22, 6);
        // la lengua fuera, colgando
        poligono(a, [[21.5, 18], [25.5, 18], [25.8, 23.5], [23.6, 25.6], [21.4, 23.8]], (x) => (x > 24 ? P.t : P.T));
        raya(a, 23.5, 19, 23.5, 23, P.t);
      } else if (cara === 'mofletes') {
        blanco(13.6, 10.4, 3, 3.5); blanco(19.8, 10.2, 2.2, 3.3);
        pupila(14, 10, 2, 2); pupila(20, 10, 1, 2);
        ceja(10, 6, 15, 8); ceja(18, 8, 22, 6); ceja(10, 5, 15, 7);
      } else {
        pupila(14, 9, 2, 3); pupila(20, 9, 2, 3);
        ceja(10, 6, 15, 7.5); ceja(18, 7.5, 22, 6);
      }
    }
    return a;
  }

  // Un brazo: hombro → codo → mano (la mano, una almohadilla redonda)
  function brazoLobo(a, h, c, m, pelo, mano) {
    capsula(a, h[0], h[1], c[0], c[1], 2.1, pelo);
    capsula(a, c[0], c[1], m[0], m[1], 1.9, pelo);
    elipse(a, m[0], m[1] + 0.6, 2.3, 2.1, mano);
  }
  function loboCuerpo(pose) {
    const P = PL, a = new Arte(38, 44);
    const pelo = luz(P.L, P.G, P.g), atras = luz(P.G, P.g, P.o);
    const caido = pose === 'cansado' ? 2 : 0;
    const brazos = {
      recto: [[[12, 17], [10, 22], [10.5, 27]], [[22, 17], [24.5, 22], [24, 27.5]]],
      llamar: [[[12, 17], [10, 22], [10.5, 27]], [[22, 17], [27.5, 21], [33, 19]]],
      cansado: [[[12, 19], [10.5, 25], [11.5, 31]], [[22, 19], [24.5, 25], [24.5, 31]]],
      contento: [[[12, 17], [7, 16.5], [2.8, 12.5]], [[22, 17], [28, 18], [33.5, 13.5]]],
      soplar: [[[12, 17], [6.5, 22], [10.5, 27.5]], [[22, 17], [28.5, 22], [24.5, 27.5]]],
    }[pose];
    // Brazo de detrás
    brazoLobo(a, ...brazos[0], atras, P.g);
    // Pierna y pie de detrás
    poligono(a, [[11, 33], [16.5, 33], [16.5, 40], [11.5, 40]], P.a);
    elipse(a, 13.6, 41.4, 4, 2, atras);
    // El tronco, la barriga crema y la pechera de mechones
    elipse(a, 17.5, 23 + caido, 8, 9, pelo);
    elipse(a, 19, 24 + caido, 4.8, 6.4, (nx, ny) => (ny > 0.55 ? P.c : P.C));
    poligono(a, [[13.5, 14 + caido], [22.5, 14 + caido], [21.5, 18 + caido], [20, 16.4 + caido], [18.4, 18.6 + caido],
      [16.8, 16.4 + caido], [15, 18 + caido]], P.C);
    // El pantalón (con cinturón y un remiendo) y la pierna de delante
    poligono(a, [[9.4, 29], [25.8, 29], [26.2, 35], [9, 35]], (x) => (x > 24 ? P.a : P.A));
    poligono(a, [[18, 34], [24.8, 34], [24.8, 40], [18.4, 40]], (x) => (x > 23 ? P.a : x < 19.5 ? P.z : P.A));
    raya(a, 18, 39, 24, 39, P.z);
    for (let x = 10; x <= 25; x++) a.pon(x, 29, P.q);
    puntos(a, [[19, 29], [20, 29]], P.Q);
    for (let y = 31; y <= 33; y++) for (let x = 20; x <= 22; x++) a.pon(x, y, (x + y) % 2 ? P.Q : '#e2ab35');
    puntos(a, [[19, 31], [19, 33], [23, 31], [23, 33]], P.q);
    raya(a, 17, 30, 17, 34, P.z); // la costura
    // Pie de delante, con los dedos
    elipse(a, 22.6, 41.3, 4.6, 2.1, pelo);
    puntos(a, [[25, 42], [26, 41]], P.g);
    // Brazo de delante
    brazoLobo(a, ...brazos[1], pelo, P.L);
    if (pose === 'llamar') puntos(a, [[34, 18], [35, 19], [34, 20]], P.g); // los nudillos
    return a;
  }

  function loboCola(f) {
    const P = PL, a = new Arte(18, 18);
    // Una cola tupida en forma de gota: de la raíz (16, 15) hacia atrás y arriba, con la punta crema.
    // En cada frame, girada un poco (el meneo)
    const ang = [0, -0.14, 0.14][f], cs = Math.cos(ang), sn = Math.sin(ang);
    const gira = ([x, y]) => [16 + (x - 16) * cs - (y - 15) * sn, 15 + (x - 16) * sn + (y - 15) * cs];
    const forma = [[16.5, 13], [12.5, 9.5], [8.5, 6], [4.5, 2.6], [1.2, 1.2], [2.4, 5], [4, 9.5], [7.2, 13.4], [11.5, 16.4], [16.5, 16.8]].map(gira);
    const corte = gira([6.2, 6.4]);
    poligono(a, forma, (x, y) => {
      const dx = x + 0.5 - 16, dy = y + 0.5 - 15;
      const u = dx * cs + dy * sn, v = -dx * sn + dy * cs; // a lo largo y a lo ancho de la cola
      if ((x - corte[0]) + (y - corte[1]) < 0) return v - u * 0.15 > 1.8 ? P.c : P.C; // la punta
      return v + u * 0.62 < -1.2 ? P.L : v + u * 0.62 > 2.2 ? P.g : P.G;
    });
    // unos mechones en el borde de abajo
    [[5, 10], [8, 13], [11, 15]].map(gira).forEach(([x, y]) => a.pon(x, y, P.o));
    return a;
  }

  registrar('lobo_cabeza', CARAS_LOBO.flatMap((c) => [0, 1, 2].map((b) => loboCabeza(c, b))), { contorno: CONTORNO_TEATRO });
  registrar('lobo_cuerpo', POSES_LOBO.map(loboCuerpo), { contorno: CONTORNO_TEATRO });
  registrar('lobo_cola', [0, 1, 2].map(loboCola), { contorno: CONTORNO_TEATRO });

  // ---------------------------------------------------------------- Cerditos
  // 20×26, mirando a la izquierda (hacia el lobo). 1: sombrero de paja y peto azul; 2: gorra y peto
  // verde; 3: casco de obra y peto rojo. Los pies en y = 25.
  const POSES_CERDITO = ['quieto', 'hablar', 'asustado', 'reir', 'correr1', 'correr2', 'parpadeo'];
  function cerditoArte(n, pose) {
    const a = new Arte(20, 26);
    const rosa = luz('#ffccd8', '#f7a2b7', '#de7a95');
    const ropa = [['#5a8fe0', '#3f6dbb', '#2f5496'], ['#58b85c', '#3f9444', '#2f7333'], ['#e8564a', '#c03b31', '#962b23']][n - 1];
    const corre = pose === 'correr1' ? 1 : pose === 'correr2' ? -1 : 0;
    const miedo = pose === 'asustado' || corre;
    // Patas (al correr, una adelante y otra atrás)
    [[7.5 - corre, 22], [12.5 + corre, 22]].forEach(([x, y]) => {
      capsula(a, x, y, x, y + 1.6, 1.4, '#f29ab0');
      a.pon(Math.round(x - 1), 25, '#6b3a46'); a.pon(Math.round(x), 25, '#6b3a46');
    });
    // Rabito en espiral, detrás
    puntos(a, [[17, 18], [18, 17], [19, 18], [18, 19]], '#e98aa3');
    // Cuerpo: camiseta rosa (la piel) arriba y el peto
    elipse(a, 10, 19.2, 6.2, 5, (nx, ny) => (ny > -0.1 ? (nx > 0.55 ? ropa[1] : ropa[0]) : rosa(nx, ny)));
    raya(a, 6, 15, 7, 18, ropa[2]); raya(a, 14, 15, 13, 18, ropa[2]); // los tirantes
    puntos(a, [[7, 18], [13, 18]], '#ffd54a');
    a.pon(10, 21, ropa[2]); a.pon(10, 22, ropa[2]);
    // Bracitos (con miedo, arriba)
    const by = miedo ? 13.5 : 17.5;
    capsula(a, 4.5, 17, 3 - (miedo ? 1 : 0), by + 1, 1.7, '#f7a2b7');
    capsula(a, 15.5, 17, 17 + (miedo ? 1 : 0), by + 1, 1.7, '#e98aa3');
    // Cabeza, orejas y hocico
    poligono(a, [[4.5, 4], [1.5, 9], [7.5, 6.5]], '#e88aa2');
    poligono(a, [[15.5, 4], [18.5, 8.5], [12.5, 6.5]], '#e88aa2');
    elipse(a, 10, 10.8, 7.4, 6.6, rosa);
    puntos(a, [[3, 8], [4, 7], [16, 7], [17, 8]], '#c45d7a');
    // el hocico: un óvalo de 5×4 con los dos agujeros
    puntos(a, [[5, 10], [6, 10], [7, 10], [4, 11], [8, 11], [4, 12], [8, 12], [4, 13], [8, 13], [5, 14], [6, 14], [7, 14]], '#c95a78');
    puntos(a, [[5, 11], [6, 11], [7, 11]], '#ffc2d1');
    puntos(a, [[6, 12], [5, 13], [6, 13], [7, 13]], '#f07f9d');
    puntos(a, [[5, 12], [7, 12]], '#6e2440');
    elipse(a, 13.2, 13.4, 1.6, 1, '#ff8fab'); // colorete
    // Ojos y boca según la pose
    const ojo = (x, y) => { a.pon(x, y, '#2a1a22'); a.pon(x + 1, y, '#2a1a22'); a.pon(x, y + 1, '#2a1a22'); a.pon(x + 1, y + 1, '#2a1a22'); a.pon(x, y, '#ffffff'); };
    if (pose === 'reir' || pose === 'parpadeo') {
      const arco = pose === 'reir';
      puntos(a, arco ? [[4, 9], [5, 8], [6, 9]] : [[4, 9], [5, 9], [6, 9]], '#2a1a22');
      puntos(a, arco ? [[10, 9], [11, 8], [12, 9]] : [[10, 9], [11, 9], [12, 9]], '#2a1a22');
    } else if (miedo) {
      elipse(a, 5.5, 8.5, 1.8, 2.1, '#ffffff'); elipse(a, 11.5, 8.5, 1.8, 2.1, '#ffffff');
      a.pon(5, 9, '#2a1a22'); a.pon(11, 9, '#2a1a22');
      puntos(a, [[16, 4], [16, 5], [17, 6]], '#9fd8ff'); // una gota de sudor
    } else { ojo(5, 8); ojo(11, 8); }
    if (pose === 'reir') {
      puntos(a, [[4, 16], [5, 16], [6, 16], [7, 16], [8, 16], [5, 17], [6, 17], [7, 17]], '#7a2238');
      puntos(a, [[6, 17], [7, 17]], '#f2758f');
    } else if (pose === 'hablar' || miedo) {
      puntos(a, [[5, 16], [6, 16], [7, 16], [5, 17], [6, 17], [7, 17]], '#7a2238');
      a.pon(6, 17, '#f2758f');
    } else puntos(a, [[4, 16], [5, 17], [6, 17], [7, 17], [8, 16]], '#a3405d');
    // Lo de la cabeza
    if (n === 1) { // sombrero de paja con cinta roja
      elipse(a, 10.6, 3.2, 4.4, 2.8, luz('#f8df86', '#e8bd45', '#c8962a'));
      elipse(a, 10, 5.4, 8.6, 1.5, luz('#fbe597', '#f0cb5a', '#cc9b32'));
      raya(a, 7, 4, 14, 4, '#d9473f');
      puntos(a, [[4, 6], [16, 6], [9, 2], [12, 1]], '#c8962a');
    } else if (n === 2) { // gorra con visera (hacia el lobo)
      elipse(a, 11, 5, 6.3, 3.6, (nx, ny) => (ny > 0.35 ? null : nx < -0.3 && ny < -0.2 ? '#7fd081' : '#3f9444'));
      poligono(a, [[1.5, 6], [8, 4.5], [8, 6.5], [2.5, 7.2]], '#2f7333');
      a.pon(11, 2, '#7fd081');
    } else { // casco de obra
      elipse(a, 10.5, 5.6, 6.9, 4.4, (nx, ny) => (ny > 0.15 ? null : nx < -0.25 && ny < -0.35 ? '#ffe68a' : '#f6c431'));
      raya(a, 3, 6, 18, 6, '#d99b13');
      raya(a, 10, 2, 10, 5, '#ffe68a');
    }
    return a;
  }
  [1, 2, 3].forEach((n) => registrar('cerdito' + n, POSES_CERDITO.map((p) => cerditoArte(n, p)), { contorno: CONTORNO_TEATRO }));

  // ---------------------------------------------------------------- Casas
  // Paredes y tejado por separado: el tejado sale volando (tejado_paja, tejado_palos) y el frame 1
  // de la casa es sin tejado. La puerta, a la izquierda (donde llama el lobo). El suelo, en la última fila.
  function tejadoPaja() {
    const a = new Arte(50, 26), r = azar(201);
    const cols = ['#f6d77e', '#e8bd4f', '#d6a63c', '#b98a2e'];
    poligono(a, [[1, 25], [10, 9], [18, 3], [25, 1.2], [32, 3], [40, 9], [49, 25]], (x, y) => {
      const fila = (y + Math.floor(Math.abs(x - 25) / 3)) % 5;
      const v = r();
      return fila === 4 ? cols[3] : v < 0.18 ? cols[0] : v < 0.32 ? cols[2] : (x < 20 && y < 14 ? cols[0] : cols[1]);
    });
    // los flecos de abajo, de pajitas sueltas
    for (let x = 1; x < 49; x++) if (r() < 0.6) a.pon(x, 25, cols[r() < 0.5 ? 1 : 3]);
    puntos(a, [[24, 0], [25, 0], [26, 1]], cols[3]);
    return a;
  }
  function casaPaja(conTejado) {
    const a = new Arte(50, 46), r = azar(202);
    const cols = ['#f3d27a', '#e6bb52', '#cfa03f', '#a87a2a'];
    // Paredes: haces de paja atados
    for (let y = 21; y < 46; y++) for (let x = 6; x < 44; x++) {
      const v = r(), atado = (y - 21) % 6 === 5;
      a.pon(x, y, atado ? (x % 4 === 0 ? cols[3] : cols[2]) : v < 0.2 ? cols[0] : v < 0.33 ? cols[2] : x < 9 ? cols[2] : cols[1]);
    }
    for (let y = 21; y < 46; y++) { a.pon(6, y, cols[3]); a.pon(43, y, cols[3]); }
    // Puerta redonda de madera y ventana
    poligono(a, [[11, 46], [11, 34], [13, 31], [16, 30], [19, 31], [21, 34], [21, 46]], (x) => (x % 3 === 0 ? '#6b4423' : '#8a5a2f'));
    a.pon(19, 39, '#f2c450');
    for (let y = 28; y <= 35; y++) for (let x = 28; x <= 37; x++) {
      const borde = x === 28 || x === 37 || y === 28 || y === 35, cruz = x === 32 || x === 33 || y === 31;
      a.pon(x, y, borde || cruz ? '#8a5a2f' : (y > 33 ? '#f0b648' : '#ffd77a'));
    }
    puntos(a, [[29, 29], [30, 29], [29, 30]], '#fff2c2');
    if (conTejado) {
      const t = tejadoPaja();
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) { const c = t.toma(x, y); if (c) a.pon(x, y, c); }
    }
    return a;
  }
  function tejadoPalos() {
    const a = new Arte(50, 27), r = azar(301);
    poligono(a, [[0.5, 26], [25, 1.5], [49.5, 26]], (x, y) => {
      const d = (x + y * 1.2) % 5;
      return d < 1 ? '#5b391c' : d < 1.8 ? '#a8743f' : r() < 0.15 ? '#8f6234' : '#7a4f27';
    });
    for (let x = 1; x < 49; x++) a.pon(x, 26, '#5b391c');
    // ramitas que sobresalen y unas hojas arriba
    raya(a, 22, 1, 19, -1, '#5b391c'); raya(a, 27, 1, 31, 0, '#5b391c');
    elipse(a, 25, 2.5, 3, 1.8, luz('#8fd672', '#5aa84f', '#3f7f3a'));
    elipse(a, 20.5, 4, 1.8, 1.3, '#5aa84f');
    return a;
  }
  function casaPalos(conTejado) {
    const a = new Arte(50, 48), r = azar(302);
    const cols = ['#b5844d', '#9c6b3c', '#85582f', '#6e4524'];
    // Paredes: palos de pie, de 2-3 px, con nudos
    let x = 6;
    while (x < 44) {
      const w = 2 + (r() < 0.5 ? 1 : 0), c = cols[Math.floor(r() * 3)], arriba = 23 + Math.floor(r() * 3);
      for (let i = 0; i < w && x + i < 44; i++) for (let y = arriba; y < 48; y++) a.pon(x + i, y, i === w - 1 ? cols[3] : c);
      if (r() < 0.5) a.pon(x, 30 + Math.floor(r() * 12), cols[3]);
      x += w;
    }
    // Dos travesaños atados
    [31, 41].forEach((y) => { for (let i = 5; i < 45; i++) { a.pon(i, y, '#c99560'); a.pon(i, y + 1, cols[3]); } });
    // Puerta de tablas y ventana
    for (let y = 33; y < 48; y++) for (let i = 11; i <= 20; i++) a.pon(i, y, i === 11 || i === 20 ? '#4d2f17' : (i % 3 === 0 ? '#5b391c' : '#74482a'));
    raya(a, 12, 46, 19, 35, '#4d2f17');
    a.pon(18, 40, '#f2c450');
    for (let y = 29; y <= 36; y++) for (let i = 28; i <= 37; i++) {
      const borde = i === 28 || i === 37 || y === 29 || y === 36;
      a.pon(i, y, borde ? '#5b391c' : (y > 34 ? '#f0b648' : '#ffd77a'));
    }
    raya(a, 29, 32, 36, 33, '#85582f');
    puntos(a, [[29, 30], [30, 30]], '#fff2c2');
    if (conTejado) {
      const t = tejadoPalos();
      for (let y = 0; y < t.h; y++) for (let i = 0; i < t.w; i++) { const c = t.toma(i, y); if (c) a.pon(i, y, c); }
    }
    return a;
  }
  function casaLadrillos() {
    const a = new Arte(56, 52);
    // Chimenea (con su humo, que pone la escena)
    for (let y = 5; y < 18; y++) for (let x = 39; x <= 45; x++) a.pon(x, y, y === 5 ? '#8a8f9c' : (y % 3 === 2 ? '#e3d3bf' : (x + (y % 6 < 3 ? 0 : 3)) % 6 === 0 ? '#e3d3bf' : '#b8483a'));
    // Tejado de tejas
    poligono(a, [[0.5, 24], [28, 2.5], [55.5, 24]], (x, y) => (y % 3 === 0 ? '#5e3a46' : ((x + (y % 6 < 3 ? 0 : 2)) % 4 === 0 ? '#6f4553' : (x < 26 && y < 15 ? '#9b5b6c' : '#85505f'))));
    for (let x = 1; x < 55; x++) a.pon(x, 24, '#4d2f3a');
    // Paredes de ladrillo: filas de 3 (2 de ladrillo y 1 de cemento), alternadas
    for (let y = 25; y < 52; y++) for (let x = 4; x < 52; x++) {
      const fila = Math.floor((y - 25) / 3), junta = (y - 25) % 3 === 2 || (x + (fila % 2) * 3) % 6 === 0;
      if (junta) { a.pon(x, y, '#e6d6c2'); continue; }
      const v = azar(Math.floor((x + (fila % 2) * 3) / 6) * 31 + fila * 7)();
      a.pon(x, y, v < 0.25 ? '#d7664c' : v < 0.7 ? '#c2523c' : '#a9432f');
    }
    for (let y = 25; y < 52; y++) { a.pon(4, y, '#8e3727'); a.pon(51, y, '#8e3727'); }
    // Puerta azul con aldaba, escalón y ventana con flores
    for (let y = 34; y < 50; y++) for (let x = 12; x <= 21; x++) {
      const marco = x === 12 || x === 21 || y === 34;
      a.pon(x, y, marco ? '#f4efe6' : x < 14 ? '#5a8fd6' : '#3c6fb4');
    }
    puntos(a, [[16, 39], [17, 39], [16, 40], [17, 41], [16, 41]], '#f2c450');
    for (let x = 10; x <= 23; x++) { a.pon(x, 50, '#a9a9b5'); a.pon(x, 51, '#8a8a96'); }
    for (let y = 29; y <= 37; y++) for (let x = 31; x <= 42; x++) {
      const marco = x === 31 || x === 42 || y === 29 || y === 37 || x === 36 || y === 33;
      a.pon(x, y, marco ? '#f4efe6' : (x - y > 4 ? '#7fc0e8' : '#a9d9f4'));
    }
    puntos(a, [[32, 30], [33, 30], [32, 31]], '#ffffff');
    for (let x = 30; x <= 43; x++) { a.pon(x, 38, '#7a4e27'); a.pon(x, 39, '#5e3a1c'); }
    [31, 34, 37, 40, 43].forEach((x, i) => { a.pon(x, 37, i % 2 ? '#ff7aa8' : '#ff5a4f'); a.pon(x - 1, 37, '#5aa84f'); });
    return a;
  }
  registrar('casa_paja', [casaPaja(true), casaPaja(false)], { contorno: CONTORNO_TEATRO });
  registrar('casa_palos', [casaPalos(true), casaPalos(false)], { contorno: CONTORNO_TEATRO });
  registrar('casa_ladrillos', [casaLadrillos()], { contorno: CONTORNO_TEATRO });
  registrar('tejado_paja', [tejadoPaja()], { contorno: CONTORNO_TEATRO });
  registrar('tejado_palos', [tejadoPalos()], { contorno: CONTORNO_TEATRO });

  // Para las tarjetas de «¿Qué viene ahora?»: una puerta (llamar) y un trozo de pared de ladrillo (no puede)
  registrar('puerta', [(() => {
    const a = new Arte(14, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 14; x++) {
      const marco = x < 2 || x > 11 || y < 2;
      a.pon(x, y, marco ? (x === 0 || y === 0 ? '#e9ddc8' : '#cdbb9c') : x < 4 ? '#a06a3a' : (x % 3 === 0 ? '#74482a' : '#8a5a2f'));
    }
    puntos(a, [[9, 11], [10, 11], [9, 12], [10, 12]], '#f2c450');
    puntos(a, [[6, 6], [7, 6], [6, 7]], '#c08a52');
    return a;
  })()], { contorno: CONTORNO_TEATRO });
  registrar('muro', [(() => {
    const a = new Arte(18, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 18; x++) {
      const fila = Math.floor(y / 3), junta = y % 3 === 2 || (x + (fila % 2) * 3) % 6 === 0;
      const v = azar(Math.floor((x + (fila % 2) * 3) / 6) * 31 + fila * 7)();
      a.pon(x, y, junta ? '#e6d6c2' : v < 0.25 ? '#d7664c' : v < 0.7 ? '#c2523c' : '#a9432f');
    }
    return a;
  })()], { contorno: CONTORNO_TEATRO });

  // ---------------------------------------------------------------- Cielo
  registrar('nube', [(() => {
    const a = new Arte(24, 9);
    const blanca = (nx, ny) => (ny > 0.45 ? '#d8ecfb' : '#ffffff');
    elipse(a, 7, 6, 5.5, 3, blanca); elipse(a, 12.5, 4.5, 5.5, 4.4, blanca); elipse(a, 18, 6, 5.5, 3, blanca);
    return a;
  })()], { contorno: '#9cc7e888' });
  registrar('sol', [(() => {
    const a = new Arte(16, 16);
    [[8, 0], [8, 1], [8, 14], [8, 15], [0, 8], [1, 8], [14, 8], [15, 8], [2, 2], [3, 3], [13, 2], [12, 3], [2, 13], [3, 12], [13, 13], [12, 12]]
      .forEach(([x, y]) => a.pon(x, y, '#ffd23f'));
    elipse(a, 8, 8, 5.2, 5.2, luz('#fff3a6', '#ffd84a', '#f4b52a'));
    puntos(a, [[6, 7], [10, 7]], '#8a5a1c');
    puntos(a, [[6, 10], [7, 11], [8, 11], [9, 11], [10, 10]], '#c9772a');
    return a;
  })()]);

  // ================================================================ API
  const cacheTex = {};
  let nTex = 0;

  function sinSuavizado(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false; // Safari antiguo
  }

  function dibujar(ctx, nombre, x, y, escala, o) {
    let guardado = false;
    try {
      const s = REG[nombre];
      if (!s || !ctx || !hayDOM) return;
      o = o || {};
      escala = +escala > 0 ? +escala : 1;
      x = +x || 0; y = +y || 0;
      const alfa = o.alfa == null ? 1 : +o.alfa;
      if (!(alfa > 0)) return;
      const n = s.artes.length;
      let f = Math.floor(+o.frame || 0) % n;
      if (f < 0) f += n;
      const cv = canvasDe(s, f);
      const w = Math.max(1, Math.round(cv.width * escala)), h = Math.max(1, Math.round(cv.height * escala));
      let dx = Math.round(x - s.margen * escala), dy = Math.round(y - s.margen * escala);
      ctx.save();
      guardado = true;
      sinSuavizado(ctx);
      if (alfa < 1) ctx.globalAlpha *= alfa;
      if (o.voltear) { ctx.translate(dx + w, dy); ctx.scale(-1, 1); dx = 0; dy = 0; }
      ctx.drawImage(cv, dx, dy, w, h);
      const des = Math.min(1, +o.destello || 0);
      if (des > 0) {
        ctx.globalAlpha *= des;
        ctx.drawImage(blancoDe(s, f), dx, dy, w, h);
      }
    } catch (e) { /* un sprite nunca debe romper el juego */ }
    if (guardado) { try { ctx.restore(); } catch (e) { /* nada */ } }
  }

  function textura(tipo, tamPx, variante) {
    try {
      if (!hayDOM) return null;
      if (BLOQUES.indexOf(tipo) < 0 && tipo !== 'madera_corte') tipo = 'tierra';
      tamPx = Math.max(1, Math.min(1024, Math.round(+tamPx || 16)));
      variante = Math.abs(Math.floor(+variante || 0));
      const s = REG[tipo];
      const esAgua = tipo === 'agua';
      const f = esAgua ? variante % s.artes.length : 0;
      const espejo = !esAgua && variante % 2 === 1;
      const clave = tipo + '|' + tamPx + '|' + f + '|' + (espejo ? 1 : 0);
      if (cacheTex[clave]) return cacheTex[clave];
      if (nTex > 600) { for (const k in cacheTex) delete cacheTex[k]; nTex = 0; }
      const c = nuevoCanvas(tamPx, tamPx);
      const x = c.getContext('2d');
      sinSuavizado(x);
      if (espejo) { x.translate(tamPx, 0); x.scale(-1, 1); }
      x.drawImage(canvasDe(s, f), 0, 0, tamPx, tamPx);
      cacheTex[clave] = c;
      nTex++;
      return c;
    } catch (e) { return null; }
  }

  window.Sprites = {
    nombres: NOMBRES.slice(),
    bloques: BLOQUES.slice(),
    tam(nombre) { const s = REG[nombre]; return s ? { w: s.w, h: s.h } : { w: 16, h: 16 }; },
    frames(nombre) { const s = REG[nombre]; return s ? s.artes.length : 0; },
    dibujar,
    textura,
    listo: true,
  };
})();
