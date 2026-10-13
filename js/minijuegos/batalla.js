/* Batalla de bloques — motor del minijuego por turnos (canvas 2D a mano, sin librerías).
 *
 * window.Batalla = {
 *   NIVELES,                 tabla de configuración por nivel (índice 0 = nivel 1)
 *   configNivel(n),          configuración de cualquier nivel (del 7 en adelante se escala sola)
 *   iniciar(contenedor, {heroe:'steve'|'alex', nivel, facil, semilla,
 *                        alTerminar({gano, nivel}),             al acabar la partida (una vez)
 *                        alElegir({accion, nivel, siguiente, gano})  botones del final:
 *                                  accion = 'siguiente' | 'otra' | 'salir'. Si no se pasa,
 *                                  el motor reinicia él solo (y 'salir' lo detiene).
 *                        infoFin({gano, nivel}) → {texto, seguir}  (opcional) una línea más en el
 *                                  cartel del final; seguir === false quita "Siguiente" y "Otra vez"
 *                        hueco: {ancho, alto}  (opcional, px CSS) esquina de arriba a la izquierda
 *                                  ocupada por un botón de la app (el de volver): el marcador y los
 *                                  controles no se ponen debajo
 *                       }) → { detener(), reiniciar(nivel, semilla), enCurso(), pausar(bool) }
 *   __prueba                 ganchos para pruebas automáticas (ver al final)
 * }
 *
 * 1 contra 1 (docs/DUELO.md, sección B): iniciar(contenedor, {duelo: {...}, alTerminar, alElegir,
 * infoFin, hueco}). Steve contra Alex, sin monstruos, en la misma tablet o en red:
 *   duelo: { jugadores: [{heroe, local, ayuda}, {...}],   0 = izquierda, 1 = derecha
 *            empieza, semilla, estadoInicial, tiempoTurno (s; 0 = sin límite; por defecto 60 si
 *            hay un remoto y 0 si no),
 *            alListo(estado)          mapa listo (dentro de iniciar() y de nuevoDuelo(), antes de volver)
 *            alEmpezarTurno({n, jugador, local})   empieza un turno (opcional)
 *            alJugadaLocal(jugada)    un jugador local acaba de disparar o pasar (mandarla ya)
 *            alTurnoLocal(turno) }    su turno ha acabado del todo (todo quieto): resultado oficial
 *   alTerminar({duelo: true, ganador, empate, gano, tablet, heroeGanador, motivos, n})
 *   alElegir({accion: 'otra'|'salir', duelo: true, ganador, gano})
 *   api: + recibirJugada(j), recibirTurno(tr), estado(), nuevoDuelo({semilla, estadoInicial,
 *        empieza, jugadores}), aviso(texto|null, {salir}), rival() → {esperando, n, turnoDe}, duelo
 *   jugada = {id, n, jugador, acciones: [{t, a: 'andar'|'salto'|'arma'|'disparo'|'pasar', ...}]}
 *   turno = {id, n, jugador, acciones, estado}; estado = instantánea {v, W, H, celdas, dano,
 *   cueva, heroes: [{x, y, vida, vivo, fuera, dir}, ...], turnoN, siguiente} (unos 3 KB).
 *   Cada aparato simula lo que ve; manda el que juega: al acabar su turno, su instantánea se aplica
 *   en el otro (y también en el suyo, para que los dos empiecen el turno siguiente igual).
 *
 * Turnos: jugador (andar/saltar/apuntar tipo tirachinas) → vuelo del proyectil →
 * explosión → todo se asienta → cada monstruo, uno a uno → vuelve el jugador.
 * Con teclado, en el turno de jugar aquí: ←/→ o A/D andan (mantener = seguir), ↑ o W salta y 1/2
 * eligen arma. Apuntar, siempre con el dedo o el ratón.
 * Terreno: todo lo que está por encima del agua se puede romper (debajo, mar abierto). Cada bloque
 * acumula daño (dano, 0..1 de lo que aguanta su material) y se ve agrietado en 3 etapas; al llegar
 * a 1 se rompe. Así un agujero hasta el agua cuesta 2-3 disparos en el mismo sitio.
 * Dibuja con window.Sprites si está cargado; si no, con rectángulos de colores.
 * Todo el tiempo de juego es "tiempo de simulación" con paso fijo (1/60 s), así
 * __prueba puede acelerarlo o simular partidas enteras sin esperar.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- constantes
  const W = 48;                // ancho del mundo en bloques
  const H = 27;                // alto
  const AGUA = 24;             // las filas >= AGUA están bajo el agua
  const G = 18;                // gravedad (bloques/s²)
  const DT = 1 / 60;           // paso fijo de simulación
  const PASOS_TURNO = 6;       // bloques que puede andar el jugador por turno
  const VIDA_JUGADOR = 100;
  const VMAX = { bazooka: 30, tnt: 24, flecha: 28 }; // velocidad a fuerza 1 (bloques/s)
  const VIENTO_ACEL = 3.5;     // aceleración del viento a intensidad 1
  const MECHA_TNT = 3;         // segundos
  const MEDIO_AN = 0.3;        // caja de choque de los personajes: medio ancho...
  const ALTO_CAJA = 1.75;      // ...y alto (en bloques)
  const ALTO_DIBUJO = { steve: 2, alex: 2, zombi: 2, esqueleto: 2, creeper: 1.85 };
  const VIDA = { zombi: 40, creeper: 20, esqueleto: 30 };
  // piedra: cuánto más castiga a la piedra. La TNT la rompe igual que la tierra (como en Minecraft, es
  // la buena para cavar): en tierra hace el cráter de siempre, pero 2 TNT llegan al agua
  const ARMAS = {
    bazooka: { radio: 3, dano: 50, empuje: 9, piedra: 1 },
    tnt: { radio: 4, dano: 60, empuje: 11, piedra: 1.4 },
  };
  const EXTRA_RADIO_FACIL = 1.3;
  // Fracción del daño que te hacen tus propias explosiones (poca: los zombis llegan hasta el héroe y
  // lo natural es dispararles a bocajarro) y tope por explosión: nunca más que el golpe de un zombi
  const autodano = (n) => (n <= 4 ? 0.25 : 0.35);
  const TOPE_AUTODANO = 12;
  // 1 contra 1: relieve del nivel 3 (colinas, alguna cueva y árboles), con su rebaja de autodaño
  const NIVEL_DUELO = 3;
  const NOMBRE_HEROE = { steve: 'Steve', alex: 'Alex' };
  const MAX_ACCIONES = 150;    // lo que se graba de un turno (andar y saltar sin moverse no cuenta más)
  // El turno de los monstruos va algo más rápido (los niños esperan); más aún si son muchos
  // o si el niño toca la pantalla mientras juegan (prisa)
  const RITMO_MONSTRUOS = 1.4;
  const ritmoMonstruos = (vivos, prisa) => RITMO_MONSTRUOS * Math.min(1.6, 1 + 0.15 * Math.max(0, vivos - 2)) * (prisa ? 2 : 1);

  const AIRE = 0, HIERBA = 1, TIERRA = 2, PIEDRA = 3, ARENA = 4, MADERA = 5, HOJAS = 6;
  const NOMBRE_BLOQUE = ['', 'hierba', 'tierra', 'piedra', 'arena', 'madera', 'hojas'];
  const COLOR_BLOQUE = ['', '#5da83a', '#8b5a2b', '#8c8c8c', '#e3d48f', '#6e4b26', '#3e8a2a'];
  const LETRA_BLOQUE = '.htpamo';
  // Daño de los bloques. Lo que aguanta cada material (1 = la tierra): una explosión le da a cada
  // bloque un golpe que vale 1 justo en su radio (la tierra se rompe hasta ahí, el cráter de siempre)
  // y baja hasta 0 a ALCANCE_EXTRA bloques más allá, donde solo agrieta. La piedra (1,4) se rompe
  // hasta 0,7 del radio de la bazuca, como antes; madera y hojas, algo más allá del radio.
  const RESISTENCIA = [0, 1, 1, 1.4, 1, 0.82, 0.82];
  const ALCANCE_EXTRA = 2;
  // Etapas de las grietas según el daño (en décimas: el daño cabe en una cifra 0-9 sin cambiar de etapa)
  const etapaGrieta = (f) => (f < 0.1 ? 0 : f < 0.4 ? 1 : f < 0.7 ? 2 : 3);
  // Colores de reserva (sin sprites): pelo, piel, camiseta, pantalón
  const COLOR_FALSO = {
    steve: ['#3b2414', '#c99a72', '#33b5c9', '#2c3e8f'],
    alex: ['#e07a1f', '#f3cfa8', '#4fa83a', '#7a4f2a'],
    zombi: ['#2f6b2a', '#5fa055', '#33b5c9', '#4a3a8f'],
    esqueleto: ['#d6d6d6', '#c4c4c4', '#b4b4b4', '#a0a0a0'],
    creeper: ['#4caf3c', '#4caf3c', '#3e9a30', '#2f7a24'],
  };

  // ---------------------------------------------------------------- niveles
  // relieve: amplitud de las colinas (0 = llano); escalon: desnivel máximo entre columnas.
  // pasos: bloques que anda un zombi/creeper por turno; falloZombi: probabilidad de fallar el golpe.
  // sube: escalón más alto que suben los monstruos (1, o 2 saltando en los mapas de montaña).
  // errAng (grados) y errFuerza (fracción): error de puntería de los esqueletos.
  const NIVELES = [
    { zombis: 2, creepers: 0, esqueletos: 0, viento: 0, relieve: 0, escalon: 1, arboles: 1, cuevas: 0, sube: 1, pasos: 3, falloZombi: 0.5, errAng: 16, errFuerza: 0.3 },
    { zombis: 2, creepers: 1, esqueletos: 0, viento: 0, relieve: 1.5, escalon: 1, arboles: 2, cuevas: 1, sube: 1, pasos: 3, falloZombi: 0.45, errAng: 15, errFuerza: 0.28 },
    { zombis: 2, creepers: 1, esqueletos: 1, viento: 0, relieve: 2.5, escalon: 1, arboles: 2, cuevas: 1, sube: 1, pasos: 3, falloZombi: 0.4, errAng: 14, errFuerza: 0.25 },
    { zombis: 3, creepers: 1, esqueletos: 1, viento: 0.3, relieve: 3.5, escalon: 2, arboles: 3, cuevas: 2, sube: 2, pasos: 3, falloZombi: 0.35, errAng: 12, errFuerza: 0.22 },
    { zombis: 3, creepers: 2, esqueletos: 1, viento: 0.5, relieve: 4.5, escalon: 2, arboles: 3, cuevas: 2, sube: 2, pasos: 4, falloZombi: 0.3, errAng: 10.5, errFuerza: 0.19 },
    { zombis: 3, creepers: 2, esqueletos: 2, viento: 0.7, relieve: 5.5, escalon: 2, arboles: 4, cuevas: 3, sube: 2, pasos: 4, falloZombi: 0.25, errAng: 9, errFuerza: 0.16 },
  ];

  function configNivel(n) {
    n = Math.max(1, Math.floor(Number(n) || 1));
    if (n <= NIVELES.length) return Object.assign({ n }, NIVELES[n - 1]);
    // Del 7 en adelante: mezcla y escalado suave a partir del último
    const b = NIVELES[NIVELES.length - 1];
    const e = n - NIVELES.length;
    const c = Object.assign({}, b, { n });
    c.zombis = b.zombis + Math.floor(e / 2);
    c.creepers = b.creepers + Math.floor((e + 1) / 3);
    c.esqueletos = b.esqueletos + Math.floor(e / 4);
    while (c.zombis + c.creepers + c.esqueletos > 7) {
      if (c.zombis >= c.creepers && c.zombis > 2) c.zombis--;
      else if (c.creepers > 1) c.creepers--;
      else c.esqueletos--;
    }
    c.viento = Math.min(1, b.viento + 0.05 * e);
    c.relieve = Math.min(7, b.relieve + 0.3 * e);
    c.errAng = Math.max(5, b.errAng - 0.3 * e);
    c.errFuerza = Math.max(0.08, b.errFuerza - 0.006 * e);
    c.falloZombi = Math.max(0.1, b.falloZombi - 0.02 * e);
    c.cuevas = Math.min(4, b.cuevas + Math.floor(e / 2));
    c.arboles = Math.min(5, b.arboles + Math.floor(e / 3));
    return c;
  }

  // ---------------------------------------------------------------- utilidades
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rad = (g) => (g * Math.PI) / 180;
  const lerp = (a, b, k) => a + (b - a) * k;

  // Azar con semilla (mulberry32)
  function crearAzar(semilla) {
    let a = (Math.floor(semilla) >>> 0) || 1;
    const f = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.entre = (lo, hi) => lo + f() * (hi - lo);
    f.ent = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.barajar = (lista) => {
      const l = lista.slice();
      for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); const x = l[i]; l[i] = l[j]; l[j] = x; }
      return l;
    };
    return f;
  }

  // Sonido: nunca rompe el juego (y en modo rápido de pruebas, silencio)
  let RAPIDO = false;
  let ESCALA = 1;
  function S(nombre, arg) {
    if (RAPIDO || ESCALA > 3) return;
    try {
      const s = window.Sfx;
      if (s && typeof s[nombre] === 'function') s[nombre](arg);
    } catch (e) { /* nada */ }
  }

  // ---------------------------------------------------------------- generación del mundo
  function generarMundo(cfg, azar) {
    const celdas = new Uint8Array(W * H);
    const cueva = new Uint8Array(W * H); // huecos de cueva: se pintan con fondo de piedra oscura
    const alt = new Array(W);
    const base = 16;
    const f1 = azar() * 6.283, f2 = azar() * 6.283, f3 = azar() * 6.283;
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.11 + f1) * 0.55 + Math.sin(x * 0.27 + f2) * 0.3 + Math.sin(x * 0.53 + f3) * 0.15;
      let h = base - n * cfg.relieve;
      // Isla: los bordes bajan hasta el agua
      const borde = Math.min(x, W - 1 - x);
      if (borde < 5) {
        const k = borde / 5;
        const s = k * k * (3 - 2 * k);
        h = (AGUA + 1.6) * (1 - s) + h * s;
      }
      alt[x] = clamp(Math.round(h), 8, H - 1);
    }
    // Escalones suaves en el interior (los zombis suben escalones de 1)
    const esc = cfg.escalon || 1;
    for (let p = 0; p < 3; p++) {
      for (let x = 6; x < W - 6; x++) if (alt[x] < alt[x - 1] - esc) alt[x] = alt[x - 1] - esc;
      for (let x = W - 7; x >= 5; x--) if (alt[x] < alt[x + 1] - esc) alt[x] = alt[x + 1] - esc;
    }
    for (let x = 0; x < W; x++) {
      const playa = alt[x] >= AGUA - 2;
      const capa = 3 + (azar() < 0.4 ? 1 : 0);
      for (let y = alt[x]; y < H; y++) {
        const d = y - alt[x];
        let tp;
        if (playa) tp = d < 3 ? ARENA : PIEDRA;
        else if (d === 0) tp = HIERBA;
        else if (d < capa) tp = TIERRA;
        else tp = azar() < 0.06 ? TIERRA : PIEDRA;
        celdas[y * W + x] = tp;
      }
    }
    // Sin roca madre: bajo la isla, la fila justo encima del agua es de piedra (rompible, como todo)
    // y desde el agua hacia abajo, mar abierto. Un pozo que atraviesa esa fila llega al agua.
    for (let x = 0; x < W; x++) {
      if (alt[x] < AGUA - 1) celdas[(AGUA - 1) * W + x] = PIEDRA;
      for (let y = AGUA; y < H; y++) celdas[y * W + x] = AIRE;
    }
    const seco = (x) => x >= 1 && x < W - 1 && alt[x] <= AGUA - 2;

    // Jugador a la izquierda
    let pj = azar.ent(9, 12);
    while (!seco(pj) && pj < 16) pj++;
    // 1 contra 1: el segundo héroe, a la derecha (simétrico). Solo en el duelo: así el azar del modo
    // contra monstruos sigue igual y la misma semilla da el mismo mapa que antes.
    let p2 = null;
    if (cfg.duelo) {
      p2 = azar.ent(W - 13, W - 10);
      while (!seco(p2) && p2 > W - 17) p2--;
    }

    // Monstruos a la derecha, separados
    const total = cfg.zombis + cfg.creepers + cfg.esqueletos;
    const candidatos = [];
    for (let x = pj + 14; x <= W - 6; x++) if (seco(x)) candidatos.push(x);
    const pos = [];
    for (let sep = 3; sep >= 1 && pos.length < total; sep--) {
      for (const x of azar.barajar(candidatos)) {
        if (pos.length >= total) break;
        if (pos.every((p) => Math.abs(p - x) >= sep)) pos.push(x);
      }
    }
    for (let x = W - 4; pos.length < total && x > pj + 6; x--) if (seco(x) && !pos.includes(x)) pos.push(x);
    pos.sort((a, b) => a - b);
    const tiposCerca = azar.barajar([].concat(Array(cfg.zombis).fill('zombi'), Array(cfg.creepers).fill('creeper')));
    const tipos = tiposCerca.concat(Array(cfg.esqueletos).fill('esqueleto')); // esqueletos al fondo
    const monstruos = pos.map((x, i) => ({ x, tipo: tipos[i] || 'zombi' }));

    const cercaDeAlguien = (x, d) => Math.abs(x - pj) <= d || pos.some((p) => Math.abs(p - x) <= d) || (p2 != null && Math.abs(x - p2) <= d);

    // Cuevas pequeñas (nunca debajo de nadie y siempre con techo de 3 bloques)
    for (let i = 0; i < (cfg.cuevas || 0); i++) {
      for (let intento = 0; intento < 25; intento++) {
        const cx = azar.ent(9, W - 10);
        const rx = azar.entre(1.8, 3.2), ry = azar.entre(1.0, 1.6);
        const cy = alt[cx] + azar.entre(4.5, 6.5);
        if (cy + ry >= AGUA - 1) continue;
        let ok = true;
        for (let x = Math.floor(cx - rx) - 1; x <= cx + rx + 1; x++) if (cercaDeAlguien(x, 1)) ok = false;
        if (!ok) continue;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            const dx = (x + 0.5 - (cx + 0.5)) / rx, dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy < 1 && y >= alt[x] + 3) { celdas[y * W + x] = AIRE; cueva[y * W + x] = 1; }
          }
        }
        break;
      }
    }

    // Árboles (lejos de los personajes)
    const arboles = [];
    for (let i = 0; i < (cfg.arboles || 0); i++) {
      for (let intento = 0; intento < 40; intento++) {
        const x = azar.ent(4, W - 5);
        if (!seco(x) || alt[x] >= AGUA - 3) continue;
        if (Math.abs(x - pj) < 6 || (p2 != null && Math.abs(x - p2) < 6) || cercaDeAlguien(x, 3) || arboles.some((a) => Math.abs(a - x) <= 4)) continue; // el jugador, con tiro despejado
        if (celdas[alt[x] * W + x] !== HIERBA) continue;
        const alto = azar.ent(3, 4);
        const top = alt[x] - alto;
        if (top - 2 < 1) continue;
        for (let y = alt[x] - 1; y >= top; y--) celdas[y * W + x] = MADERA;
        const filas = [[top - 2, 1], [top - 1, 2], [top, 2]];
        for (const [y, r] of filas) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W || y < 0) continue;
            if (celdas[y * W + xx] === AIRE) celdas[y * W + xx] = HOJAS;
          }
        }
        arboles.push(x);
        break;
      }
    }
    return { celdas, cueva, alt, jugador: pj, jugador2: p2, monstruos };
  }

  // ---------------------------------------------------------------- 1 contra 1: datos
  // Resumen de un texto (FNV-1a de 32 bits): identifica el mapa de un duelo en los dos aparatos
  function resumen(txt) {
    let h = 0x811c9dc5;
    for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const numero = (v) => (v == null || v === '' ? NaN : Number(v));
  const copia = (o) => JSON.parse(JSON.stringify(o));
  // Los dos jugadores, siempre Steve contra Alex: si traen el mismo héroe, el de la derecha pasa a
  // ser el otro (igual en los dos aparatos, que reciben la misma lista)
  function leerJugadores(lista) {
    const l = Array.isArray(lista) ? lista : [];
    const js = [0, 1].map((k) => {
      const j = l[k] && typeof l[k] === 'object' ? l[k] : {};
      return { heroe: j.heroe === 'alex' || j.heroe === 'steve' ? j.heroe : k ? 'alex' : 'steve', local: j.local !== false, ayuda: !!j.ayuda };
    });
    if (js[0].heroe === js[1].heroe) js[1].heroe = js[0].heroe === 'steve' ? 'alex' : 'steve';
    return js;
  }
  // Un héroe de una instantánea (o null si no vale)
  function leerHeroe(h) {
    if (!h || typeof h !== 'object') return null;
    const x = Number(h.x), y = Number(h.y), vida = Number(h.vida);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -2 || x > W + 2 || y < -2 || y > H + 2) return null;
    // Vivo bajo el agua no puede ser (se quedaría de pie en el fondo del mar; en el duelo, el que cae al agua pierde)
    if (h.vivo && y > AGUA) return null;
    return { x, y, vida: clamp(Math.round(Number.isFinite(vida) ? vida : VIDA_JUGADOR), 0, VIDA_JUGADOR), vivo: !!h.vivo, fuera: !!h.fuera, dir: h.dir < 0 ? -1 : 1 };
  }
  // Las acciones de una jugada que llega de la red: solo lo conocido, con tiempos que no van hacia
  // atrás, y nada después del disparo o de pasar
  function limpiarAcciones(l) {
    const out = [];
    if (!Array.isArray(l)) return out;
    let tt = 0;
    for (const a of l) {
      if (out.length >= MAX_ACCIONES + 2) break;
      if (!a || typeof a !== 'object') continue;
      tt = Math.max(tt, clamp(Number(a.t) || 0, 0, 3600));
      if (a.a === 'andar' || a.a === 'salto') out.push({ t: tt, a: a.a, dir: a.dir < 0 ? -1 : 1 });
      else if (a.a === 'arma') { if (a.arma === 'bazooka' || a.arma === 'tnt') out.push({ t: tt, a: 'arma', arma: a.arma }); }
      else if (a.a === 'disparo') {
        const ang = Number(a.ang), f = Number(a.fuerza);
        if (!Number.isFinite(ang) || !Number.isFinite(f)) continue;
        out.push({ t: tt, a: 'disparo', ang, fuerza: clamp(f, 0.08, 1), arma: a.arma === 'tnt' ? 'tnt' : 'bazooka' });
        break;
      } else if (a.a === 'pasar') { out.push({ t: tt, a: 'pasar' }); break; }
    }
    return out;
  }

  // ---------------------------------------------------------------- estilos
  const CSS = `
.bt{position:relative;width:100%;height:100%;overflow:hidden;background:#8fd3ff;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;font-family:"Pixelify Sans","Fredoka",ui-monospace,monospace;color:#fff;--bot:64px;--lado:80px}
.bt *{box-sizing:border-box}
.bt-lienzo{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none}
.bt-grupo{position:absolute;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;pointer-events:none;z-index:2}
.bt-grupo>*{pointer-events:auto}
.bt-btn{position:relative;width:var(--bot);height:var(--bot);margin:0;padding:0;border:3px solid #1b1b1b;border-radius:10px;background:linear-gradient(#a3a3a3,#6c6c6c);box-shadow:inset -3px -4px 0 rgba(0,0,0,.32),inset 3px 3px 0 rgba(255,255,255,.35),0 4px 0 #1b1b1b;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none;color:#fff;font:inherit;font-weight:700}
.bt-btn svg{width:58%;height:58%;display:block;filter:drop-shadow(2px 2px 0 rgba(0,0,0,.6))}
.bt-btn:active:not(:disabled){transform:translateY(3px);box-shadow:inset -3px -4px 0 rgba(0,0,0,.32),inset 3px 3px 0 rgba(255,255,255,.35),0 1px 0 #1b1b1b}
.bt-btn:disabled{opacity:.5;filter:saturate(.4);cursor:default}
.bt-arma{width:auto;min-width:calc(var(--bot)*1.45);padding:0 10px;gap:6px;font-size:calc(var(--bot)*.27);text-shadow:2px 2px 0 rgba(0,0,0,.55)}
.bt-arma canvas{width:calc(var(--bot)*.56);height:calc(var(--bot)*.56);image-rendering:pixelated;image-rendering:crisp-edges;flex:none}
.bt-arma.bt-elegida{background:linear-gradient(#ffd84d,#e09b00);color:#3a2500;text-shadow:none}
.bt-arma.bt-elegida:disabled{opacity:.6}
.bt-pasos{flex-basis:100%;order:-1;text-align:center;font-size:15px;font-weight:700;line-height:1;text-shadow:0 2px 0 #000;white-space:nowrap}
.bt-pasos i{display:inline-block;width:11px;height:11px;margin:0 2px;background:#5fdc3a;border:2px solid #123d08;vertical-align:-1px}
.bt-pasos i.bt-gastado{background:#4a4a4a;border-color:#222}
.bt-lados .bt-grupo{flex-direction:column;flex-wrap:nowrap;gap:8px;padding:8px 0;background:rgba(20,14,8,.55);border-radius:0 14px 14px 0}
.bt-lados .bt-armas{border-radius:14px 0 0 14px}
.bt-lados .bt-pasos{flex-basis:auto;font-size:13px;white-space:normal;width:100%}
.bt-lados .bt-puntos{display:grid;grid-template-columns:repeat(3,10px);gap:3px;justify-content:center;margin-top:4px}
.bt-lados .bt-pasos i{width:10px;height:10px;margin:0}
.bt-lados .bt-arma{flex-direction:column;min-width:0;width:calc(var(--lado) - 10px);height:auto;padding:5px 2px;gap:2px;font-size:12px}
.bt-encima .bt-btn{background:linear-gradient(rgba(163,163,163,.92),rgba(108,108,108,.92))}
.bt-mudo{position:absolute;top:8px;right:8px;z-index:3;width:46px;height:46px;border-radius:10px;border:3px solid #1b1b1b;background:rgba(40,40,40,.55);display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;color:#fff}
.bt-mudo svg{width:26px;height:26px}
.bt-pista{position:absolute;left:50%;transform:translateX(-50%);z-index:2;padding:8px 14px;border-radius:12px;background:rgba(0,0,0,.55);font-size:18px;line-height:1.25;text-align:center;pointer-events:none;max-width:92%;width:max-content}
.bt-cartel{position:absolute;left:50%;top:30%;z-index:3;transform:translate(-50%,-50%);width:max-content;max-width:calc(100% - 140px);font-size:clamp(28px,5.5vw,56px);font-weight:700;line-height:1.1;text-align:center;text-wrap:balance;color:#fff;text-shadow:0 4px 0 #000,3px 0 0 #000,-3px 0 0 #000,0 -3px 0 #000;pointer-events:none;opacity:0}
.bt-cartel.bt-ver{animation:bt-cartel 1.7s ease-out forwards}
.bt-cartel.bt-suyo{color:#ff7b6b}
.bt-cartel.bt-bien{color:#ffe14d}
@keyframes bt-cartel{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}14%{transform:translate(-50%,-50%) scale(1.12);opacity:1}24%{transform:translate(-50%,-50%) scale(1)}78%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}
.bt-fin{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:16px}
.bt-fin[hidden]{display:none}
.bt-fin-caja{background:#c69c6d;border:4px solid #3b2a1a;box-shadow:inset -6px -7px 0 rgba(0,0,0,.25),inset 6px 6px 0 rgba(255,255,255,.3);border-radius:8px;padding:20px 22px 22px;text-align:center;max-width:560px;width:100%;color:#2a1a0a;animation:bt-entra .35s ease-out}
@keyframes bt-entra{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.bt-fin h2{margin:0 0 8px;font-size:clamp(28px,6vw,46px);line-height:1.1;color:#fff;text-shadow:0 3px 0 #3b2a1a,3px 0 0 #3b2a1a,-3px 0 0 #3b2a1a,0 -3px 0 #3b2a1a}
.bt-fin p{margin:0 0 16px;font-size:20px;font-weight:700;font-family:"Fredoka",ui-rounded,system-ui,sans-serif}
.bt-fin p.bt-fin-info{margin:-8px 0 16px;font-size:18px;opacity:.9}
.bt-fin p.bt-fin-info[hidden]{display:none}
.bt-girar{position:absolute;left:50%;transform:translateX(-50%);z-index:1;display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:12px;background:rgba(0,0,0,.28);color:#e8dccb;font-size:16px;line-height:1.25;max-width:88%;width:max-content;pointer-events:none}
.bt-girar[hidden]{display:none}
.bt-girar svg{flex:none;width:44px;height:44px;animation:bt-girar 2.6s ease-in-out infinite}
@keyframes bt-girar{0%,30%{transform:rotate(0)}55%,85%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){.bt-girar svg{animation:none}}
.bt-fin-botones{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.bt-fin-botones button{font:inherit;font-size:22px;font-weight:700;padding:12px 20px;min-height:62px;min-width:140px;border:3px solid #1b1b1b;border-radius:10px;cursor:pointer;color:#fff;text-shadow:2px 2px 0 rgba(0,0,0,.45);background:linear-gradient(#7ccb45,#4b8b20);box-shadow:inset -3px -4px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.35),0 4px 0 #1b1b1b}
.bt-fin-botones button.bt-sec{background:linear-gradient(#a3a3a3,#6c6c6c)}
.bt-fin-botones button:active{transform:translateY(3px)}
.bt-fin-botones button:disabled{opacity:.55;filter:saturate(.4);cursor:default;transform:none}
.bt-fin p.bt-fin-aviso{margin:-8px 0 16px;font-size:19px;color:#5a1a00}
.bt-fin p.bt-fin-aviso[hidden]{display:none}
.bt-aviso{position:absolute;left:50%;top:45%;z-index:5;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:12px;width:max-content;max-width:calc(100% - 32px);padding:14px 22px;border-radius:14px;background:rgba(0,0,0,.72);color:#fff;font-size:clamp(20px,3.4vw,30px);font-weight:700;line-height:1.2;text-align:center;text-wrap:balance;text-shadow:0 2px 0 #000;pointer-events:none}
.bt-aviso[hidden]{display:none}
.bt-aviso span{animation:bt-latido 1.8s ease-in-out infinite}
@keyframes bt-latido{50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.bt-aviso span{animation:none}}
.bt-aviso button{pointer-events:auto;font:inherit;font-size:22px;font-weight:700;padding:10px 22px;min-height:58px;min-width:140px;border:3px solid #1b1b1b;border-radius:10px;cursor:pointer;color:#fff;text-shadow:2px 2px 0 rgba(0,0,0,.45);background:linear-gradient(#a3a3a3,#6c6c6c);box-shadow:inset -3px -4px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.35),0 4px 0 #1b1b1b}
.bt-aviso button[hidden]{display:none}
.bt-aviso button:active{transform:translateY(3px)}
`;
  function ponerEstilos() {
    if (document.getElementById('bt-estilos')) return;
    const s = document.createElement('style');
    s.id = 'bt-estilos';
    s.textContent = CSS;
    document.head.appendChild(s);
    // Fredoka (las cifras del lienzo): que esté cargada aunque la app use otra letra
    try { if (document.fonts && document.fonts.load) document.fonts.load('700 16px "Fredoka"').catch(() => {}); } catch (e) { /* nada */ }

  }

  const SVG_IZQ = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="#1b1b1b" stroke-width="1" stroke-linejoin="round" d="M11.5 1.5v13L3 8z"/></svg>';
  const SVG_DER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="#1b1b1b" stroke-width="1" stroke-linejoin="round" d="M4.5 1.5v13L13 8z"/></svg>';
  const SVG_SALTO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="#1b1b1b" stroke-width="1" stroke-linejoin="round" d="M8 1l6.5 6.5H10.5V15h-5V7.5H1.5z"/></svg>';
  const SVG_SONIDO = '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 6h3l3-3h1v10H8l-3-3H2zM11 5h1v6h-1zM13 3h1v10h-1z"/></svg>';
  const SVG_GIRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="18" width="4" height="1.6" fill="currentColor"/></svg>';
  const SVG_MUDO = '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 6h3l3-3h1v10H8l-3-3H2zM10 5h1v1h1v1h1V6h1V5h1v1h-1v1h-1v2h1v1h1v1h-1v-1h-1V9h-1v1h-1v1h-1v-1h1V9h1V7h-1V6h-1z"/></svg>';

  const PLANTILLA = `
<canvas class="bt-lienzo" aria-label="Batalla de bloques"></canvas>
<div class="bt-grupo bt-mov">
  <div class="bt-pasos"></div>
  <button type="button" class="bt-btn bt-izq" aria-label="Andar a la izquierda">${SVG_IZQ}</button>
  <button type="button" class="bt-btn bt-salto" aria-label="Saltar">${SVG_SALTO}</button>
  <button type="button" class="bt-btn bt-der" aria-label="Andar a la derecha">${SVG_DER}</button>
</div>
<div class="bt-grupo bt-armas">
  <button type="button" class="bt-btn bt-arma" data-arma="bazooka" aria-label="Bazooka"><canvas width="32" height="32"></canvas><span>Bazooka</span></button>
  <button type="button" class="bt-btn bt-arma" data-arma="tnt" aria-label="TNT"><canvas width="32" height="32"></canvas><span>TNT</span></button>
</div>
<button type="button" class="bt-mudo" aria-label="Sonido"></button>
<div class="bt-pista" hidden>Arrastra hacia atrás y suelta para disparar</div>
<div class="bt-girar" hidden>${SVG_GIRAR}<span>Gira el móvil para verlo más grande</span></div>
<div class="bt-cartel"></div>
<div class="bt-aviso" role="status" hidden><span></span><button type="button" hidden>Salir</button></div>
<div class="bt-fin" hidden><div class="bt-fin-caja"><h2></h2><p></p><p class="bt-fin-info" hidden></p><p class="bt-fin-aviso" hidden></p><div class="bt-fin-botones"></div></div></div>`;

  // ---------------------------------------------------------------- partida
  let activa = null; // instancia en marcha (la que usan los ganchos __prueba)

  function iniciar(contenedor, opciones) {
    opciones = opciones || {};
    if (!contenedor || !contenedor.appendChild) throw new Error('Batalla.iniciar: falta el contenedor');
    if (activa) activa.detener();
    ponerEstilos();

    // 1 contra 1: sin él, todo sigue exactamente como siempre. En el duelo no hay modo fácil (sería
    // injusto): la ayuda de cada jugador es solo visual (trayectoria entera y círculo).
    const duelo = opciones.duelo && typeof opciones.duelo === 'object' ? opciones.duelo : null;
    const heroe = opciones.heroe === 'alex' ? 'alex' : 'steve';
    const facil = !duelo && !!opciones.facil;
    let nivel = duelo ? NIVEL_DUELO : Math.max(1, Math.floor(Number(opciones.nivel) || 1));

    // ---------- DOM
    const raiz = document.createElement('div');
    raiz.className = 'bt';
    raiz.innerHTML = PLANTILLA;
    contenedor.appendChild(raiz);
    const $ = (s) => raiz.querySelector(s);
    const lienzo = $('.bt-lienzo');
    const ctx = lienzo.getContext('2d');
    const $mov = $('.bt-mov'), $armas = $('.bt-armas');
    const $izq = $('.bt-izq'), $der = $('.bt-der'), $salto = $('.bt-salto'), $pasos = $('.bt-pasos');
    const $botArmas = Array.from(raiz.querySelectorAll('.bt-arma'));
    const $mudo = $('.bt-mudo'), $pista = $('.bt-pista'), $cartel = $('.bt-cartel');
    const $fin = $('.bt-fin'), $finT = $('.bt-fin h2'), $finP = $('.bt-fin p'), $finB = $('.bt-fin-botones');
    const $finInfo = $('.bt-fin-info'), $girar = $('.bt-girar');
    const $aviso = $('.bt-aviso'), $avisoT = $('.bt-aviso span'), $avisoB = $('.bt-aviso button'), $finAviso = $('.bt-fin-aviso');
    // Esquina ocupada por un botón de la app (px CSS)
    const hueco = {
      ancho: Math.max(0, Number(opciones.hueco && opciones.hueco.ancho) || 0),
      alto: Math.max(0, Number(opciones.hueco && opciones.hueco.alto) || 0),
    };

    // ---------- estado de la partida
    // El terreno es celdas (tipo de bloque) + dano (lo gastado de cada bloque, 0..1) + cueva (fondo
    // oscuro de los huecos de cueva). sucias: bloques que hay que repintar (o todoSucio = todos).
    let cfg, azar, semilla, celdas, dano, cueva, sucias = [], todoSucio = true;
    let ents = [], jug = null, proys = [], pendientes = [], particulas = [], textos = [], orbes = [], clavadas = [], destellos = [];
    let t = 0, fase = 'inicio', turnoN = 0, viento = 0, pasos = PASOS_TURNO, arma = 'bazooka';
    let disparado = false, saltarTurno = false, colaMov = [], resultado = null, finAvisado = false;
    let co = null, espera = null, temblor = 0, activo = null, tiros = 0, apunte = null;
    let sigId = 1, ultimoTiro = null, inicioTurno = 0;
    let pausado = false, prisa = false;  // pausa (la app pregunta si salir) / el niño tocó para que los monstruos corran
    let ayuda = false, ayudaT0 = 0;      // la mano que enseña a disparar: a petición (un toque sin arrastrar)
    const errores = [], avisos = [];
    const stats = { calmasForzadas: 0, turnosLargos: 0, golpesMonstruo: 0, fallosMonstruo: 0, flechas: 0, flechasAcertadas: 0, danoJugador: {}, alAgua: [] };
    // (1 contra 1: instantáneas del rival aplicadas, y cuántas cambiaron algo de lo que se había simulado aquí)
    stats.instantaneas = 0; stats.corregidas = 0;
    // (fácil: rescates del agua sin ningún sitio de pie en la isla, con plataforma nueva)
    stats.plataformas = 0;
    // 1 contra 1. jugadores: [{heroe, local, ayuda}] (0 = izquierda); heroes: sus dos entidades (jug
    // es la del turno). dl: el duelo en marcha (nº de turno, de quién, jugadas y turnos recibidos...).
    // acciones: lo que se graba del turno local; rep: la jugada del rival que se está reproduciendo.
    let jugadores = null, heroes = null, dl = null, acciones = [], rep = null, semillaNubes = null;
    let avisoTexto = null, avisoSalir = false; // cartel fijo de la app ("Esperando a Alex…")
    if (duelo) jugadores = leerJugadores(duelo.jugadores);

    // ---------- estado del dibujo
    let cw = 1, ch = 1, dpr = 1, bsD = 8, ox = 0, oy = 0, modo = 'abajo';
    // Con bloques muy pequeños (móvil en vertical), personajes y proyectiles se dibujan 1,5 veces más
    // grandes (anclados por los pies; la física no cambia), si no, no se distinguen
    let kPers = 1;
    // Capas fijas, fuera de la pantalla: el cielo (se pinta al cambiar de tamaño), el terreno (solo
    // se repintan los bloques que cambian) y las dos ya juntas, para que cada fotograma empiece con
    // una sola imagen (dos solo mientras la pantalla tiembla).
    const capaFondo = document.createElement('canvas');
    const capaTerreno = document.createElement('canvas');
    const capaJunta = document.createElement('canvas');
    let ctxT = capaTerreno.getContext('2d');
    // Móvil en vertical: el marcador y la mano de ayuda van en el panel de abajo (sobra sitio y no tapan el mundo)
    let zonaDemo = null, hudPanel = null, girarVisible = false;
    let texturas = {};
    const rotos = new Set();
    let rafId = 0, ultimoTs = 0, acum = 0, detenido = false, claveControles = '', iconosPintados = false;

    function anotarError(err) {
      const m = String((err && (err.stack || err.message)) || err);
      if (errores.length < 50) errores.push(m);
      try { console.error('[Batalla]', err); } catch (e) { /* nada */ }
    }
    function aviso(m) { if (avisos.length < 100) avisos.push(m + ' (t=' + t.toFixed(1) + ')'); }

    // ---------- rejilla
    function solido(x, y) {
      if (x < 0 || x >= W || y < 0) return false;
      if (y >= H) return true;
      return celdas[y * W + x] !== AIRE;
    }
    function quitar(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const i = y * W + x;
      dano[i] = 0;
      if (celdas[i] !== AIRE) { celdas[i] = AIRE; sucias.push(i); }
    }
    // Golpe a un bloque (en "tierras": 1 rompe un bloque de tierra sano). Devuelve true si se rompe.
    // Si solo se agrieta y cambia de etapa, se marca para repintarlo (solo ese bloque).
    function danar(i, golpe) {
      const tp = celdas[i];
      if (tp === AIRE || !(golpe > 0)) return false;
      const antes = etapaGrieta(dano[i]);
      dano[i] += golpe / RESISTENCIA[tp];
      if (dano[i] >= 1) { quitar(i % W, (i / W) | 0); return true; }
      if (etapaGrieta(dano[i]) !== antes) sucias.push(i);
      return false;
    }
    // Pone el daño de un bloque tal cual (0..1, sin romperlo): para cargar un terreno guardado y las pruebas
    function fijarDano(i, f) {
      const antes = etapaGrieta(dano[i]);
      dano[i] = celdas[i] === AIRE ? 0 : clamp(Number(f) || 0, 0, 0.99);
      if (etapaGrieta(dano[i]) !== antes) sucias.push(i);
    }
    // El terreno como texto (para guardarlo o mandarlo; cabe en la instantánea del 1 contra 1):
    // celdas = una letra por bloque (LETRA_BLOQUE), dano = una cifra 0-9 por bloque (décimas de lo
    // gastado: la etapa de las grietas no cambia al cargarlo), cueva = índices de los huecos de cueva.
    function volcarTerreno() {
      let c = '', d = '';
      const cv = [];
      for (let i = 0; i < W * H; i++) {
        c += LETRA_BLOQUE[celdas[i]];
        d += celdas[i] ? Math.min(9, Math.floor(dano[i] * 10)) : 0;
        if (cueva[i]) cv.push(i);
      }
      return { celdas: c, dano: d, cueva: cv };
    }
    // Lo contrario (con todo quieto: sin proyectiles ni bloques a punto de caer). dano vale también
    // como lista [[i, cifra], ...]. Si las celdas no cuadran, no toca nada y devuelve false.
    function cargarTerreno(o) {
      if (!o || typeof o.celdas !== 'string' || o.celdas.length !== W * H) return false;
      const c = new Uint8Array(W * H), d = new Float32Array(W * H), cv = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const k = LETRA_BLOQUE.indexOf(o.celdas.charAt(i));
        if (k < 0) return false;
        c[i] = k;
      }
      const ponCifra = (i, q) => { if (Number.isInteger(i) && i >= 0 && i < W * H && c[i] && q > 0 && q <= 9) d[i] = (q + 0.5) / 10; };
      if (typeof o.dano === 'string' && o.dano.length === W * H) for (let i = 0; i < W * H; i++) ponCifra(i, o.dano.charCodeAt(i) - 48);
      else if (Array.isArray(o.dano)) for (const par of o.dano) if (Array.isArray(par)) ponCifra(par[0], Math.floor(Number(par[1])));
      if (Array.isArray(o.cueva)) for (const i of o.cueva) if (Number.isInteger(i) && i >= 0 && i < W * H && !c[i]) cv[i] = 1;
      // Solo se repinta lo que cambia (al aplicar la instantánea del rival suele ser poco o nada)
      if (!todoSucio) {
        for (let i = 0; i < W * H; i++) {
          if (c[i] !== celdas[i] || cv[i] !== cueva[i] || etapaGrieta(d[i]) !== etapaGrieta(dano[i])) sucias.push(i);
        }
        if (sucias.length > (W * H) / 3) todoSucio = true; // (un mapa entero distinto: de una vez)
      }
      celdas = c; dano = d; cueva = cv;
      decayendo.clear();
      return true;
    }
    function superficie(c) { for (let y = 1; y < H; y++) if (solido(c, y)) return y; return H; }
    // Sitio más alto de la columna donde cabe un personaje de pie (o null)
    function sitioDePie(c, evitarArbol) {
      for (let y = 2; y <= AGUA; y++) {
        if (solido(c, y) && !solido(c, y - 1) && !solido(c, y - 2)) {
          const tp = celdas[y * W + c];
          if (evitarArbol && (tp === HOJAS || tp === MADERA)) continue;
          return y;
        }
      }
      return null;
    }
    function cajaChoca(x, y) {
      const x0 = Math.floor(x - MEDIO_AN), x1 = Math.floor(x + MEDIO_AN - 1e-6);
      const y0 = Math.floor(y - ALTO_CAJA), y1 = Math.floor(y - 1e-6);
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (solido(i, j)) return true;
      return false;
    }
    function cajaPeq(x, y, r) {
      const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-6);
      const y0 = Math.floor(y - r), y1 = Math.floor(y + r - 1e-6);
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (solido(i, j)) return true;
      return false;
    }

    // ---------- entidades
    function crearEntidad(tipo, col, dir) {
      const vida = VIDA[tipo] || VIDA_JUGADOR;
      return {
        id: sigId++, tipo, x: col + 0.5, y: superficie(col), vx: 0, vy: 0, dir, vida, vidaMax: vida,
        estado: 'quieto', mov: null, destello: 0, vivo: true, oculto: false, muerteT: -1, fuera: false,
        siseo: -1, tensando: false, golpeT: -1, explotando: false, programado: false, esJugador: false, casa: col,
      };
    }
    function reposado(e) {
      if (!e.vivo) return true;
      return !e.mov && e.estado === 'quieto' && solido(Math.floor(e.x), Math.round(e.y));
    }
    function nuevaPartida(n, sem) {
      if (duelo) { nuevaPartidaDuelo({ semilla: sem }); return; }
      nivel = Math.max(1, Math.floor(Number(n) || nivel));
      cfg = configNivel(nivel);
      if (facil) cfg.viento = 0;
      semilla = sem != null ? Math.floor(sem) : (opciones.semilla != null ? Math.floor(opciones.semilla) : 1000 + nivel * 37);
      const mundo = generarMundo(cfg, crearAzar(semilla));
      azar = crearAzar(semilla * 7 + 13);
      celdas = mundo.celdas;
      dano = new Float32Array(W * H);
      cueva = mundo.cueva;
      sucias = []; todoSucio = true;
      ents = []; proys = []; pendientes = []; particulas = []; textos = []; orbes = []; clavadas = []; destellos = [];
      decayendo.clear();
      jug = crearEntidad(heroe, mundo.jugador, 1);
      jug.esJugador = true;
      ents.push(jug);
      mundo.monstruos.forEach((m) => ents.push(crearEntidad(m.tipo, m.x, -1)));
      t = 0; fase = 'inicio'; turnoN = 0; viento = 0; pasos = PASOS_TURNO;
      disparado = false; saltarTurno = false; colaMov = []; resultado = null; finAvisado = false;
      temblor = 0; activo = null; tiros = 0; apunte = null; espera = null; prisa = false; ayuda = false;
      co = partida(false);
      $fin.hidden = true;
      claveControles = '';
      pintarFondo();
      pintarAviso();
    }

    // ---------- 1 contra 1: mapa, instantánea y avisos
    // o: {semilla, estadoInicial, empieza, tiempoTurno}. Con estadoInicial (el que se une), el mapa y
    // quién empieza son los de la instantánea (si no vale, el de la semilla).
    function nuevaPartidaDuelo(o) {
      nivel = NIVEL_DUELO;
      cfg = Object.assign(configNivel(NIVEL_DUELO), { zombis: 0, creepers: 0, esqueletos: 0, viento: 0, duelo: true });
      const sem = numero(o.semilla);
      semilla = Number.isFinite(sem) ? Math.floor(sem) : 1 + Math.floor(Math.random() * 999999);
      const mundo = generarMundo(cfg, crearAzar(semilla));
      azar = crearAzar(semilla * 7 + 13);
      celdas = mundo.celdas;
      dano = new Float32Array(W * H);
      cueva = mundo.cueva;
      sucias = []; todoSucio = true;
      proys = []; pendientes = []; particulas = []; textos = []; orbes = []; clavadas = []; destellos = [];
      decayendo.clear();
      // 0 hacia x≈10 mirando a la derecha; 1 hacia x≈W-11 mirando a la izquierda (los dos en tierra seca)
      heroes = jugadores.map((j, k) => {
        const e = crearEntidad(j.heroe, k ? mundo.jugador2 : mundo.jugador, k ? -1 : 1);
        e.esJugador = true;
        return e;
      });
      ents = heroes.slice();
      t = 0; fase = 'inicio'; turnoN = 0; viento = 0; pasos = PASOS_TURNO; arma = 'bazooka';
      disparado = false; saltarTurno = false; colaMov = []; resultado = null; finAvisado = false;
      temblor = 0; activo = null; tiros = 0; apunte = null; espera = null; prisa = false; ayuda = false;
      acciones = []; rep = null;
      const emp = numero(o.empieza), tt = numero(o.tiempoTurno != null ? o.tiempoTurno : duelo.tiempoTurno);
      dl = {
        n: 1, turnoDe: emp === 1 ? 1 : 0, id: '',
        tiempo: Number.isFinite(tt) ? Math.max(0, tt) : jugadores.some((j) => !j.local) ? 60 : 0,
        jugadas: {}, turnos: {},         // lo recibido del rival, por nº de turno
        enviada: 0, repetida: 0,         // último turno con la jugada ya mandada / ya reproducida
        esperando: false, ganador: null, tiros: [0, 0], armas: ['bazooka', 'bazooka'], seg: -1,
      };
      const ini = o.estadoInicial && typeof o.estadoInicial === 'object' ? o.estadoInicial : null;
      if (ini && !aplicarInstantanea(ini, true)) aviso('estadoInicial no válido: mapa de la semilla');
      // El mapa da nombre al duelo (lo de otra partida que llegue tarde se ignora) y pone las nubes
      // (iguales en los dos aparatos aunque el que se une no sepa la semilla)
      const h = resumen(volcarTerreno().celdas);
      dl.id = h.toString(36);
      semillaNubes = h % 1000003;
      jug = heroes[dl.turnoDe];
      co = partidaDuelo(false);
      $fin.hidden = true;
      claveControles = '';
      pintarFondo();
      pintarAviso();
    }
    function nuevoDuelo(o) {
      if (!duelo || detenido) return false;
      o = o && typeof o === 'object' ? o : {};
      if (Array.isArray(o.jugadores)) jugadores = leerJugadores(o.jugadores);
      nuevaPartidaDuelo(o);
      llamar('alListo', instantanea());
      return true;
    }
    // Instantánea (JSON compacto, unos 3 KB): el terreno + los dos héroes + nº de turnos jugados
    // (turnoN) y a quién le toca (siguiente)
    function instantanea() {
      if (!duelo || !dl) return null;
      const r = (v) => Math.round(v * 1000) / 1000;
      return Object.assign({ v: 1, W, H }, volcarTerreno(), {
        heroes: heroes.map((e) => ({ x: r(e.x), y: r(e.y), vida: Math.round(e.vida), vivo: !!e.vivo, fuera: !!e.fuera, dir: e.dir < 0 ? -1 : 1 })),
        turnoN: dl.n - 1, siguiente: dl.turnoDe,
      });
    }
    // Aplica una instantánea (con todo quieto). conTurno: también el nº de turno y a quién le toca.
    // Si algo no vale, no toca nada y devuelve false.
    function aplicarInstantanea(o, conTurno) {
      if (!duelo || !o || typeof o !== 'object') return false;
      if ((o.v != null && o.v !== 1) || (o.W != null && o.W !== W) || (o.H != null && o.H !== H)) return false;
      const hs = Array.isArray(o.heroes) && o.heroes.length === 2 ? o.heroes.map(leerHeroe) : null;
      if (!hs || !hs[0] || !hs[1]) return false;
      if (!cargarTerreno(o)) return false;
      heroes.forEach((e, k) => ponerHeroe(e, hs[k]));
      proys = []; pendientes = [];
      if (conTurno) {
        const n = numero(o.turnoN), s = numero(o.siguiente);
        if (Number.isInteger(n) && n >= 0) dl.n = n + 1;
        if (s === 0 || s === 1) dl.turnoDe = s;
      }
      return true;
    }
    function ponerHeroe(e, h) {
      const muere = e.vivo && !h.vivo;
      e.x = h.x; e.y = h.y; e.vida = h.vida; e.dir = h.dir; e.fuera = h.fuera;
      e.vx = 0; e.vy = 0; e.mov = null; e.oculto = false;
      if (h.vivo) { e.vivo = true; e.estado = 'quieto'; e.muerteT = -1; e.casa = clamp(Math.floor(h.x), 0, W - 1); }
      else { e.vivo = false; e.estado = h.fuera ? 'fuera' : 'derrotado'; if (muere || e.muerteT < 0) e.muerteT = t; }
    }
    // ¿Se espera ahora al jugador remoto? (desde que empieza su turno hasta que llega su turno oficial)
    function esperandoRival() {
      return !!(duelo && dl && fase !== 'fin' && !jugadores[dl.turnoDe].local && !dl.turnos[dl.n]);
    }
    // Nada que hacer hasta que llegue algo de la red
    function bloqueado() { return !!(duelo && fase === 'remoto' && dl.esperando && tranquilo()); }
    // Avisos de la app ("Esperando a Alex…", "Alex se ha ido"): un cartel fijo encima del juego (con
    // un botón Salir si se pide); con el cartel del final a la vista, va dentro de él
    function ponerAviso(txt, op) {
      avisoTexto = txt == null || txt === '' ? null : String(txt);
      avisoSalir = !!(avisoTexto && op && op.salir);
      claveControles = ''; // (la mano de ayuda no sale con un aviso puesto)
      pintarAviso();
    }
    function pintarAviso() {
      const fin = !$fin.hidden;
      $avisoT.textContent = $finAviso.textContent = avisoTexto || '';
      $aviso.hidden = !avisoTexto || fin;
      $avisoB.hidden = !avisoSalir;
      $finAviso.hidden = !avisoTexto || !fin;
      if (avisoSalir && !fin) $cartel.classList.remove('bt-ver'); // (y fuera el cartel que hubiera)
    }
    // Avisa a la app (sus errores nunca rompen el juego). Primero lo de duelo, luego lo de opciones.
    function llamar(nombre, dato) {
      const f = (duelo && typeof duelo[nombre] === 'function' && duelo[nombre]) || (typeof opciones[nombre] === 'function' && opciones[nombre]);
      if (!f) return false;
      try { f(dato); } catch (err) { anotarError(err); }
      return true;
    }

    // ---------- movimiento por la rejilla (andar / saltar)
    function ocupado(x, y, quien) {
      return ents.some((o) => o !== quien && o.vivo && !o.oculto && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 2);
    }
    // Destino al moverse una columna: sube hasta maxSubir bloques, baja lo que haga falta.
    function destino(e, dir, maxSubir) {
      const c = Math.floor(e.x), j = Math.round(e.y), cx = c + dir;
      if (cx < 0 || cx >= W) return null;
      for (let s = 0; s <= maxSubir; s++) {
        const jj = j - s;
        if (!solido(cx, jj) || solido(cx, jj - 1) || solido(cx, jj - 2)) continue;
        let libre = true;
        for (let k = 1; k <= s; k++) if (solido(c, j - 2 - k)) libre = false;
        if (!libre) continue;
        return { x: cx + 0.5, y: jj, s, cae: false, peligro: jj > AGUA, ocupado: ocupado(cx + 0.5, jj, e) };
      }
      if (!solido(cx, j) && !solido(cx, j - 1) && !solido(cx, j - 2)) {
        let y = j;
        while (y < H && !solido(cx, y)) y++;
        return { x: cx + 0.5, y: j, s: 0, cae: true, suelo: y, peligro: y > AGUA || y >= H, ocupado: ocupado(cx + 0.5, y, e) };
      }
      return null;
    }
    function iniciarMov(e, d, tipo) {
      const salto = tipo === 'salto';
      let y1 = d.y;
      if (d.cae && d.suelo === d.y + 1) y1 = d.suelo; // escalón hacia abajo: bajada suave
      e.dir = Math.sign(d.x - e.x) || e.dir;
      e.mov = {
        x0: e.x, y0: e.y, x1: d.x, y1, k: 0,
        dur: (salto ? 0.42 : d.s > 0 ? 0.3 : 0.24) * (e.esJugador ? 1 : 0.8),
        arco: salto ? 1.3 : d.s > 0 ? 0.35 : 0.06,
      };
      e.estado = 'mov';
    }
    function moverJugador(orden) {
      if (pasos <= 0) { colaMov.length = 0; flotar(jug.x, jug.y - 2.6, '¡Sin pasos!', '#fff'); return; }
      const dir = orden.dir || jug.dir;
      jug.dir = dir;
      const salto = orden.tipo === 'salto';
      const d = destino(jug, dir, salto ? 2 : 1);
      // El jugador no baja hasta la orilla: así no acaba en el agua por un empujón
      if (d && ((d.cae ? d.suelo : d.y) > AGUA - 1 || d.x < 6 || d.x > W - 6)) d.peligro = true;
      if (!d || d.peligro || d.ocupado) {
        colaMov.length = 0;
        if (d && d.peligro) flotar(jug.x + dir, jug.y - 2.4, '¡Agua!', '#bfe8ff');
        if (salto) { // saltito en el sitio
          jug.mov = { x0: jug.x, y0: jug.y, x1: jug.x, y1: jug.y, k: 0, dur: 0.36, arco: 0.9 };
          jug.estado = 'mov';
          S('salto');
        } else S('click');
        return;
      }
      iniciarMov(jug, d, salto ? 'salto' : 'andar');
      pasos--;
      S(salto ? 'salto' : 'paso');
    }

    // ---------- física de los personajes
    function actualizarEntidad(e) {
      if (!e.vivo) return;
      if (e.destello > 0) e.destello = Math.max(0, e.destello - DT * 2.5);
      if (e.mov) {
        const m = e.mov;
        m.k = Math.min(1, m.k + DT / m.dur);
        e.x = lerp(m.x0, m.x1, m.k);
        e.y = lerp(m.y0, m.y1, m.k) - m.arco * Math.sin(Math.PI * m.k);
        if (m.k >= 1) { e.x = m.x1; e.y = m.y1; e.mov = null; e.estado = 'quieto'; }
        return;
      }
      if (e.estado === 'quieto') {
        const c = Math.floor(e.x), j = Math.round(e.y);
        e.x = c + 0.5; e.y = j;
        if (cajaChoca(e.x, e.y)) { desatascar(e); return; }
        if (solido(c, j)) return;
        e.estado = 'vuela'; e.vx = 0; e.vy = 0;
      }
      // En el aire: gravedad y choques con los bloques
      e.vy = Math.min(e.vy + G * DT, 28);
      const n = Math.max(1, Math.ceil((Math.max(Math.abs(e.vx), Math.abs(e.vy)) * DT) / 0.2));
      for (let k = 0; k < n; k++) {
        const dx = (e.vx * DT) / n, dy = (e.vy * DT) / n;
        e.x += dx;
        if (cajaChoca(e.x, e.y)) { e.x -= dx; e.vx = -e.vx * 0.25; }
        e.y += dy;
        if (cajaChoca(e.x, e.y)) {
          if (dy > 0) {
            const yy = Math.floor(e.y);
            if (!cajaChoca(e.x, yy)) e.y = yy; else e.y -= dy;
            aterrizar(e);
            break;
          }
          e.y -= dy; e.vy = 0;
        }
      }
      if (e.estado === 'vuela' && (e.y > AGUA + 0.3 || e.x < -0.6 || e.x > W + 0.6)) alAgua(e);
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { anotarError('posición no válida en ' + e.tipo); e.x = e.casa + 0.5; e.y = superficie(e.casa); e.vx = e.vy = 0; e.estado = 'quieto'; }
    }
    function aterrizar(e) {
      e.vx = 0; e.vy = 0; e.estado = 'quieto';
      e.x = Math.floor(e.x) + 0.5;
      e.y = Math.round(e.y);
      if (cajaChoca(e.x, e.y)) desatascar(e);
    }
    // Si (por lo que sea) un personaje queda dentro de los bloques, se le pone de pie en el hueco más cercano
    function desatascar(e) {
      const c = clamp(Math.floor(e.x), 0, W - 1);
      const y0 = Math.round(e.y);
      for (let d = 0; d < H; d++) {
        for (const y of [y0 - d, y0 + d]) {
          if (y < 2 || y > AGUA) continue;
          if (solido(c, y) && !solido(c, y - 1) && !solido(c, y - 2)) { e.x = c + 0.5; e.y = y; e.vx = e.vy = 0; e.estado = 'quieto'; e.mov = null; return; }
        }
      }
      e.x = c + 0.5; e.y = AGUA + 1; alAgua(e);
    }
    function asentarYa(e) {
      e.mov = null; e.vx = 0; e.vy = 0;
      const c = clamp(Math.floor(e.x), 0, W - 1);
      let y = Math.max(2, Math.ceil(e.y - 0.01));
      while (y <= AGUA && !(solido(c, y) && !solido(c, y - 1) && !solido(c, y - 2))) y++;
      e.x = c + 0.5;
      if (y > AGUA) { e.y = AGUA + 1; alAgua(e); return; }
      e.y = y; e.estado = 'quieto';
      if (cajaChoca(e.x, e.y)) desatascar(e);
    }
    function empujar(e, vx, vy) {
      if (!e.vivo || (e.esJugador && facil)) return;
      e.mov = null; e.estado = 'vuela';
      e.vx += vx; e.vy += vy;
    }
    function alAgua(e) {
      if (stats.alAgua.length < 20) stats.alAgua.push(e.tipo + '@' + e.x.toFixed(1) + ' fase ' + fase + ' t' + t.toFixed(1));
      chapuzon(e.x, AGUA);
      S('agua');
      if (e.esJugador && facil) { rescatar(e); return; }
      e.vivo = false; e.fuera = true; e.muerteT = t; e.estado = 'fuera'; e.mov = null;
      e.y = Math.min(e.y, AGUA + 1);
      flotar(clamp(e.x, 1, W - 1), AGUA - 1.5, '¡Al agua!', '#bfe8ff', true);
      if (!e.esJugador) soltarOrbes(e);
    }
    // Si una explosión deja a dos personajes en la misma casilla (uno encima de otro), el monstruo
    // que sobra se va (con una nubecita) al sitio libre más cercano, mejor lejos del héroe.
    function solapado(e) {
      return ents.some((o) => o !== e && o.vivo && !o.oculto && Math.abs(o.x - e.x) < 0.6 && Math.abs(o.y - e.y) < 2);
    }
    function sitioCerca(c, y0, maxDy) {
      let mejor = null;
      for (let y = 2; y <= AGUA - 1; y++) {
        if (!solido(c, y) || solido(c, y - 1) || solido(c, y - 2)) continue;
        const tp = celdas[y * W + c];
        if (tp === HOJAS || tp === MADERA) continue;
        if (Math.abs(y - y0) <= maxDy && (mejor == null || Math.abs(y - y0) < Math.abs(mejor - y0))) mejor = y;
      }
      return mejor;
    }
    function separar() {
      for (const e of ents) {
        // (en el 1 contra 1, si un héroe cae encima del otro, se aparta el que no tiene el turno)
        if (!e.vivo || e.oculto || (duelo ? e === jug : e.esJugador) || !solapado(e)) continue;
        const lejos = Math.sign(e.x - jug.x) || 1;
        const c0 = Math.floor(e.x);
        let sitio = null;
        for (const maxDy of [3, H]) {
          for (let d = 1; d < W && !sitio; d++) {
            for (const c of [c0 + lejos * d, c0 - lejos * d]) {
              if (sitio || c < 2 || c >= W - 2) continue;
              const y = sitioCerca(c, e.y, maxDy);
              if (y != null && !ocupado(c + 0.5, y, e)) sitio = { c, y };
            }
          }
          if (sitio) break;
        }
        if (!sitio) continue;
        humo(e.x, e.y - 1, 3);
        e.x = sitio.c + 0.5; e.y = sitio.y; e.vx = e.vy = 0; e.estado = 'quieto'; e.mov = null;
        humo(e.x, e.y - 1, 3);
      }
    }
    function rescatar(e) {
      // El sitio de pie más cerca de su casa; mejor con suelo firme (3 bloques), no en el fondo de un
      // cráter sobre el agua, donde el siguiente disparo lo volvería a tirar
      const firme = (c, y) => solido(c, y + 1) && solido(c, y + 2);
      let mejor = null;
      for (const exigente of [true, false]) {
        for (let d = 0; d < W && mejor == null; d++) {
          for (const c of [e.casa - d, e.casa + d]) {
            if (mejor != null || c < 1 || c >= W - 1) continue;
            const y = sitioDePie(c, true);
            if (y != null && y <= AGUA - 1 && (!exigente || firme(c, y)) && !ocupado(c + 0.5, y, e)) mejor = { c, y };
          }
        }
        if (mejor) break;
      }
      // (con la isla rota entera no queda ningún sitio de pie: sin plataforma, se quedaría vivo en el fondo del mar)
      if (!mejor) mejor = plataformaRescate(e);
      e.x = mejor.c + 0.5; e.y = mejor.y; e.vx = 0; e.vy = 0; e.estado = 'quieto'; e.mov = null;
      humo(e.x, e.y - 1, 4);
      flotar(e.x, e.y - 2.6, '¡Plof!', '#fff', true);
    }
    // Una plataforma pequeña de piedra a ras del agua (fila AGUA-1, la de piedra del fondo de la
    // isla), en la columna libre más cerca de su casa, para ponerlo de pie encima: la partida sigue.
    function plataformaRescate(e) {
      const y = AGUA - 1;
      const cabe = (c) => c >= 1 && c < W - 1 && !solido(c, y - 1) && !solido(c, y - 2) && !ocupado(c + 0.5, y, e);
      let c0 = null;
      for (let d = 0; d < W && c0 == null; d++) {
        for (const c of [e.casa - d, e.casa + d]) if (c0 == null && cabe(c)) c0 = c;
      }
      if (c0 == null) { c0 = clamp(e.casa, 1, W - 2); quitar(c0, y - 1); quitar(c0, y - 2); } // (no debería pasar)
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const i = y * W + c;
        // Debajo del héroe, piedra siempre (aunque hubiera hojas, que se deshacen); a los lados, solo en el aire
        if (c !== c0 && celdas[i] !== AIRE) continue;
        celdas[i] = PIEDRA; dano[i] = 0; cueva[i] = 0; sucias.push(i);
      }
      stats.plataformas++;
      return { c: c0, y };
    }

    // ---------- daño
    function herir(e, dn, origen) {
      if (!e.vivo || e.oculto || dn <= 0) return;
      if (e.esJugador && facil) return;
      if (e.esJugador) stats.danoJugador[origen || '?'] = (stats.danoJugador[origen || '?'] || 0) + dn;
      e.vida = Math.max(0, e.vida - dn);
      e.destello = 1;
      flotar(e.x, e.y - (ALTO_DIBUJO[e.tipo] || 2) - 0.6, '-' + dn, e.esJugador ? '#ff6b6b' : '#ffe14d', true);
      S('golpe');
      if (e.tipo === 'creeper') { programarCreeper(e, 0.35); return; } // el creeper golpeado explota
      if (e.vida <= 0) morir(e);
    }
    function morir(e) {
      e.vivo = false; e.muerteT = t; e.mov = null; e.estado = 'derrotado';
      if (e.esJugador) { flotar(e.x, e.y - 2.6, '¡Ay!', '#fff', true); return; }
      humo(e.x, e.y - 1, 6);
      soltarOrbes(e);
    }
    function programarCreeper(c, retraso) {
      if (c.explotando || c.programado) return;
      c.programado = true;
      c.siseo = t;
      pendientes.push({ at: t + retraso, fn: () => explotarCreeper(c) });
    }
    function explotarCreeper(c) {
      if (c.explotando) return;
      c.explotando = true;
      const estabaVivo = c.vivo;
      c.vivo = false; c.oculto = true; c.muerteT = t; c.mov = null;
      if (!estabaVivo && c.fuera) return; // se ahogó antes: la mecha se apaga
      const herida = 25 + Math.floor(azar() * 11); // en fácil tampoco hiere al héroe (herir/empujar lo ignoran), pero sí a los monstruos
      explotar(c.x, c.y - 0.9, 3 + (facil ? 0.4 : 0), herida, { empuje: 8, fuente: c, minimo: 0.6, origen: 'creeper' });
      soltarOrbes(c);
    }

    // ---------- explosiones
    // herida: daño a los personajes en el centro. op.piedra: multiplica el golpe a la piedra.
    // Devuelve cuántos bloques ha roto.
    function explotar(x, y, radio, herida, op) {
      op = op || {};
      let rotas = 0;
      // Bloques: golpe 1 justo en el radio, más cerca más, y llega ALCANCE_EXTRA más allá (solo agrieta)
      const alcance = radio + ALCANCE_EXTRA, piedra = op.piedra || 1;
      for (let j = Math.max(0, Math.floor(y - alcance)); j <= Math.min(H - 1, Math.ceil(y + alcance)); j++) {
        for (let i = Math.max(0, Math.floor(x - alcance)); i <= Math.min(W - 1, Math.ceil(x + alcance)); i++) {
          const tp = celdas[j * W + i];
          if (tp === AIRE) continue;
          const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
          if (d >= alcance) continue;
          if (danar(j * W + i, ((tp === PIEDRA ? piedra : 1) * (alcance - d)) / ALCANCE_EXTRA)) {
            rotas++;
            if (rotas <= 30 || Math.random() < 0.25) particulasBloque(i, j, tp);
          }
        }
      }
      // Flechas clavadas cerca: se caen
      clavadas = clavadas.filter((f) => Math.hypot(f.x - x, f.y - y) > radio + 0.5);
      if (rotas) decaerArboles();
      for (const e of ents) {
        if (!e.vivo || e.oculto || e === op.fuente) continue;
        const cx = clamp(x, e.x - MEDIO_AN, e.x + MEDIO_AN), cy = clamp(y, e.y - ALTO_CAJA, e.y);
        const d = Math.hypot(cx - x, cy - y);
        if (d >= radio) continue;
        const f = 1 - d / radio;
        let dn = Math.round(herida * (op.minimo ? op.minimo + (1 - op.minimo) * f : f));
        // Tus propias explosiones te hacen menos daño (en el 1 contra 1, solo al que dispara: el rival
        // recibe el daño entero). El empuje a los dos héroes es el mismo.
        const propia = duelo ? e === op.tirador : e.esJugador && !op.origen;
        if (propia) dn = Math.min(TOPE_AUTODANO, Math.round(dn * autodano(nivel)));
        if (dn > 0) herir(e, dn, op.origen || (duelo && !propia ? 'rival' : 'propio'));
        if (dn > 0 && propia && !facil) flotar(e.x, e.y - 3.3, '¡Cuidado, muy cerca!', '#ffd27a');
        if (!e.vivo) continue;
        const imp = (op.empuje || 8) * (0.35 + 0.65 * f);
        let sx = Math.sign(e.x - x);
        if (sx === 0) sx = Math.random() < 0.5 ? -1 : 1;
        const k = e.esJugador ? (op.origen ? 0.6 : 0.35) : 1; // al jugador le empuja menos (y sus propias explosiones, mucho menos)
        empujar(e, sx * imp * 0.7 * k, -imp * 0.75 * k);
      }
      // Efectos
      destellos.push({ x, y, r: radio, t0: t });
      const colores = ['#fff6b8', '#ffc247', '#ff7a00', '#ffd83d', '#ffffff'];
      for (let k = 0; k < 10 + radio * 4; k++) {
        const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 8;
        particula({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, vida: 0.25 + Math.random() * 0.35, tam: 0.22 + Math.random() * 0.25, color: colores[k % colores.length], g: 0.25 });
      }
      humo(x, y, 4 + Math.round(radio));
      temblor = Math.max(temblor, 0.25 + radio * 0.09);
      S('explosion', radio >= 3.6);
      return rotas;
    }

    // Como en Minecraft: las hojas que ya no tocan un tronco (y los trozos de tronco que
    // quedan colgando) se deshacen poco a poco, para que no queden árboles flotando.
    const decayendo = new Set();
    function decaerArboles() {
      const vivo = new Uint8Array(W * H);
      const cola = [];
      // Troncos anclados: madera que, bajando por madera, llega a un bloque que no es de árbol
      for (let x = 0; x < W; x++) {
        for (let y = H - 1; y >= 0; y--) {
          const i = y * W + x;
          if (celdas[i] !== MADERA) continue;
          const abajo = y + 1 < H ? celdas[i + W] : PIEDRA;
          if ((abajo !== AIRE && abajo !== HOJAS && abajo !== MADERA) || (abajo === MADERA && vivo[i + W])) { vivo[i] = 1; cola.push(i, 0); }
        }
      }
      for (let k = 0; k < cola.length; k += 2) {
        const i = cola[k], d = cola[k + 1];
        if (d >= 4) continue;
        const x = i % W;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= W * H || vivo[j]) continue;
          if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
          if (celdas[j] === HOJAS) { vivo[j] = 1; cola.push(j, d + 1); }
        }
      }
      for (let i = 0; i < W * H; i++) {
        const tp = celdas[i];
        if ((tp !== HOJAS && tp !== MADERA) || vivo[i] || decayendo.has(i)) continue;
        decayendo.add(i);
        const x = i % W, y = (i / W) | 0;
        pendientes.push({ at: t + 0.25 + Math.random() * 0.9, fn: () => {
          decayendo.delete(i);
          if (celdas[i] !== tp) return;
          quitar(x, y);
          particulasBloque(x, y, tp);
        } });
      }
    }

    // ---------- proyectiles
    // Sitio de salida del proyectil: delante del héroe, a la altura del arma. Si ahí hay un bloque
    // (un escalón o un tronco pegado al héroe), se acerca al héroe hasta que quede libre: así nada
    // nace dentro de un bloque (la TNT se quedaba incrustada y explotaba pegada al héroe).
    function origenDisparo(a, tipo) {
      const o = { x: jug.x + Math.cos(a) * 0.7, y: jug.y - 1.3 - Math.sin(a) * 0.7 };
      // (con un poco de holgura también para el cohete: si nace rozando un escalón, explota contra él)
      const libre = (x, y) => !cajaPeq(x, y, tipo === 'tnt' ? 0.32 : 0.3);

      if (libre(o.x, o.y)) return o;
      for (let k = 1; k <= 10; k++) { const x = lerp(o.x, jug.x, k / 10); if (libre(x, o.y)) return { x, y: o.y }; }
      for (let k = 1; k <= 10; k++) { const y = lerp(o.y, jug.y - 1, k / 10); if (libre(jug.x, y)) return { x: jug.x, y }; }
      return { x: jug.x, y: jug.y - 1 };
    }
    function puedeApuntar() {
      return fase === 'jugador' && !disparado && !saltarTurno && !pausado && jug && jug.vivo && reposado(jug) && colaMov.length === 0;
    }
    function disparar(angDeg, fuerza, cual) {
      if (!puedeApuntar()) return false;
      angDeg = Number(angDeg); fuerza = Number(fuerza);
      if (!Number.isFinite(angDeg) || !Number.isFinite(fuerza)) return false;
      cual = cual === 'tnt' || cual === 'bazooka' ? cual : arma;
      arma = cual;
      fuerza = clamp(fuerza, 0.08, 1);
      if (duelo) {
        // Se dispara con lo mismo que se manda (redondeado): el otro aparato repite este tiro exacto
        angDeg = Math.round(angDeg * 100) / 100;
        fuerza = Math.round(fuerza * 10000) / 10000;
        grabar({ a: 'disparo', ang: angDeg, fuerza, arma: cual });
      }
      soltarTiro(angDeg, fuerza, cual);
      return true;
    }
    // El tiro en sí, desde jug (también el del rival cuando se reproduce su jugada)
    function soltarTiro(angDeg, fuerza, cual) {
      arma = cual;
      const o = lanzarProyectil(rad(angDeg), fuerza, cual);
      disparado = true;
      tiros++;
      if (duelo) dl.tiros[dl.turnoDe]++;
      ultimoTiro = { ang: angDeg, fuerza, arma: cual };
      apunte = null;
      S('disparo');
      for (let k = 0; k < 4; k++) particula({ tipo: 'humo', x: o.x, y: o.y, vx: (Math.random() - 0.5) * 1.5, vy: -0.5 - Math.random(), vida: 0.5 + Math.random() * 0.3, tam: 0.5, g: -0.02 });
    }
    // El cohete o la TNT sale del héroe (a = ángulo en radianes, fuerza 0..1). Devuelve el sitio de salida.
    function lanzarProyectil(a, fuerza, cual) {
      const v = fuerza * VMAX[cual];
      const o = origenDisparo(a, cual === 'tnt' ? 'tnt' : 'cohete');
      jug.dir = Math.cos(a) >= 0 ? 1 : -1;
      proys.push({ tipo: cual === 'tnt' ? 'tnt' : 'cohete', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, t0: t, dueno: jug, giro: 0, ultTic: 0, muerto: false });
      return o;
    }
    function lanzarFlecha(s, angDeg, v) {
      const a = rad(angDeg);
      const o = { x: s.x + Math.cos(a) * 0.6, y: s.y - 1.3 - Math.sin(a) * 0.6 };
      proys.push({ tipo: 'flecha', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, t0: t, dueno: s, muerto: false });
      stats.flechas++;
    }
    function entidadEn(x, y, dueno, edad) {
      for (const e of ents) {
        if (!e.vivo || e.oculto) continue;
        if (e === dueno && edad < 0.3) continue;
        if (x >= e.x - 0.42 && x <= e.x + 0.42 && y >= e.y - 1.85 && y <= e.y + 0.05) return e;
      }
      return null;
    }
    function imanFacil(p) {
      // Modo fácil: el proyectil se curva un poco hacia el monstruo más cercano
      const ALCANCE = 6;
      let mejor = null, md = ALCANCE;
      for (const e of ents) {
        if (!e.vivo || e.esJugador || e.oculto) continue;
        const d = Math.hypot(e.x - p.x, e.y - 0.9 - p.y);
        if (d < md) { md = d; mejor = e; }
      }
      if (!mejor) return;
      const dx = mejor.x - p.x, dy = mejor.y - 0.9 - p.y, d = Math.hypot(dx, dy) || 1;
      const k = 10 + 45 * (1 - md / ALCANCE);
      p.vx += (dx / d) * k * DT;
      p.vy += (dy / d) * k * DT;
    }
    // Un paso (DT) de un proyectil en vuelo, con sub-pasos. Lo usan el vuelo real y la línea de puntos,
    // así la guía y el disparo coinciden siempre. Devuelve el choque o null.
    function pasoBala(p, edad, conEntidades, magia) {
      if (p.tipo === 'cohete') p.vx += viento * VIENTO_ACEL * DT;
      if (magia && (p.tipo !== 'tnt' || Math.abs(p.vy) > 1)) imanFacil(p); // igual que en el vuelo de verdad
      p.vy += G * DT;
      const tnt = p.tipo === 'tnt';
      const n = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * DT) / 0.15));
      for (let k = 0; k < n; k++) {
        p.x += (p.vx * DT) / n;
        p.y += (p.vy * DT) / n;
        if (p.x < -2 || p.x > W + 2) return { tipo: 'fuera' };
        if (p.y > AGUA + 0.15) return { tipo: 'agua' };
        if (tnt ? cajaPeq(p.x, p.y, 0.32) : solido(Math.floor(p.x), Math.floor(p.y))) return { tipo: 'bloque' };
        if (conEntidades && !tnt) {
          const e = entidadEn(p.x, p.y, p.dueno, edad);
          if (e && (p.tipo === 'cohete' || e === jug)) return { tipo: 'entidad', e };
        }
      }
      return null;
    }
    function actualizarProyectil(p) {
      // (en el 1 contra 1, la edad se cuenta en pasos: el otro aparato repite el tiro a otra hora y con
      // t - t0 el redondeo hacía que la mecha de la TNT acabara un paso antes o después en cada uno)
      const edad = duelo ? (p.pasos = (p.pasos || 0) + 1) * DT : t - p.t0;
      if (p.tipo === 'tnt') { actualizarTNT(p, edad); return; }
      if (p.tipo === 'cohete' && Math.random() < 0.6) particula({ tipo: 'humo', x: p.x, y: p.y, vx: -p.vx * 0.05, vy: -0.3, vida: 0.45, tam: 0.3, g: -0.02 });
      const r = pasoBala(p, edad, true, facil && p.dueno === jug && p.tipo === 'cohete');
      if (edad > 9 || (r && r.tipo === 'fuera')) { p.muerto = true; return; }
      if (!r) return;
      if (r.tipo === 'agua') { chapuzon(p.x, AGUA); S('agua'); p.muerto = true; return; }
      impacto(p, r.e || null);
    }
    function impacto(p, e) {
      p.muerto = true;
      if (p.tipo === 'cohete') {
        const def = ARMAS.bazooka;
        explotar(p.x - p.vx * 0.004, p.y - p.vy * 0.004, def.radio + (facil ? EXTRA_RADIO_FACIL : 0), def.dano, { empuje: def.empuje, piedra: def.piedra, tirador: p.dueno });
        return;
      }
      // flecha
      if (e) {
        stats.flechasAcertadas++;
        if (!facil) {
          herir(e, 10, 'flecha');
          empujar(e, Math.sign(p.vx) * 2.5, -3);
        }
        S('golpe');
      } else {
        clavadas.push({ x: p.x, y: p.y, ang: Math.atan2(p.vy, p.vx), t0: t });
        S('click');
      }
    }
    // Red de seguridad: si una TNT empieza un paso dentro de un bloque, se saca al hueco libre más
    // cercano (hacia arriba o hacia el héroe) en vez de quedarse incrustada
    function sacarTNT(p) {
      const hacia = Math.sign(jug.x - p.x) || 1;
      for (let k = 1; k <= 25; k++) {
        const d = k * 0.1;
        for (const [x, y] of [[p.x, p.y - d], [p.x + hacia * d, p.y], [p.x - hacia * d, p.y], [p.x, p.y + d]]) {
          if (!cajaPeq(x, y, 0.32)) { p.x = x; p.y = y; return; }
        }
      }
    }
    function actualizarTNT(p, edad) {
      if (cajaPeq(p.x, p.y, 0.32)) sacarTNT(p);
      if (edad >= MECHA_TNT) {

        p.muerto = true;
        const def = ARMAS.tnt;
        explotar(p.x, p.y, def.radio + (facil ? EXTRA_RADIO_FACIL : 0), def.dano, { empuje: def.empuje, piedra: def.piedra, tirador: p.dueno });
        return;
      }
      if (Math.floor(edad) !== p.ultTic) { p.ultTic = Math.floor(edad); S('tic'); }
      if (facil && p.dueno === jug && Math.abs(p.vy) > 1) imanFacil(p);
      p.vy = Math.min(p.vy + G * DT, 28);
      const n = Math.max(1, Math.ceil((Math.max(Math.abs(p.vx), Math.abs(p.vy)) * DT) / 0.15));
      for (let k = 0; k < n; k++) {
        const dx = (p.vx * DT) / n, dy = (p.vy * DT) / n;
        p.x += dx;
        if (cajaPeq(p.x, p.y, 0.32)) { p.x -= dx; p.vx = -p.vx * 0.35; }
        p.y += dy;
        if (cajaPeq(p.x, p.y, 0.32)) {
          p.y -= dy;
          if (dy > 0) {
            p.vx *= 0.7;
            p.vy = Math.abs(p.vy) > 3 ? -p.vy * 0.35 : 0;
            if (Math.abs(p.vy) > 2) S('paso');
          } else p.vy = 0;
        }
      }
      p.giro += p.vx * DT * 2;
      if (p.x < -2 || p.x > W + 2 || p.y > AGUA + 0.3) {
        p.muerto = true;
        chapuzon(clamp(p.x, 0, W), AGUA);
        S('agua');
        flotar(clamp(p.x, 1, W - 1), AGUA - 1.5, '¡Plof!', '#bfe8ff');
      }
    }

    // Trayectoria (para la línea de puntos, las pruebas y la puntería de los esqueletos)
    function trayectoria(x, y, vx, vy, tipo, maxT, conEntidades, magia) {
      const pts = [];
      let fin = null, golpe = null;
      const p = { tipo, x, y, vx, vy, dueno: jug };
      for (let i = 1; i * DT <= maxT + 1e-9; i++) {
        const r = pasoBala(p, i * DT, conEntidades, !!magia);
        if (i % 3 === 0) pts.push({ x: p.x, y: p.y });
        if (r) {
          if (r.tipo === 'agua') fin = { x: p.x, y: AGUA, agua: true };
          else if (r.tipo !== 'fuera') fin = { x: p.x, y: p.y };
          if (r.e) golpe = r.e;
          break;
        }
      }
      return { pts, fin, golpe };
    }
    function mejorTiro(s) {
      const obj = { x: jug.x, y: jug.y - 0.9 };
      const derecha = obj.x >= s.x;
      let mejor = { ang: derecha ? 45 : 135, v: VMAX.flecha * 0.7, err: 1e9 };
      for (let a = 8; a <= 80; a += 3) {
        for (let v = 8; v <= VMAX.flecha; v += 1.5) {
          const ang = derecha ? a : 180 - a;
          const r = rad(ang);
          const err = errorTiro(s.x + Math.cos(r) * 0.6, s.y - 1.3 - Math.sin(r) * 0.6, Math.cos(r) * v, -Math.sin(r) * v, obj);
          if (err < mejor.err) mejor = { ang, v, err };
        }
      }
      return mejor;
    }
    function errorTiro(x, y, vx, vy, obj) {
      let mejor = 1e9;
      const dt = 1 / 30;
      for (let i = 0; i < 150; i++) {
        vy += G * dt; x += vx * dt; y += vy * dt;
        const d = Math.hypot(x - obj.x, y - obj.y);
        if (d < mejor) mejor = d;
        if (d < 0.5) return d;
        if (x < -1 || x > W + 1 || y > AGUA + 0.5) break;
        if (solido(Math.floor(x), Math.floor(y))) break;
      }
      return mejor;
    }

    // ---------- turnos (corutinas con tiempo de simulación)
    // yield número = esperar segundos; yield función = esperar a que devuelva true; yield = un paso
    function* partida(saltarIntro) {
      if (!saltarIntro) {
        fase = 'inicio';
        cartel('Nivel ' + nivel);
        yield 1.1;
      }
      yield* bucleTurnos();
      yield* finPartida();
    }
    function terminada() { return !jug.vivo || ents.every((e) => e.esJugador || !e.vivo); }
    function* bucleTurnos() {
      while (!terminada()) {
        // Turno del jugador
        turnoN++;
        fase = 'jugador';
        pasos = PASOS_TURNO; disparado = false; saltarTurno = false; colaMov.length = 0; prisa = false; ayuda = false;
        viento = cfg.viento ? Math.round((azar() * 2 - 1) * cfg.viento * 10) / 10 : 0;
        // En fácil, si cae al agua se le rescata cerca de donde empezó este turno (no en la salida)
        jug.casa = clamp(Math.floor(jug.x), 0, W - 1);
        cartel('¡Tu turno!');
        inicioTurno = t;
        yield () => disparado || saltarTurno || !jug.vivo; // (si el suelo se le rompe en su turno, se acaba)
        fase = 'vuelo';
        apunte = null; colaMov.length = 0;
        yield* calma(12);
        if (terminada()) return;

        // Turno de los monstruos, uno a uno
        fase = 'monstruos';
        cartel('Turno de los monstruos', 'bt-suyo');
        yield 0.6;
        const lista = ents.filter((e) => e.vivo && !e.esJugador);
        for (const m of lista) {
          if (!m.vivo) continue;
          if (terminada()) return;
          activo = m;
          yield* conLimite(turnoMonstruo(m), 10);
          activo = null;
          yield* calma(10);
          yield 0.06;
        }
        activo = null;
      }
    }
    function* calma(max) {
      const fin = t + max;
      yield 0.08;
      yield () => tranquilo() || t > fin;
      if (!tranquilo()) { stats.calmasForzadas++; aviso('calma forzada'); forzarCalma(); }
      yield 0.1;
      if (!tranquilo()) forzarCalma();
      separar();
    }
    function tranquilo() {
      if (proys.length || pendientes.length) return false;
      for (const e of ents) if (e.vivo && !reposado(e)) return false;
      return true;
    }
    function forzarCalma() {
      for (let vuelta = 0; vuelta < 5 && (proys.length || pendientes.length); vuelta++) {
        proys.forEach((p) => { if (p.tipo === 'tnt') { p.t0 = t - MECHA_TNT; actualizarTNT(p, MECHA_TNT); } });
        proys = [];
        const ps = pendientes.splice(0);
        ps.forEach((p) => { try { p.fn(); } catch (err) { anotarError(err); } });
      }
      proys = []; pendientes = [];
      for (const e of ents) if (e.vivo && !reposado(e)) asentarYa(e);
    }
    function* conLimite(gen, seg) {
      const fin = t + seg;
      while (true) {
        if (t > fin) { stats.turnosLargos++; aviso('turno de monstruo cortado'); return; }
        let r;
        try { r = gen.next(); } catch (err) { anotarError(err); return; }
        if (r.done) return;
        const v = r.value;
        if (typeof v === 'number') { const hasta = Math.min(t + v, fin + 0.01); yield () => t >= hasta; }
        else if (typeof v === 'function') yield () => t > fin || v();
        else yield;
      }
    }
    function* finPartida() {
      const gano = jug.vivo && ents.every((e) => e.esJugador || !e.vivo);
      fase = 'fin';
      resultado = gano ? 'gano' : 'perdio';
      apunte = null; colaMov.length = 0;
      if (gano) { S('victoria'); confeti(); cartel('¡Nivel superado!', 'bt-bien'); }
      else { S('derrota'); cartel('¡Uy!', 'bt-suyo'); }
      if (!finAvisado) {
        finAvisado = true;
        try { if (typeof opciones.alTerminar === 'function') opciones.alTerminar({ gano, nivel }); } catch (err) { anotarError(err); }
      }
      yield 1.7;
      mostrarFin(gano);
    }

    // ---------- 1 contra 1: turnos
    // Cada turno es de un jugador (dl.turnoDe), que es local (juega en este aparato) o remoto (se
    // reproduce su jugada al llegar y luego se aplica su instantánea, que manda). n = 1, 2, 3...
    const nombreDe = (i) => NOMBRE_HEROE[jugadores[i].heroe];
    const enTablet = () => jugadores.every((j) => j.local);
    function terminadoDuelo() { return !heroes[0].vivo || !heroes[1].vivo; }
    function* partidaDuelo(saltarIntro) {
      if (!saltarIntro) {
        fase = 'inicio';
        cartel(nombreDe(0) + ' contra ' + nombreDe(1));
        yield 1.4;
      }
      // (después de un error, sigue desde el turno en el que estaba: dl lo sabe)
      while (!terminadoDuelo()) {
        const i = dl.turnoDe, n = dl.n;
        if (jugadores[i].local) yield* turnoLocalDuelo(i, n);
        else yield* turnoRemotoDuelo(i, n);
      }
      yield* finDuelo();
    }
    function empezarTurnoDuelo(i, n) {
      jug = heroes[i];
      turnoN = n;
      pasos = PASOS_TURNO; disparado = false; saltarTurno = false; colaMov.length = 0; prisa = false; ayuda = false;
      viento = 0; apunte = null; rep = null; acciones = [];
      arma = dl.armas[i];
      inicioTurno = t; dl.seg = -1;
      const local = jugadores[i].local;
      if (enTablet()) cartel('¡Turno de ' + nombreDe(i) + '!');
      else if (local) cartel('¡Tu turno!');
      else cartel('Turno de ' + nombreDe(i), 'bt-suyo');
      llamar('alEmpezarTurno', { n, jugador: i, local });
    }
    // Turno local: como el del héroe contra los monstruos, grabando lo que hace. Al disparar (o pasar,
    // o acabarse el tiempo) se manda la jugada; con todo quieto, el turno con la instantánea.
    // (dl.n !== n: alguien ha aplicado otra instantánea por medio, p. ej. las pruebas)
    function* turnoLocalDuelo(i, n) {
      fase = 'jugador';
      empezarTurnoDuelo(i, n);
      let agotado = false;
      if (dl.enviada !== n) {
        yield () => disparado || saltarTurno || !jug.vivo || sinTiempo() || dl.n !== n;
        if (dl.n !== n) return;
        if (!disparado) {
          agotado = sinTiempo() && jug.vivo && !saltarTurno;
          saltarTurno = true;
          grabar({ a: 'pasar' });
        }
        dl.enviada = n;
        llamar('alJugadaLocal', { id: dl.id, n, jugador: i, acciones: copia(acciones) });
      }
      fase = 'vuelo';
      apunte = null; colaMov.length = 0;
      // Se acabó el tiempo: que se vea el cartel antes del siguiente turno (la jugada ya ha salido)
      if (agotado) { cartel('¡Se acabó el tiempo!', 'bt-suyo'); S('click'); yield 1.2; }
      yield* calma(12);
      if (dl.n !== n) return;
      dl.armas[i] = arma;
      dl.n = n + 1; dl.turnoDe = 1 - i;
      const estado = instantanea();
      // También aquí: el daño queda en décimas, igual que en el otro aparato (los dos empiezan igual)
      aplicarInstantanea(estado, false);
      llamar('alTurnoLocal', { id: dl.id, n, jugador: i, acciones: copia(acciones), estado });
    }
    // Turno remoto: se espera su jugada (o, si se perdió, su turno), se reproduce y, con todo quieto
    // y el turno oficial ya aquí, se aplica su instantánea (manda sobre lo que se ha simulado aquí).
    function* turnoRemotoDuelo(i, n) {
      fase = 'remoto';
      empezarTurnoDuelo(i, n);
      if (dl.repetida !== n) {
        dl.esperando = true;
        yield () => dl.turnos[n] || dl.jugadas[n] || dl.n !== n;
        dl.esperando = false;
        if (dl.n !== n) return;
        dl.repetida = n;
        empezarRepeticion((dl.turnos[n] || dl.jugadas[n]).acciones);
        const tope = t + 45;
        yield () => !rep || rep.hecha || t > tope || dl.n !== n;
        if (dl.n !== n) return;
        if (rep && !rep.hecha) aviso('repetición cortada');
        rep = null;
      }
      yield* calma(12);
      if (!dl.turnos[n]) {
        dl.esperando = true;
        yield () => dl.turnos[n] || dl.n !== n;
        dl.esperando = false;
        if (dl.n !== n) return;
      }
      dl.armas[i] = arma;
      const antes = firmaDuelo();
      if (!aplicarInstantanea(dl.turnos[n].estado, false)) aviso('instantánea del rival no válida: sigue lo simulado');
      else { stats.instantaneas++; if (firmaDuelo() !== antes) stats.corregidas++; }
      dl.n = n + 1; dl.turnoDe = 1 - i;
      for (const k of Object.keys(dl.jugadas)) if (+k < dl.n) delete dl.jugadas[k];
      for (const k of Object.keys(dl.turnos)) if (+k < dl.n) delete dl.turnos[k];
    }
    function firmaDuelo() { const o = instantanea(); return o.celdas + o.dano + JSON.stringify(o.heroes); }
    function sinTiempo() { return dl.tiempo > 0 && t - inicioTurno >= dl.tiempo; }
    // Segundos que le quedan al turno local (null si no hay límite o ya ha disparado)
    function quedaTurno() {
      if (!dl || !(dl.tiempo > 0) || fase !== 'jugador' || disparado || saltarTurno) return null;
      return Math.max(0, dl.tiempo - (t - inicioTurno));
    }
    function relojTurno() {
      const q = quedaTurno();
      if (q == null) return;
      const s = Math.ceil(q);
      if (s !== dl.seg) { if (s <= 5 && s > 0 && dl.seg !== -1) S('tic'); dl.seg = s; }
    }
    // Lo que hace el jugador local, con su tiempo desde el principio del turno (s, 2 decimales).
    // Andar y saltar sin moverse no cambian nada: pasado el tope, ya no se graban.
    function grabar(o) {
      if (!duelo || (acciones.length >= MAX_ACCIONES && o.a !== 'disparo' && o.a !== 'pasar')) return;
      acciones.push(Object.assign({ t: Math.round((t - inicioTurno) * 100) / 100 }, o));
    }
    // La jugada del rival: sus acciones, a su tiempo, por la misma cola que las del jugador local.
    // Lo que pensó (huecos largos sin hacer nada) no se repite: como mucho 1 s entre una y otra.
    function empezarRepeticion(l) {
      let antes = 0, tr = 0;
      const lista = l.map((a, k) => { tr += Math.min(a.t - antes, k ? 1 : 0.6); antes = a.t; return Object.assign({}, a, { tr }); });
      rep = { l: lista, k: 0, cola: [], t0: t, hecha: !lista.length };
    }
    function avanzarRepeticion() {
      const r = rep;
      if (r.hecha) return;
      while (r.k < r.l.length && r.l[r.k].tr <= t - r.t0) r.cola.push(r.l[r.k++]);
      while (r.cola.length) {
        const a = r.cola[0];
        if (!jug.vivo) { r.cola.length = 0; r.k = r.l.length; break; }
        if (a.a === 'arma') { arma = a.arma; r.cola.shift(); continue; }
        if (!reposado(jug)) break;
        r.cola.shift();
        if (a.a === 'andar' || a.a === 'salto') { moverJugador({ tipo: a.a, dir: a.dir }); break; }
        if (a.a === 'disparo') soltarTiro(a.ang, a.fuerza, a.arma);
        r.cola.length = 0; r.k = r.l.length; // disparo o pasar: se acabó la jugada
      }
      if (r.k >= r.l.length && !r.cola.length) r.hecha = true;
    }
    // Lo que llega de la red: se comprueba todo (puede venir cualquier cosa) y se guarda por turno.
    // Repetidos o viejos (n ya aplicado) se ignoran; los adelantados esperan su turno.
    function recibir(m, tipo) {
      if (!duelo || detenido || !dl || fase === 'fin' || !m || typeof m !== 'object') return false;
      const n = Number(m.n), i = Number(m.jugador);
      if (!Number.isInteger(n) || n < dl.n || n > dl.n + 20 || (i !== 0 && i !== 1)) return false;
      if (m.id != null && m.id !== dl.id) return false;                  // de otro mapa (otra partida)
      if (jugadores[i].local || i !== (dl.turnoDe + n - dl.n) % 2) return false; // no le toca a ese
      const caja = tipo === 'turno' ? dl.turnos : dl.jugadas;
      if (caja[n] || (tipo === 'turno' && (!m.estado || typeof m.estado !== 'object'))) return false;
      caja[n] = { acciones: limpiarAcciones(m.acciones), estado: tipo === 'turno' ? m.estado : null };
      return true;
    }
    function* finDuelo() {
      fase = 'fin';
      apunte = null; colaMov.length = 0; rep = null; dl.esperando = false;
      const vivos = [0, 1].filter((k) => heroes[k].vivo);
      const g = vivos.length === 1 ? vivos[0] : null; // los dos a la vez (o ninguno): empate
      dl.ganador = g;
      resultado = g == null ? 'empate' : 'gana' + g;
      if (g != null && (enTablet() || jugadores[g].local)) { S('victoria'); confeti(); cartel(tituloFin(g), 'bt-bien'); }
      else { if (g != null) S('derrota'); cartel(tituloFin(g), g == null ? '' : 'bt-suyo'); }
      if (!finAvisado) {
        finAvisado = true;
        llamar('alTerminar', datosFin());
      }
      yield 1.7;
      mostrarFinDuelo();
    }
    function datosFin() {
      const g = dl.ganador;
      return {
        duelo: true, ganador: g, empate: g == null, gano: g != null && jugadores[g].local, tablet: enTablet(),
        heroeGanador: g == null ? null : jugadores[g].heroe,
        motivos: heroes.map((e) => (e.vivo ? null : e.fuera ? 'agua' : 'vida')), n: dl.n - 1,
      };
    }
    // En red, desde el punto de vista local («¡Has ganado!» / «¡Gana Alex!»); en la tablet, «¡Gana Steve!»
    function tituloFin(g) {
      if (g == null) return '¡Empate!';
      return !enTablet() && jugadores[g].local ? '¡Has ganado!' : '¡Gana ' + nombreDe(g) + '!';
    }
    function motivoFin(g) {
      if (g == null) return 'Los dos a la vez.';
      const p = heroes[1 - g], tu = !enTablet() && jugadores[1 - g].local;
      if (tu) return p.fuera ? 'Te has caído al agua.' : 'Te has quedado sin vida.';
      return nombreDe(1 - g) + (p.fuera ? ' se ha caído al agua.' : ' se ha quedado sin vida.');
    }

    // ---------- monstruos
    function* turnoMonstruo(m) {
      m.dir = Math.sign(jug.x - m.x) || m.dir;
      yield 0.12;
      if (m.tipo === 'zombi') yield* turnoZombi(m);
      else if (m.tipo === 'creeper') yield* turnoCreeper(m);
      else if (m.tipo === 'esqueleto') yield* turnoEsqueleto(m);
    }
    function pegado(a, b) { return Math.abs(Math.floor(a.x) - Math.floor(b.x)) <= 1 && Math.abs(a.y - b.y) <= 1.01; }
    // (en vertical llega algo más: un creeper que ha salido de un hoyo justo debajo del héroe también estalla)
    function cerca(a, b, n) { return Math.abs(a.x - b.x) <= n + 0.01 && Math.abs(a.y - b.y) <= 3.5; }

    function* andarHacia(m, n, alejarse) {
      for (let i = 0; i < n; i++) {
        yield () => reposado(m);
        if (!m.vivo || !jug.vivo) return;
        const dx = jug.x - m.x;
        if (!alejarse && Math.abs(dx) < 1.5) return;
        let dir = Math.sign(dx) || 1;
        if (alejarse === true) dir = -dir;
        else if (typeof alejarse === 'number') dir = alejarse;
        let d = destino(m, dir, cfg.sube || 1);
        // Un árbol en medio: lo rompe a golpes (y el resto del árbol se deshace). Una pared demasiado
        // alta (p. ej. el borde de un cráter) cuando va hacia el héroe: rompe a golpes el bloque de
        // arriba; cada paso la deja un bloque más baja, así nunca se queda atrapado en un hoyo.
        const arbol = !d && arbolDelante(m, dir);
        if (!d && (arbol || !alejarse)) {
          m.dir = dir;
          m.golpeT = t;
          S('golpe');
          yield 0.35;
          if (arbol) cortarArbol(m, dir); else if (!cavar(m, dir)) return;
          yield 0.25;
          d = destino(m, dir, cfg.sube || 1);
          if (!d) continue; // aún no puede pasar: el siguiente paso sigue rompiendo
        }
        if (!d || d.peligro || d.ocupado) return;
        iniciarMov(m, d, d.s >= 2 ? 'salto' : 'andar');
        S(d.s >= 2 ? 'salto' : 'paso');
        yield () => reposado(m);
        yield 0.03;
      }
    }
    function arbolDelante(m, dir) {
      const cx = Math.floor(m.x) + dir, j = Math.round(m.y);
      for (let y = j - 3; y <= j - 1; y++) {
        if (cx < 0 || cx >= W || y < 0) continue;
        const tp = celdas[y * W + cx];
        if (tp === MADERA || tp === HOJAS) return true;
      }
      return false;
    }
    // Rompe el bloque más alto que le corta el paso en la columna de delante (siempre por encima de
    // sus pies: nunca cava hacia el agua)
    function cavar(m, dir) {
      const cx = Math.floor(m.x) + dir, j = Math.round(m.y);
      if (cx < 1 || cx >= W - 1) return false;
      for (let y = Math.max(0, j - 4); y <= j - 1; y++) {
        const tp = celdas[y * W + cx];
        if (tp === AIRE) continue;
        quitar(cx, y);
        particulasBloque(cx, y, tp);
        if (tp === MADERA || tp === HOJAS) decaerArboles();
        return true;
      }
      return false;
    }
    function cortarArbol(m, dir) {

      const cx = Math.floor(m.x) + dir, j = Math.round(m.y);
      let n = 0;
      for (let y = j - 3; y <= j - 1; y++) {
        if (cx < 0 || cx >= W || y < 0) continue;
        const tp = celdas[y * W + cx];
        if (tp === MADERA || tp === HOJAS) { quitar(cx, y); particulasBloque(cx, y, tp); n++; }
      }
      if (n) decaerArboles();
      return n;
    }
    function* turnoZombi(z) {
      yield* andarHacia(z, cfg.pasos);
      yield () => reposado(z);
      if (!z.vivo || !jug.vivo || !pegado(z, jug)) return;
      z.dir = Math.sign(jug.x - z.x) || z.dir;
      if (facil) { flotar(z.x, z.y - 2.6, '¡Grrr!', '#c8ffc0'); yield 0.5; return; } // en fácil solo andan
      z.golpeT = t;
      yield 0.22;
      if (azar() < cfg.falloZombi) {
        stats.fallosMonstruo++;
        flotar(z.x, z.y - 2.6, '¡Falló!', '#ffffff');
        S('click');
      } else {
        stats.golpesMonstruo++;
        herir(jug, 10 + Math.floor(azar() * 6), 'zombi');
        empujar(jug, z.dir * 3.5, -4.5);
      }
      yield 0.45;
    }
    function* turnoCreeper(c) {
      if (!cerca(c, jug, 2)) yield* andarHacia(c, cfg.pasos);
      yield () => reposado(c);
      if (!c.vivo || !jug.vivo || c.programado) return;
      if (cerca(c, jug, 2)) {
        c.siseo = t;
        c.programado = true;
        S('siseo');
        flotar(c.x, c.y - 2.6, '¡Sssss!', '#c8ffc0');
        yield 1.0;
        explotarCreeper(c);
        yield 0.1;
      }
    }
    function* turnoEsqueleto(s) {
      const d = Math.abs(jug.x - s.x);
      const ultimo = ents.every((e) => e === s || e.esJugador || !e.vivo);
      if (ultimo) { if (d > 10) yield* andarHacia(s, 2); } // el último no se aleja: se acerca un poco
      else if (d < 7) yield* andarHacia(s, 1 + (azar() < 0.5 ? 1 : 0), true);
      else if (d > 22) yield* andarHacia(s, 2);
      else if (azar() < 0.35) yield* andarHacia(s, 1, azar() < 0.5 ? -1 : 1);
      yield () => reposado(s);
      if (!s.vivo || !jug.vivo) return;
      s.dir = Math.sign(jug.x - s.x) || s.dir;
      if (facil) { yield 0.4; return; } // en fácil no disparan
      s.tensando = true;
      yield 0.6;
      s.tensando = false;
      if (!s.vivo || !jug.vivo) return;
      const tiro = mejorTiro(s);
      const ang = tiro.ang + (azar() * 2 - 1) * cfg.errAng;
      const v = clamp(tiro.v * (1 + (azar() * 2 - 1) * cfg.errFuerza), 5, VMAX.flecha * 1.1);
      lanzarFlecha(s, ang, v);
      S('flecha');
      yield () => !proys.some((p) => p.tipo === 'flecha');
      yield 0.25;
    }

    // ---------- efectos
    function particula(o) {
      if (particulas.length > 450) particulas.splice(0, 50);
      particulas.push(Object.assign({ tipo: 'cuadro', x: 0, y: 0, vx: 0, vy: 0, t0: t, vida: 1, tam: 0.2, color: '#fff', g: 1 }, o));
    }
    function particulasBloque(i, j, tp) {
      const base = COLOR_BLOQUE[tp] || '#888';
      for (let k = 0; k < 2; k++) {
        particula({ x: i + Math.random(), y: j + Math.random(), vx: (Math.random() - 0.5) * 9, vy: -3 - Math.random() * 7, vida: 0.6 + Math.random() * 0.5, tam: 0.18 + Math.random() * 0.16, color: k ? base : sombrear(base) });
      }
    }
    function sombrear(c) {
      const n = parseInt(c.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgb(' + Math.round(r * 0.7) + ',' + Math.round(g * 0.7) + ',' + Math.round(b * 0.7) + ')';
    }
    function humo(x, y, n) {
      for (let k = 0; k < n; k++) {
        particula({ tipo: 'humo', x: x + (Math.random() - 0.5) * 1.4, y: y + (Math.random() - 0.5) * 1.4, vx: (Math.random() - 0.5) * 1.5, vy: -0.6 - Math.random() * 1.2, vida: 0.8 + Math.random() * 0.6, tam: 0.9 + Math.random() * 0.6, g: -0.02 });
      }
    }
    function chapuzon(x, y) {
      for (let k = 0; k < 14; k++) {
        particula({ x: x + (Math.random() - 0.5), y, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 6, vida: 0.6 + Math.random() * 0.4, tam: 0.15 + Math.random() * 0.15, color: k % 2 ? '#bfe3ff' : '#5aa0ff' });
      }
    }
    function soltarOrbes(e) {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        orbes.push({ x: e.x, y: Math.min(e.y, AGUA) - 1, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 4, t0: t, fase: Math.random() * 6, muerto: false });
      }
    }
    function confeti() {
      const colores = ['#ff4d4d', '#ffd84d', '#4dd2ff', '#7cff4d', '#ff7af0', '#ffffff'];
      for (let k = 0; k < 90; k++) {
        particula({ x: Math.random() * W, y: -1 - Math.random() * 3, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, t0: t + Math.random() * 1.2, vida: 2.5 + Math.random(), tam: 0.25 + Math.random() * 0.2, color: colores[k % colores.length], g: 0.12 });
      }
      for (let b = 0; b < 3; b++) {
        const cx = 10 + Math.random() * (W - 20), cy = 4 + Math.random() * 5;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2, v = 5 + Math.random() * 3;
          particula({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t + b * 0.4, vida: 0.9 + Math.random() * 0.4, tam: 0.25, color: colores[(k + b) % colores.length], g: 0.3 });
        }
      }
    }
    function flotar(x, y, txt, color, grande) {
      // Si ya hay otro texto reciente en el mismo sitio, se apila encima (que no se pisen)
      const cerca = textos.filter((o) => t - o.t0 < 0.5 && Math.abs(o.x - x) < 1.6 && Math.abs(o.y - y) < 1.2).length;
      textos.push({ x, y: y - cerca * 1.0 - (kPers - 1) * 2, txt, color, t0: t, grande: !!grande });
    }
    function actualizarParticulas() {
      let quitarAlguna = false;
      for (const p of particulas) {
        if (t < p.t0) continue;
        p.vy += G * p.g * DT;
        p.x += p.vx * DT; p.y += p.vy * DT;
        if (t - p.t0 > p.vida) { p.muerta = true; quitarAlguna = true; }
      }
      if (quitarAlguna) particulas = particulas.filter((p) => !p.muerta);
    }
    function actualizarOrbes() {
      for (const o of orbes) {
        const edad = t - o.t0;
        if (edad < 0.75 || !jug.vivo) {
          o.vy += G * 0.5 * DT;
          o.x += o.vx * DT; o.y += o.vy * DT;
          if (solido(Math.floor(o.x), Math.floor(o.y))) { o.y -= o.vy * DT; o.vy *= -0.4; o.vx *= 0.6; }
          if (o.y > AGUA) o.vy = Math.min(o.vy, 0) - 0.5;
        } else {
          const dx = jug.x - o.x, dy = jug.y - 1 - o.y, d = Math.hypot(dx, dy) || 1;
          const v = Math.min(26, 5 + (edad - 0.75) * 22);
          o.x += (dx / d) * v * DT; o.y += (dy / d) * v * DT;
          if (d < 0.45) { o.muerto = true; S('orbe'); }
        }
        if (edad > 6) o.muerto = true;
      }
      if (orbes.some((o) => o.muerto)) orbes = orbes.filter((o) => !o.muerto);
    }

    // ---------- un paso de simulación
    function avanzarCo() {
      if (!co) return;
      if (espera !== null) {
        if (typeof espera === 'number') { if (t < espera) return; }
        else {
          let ok = true;
          try { ok = espera(); } catch (err) { anotarError(err); }
          if (!ok) return;
        }
        espera = null;
      }
      for (let i = 0; i < 200; i++) {
        let r;
        try { r = co.next(); } catch (err) {
          anotarError(err);
          espera = null;
          co = fase === 'fin' || errores.length > 40 ? null : duelo ? partidaDuelo(true) : partida(true); // se recupera desde el turno del jugador
          return;
        }
        if (r.done) { co = null; return; }
        const v = r.value;
        if (v == null) return;
        if (typeof v === 'number') { if (v <= 0) continue; espera = t + v; return; }
        if (typeof v === 'function') {
          let ok = true;
          try { ok = v(); } catch (err) { anotarError(err); }
          if (ok) continue;
          espera = v;
          return;
        }
        return;
      }
    }
    function pasoSim() {
      t += DT;
      avanzarCo();
      if (fase === 'jugador' && !disparado && !saltarTurno && colaMov.length && !apunte && reposado(jug)) {
        const o = colaMov.shift();
        // 1 contra 1: se graba con la dirección ya resuelta (saltar sin dirección usa hacia dónde mira)
        if (duelo) grabar({ a: o.tipo === 'salto' ? 'salto' : 'andar', dir: o.dir || jug.dir });
        moverJugador(o);
      }
      if (rep && fase === 'remoto') avanzarRepeticion();
      if (duelo) relojTurno();
      for (const e of ents) actualizarEntidad(e);
      for (const p of proys) if (!p.muerto) actualizarProyectil(p);
      if (proys.some((p) => p.muerto)) proys = proys.filter((p) => !p.muerto);
      for (let i = pendientes.length - 1; i >= 0; i--) {
        if (i < pendientes.length && t >= pendientes[i].at) {
          const p = pendientes.splice(i, 1)[0];
          try { p.fn(); } catch (err) { anotarError(err); }
        }
      }
      actualizarOrbes();
      actualizarParticulas();
      if (textos.length) textos = textos.filter((x) => t - x.t0 < 1.3);
      if (destellos.length) destellos = destellos.filter((d) => t - d.t0 < 0.4);
      if (clavadas.length) clavadas = clavadas.filter((c) => t - c.t0 < 2.5);
      if (temblor > 0) temblor = Math.max(0, temblor - DT * 1.4);
    }
    function pasoSeguro() {
      try { pasoSim(); } catch (err) { anotarError(err); }
    }

    // ---------- medidas y capas
    function medir() {
      const r = raiz.getBoundingClientRect();
      cw = Math.max(1, r.width); ch = Math.max(1, r.height);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      // Controles debajo del mundo o a los lados: se elige lo que deja el mundo más grande.
      // Encima del mundo (tapando el terreno) solo si no queda otra (pantallas muy raras).
      const opcionesModo = [
        { m: 'abajo', bs: Math.min(cw / W, (ch - 100) / H) },
        { m: 'lados', bs: Math.min(ch / H, (cw - 2 * 76) / W) },
      ];
      opcionesModo.sort((a, b) => b.bs - a.bs);
      if (opcionesModo[0].bs < 5) opcionesModo.unshift({ m: 'encima', bs: Math.min(cw / W, ch / H) * 0.86 });
      modo = opcionesModo[0].m;
      const bsCss = modo === 'encima' ? Math.min(cw / W, ch / H) : opcionesModo[0].bs;
      bsD = Math.max(3, Math.floor(bsCss * dpr));
      kPers = bsD / dpr < 10 ? 1.5 : 1;
      lienzo.width = Math.max(1, Math.round(cw * dpr));
      lienzo.height = Math.max(1, Math.round(ch * dpr));
      ox = Math.round((lienzo.width - W * bsD) / 2);
      oy = modo === 'abajo' ? 0 : Math.round((lienzo.height - H * bsD) / 2);
      capaTerreno.width = W * bsD;
      capaTerreno.height = H * bsD;
      ctxT = capaTerreno.getContext('2d');
      texturas = {};
      capasAgua = [];
      todoSucio = true;
      raiz.classList.remove('bt-abajo', 'bt-lados', 'bt-encima');
      raiz.classList.add('bt-' + modo);
      colocarControles();
      pintarFondo();
      pintarIconos();
      claveControles = '';
    }
    function colocarControles() {
      const mundoTop = oy / dpr, mundoAl = (H * bsD) / dpr, mundoIzq = ox / dpr;
      const ms = $mov.style, as = $armas.style, ps = $pista.style;
      [ms, as, ps].forEach((s) => { s.left = s.right = s.top = s.bottom = s.width = s.transform = ''; });
      ps.transform = 'translateX(-50%)';
      ps.left = '50%';
      girarVisible = false;
      zonaDemo = null;
      hudPanel = null;
      $cartel.style.top = (mundoTop + mundoAl * 0.3) + 'px';
      $cartel.style.maxWidth = '';
      $aviso.style.top = (mundoTop + mundoAl * 0.45) + 'px';
      let bot = 64;
      if (modo === 'abajo') {
        const panTop = mundoTop + mundoAl, panAl = ch - panTop;
        const estrecho = cw < 600;
        if (!estrecho) {
          bot = clamp(Math.floor(panAl - 34), 52, 76);
          ms.left = '14px';
          ms.bottom = Math.max(6, (panAl - bot - 24) / 2) + 'px';
          as.right = '14px';
          as.bottom = Math.max(6, (panAl - bot) / 2 + 2) + 'px';
          ps.top = (mundoTop + mundoAl * 0.17) + 'px';
        } else {
          bot = clamp(Math.floor((panAl - 90) / 2.4), 52, 76);
          ms.left = '0px'; ms.right = '0px';
          ms.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
          as.left = '0px'; as.right = '0px';
          as.bottom = 'calc(' + (16 + bot + 46) + 'px + env(safe-area-inset-bottom, 0px))';
          // En el panel, de arriba abajo: marcador (vida, nivel, viento), pista, cartel de turno y,
          // en el hueco que queda, la mano de ayuda (así el dedo no tapa el mundo)
          hudPanel = { x: 16, y: panTop + 10 };
          ps.top = (panTop + 62) + 'px';
          $cartel.style.top = (panTop + 96) + 'px';
          $cartel.style.maxWidth = 'calc(100% - 24px)';
          $aviso.style.top = (panTop + 190) + 'px'; // (en el panel: el mundo se ve pequeño)
          const armasTop = ch - (16 + bot + 46 + bot), sitio = armasTop - (panTop + 130);
          if (sitio >= 150) zonaDemo = { x: cw / 2 + 50, y: panTop + 140 + (sitio - 150) / 2 };
          // Móvil en vertical: el mundo se ve pequeño; si sobra sitio, se sugiere girarlo
          const libre = panAl - (16 + bot + 46 + bot) - 110;
          if (libre > 140 && ch > cw) {
            girarVisible = true;
            $girar.style.top = (panTop + 130 + Math.min(60, (libre - 70) / 2)) + 'px';
          }
        }
      } else if (modo === 'lados') {
        bot = clamp(Math.floor(Math.min(mundoIzq - 12, (ch - 60) / 3.6)), 44, 72);
        raiz.style.setProperty('--lado', mundoIzq + 'px');
        ms.left = '0px'; ms.width = mundoIzq + 'px'; ms.transform = 'translateY(-50%)';
        // Centrado en lo que queda debajo del botón de la app (si lo hay)
        ms.top = hueco.alto && hueco.ancho > 0 ? (hueco.alto + (ch - hueco.alto) / 2) + 'px' : '50%';
        as.right = '0px'; as.width = mundoIzq + 'px'; as.top = '50%'; as.transform = 'translateY(-50%)';
        ps.top = (mundoTop + mundoAl * 0.17) + 'px';
      } else {
        bot = clamp(Math.floor(Math.min(cw, ch) / 7), 46, 64);
        ms.left = '10px'; ms.bottom = '10px';
        as.right = '10px'; as.bottom = '10px';
        ps.top = (mundoTop + mundoAl * 0.17) + 'px';
      }
      raiz.style.setProperty('--bot', bot + 'px');
    }
    function pintarFondo() {
      if (!lienzo.width) return;
      capaFondo.width = capaJunta.width = lienzo.width;
      capaFondo.height = capaJunta.height = lienzo.height;
      todoSucio = true; // la capa junta se rehace entera
      const g = capaFondo.getContext('2d');
      const yAgua = oy + AGUA * bsD, yFin = oy + H * bsD;
      const cielo = g.createLinearGradient(0, oy, 0, yAgua);
      cielo.addColorStop(0, '#6db8ff');
      cielo.addColorStop(1, '#c4ebff');
      g.fillStyle = cielo;
      g.fillRect(0, 0, capaFondo.width, yAgua);
      g.fillStyle = '#2a5cc0';
      g.fillRect(0, yAgua, capaFondo.width, capaFondo.height - yAgua);
      // Nubes pixeladas (siempre las mismas para este nivel)
      const az = crearAzar((semillaNubes != null ? semillaNubes : semilla || 1) + 99);
      g.fillStyle = 'rgba(255,255,255,.85)';
      const nubes = 5;
      for (let k = 0; k < nubes; k++) {
        const cx = ox + az.entre(-2, W) * bsD, cy = oy + az.entre(1, 8) * bsD;
        const an = Math.round(az.entre(3, 6)) * bsD;
        g.fillRect(Math.round(cx), Math.round(cy), an, bsD);
        g.fillRect(Math.round(cx + bsD), Math.round(cy - bsD * 0.6), an - 2 * bsD, Math.round(bsD * 0.6));
      }
      if (modo === 'abajo') {
        // Panel de controles bajo el mundo
        const top = yFin;
        const p = g.createLinearGradient(0, top, 0, capaFondo.height);
        p.addColorStop(0, '#3a2b1d');
        p.addColorStop(1, '#22180f');
        g.fillStyle = p;
        g.fillRect(0, top, capaFondo.width, capaFondo.height - top);
        g.fillStyle = '#1a120b';
        g.fillRect(0, top, capaFondo.width, Math.max(2, Math.round(3 * dpr)));
      }
    }
    function sprites() {
      const s = window.Sprites;
      return s && typeof s.dibujar === 'function' && typeof s.tam === 'function' ? s : null;
    }
    function haySprite(nombre) {
      const s = sprites();
      if (!s || rotos.has(nombre)) return null;
      if (Array.isArray(s.nombres) && !s.nombres.includes(nombre)) return null;
      return s;
    }
    function framesDe(nombre) {
      const s = haySprite(nombre);
      if (!s) return 0;
      try { return typeof s.frames === 'function' ? s.frames(nombre) : 4; } catch (e) { return 1; }
    }
    // Dibuja un sprite con su base centrada en (cx, pie) y una altura en píxeles. false si no hay sprite.
    function spritePorAlto(nombre, cx, pie, altoPx, op) {
      const s = haySprite(nombre);
      if (!s) return false;
      try {
        const tm = s.tam(nombre);
        if (!tm || !tm.h) return false;
        const esc = altoPx / tm.h;
        s.dibujar(ctx, nombre, cx - (tm.w * esc) / 2, pie - altoPx, esc, op || {});
        return true;
      } catch (e) { rotos.add(nombre); return false; }
    }
    // Dibuja un sprite centrado en (cx, cy) con un ancho en píxeles
    function spritePorAncho(nombre, cx, cy, anchoPx, op, c) {
      const s = haySprite(nombre);
      if (!s) return false;
      try {
        const tm = s.tam(nombre);
        if (!tm || !tm.w) return false;
        const esc = anchoPx / tm.w;
        s.dibujar(c || ctx, nombre, cx - anchoPx / 2, cy - (tm.h * esc) / 2, esc, op || {});
        return true;
      } catch (e) { rotos.add(nombre); return false; }
    }
    function textura(tp) {
      const nombre = NOMBRE_BLOQUE[tp];
      if (texturas[nombre]) return texturas[nombre];
      let c = null;
      const s = sprites();
      if (s && typeof s.textura === 'function') {
        try {
          const v = s.textura(nombre, bsD);
          if (v && v.width) c = v;
        } catch (e) { c = null; }
      }
      if (!c) c = texturaFalsa(nombre, bsD);
      texturas[nombre] = c;
      return c;
    }
    // Fondo de las cuevas: piedra muy oscura (como en Minecraft), no el cielo
    function texturaCueva() {
      if (texturas.cueva) return texturas.cueva;
      const c = document.createElement('canvas');
      c.width = c.height = bsD;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(textura(PIEDRA), 0, 0);
      g.fillStyle = 'rgba(12,10,16,.62)';
      g.fillRect(0, 0, bsD, bsD);
      texturas.cueva = c;
      return c;
    }
    // Grietas: arte propio de píxeles, dibujado a mano como trazos [etapa, x0, y0, x1, y1, ...] en una
    // rejilla de 16×16 (bloques grandes, iPad) o de 8×8 (bloques pequeños, móvil: con la de 16 las
    // líneas quedan de medio píxel y no se ven). Cada etapa añade trazos a la anterior: la grieta nace
    // en el centro y crece hasta los bordes. Va encima de la textura del bloque, en la capa del terreno.
    const GRIETA_16 = [
      [1, 8, 8, 7, 6, 7, 5], [1, 8, 8, 10, 9], [1, 8, 8, 6, 9],
      [2, 7, 5, 5, 3, 5, 2], [2, 10, 9, 12, 9, 13, 7], [2, 6, 9, 4, 10, 3, 12], [2, 8, 8, 9, 11, 9, 12],
      [3, 5, 2, 4, 0], [3, 13, 7, 15, 6], [3, 3, 12, 1, 13, 0, 15], [3, 9, 12, 10, 14, 10, 15],
      [3, 12, 9, 14, 11, 15, 12], [3, 5, 3, 2, 3, 1, 1], [3, 7, 6, 9, 4, 11, 3, 12, 1], [3, 7, 7, 8, 7], [3, 7, 8, 8, 8],
    ];
    const GRIETA_8 = [
      [1, 4, 4, 3, 3], [1, 4, 4, 5, 4],
      [2, 3, 3, 3, 1], [2, 5, 4, 6, 5], [2, 4, 4, 3, 6],
      [3, 3, 1, 2, 0], [3, 6, 5, 7, 6], [3, 3, 6, 2, 7], [3, 5, 4, 7, 3], [3, 3, 3, 1, 3, 0, 2], [3, 3, 4, 4, 3],
    ];
    // variante: 0-3, el dibujo volteado en horizontal (bit 1) y en vertical (bit 2), para que los
    // bloques vecinos no tengan todos la misma grieta
    function texturaGrieta(etapa, variante) {
      const clave = 'grieta' + etapa + '-' + variante;
      if (texturas[clave]) return texturas[clave];
      const N = bsD / dpr >= 18 ? 16 : 8, trazos = N === 16 ? GRIETA_16 : GRIETA_8;
      const m = new Uint8Array(N * N); // 2 = grieta, 1 = sombra alrededor (se lee sobre cualquier bloque)
      const pon = (x, y) => {
        if (variante & 1) x = N - 1 - x;
        if (variante & 2) y = N - 1 - y;
        if (x >= 0 && y >= 0 && x < N && y < N) m[y * N + x] = 2;
      };
      for (const tr of trazos) {
        if (tr[0] > etapa) continue;
        for (let k = 1; k + 3 < tr.length; k += 2) {
          const x0 = tr[k], y0 = tr[k + 1], x1 = tr[k + 2], y1 = tr[k + 3];
          const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let s = 0; s <= n; s++) pon(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n));
        }
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (m[y * N + x] !== 2) continue;
          if (x > 0 && !m[y * N + x - 1]) m[y * N + x - 1] = 1;
          if (x < N - 1 && !m[y * N + x + 1]) m[y * N + x + 1] = 1;
          if (y > 0 && !m[(y - 1) * N + x]) m[(y - 1) * N + x] = 1;
          if (y < N - 1 && !m[(y + 1) * N + x]) m[(y + 1) * N + x] = 1;
        }
      }
      const c = document.createElement('canvas');
      c.width = c.height = bsD;
      const g = c.getContext('2d');
      // El bloque, además, algo más oscuro cuanto más roto (se lee aunque el bloque sea diminuto)
      if (etapa >= 2) { g.fillStyle = etapa === 2 ? 'rgba(24,16,10,.07)' : 'rgba(24,16,10,.16)'; g.fillRect(0, 0, bsD, bsD); }
      const borde = (k) => Math.round((k * bsD) / N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = m[y * N + x];
          if (!v) continue;
          g.fillStyle = v === 2 ? 'rgba(24,16,10,.88)' : 'rgba(24,16,10,.3)';
          g.fillRect(borde(x), borde(y), borde(x + 1) - borde(x), borde(y + 1) - borde(y));
        }
      }
      texturas[clave] = c;
      return c;
    }
    const varianteGrieta = (i) => ((i * 2654435761) >>> 0) >>> 30;
    function grietaCelda(i) { return celdas[i] && dano[i] >= 0.1 ? texturaGrieta(etapaGrieta(dano[i]), varianteGrieta(i)) : null; }
    function texturaCelda(i) { return celdas[i] ? textura(celdas[i]) : cueva[i] ? texturaCueva() : null; }
    function pintarCelda(i) {
      const tex = texturaCelda(i), gr = tex && grietaCelda(i);
      const x = (i % W) * bsD, y = ((i / W) | 0) * bsD;
      if (tex) ctxT.drawImage(tex, x, y);
      if (gr) ctxT.drawImage(gr, x, y);
    }
    function texturaFalsa(nombre, tam) {
      const c = document.createElement('canvas');
      c.width = c.height = tam;
      const g = c.getContext('2d');
      const base = { hierba: '#8b5a2b', tierra: '#8b5a2b', piedra: '#8c8c8c', arena: '#e3d48f', madera: '#6e4b26', hojas: '#3e8a2a' }[nombre] || '#888';
      g.fillStyle = base;
      g.fillRect(0, 0, tam, tam);
      const p = tam / 8;
      let sd = nombre.length * 9301 + 49297;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          sd = (sd * 1103515245 + 12345) & 0x7fffffff;
          const r = sd % 7;
          if (r < 2) {
            g.fillStyle = r === 0 ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.15)';
            g.fillRect(Math.floor(x * p), Math.floor(y * p), Math.ceil(p), Math.ceil(p));
          }
        }
      }
      if (nombre === 'hierba') {
        g.fillStyle = '#5da83a';
        g.fillRect(0, 0, tam, Math.ceil(p * 2));
        for (let x = 0; x < 8; x += 2) g.fillRect(Math.floor(x * p), Math.floor(2 * p), Math.ceil(p), Math.ceil(p));
      }
      if (nombre === 'madera') {
        g.fillStyle = 'rgba(0,0,0,.25)';
        for (let x = 1; x < 8; x += 3) g.fillRect(Math.floor(x * p), 0, Math.ceil(p), tam);
      }
      return c;
    }
    function pintarTerreno() {
      const gJ = capaJunta.getContext('2d');
      gJ.imageSmoothingEnabled = false;
      if (todoSucio) {
        ctxT.clearRect(0, 0, capaTerreno.width, capaTerreno.height);
        for (let i = 0; i < W * H; i++) pintarCelda(i);
        gJ.drawImage(capaFondo, 0, 0);
        gJ.drawImage(capaTerreno, ox, oy);
        sucias.length = 0;
        todoSucio = false;
        return;
      }
      if (!sucias.length) return;
      // Cada bloque que cambia se pinta en las dos capas desde las texturas (sin leer el lienzo del
      // terreno justo después de escribir en él: eso daba un tirón de decenas de ms en cada explosión)
      // (las grietas también: un bloque que cambia de etapa se marca como sucio, solo ese)
      for (const i of sucias) {
        const x = (i % W) * bsD, y = ((i / W) | 0) * bsD;
        const tex = texturaCelda(i), gr = tex && grietaCelda(i);
        ctxT.clearRect(x, y, bsD, bsD);
        if (tex) ctxT.drawImage(tex, x, y);
        if (gr) ctxT.drawImage(gr, x, y);
        // En la capa junta: el trozo de cielo y, encima, lo que quede del bloque
        gJ.drawImage(capaFondo, ox + x, oy + y, bsD, bsD, ox + x, oy + y, bsD, bsD);
        if (tex) gJ.drawImage(tex, ox + x, oy + y);
        if (gr) gJ.drawImage(gr, ox + x, oy + y);
      }
      sucias.length = 0;
    }
    function pintarIconos() {
      $botArmas.forEach((b) => {
        const c = b.querySelector('canvas');
        const g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        g.imageSmoothingEnabled = false;
        const nombre = b.dataset.arma === 'tnt' ? 'tnt' : 'bazooka';
        if (!spritePorAncho(nombre, 16, 16, nombre === 'tnt' ? 24 : 30, {}, g)) {
          if (nombre === 'tnt') {
            g.fillStyle = '#d33'; g.fillRect(5, 5, 22, 22);
            g.fillStyle = '#fff'; g.fillRect(5, 12, 22, 8);
            g.fillStyle = '#000'; g.font = 'bold 7px monospace'; g.textAlign = 'center'; g.fillText('TNT', 16, 19);
          } else {
            g.fillStyle = '#3d4a3a'; g.fillRect(2, 12, 26, 8);
            g.fillStyle = '#222'; g.fillRect(24, 10, 6, 12); g.fillRect(10, 20, 4, 6);
          }
        }
      });
      iconosPintados = !!sprites();
      $mudo.innerHTML = silenciado() ? SVG_MUDO : SVG_SONIDO;
      $mudo.setAttribute('aria-label', silenciado() ? 'Poner el sonido' : 'Quitar el sonido');
    }
    function silenciado() {
      try { return !!(window.Sfx && typeof window.Sfx.silenciado === 'function' && window.Sfx.silenciado()); } catch (e) { return false; }
    }

    // ---------- controles (DOM)
    function actualizarControles() {
      const turno = fase === 'jugador' && !disparado && !saltarTurno && jug && jug.vivo && !pausado;
      const pista = demoVisible();
      const clave = [turno, pasos, arma, pista, girarVisible, !!avisoTexto].join('|');
      if (clave === claveControles) return;
      claveControles = clave;
      $girar.hidden = !girarVisible || pista || !!avisoTexto; // la mano de ayuda (o un aviso de la app) va en ese mismo hueco
      $izq.disabled = $der.disabled = $salto.disabled = !turno || pasos <= 0;
      $botArmas.forEach((b) => {
        b.disabled = !turno;
        b.classList.toggle('bt-elegida', b.dataset.arma === arma);
        b.setAttribute('aria-pressed', b.dataset.arma === arma ? 'true' : 'false');
      });
      let dots = '';
      for (let i = 0; i < PASOS_TURNO; i++) dots += i < pasos ? '<i></i>' : '<i class="bt-gastado"></i>';
      $pasos.innerHTML = '<span>Pasos</span> <span class="bt-puntos">' + dots + '</span>';
      $pista.hidden = !pista;
    }
    function cartel(txt, clase) {
      // Con un aviso con Salir encima del mundo («Alex se ha ido»), ningún cartel lo pisa
      if (avisoSalir && $fin.hidden) return;
      $cartel.textContent = txt;
      $cartel.className = 'bt-cartel';
      void $cartel.offsetWidth; // reinicia la animación
      $cartel.className = 'bt-cartel bt-ver' + (clase ? ' ' + clase : '');
    }
    function mostrarFin(gano) {
      $finT.textContent = gano ? '¡Nivel superado!' : '¡Uy! Vuelve a intentarlo';
      $finP.textContent = gano
        ? 'Has ganado el nivel ' + nivel + '.'
        : jug.fuera ? 'Te has caído al agua.' : 'Los monstruos han ganado esta vez.';
      let info = null;
      if (typeof opciones.infoFin === 'function') {
        try { info = opciones.infoFin({ gano, nivel }) || null; } catch (err) { anotarError(err); }
      }
      $finInfo.textContent = info && info.texto ? String(info.texto) : '';
      $finInfo.hidden = !$finInfo.textContent;
      const seguir = !info || info.seguir !== false;
      $finB.innerHTML = '';
      if (gano && seguir) botonFin('Siguiente nivel', 'siguiente');
      if (seguir) botonFin('Otra vez', 'otra', gano);
      botonFin('Salir', 'salir', true);
      $fin.hidden = false;
      pintarAviso();
    }
    function botonFin(txt, accion, sec) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.dataset.accion = accion;
      if (sec) b.className = 'bt-sec';
      b.addEventListener('click', () => elegir(accion, b));
      $finB.appendChild(b);
      return b;
    }
    // 1 contra 1: «Revancha» y «Salir». infoFin(datos) puede poner una línea más; con seguir === false,
    // «Revancha 🔒» (se ve, pero no se puede tocar)
    function mostrarFinDuelo() {
      const g = dl.ganador;
      $finT.textContent = tituloFin(g);
      $finP.textContent = motivoFin(g);
      let info = null;
      if (typeof opciones.infoFin === 'function') {
        try { info = opciones.infoFin(datosFin()) || null; } catch (err) { anotarError(err); }
      }
      $finInfo.textContent = info && info.texto ? String(info.texto) : '';
      $finInfo.hidden = !$finInfo.textContent;
      const seguir = !info || info.seguir !== false;
      $finB.innerHTML = '';
      botonFin(seguir ? 'Revancha' : 'Revancha 🔒', 'otra').disabled = !seguir;
      botonFin('Salir', 'salir', true);
      $fin.hidden = false;
      pintarAviso();
    }
    function elegir(accion, boton) {
      S('click');
      if (duelo) {
        // Un toque = una revancha (los niños tocan cinco veces): el botón se apaga hasta el duelo nuevo
        if (accion === 'otra' && boton) boton.disabled = true;
        const g = dl.ganador;
        if (llamar('alElegir', { accion, duelo: true, ganador: g, gano: g != null && jugadores[g].local })) return;
        if (accion === 'salir') detener();
        else nuevoDuelo({});
        return;
      }
      const siguiente = accion === 'siguiente' ? nivel + 1 : nivel;
      if (typeof opciones.alElegir === 'function') {
        try { opciones.alElegir({ accion, nivel, siguiente, gano: resultado === 'gano' }); } catch (err) { anotarError(err); }
        return;
      }
      if (accion === 'salir') { detener(); return; }
      nuevaPartida(siguiente);
    }
    function elegirArma(a) {
      if (a !== 'bazooka' && a !== 'tnt') return false;
      if (fase === 'fin') return false;
      if (duelo) {
        // En el 1 contra 1, solo en tu turno (el arma es de cada uno), y se graba: el otro la ve en la mano
        if (fase !== 'jugador' || disparado || saltarTurno) return false;
        if (a !== arma) grabar({ a: 'arma', arma: a });
      }
      arma = a;
      S('click');
      return true;
    }
    function activarSonido() {
      try { if (window.Sfx && window.Sfx.activar) window.Sfx.activar(); } catch (e) { /* nada */ }
    }
    function pulsarMovimiento(tipo, dir) {
      activarSonido();
      if (!(fase === 'jugador' && !disparado && !saltarTurno) || pausado) return;
      if (colaMov.length < 2) colaMov.push({ tipo, dir });
    }
    let repetidor = 0, retardo = 0, teclaRepite = null; // (teclaRepite: la tecla que anda sola, si la hay)
    function pararRepeticion() { clearTimeout(retardo); clearInterval(repetidor); retardo = repetidor = 0; teclaRepite = null; }
    // Mantener pulsado = seguir andando: al rato, otro paso cada vez que se acaba el anterior.
    // vale() (la del teclado): en cuanto deja de valer, se para
    function andarSeguido(dir, vale) {
      retardo = setTimeout(() => {
        repetidor = setInterval(() => {
          if (vale && !vale()) pararRepeticion();
          else if (colaMov.length === 0) pulsarMovimiento('andar', dir);
        }, 90);
      }, 380);
    }
    function botonMovimiento(boton, tipo, dir) {
      boton.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (boton.disabled) return;
        pulsarMovimiento(tipo, dir);
        pararRepeticion();
        if (tipo === 'andar') andarSeguido(dir);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => boton.addEventListener(n, pararRepeticion));
    }
    botonMovimiento($izq, 'andar', -1);
    botonMovimiento($der, 'andar', 1);
    botonMovimiento($salto, 'salto', 0);
    $botArmas.forEach((b) => b.addEventListener('click', () => { activarSonido(); elegirArma(b.dataset.arma); }));
    $avisoB.addEventListener('click', () => { activarSonido(); elegir('salir'); });
    $mudo.addEventListener('click', () => {
      activarSonido();
      try { if (window.Sfx && window.Sfx.silencio) window.Sfx.silencio(!silenciado()); } catch (e) { /* nada */ }
      pintarIconos();
    });

    // Apuntar tipo tirachinas: dedo en cualquier sitio, arrastrar hacia atrás, soltar
    function largoMax() { return clamp(Math.min(cw, ch) * 0.38, 110, 260); }
    function vectorApunte() {
      if (!apunte) return null;
      const px = apunte.x0 - apunte.x, py = apunte.y0 - apunte.y;
      const len = Math.hypot(px, py), max = largoMax();
      return { ang: (Math.atan2(-py, px) * 180) / Math.PI, fuerza: Math.min(1, len / max), len, valido: len >= Math.max(18, max * 0.12) };
    }
    function posLienzo(ev) {
      const r = lienzo.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    lienzo.addEventListener('pointerdown', (ev) => {
      activarSonido();
      if (fase === 'monstruos' && !pausado) prisa = true; // tocar mientras juegan los monstruos: van más deprisa
      if (apunte || !puedeApuntar()) return;
      ev.preventDefault();
      const p = posLienzo(ev);
      apunte = { id: ev.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
      ayuda = false; // ya está intentándolo: fuera la mano
      try { lienzo.setPointerCapture(ev.pointerId); } catch (e) { /* nada */ }
    });
    lienzo.addEventListener('pointermove', (ev) => {
      if (!apunte || ev.pointerId !== apunte.id) return;
      const p = posLienzo(ev);
      apunte.x = p.x; apunte.y = p.y;
      const v = vectorApunte();
      if (v && v.valido) jug.dir = Math.cos(rad(v.ang)) >= 0 ? 1 : -1;
    });
    lienzo.addEventListener('pointerup', (ev) => {
      if (!apunte || ev.pointerId !== apunte.id) return;
      const p = posLienzo(ev);
      apunte.x = p.x; apunte.y = p.y;
      const v = vectorApunte();
      apunte = null;
      if (v && v.valido && puedeApuntar()) disparar(v.ang, v.fuerza);
      else if (puedeApuntar()) {
        // Un toque sin arrastrar: no dispara, pero se le enseña cómo (la mano) y suena algo.
        // Fuera el cartel "¡Tu turno!" (en el móvil en vertical iría justo encima de la pista)
        ayuda = true;
        ayudaT0 = t;
        $cartel.classList.remove('bt-ver');
        S('click');
      }
    });
    lienzo.addEventListener('pointercancel', (ev) => { if (apunte && ev.pointerId === apunte.id) apunte = null; });
    lienzo.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // ---------- teclado (ordenador): ←/→ o A/D andan (mantener = seguir andando, como el botón), ↑ o W
    // salta y 1/2 eligen arma. Apuntar, con el dedo o el ratón. A/D/W valen por la letra (ev.key; con
    // Bloq Mayús, en mayúscula) y por el sitio (ev.code: donde están en un QWERTY, para teclados con
    // otras letras ahí, como el francés). Si no coinciden, manda la letra.
    function ordenTecla(ev) {
      const k = typeof ev.key === 'string' && ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (k === 'ArrowLeft' || k === 'a') return 'izq';
      if (k === 'ArrowRight' || k === 'd') return 'der';
      if (k === 'ArrowUp' || k === 'w') return 'salto';
      if (k === '1' || k === '2') return k;
      const c = ev.code;
      return c === 'KeyA' ? 'izq' : c === 'KeyD' ? 'der' : c === 'KeyW' ? 'salto' : null;
    }
    // La tecla, para reconocerla al soltarla (la misma aunque cambie Mayús entre medias)
    const idTecla = (ev) => ev.code || String(ev.key || '').toLowerCase();
    const esCampo = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    // ¿Las teclas son del juego? No con la Batalla parada o escondida, escribiendo en un campo de texto
    // ni con un diálogo de la app encima («¿Salir de la partida?», Para padres...: en red no hay pausa)
    function teclasDelJuego(ev) {
      if (detenido || !raiz.isConnected || raiz.offsetParent === null) return false;
      if (esCampo(ev && ev.target) || esCampo(document.activeElement)) return false;
      for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        if (!raiz.contains(d) && d.getClientRects().length) return false;
      }
      return true;
    }
    // Solo en un turno de jugar aquí (en la tablet, el de cualquiera de los dos) y sin pausa: nada en el
    // del rival en red, en el de los monstruos ni con el tiro en el aire
    const turnoTeclas = () => fase === 'jugador' && !disparado && !saltarTurno && !pausado && !!jug && jug.vivo;
    // Andando sola con la tecla apretada: se para al acabarse el turno o los pasos, con un diálogo encima...
    // (y no vuelve sola: en la tablet, el turno siguiente es del otro niño)
    const sigueTecla = () => turnoTeclas() && pasos > 0 && teclasDelJuego(null);
    function teclado(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // atajos del navegador (Alt+←, Ctrl+D...): suyos
      const orden = ordenTecla(ev);
      if (!orden || !teclasDelJuego(ev)) return;
      ev.preventDefault();
      // Apretada ya anda sola (andarSeguido): la repetición del sistema no cuenta
      if (ev.repeat || idTecla(ev) === teclaRepite) return;
      activarSonido();
      if (!turnoTeclas()) return;
      if (orden === '1' || orden === '2') elegirArma(orden === '1' ? 'bazooka' : 'tnt');
      else if (orden === 'salto') pulsarMovimiento('salto', 0);
      else {
        const dir = orden === 'izq' ? -1 : 1;
        pulsarMovimiento('andar', dir);
        pararRepeticion();
        teclaRepite = idTecla(ev);
        andarSeguido(dir, sigueTecla);
      }
    }
    // Al soltarla, deja de andar (en el Mac, con Cmd apretado no llega el soltar de las otras: al soltar Cmd)
    function soltarTecla(ev) {
      if (teclaRepite && (idTecla(ev) === teclaRepite || ev.key === 'Meta')) pararRepeticion();
    }
    // Sin poder soltarla aquí (otra ventana, otra pestaña): también
    function soltarTeclas() { if (teclaRepite) pararRepeticion(); }
    window.addEventListener('keydown', teclado);
    window.addEventListener('keyup', soltarTecla);
    window.addEventListener('blur', soltarTeclas);
    document.addEventListener('visibilitychange', soltarTeclas);

    // ---------- dibujo
    function px(xb) { return ox + xb * bsD; }
    function py(yb) { return oy + yb * bsD; }
    // Letra de píxeles para las palabras; con números, Fredoka (en Pixelify el 2, el 3 y el 5 se
    // confunden con el 8 y la S, y los niños están aprendiendo los números)
    function letra(tam, str) {
      return '700 ' + Math.round(tam) + 'px ' + (/\d/.test(str || '') ? '"Fredoka", ui-rounded, system-ui, sans-serif' : '"Pixelify Sans", "Fredoka", ui-monospace, monospace');
    }
    function texto(str, x, y, tam, color, align) {
      ctx.font = letra(tam, str);
      ctx.textAlign = align || 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, tam / 5);
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }
    function dibujar() {
      if (!jug) return;
      actualizarControles();
      if (!iconosPintados && sprites()) { texturas = {}; capasAgua = []; todoSucio = true; pintarIconos(); }
      pintarTerreno();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      const sx = temblor > 0 ? Math.round((Math.random() - 0.5) * temblor * bsD * 1.3) : 0;
      const sy = temblor > 0 ? Math.round((Math.random() - 0.5) * temblor * bsD * 1.3) : 0;
      const tiembla = sx !== 0 || sy !== 0;
      ctx.drawImage(tiembla ? capaFondo : capaJunta, 0, 0);
      ctx.save();
      ctx.translate(sx, sy);
      if (tiembla) ctx.drawImage(capaTerreno, ox, oy);
      dibujarClavadas();
      for (const e of ents) dibujarEntidad(e);
      dibujarArmaEnMano();
      for (const p of proys) dibujarProyectil(p);
      dibujarParticulas();
      dibujarAgua();
      dibujarDestellos();
      dibujarOrbes();
      for (const e of ents) dibujarBarra(e);
      dibujarMarcador();
      dibujarTextos();
      dibujarGuia();
      ctx.restore();
      dibujarGoma();
      dibujarDemo();
      if (duelo) dibujarHUDDuelo(); else dibujarHUD();
    }
    function dibujarEntidad(e) {
      if (e.oculto) return;
      let alfa = 1, sube = 0, tumbado = false;
      if (!e.vivo) {
        const k = (t - e.muerteT) / 0.7;
        if (e.esJugador && !e.fuera) tumbado = true;
        else { if (k >= 1) return; alfa = 1 - k; sube = e.fuera ? -k * 1.2 : k * 0.6; }
      }
      const altoB = (ALTO_DIBUJO[e.tipo] || 2) * kPers;
      const cx = px(e.x), pie = py(e.y - sube);
      let frame = 0;
      if (e.mov || (e.vivo && e.estado === 'vuela')) frame = 1 + (Math.floor(t * 9) % 2);
      if (e.tipo === 'esqueleto' && e.tensando) frame = 3;
      if (e === jug && (fase === 'jugador' || (duelo && fase === 'remoto')) && !disparado && !e.mov && framesDe(e.tipo) > 3) frame = 3; // sujeta el arma
      let dx = 0;
      if (e.golpeT >= 0 && t - e.golpeT < 0.4) dx = Math.sin(((t - e.golpeT) / 0.4) * Math.PI) * 0.4 * e.dir * bsD;
      let destello = e.destello;
      if (e.tipo === 'creeper' && e.siseo >= 0 && t - e.siseo < 1.2) destello = Math.max(destello, Math.floor((t - e.siseo) * 9) % 2 ? 0.85 : 0.15);
      const op = { voltear: e.dir < 0, frame, alfa, destello };
      ctx.save();
      if (tumbado) {
        ctx.translate(cx, pie - 0.3 * bsD);
        ctx.rotate((e.dir < 0 ? 1 : -1) * Math.PI / 2);
        ctx.translate(-cx, -(pie - 0.3 * bsD));
        op.alfa = 0.85;
      }
      if (!spritePorAlto(e.tipo, cx + dx, pie, altoB * bsD, op)) personajeFalso(e.tipo, cx + dx, pie, altoB * bsD, op);
      ctx.restore();
    }
    function personajeFalso(tipo, cx, pie, alto, op) {
      const col = COLOR_FALSO[tipo] || COLOR_FALSO.zombi;
      const an = Math.round(alto * 0.45), x0 = Math.round(cx - an / 2), top = Math.round(pie - alto);
      ctx.globalAlpha = op.alfa == null ? 1 : op.alfa;
      if (tipo === 'creeper') {
        ctx.fillStyle = col[0];
        ctx.fillRect(x0, top, an, Math.round(alto * 0.8));
        ctx.fillStyle = col[3];
        ctx.fillRect(x0, Math.round(pie - alto * 0.2), an, Math.round(alto * 0.2));
        ctx.fillStyle = '#111';
        const u = an / 8;
        ctx.fillRect(x0 + u, top + u * 2, u * 2, u * 2);
        ctx.fillRect(x0 + u * 5, top + u * 2, u * 2, u * 2);
        ctx.fillRect(x0 + u * 3, top + u * 4, u * 2, u * 3);
      } else {
        const cab = Math.round(alto * 0.25);
        ctx.fillStyle = col[1]; ctx.fillRect(x0, top, an, cab);
        ctx.fillStyle = col[0]; ctx.fillRect(x0, top, an, Math.round(cab * 0.35));
        ctx.fillStyle = '#111';
        const ojoX = op.voltear ? x0 + an * 0.15 : x0 + an * 0.6;
        ctx.fillRect(Math.round(ojoX), top + Math.round(cab * 0.5), Math.max(1, Math.round(an * 0.22)), Math.max(1, Math.round(cab * 0.18)));
        ctx.fillStyle = col[2]; ctx.fillRect(x0, top + cab, an, Math.round(alto * 0.375));
        ctx.fillStyle = col[3]; ctx.fillRect(x0, Math.round(pie - alto * 0.375), an, Math.round(alto * 0.375));
        if (tipo === 'zombi') { ctx.fillStyle = col[1]; ctx.fillRect(op.voltear ? x0 - an * 0.6 : x0 + an, top + cab * 1.2, an * 0.6, cab * 0.4); }
      }
      if (op.destello) { ctx.globalAlpha = (op.alfa == null ? 1 : op.alfa) * op.destello * 0.8; ctx.fillStyle = '#fff'; ctx.fillRect(x0, top, an, alto); }
      ctx.globalAlpha = 1;
    }
    function dibujarArmaEnMano() {
      if (!(fase === 'jugador' || (duelo && fase === 'remoto')) || disparado || !jug.vivo || jug.mov) return;
      const v = vectorApunte();
      const a = v && v.valido ? rad(v.ang) : jug.dir > 0 ? 0.12 : Math.PI - 0.12;
      const cx = px(jug.x + jug.dir * 0.05 * kPers), cy = py(jug.y - 0.95 * kPers);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-a);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.scale(kPers, kPers);
      if (arma === 'bazooka') {
        if (!spritePorAncho('bazooka', 0.25 * bsD, 0, 1.25 * bsD)) {
          ctx.fillStyle = '#3d4a3a'; ctx.fillRect(-0.35 * bsD, -0.18 * bsD, 1.25 * bsD, 0.36 * bsD);
          ctx.fillStyle = '#222'; ctx.fillRect(0.75 * bsD, -0.24 * bsD, 0.2 * bsD, 0.48 * bsD);
        }
      } else if (!spritePorAncho('tnt', 0.45 * bsD, 0, 0.55 * bsD)) {
        ctx.fillStyle = '#d33'; ctx.fillRect(0.2 * bsD, -0.27 * bsD, 0.55 * bsD, 0.55 * bsD);
      }
      ctx.restore();
    }
    // Proyectil por encima del borde de arriba: una marca en el borde, para seguirlo con la vista
    function marcaArriba(p) {
      const x = clamp(px(p.x), 12 * dpr, lienzo.width - 12 * dpr);
      const s = Math.max(bsD * 0.6, 10 * dpr);
      const y = 3 * dpr + Math.abs(Math.sin(t * 9)) * 3 * dpr;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.moveTo(x, y - 2 * dpr); ctx.lineTo(x + s * 0.75 + 2 * dpr, y + s + dpr); ctx.lineTo(x - s * 0.75 - 2 * dpr, y + s + dpr); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.tipo === 'tnt' ? '#ff5b5b' : p.tipo === 'flecha' ? '#ffffff' : '#ffe14d';
      ctx.beginPath(); ctx.moveTo(x, y + dpr); ctx.lineTo(x + s * 0.6, y + s - dpr); ctx.lineTo(x - s * 0.6, y + s - dpr); ctx.closePath(); ctx.fill();
    }
    function dibujarProyectil(p) {
      const cx = px(p.x), cy = py(p.y);
      if (cy < -0.3 * bsD) { marcaArriba(p); return; }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(kPers, kPers);
      if (p.tipo === 'cohete') {
        ctx.rotate(Math.atan2(p.vy, p.vx));
        if (!spritePorAncho('cohete', 0, 0, 1.1 * bsD, { frame: Math.floor(t * 12) % 2 })) {
          ctx.fillStyle = '#ddd'; ctx.fillRect(-0.5 * bsD, -0.15 * bsD, 0.8 * bsD, 0.3 * bsD);
          ctx.fillStyle = '#d33'; ctx.fillRect(0.3 * bsD, -0.15 * bsD, 0.25 * bsD, 0.3 * bsD);
          ctx.fillStyle = '#ffb000'; ctx.fillRect(-0.75 * bsD, -0.1 * bsD, 0.25 * bsD, 0.2 * bsD);
        }
      } else if (p.tipo === 'flecha') {
        ctx.rotate(Math.atan2(p.vy, p.vx));
        if (!spritePorAncho('flecha', 0, 0, 1.0 * bsD)) {
          ctx.fillStyle = '#6e4b26'; ctx.fillRect(-0.5 * bsD, -0.05 * bsD, bsD, 0.1 * bsD);
          ctx.fillStyle = '#ccc'; ctx.fillRect(0.4 * bsD, -0.12 * bsD, 0.15 * bsD, 0.24 * bsD);
        }
      } else {
        const edad = t - p.t0;
        const parpadeo = edad > MECHA_TNT - 1 ? Math.floor(edad * 10) % 2 : Math.floor(edad * 3) % 2;
        ctx.rotate(p.giro);
        if (!spritePorAncho('tnt', 0, 0, 0.75 * bsD, { frame: parpadeo, destello: parpadeo ? 0.5 : 0 })) {
          ctx.fillStyle = parpadeo ? '#fff' : '#d33'; ctx.fillRect(-0.37 * bsD, -0.37 * bsD, 0.75 * bsD, 0.75 * bsD);
          ctx.fillStyle = '#fff'; ctx.fillRect(-0.37 * bsD, -0.12 * bsD, 0.75 * bsD, 0.24 * bsD);
        }
        ctx.restore();
        const queda = Math.max(1, Math.ceil(MECHA_TNT - edad));
        texto(String(queda), cx, cy - 0.95 * bsD * kPers, Math.max(bsD * 0.95, 16 * dpr), queda === 1 ? '#ff5b5b' : '#fff');
        return;
      }
      ctx.restore();
    }
    function dibujarClavadas() {
      for (const f of clavadas) {
        ctx.save();
        ctx.globalAlpha = clamp(2.5 - (t - f.t0), 0, 1);
        ctx.translate(px(f.x), py(f.y));
        ctx.rotate(f.ang);
        if (!spritePorAncho('flecha', -0.25 * bsD, 0, 1.0 * bsD)) { ctx.fillStyle = '#6e4b26'; ctx.fillRect(-0.75 * bsD, -0.05 * bsD, bsD, 0.1 * bsD); }
        ctx.restore();
      }
    }
    function dibujarParticulas() {
      for (const p of particulas) {
        const edad = t - p.t0;
        if (edad < 0) continue;
        const k = edad / p.vida;
        if (p.tipo === 'humo') {
          const tam = p.tam * (0.7 + k * 0.8) * bsD;
          const fr = Math.min(3, Math.floor(k * 4));
          ctx.save();
          if (!spritePorAncho('humo', px(p.x), py(p.y), tam, { frame: fr, alfa: 1 - k * 0.6 })) {
            ctx.globalAlpha = (1 - k) * 0.7;
            ctx.fillStyle = '#bdbdbd';
            ctx.fillRect(px(p.x) - tam / 2, py(p.y) - tam / 2, tam, tam);
          }
          ctx.restore();
        } else {
          const tam = Math.max(2, p.tam * bsD);
          ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(px(p.x) - tam / 2), Math.round(py(p.y) - tam / 2), Math.round(tam), Math.round(tam));
          ctx.globalAlpha = 1;
        }
      }
    }
    // Banda de agua ya pintada (una por cada frame de las olas): un solo drawImage por fotograma
    let capasAgua = [];
    function capaAgua(v) {
      if (capasAgua[v] !== undefined) return capasAgua[v];
      const s = sprites();
      let tex = null;
      if (s && typeof s.textura === 'function') {
        try { tex = s.textura('agua', bsD, v); } catch (e) { tex = null; }
      }
      if (!tex || !tex.width) { capasAgua[v] = null; return null; }
      const c = document.createElement('canvas');
      c.width = lienzo.width;
      c.height = (H - AGUA) * bsD;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      const desde = ox - Math.ceil(ox / bsD) * bsD;
      for (let y = 0; y < c.height; y += bsD) for (let x = desde; x < c.width; x += bsD) g.drawImage(tex, x, y);
      capasAgua[v] = c;
      return c;
    }
    function dibujarAgua() {
      const yA = py(AGUA), yB = py(H);
      const banda = capaAgua(Math.floor(t * 3) % 4);
      ctx.save();
      if (banda) {
        ctx.globalAlpha = 0.72;
        ctx.drawImage(banda, 0, yA);
      } else {
        ctx.fillStyle = 'rgba(42,100,226,.62)';
        ctx.fillRect(0, yA, lienzo.width, yB - yA);
      }
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#a9d8ff';
      const ola = Math.max(2, Math.round(bsD * 0.14));
      const paso = bsD * 2;
      const desp = (t * bsD * 0.8) % paso;
      for (let x = -paso + desp + (ox % paso); x < lienzo.width; x += paso) ctx.fillRect(Math.round(x), Math.round(yA), Math.round(bsD), ola);
      ctx.restore();
    }
    function dibujarDestellos() {
      for (const d of destellos) {
        const k = (t - d.t0) / 0.4;
        const tam = d.r * bsD * (0.6 + k * 0.7) * 2;
        ctx.save();
        if (!spritePorAncho('explosion', px(d.x), py(d.y), tam, { frame: Math.min(3, Math.floor(k * 4)) })) {
          ctx.globalAlpha = 0.75 * (1 - k);
          ctx.fillStyle = k < 0.3 ? '#fff7c2' : '#ffb347';
          ctx.beginPath();
          ctx.arc(px(d.x), py(d.y), tam / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    function dibujarOrbes() {
      for (const o of orbes) {
        const tam = Math.max(6 * dpr, 0.42 * bsD) * (1 + 0.15 * Math.sin(t * 12 + o.fase));
        if (!spritePorAncho('orbe', px(o.x), py(o.y), tam, { frame: Math.floor(t * 6 + o.fase) % 2 })) {
          ctx.fillStyle = '#c6ff3d';
          ctx.fillRect(px(o.x) - tam / 2, py(o.y) - tam / 2, tam, tam);
          ctx.fillStyle = '#5c9e00';
          ctx.fillRect(px(o.x) - tam / 4, py(o.y) - tam / 4, tam / 2, tam / 2);
        }
      }
    }
    function posBarra(e) {
      const altoB = (ALTO_DIBUJO[e.tipo] || 2) * kPers;
      // Más estrecha si hay otro personaje al lado (con bloques pequeños, las barras se juntaban)
      let vecino = Infinity;
      for (const o of ents) if (o !== e && o.vivo && !o.oculto && Math.abs(o.y - e.y) < 2.5) vecino = Math.min(vecino, Math.abs(o.x - e.x));
      const w = Math.max(Math.min(Math.max(bsD * 1.25, 22 * dpr), vecino * bsD - 3 * dpr), 6 * dpr);
      const h = Math.max(bsD * 0.18, 4 * dpr);
      return { x: px(e.x) - w / 2, y: py(e.y - altoB) - h - Math.max(bsD * 0.25, 4 * dpr), w, h };
    }
    function dibujarBarra(e) {
      if (!e.vivo || e.oculto) return;
      const b = posBarra(e);
      const f = clamp(e.vida / e.vidaMax, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.8)';
      ctx.fillRect(Math.round(b.x - dpr), Math.round(b.y - dpr), Math.round(b.w + 2 * dpr), Math.round(b.h + 2 * dpr));
      ctx.fillStyle = '#4a1010';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h));
      ctx.fillStyle = e.esJugador ? (f > 0.5 ? '#4cd137' : f > 0.25 ? '#fbc531' : '#e84118') : f > 0.5 ? '#ff8a3d' : '#e84118';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), Math.round(b.w * f), Math.round(b.h));
    }
    function dibujarMarcador() {
      let e = null, color = '#ffe14d';
      if (fase === 'jugador' && !disparado) e = jug;
      else if (fase === 'monstruos' && activo && activo.vivo) { e = activo; color = '#ff6b5b'; }
      else if (duelo && fase === 'remoto' && !disparado) { e = jug; color = '#ff6b5b'; }
      if (!e || e.oculto) return;
      const b = posBarra(e);
      const s = Math.max(bsD * 0.45, 8 * dpr);
      const yb = b.y - s * 0.3 - Math.abs(Math.sin(t * 5)) * s * 0.6;
      const cx = px(e.x);
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.moveTo(cx - s * 0.75, yb - s * 1.05); ctx.lineTo(cx + s * 0.75, yb - s * 1.05); ctx.lineTo(cx, yb + s * 0.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx - s * 0.5, yb - s * 0.9); ctx.lineTo(cx + s * 0.5, yb - s * 0.9); ctx.lineTo(cx, yb - s * 0.15); ctx.closePath(); ctx.fill();
    }
    function dibujarTextos() {
      for (const x of textos) {
        const k = (t - x.t0) / 1.3;
        const tam = Math.max(bsD * (x.grande ? 1.05 : 0.8), (x.grande ? 18 : 14) * dpr);
        ctx.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
        texto(x.txt, px(x.x), py(x.y - k * 1.3), tam, x.color);
        ctx.globalAlpha = 1;
      }
    }
    // Línea de puntos: en normal solo el principio (pista); en fácil, entera con el sitio donde explota.
    // En el 1 contra 1, entera para el jugador con ayuda (solo se ve: sin imán ni radio extra)
    function dibujarGuia() {
      const v = vectorApunte();
      if (!v || !v.valido || !puedeApuntar()) return;
      const verTodo = duelo ? jugadores[dl.turnoDe].ayuda : facil;
      const a = rad(v.ang);
      const vel = v.fuerza * VMAX[arma];
      const tipo = arma === 'tnt' ? 'tnt' : 'cohete';
      const o = origenDisparo(a, tipo);
      const tr = trayectoria(o.x, o.y, Math.cos(a) * vel, -Math.sin(a) * vel, tipo, verTodo ? 8 : 0.34, verTodo, facil);
      const r = Math.max(bsD * 0.13, 2.5 * dpr);
      tr.pts.forEach((p, i) => {
        ctx.globalAlpha = verTodo ? 0.95 : clamp(1 - i / (tr.pts.length + 1), 0.25, 1);
        ctx.fillStyle = '#000';
        ctx.fillRect(Math.round(px(p.x) - r - dpr), Math.round(py(p.y) - r - dpr), Math.round(2 * r + 2 * dpr), Math.round(2 * r + 2 * dpr));
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(px(p.x) - r), Math.round(py(p.y) - r), Math.round(2 * r), Math.round(2 * r));
      });
      ctx.globalAlpha = 1;
      if (verTodo && tr.fin && !tr.fin.agua) {
        const radio = (arma === 'tnt' ? ARMAS.tnt.radio : ARMAS.bazooka.radio) + (facil ? EXTRA_RADIO_FACIL : 0);
        ctx.strokeStyle = 'rgba(255,80,60,.9)';
        ctx.lineWidth = Math.max(2, 3 * dpr);
        ctx.setLineDash([Math.max(4, bsD * 0.3), Math.max(3, bsD * 0.2)]);
        ctx.beginPath(); ctx.arc(px(tr.fin.x), py(tr.fin.y), radio * bsD * 0.8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      dibujarFlecha(a, v.fuerza);
    }
    // Flecha de dirección y fuerza que sale del personaje
    function dibujarFlecha(a, fuerza) {
      const cx = px(jug.x), cy = py(jug.y - 1.1 * kPers);
      const largo = (0.9 + 2.6 * fuerza) * bsD * kPers;

      const ex = cx + Math.cos(a) * largo, ey = cy - Math.sin(a) * largo;
      const color = 'hsl(' + Math.round(120 - 120 * fuerza) + ',90%,55%)';
      const grosor = Math.max(bsD * 0.22, 4 * dpr);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000'; ctx.lineWidth = grosor + 3 * dpr;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = grosor;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      const pt = grosor * 2.2;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * pt, ey - Math.sin(a) * pt);
      ctx.lineTo(ex + Math.cos(a + 2.4) * pt, ey - Math.sin(a + 2.4) * pt);
      ctx.lineTo(ex + Math.cos(a - 2.4) * pt, ey - Math.sin(a - 2.4) * pt);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    // La "goma" del tirachinas: del punto donde se puso el dedo hasta el dedo
    function dibujarGoma() {
      if (!apunte) return;
      const v = vectorApunte();
      goma(apunte.x0 * dpr, apunte.y0 * dpr, apunte.x * dpr, apunte.y * dpr, v && v.valido ? v.fuerza : null, 1);
    }
    // (x0,y0) donde se puso el dedo; (x1,y1) el dedo ahora; fuerza null = aún no vale para disparar
    function goma(x0, y0, x1, y1, fuerza, alfa) {
      const valido = fuerza != null;
      ctx.save();
      ctx.globalAlpha = (valido ? 0.9 : 0.5) * alfa;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * dpr;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(x0, y0, 14 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.arc(x1, y1, 9 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (valido && alfa >= 1) texto(Math.round(fuerza * 100) + '%', x1, y1 - 26 * dpr, 16 * dpr, '#fff');
      ctx.restore();
    }

    // ---------- la mano que enseña a disparar (sin leer): pone el dedo, arrastra hacia atrás y suelta
    // Sale en el primer turno de cada partida, en todos los turnos del modo fácil y, siempre,
    // si el niño toca sin arrastrar. En el móvil en vertical, en el panel de abajo (el dedo no tapa el mundo).
    const MANO = [
      '....kk......',
      '...kwwk.....',
      '...kwwk.....',
      '...kwwk.....',
      '...kwwkkk...',
      '...kwwkwwkk.',
      '.kkkwwkwwkwk',
      'kwwkwwwwwkwk',
      'kwwwwwwwwwwk',
      '.kwwwwwwwwwk',
      '.kwwwwwwwwwk',
      '..kwwwwwwwk.',
      '..kwwwwwwgk.',
      '..kkkkkkkkk.',
    ];
    let manoCache = null;
    function lienzoMano(e) {
      if (manoCache && manoCache.e === e) return manoCache.c;
      const c = document.createElement('canvas');
      c.width = MANO[0].length * e; c.height = MANO.length * e;
      const g = c.getContext('2d');
      const col = { k: '#1b1b1b', w: '#ffffff', g: '#c9c9c9' };
      MANO.forEach((fila, y) => { for (let x = 0; x < fila.length; x++) if (col[fila[x]]) { g.fillStyle = col[fila[x]]; g.fillRect(x * e, y * e, e, e); } });
      manoCache = { e, c };
      return c;
    }
    function demoVisible() {
      if (!(fase === 'jugador' && !disparado && !saltarTurno && !pausado && jug && jug.vivo && !apunte)) return false;
      if (duelo) {
        // 1 contra 1: en el primer turno de cada uno y en todos los del que tiene ayuda (no con un aviso puesto)
        if (avisoTexto) return false;
        return ayuda || ((jugadores[dl.turnoDe].ayuda || dl.tiros[dl.turnoDe] === 0) && t - inicioTurno > 1.7);
      }
      return ayuda || ((facil || tiros === 0) && t - inicioTurno > 1.7); // después del cartel
    }
    function dibujarDemo() {
      if (!demoVisible()) return;
      const T = 2.6;
      const k = (((t - (ayuda ? ayudaT0 : inicioTurno + 1.7)) % T) + T) % T / T;
      // Hacia dónde: hacia el monstruo más cercano (en el 1 contra 1, el rival), 50º hacia arriba; se arrastra al revés
      let obj = null;
      for (const e of ents) if (e.vivo && (duelo ? e !== jug : !e.esJugador) && !e.oculto && (!obj || Math.abs(e.x - jug.x) < Math.abs(obj.x - jug.x))) obj = e;
      const lado = obj ? Math.sign(obj.x - jug.x) || 1 : jug.dir;
      const ang = lado > 0 ? rad(50) : rad(130);
      const L = largoMax() * 0.55 * dpr;
      const x0 = zonaDemo ? zonaDemo.x * dpr : px(jug.x);
      const y0 = zonaDemo ? zonaDemo.y * dpr : py(jug.y - 1);
      const avance = k < 0.2 ? 0 : k < 0.62 ? (k - 0.2) / 0.42 : 1;
      const suave = avance * avance * (3 - 2 * avance);
      const fx = x0 - Math.cos(ang) * L * suave, fy = y0 + Math.sin(ang) * L * suave;
      const suelta = k >= 0.74;
      ctx.save();
      // Al pulsar: un aro en el sitio del dedo
      if (k >= 0.1 && !suelta) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.arc(x0, y0, (10 + 8 * Math.min(1, (k - 0.1) / 0.1)) * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      if (avance > 0 && !suelta) {
        goma(x0, y0, fx, fy, 0.6 * suave, 0.85);
        ctx.save(); ctx.globalAlpha = 0.85; dibujarFlecha(ang, 0.6 * suave); ctx.restore();
      }
      // Al soltar: un cohete fantasma sale del héroe
      if (suelta) {
        const q = (k - 0.74) / 0.26;
        const v = 0.6 * VMAX.bazooka, tt = q * 0.55;
        const o = origenDisparo(ang);
        const bx = o.x + Math.cos(ang) * v * tt, by = o.y - Math.sin(ang) * v * tt + 0.5 * G * tt * tt;
        ctx.save();
        ctx.globalAlpha = 1 - q * 0.7;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(px(bx), py(by), Math.max(bsD * 0.3, 5 * dpr), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // La mano: la punta del dedo en el sitio del toque; al soltar, se levanta y se va
      const e = Math.max(3, Math.round(4 * dpr));
      const img = lienzoMano(e);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = k < 0.08 ? k / 0.08 : suelta ? Math.max(0, 1 - (k - 0.74) / 0.18) : 1;
      const lev = suelta ? (k - 0.74) * 60 * dpr : 0;
      ctx.drawImage(img, Math.round(fx - 4.5 * e), Math.round(fy - 0.5 * e - lev));
      ctx.restore();
    }
    function dibujarHUD() {
      const u = Math.max(bsD * 0.9, (hudPanel ? 19 : 17) * dpr);
      let y0 = oy + Math.max(bsD * 0.4, 8 * dpr);
      let x0 = ox + Math.max(bsD * 0.5, 8 * dpr);
      if (hudPanel) { x0 = hudPanel.x * dpr; y0 = hudPanel.y * dpr; } // móvil en vertical: en el panel
      else if (hueco.ancho && y0 < hueco.alto * dpr) x0 = Math.max(x0, (hueco.ancho + 6) * dpr); // a la derecha del botón de la app
      // Vida del jugador
      if (!spritePorAncho('corazon', x0 + u / 2, y0 + u / 2, u, { frame: jug.vivo ? 0 : 1 })) {
        ctx.fillStyle = '#e82c2c';
        ctx.fillRect(x0 + u * 0.1, y0 + u * 0.2, u * 0.8, u * 0.5);
        ctx.fillRect(x0 + u * 0.25, y0 + u * 0.7, u * 0.5, u * 0.2);
      }
      const bx = x0 + u * 1.25, bw = u * 5.5, bh = u * 0.62, by = y0 + (u - bh) / 2;
      const f = clamp(jug.vida / jug.vidaMax, 0, 1);
      ctx.fillStyle = '#000'; ctx.fillRect(Math.round(bx - 2 * dpr), Math.round(by - 2 * dpr), Math.round(bw + 4 * dpr), Math.round(bh + 4 * dpr));
      ctx.fillStyle = '#4a1010'; ctx.fillRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
      ctx.fillStyle = f > 0.5 ? '#4cd137' : f > 0.25 ? '#fbc531' : '#e84118';
      ctx.fillRect(Math.round(bx), Math.round(by), Math.round(bw * f), Math.round(bh));
      texto(String(Math.ceil(jug.vida)), bx + bw / 2, by + bh / 2 + dpr, u * 0.6, '#fff');
      // De quién es el turno (se queda puesto; el cartel grande se va enseguida)
      const deQuien = fase === 'jugador' && !disparado ? '¡Tu turno!' : fase === 'monstruos' ? 'Monstruos' : '';
      const tl = u * 0.78;
      ctx.font = letra(tl);
      const finTurno = deQuien ? bx + bw + u * 0.5 + ctx.measureText(deQuien).width : bx + bw;
      if (deQuien) texto(deQuien, bx + bw + u * 0.5, by + bh / 2 + dpr, tl, fase === 'jugador' ? '#ffe14d' : '#ff7b6b', 'left');
      const quedan = ents.filter((e) => !e.esJugador && e.vivo).length;
      const linea = 'Nivel ' + nivel + (facil ? ' (fácil)' : '') + '   Quedan ' + quedan;
      texto(linea, x0, y0 + u * 1.6, u * 0.78, '#fff', 'left');
      // Viento
      if (cfg.viento > 0) {
        // En el centro; si el marcador llega hasta ahí (móvil en vertical), algo más a la derecha
        ctx.font = letra(u * 0.78, linea);
        const finMarcador = Math.max(finTurno, x0 + ctx.measureText(linea).width);
        ctx.font = letra(u * 0.78);
        const n = viento === 0 ? 0 : Math.max(1, Math.ceil(Math.abs(viento) * 3));
        const an = u * 1.15;
        const medio = Math.max(ctx.measureText('Viento').width, 3 * an * 1.05) / 2;
        let cx = Math.max(ox + (W * bsD) / 2, finMarcador + u * 0.8 + medio), y = y0 + u * 0.45;
        // Sin sitio antes del botón del sonido (móvil en vertical): debajo de ese botón, a la derecha
        // (ahí suele haber cielo: el héroe empieza a la izquierda)
        if (cx + medio > lienzo.width - (hudPanel ? 12 : 62) * dpr) { cx = lienzo.width - 10 * dpr - medio; y = 66 * dpr + u * 0.3; }
        // Placa oscura detrás: las flechas son blancas y a veces hay una nube justo detrás
        const pl = { x: cx - medio - u * 0.35, y: y - u * 0.6, w: 2 * medio + u * 0.7, h: u * 2.05 };
        ctx.fillStyle = 'rgba(0,0,0,.38)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(pl.x, pl.y, pl.w, pl.h, u * 0.3); else ctx.rect(pl.x, pl.y, pl.w, pl.h);
        ctx.fill();
        texto('Viento', cx, y, u * 0.78, '#fff');

        if (n === 0) texto('sin viento', cx, y + u * 0.95, u * 0.55, '#e8f6ff');
        for (let k = 0; k < n; k++) {
          const xx = cx + (k - (n - 1) / 2) * an * 1.05, yy = y + u * 0.95;
          if (!spritePorAncho('viento', xx, yy, an, { voltear: viento < 0 })) {
            ctx.save(); ctx.translate(xx, yy); if (viento < 0) ctx.scale(-1, 1);
            ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
            ctx.beginPath(); ctx.moveTo(-an / 2, -an * 0.12); ctx.lineTo(an * 0.1, -an * 0.12); ctx.lineTo(an * 0.1, -an * 0.3); ctx.lineTo(an / 2, 0); ctx.lineTo(an * 0.1, an * 0.3); ctx.lineTo(an * 0.1, an * 0.12); ctx.lineTo(-an / 2, an * 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // 1 contra 1: una barra de vida por héroe (el 0 arriba a la izquierda y el 1 arriba a la derecha, sin
    // pisar el botón de volver ni el del sonido), de quién es el turno y la cuenta atrás (últimos 10 s)
    function dibujarHUDDuelo() {
      const u = Math.max(bsD * 0.9, (hudPanel ? 19 : 17) * dpr);
      const margen = Math.max(bsD * 0.5, 8 * dpr);
      let y0 = oy + Math.max(bsD * 0.4, 8 * dpr), izq = ox + margen, der = ox + W * bsD - margen;
      if (hudPanel) { izq = hudPanel.x * dpr; y0 = hudPanel.y * dpr; der = lienzo.width - hudPanel.x * dpr; } // móvil en vertical: en el panel
      else {
        if (hueco.ancho && y0 < hueco.alto * dpr) izq = Math.max(izq, (hueco.ancho + 6) * dpr); // a la derecha del botón de la app
        if (y0 < 60 * dpr) der = Math.min(der, lienzo.width - 62 * dpr); // a la izquierda del botón del sonido
      }
      const tl = u * 0.78;
      const turno = textoTurnoDuelo();
      ctx.font = letra(tl, turno.txt);
      const anTurno = turno.txt ? ctx.measureText(turno.txt).width : 0;
      // Barras de 5,5u como contra los monstruos, más cortas si no caben. Si el texto del turno no cabe
      // entre las dos, baja a la segunda línea (entre los nombres) y arriba queda la cuenta atrás.
      const libre = der - izq - 2 * u * 1.25;
      let bw = Math.min(u * 5.5, (libre - anTurno - u * 1.6) / 2), turnoArriba = true;
      if (bw < u * 3) { bw = clamp((libre - u * 2) / 2, u * 2, u * 5.5); turnoArriba = false; }
      const bh = u * 0.62, by = y0 + (u - bh) / 2, y2 = y0 + u * 1.6, pad = 4 * dpr;
      const deTurno = fase === 'fin' || fase === 'inicio' ? -1 : dl.turnoDe;
      for (let k = 0; k < 2; k++) {
        const e = heroes[k], dcha = k === 1;
        const xc = dcha ? der - u : izq;                        // corazón (por fuera)
        const bx = dcha ? der - u * 1.25 - bw : izq + u * 1.25;  // barra
        // Placa oscura detrás (se lee sobre el cielo y las nubes); la del turno, con borde
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath();
        const rx = Math.min(xc, bx) - pad, rw = u * 1.25 + bw + 2 * pad;
        if (ctx.roundRect) ctx.roundRect(rx, y0 - pad, rw, u + 2 * pad, 6 * dpr); else ctx.rect(rx, y0 - pad, rw, u + 2 * pad);
        ctx.fill();
        if (k === deTurno) { ctx.strokeStyle = jugadores[k].local ? '#ffe14d' : '#ff7b6b'; ctx.lineWidth = 3 * dpr; ctx.stroke(); }
        if (!spritePorAncho('corazon', xc + u / 2, y0 + u / 2, u, { frame: e.vivo ? 0 : 1 })) {
          ctx.fillStyle = e.vivo ? '#e82c2c' : '#555';
          ctx.fillRect(xc + u * 0.1, y0 + u * 0.2, u * 0.8, u * 0.5);
          ctx.fillRect(xc + u * 0.25, y0 + u * 0.7, u * 0.5, u * 0.2);
        }
        const vida = e.vivo ? e.vida : 0;
        const f = clamp(vida / e.vidaMax, 0, 1);
        ctx.fillStyle = '#000'; ctx.fillRect(Math.round(bx - 2 * dpr), Math.round(by - 2 * dpr), Math.round(bw + 4 * dpr), Math.round(bh + 4 * dpr));
        ctx.fillStyle = '#4a1010'; ctx.fillRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
        ctx.fillStyle = f > 0.5 ? '#4cd137' : f > 0.25 ? '#fbc531' : '#e84118';
        // (la del 1 se vacía hacia la derecha, hacia su corazón: las dos simétricas)
        ctx.fillRect(Math.round(dcha ? bx + bw * (1 - f) : bx), Math.round(by), Math.round(bw * f), Math.round(bh));
        texto(String(Math.ceil(vida)), bx + bw / 2, by + bh / 2 + dpr, u * 0.6, '#fff');
        // Nombre del héroe debajo (en red, el tuyo con «(tú)»)
        texto(nombreDe(k) + (!enTablet() && jugadores[k].local ? ' (tú)' : ''), dcha ? der : izq, y2, u * 0.7, '#fff', dcha ? 'right' : 'left');
      }
      const cx = (izq + der) / 2;
      if (turno.txt) texto(turno.txt, cx, turnoArriba ? by + bh / 2 + dpr : y2, tl, turno.color);
      // Cuenta atrás del turno local: grande, con un saltito en cada número y en rojo los 3 últimos
      const q = quedaTurno();
      if (q != null && q <= 10) {
        const s = Math.max(1, Math.ceil(q)), salto = Math.max(0, 1 - (s - q) * 4);
        texto(String(s), cx, turnoArriba ? y2 + u * 0.3 : by + bh / 2 + dpr, u * 1.25 * (1 + 0.25 * salto), s <= 3 ? '#ff5b5b' : '#fff');
      }
    }
    function textoTurnoDuelo() {
      if (fase === 'fin' || fase === 'inicio') return { txt: '', color: '#fff' };
      const i = dl.turnoDe;
      if (enTablet()) return { txt: 'Turno de ' + nombreDe(i), color: '#ffe14d' };
      return jugadores[i].local ? { txt: '¡Tu turno!', color: '#ffe14d' } : { txt: 'Turno de ' + nombreDe(i), color: '#ff7b6b' };
    }

    // ---------- bucle
    function bucle(ts) {
      if (detenido) return;
      rafId = requestAnimationFrame(bucle);
      const real = ultimoTs ? Math.min(0.1, (ts - ultimoTs) / 1000) : DT;
      ultimoTs = ts;
      const ritmo = fase === 'monstruos' ? ritmoMonstruos(ents.filter((e) => e.vivo && !e.esJugador).length, prisa) : 1;
      if (pausado) acum = 0; // la app pregunta si salir: todo quieto detrás
      else acum += real * (RAPIDO ? 60 : ESCALA) * ritmo;
      const tope = RAPIDO ? 4000 : 240;
      let n = 0;
      while (acum >= DT && n < tope) { pasoSeguro(); acum -= DT; n++; }
      if (n >= tope) acum = 0;
      try { dibujar(); } catch (err) { anotarError(err); }
    }

    function detener() {
      if (detenido) return;
      detenido = true;
      cancelAnimationFrame(rafId);
      pararRepeticion();
      try { if (ro) ro.disconnect(); } catch (e) { /* nada */ }
      window.removeEventListener('resize', medir);
      window.removeEventListener('keydown', teclado);
      window.removeEventListener('keyup', soltarTecla);
      window.removeEventListener('blur', soltarTeclas);
      document.removeEventListener('visibilitychange', soltarTeclas);
      raiz.remove();
      if (activa === api) activa = null;
    }

    // ---------- ganchos de prueba
    function info(e) {
      return {
        id: e.id, tipo: e.tipo, jugador: e.esJugador, x: e.x, y: e.y, vida: e.vida, vivo: e.vivo, estado: e.estado,
        fuera: e.fuera, dir: e.dir,
        apoyado: e.vivo ? solido(Math.floor(e.x), Math.round(e.y)) : null,
        enterrado: e.vivo ? cajaChoca(e.x, e.y) : null,
      };
    }
    function listo() {
      return fase === 'jugador' && !disparado && !saltarTurno && colaMov.length === 0 && reposado(jug) && !apunte;
    }
    const pr = {
      estado() {
        return {
          fase, turno: fase, turnoN, nivel, facil, semilla, t: Math.round(t * 1000) / 1000, viento, pasos, arma, tiros, resultado,
          listo: listo(), tranquilo: tranquilo(),
          jugador: info(jug),
          monstruos: ents.filter((e) => !e.esJugador).map(info),
          entidades: ents.map(info),
          proyectiles: proys.map((p) => ({ tipo: p.tipo, x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
          largoApunte: largoMax(), ultimoTiro,
          pendientes: pendientes.length,
          errores: errores.slice(), avisos: avisos.slice(), stats: Object.assign({}, stats),
          W, H, agua: AGUA,
          alturas: Array.from({ length: W }, (_, x) => superficie(x)),
          bloques: celdas.reduce((n, c) => n + (c ? 1 : 0), 0),
          grietas: dano.reduce((n, f) => n + (etapaGrieta(f) ? 1 : 0), 0), sucias: sucias.length, todoSucio,
          textos: textos.map((x) => x.txt),
          modo, bloque: bsD / dpr, origen: { x: ox / dpr, y: oy / dpr },
          finVisible: !$fin.hidden,
          pausado, prisa, ayuda: demoVisible(),
          cartel: $cartel.textContent, aviso: avisoTexto,
          duelo: duelo ? {
            activo: true, n: dl.n, turnoDe: dl.turnoDe, esperandoRemoto: esperandoRival(), bloqueado: bloqueado(),
            id: dl.id, ganador: dl.ganador, tiempoTurno: dl.tiempo, queda: quedaTurno(), acciones: copia(acciones),
            jugadores: jugadores.map((j, k) => Object.assign({}, j, info(heroes[k]))),
          } : { activo: false },
        };
      },
      // 1 contra 1: la instantánea de ahora y aplicar una (con nº de turno y a quién le toca)
      instantanea() { return instantanea(); },
      aplicar(o) { return aplicarInstantanea(o, true); },
      terreno() {
        const filas = [];
        for (let y = 0; y < H; y++) { let f = ''; for (let x = 0; x < W; x++) f += LETRA_BLOQUE[celdas[y * W + x]]; filas.push(f); }
        return filas;
      },
      // Daño de cada bloque por filas: una cifra 0-9 (décimas de lo que aguanta), '.' = aire
      danos() {
        const filas = [];
        for (let y = 0; y < H; y++) {
          let f = '';
          for (let x = 0; x < W; x++) { const i = y * W + x; f += celdas[i] ? Math.min(9, Math.floor(dano[i] * 10)) : '.'; }
          filas.push(f);
        }
        return filas;
      },
      // Explota en (x, y) igual que el arma del héroe (radio, daño, empuje y rotura de bloques). Devuelve los bloques rotos.
      explotarEn(x, y, cual) {
        x = Number(x); y = Number(y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
        const def = ARMAS[cual === 'tnt' ? 'tnt' : 'bazooka'];
        return explotar(x, y, def.radio + (facil ? EXTRA_RADIO_FACIL : 0), def.dano, { empuje: def.empuje, piedra: def.piedra });
      },
      // Dispara desde el héroe aunque no sea su turno, sin gastarlo (para medir: el mismo tiro una y otra vez)
      lanzar(ang, fuerza, cual) {
        ang = Number(ang); fuerza = Number(fuerza);
        if (!jug || !jug.vivo || fase === 'fin' || !Number.isFinite(ang) || !Number.isFinite(fuerza)) return false;
        lanzarProyectil(rad(ang), clamp(fuerza, 0.08, 1), cual === 'tnt' ? 'tnt' : 'bazooka');
        return true;
      },
      // Daño (0..1) de un bloque, sin romperlo: grietas para pruebas y capturas
      ponerDano(x, y, f) {
        if (!(x >= 0 && x < W && y >= 0 && y < H)) return false;
        fijarDano(Math.floor(y) * W + Math.floor(x), f);
        return true;
      },
      volcarTerreno() { return volcarTerreno(); },
      cargarTerreno(o) { return cargarTerreno(o); },
      disparar(ang, fuerza, cual) { return disparar(ang, fuerza, cual); },
      mover(dir, n) {
        if (fase !== 'jugador' || disparado) return 0;
        n = Math.max(1, Math.floor(n || 1));
        for (let i = 0; i < n; i++) colaMov.push({ tipo: 'andar', dir: dir < 0 ? -1 : 1 });
        return n;
      },
      saltar(dir) {
        if (fase !== 'jugador' || disparado) return false;
        colaMov.push({ tipo: 'salto', dir: dir ? (dir < 0 ? -1 : 1) : 0 });
        return true;
      },
      elegirArma(a) { return elegirArma(a); },
      terminarTurno() {
        if (fase === 'jugador' && !disparado) { saltarTurno = true; return true; }
        return false;
      },
      // Avanza la simulación (sin esperar a la pantalla) hasta que el jugador pueda jugar o acabe la partida
      // (en el 1 contra 1, también si no puede seguir sin algo del rival)
      simular(maxSeg) {
        const fin = t + (maxSeg || 120);
        let n = 0;
        while (t < fin && n < 200000) {
          if (fase === 'fin' && co === null) break;
          if ((listo() || bloqueado()) && n > 0) break;
          pasoSeguro();
          n++;
        }
        return pr.estado();
      },
      avanzar(seg) {
        const n = Math.round((seg || 1) / DT);
        for (let i = 0; i < n; i++) pasoSeguro();
        return pr.estado();
      },
      trayectoria(ang, fuerza, cual) {
        cual = cual === 'tnt' || cual === 'bazooka' ? cual : arma;
        const a = rad(ang), v = clamp(fuerza, 0.08, 1) * VMAX[cual];
        const o = origenDisparo(a, cual === 'tnt' ? 'tnt' : 'cohete');
        const r = trayectoria(o.x, o.y, Math.cos(a) * v, -Math.sin(a) * v, cual === 'tnt' ? 'tnt' : 'cohete', 10, true, facil);
        return { fin: r.fin, golpe: r.golpe ? info(r.golpe) : null, puntos: r.pts.length };
      },
      // Coordenadas de pantalla (CSS, relativas a la ventana) de un punto del mundo
      pantalla(xb, yb) {
        const r = lienzo.getBoundingClientRect();
        return { x: r.left + (ox + xb * bsD) / dpr, y: r.top + (oy + yb * bsD) / dpr };
      },
      // (en el 1 contra 1: forzarFin(índice del ganador), o null para empate)
      forzarFin(gano) {
        if (fase === 'fin') return false;
        if (duelo) {
          heroes.forEach((e, k) => { if (gano == null || k !== gano) { e.vida = 0; e.vivo = false; e.muerteT = t; e.estado = 'derrotado'; } });
          espera = null;
          co = finDuelo();
          return true;
        }
        if (gano) ents.forEach((e) => { if (!e.esJugador && e.vivo) { e.vivo = false; e.oculto = true; } });
        else { jug.vida = 0; jug.vivo = false; jug.muerteT = t; }
        espera = null;
        co = finPartida();
        return true;
      },
      // Mide cuánto tarda en pintarse un fotograma (ms de media)
      medirDibujo(n) {
        n = n || 60;
        const t0 = performance.now();
        for (let i = 0; i < n; i++) dibujar();
        return (performance.now() - t0) / n;
      },
      // Simula un toque en el lienzo para apuntar (coordenadas CSS relativas al lienzo); null = soltar
      apuntar(x0, y0, x1, y1) {
        if (x0 == null) { apunte = null; return true; }
        if (!puedeApuntar()) return false;
        apunte = { id: -1, x0, y0, x: x1, y: y1 };
        return true;
      },
      get rapido() { return RAPIDO; },
      set rapido(v) { RAPIDO = !!v; },
    };

    const api = {
      detener,
      // Pausa (por ejemplo, mientras la app pregunta "¿Salir de la partida?")
      pausar(si) { pausado = !!si; apunte = null; colaMov.length = 0; pararRepeticion(); },
      reiniciar(n, sem) { if (detenido) return; if (duelo) nuevoDuelo({ semilla: sem }); else nuevaPartida(n || nivel, sem); },
      enCurso() { return !detenido && fase !== 'fin'; },
      get nivel() { return nivel; },
      // ---- 1 contra 1 (fuera del duelo no hacen nada)
      get duelo() { return !!duelo; },
      recibirJugada(j) { return recibir(j, 'jugada'); },  // la jugada del rival (se reproduce en cuanto toca)
      recibirTurno(tr) { return recibir(tr, 'turno'); },  // su resultado oficial (se aplica con todo quieto)
      estado() { return instantanea(); },
      nuevoDuelo(o) { return nuevoDuelo(o); },
      aviso(txt, op) { if (!detenido) ponerAviso(txt, op); },
      rival() {
        return { esperando: esperandoRival(), bloqueado: bloqueado(), n: dl ? dl.n : 0, turnoDe: dl ? dl.turnoDe : 0 };
      },
      _pr: pr,
    };

    // ---------- arranque
    activa = api;
    if (duelo) {
      nuevaPartidaDuelo({
        semilla: duelo.semilla != null ? duelo.semilla : opciones.semilla, estadoInicial: duelo.estadoInicial, empieza: duelo.empieza,
      });
    } else nuevaPartida(nivel);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!detenido) medir(); }) : null;
    if (ro) ro.observe(raiz);
    window.addEventListener('resize', medir);
    medir();
    activarSonido();
    rafId = requestAnimationFrame(bucle);
    // El mapa ya está: el que crea la sala lo manda al otro (se llama antes de que iniciar() devuelva la api)
    if (duelo) llamar('alListo', instantanea());
    return api;
  }

  // ---------------------------------------------------------------- ganchos de prueba
  const __prueba = {
    get activa() { return !!activa; },
    get rapido() { return RAPIDO; },
    set rapido(v) { RAPIDO = !!v; },
    acelerar(f) { ESCALA = Math.max(0.05, Number(f) || 1); return ESCALA; },
  };
  ['estado', 'terreno', 'danos', 'explotarEn', 'lanzar', 'ponerDano', 'volcarTerreno', 'cargarTerreno', 'instantanea', 'aplicar',
    'disparar', 'mover', 'saltar', 'elegirArma', 'terminarTurno', 'simular', 'avanzar', 'trayectoria', 'pantalla', 'forzarFin', 'medirDibujo', 'apuntar'].forEach((n) => {
    __prueba[n] = function () { return activa ? activa._pr[n].apply(null, arguments) : null; };
  });

  window.Batalla = { NIVELES, configNivel, iniciar, __prueba, W, H };
})();
