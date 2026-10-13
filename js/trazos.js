// Forma de cada número y letra, en una cuadrícula de 100 x 100 (y hacia abajo).
// Cada carácter es una lista de trazos, en el orden en que se enseñan.
// Comandos: ['L', x, y] = línea hasta (x, y) (la primera fija el inicio)
//           ['E', cx, cy, rx, ry, desde°, hasta°] = arco de elipse (0° derecha, 90° abajo, -90° arriba)
(function (root) {
  const L = (x, y) => ['L', x, y];
  const E = (cx, cy, rx, ry, a0, a1) => ['E', cx, cy, rx, ry, a0, a1];
  const O_ = [E(50, 50, 25, 35, -90, -450)];
  const P_ = [[L(32, 15), L(32, 85)], [L(32, 15), L(50, 15), E(50, 33, 18, 18, -90, 90), L(32, 51)]];

  const GLIFOS = {
    0: [O_],
    1: [[L(38, 32), L(55, 15), L(55, 85)]],
    2: [[E(50, 35, 20, 20, 180, 400), L(30, 85), L(72, 85)]],
    3: [[E(48, 32, 17, 17, 210, 450), E(48, 67, 18, 18, 270, 510)]],
    4: [[L(58, 15), L(28, 62), L(75, 62)], [L(62, 32), L(62, 85)]],
    5: [[L(36, 15), L(35, 46), E(48, 62, 21, 21, 230, 510)], [L(36, 15), L(68, 15)]],
    6: [[E(64, 55, 32, 40, -95, -180), E(52, 64, 21, 21, 180, 540)]],
    7: [[L(30, 15), L(70, 15), L(42, 85)]],
    8: [[E(50, 32, 16, 17, -90, -450)], [E(50, 67, 19, 18, -90, 270)]],
    9: [[E(48, 35, 18, 20, 0, -360), L(66, 85)]],

    A: [[L(50, 15), L(25, 85)], [L(50, 15), L(75, 85)], [L(34, 60), L(66, 60)]],
    B: [[L(32, 15), L(32, 85)],
        [L(32, 15), L(52, 15), E(52, 32, 17, 17, -90, 90), L(32, 49), L(55, 49), E(55, 67, 18, 18, -90, 90), L(32, 85)]],
    C: [[E(52, 50, 25, 35, -35, -325)]],
    D: [[L(32, 15), L(32, 85)], [L(32, 15), L(45, 15), E(45, 50, 25, 35, -90, 90), L(32, 85)]],
    E: [[L(35, 15), L(35, 85)], [L(35, 15), L(68, 15)], [L(35, 50), L(62, 50)], [L(35, 85), L(68, 85)]],
    F: [[L(35, 15), L(35, 85)], [L(35, 15), L(68, 15)], [L(35, 50), L(62, 50)]],
    G: [[E(52, 50, 25, 35, -35, -360), L(56, 50)]],
    H: [[L(30, 15), L(30, 85)], [L(70, 15), L(70, 85)], [L(30, 50), L(70, 50)]],
    I: [[L(50, 15), L(50, 85)]],
    J: [[L(62, 15), L(62, 65), E(48, 65, 14, 20, 0, 180)]],
    K: [[L(32, 15), L(32, 85)], [L(70, 15), L(33, 55), L(70, 85)]],
    L: [[L(35, 15), L(35, 85), L(70, 85)]],
    M: [[L(25, 85), L(25, 15), L(50, 60), L(75, 15), L(75, 85)]],
    N: [[L(30, 85), L(30, 15), L(70, 85), L(70, 15)]],
    'Ñ': [[L(30, 85), L(30, 25), L(70, 85), L(70, 25)], [L(36, 13), L(45, 6), L(55, 13), L(64, 6)]],
    O: [O_],
    P: P_,
    Q: [O_, [L(55, 65), L(76, 90)]],
    R: [...P_, [L(46, 51), L(72, 85)]],
    S: [[E(50, 32, 18, 17, -20, -270), E(50, 67, 18, 18, -90, 160)]],
    T: [[L(25, 15), L(75, 15)], [L(50, 15), L(50, 85)]],
    U: [[L(30, 15), L(30, 60), E(50, 60, 20, 25, 180, 0), L(70, 15)]],
    V: [[L(25, 15), L(50, 85), L(75, 15)]],
    W: [[L(18, 15), L(34, 85), L(50, 40), L(66, 85), L(82, 15)]],
    X: [[L(28, 15), L(72, 85)], [L(72, 15), L(28, 85)]],
    Y: [[L(28, 15), L(50, 50)], [L(72, 15), L(50, 50), L(50, 85)]],
    Z: [[L(28, 15), L(72, 15), L(28, 85), L(72, 85)]],
  };

  // Convierte un trazo en una lista densa de puntos.
  function puntos(trazo) {
    const pts = [];
    trazo.forEach((c) => {
      if (c[0] === 'L') pts.push([c[1], c[2]]);
      else {
        const [, cx, cy, rx, ry, a0, a1] = c;
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 4));
        for (let i = 0; i <= n; i++) {
          const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
          pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
      }
    });
    return pts;
  }

  // Reparte puntos de control a distancia fija a lo largo del trazo.
  function controles(trazo, paso = 4) {
    const pts = puntos(trazo);
    const out = [pts[0]];
    let resto = paso;
    for (let i = 1; i < pts.length; i++) {
      let [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      let d = Math.hypot(bx - ax, by - ay);
      while (d >= resto) {
        const t = resto / d;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push([ax, ay]);
        d -= resto;
        resto = paso;
      }
      resto -= d;
    }
    const ult = pts[pts.length - 1];
    if (Math.hypot(ult[0] - out[out.length - 1][0], ult[1] - out[out.length - 1][1]) > 1) out.push(ult);
    return out;
  }

  // ---------- Minúsculas de imprenta ----------
  // Pauta de 4 líneas (como el cuaderno del cole), en la misma cuadrícula 0-100:
  //   asc  = línea de arriba (altura de b, d, f, h, k, l, t y de las mayúsculas en pauta)
  //   x    = altura de la x (a, c, e, m, n, o...)
  //   base = línea de apoyo
  //   desc = línea de abajo (rabito de g, j, p, q, y)
  const LINEAS = { asc: 10, x: 42, base: 78, desc: 94 };
  // Minúsculas de imprenta de infantil, mismo formato que GLIFOS, en el orden y
  // sentido de los cuadernos. Cuerpo de x=42 a base=78 (centro y=60), letras
  // centradas hacia x=50. Los puntos (i, j) y la virgulilla (ñ) van al final;
  // un punto es un trazo cortísimo para que se complete con un toque.
  // Redondo de a, d, g, q (y la o): antihorario desde las 2, como la c, vuelta entera; el palito va a la derecha (x=66).
  const RED = E(50, 60, 16, 18, -30, -390);
  // Barriga de b, p: horaria; sale del palito (x=34) junto a la x y vuelve a él junto a la base.
  const BARRIGA = [E(46, 60, 20, 18, 233, 487)];
  // Puente de h, m, n: sube desde el palito (x0), pasa por la x y baja recto a la base en x1.
  const puente = (x0, x1) => [E((x0 + x1) / 2, 56, (x1 - x0) / 2, 14, 180, 360), L(x1, 78)];
  const punto = (x) => [L(x, 24), L(x, 26)];
  const GLIFOS_MINUS = {
    a: [[RED], [L(66, 42), L(66, 78)]],
    b: [[L(34, 10), L(34, 78)], BARRIGA],
    c: [[E(52, 60, 17, 18, -35, -325)]],
    d: [[RED], [L(66, 10), L(66, 78)]],
    e: [[L(35, 60), L(66, 60), E(50, 60, 16, 18, 0, -320)]],
    f: [[E(55, 22, 12, 12, -25, -180), L(43, 78)], [L(33, 42), L(59, 42)]],
    g: [[RED], [L(66, 42), L(66, 82), E(53, 82, 13, 12, 0, 140)]], // gancho corto: que no se pegue al redondo con el grosor
    h: [[L(34, 10), L(34, 78)], puente(34, 66)],
    i: [[L(50, 42), L(50, 78)], punto(50)],
    j: [[L(58, 42), L(58, 82), E(47, 82, 11, 12, 0, 160)], punto(58)],
    k: [[L(35, 10), L(35, 78)], [L(63, 42), L(36, 61), L(65, 78)]],
    l: [[L(50, 10), L(50, 78)]],
    m: [[L(20, 42), L(20, 78)], puente(20, 50), puente(50, 80)],
    n: [[L(34, 42), L(34, 78)], puente(34, 66)],
    'ñ': [[L(34, 42), L(34, 78)], puente(34, 66), [E(43, 22, 7, 4, 180, 360), E(57, 22, 7, 4, 180, 0)]],
    o: [[E(50, 60, 17, 18, -30, -390)]], // como la c que se cierra: misma salida que c, a, d, g, q
    p: [[L(34, 42), L(34, 94)], BARRIGA],
    q: [[RED], [L(66, 42), L(66, 94)]],
    r: [[L(38, 42), L(38, 78)], [E(52, 58, 14, 16, 180, 315)]],
    s: [[E(50, 51, 13, 9, -25, -270), E(50, 69, 15, 9, -90, 160)]],
    t: [[L(48, 20), L(48, 70), E(56, 70, 8, 8, 180, 60)], [L(37, 42), L(62, 42)]],
    u: [[L(34, 42), L(34, 64), E(50, 64, 16, 14, 180, 0), L(66, 42)], [L(66, 42), L(66, 78)]],
    v: [[L(34, 42), L(50, 78), L(66, 42)]],
    w: [[L(20, 42), L(35, 78), L(50, 42), L(65, 78), L(80, 42)]],
    x: [[L(35, 42), L(65, 78)], [L(65, 42), L(35, 78)]],
    y: [[L(34, 42), L(50, 78)], [L(66, 42), L(43, 94)]],
    z: [[L(35, 42), L(65, 42), L(35, 78), L(65, 78)]],
  };
  const MINUSCULAS = 'abcdefghijklmnñopqrstuvwxyz'.split('');

  // Las mayúsculas y números están dibujados entre y=15 y y=85. En pauta se
  // encogen para que vayan de "asc" a "base" y casen con las minúsculas.
  function aPauta(trazo) {
    const f = (y) => LINEAS.asc + ((y - 15) * (LINEAS.base - LINEAS.asc)) / 70;
    return trazo.map((c) => (c[0] === 'L' ? ['L', c[1], f(c[2])]
      : ['E', c[1], f(c[2]), c[3], (c[4] * (LINEAS.base - LINEAS.asc)) / 70, c[5], c[6]]));
  }
  const esMinuscula = (c) => Object.prototype.hasOwnProperty.call(GLIFOS_MINUS, c);
  // Trazos de un carácter. pauta=true: mayúsculas/números encogidos a la pauta de 4 líneas.
  function glifo(c, { pauta = false } = {}) {
    if (esMinuscula(c)) return GLIFOS_MINUS[c];
    const g = GLIFOS[c];
    if (!g) return null;
    return pauta ? g.map(aPauta) : g;
  }

  root.Trazos = { GLIFOS, GLIFOS_MINUS, MINUSCULAS, LINEAS, glifo, esMinuscula, puntos, controles };
})(window);
