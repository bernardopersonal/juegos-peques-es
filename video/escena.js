/* escena.js — dibuja el vídeo promocional de Juegos peques en un <canvas> 1280×720.
 *
 *   await window.cargar(timeline)   // carga imágenes y fuentes (Promise)
 *   window.pintar(t)                // dibuja el fotograma del segundo t (síncrono, determinista)
 *
 * Todo el arte (bloques, unicornio, mano, letras) es pixel-art propio generado aquí.
 * No usa Math.random ni Date: todo es función de t y de un hash fijo.
 *
 * Tipos de escena: 'titulo', 'capturas', 'final' y, para el vídeo de los días, 'tren' y 'cantinela'.
 * Todos los tiempos de escena son LOCALES (segundos desde e.inicio). Parámetros comunes opcionales:
 *   texto, textoHasta      subtítulo (y hasta cuándo se ve)
 *   velocidad              px/s del mundo (def. 78) o claves [[t, px/s], …]; negativo = el tren va a la izquierda
 *   habla: [[t0,t1],…]     intervalos en que habla el presentador (mueve la boca)
 *   presentador: {x, desde, escala}   presentador de cuerpo entero sobre el suelo
 *   facecam: true|{x,y}    "cámara del youtuber" con el presentador en una esquina
 *   megusta: {desde, toque, base}     botón de corazón con contador (la mano lo toca en `toque`)
 * timeline.dias: [{nombre, actividad, color, icono, cole}] ×7 (icono: uno de los de los días de ICONOS_DEF)
 * 'tren':
 *   llegadaLoco: t, llegadas: [t×7]   locomotora y vagones entran por la derecha (sin ellos: ya están)
 *   numeros: true, contador: true     número en cada vagón / contador grande "N VAGONES"
 *   foco: [{t, dias:[i…], dur?, etiqueta?}]  vagones que saltan y brillan (el último activo manda);
 *                                            con un día muestra arriba NOMBRE + actividad (etiqueta:false lo quita)
 *   camara: [{t, dias:[i…] | x, y?, zoom, dur}]  paneo/zoom suave (cada transición parte de la anterior completa)
 *   estacion: {t, cole, finde}         estación FIN DE SEMANA que queda bajo los vagones 5–6 cuando el mundo
 *                                      se para en t (frena con `velocidad`); cartel COLE sobre 0–4 en `cole`
 * 'cantinela':
 *   golpes: [{t, dia}]                 el vagón salta y destella y su nombre aparece en grande + tira de karaoke
 *   carteles: [{t, texto, dur, color}] carteles grandes ("¡MÁS RÁPIDO!")
 */
