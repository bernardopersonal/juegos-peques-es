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