(() => {
  'use strict';
  const W = 1280, H = 720;
  const lienzo = document.getElementById('lienzo');
  const ctx = lienzo.getContext('2d');
  const FUENTE = '"Pixelify Sans", "Courier New", monospace';

  // ------------------------------------------------------------------ utilidades
  function hash(a, b = 0, c = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function prng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, k) => a + (b - a) * k;
  const suave = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const easeOutBack = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const R = Math.round;
  function lienzoNuevo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function mezclaColor(hex, k, hacia = '#ffffff') {
    const a = parseInt(hex.slice(1), 16), b = parseInt(hacia.slice(1), 16);
    const ch = (v, s) => (v >> s) & 255;
    const m = (s) => R(lerp(ch(a, s), ch(b, s), k));
    return '#' + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1);
  }

  // ------------------------------------------------------------------ texturas de bloques (16×16)
  const TEX = {};
  function textura(nombre, semilla, fn) {
    const c = lienzoNuevo(16, 16), g = c.getContext('2d'), r = prng(semilla);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    fn(px, r, g);
    TEX[nombre] = c;
  }
  const elige = (r, arr) => arr[Math.floor(r() * arr.length)];
  function tierra(px, r, y0 = 0) {
    for (let y = y0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = r();
      px(x, y, v < 0.15 ? '#6e4520' : v < 0.3 ? '#a06a38' : v < 0.34 ? '#8a8a8a' : '#875427');
    }
  }
  function piedra(px, r) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = r();
      px(x, y, v < 0.18 ? '#6d727b' : v < 0.32 ? '#a2a8b0' : '#888e97');
    }
  }
  function mena(px, r, c1, c2, c3) {
    piedra(px, r);
    const centros = [[3, 3], [10, 5], [5, 11], [12, 12]];
    for (const [cx, cy] of centros) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
      for (const [dx, dy] of pts) if (r() < 0.8) px(cx + dx, cy + dy, r() < 0.5 ? c1 : c2);
      px(cx, cy, c3);
    }
  }
  function crearTexturas() {
    textura('cesped', 11, (px, r) => {
      tierra(px, r, 0);
      for (let x = 0; x < 16; x++) {
        const fondo = 3 + Math.floor(r() * 3);
        for (let y = 0; y < fondo; y++) { const v = r(); px(x, y, v < 0.2 ? '#4caf2a' : v < 0.35 ? '#7fe04f' : '#62c93a'); }
        px(x, fondo, '#3f8f22');
      }
    });
    textura('tierra', 12, (px, r) => tierra(px, r));
    textura('piedra', 13, (px, r) => piedra(px, r));
    textura('diamante', 14, (px, r) => mena(px, r, '#5ef2ff', '#22c4d8', '#ffffff'));
    textura('oro', 15, (px, r) => mena(px, r, '#ffd84a', '#e0a400', '#fff6b0'));
    textura('amatista', 16, (px, r) => mena(px, r, '#ff7ad9', '#c84bd6', '#ffe0f6'));
    textura('tronco', 17, (px, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const raya = x % 4 === 0 || (x % 4 === 2 && r() < 0.3);
        px(x, y, raya ? '#4e3419' : r() < 0.2 ? '#7a5530' : '#6a4826');
      }
    });
    textura('hojas', 18, (px, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const v = r();
        px(x, y, v < 0.12 ? '#25701c' : v < 0.35 ? '#5cbf3c' : v < 0.4 ? '#7ad957' : '#3f9a2c');
      }
    });
    textura('ladrillo', 19, (px, r) => { // bloque "arcoíris" para la cortina
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, r() < 0.2 ? '#b98bff' : '#a070f5');
    });
  }
  function bloque(nombre, x, y, s) { ctx.drawImage(TEX[nombre], R(x), R(y), s, s); }

  // ------------------------------------------------------------------ sprites de pixel-art
  const PAL_UNI = {
    W: '#ffffff', S: '#e4dcf7', s: '#cfc4ee', H: '#9c86e0', K: '#2d1b4e', Y: '#ffd23f', y: '#e09a00',
    E: '#2d1b4e', P: '#ff9ccf', L: '#ffffff', N: '#f0a0c8',
    r0: '#ff4d6d', r1: '#ff9f1c', r2: '#ffe03d', r3: '#4ade80', r4: '#38bdf8', r5: '#a78bfa',
  };
  const PAL_UNI_ROSA = Object.assign({}, PAL_UNI, { W: '#ffe3f1', S: '#ffc9e3', s: '#f5b0d4', H: '#e06fae', r0: '#a78bfa', r1: '#38bdf8', r2: '#4ade80', r3: '#ffe03d', r4: '#ff9f1c', r5: '#ff4d6d' });

  function construirUnicornio(frame, pal) {
    const GW = 46, GH = 42, OX = 4, OY = 6;
    const g = new Array(GW * GH).fill(null);
    const set = (x, y, c) => { x = R(x + OX); y = R(y + OY); if (x >= 0 && y >= 0 && x < GW && y < GH) g[y * GW + x] = c; };
    const get = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH ? g[y * GW + x] : null);
    const elipse = (cx, cy, rx, ry, c) => {
      for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) set(x, y, c);
      }
    };
    const disco = (cx, cy, r, c) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c); };
    const linea = (x0, y0, x1, y1, r, c) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1; for (let i = 0; i <= n; i++) disco(lerp(x0, x1, i / n), lerp(y0, y1, i / n), r, c); };
    const fase = frame * 1.6;

    // patas: cadera → casco
    const PATAS = [
      [[-6, 7.5], [-3, 8.5], [5, 7.5], [7, 6.5]],
      [[-1, 8.5], [2, 8.5], [-2, 8.5], [1, 8.5]],
      [[3, 7.5], [5, 7], [-5, 7], [-3, 8]],
      [[1, 8.5], [-2, 8.5], [2, 8.5], [-1, 8.5]],
    ][frame];
    const caderas = [[12, 21], [15, 22], [24, 21], [27, 22]];
    const pata = (i, col) => {
      const [hx, hy] = caderas[i], [dx, dy] = PATAS[i];
      const mx = hx + dx * 0.55 + (i < 2 ? 0.5 : -0.5), my = hy + dy * 0.5;
      linea(hx, hy, mx, my, 1.4, col);
      linea(mx, my, hx + dx, hy + dy - 1, 1.2, col);
      disco(hx + dx, hy + dy, 1.2, 'H');
      set(hx + dx - 1, hy + dy + 1, 'H'); set(hx + dx, hy + dy + 1, 'H'); set(hx + dx + 1, hy + dy + 1, 'H');
    };
    pata(0, 's'); pata(2, 's');
    // cola arcoíris
    for (let k = 5; k >= 0; k--) {
      for (let s = 0; s <= 1.0001; s += 0.03) {
        const x = 8 - 10 * s;
        const y = 14 + k * (0.9 + s * 0.6) + 6 * s * s + Math.sin(s * 5 + fase) * 1.4 * s;
        disco(x, y, 1.0, 'r' + k);
      }
    }
    // cuerpo, cuello y cabeza
    elipse(18, 18.5, 11, 6.2, 'W');
    linea(24, 17, 30, 9, 3.3, 'W');
    elipse(31.5, 7.5, 4.6, 3.6, 'W');
    elipse(35.6, 9.6, 3.0, 2.5, 'W');
    linea(29.2, 4, 29.8, 1.2, 0.8, 'W'); // oreja
    set(29.5, 2.5, 'N');
    // sombra de la barriga
    for (let y = 21; y < 26; y++) for (let x = 8; x < 30; x++) if (get(x + OX, y + OY) === 'W') set(x, y, 'S');
    pata(1, 'W'); pata(3, 'W');
    // crin arcoíris por el cuello
    const P0 = [29.5, 3.2], P1 = [20.5, 13.5];
    for (let k = 5; k >= 0; k--) {
      for (let s = 0; s <= 1.0001; s += 0.03) {
        const bx = lerp(P0[0], P1[0], s), by = lerp(P0[1], P1[1], s);
        const off = k * 1.15 + 0.4 + Math.sin(s * 7 + fase + k * 0.3) * 0.7;
        disco(bx - 0.75 * off, by - 0.55 * off + s * 1.5, 0.95, 'r' + k);
      }
    }
    set(31, 3, 'r0'); set(32, 3, 'r0'); set(31, 4, 'r1'); set(30, 4, 'r5'); // flequillo
    // cuerno dorado
    linea(32.6, 3.6, 35.4, -3.6, 0.8, 'Y');
    for (let i = 0; i < 4; i++) set(33 + i * 0.7, 2.6 - i * 1.8, 'y');
    // cara
    set(32, 7, 'E'); set(33, 7, 'E'); set(32, 8, 'E'); set(33, 8, 'E'); set(32, 7, 'L');
    set(34, 6, 'E');
    set(34, 10, 'P'); set(35, 10, 'P');
    set(37.5, 9, 's');
    set(36, 11.5, 's'); set(37, 11.3, 's');
    // contorno
    const fuera = [];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (g[y * GW + x]) continue;
      if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) fuera.push(y * GW + x);
    }
    for (const i of fuera) g[i] = 'K';
    const c = lienzoNuevo(GW, GH), cg = c.getContext('2d');
    for (let i = 0; i < g.length; i++) if (g[i]) { cg.fillStyle = pal[g[i]]; cg.fillRect(i % GW, Math.floor(i / GW), 1, 1); }
    // ancla: cascos (suelo) en la fila más baja con píxeles
    let pieY = 0;
    for (let i = 0; i < g.length; i++) if (g[i]) pieY = Math.max(pieY, Math.floor(i / GW) + 1);
    return { c, w: GW, h: GH, pieY, colaX: 8 + OX, colaY: 16 + OY, cuernoX: 35.4 + OX, cuernoY: -3.6 + OY };
  }

  const MANO = [
    '....KK.......',
    '...KWWK......',
    '...KWWK......',
    '...KWWK......',
    '...KWWKKK....',
    '...KWWKWWKKK.',
    '.KKKWWKWWKWWK',
    'KWWKWWWWWKWWK',
    'KWWWWWWWWWWWK',
    'KWWWWWWWWWWSK',
    '.KWWWWWWWWWSK',
    '.KWWWWWWWWSK.',
    '..KSWWWWWSSK.',
    '...KKKKKKKK..',
  ];
  function spriteDeMatriz(filas, pal) {
    const h = filas.length, w = filas[0].length, c = lienzoNuevo(w, h), g = c.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = filas[y][x]; if (pal[k]) { g.fillStyle = pal[k]; g.fillRect(x, y, 1, 1); } }
    return c;
  }

  // ------------------------------------------------------------------ fuente de bloques 5×7
  const GLIFOS = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    '!': ['##', '##', '##', '##', '##', '..', '##'],
    '¡': ['##', '..', '##', '##', '##', '##', '##'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    '¿': ['..#..', '.....', '..#..', '.#...', '#....', '#...#', '.###.'],
    '.': ['..', '..', '..', '..', '..', '..', '##'],
    ',': ['..', '..', '..', '..', '..', '.#', '#.'],
    ':': ['..', '##', '##', '..', '##', '##', '..'],
    '-': ['....', '....', '....', '####', '....', '....', '....'],
    "'": ['#', '#', '.', '.', '.', '.', '.'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
  };
  const ACENTOS = { 'Á': ['A', 'agudo'], 'É': ['E', 'agudo'], 'Í': ['I', 'agudo'], 'Ó': ['O', 'agudo'], 'Ú': ['U', 'agudo'], 'Ñ': ['N', 'tilde'], 'Ü': ['U', 'dieresis'] };
  const MARCAS = { agudo: ['...#.', '..#..'], tilde: ['.##.#', '#.##.'], dieresis: ['.....', '.#.#.'] };
  function glifo(ch) {
    ch = ch.toUpperCase();
    if (ACENTOS[ch]) {
      const [base, marca] = ACENTOS[ch];
      const g = GLIFOS[base], w = g[0].length;
      const m = MARCAS[marca].map((f) => (w === 5 ? f : f.slice(1, 1 + w)));
      return { filas: g, marca: m, w };
    }
    const g = GLIFOS[ch] || GLIFOS['?'];
    return { filas: g, marca: null, w: g[0].length };
  }
  // devuelve lista de celdas {x,y,letra} en unidades de celda para un texto (varias líneas)
  function maquetarBloques(texto, anchoMax, celdaMax) {
    const palabras = texto.toUpperCase().split(/\s+/).filter(Boolean);
    const anchoPal = (p) => [...p].reduce((s, ch) => s + glifo(ch).w + 1, 0) - 1;
    let celda = celdaMax, lineas;
    // preferimos una sola línea si cabe sin encoger demasiado las celdas
    const todo = palabras.join(' ');
    const celda1 = Math.floor(anchoMax / anchoPal(todo));
    if (palabras.length < 2 || celda1 >= Math.round(celdaMax * 0.75)) { celda = Math.min(celdaMax, celda1); lineas = [todo]; }
    else for (;;) {
      lineas = []; let actual = '';
      for (const p of palabras) {
        const prueba = actual ? actual + ' ' + p : p;
        if (actual && anchoPal(prueba) * celda > anchoMax) { lineas.push(actual); actual = p; } else actual = prueba;
      }
      if (actual) lineas.push(actual);
      const maxW = Math.max(...lineas.map(anchoPal));
      if ((maxW * celda <= anchoMax && lineas.length <= 3) || celda <= 8) break;
      celda -= 1;
    }
    const acento = /[ÁÉÍÓÚÑÜ]/i.test(texto);
    const altoLinea = acento ? 10 : 9;
    const celdas = [];
    let letra = 0;
    lineas.forEach((ln, li) => {
      const anchoLn = anchoPal(ln);
      let x = -anchoLn / 2;
      const y0 = li * altoLinea + (acento ? 2 : 0);
      for (const ch of ln) {
        const g = glifo(ch);
        if (ch !== ' ') {
          g.filas.forEach((f, fy) => { for (let fx = 0; fx < g.w; fx++) if (f[fx] === '#') celdas.push({ x: x + fx, y: y0 + fy, letra, fila: fy }); });
          if (g.marca) g.marca.forEach((f, fy) => { for (let fx = 0; fx < g.w; fx++) if (f[fx] === '#') celdas.push({ x: x + fx, y: y0 - 2 + fy, letra, fila: -2 + fy }); });
          letra++;
        }
        x += g.w + 1;
      }
    });
    const alto = lineas.length * altoLinea - (altoLinea - 7) + (acento ? 2 : 0);
    return { celdas, celda, alto, nLetras: letra, lineas: lineas.length };
  }

  const ARCOIRIS = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#4ade80', '#38bdf8', '#8b7bff', '#e879f9'];

  // Dibuja un texto de bloques que cae letra a letra.
  // tl: tiempo local desde que empieza a caer. opts: {cx, cy, anchoMax, celdaMax, retardo, brillo}
  function textoBloques(texto, tl, o) {
    const m = maquetarBloques(texto, o.anchoMax || 1100, o.celdaMax || 26);
    const c = m.celda, x0 = o.cx, y0 = o.cy - (m.alto * c) / 2;
    const retardo = o.retardo || 0.16;
    const sombra = Math.max(3, R(c * 0.22));
    // pasada 1: sombras, pasada 2: bloques
    for (let pasada = 0; pasada < 2; pasada++) {
      for (const cel of m.celdas) {
        const inicio = cel.letra * retardo + (6 - cel.fila) * 0.025 + hash(cel.x * 7 + 3, cel.y) * 0.05;
        const k = (tl - inicio) / 0.45;
        if (k <= 0) continue;
        let dy;
        if (k < 1) { dy = -(1 - k * k) * 520; } else {
          const kb = (tl - inicio - 0.45);
          dy = -Math.abs(Math.sin(kb * 14)) * 22 * Math.exp(-kb * 9);
        }
        const x = R(x0 + cel.x * c), y = R(y0 + cel.y * c + dy);
        if (pasada === 0) { ctx.fillStyle = 'rgba(30,10,60,0.35)'; ctx.fillRect(x + sombra, y + sombra, c, c); continue; }
        const col = o.color ? o.color(cel) : ARCOIRIS[cel.letra % ARCOIRIS.length];
        celdaBiselada(x, y, c, col);
        if (o.brillo != null) {
          const d = (cel.x * c + cel.y * c * 0.6) - o.brillo;
          if (Math.abs(d) < c * 2.2) { ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - Math.abs(d) / (c * 2.2))})`; ctx.fillRect(x, y, c, c); }
        }
      }
    }
    return m;
  }
  function celdaBiselada(x, y, c, col) {
    const b = Math.max(2, R(c / 7));
    ctx.fillStyle = '#2d1b4e'; ctx.fillRect(x - 1, y - 1, c + 2, c + 2);
    ctx.fillStyle = col; ctx.fillRect(x, y, c, c);
    ctx.fillStyle = mezclaColor(col, 0.45); ctx.fillRect(x, y, c, b); ctx.fillRect(x, y, b, c);
    ctx.fillStyle = mezclaColor(col, 0.3, '#2d1b4e'); ctx.fillRect(x, y + c - b, c, b); ctx.fillRect(x + c - b, y, b, c);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + b, y + b, b, b);
  }

  // ------------------------------------------------------------------ mundo de bloques (fondo continuo)
  const SUELO_Y = 576, BS = 48;          // bloque cercano
  // Desplazamiento del mundo (px). Por defecto avanza a 78 px/s (el suelo va hacia la izquierda).
  // Una escena puede cambiarlo con `velocidad`: número (px/s; negativo = el mundo va hacia la
  // derecha, p. ej. un tren que viaja hacia la izquierda) o claves [[tLocal, px/s], …] lineales.
  const VEL_MUNDO = 78;
  function velEscena(e, tl) {
    const k = e && e.velocidad;
    if (k == null) return VEL_MUNDO;
    if (typeof k === 'number') return k;
    if (!k.length) return VEL_MUNDO;
    if (tl <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (tl <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (tl - k[i - 1][0]) / Math.max(1e-6, k[i][0] - k[i - 1][0]));
    return k[k.length - 1][1];
  }
  // ∫ velocidad de 0 a tl (exacta: tramos lineales)
  function avanceEscena(e, tl) {
    const k = e && e.velocidad;
    if (k == null || (Array.isArray(k) && !k.length)) return VEL_MUNDO * tl;
    if (typeof k === 'number') return k * tl;
    if (tl <= 0) return velEscena(e, 0) * tl;
    const cortes = [0, ...k.map((x) => x[0]).filter((x) => x > 0 && x < tl), tl];
    let s = 0;
    for (let i = 1; i < cortes.length; i++) s += (cortes[i] - cortes[i - 1]) * (velEscena(e, cortes[i - 1]) + velEscena(e, cortes[i])) / 2;
    return s;
  }
  function cam(t) {
    if (!TL || !TL.escenas.length || TL.escenas[0]._cam0 == null) return t * VEL_MUNDO;
    const e = escenaEn(t);
    return e._cam0 + avanceEscena(e, t - e.inicio);
  }
  function cielo(t) {
    const cols = ['#3fb6ff', '#4cbdff', '#5ac4ff', '#68cbff', '#77d1ff', '#86d8ff', '#95deff', '#a5e4ff', '#b5eaff', '#c5f0ff', '#d3f4ff', '#e0f8ff'];
    const banda = SUELO_Y / cols.length;
    cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, R(i * banda), W, Math.ceil(banda) + 1); });
  }
  function sol(t) {
    // sol pixelado
    const sx = 1105, sy = 118, p = 8;
    const giro = Math.floor(t * 4) % 2;
    ctx.fillStyle = '#ffe766';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + giro * Math.PI / 8;
      for (let d = 0; d < 3; d++) {
        const rr = 74 + d * 12 + (i % 2) * 6;
        ctx.fillRect(R((sx + Math.cos(a) * rr) / p) * p - p / 2, R((sy + Math.sin(a) * rr) / p) * p - p / 2, p, p);
      }
    }
    ctx.fillStyle = '#ffb72e'; ctx.fillRect(sx - 56, sy - 56, 112, 112);
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(sx - 48, sy - 48, 96, 96);
    ctx.fillStyle = '#fff1a1'; ctx.fillRect(sx - 32, sy - 40, 56, 16); ctx.fillRect(sx - 40, sy - 32, 16, 40);
  }
  const NUBES = [
    [[0, 1, 6, 2], [1, 0, 3, 1], [4, 0, 1, 1]],
    [[0, 1, 8, 2], [2, 0, 3, 1], [5, 0, 2, 1], [1, 3, 5, 1]],
    [[0, 1, 5, 2], [1, 0, 2, 1]],
  ];
  function nubes(t) {
    const u = 16, periodo = W + 400;
    for (let i = 0; i < 7; i++) {
      const forma = NUBES[i % 3];
      const vel = 10 + hash(i, 1) * 14;
      const x = ((hash(i, 2) * periodo - t * vel - cam(t) * 0.06) % periodo + periodo) % periodo - 200;
      const y = 40 + hash(i, 3) * 230;
      const esc = hash(i, 4) < 0.4 ? 2 : 1;
      for (const [rx, ry, rw, rh] of forma) {
        ctx.fillStyle = '#dff1ff'; ctx.fillRect(R(x + rx * u * esc), R(y + (ry + 0.5) * u * esc), rw * u * esc, rh * u * esc);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(R(x + rx * u * esc), R(y + ry * u * esc), rw * u * esc, (rh * u * esc) / 2 + 4);
      }
    }
  }
  function montanas(t) {
    const u = 24, off = cam(t) * 0.15;
    const c0 = Math.floor(off / u) - 1;
    for (let c = c0; c < c0 + W / u + 3; c++) {
      const n = Math.sin(c * 0.11) * 4 + Math.sin(c * 0.037 + 1) * 5 + Math.sin(c * 0.23) * 1.5;
      const alto = Math.max(2, R(9 + n));
      const x = R(c * u - off);
      ctx.fillStyle = '#9cc7ec'; ctx.fillRect(x, SUELO_Y - 40 - alto * u, u, alto * u + 40);
      if (alto > 13) { ctx.fillStyle = '#f3fbff'; ctx.fillRect(x, SUELO_Y - 40 - alto * u, u, u); }
      else { ctx.fillStyle = '#b4d6f2'; ctx.fillRect(x, SUELO_Y - 40 - alto * u, u, 8); }
    }
  }
  function colinas(t) {
    const s = 32, off = cam(t) * 0.42;
    const c0 = Math.floor(off / s) - 6;
    const altoCol = (c) => Math.max(1, R(2 + Math.sin(c * 0.21) * 1.2 + Math.sin(c * 0.07 + 2) * 1.3));
    for (let c = c0; c < c0 + W / s + 12; c++) {
      const a = altoCol(c), x = R(c * s - off);
      for (let k = 0; k < a + 2; k++) bloque(k === a - 1 ? 'cesped' : 'tierra', x, SUELO_Y - (a - 1 - k) * s - s, s);
      // árbol
      if (hash(c, 77) < 0.2 && hash(c - 1, 77) >= 0.2 && hash(c - 2, 77) >= 0.2 && altoCol(c - 1) === a && altoCol(c + 1) === a) {
        const base = SUELO_Y - a * s;
        for (let k = 1; k <= 3; k++) bloque('tronco', x, base - k * s, s);
        for (let dx = -2; dx <= 2; dx++) for (let dy = 3; dy <= 4; dy++) bloque('hojas', x + dx * s, base - (dy + 1) * s, s);
        for (let dx = -1; dx <= 1; dx++) bloque('hojas', x + dx * s, base - 6 * s, s);
      }
    }
    ctx.fillStyle = 'rgba(200,236,255,0.30)';
    ctx.fillRect(0, 0, W, SUELO_Y);
  }
  function islas(t) {
    const s = 32;
    const defs = [[0, 210, 6], [1, 150, 4], [2, 260, 5]];
    const periodo = W + 600;
    for (const [i, y, ancho] of defs) {
      const x = ((hash(i, 9) * periodo - cam(t) * 0.25) % periodo + periodo) % periodo - 300;
      const yy = R(y + Math.sin(t * 0.9 + i * 2) * 8);
      for (let k = 0; k < ancho; k++) bloque('cesped', x + k * s, yy, s);
      for (let fila = 1; fila < 4; fila++) {
        const recorte = fila;
        for (let k = recorte; k < ancho - recorte + (fila === 1 ? 1 : 0); k++) bloque(fila === 1 ? 'tierra' : hash(i, k, fila) < 0.3 ? 'diamante' : 'piedra', x + k * s, yy + fila * s, s);
      }
      if (i !== 1) { // arbolito
        const tx = x + (ancho >> 1) * s;
        bloque('tronco', tx, yy - s, s); bloque('tronco', tx, yy - 2 * s, s);
        for (let dx = -1; dx <= 1; dx++) bloque('hojas', tx + dx * s, yy - 3 * s, s);
        bloque('hojas', tx, yy - 4 * s, s);
      }
    }
  }
  // columnas del suelo cercano
  function columnaSuelo(c) {
    const bache = hash(c, 5) < 0.09 && hash(c - 1, 5) >= 0.09;
    return { bache };
  }
  function suelo(t, plano = false) {
    const off = cam(t);
    const c0 = Math.floor(off / BS) - 1;
    for (let c = c0; c < c0 + W / BS + 3; c++) {
      const x = R(c * BS - off);
      const col = plano ? { bache: false } : columnaSuelo(c);
      if (col.bache) bloque('cesped', x, SUELO_Y - BS, BS);
      bloque(col.bache ? 'tierra' : 'cesped', x, SUELO_Y, BS);
      const v = hash(c, 21);
      bloque(v < 0.35 ? 'piedra' : 'tierra', x, SUELO_Y + BS, BS);
      const v2 = hash(c, 22);
      bloque(v2 < 0.12 ? 'diamante' : v2 < 0.2 ? 'oro' : v2 < 0.28 ? 'amatista' : 'piedra', x, SUELO_Y + 2 * BS, BS);
      // florecitas
      const fl = hash(c, 31);
      if (!col.bache && fl < 0.35) {
        const fx = x + 8 + R(hash(c, 32) * 28), p = 4;
        const pet = fl < 0.12 ? '#ff5fa2' : fl < 0.24 ? '#ffd23f' : '#ffffff';
        ctx.fillStyle = '#2f8a24'; ctx.fillRect(fx + p, SUELO_Y - 3 * p, p, 3 * p);
        ctx.fillStyle = pet; ctx.fillRect(fx, SUELO_Y - 5 * p, 3 * p, p); ctx.fillRect(fx + p, SUELO_Y - 6 * p, p, 3 * p);
        ctx.fillStyle = '#ffb72e'; ctx.fillRect(fx + p, SUELO_Y - 5 * p, p, p);
      }
    }
    // sombra de contacto bajo la línea del césped
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, SUELO_Y + BS, W, 4);
  }
  // altura de salto para no chocar con los baches (x en pantalla de los pies)
  function saltoBaches(t, xPant) {
    const xm = xPant + cam(t);
    const c = Math.floor(xm / BS);
    let h = 0;
    for (let k = c - 4; k <= c + 4; k++) {
      if (!columnaSuelo(k).bache) continue;
      const d = (xm - (k * BS + BS / 2)) / 150;
      if (Math.abs(d) < 1) h = Math.max(h, 95 * (1 - d * d));
    }
    return h;
  }

  // ------------------------------------------------------------------ unicornio
  let UNI = [], UNI_ROSA = [], MANO_SPR = null;
  const ESC_UNI = 5;
  function posUnicornio(t) {
    const e = escenaEn(t);
    if (!e) return null;
    const tl = t - e.inicio, dur = e.fin - e.inicio;
    let x, salto = 0, visible = true, esc = ESC_UNI;
    if (e.tipo === 'tren' || e.tipo === 'cantinela') return null; // va montado en la locomotora
    if (e.tipo === 'titulo') {
      x = lerp(-240, 210, easeOutCubic(tl / 1.6));
      const j = (tl - 2.6) / 0.9;
      if (j > 0 && j < 1) salto = 190 * 4 * j * (1 - j);
      const j2 = (tl - 4.4) / 0.7;
      if (j2 > 0 && j2 < 1) salto = Math.max(salto, 110 * 4 * j2 * (1 - j2));
      salto = Math.max(salto, saltoBaches(t, x + 110));
    } else if (e.tipo === 'final') {
      x = lerp(-240, W + 60, clamp((tl - 0.1) / Math.max(1, dur - 2.2), 0, 1));
      const per = 1.15, j = ((tl % per) / per);
      salto = 105 * 4 * j * (1 - j);
      if (x > W + 40) visible = false;
    } else {
      x = 150 + Math.sin(t * 0.6) * 40;
      salto = saltoBaches(t, x + 110);
      const j = ((tl - 1.4) % 4.2) / 0.75;
      if (tl > 1.4 && j < 1) salto = Math.max(salto, 120 * 4 * j * (1 - j));
    }
    return { x, y: SUELO_Y - salto, salto, visible, esc, escena: e, tl };
  }
  function dibujarUnicornio(t, p, sprites, invertir = false) {
    const enAire = p.salto > 4;
    const frame = enAire ? 0 : Math.floor(t * 12) % 4;
    const spr = sprites[frame];
    const bob = enAire ? 0 : [0, 1, 0, -1][frame] * p.esc;
    const x = R(p.x), y = R(p.y - spr.pieY * p.esc + bob);
    // sombra en el suelo
    if (p.salto < 300) {
      const k = 1 - clamp(p.salto / 300, 0, 0.8);
      ctx.fillStyle = 'rgba(30,20,60,0.22)';
      const sw = R(spr.w * p.esc * 0.6 * k);
      ctx.fillRect(R(x + spr.w * p.esc * 0.45 - sw / 2), SUELO_Y - 6, sw, 8);
    }
    ctx.save();
    if (invertir) { ctx.translate(x + spr.w * p.esc, y); ctx.scale(-1, 1); ctx.drawImage(spr.c, 0, 0, spr.w * p.esc, spr.h * p.esc); }
    else ctx.drawImage(spr.c, x, y, spr.w * p.esc, spr.h * p.esc);
    ctx.restore();
  }
  // estela arcoíris: puntos de la cola en instantes pasados, arrastrados con el mundo
  function estela(t, fnPos, sprites, opts = {}) {
    const dt = 1 / 30, n = opts.n || 22, banda = opts.banda || 5;
    const pAhora = fnPos(t);
    if (!pAhora || !pAhora.visible) return;
    const e0 = pAhora.escena;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const tt = t - k * dt;
      if (tt < e0.inicio) break;
      const p = fnPos(tt);
      if (!p || p.escena !== e0) break;
      const spr = sprites[0];
      const arrastre = opts.cielo ? 0 : cam(t) - cam(tt);
      pts.push({ x: p.x + spr.colaX * p.esc - arrastre, y: p.y - spr.pieY * p.esc + spr.colaY * p.esc, k });
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const alfa = 1 - i / (n + 1);
      const x0 = Math.min(a.x, b.x), ancho = Math.abs(a.x - b.x) + 2;
      for (let s = 0; s < 6; s++) {
        ctx.fillStyle = ARCOIRIS[s === 5 ? 5 : s];
        ctx.globalAlpha = alfa * 0.9;
        const yy = Math.round((lerp(a.y, b.y, 0.5) - banda * 3 + s * banda) / banda) * banda;
        ctx.fillRect(R(x0), yy, R(ancho), banda);
      }
    }
    ctx.globalAlpha = 1;
    // chispitas
    for (let j = 0; j < 10; j++) {
      const nac = Math.floor(t * 10 - j) / 10;
      const edad = t - nac;
      if (nac < e0.inicio) continue;
      const p = fnPos(nac);
      if (!p || p.escena !== e0) continue;
      const spr = sprites[0];
      const arrastre = opts.cielo ? 0 : cam(t) - cam(nac);
      const id = Math.floor(nac * 10);
      const sx = p.x + spr.colaX * p.esc - arrastre + (hash(id, 1) - 0.5) * 60;
      const sy = p.y - spr.pieY * p.esc + spr.colaY * p.esc + (hash(id, 2) - 0.5) * 70 - edad * 30;
      chispa(sx, sy, 1 - edad / 1.0, hash(id, 3) < 0.5 ? '#ffffff' : '#fff27a');
    }
  }
  function chispa(x, y, k, col, p = 4) {
    if (k <= 0) return;
    const r = Math.max(1, R(k * 2.5));
    x = R(x / p) * p; y = R(y / p) * p;
    ctx.fillStyle = col;
    ctx.fillRect(x - p * r, y, p * (2 * r + 1), p);
    ctx.fillRect(x, y - p * r, p, p * (2 * r + 1));
    if (r > 1) { ctx.fillRect(x - p, y - p, 3 * p, 3 * p); }
  }
  function estrella(x, y, tam, col) { // estrella pixelada 5 puntas (aprox. cruz gruesa)
    const p = tam;
    x = R(x); y = R(y);
    ctx.fillStyle = '#2d1b4e';
    ctx.fillRect(x - 2 * p - 2, y - 2, 5 * p + 4, p + 4); ctx.fillRect(x - 2, y - 2 * p - 2, p + 4, 5 * p + 4);
    ctx.fillRect(x - p - 2, y - p - 2, 3 * p + 4, 3 * p + 4);
    ctx.fillStyle = col;
    ctx.fillRect(x - 2 * p, y, 5 * p, p); ctx.fillRect(x, y - 2 * p, p, 5 * p); ctx.fillRect(x - p, y - p, 3 * p, 3 * p);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x - p, y - p, p, p);
  }
  function diamante(x, y, tam, col) {
    const p = tam; x = R(x); y = R(y);
    const filas = [[1, 3], [0, 5], [1, 3], [2, 1]];
    ctx.fillStyle = '#2d1b4e';
    filas.forEach(([o, w], i) => ctx.fillRect(x + (o - 1) * p - 2, y + i * p - 2, (w + 0) * p + 4, p + 4));
    filas.forEach(([o, w], i) => { ctx.fillStyle = i === 0 ? mezclaColor(col, 0.5) : col; ctx.fillRect(x + (o - 1) * p, y + i * p, w * p, p); });
  }

  // ------------------------------------------------------------------ escenas
  let TL = null, IMGS = new Map();
  function escenaEn(t) {
    if (!TL) return null;
    const es = TL.escenas;
    for (let i = 0; i < es.length; i++) if (t >= es[i].inicio && t < es[i].fin) return es[i];
    if (t < es[0].inicio) return es[0];
    return es[es.length - 1];
  }

  // --- pancarta de título de sección
  function pancarta(texto, tl) {
    const k = easeOutBack((tl - 0.25) / 0.55);
    if (k <= 0) return;
    let fs = 42;
    ctx.font = `600 ${fs}px ${FUENTE}`;
    let tw = ctx.measureText(texto).width;
    while (tw > 500 && fs > 26) { fs -= 2; ctx.font = `600 ${fs}px ${FUENTE}`; tw = ctx.measureText(texto).width; }
    const p = 6, alto = 72, ancho = R(tw + 112);
    const x = R(lerp(-ancho - 20, 28, k)), y = 26;
    // cuerpo escalonado
    const esc = (dx, dy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + dx, y + dy, w, h); };
    esc(p, 0, ancho - 2 * p, alto, '#2d1b4e'); esc(0, p, ancho, alto - 2 * p, '#2d1b4e');
    esc(p, p + 0, ancho - 2 * p, alto - 2 * p, '#ff5fa2');
    esc(2 * p, p, ancho - 4 * p, p, '#ff9cc9');
    esc(p, p, p, alto - 2 * p, '#ff9cc9');
    esc(p, alto - 2 * p, ancho - 2 * p, p, '#d63c82');
    esc(ancho - 2 * p, p, p, alto - 2 * p, '#d63c82');
    // sombra
    ctx.fillStyle = 'rgba(30,10,60,0.25)'; ctx.fillRect(x + p, y + alto, ancho - p, p);
    // icono: diamante
    diamante(x + 30, y + 22, 6, '#5ef2ff');
    // texto
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = '#2d1b4e';
    ctx.strokeText(texto, x + 78, y + alto / 2 + 2);
    ctx.fillStyle = '#ffffff'; ctx.fillText(texto, x + 78, y + alto / 2 + 2);
  }

  // --- subtítulos
  const cachePaginas = new Map();
  function paginar(original) {
    if (cachePaginas.has(original)) return cachePaginas.get(original);
    const texto = original.replace(/f(?=[il])/g, 'f\u200C'); // sin ligaduras "fi"/"fl" (se ven raras en la fuente pixel)
    const anchoMax = 1120;
    let fs = 38, lineas;
    const partir = () => {
      ctx.font = `600 ${fs}px ${FUENTE}`;
      const pal = texto.split(/\s+/).filter(Boolean); lineas = []; let act = '';
      for (const p of pal) { const pr = act ? act + ' ' + p : p; if (act && ctx.measureText(pr).width > anchoMax) { lineas.push(act); act = p; } else act = pr; }
      if (act) lineas.push(act);
    };
    partir();
    while (lineas.length > 2 && fs > 32) { fs -= 2; partir(); }
    // páginas de 2 líneas, intentando cortar en final de frase
    const paginas = [];
    for (let i = 0; i < lineas.length; i += 2) {
      let pg = lineas.slice(i, i + 2);
      if (pg.length === 2) { // equilibra las dos líneas (evita una palabra huérfana)
        const pal = pg.join(' ').split(' ');
        let mejor = pg, mejorW = Infinity;
        for (let k = 1; k < pal.length; k++) {
          const a = pal.slice(0, k).join(' '), b = pal.slice(k).join(' ');
          const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
          if (w <= anchoMax && w < mejorW) { mejorW = w; mejor = [a, b]; }
        }
        pg = mejor;
      }
      paginas.push(pg);
    }
    const res = { fs, paginas, chars: paginas.map((pg) => pg.join(' ').length) };
    cachePaginas.set(original, res);
    return res;
  }
  function subtitulo(e, tl) {
    if (!e.texto) return;
    const dur = e.textoHasta != null ? Math.min(e.fin - e.inicio, e.textoHasta) : e.fin - e.inicio;
    if (tl > dur) return;
    const { fs, paginas, chars } = paginar(e.texto);
    const total = chars.reduce((a, b) => a + b, 0);
    // reparto proporcional al nº de letras, dentro de [0.25, dur-0.3]
    const t0 = 0.25, t1 = Math.max(t0 + 0.5, dur - 0.3);
    let acum = t0, idx = paginas.length - 1, ini = t0;
    for (let i = 0; i < paginas.length; i++) {
      const d = (t1 - t0) * chars[i] / total;
      if (tl < acum + d) { idx = i; ini = acum; break; }
      acum += d;
    }
    const alfa = clamp((tl - ini) / 0.2, 0, 1) * (idx === paginas.length - 1 ? clamp((dur - tl) / 0.2, 0, 1) : 1);
    if (alfa <= 0) return;
    const lineas = paginas[idx];
    ctx.font = `600 ${fs}px ${FUENTE}`;
    const anchoT = Math.max(...lineas.map((l) => ctx.measureText(l).width));
    const lh = R(fs * 1.22), padY = 14, padX = 30;
    const alto = lineas.length * lh + padY * 2, ancho = R(anchoT + padX * 2);
    const x = R(W / 2 - ancho / 2), y = H - 18 - alto;
    ctx.globalAlpha = alfa;
    const p = 6;
    ctx.fillStyle = 'rgba(28,14,56,0.78)';
    ctx.fillRect(x + p, y, ancho - 2 * p, alto); ctx.fillRect(x, y + p, ancho, alto - 2 * p);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + p, y + p - 3, ancho - 2 * p, 3);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    lineas.forEach((l, i) => {
      const ty = y + padY + lh * i + lh / 2 + 2;
      ctx.lineWidth = 7; ctx.strokeStyle = '#1a0d33'; ctx.strokeText(l, W / 2, ty);
      ctx.fillStyle = '#ffffff'; ctx.fillText(l, W / 2, ty);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // --- tableta con capturas
  const TAB = { cx: 936, cy: 336, sw: 576, sh: 432, bisel: 26 };
  function transformTableta(e, tl, t) {
    const k = easeOutBack(tl / 0.6);
    const esc = lerp(0.55, 1, k);
    const rot = (1 - clamp(tl / 0.6, 0, 1)) * -0.08 + Math.sin(t * 1.45) * 0.012;
    const dy = Math.sin(t * 2.1) * 5;
    return { esc, rot, dy, alfa: clamp(tl / 0.15, 0, 1) };
  }
  function capturaEn(e, tl) {
    const cs = e.capturas || [];
    if (!cs.length) return { act: null, prev: null, mezcla: 1 };
    let i = cs.findIndex((c) => tl >= c.desde && tl < c.hasta);
    if (i < 0) i = tl < cs[0].desde ? 0 : cs.length - 1;
    const c = cs[i];
    let mezcla = 1;
    if (i > 0 && c.hasta - c.desde > 0.6) mezcla = clamp((tl - c.desde) / 0.3, 0, 1);
    return { act: IMGS.get(c.src), prev: i > 0 ? IMGS.get(cs[i - 1].src) : null, mezcla };
  }
  function tableta(e, tl, t) {
    const tr = transformTableta(e, tl, t);
    const { sw, sh, bisel } = TAB;
    const tw = sw + bisel * 2, th = sh + bisel * 2;
    ctx.save();
    ctx.globalAlpha = tr.alfa;
    ctx.translate(TAB.cx, TAB.cy + tr.dy);
    ctx.rotate(tr.rot);
    ctx.scale(tr.esc, tr.esc);
    // sombra
    ctx.fillStyle = 'rgba(25,15,60,0.30)';
    redondeado(-tw / 2 + 14, -th / 2 + 18, tw, th, 34); ctx.fill();
    // carcasa
    ctx.fillStyle = '#1f2233'; redondeado(-tw / 2, -th / 2, tw, th, 34); ctx.fill();
    ctx.strokeStyle = '#3b4060'; ctx.lineWidth = 4; redondeado(-tw / 2 + 4, -th / 2 + 4, tw - 8, th - 8, 30); ctx.stroke();
    // botón de inicio y cámara
    ctx.fillStyle = '#3b4060'; ctx.beginPath(); ctx.arc(tw / 2 - bisel / 2 - 1, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#11131e'; ctx.beginPath(); ctx.arc(-tw / 2 + bisel / 2 + 1, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    // pantalla
    ctx.fillStyle = '#fff7e8'; ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    const { act, prev, mezcla } = capturaEn(e, tl);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.save(); ctx.beginPath(); ctx.rect(-sw / 2, -sh / 2, sw, sh); ctx.clip();
    if (prev && mezcla < 1) dibujarCubre(prev, -sw / 2, -sh / 2, sw, sh);
    if (act) { ctx.globalAlpha = tr.alfa * mezcla; dibujarCubre(act, -sw / 2, -sh / 2, sw, sh); ctx.globalAlpha = tr.alfa; }
    // reflejo sutil
    const gr = ctx.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    // dedo
    if (e.dedo && e.dedo.length) dedo(e, tl);
    ctx.restore();
  }
  function dibujarCubre(img, x, y, w, h) {
    const r = Math.max(w / img.width, h / img.height);
    const iw = img.width * r, ih = img.height * r;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  function redondeado(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function dedo(e, tl) {
    const ks = e.dedo;
    const ini = ks[0].t - 0.35, fin = ks[ks.length - 1].t + 0.7;
    if (tl < ini || tl > fin) return;
    let x, y;
    if (tl <= ks[0].t) { x = ks[0].x; y = ks[0].y; }
    else if (tl >= ks[ks.length - 1].t) { x = ks[ks.length - 1].x; y = ks[ks.length - 1].y; }
    else {
      let i = 0; while (i < ks.length - 1 && tl > ks[i + 1].t) i++;
      const a = ks[i], b = ks[i + 1];
      const k = suave((tl - a.t) / Math.max(0.01, b.t - a.t));
      x = lerp(a.x, b.x, k); y = lerp(a.y, b.y, k);
    }
    const alfa = Math.min(clamp((tl - ini) / 0.25, 0, 1), clamp((fin - tl) / 0.25, 0, 1));
    const { sw, sh } = TAB;
    const px = -sw / 2 + x * sw, py = -sh / 2 + y * sh;
    // ondas de toque
    let presion = 0;
    for (const k of ks) {
      if (!k.toque) continue;
      const d = tl - k.t;
      if (d > -0.15 && d < 0.15) presion = Math.max(presion, 1 - Math.abs(d) / 0.15);
      if (d >= 0 && d < 0.6) {
        const kx = -sw / 2 + k.x * sw, ky = -sh / 2 + k.y * sh;
        for (let anillo = 0; anillo < 2; anillo++) {
          const dd = d - anillo * 0.12; if (dd < 0) continue;
          const r = 10 + dd * 110, a = (1 - dd / 0.6) * alfa;
          ctx.globalAlpha = a; ctx.lineWidth = 6; ctx.strokeStyle = anillo ? '#ff5fa2' : '#ffffff';
          // anillo "pixelado": octógono
          ctx.beginPath();
          for (let i = 0; i <= 8; i++) { const an = i * Math.PI / 4 + Math.PI / 8; const fx = kx + Math.cos(an) * r, fy = ky + Math.sin(an) * r; i ? ctx.lineTo(fx, fy) : ctx.moveTo(fx, fy); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    const esc = 5 * (1 - presion * 0.12);
    ctx.globalAlpha = alfa;
    // la punta del índice (columna 4.5, fila 0) es el punto caliente
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(MANO_SPR, R(px - 4.5 * esc), R(py - 0.5 * esc + presion * 4), R(MANO_SPR.width * esc), R(MANO_SPR.height * esc));
    ctx.globalAlpha = 1;
  }

  // --- cortina de bloques entre escenas
  function cortina(t) {
    if (!TL) return;
    const D = 0.22, celda = 80, cols = W / celda, filas = H / celda;
    for (let i = 1; i < TL.escenas.length; i++) {
      const b = TL.escenas[i].inicio;
      if (t < b - D || t > b + D) continue;
      const fase = t < b ? (t - (b - D)) / D : (t - b) / D; // 0..1
      const entrando = t < b;
      for (let cy = 0; cy < filas; cy++) for (let cx = 0; cx < cols; cx++) {
        const orden = (cx / cols) * 0.7 + (cy / filas) * 0.3;
        let k = clamp((fase * 1.6 - orden * 0.6 - 0.0) / 0.6 * 1.0, 0, 1);
        k = entrando ? k : 1 - k;
        if (k <= 0) continue;
        const s = R(celda * k);
        const x = cx * celda + (celda - s) / 2, y = cy * celda + (celda - s) / 2;
        const v = hash(cx, cy, i);
        const tex = cy < 2 ? 'cesped' : v < 0.15 ? 'diamante' : v < 0.25 ? 'amatista' : v < 0.35 ? 'oro' : cy < 4 ? 'tierra' : 'piedra';
        ctx.drawImage(TEX[tex], R(x), R(y), s, s);
      }
    }
  }

  // --- escena título
  function escenaTitulo(e, tl, t) {
    const dur = e.fin - e.inicio;
    const brillo = lerp(-300, 1500, clamp((tl - 2.9) / 1.0, 0, 1));
    const titulo = e.titulo || 'JUEGOS PEQUES';
    const out = clamp((dur - tl) / 0.3, 0, 1);
    if (out <= 0) return;
    const palabras = titulo.split(/\s+/);
    // título en dos líneas si son 2+ palabras (más grande)
    const m = textoBloques(palabras.length === 2 ? palabras.join(' ') : titulo, tl - 0.3, {
      cx: W / 2, cy: 200, anchoMax: 860, celdaMax: 22, retardo: 0.15, brillo: tl > 2.9 ? brillo : null,
    });
    // subtítulo "Bloques" tras aterrizar
    const k = easeOutBack((tl - (0.3 + m.nLetras * 0.15 + 0.5)) / 0.5);
    if (k > 0) {
      ctx.save();
      ctx.translate(W / 2, 412); ctx.scale(k, k);
      ctx.font = `600 34px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const txt = e.subtitulo || '¡Aprende jugando!';
      const tw = ctx.measureText(txt).width + 60;
      ctx.fillStyle = '#2d1b4e'; ctx.fillRect(-tw / 2 - 6, -30, tw + 12, 60); ctx.fillRect(-tw / 2, -36, tw, 72);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-tw / 2, -30, tw, 60);
      ctx.fillStyle = '#fff1a1'; ctx.fillRect(-tw / 2, -30, tw, 6);
      ctx.fillStyle = '#e09a00'; ctx.fillRect(-tw / 2, 24, tw, 6);
      ctx.fillStyle = '#2d1b4e'; ctx.fillText(txt, 0, 2);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  // --- escena final
  function particulas(t0, tl, n, semilla, cx, cy) {
    const d = tl - t0;
    if (d < 0 || d > 2.6) return;
    for (let i = 0; i < n; i++) {
      const a = hash(i, semilla) * Math.PI * 2, v = 260 + hash(i, semilla + 1) * 520;
      const x = cx + Math.cos(a) * v * d, y = cy + Math.sin(a) * v * d * 0.8 + 380 * d * d;
      const k = 1 - d / 2.6;
      const tipo = hash(i, semilla + 2);
      const tam = R(3 + hash(i, semilla + 3) * 3);
      if (tipo < 0.4) estrella(x, y, tam, tipo < 0.2 ? '#ffd23f' : '#fff27a');
      else if (tipo < 0.7) diamante(x, y, tam, tipo < 0.55 ? '#5ef2ff' : '#ff7ad9');
      else { ctx.fillStyle = ARCOIRIS[i % 7]; ctx.fillRect(R(x / 4) * 4, R(y / 4) * 4, tam * 3, tam * 3); }
      void k;
    }
  }
  function confeti(tl, desde) {
    if (tl < desde) return;
    for (let i = 0; i < 46; i++) {
      const vel = 120 + hash(i, 41) * 160;
      const x = hash(i, 42) * W + Math.sin(tl * 2 + i) * 20;
      const y = ((tl - desde) * vel + hash(i, 43) * H * 1.2) % (H + 40) - 30;
      if (tl - desde < hash(i, 44) * 1.2) continue;
      ctx.fillStyle = ARCOIRIS[i % 7];
      const p = 8, tum = Math.floor(tl * 6 + i) % 2;
      ctx.fillRect(R(x / 4) * 4, R(y / 4) * 4, tum ? p : p * 2, tum ? p * 2 : p);
    }
  }
  function posVolador(t) {
    const e = escenaEn(t);
    if (!e || e.tipo !== 'final') return null;
    const tl = t - e.inicio, dur = e.fin - e.inicio;
    const logoIni = Math.max(dur * 0.62, dur - 2.6);
    const k = clamp((tl - logoIni - 0.3) / 2.4, 0, 1);
    const x = lerp(W + 40, -200, k);
    const y = 200 - Math.sin(k * Math.PI) * 40 + Math.sin(tl * 5) * 8;
    return { x, y, salto: 999, visible: k > 0 && k < 1, esc: 3, escena: e, tl };
  }
  function escenaFinal(e, tl, t) {
    const dur = e.fin - e.inicio;
    const logoIni = Math.max(dur * 0.62, dur - 2.6);
    const titulo = e.titulo || '¡A JUGAR!';
    confeti(tl, 0.9);
    particulas(1.15, tl, 70, 100, W / 2, 190);
    particulas(2.6, tl, 50, 200, W / 2 - 300, 300);
    particulas(3.4, tl, 50, 300, W / 2 + 300, 260);
    const salida = clamp((tl - logoIni) / 0.5, 0, 1);
    if (salida < 1) {
      ctx.save();
      const pulso = tl > 1.4 ? 1 + Math.sin((tl - 1.4) * 7) * 0.025 : 1;
      ctx.translate(W / 2, 190); ctx.scale(pulso * (1 - salida), pulso * (1 - salida)); ctx.translate(-W / 2, -190);
      textoBloques(titulo, tl - 0.15, { cx: W / 2, cy: 190, anchoMax: 1100, celdaMax: 25, retardo: 0.1, brillo: tl > 1.6 ? lerp(-300, 1600, clamp((tl - 1.6) / 1.0, 0, 1)) : null });
      ctx.restore();
    }
  }
  function logoFinal(e, tl) {
    const dur = e.fin - e.inicio;
    const logoIni = Math.max(dur * 0.62, dur - 2.6);
    const k = clamp((tl - logoIni) / 0.6, 0, 1);
    if (k <= 0) return;
    // velo nocturno mágico
    ctx.globalAlpha = k * 0.88;
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#2b1a5c'); gr.addColorStop(1, '#5b2a86');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      const tw = 0.5 + 0.5 * Math.sin(tl * 4 + i * 1.7);
      chispa(hash(i, 61) * W, hash(i, 62) * H * 0.8, k * tw, '#ffffff', 4);
    }
    const k2 = easeOutBack((tl - logoIni - 0.2) / 0.6);
    if (k2 <= 0) return;
    ctx.save();
    ctx.translate(W / 2, 300); ctx.scale(k2, k2);
    ctx.font = `600 120px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const txt = (TL && TL.logo) || 'Juegos peques';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22; ctx.strokeStyle = '#1a0d33'; ctx.strokeText(txt, 0, 0);
    const g2 = ctx.createLinearGradient(0, -55, 0, 55);
    ARCOIRIS.slice(0, 6).forEach((c, i) => { g2.addColorStop(i / 6, c); g2.addColorStop((i + 1) / 6 - 0.001, c); });
    ctx.fillStyle = g2; ctx.fillText(txt, 0, 0);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.strokeText(txt, 0, -3);
    ctx.restore();
    // unicornio junto al logo
    const ku = clamp((tl - logoIni - 0.4) / 0.5, 0, 1);
    if (ku > 0) {
      ctx.globalAlpha = ku;
      const spr = UNI[Math.floor(tl * 8) % 4];
      ctx.drawImage(spr.c, R(W / 2 - spr.w * 3 / 2), R(400 + (1 - ku) * 30), spr.w * 3, spr.h * 3);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  // ================================================================== TREN DE LOS DÍAS
  // Escenas 'tren' y 'cantinela' + presentador "youtuber" (niño de bloques con gorra y cascos).
  // Ver la documentación de parámetros al principio del archivo.
  // Semana de ejemplo, para cuando timeline.dias no trae la de js/familia.js (pruebas del kit de vídeo)
  const DIAS_DEF = [
    { nombre: 'Lunes', actividad: 'Parque', color: '#e53935', icono: 'parque', cole: true },
    { nombre: 'Martes', actividad: 'Piscina', color: '#fb8c00', icono: 'piscina', cole: true },
    { nombre: 'Miércoles', actividad: 'Música', color: '#fdd835', icono: 'musica', cole: true },
    { nombre: 'Jueves', actividad: 'Piscina', color: '#43a047', icono: 'piscina', cole: true },
    { nombre: 'Viernes', actividad: 'Con los abuelos', color: '#1e88e5', icono: 'abuelos', cole: true },
    { nombre: 'Sábado', actividad: 'Fin de semana', color: '#8e24aa', icono: 'globos', cole: false },
    { nombre: 'Domingo', actividad: 'Fin de semana', color: '#f06292', icono: 'sofa', cole: false },
  ];
  const dias = () => (TL && TL.dias) || DIAS_DEF;
  const OSCURO = '#2d1b4e';

  // geometría del tren (coordenadas de pantalla con la cámara a zoom 1)
  const TR = { locoX: 40, v0: 236, paso: 146, vw: 140, riel: 566, techo: 410, cuerpo: 420, base: 538 };
  const vagonX = (i) => TR.v0 + i * TR.paso;
  const vagonCx = (i) => vagonX(i) + TR.vw / 2;

  // ---------------------------------------------------------------- iconos pixel-art
  // Los de los días (timeline.dias[].icono), por orden alfabético; al final, los del tren y la escena.
  const ICONOS_DEF = {
    abuelos: { pal: { K: OSCURO, g: '#e0e4ea', G: '#9aa5b1', S: '#ffcc99', s: '#ff9e8a', w: '#e3f2fd', R: '#d84a5a' }, filas: [
      '....KKKK....',
      '...KggGgK...',
      '..KKKKKKKK..',
      '.KggggggGgK.',
      'KgGSSSSSSGgK',
      'KgSKKSSKKSgK',
      'KgKwwKKwwKgK',
      'KGSKKSSKKSGK',
      '.KSsSSSSsSK.',
      '.KSSSRRSSSK.',
      '..KSSSSSSK..',
      '...KKKKKK...'] },
    casa: { pal: { K: OSCURO, R: '#d32f2f', r: '#ff6f61', W: '#fff8e1', B: '#4fc3f7', D: '#8d5524', C: '#6d4c41' }, filas: [
      '.....KK.KKK.',
      '....KrrKKCK.',
      '...KrRRRKCK.',
      '..KrRRRRRRK.',
      '.KrRRRRRRRRK',
      'KKKKKKKKKKKK',
      '.KWWWWWWWWK.',
      '.KWBBWWDDWK.',
      '.KWBBWWDDWK.',
      '.KWWWWWDDWK.',
      '.KWWWWWDDWK.',
      '.KKKKKKKKKK.'] },
    circo: { pal: { K: OSCURO, R: '#e53935', W: '#ffffff', Y: '#ffd23f', D: '#3a1f5d' }, filas: [
      '......KYY...',
      '......KYYY..',
      '......K.....',
      '.....KRK....',
      '....KRWRK...',
      '...KRWRWRK..',
      '..KRWRWRWRK.',
      '.KRWRWRWRWRK',
      'KKKKKKKKKKKK',
      '.KRWRKDKRWK.',
      '.KRWRKDKRWK.',
      '.KKKKKKKKKK.'] },
    cumple: { pal: { K: OSCURO, Y: '#ffd23f', R: '#4dd0e1', W: '#ffffff', P: '#ff6fb1', C: '#c68642', c: '#ffe0b2' }, filas: [
      '...Y....Y...',
      '..KYK..KYK..',
      '..KRK..KRK..',
      '..KRK..KRK..',
      '.KKKKKKKKKK.',
      'KWWWWWWWWWWK',
      'KWPWWWPWWPWK',
      'KCWCCWCCCWCK',
      'KCCCCCCCCCCK',
      'KccccccccccK',
      'KCCCCCCCCCCK',
      'KKKKKKKKKKKK'] },
    futbol: { pal: { K: OSCURO, W: '#ffffff', B: '#26232e', s: '#cfd3dc' }, filas: [
      '...KKKKKK...',
      '..KWWBBWWK..',
      '.KWWWBBWWWK.',
      'KBWWWWWWWWBK',
      'KBBWWWWWWBBK',
      'KWWWWBBWWWWK',
      'KWWWBBBBWWsK',
      'KWWWWBBWWWsK',
      'KBBWWWWWWBBK',
      '.KBWWWWWWBK.',
      '..KssBBssK..',
      '...KKKKKK...'] },
    globos: { pal: { K: OSCURO, Y: '#ffd23f', C: '#4dd0e1', w: '#ffffff', P: '#ff6fb1' }, filas: [
      '.KKK....KKK.',
      'KYYYK..KCCCK',
      'KYwYK..KCwCK',
      'KYYYK..KCCCK',
      'KYYYK..KCCCK',
      '.KYK.KKKKCK.',
      '..K.KPPPKK..',
      '..K.KPwPK...',
      '...KKPPPK...',
      '....KKPK....',
      '....K.K.....',
      '....K.K.....'] },
    libro: { pal: { K: OSCURO, W: '#fffdf5', l: '#9fb3c8', R: '#e53935', r: '#b71c1c' }, filas: [
      '............',
      '.KKKK..KKKK.',
      'KWWWWKKWWWWK',
      'KWllWKKWllWK',
      'KWWWWKKWWWWK',
      'KWlllKKlllWK',
      'KWWWWKKWWWWK',
      'KWllWKKWllWK',
      'KWWWWKKWWWWK',
      'KKKKKKKKKKKK',
      'KRRRRrrRRRRK',
      '.KKKKKKKKKK.'] },
    musica: { pal: { K: OSCURO, M: '#7e57c2', m: '#b39ddb', w: '#ffffff' }, filas: [
      '...KKKKKKKKK',
      '...KmmmmmmmK',
      '...KMMMMMMMK',
      '...KMKKKKKMK',
      '...KMK...KMK',
      '...KMK...KMK',
      '...KMK...KMK',
      '.KKKMK.KKKMK',
      'KMMMMKKMMMMK',
      'KMwMMKKMwMMK',
      'KMMMMKKMMMMK',
      '.KKKK..KKKK.'] },
    parque: { pal: { K: OSCURO, G: '#43a047', g: '#8bd35a', N: '#8d5524', P: '#9ccc65', F: '#ff6fb1' }, filas: [
      '...KKKKKK...',
      '..KGGgGGGK..',
      '.KGgGGGGgGK.',
      'KGGGGGGGGGGK',
      'KGgGGGgGGGGK',
      'KGGGGGGGGgGK',
      '.KGGgGGGGGK.',
      '..KKKNNKKK..',
      '....KNNK....',
      '....KNNK....',
      'KKKKKNNKKKKK',
      'KPFPPPPPPFPK'] },
    piscina: { pal: { K: OSCURO, R: '#e53935', W: '#ffffff', B: '#4fc3f7', b: '#0288d1', w: '#e1f5fe' }, filas: [
      '...KKKKKK...',
      '..KRRWWRRK..',
      '.KRRKKKKRRK.',
      'KWWK....KWWK',
      'KWWK....KWWK',
      '.KRRKKKKRRK.',
      'B.KRRWWRRK.B',
      'BwBKKKKKKBwB',
      'BBBBBBBBBBBB',
      'BBwBBBBBwBBB',
      'BBBBBBBBBBBB',
      'bbbbbbbbbbbb'] },
    sofa: { pal: { K: OSCURO, B: '#3f7fe0', b: '#2c5fb0', L: '#8fbaff', N: '#6d4c41' }, filas: [
      '............',
      '..KKKKKKKK..',
      '.KLLLLLLLLK.',
      '.KBBBBBBBBK.',
      'KKBBBBBBBBKK',
      'KLKKKKKKKKLK',
      'KBKLLLLLLKBK',
      'KBBBBBBBBBBK',
      'KbbbbbbbbbbK',
      'KKKKKKKKKKKK',
      '.KN......NK.',
      '.KK......KK.'] },
    tutu: { pal: { K: OSCURO, P: '#ff4f9a', p: '#ffffff', T: '#ffb3d6', t: '#ffffff' }, filas: [
      '...KK..KK...',
      '...KPKKPK...',
      '...KPPPPK...',
      '...KPpPPK...',
      '...KPPPPK...',
      '..KKPPPPKK..',
      '.KTTTTTTTTK.',
      'KTtTTtTTtTTK',
      'KTTTTTTTTTTK',
      'KTtTTTtTTTtK',
      '.KTKTKKTKTK.',
      '..K.K..K.K..'] },
    // del tren y de la escena (no son de un día)
    mochila: { pal: { K: OSCURO, G: '#3949ab', g: '#5c6bc0', Y: '#ffd23f' }, filas: [
      '..KKK..',
      '.K...K.',
      'KKKKKKK',
      'KgGGGGK',
      'KGKKKGK',
      'KGKYKGK',
      'KGGGGGK',
      'KKKKKKK'] },
    cole: { pal: { K: OSCURO, R: '#e53935', W: '#fff3d6', B: '#4fc3f7', D: '#8d5524', Y: '#ffd23f', w: '#ffffff' }, filas: [
      '.......KRR....',
      '.......KRRR...',
      '.......K......',
      '......KKK.....',
      '.....KRwRK....',
      '....KRRRRRK...',
      '...KRRRRRRRK..',
      '..KKKKKKKKKKK.',
      '..KWBWWWWWBWK.',
      '..KWWWWWWWWWK.',
      '..KWBWWDDWBWK.',
      '..KWWWWDDWWWK.',
      '..KKKKKKKKKKK.'] },
    corazon: { pal: { K: OSCURO, R: '#ff3b5c', r: '#c2185b', w: '#ffffff' }, filas: [
      '.KK...KK.',
      'KRRK.KRRK',
      'KRwRKRRRK',
      'KRRRRRRrK',
      '.KRRRRrK.',
      '..KRRrK..',
      '...KrK...',
      '....K....'] },
  };
  const ICONOS = {};

  // ---------------------------------------------------------------- presentador (original, de bloques)
  const PRES_BASE = [
    '....KKKKKKKK....',
    '...KCCCCCCCCK...',
    '..KGCCCCwwCCGK..',
    '..KGCCCCwwCCGK..',
    '.KGccccccccccGK.',
    'KGGKHSSSSSSHKGGK',
    'KggKSSSSSSSSKggK',
    'KGGKSWPSSWPSKGGK',
    'KGGKSWPSSWPSKGGK',
    '.KKKSSSssSSSKmK.',
    '...KSSSSSSSSKm..',
    '...KSSSMMSSOmK..',
    '...KSSSSSSSSK...',
    '....KKKKKKKK....',
    '...KYYYYYYYYK...',
    '..KYYYYYYYYYYK..',
    '.KYYKYYYYYYKYYK.',
    '.KYYKYYwwYYKYYK.',
    '.KYYKYwwwwYKYYK.',
    '.KYYKYYwwYYKYYK.',
    '.KYYKYyyyyYKYYK.',
    '.KSSKYyyyyYKSSK.',
    '.KKKKBBBBBBKKKK.',
    '....KBBBBBBK....',
    '....KBBKKBBK....',
    '....KBBKKBBK....',
    '...KNNNKKNNNK...',
    '...KKKKKKKKKK...',
  ];
  const PAL_PRES = {
    K: OSCURO, C: '#00acc1', c: '#00838f', w: '#ffffff', G: '#263238', g: '#546e7a', m: '#263238', O: '#ff5252',
    H: '#6d4c2f', S: '#f5c7a0', s: '#e0a882', W: '#ffffff', P: OSCURO, M: '#8b2c3c', R: '#ff6b81',
    Y: '#ffb300', y: '#e69500', B: '#3f51b5', N: '#ffffff',
  };
  let PRES = null; // { cerrada, abierta, parpadeo, abiertaParpadeo }
  function construirPresentador() {
    const v = (cambios) => {
      const f = PRES_BASE.slice();
      for (const [i, txt] of cambios) f[i] = txt;
      return spriteDeMatriz(f, PAL_PRES);
    };
    const boca = [[11, '...KSSMMMMSOmK..'], [12, '...KSSMRRMSSK...']];
    const ojos = [[7, 'KGGKSSSSSSSSKGGK'], [8, 'KGGKSKKSSKKSKGGK']];
    PRES = { cerrada: v([]), abierta: v(boca), parpadeo: v(ojos), abiertaParpadeo: v([...boca, ...ojos]) };
  }
  // ¿está hablando en tl? (intervalos [[t0,t1],…] relativos a la escena) → boca abierta a ratos
  function bocaAbierta(habla, tl) {
    if (!habla) return false;
    for (const [a, b] of habla) if (tl >= a && tl < b) {
      const k = Math.floor((tl - a) * 9);
      return hash(k, 7) < 0.68;
    }
    return false;
  }
  function spritePresentador(e, tl) {
    const parp = (tl % 3.1) > 2.95;
    const ab = bocaAbierta(e.habla, tl);
    return ab ? (parp ? PRES.abiertaParpadeo : PRES.abierta) : (parp ? PRES.parpadeo : PRES.cerrada);
  }
  // presentador de cuerpo entero sobre el suelo: e.presentador = { x, desde, escala }
  function presentador(e, tl) {
    const o = e.presentador; if (!o) return;
    const esc = o.escala || 8, spr = spritePresentador(e, tl);
    const k = easeOutBack((tl - (o.desde || 0.4)) / 0.6);
    if (k <= 0) return;
    const hablando = bocaAbierta(e.habla, tl);
    const bob = hablando ? -Math.abs(Math.sin(tl * 9)) * 6 : Math.sin(tl * 3) * 2;
    const w = spr.width * esc, h = spr.height * esc;
    const x = R(o.x), yPie = SUELO_Y;
    // sombra
    ctx.fillStyle = 'rgba(30,20,60,0.22)'; ctx.fillRect(x + 8, yPie - 6, w - 16, 8);
    ctx.save();
    ctx.translate(x + w / 2, yPie);
    ctx.scale(k, k);
    ctx.drawImage(spr, R(-w / 2), R(-h + bob), w, h);
    ctx.restore();
  }
  // "cámara del youtuber" en una esquina: e.facecam = true | { x, y }
  function facecam(e, tl) {
    if (!e.facecam) return;
    const o = typeof e.facecam === 'object' ? e.facecam : {};
    const k = easeOutBack((tl - 0.15) / 0.5);
    if (k <= 0) return;
    const fw = 176, fh = 150, x0 = o.x != null ? o.x : 18, y0 = o.y != null ? o.y : 18;
    ctx.save();
    ctx.translate(x0 + fw / 2, y0 + fh / 2); ctx.scale(k, k); ctx.translate(-fw / 2, -fh / 2);
    const p = 6;
    ctx.fillStyle = OSCURO; ctx.fillRect(p, 0, fw - 2 * p, fh); ctx.fillRect(0, p, fw, fh - 2 * p);
    // fondo de "habitación": pared con baldosas de colores
    const cols = ['#5b3fa8', '#6a4cc0'];
    for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 6; xx++) { ctx.fillStyle = cols[(xx + yy) % 2]; ctx.fillRect(p + xx * 28, p + yy * 28, 28, 28); }
    ctx.save(); ctx.beginPath(); ctx.rect(p, p, fw - 2 * p, fh - 2 * p); ctx.clip();
    // estantería con bloques
    ctx.fillStyle = '#8d5524'; ctx.fillRect(p, 52, fw - 2 * p, 6);
    ['#5ef2ff', '#ffd23f', '#ff7ad9'].forEach((c, i) => { ctx.fillStyle = OSCURO; ctx.fillRect(16 + i * 22, 30, 20, 22); ctx.fillStyle = c; ctx.fillRect(18 + i * 22, 32, 16, 18); });
    ctx.drawImage(ICONOS.corazon, 128, 30, 27, 24);
    // busto del presentador
    const spr = spritePresentador(e, tl);
    const esc = 6, hablando = bocaAbierta(e.habla, tl);
    const bob = hablando ? -Math.abs(Math.sin(tl * 9)) * 4 : 0;
    ctx.drawImage(spr, 0, 0, 16, 22, R(fw / 2 - 48), R(22 + bob), 96, 132);
    ctx.restore();
    // etiqueta
    ctx.font = `600 20px ${FUENTE}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff3b5c'; ctx.fillRect(10, fh - 30, 12, 12);
    ctx.lineWidth = 5; ctx.strokeStyle = OSCURO; ctx.lineJoin = 'round';
    ctx.strokeText('CANAL PEQUES', 28, fh - 23); ctx.fillStyle = '#ffffff'; ctx.fillText('CANAL PEQUES', 28, fh - 23);
    ctx.restore();
  }
  // botón de "me gusta" con contador: e.megusta = { desde, toque, base }
  function meGusta(e, tl) {
    if (!e.megusta) return;
    const o = typeof e.megusta === 'object' ? e.megusta : {};
    const desde = o.desde != null ? o.desde : 1.2, toque = o.toque != null ? o.toque : desde + 1.6;
    const k = easeOutBack((tl - desde) / 0.5);
    if (k <= 0) return;
    const base = o.base || 1247;
    const n = base + (tl >= toque ? 1 : 0) + Math.max(0, Math.floor((tl - toque - 0.6) * 3));
    const txt = n.toLocaleString('es-ES').replace(/\s/g, '.');
    const golpe = tl >= toque && tl < toque + 0.35 ? 1 + 0.25 * Math.sin((tl - toque) / 0.35 * Math.PI) : 1;
    const salto = Math.abs(Math.sin(tl * 4)) * 6;
    ctx.font = `600 34px ${FUENTE}`;
    const tw = ctx.measureText(txt).width;
    const bw = R(tw + 96), bh = 62, x0 = W - bw - 24, y0 = 22 - salto;
    ctx.save();
    ctx.translate(x0 + bw / 2, y0 + bh / 2); ctx.scale(k * golpe, k * golpe); ctx.translate(-bw / 2, -bh / 2);
    const p = 6;
    ctx.fillStyle = OSCURO; ctx.fillRect(p, -3, bw - 2 * p, bh + 6); ctx.fillRect(-3, p, bw + 6, bh - 2 * p);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(p, 0, bw - 2 * p, bh); ctx.fillRect(0, p, bw, bh - 2 * p);
    ctx.fillStyle = '#e9e1ff'; ctx.fillRect(p, bh - 8, bw - 2 * p, 8);
    ctx.drawImage(ICONOS.corazon, 14, 12, 45, 40);
    ctx.fillStyle = OSCURO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 70, bh / 2 + 2);
    ctx.restore();
    // corazones que suben al tocar
    if (tl >= toque && tl < toque + 1.4) {
      for (let i = 0; i < 6; i++) {
        const d = tl - toque - i * 0.08; if (d < 0) continue;
        const a = 1 - d / 1.2; if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(ICONOS.corazon, R(x0 + 30 + (hash(i, 51) - 0.5) * 120), R(y0 + 60 + d * 120), 27, 24);
      }
      ctx.globalAlpha = 1;
    }
    // la mano que toca el botón
    const dm = tl - (toque - 0.7);
    if (dm > 0 && dm < 1.6) {
      const ida = clamp(dm / 0.7, 0, 1), vuelta = clamp((dm - 0.9) / 0.6, 0, 1);
      const px = x0 + 36, py = y0 + 34;
      const mx = lerp(px + 160, px, suave(ida) - suave(vuelta)), my = lerp(py + 220, py, suave(ida) - suave(vuelta));
      ctx.drawImage(MANO_SPR, R(mx - 4.5 * 5), R(my), MANO_SPR.width * 5, MANO_SPR.height * 5);
    }
  }

  // ---------------------------------------------------------------- ruedas que giran
  const RUEDAS = {}; // radio → [8 fotogramas]
  function construirRueda(radio, celda, colAro, colRadio) {
    const n = Math.ceil(radio / celda) * 2 + 1, c0 = (n - 1) / 2, rr = radio / celda;
    const fr = [];
    for (let f = 0; f < 8; f++) {
      const ang = f / 8 * Math.PI / 2;
      const cv = lienzoNuevo(n * celda, n * celda), g = cv.getContext('2d');
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = x - c0, dy = y - c0, d = Math.hypot(dx, dy);
        let col = null;
        if (d <= rr + 0.2) col = OSCURO;
        if (d <= rr - 0.8) col = colAro;
        if (d <= rr - 1.8) col = '#3b3355';
        if (d <= rr - 1.8) {
          for (let k = 0; k < 4; k++) {
            const a = ang + k * Math.PI / 2;
            const dist = Math.abs(-Math.sin(a) * dx + Math.cos(a) * dy), along = Math.cos(a) * dx + Math.sin(a) * dy;
            if (dist < 0.62 && along > -0.3) col = colRadio;
          }
        }
        if (d < 1.1) col = '#ffd23f';
        if (col) { g.fillStyle = col; g.fillRect(x * celda, y * celda, celda, celda); }
      }
      fr.push(cv);
    }
    return fr;
  }
  function rueda(cx, cy, radio, ang, clave) {
    const fr = RUEDAS[clave];
    const a = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const cv = fr[Math.floor(a / (Math.PI / 2) * 8) % 8];
    ctx.drawImage(cv, R(cx - cv.width / 2), R(cy - cv.height / 2));
  }

  // ---------------------------------------------------------------- vías
  function vias(t) {
    const off = cam(t), s = 32;
    const c0 = Math.floor(off / s) - 1;
    for (let c = c0; c < c0 + W / s + 3; c++) {
      const x = R(c * s - off);
      ctx.fillStyle = '#5d3a1a'; ctx.fillRect(x + 4, TR.riel + 2, 22, 10);
      ctx.fillStyle = '#7a4c22'; ctx.fillRect(x + 4, TR.riel + 2, 22, 3);
    }
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(0, TR.riel, W, 5);
    ctx.fillStyle = '#d8dee6'; ctx.fillRect(0, TR.riel, W, 2);
    ctx.fillStyle = '#4b5260'; ctx.fillRect(0, TR.riel + 5, W, 2);
  }

  // ---------------------------------------------------------------- locomotora
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(R(x), R(y), R(w), R(h)); }
  function cajaBloque(x, y, w, h, col) { // caja con borde oscuro y bisel de bloque
    rect(x - 3, y - 3, w + 6, h + 6, OSCURO);
    rect(x, y, w, h, col);
    rect(x, y, w, 5, mezclaColor(col, 0.4)); rect(x, y, 5, h, mezclaColor(col, 0.25));
    rect(x, y + h - 6, w, 6, mezclaColor(col, 0.3, OSCURO)); rect(x + w - 5, y, 5, h, mezclaColor(col, 0.2, OSCURO));
  }
  function locomotora(x, dy, ang, t) {
    const y = dy;
    // apartavacas escalonado
    for (let k = 0; k < 4; k++) rect(x + k * 5, y + 524 + k * 0, 26 - k * 5, 0, '#000');
    for (let k = 0; k < 5; k++) { rect(x - 2 + k * 4, y + 520 + k * 9, 24 - k * 4, 9, k % 2 ? '#c62828' : '#e53935'); }
    rect(x - 4, y + 516, 30, 6, OSCURO);
    // chasis
    rect(x + 6, y + 532, 178, 14, OSCURO);
    // caldera
    cajaBloque(x + 20, y + 468, 118, 66, '#37474f');
    for (const bx of [44, 76, 108]) rect(x + bx, y + 468, 6, 66, '#ffc107');
    rect(x + 12, y + 464, 12, 72, '#263238'); // caja de humos
    // faro
    const brillo = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.fillStyle = `rgba(255,240,150,${0.25 + 0.2 * brillo})`; ctx.fillRect(R(x - 30), R(y + 470), 40, 28);
    rect(x - 2, y + 474, 16, 20, OSCURO); rect(x + 1, y + 477, 10, 14, '#fff27a'); rect(x + 2, y + 478, 4, 4, '#ffffff');
    // chimenea
    rect(x + 31, y + 424, 26, 46, OSCURO); rect(x + 34, y + 428, 20, 42, '#455a64');
    rect(x + 25, y + 414, 38, 14, OSCURO); rect(x + 28, y + 417, 32, 8, '#607d8b');
    // cúpula dorada
    rect(x + 75, y + 454, 24, 16, OSCURO); rect(x + 78, y + 457, 18, 13, '#ffc107'); rect(x + 80, y + 458, 6, 4, '#fff1a1');
    // cabina
    cajaBloque(x + 116, y + 404, 70, 130, '#5e35b1');
    rect(x + 108, y + 394, 86, 12, OSCURO); rect(x + 111, y + 396, 80, 7, '#7e57c2');
    rect(x + 128, y + 418, 44, 36, OSCURO); rect(x + 131, y + 421, 38, 30, '#b3e5fc'); rect(x + 133, y + 423, 10, 6, '#ffffff');
    // placa
    rect(x + 128, y + 468, 46, 26, OSCURO); rect(x + 131, y + 471, 40, 20, '#ffc107');
    ctx.font = `600 20px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = OSCURO;
    ctx.fillText('JP', R(x + 151), R(y + 482));
    // franja arcoíris
    for (let k = 0; k < 6; k++) rect(x + 20, y + 506 + k * 3, 166, 3, ARCOIRIS[k]);
    // ruedas: dos motrices grandes + una pequeña
    const r1 = 22, r2 = 15;
    const ruedas = [[x + 50, r1, 'g'], [x + 102, r1, 'g'], [x + 160, r2, 'p']];
    for (const [cx, r, cl] of ruedas) rueda(cx, y + TR.riel - r, r, ang * (r2 / r), cl);
    // biela
    const ab = ang * (r2 / r1);
    const px1 = x + 50 + Math.cos(ab) * 11, py1 = y + TR.riel - r1 + Math.sin(ab) * 11;
    rect(px1 - 3, py1 - 3, 52 + 6, 6, '#cfd8dc'); rect(px1 - 3, py1 + 1, 58, 2, '#78909c');
    rect(px1 - 4, py1 - 4, 8, 8, OSCURO); rect(px1 + 48, py1 - 4, 8, 8, OSCURO);
    // enganche
    rect(x + 186, y + 520, 14, 8, OSCURO);
  }

  // ---------------------------------------------------------------- vagón
  function vagon(i, x, dy, ang, opt) {
    const d = dias()[i];
    const y = dy;
    const vw = TR.vw;
    // chasis y ruedas
    rect(x + 4, y + 532, vw - 8, 12, OSCURO);
    rueda(x + 32, y + TR.riel - 15, 15, ang, 'p');
    rueda(x + vw - 32, y + TR.riel - 15, 15, ang, 'p');
    // enganches
    rect(x - 8, y + 520, 10, 8, OSCURO); rect(x + vw - 2, y + 520, 10, 8, OSCURO);
    // caja
    cajaBloque(x, y + TR.cuerpo, vw, TR.base - TR.cuerpo, d.color);
    // tablones
    for (let k = 1; k < 4; k++) rect(x + k * vw / 4 - 1, y + TR.cuerpo + 44, 2, 66, mezclaColor(d.color, 0.18, OSCURO));
    // techo
    rect(x - 7, y + TR.techo - 3, vw + 14, 14, OSCURO);
    rect(x - 4, y + TR.techo, vw + 8, 8, mezclaColor(d.color, 0.35, OSCURO));
    rect(x - 4, y + TR.techo, vw + 8, 3, mezclaColor(d.color, 0.15, '#ffffff'));
    // nombre (blanco con borde oscuro, cabe en la caja)
    const txt = d.nombre.toUpperCase();
    let fs = 27;
    ctx.font = `600 ${fs}px ${FUENTE}`;
    while (ctx.measureText(txt).width > vw - 18 && fs > 14) { fs--; ctx.font = `600 ${fs}px ${FUENTE}`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = OSCURO; ctx.strokeText(txt, R(x + vw / 2), R(y + TR.cuerpo + 25));
    ctx.fillStyle = '#ffffff'; ctx.fillText(txt, R(x + vw / 2), R(y + TR.cuerpo + 25));
    // icono de la actividad sobre una placa clara
    rect(x + vw / 2 - 37, y + TR.cuerpo + 44, 74, 70, OSCURO);
    rect(x + vw / 2 - 34, y + TR.cuerpo + 47, 68, 64, mezclaColor(d.color, 0.72));
    const ic = ICONOS[d.icono] || ICONOS.casa;
    ctx.drawImage(ic, R(x + vw / 2 - ic.width * 2.5), R(y + TR.cuerpo + 79 - ic.height * 2.5), ic.width * 5, ic.height * 5);
    // marca de "cole" (mochila) en los días de diario
    if (d.cole) {
      rect(x + vw - 30, y + TR.cuerpo + 46, 26, 28, OSCURO); rect(x + vw - 28, y + TR.cuerpo + 48, 22, 24, '#ffffff');
      ctx.drawImage(ICONOS.mochila, R(x + vw - 27), R(y + TR.cuerpo + 50), 21, 24);
    }
    // número de orden
    if (opt.numero) {
      rect(x + 4, y + TR.cuerpo + 46, 28, 28, OSCURO); rect(x + 6, y + TR.cuerpo + 48, 24, 24, '#ffd23f');
      ctx.font = `600 22px ${FUENTE}`; ctx.fillStyle = OSCURO; ctx.fillText(String(i + 1), R(x + 18), R(y + TR.cuerpo + 61));
    }
    // destello y atenuado
    if (opt.destello > 0) { ctx.fillStyle = `rgba(255,255,255,${0.75 * opt.destello})`; ctx.fillRect(R(x), R(y + TR.techo - 3), vw, TR.base - TR.techo + 3); }
    if (opt.apagado > 0) { ctx.fillStyle = `rgba(25,12,50,${0.32 * opt.apagado})`; ctx.fillRect(R(x - 7), R(y + TR.techo - 3), vw + 14, TR.riel - TR.techo + 3); }
    // marco brillante si está en foco
    if (opt.foco > 0) {
      const g = 4 + R(2 * Math.sin(opt.tt * 10));
      ctx.globalAlpha = opt.foco;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = g + 4; ctx.strokeRect(R(x - 14), R(y + TR.techo - 12), vw + 28, TR.base - TR.techo + 22);
      ctx.strokeStyle = '#fff27a'; ctx.lineWidth = g; ctx.strokeRect(R(x - 14), R(y + TR.techo - 12), vw + 28, TR.base - TR.techo + 22);
      ctx.globalAlpha = 1;
      for (let k = 0; k < 4; k++) {
        const a = opt.tt * 2.2 + k * Math.PI / 2;
        chispa(x + vw / 2 + Math.cos(a) * (vw * 0.62), y + 476 + Math.sin(a) * 82, 0.7 + 0.3 * Math.sin(opt.tt * 8 + k), k % 2 ? '#ffffff' : '#fff27a');
      }
    }
  }

  // ---------------------------------------------------------------- humo
  function humo(e, t, xChim, yChim) {
    const tl = t - e.inicio;
    const cada = 0.16;
    for (let j = 0; j < 14; j++) {
      const nac = (Math.floor(tl / cada) - j) * cada;
      if (nac < -2) continue;
      const edad = tl - nac;
      if (edad < 0 || edad > 1.9) continue;
      const v = velEscena(e, nac);
      const id = Math.floor(nac / cada + 1000);
      const x = xChim + (-v) * 0.55 * edad + (hash(id, 5) - 0.5) * 16 + edad * 10;
      const y = yChim - edad * (70 + hash(id, 6) * 40) - 6;
      const tam = R((10 + edad * 18) / 4) * 4;
      const a = (1 - edad / 1.9) * 0.9;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#9aa5b8'; ctx.fillRect(R((x - tam / 2) / 4) * 4 - 4, R((y - tam / 2) / 4) * 4 - 4, tam + 8, tam + 8);
      ctx.fillStyle = '#e9edf5'; ctx.fillRect(R((x - tam / 2) / 4) * 4, R((y - tam / 2) / 4) * 4, tam, tam);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(R((x - tam / 2) / 4) * 4, R((y - tam / 2) / 4) * 4, R(tam * 0.6), R(tam * 0.5));
      ctx.fillRect(R((x - tam / 2 - tam * 0.45) / 4) * 4, R((y + tam * 0.1) / 4) * 4, R(tam * 0.6), R(tam * 0.5));
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- foco, cámara y llegadas
  function focoEn(e, tl) {
    const fs = e.foco || [];
    let act = null;
    for (const f of fs) if (tl >= f.t && (f.dur == null || tl < f.t + f.dur)) act = f;
    return act;
  }
  function camaraEn(e, tl) {
    const ks = e.camara || [];
    const resolver = (k) => {
      const z = k.zoom || 1;
      let cx = k.x != null ? k.x : W / 2, cy = k.y != null ? k.y : H / 2;
      if (k.dias && k.dias.length) cx = k.dias.reduce((s, i) => s + vagonCx(i), 0) / k.dias.length;
      if (k.y == null) cy = Math.max(H / 2, TR.riel - 226 / z);
      return { z, cx: clamp(cx, W / (2 * z), W - W / (2 * z)), cy: clamp(cy, H / (2 * z), H - H / (2 * z)) };
    };
    let st = { z: 1, cx: W / 2, cy: H / 2 };
    for (const k of ks) {
      if (tl < k.t) break;
      const obj = resolver(k), q = suave((tl - k.t) / (k.dur || 0.9));
      st = { z: lerp(st.z, obj.z, q), cx: lerp(st.cx, obj.cx, q), cy: lerp(st.cy, obj.cy, q) };
    }
    // vuelve a calcular los límites con el zoom intermedio
    st.cx = clamp(st.cx, W / (2 * st.z), W - W / (2 * st.z)); st.cy = clamp(st.cy, H / (2 * st.z), H - H / (2 * st.z));
    return st;
  }
  function aplicarCamara(c) { ctx.setTransform(c.z, 0, 0, c.z, W / 2 - c.cx * c.z, H / 2 - c.cy * c.z); }
  // desplazamiento horizontal extra de un vehículo que todavía está llegando (0 = en su sitio)
  function llegada(tLleg, tl, xSitio) {
    if (tLleg == null) return { dx: 0, visible: true };
    const k = (tl - tLleg) / 0.85;
    if (k <= 0) return { dx: W + 80 - xSitio, visible: false };
    // frena al llegar y da un pequeño "clonc" al engancharse (sin pisar al vagón de delante)
    const golpe = k > 1 && k < 1.4 ? -Math.sin((k - 1) / 0.4 * Math.PI) * 5 : 0;
    return { dx: (1 - easeOutCubic(k)) * (W + 80 - xSitio) + golpe, visible: true };
  }

  // ---------------------------------------------------------------- estación de fin de semana
  function estacionX(e, t) {
    const o = e.estacion; if (!o) return null;
    const tParada = e.inicio + (o.t != null ? o.t : 0);
    return (o.x != null ? o.x : vagonX(5) - 16) + (cam(tParada) - cam(t));
  }
  const ANCHO_EST = TR.paso + TR.vw + 32;
  function estacionDetras(e, tl, t) {
    const x = estacionX(e, t); if (x == null || x > W + 40 || x + ANCHO_EST < -40) return;
    const o = e.estacion;
    // postes
    for (const px of [x + 14, x + ANCHO_EST - 28]) { rect(px - 3, 330, 20, 210, OSCURO); rect(px, 330, 14, 210, '#8d5524'); rect(px, 330, 4, 210, '#b0773c'); }
    // tejado de rayas (morado/rosa)
    const ty = 312;
    rect(x - 10, ty - 3, ANCHO_EST + 20, 30, OSCURO);
    for (let k = 0; k * 24 < ANCHO_EST + 14; k++) rect(x - 7 + k * 24, ty, Math.min(24, ANCHO_EST + 14 - k * 24), 24, k % 2 ? '#f06292' : '#8e24aa');
    for (let k = 0; k * 24 < ANCHO_EST + 14; k++) { rect(x - 7 + k * 24, ty + 24, 24, 8, k % 2 ? '#f06292' : '#8e24aa'); rect(x - 7 + k * 24 + 6, ty + 32, 12, 6, k % 2 ? '#f06292' : '#8e24aa'); }
    // banderines
    for (let k = 0; k < 9; k++) {
      const bx = x + 10 + k * (ANCHO_EST - 20) / 8, by = ty + 44 + Math.sin(k / 8 * Math.PI) * 10;
      ctx.fillStyle = ARCOIRIS[k % 7];
      ctx.beginPath(); ctx.moveTo(bx - 9, by); ctx.lineTo(bx + 9, by); ctx.lineTo(bx, by + 18); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = OSCURO; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k <= 16; k++) { const bx = x + 10 + k * (ANCHO_EST - 20) / 16, by = ty + 44 + Math.sin(k / 16 * Math.PI) * 10; k ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by); }
    ctx.stroke();
    // cartel FIN DE SEMANA
    const kc = o.finde != null ? easeOutBack((tl - o.finde) / 0.5) : 1;
    const cw = ANCHO_EST - 4, ch = 58, cx = x + ANCHO_EST / 2, cy = ty - 40;
    rect(cx - cw / 2 + 30, cy, 8, 40, OSCURO); rect(cx + cw / 2 - 38, cy, 8, 40, OSCURO);
    ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(0.5, kc), Math.max(0.5, kc));
    const encendido = kc >= 0.99 && Math.floor(tl * 4) % 2 === 0;
    rect(-cw / 2 - 4, -ch / 2 - 4, cw + 8, ch + 8, OSCURO);
    rect(-cw / 2, -ch / 2, cw, ch, '#ffd23f'); rect(-cw / 2, -ch / 2, cw, 6, '#fff1a1'); rect(-cw / 2, ch / 2 - 6, cw, 6, '#e09a00');
    for (let k = 0; k < 14; k++) { const bx = -cw / 2 + 8 + k * (cw - 16) / 13; rect(bx - 3, -ch / 2 + 9, 6, 6, (k + (encendido ? 1 : 0)) % 2 ? '#ffffff' : '#ff6f61'); rect(bx - 3, ch / 2 - 15, 6, 6, (k + (encendido ? 0 : 1)) % 2 ? '#ffffff' : '#ff6f61'); }
    let fsc = 34;
    ctx.font = `600 ${fsc}px ${FUENTE}`;
    while (ctx.measureText('FIN DE SEMANA').width > cw - 34 && fsc > 18) { fsc--; ctx.font = `600 ${fsc}px ${FUENTE}`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.strokeText('FIN DE SEMANA', 0, 2);
    ctx.fillStyle = '#8e24aa'; ctx.fillText('FIN DE SEMANA', 0, 2);
    ctx.restore();
  }
  function estacionDelante(e, tl, t) {
    const x = estacionX(e, t); if (x == null || x > W + 40 || x + ANCHO_EST < -40) return;
    // andén de piedra delante de las ruedas
    const s = 32, y = 536;
    for (let k = 0; k * s < ANCHO_EST; k++) { bloque('piedra', x + k * s, y, s); bloque('piedra', x + k * s, y + s, s); }
    rect(x, y - 6, Math.ceil(ANCHO_EST / s) * s, 8, '#ffd23f');
    for (let k = 0; k * 24 < ANCHO_EST; k += 2) rect(x + k * 24, y - 6, 24, 8, OSCURO);
    // fiesta: confeti que cae al anunciarse
    const o = e.estacion;
    if (o.finde != null && tl > o.finde) {
      for (let i = 0; i < 26; i++) {
        const d = tl - o.finde - hash(i, 71) * 0.6; if (d < 0) continue;
        const cx = x + hash(i, 72) * ANCHO_EST, cy = 260 + ((d * (90 + hash(i, 73) * 80)) % 300);
        ctx.fillStyle = ARCOIRIS[i % 7]; ctx.fillRect(R(cx / 4) * 4, R(cy / 4) * 4, Math.floor(tl * 6 + i) % 2 ? 8 : 12, Math.floor(tl * 6 + i) % 2 ? 12 : 8);
      }
    }
  }
  function cartelCole(e, tl) {
    const o = e.estacion; if (!o || o.cole == null) return;
    const k = easeOutBack((tl - o.cole) / 0.5);
    if (k <= 0) return;
    const x0 = vagonX(0) - 6, x1 = vagonX(4) + TR.vw + 6, yb = 392;
    // corchete sobre los vagones de diario
    ctx.globalAlpha = clamp(k, 0, 1);
    rect(x0, yb - 4, x1 - x0, 6, '#ffffff'); rect(x0, yb - 4, 6, 14, '#ffffff'); rect(x1 - 6, yb - 4, 6, 14, '#ffffff');
    rect(x0, yb + 2, x1 - x0, 2, OSCURO);
    ctx.globalAlpha = 1;
    const cx = (x0 + x1) / 2, cy = 346;
    ctx.save(); ctx.translate(cx, cy - (1 - clamp(k, 0, 1)) * 40); ctx.scale(k, k);
    const cw = 250, chh = 64;
    rect(-cw / 2 - 4, -chh / 2 - 4, cw + 8, chh + 8, OSCURO);
    rect(-cw / 2, -chh / 2, cw, chh, '#ffffff'); rect(-cw / 2, chh / 2 - 6, cw, 6, '#d6d0e6');
    rect(-3, chh / 2, 6, 14, OSCURO);
    ctx.drawImage(ICONOS.cole, -cw / 2 + 10, -chh / 2 + 6, 14 * 4, 13 * 4);
    ctx.font = `600 44px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e53935'; ctx.fillText('COLE', 30, 3);
    ctx.drawImage(ICONOS.mochila, cw / 2 - 40, -chh / 2 + 14, 28, 32);
    ctx.restore();
  }

  // ---------------------------------------------------------------- el tren completo
  function dibujarTren(e, tl, t, extra = {}) {
    const ang = cam(t) / 15;
    const foco = focoEn(e, tl);
    const enFoco = new Set(foco ? foco.dias : []);
    // locomotora
    const ll = llegada(e.llegadaLoco, tl, TR.locoX);
    const xLoco = TR.locoX + ll.dx;
    const vagonesYDy = [];
    for (let i = 0; i < 7; i++) {
      const lv = llegada(e.llegadas ? e.llegadas[i] : null, tl, vagonX(i));
      if (!lv.visible) continue;
      let dy = 0, destello = 0, focoK = 0;
      if (enFoco.has(i)) {
        const d = tl - foco.t;
        dy = -Math.abs(Math.sin(d * 7)) * 26 * Math.exp(-d * 1.5) - 6 - Math.sin(tl * 5) * 4;
        destello = clamp(1 - d / 0.35, 0, 1);
        focoK = clamp(d / 0.2, 0, 1);
      }
      if (extra.golpe && extra.golpe.dia === i) {
        const d = tl - extra.golpe.t;
        if (d < 0.38) dy = Math.min(dy, -Math.sin(clamp(d / 0.38, 0, 1) * Math.PI) * 70);
        destello = Math.max(destello, clamp(1 - d / 0.25, 0, 1));
        focoK = Math.max(focoK, clamp(1 - (d - 0.3) / 0.3, 0, 1));
      }
      // velocidad extra de las ruedas mientras llega
      vagonesYDy.push({ i, x: vagonX(i) + lv.dx, dy, ang: ang - lv.dx / 15, destello, focoK,
        apagado: foco && !enFoco.has(i) ? clamp((tl - foco.t) / 0.3, 0, 1) : 0 });
    }
    // de atrás hacia delante para que los enganches queden bien
    for (let k = vagonesYDy.length - 1; k >= 0; k--) {
      const v = vagonesYDy[k];
      vagon(v.i, v.x, v.dy, v.ang, { numero: e.numeros, destello: v.destello, apagado: v.apagado * 0.8, foco: v.focoK, tt: tl + v.i });
    }
    if (ll.visible) {
      const dyL = extra.saltoLoco || 0;
      locomotora(xLoco, dyL, ang - ll.dx / 15, t);
      // unicornio montado sobre la caldera (mira hacia la izquierda, hacia donde va el tren)
      const galope = Math.abs(velEscena(e, tl)) > 5;
      const fr = galope ? Math.floor(t * 10) % 4 : 0;
      const spr = UNI[fr], esc = 3;
      const brinco = galope ? -Math.abs(Math.sin(t * 5)) * 8 : -Math.abs(Math.sin(t * 2)) * 3;
      const ux = R(xLoco + 44), uy = R(468 + dyL + brinco - spr.pieY * esc);
      ctx.save(); ctx.translate(ux + spr.w * esc, uy); ctx.scale(-1, 1); ctx.drawImage(spr.c, 0, 0, spr.w * esc, spr.h * esc); ctx.restore();
      humo(e, t, xLoco + 44, 412 + dyL);
    }
  }

  // ---------------------------------------------------------------- textos grandes
  function cajaTexto(txt, cx, cy, fs, fondo, tinta) {
    ctx.font = `600 ${fs}px ${FUENTE}`;
    const tw = ctx.measureText(txt).width, bw = R(tw + fs * 1.2), bh = R(fs * 1.5), p = 6;
    const x = R(cx - bw / 2), y = R(cy - bh / 2);
    rect(x + p, y - 4, bw - 2 * p, bh + 8, OSCURO); rect(x - 4, y + p, bw + 8, bh - 2 * p, OSCURO);
    rect(x + p, y, bw - 2 * p, bh, fondo); rect(x, y + p, bw, bh - 2 * p, fondo);
    rect(x + p, y, bw - 2 * p, 5, mezclaColor(fondo, 0.45));
    rect(x + p, y + bh - 6, bw - 2 * p, 6, mezclaColor(fondo, 0.3, OSCURO));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (tinta === '#ffffff') { ctx.lineWidth = 7; ctx.strokeStyle = OSCURO; ctx.strokeText(txt, cx, cy + 2); }
    ctx.fillStyle = tinta; ctx.fillText(txt, cx, cy + 2);
  }
  // nombre de un día en letras de bloque que "salta" (k = 0..1+ con rebote)
  function nombreBloques(txt, color, cx, cy, celda, k) {
    if (k <= 0) return;
    const m = maquetarBloques(txt, 2000, celda);
    const c = celda;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
    const y0 = -(m.alto * c) / 2;
    for (const cel of m.celdas) { ctx.fillStyle = 'rgba(30,10,60,0.35)'; ctx.fillRect(R(cel.x * c) + 4, R(y0 + cel.y * c) + 4, c, c); }
    for (const cel of m.celdas) celdaBiselada(R(cel.x * c), R(y0 + cel.y * c), c, color);
    ctx.restore();
  }
  function etiquetaFoco(e, tl) {
    const f = focoEn(e, tl);
    if (!f || f.etiqueta === false) return;
    const ds = dias();
    const d = f.dias.length === 1 ? ds[f.dias[0]] : null;
    const titulo = typeof f.etiqueta === 'string' ? f.etiqueta : d ? d.nombre : null;
    if (!titulo) return;
    const k = easeOutBack((tl - f.t) / 0.45);
    nombreBloques(titulo, d ? d.color : '#ff5fa2', W / 2, 78, 14, k);
    if (d && d.actividad) {
      const k2 = easeOutBack((tl - f.t - 0.3) / 0.45);
      if (k2 > 0) { ctx.save(); ctx.translate(W / 2, 184); ctx.scale(k2, k2); cajaTexto(d.actividad.toUpperCase(), 0, 0, 40, '#ffffff', OSCURO); ctx.restore(); }
    }
  }
  function contadorVagones(e, tl) {
    if (!e.contador || !e.llegadas) return;
    let n = 0, ult = -9;
    e.llegadas.forEach((a) => { if (tl >= a + 0.45) { n++; ult = Math.max(ult, a + 0.45); } });
    if (!n) return;
    const k = 1 + 0.35 * Math.exp(-(tl - ult) * 7);
    nombreBloques(String(n), ARCOIRIS[(n - 1) % 7], W / 2 - 150, 92, 14, k);
    ctx.save(); ctx.translate(W / 2 + 60, 96);
    cajaTexto(n === 1 ? 'VAGÓN' : 'VAGONES', 0, 0, 40, '#ffffff', OSCURO);
    ctx.restore();
  }
  function cartelesGrandes(e, tl) {
    for (const c of e.carteles || []) {
      const d = tl - c.t, dur = c.dur || 1.3;
      if (d < 0 || d > dur) continue;
      const k = easeOutBack(d / 0.35) * clamp((dur - d) / 0.2, 0, 1);
      const temblor = Math.sin(d * 50) * 4 * clamp(1 - d / 0.8, 0, 1);
      ctx.save(); ctx.translate(W / 2 + temblor, 190); ctx.rotate(-0.05); ctx.scale(k, k);
      cajaTexto(c.texto, 0, 0, 74, c.color || '#ff3b5c', '#ffffff');
      ctx.restore();
    }
  }
  function lineasVelocidad(e, t) {
    const v = Math.abs(velEscena(e, t - e.inicio));
    if (v < 190) return;
    const a = clamp((v - 190) / 200, 0, 1);
    ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
    for (let i = 0; i < 14; i++) {
      const y = R(40 + hash(i, 81) * 300), lw = 80 + hash(i, 82) * 160;
      const x = ((hash(i, 83) * (W + 400) + t * (900 + hash(i, 84) * 500)) % (W + 400)) - 300;
      ctx.fillRect(R(x), y, R(lw), 6);
    }
  }
  // tira de karaoke con los 7 días (cantinela)
  function tiraDias(e, tl, golpe) {
    const ds = dias();
    const ini = e.golpes && e.golpes.length ? e.golpes[0].t - 0.3 : 0;
    const k = clamp((tl - ini) / 0.3, 0, 1);
    if (k <= 0) return;
    const y = H - 62, alto = 72;
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(28,14,56,0.78)'; ctx.fillRect(20, y - alto / 2, W - 40, alto);
    const paso = (W - 60) / 7;
    for (let i = 0; i < 7; i++) {
      const cx = 30 + paso * (i + 0.5);
      const activo = golpe && golpe.dia === i && tl - golpe.t < 0.9;
      const txt = ds[i].nombre.toUpperCase();
      if (activo) {
        const kk = 1 + 0.25 * Math.exp(-(tl - golpe.t) * 8);
        ctx.save(); ctx.translate(cx, y); ctx.scale(kk, kk);
        cajaTexto(txt, 0, 0, 26, ds[i].color, '#ffffff');
        ctx.restore();
      } else {
        ctx.font = `600 24px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(txt, cx, y + 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function golpeEn(e, tl) {
    let g = null;
    for (const x of e.golpes || []) if (tl >= x.t) g = x;
    return g;
  }

  function escenaTren(e, tl, t) {
    const c = camaraEn(e, tl);
    aplicarCamara(c);
    fondoMundo(t, true);
    vias(t);
    estacionDetras(e, tl, t);
    const g = e.tipo === 'cantinela' ? golpeEn(e, tl) : null;
    dibujarTren(e, tl, t, { golpe: g });
    estacionDelante(e, tl, t);
    cartelCole(e, tl);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (e.tipo === 'cantinela') {
      lineasVelocidad(e, t);
      const hayCartel = (e.carteles || []).some((c) => tl >= c.t - 0.15 && tl < c.t + (c.dur || 1.3));
      if (g && tl - g.t < 0.9 && !hayCartel) {
        const d = tl - g.t;
        const k = easeOutBack(d / 0.18) * clamp((0.9 - d) / 0.15, 0, 1);
        nombreBloques(dias()[g.dia].nombre, dias()[g.dia].color, W / 2, 190, 20, k);
      }
      cartelesGrandes(e, tl);
      tiraDias(e, tl, g);
    } else {
      etiquetaFoco(e, tl);
      contadorVagones(e, tl);
      cartelesGrandes(e, tl);
    }
  }

  // ------------------------------------------------------------------ API
  function fondoMundo(t, plano = false) {
    cielo(t);
    montanas(t);
    colinas(t);
    sol(t);
    nubes(t);
    islas(t);
    suelo(t, plano);
  }
  function pintar(t) {
    if (!TL) throw new Error('llama antes a cargar(timeline)');
    t = clamp(t, 0, TL.duracion);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const e = escenaEn(t);
    const tl = t - e.inicio;

    if (e.tipo === 'tren' || e.tipo === 'cantinela') escenaTren(e, tl, t);
    else fondoMundo(t);

    if (e.tipo === 'titulo') escenaTitulo(e, tl, t);
    else if (e.tipo === 'final') escenaFinal(e, tl, t);

    const pu = posUnicornio(t);
    if (pu && pu.visible) { estela(t, posUnicornio, UNI); dibujarUnicornio(t, pu, UNI); }
    presentador(e, tl);
    meGusta(e, tl);
    facecam(e, tl);

    if (e.tipo === 'capturas') { tableta(e, tl, t); }
    if (e.tipo === 'final') {
      logoFinal(e, tl);
      const pv = posVolador(t);
      if (pv && pv.visible) { estela(t, posVolador, UNI_ROSA, { cielo: true, n: 28, banda: 4 }); dibujarUnicornio(t, pv, UNI_ROSA, true); }
    }
    if (e.titulo && e.tipo === 'capturas') pancarta(e.titulo, tl);
    subtitulo(e, tl);
    cortina(t);
    // fundido de entrada
    if (t < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.35})`; ctx.fillRect(0, 0, W, H); }
  }

  function cargarImagen(src) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => { // marcador de posición si falta la imagen
        const c = lienzoNuevo(1024, 768), g = c.getContext('2d');
        g.fillStyle = '#ffe9c7'; g.fillRect(0, 0, 1024, 768);
        g.fillStyle = '#ff9f1c'; g.font = `600 60px ${FUENTE}`; g.textAlign = 'center'; g.fillText('Juegos peques', 512, 384);
        console.warn('No se pudo cargar', src.slice(0, 80));
        res(c);
      };
      im.src = src;
    });
  }

  async function cargar(timeline) {
    TL = timeline;
    TL.escenas = [...TL.escenas].sort((a, b) => a.inicio - b.inicio);
    crearTexturas();
    UNI = [0, 1, 2, 3].map((f) => construirUnicornio(f, PAL_UNI));
    UNI_ROSA = [0, 1, 2, 3].map((f) => construirUnicornio(f, PAL_UNI_ROSA));
    MANO_SPR = spriteDeMatriz(MANO, { K: '#2d1b4e', W: '#ffffff', S: '#d9d2ee' });
    for (const [k, v] of Object.entries(ICONOS_DEF)) ICONOS[k] = spriteDeMatriz(v.filas, v.pal);
    RUEDAS.p = construirRueda(15, 3, '#cfd8dc', '#ffd23f');
    RUEDAS.g = construirRueda(22, 3, '#e53935', '#ffd23f');
    construirPresentador();
    // desplazamiento del mundo acumulado al empezar cada escena (ver cam)
    let acum = TL.escenas.length ? TL.escenas[0].inicio * VEL_MUNDO : 0;
    for (const e of TL.escenas) { e._cam0 = acum; acum += avanceEscena(e, e.fin - e.inicio); }
    try { await document.fonts.load(`600 40px "Pixelify Sans"`); } catch (err) { console.warn('fuente', err); }
    await document.fonts.ready;
    const srcs = new Set();
    for (const e of TL.escenas) for (const c of e.capturas || []) srcs.add(c.src);
    const lista = [...srcs];
    const imgs = await Promise.all(lista.map(cargarImagen));
    lista.forEach((s, i) => IMGS.set(s, imgs[i]));
    cachePaginas.clear();
    return { imagenes: lista.length, fuente: document.fonts.check(`600 40px "Pixelify Sans"`) };
  }

  window.cargar = cargar;
  window.pintar = pintar;
  window.__escena = { lienzo };
})();
