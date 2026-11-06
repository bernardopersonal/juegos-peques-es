// Todo lo que dicen los juegos está aquí. Si cambias o añades algo,
// vuelve a ejecutar la generación de audios (npm run audios o el Action).
// Lo de la familia (niños con voz, rutina de la semana y vídeo de los días) está en js/familia.js.
(function (root) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Datos de la familia (js/familia.js) ----------
  // En el navegador, window.FAMILIA; en Node (scripts/*.mjs), require. Sin el archivo, todo genérico.
  function cargarFamilia() {
    if (typeof module === 'undefined' || !module.exports) return root.FAMILIA || {};
    try { require.resolve('./familia.js'); } catch { return {}; }
    // Si el archivo está pero tiene un error, que falle: si pasase por "sin familia",
    // generar-audios.mjs borraría los audios con los nombres.
    return require('./familia.js');
  }
  const FAMILIA = cargarFamilia();

  // ---------- Perfiles con voz propia ----------
  // SOLO estos nombres se convierten en audio. Cualquier otro niño que se cree
  // un perfil verá su nombre en pantalla, pero la voz le hablará sin nombre.
  // Sin perfiles con voz, en el inicio solo se puede crear un perfil.
  const PERFILES_CON_VOZ = FAMILIA.perfiles || {};
  const BRAVO = ['¡Muy bien', '¡Genial', '¡Bravo', '¡Fenomenal'];
  // Felicitación: con nombre para los perfiles con voz, sin nombre para el resto.
  function felicitaciones(idPerfil) {
    const p = PERFILES_CON_VOZ[idPerfil];
    return BRAVO.map((b) => (p ? b + ', ' + p.nombre + '!' : b + '!'));
  }
  function bienvenida(idPerfil) {
    const p = PERFILES_CON_VOZ[idPerfil];
    return p ? p.bienvenida || '¡Hola, ' + p.nombre + '!' : '¡Hola! ¡Vamos a jugar!';
  }

  // ---------- Trazar ----------
  const NUMEROS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const NOMBRE_LETRA = {
    A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'efe', G: 'ge', H: 'hache', I: 'i',
    J: 'jota', K: 'ka', L: 'ele', M: 'eme', N: 'ene', 'Ñ': 'eñe', O: 'o', P: 'pe', Q: 'cu',
    R: 'erre', S: 'ese', T: 'te', U: 'u', V: 'uve', W: 'uve doble', X: 'equis',
    Y: 'i griega', Z: 'zeta',
  };
  // Primero vocales, luego las consonantes que antes se aprenden, luego el resto.
  const ORDEN_LETRAS = 'AEIOUMPLSTBCDFGHJKNÑQRVWXYZ'.split('');

  function nombreTrazo(c) {
    // Mayúscula y minúscula se llaman igual: "la eme" (reutiliza el mismo audio)
    return /\d/.test(c) ? 'el ' + NUMEROS[+c] : 'la ' + NOMBRE_LETRA[c.toUpperCase()];
  }
  const trazar = {
    intro: '¿Qué quieres trazar?',
    empezar: (c) => 'Vamos a hacer ' + nombreTrazo(c) + '.',
    fin: (c) => '¡' + cap(nombreTrazo(c)) + '!',
  };

  // ---------- Mayores: sonidos ----------
  // Cómo se "dice" el sonido de cada letra (no su nombre). Ajústalo si no suena bien.
  const FONEMA = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', m: 'mmmm', p: 'p', l: 'llll', s: 'sss', t: 't' };
  const NIVELES = [
    { nombre: 'Vocales', letras: ['a', 'e', 'i', 'o', 'u'] },
    { nombre: 'M y P', letras: ['a', 'e', 'i', 'o', 'u', 'm', 'p'] },
    { nombre: 'L, S y T', letras: ['a', 'e', 'i', 'o', 'u', 'm', 'p', 'l', 's', 't'] },
  ];
  const PALABRAS_INICIO = {
    a: [['abeja', '🐝'], ['avión', '✈️'], ['araña', '🕷️']],
    e: [['elefante', '🐘'], ['estrella', '⭐'], ['erizo', '🦔']],
    i: [['isla', '🏝️'], ['iglesia', '⛪'], ['imán', '🧲']],
    o: [['oso', '🐻'], ['oveja', '🐑'], ['ojo', '👁️']],
    u: [['uvas', '🍇'], ['unicornio', '🦄'], ['uno', '1️⃣']],
    m: [['mono', '🐒'], ['manzana', '🍎'], ['moto', '🏍️'], ['mano', '✋']],
    p: [['pato', '🦆'], ['pera', '🍐'], ['pez', '🐟'], ['pan', '🍞']],
    l: [['luna', '🌙'], ['león', '🦁'], ['limón', '🍋'], ['lápiz', '✏️']],
    s: [['sol', '☀️'], ['seta', '🍄'], ['sapo', '🐸'], ['silla', '🪑']],
    t: [['tomate', '🍅'], ['tortuga', '🐢'], ['tren', '🚆'], ['taza', '☕']],
  };
  const sonidos = {
    intro: 'Escucha la palabra y toca el sonido con el que empieza.',
    pregunta: (palabra) => '¿Con qué sonido empieza ' + palabra + '?',
    acierto: (palabra, letra) => '¡Sí! ' + cap(palabra) + ' empieza por ' + FONEMA[letra] + '.',
  };

  // ---------- Mayores: sílabas ----------
  const CONSONANTES = ['m', 'p', 'l', 's', 't'];
  const VOCALES = ['a', 'e', 'i', 'o', 'u'];
  const SILABAS = [];
  CONSONANTES.forEach((c) => VOCALES.forEach((v) => SILABAS.push(c + v)));
  const silabas = {
    intro: 'Escucha y busca la sílaba. Si no sabes, toca el altavoz para oír cómo suena.',
    pregunta: (s) => 'Busca: ' + s + '.',
    introEscribir: 'Escucha la sílaba y escríbela con el dedo.',
    escribir: (s) => 'Escribe: ' + s + '.',
  };

  // ---------- Mayores: palabras ----------
  const PALABRAS = [
    { p: 'mamá', s: ['ma', 'má'], e: '👩' },
    { p: 'papá', s: ['pa', 'pá'], e: '👨' },
    { p: 'pato', s: ['pa', 'to'], e: '🦆' },
    { p: 'sapo', s: ['sa', 'po'], e: '🐸' },
    { p: 'sopa', s: ['so', 'pa'], e: '🍲' },
    { p: 'luna', s: ['lu', 'na'], e: '🌙' },
    { p: 'lupa', s: ['lu', 'pa'], e: '🔍' },
    { p: 'moto', s: ['mo', 'to'], e: '🏍️' },
    { p: 'mapa', s: ['ma', 'pa'], e: '🗺️' },
    { p: 'seta', s: ['se', 'ta'], e: '🍄' },
    { p: 'mono', s: ['mo', 'no'], e: '🐒' },
    { p: 'tomate', s: ['to', 'ma', 'te'], e: '🍅' },
    { p: 'patata', s: ['pa', 'ta', 'ta'], e: '🥔' },
    { p: 'paloma', s: ['pa', 'lo', 'ma'], e: '🕊️' },
    { p: 'maleta', s: ['ma', 'le', 'ta'], e: '🧳' },
    { p: 'pelota', s: ['pe', 'lo', 'ta'], e: '⚽' },
  ];
  const palabras = {
    intro: 'Toca las sílabas en orden para formar la palabra.',
    pregunta: (p) => 'Forma la palabra: ' + p + '.',
    fin: (p) => '¡' + cap(p) + '!',
  };

  // ---------- Peques (3-4 años): contar, colores y letras ----------
  const EDAD_PEQUES = 4; // hasta esta edad se ve el menú de peques
  const contar = {
    intro: 'Cuenta cuántos hay y toca el número.',
    pregunta: '¿Cuántos hay?',
    // al tocar cada cosa se cuenta en voz alta: uno, dos, tres...
  };
  const COLORES = [
    { id: 'rojo', hex: '#e53935' }, { id: 'azul', hex: '#1e88e5' }, { id: 'amarillo', hex: '#fdd835' },
    { id: 'verde', hex: '#43a047' }, { id: 'naranja', hex: '#fb8c00' }, { id: 'morado', hex: '#8e24aa' },
    { id: 'rosa', hex: '#f06292' },
  ];
  const colores = {
    intro: 'Escucha y toca el color.',
    pregunta: (c) => 'Toca el ' + c + '.',
    acierto: (c) => '¡' + cap(c) + '!',
  };
  const LETRAS_PEQUES = ['A', 'E', 'I', 'O', 'U', 'M', 'P', 'L', 'S', 'T'];
  const letras = {
    intro: 'Escucha y busca la letra.',
    pregunta: (c) => '¿Dónde está la ' + NOMBRE_LETRA[c.toUpperCase()] + '?',
    // el acierto reutiliza trazar.fin: "¡La a!"
  };

  // ---------- Días de la semana (con la rutina de js/familia.js, si la trae) ----------
  // Sin rutina: el orden, el cole y el finde siguen igual, con emojis neutros y sin «¿Qué toca?».
  const RUTINA = (FAMILIA.rutina && FAMILIA.rutina.dias) || [];
  const DIAS = [
    { id: 'lunes', nombre: 'Lunes', color: '#e53935', cole: true },
    { id: 'martes', nombre: 'Martes', color: '#fb8c00', cole: true },
    { id: 'miercoles', nombre: 'Miércoles', color: '#f9c80e', cole: true },
    { id: 'jueves', nombre: 'Jueves', color: '#43a047', cole: true },
    { id: 'viernes', nombre: 'Viernes', color: '#1e88e5', cole: true },
    { id: 'sabado', nombre: 'Sábado', color: '#8e24aa', cole: false },
    { id: 'domingo', nombre: 'Domingo', color: '#f06292', cole: false },
  ].map((d, i) => {
    const r = RUTINA[i] || {};
    return { ...d, emoji: r.emoji || (d.cole ? '🎒' : '🎉'), que: r.que || (d.cole ? 'Cole' : 'Fin de semana') };
  });
  // Vídeo de los días: sin él, ni botón 🎬 en Días ni se pone solo la primera vez
  const VIDEO_DIAS = (FAMILIA.videoDias && FAMILIA.videoDias.archivo) || null;
  const dias = {
    nombre: (d) => '¡' + d.nombre + '!',
    todos: '¡Lunes, martes, miércoles, jueves, viernes, sábado y domingo!',
    hoyEs: 'Hoy es',
    mananaEs: 'Mañana es',
    tren: 'Pon los días en orden en el tren.',
    falta: '¿Qué día falta?',
    cole: '¿Hay cole o es fin de semana?',
    hayCole: '¡Hay cole!',
    finde: '¡Fin de semana!',
    // «¿Qué toca?»: las preguntas de la rutina (vacío sin rutina) y el emoji de su botón
    toca: (FAMILIA.rutina && FAMILIA.rutina.preguntas) || [],
    emojiToca: (FAMILIA.rutina && FAMILIA.rutina.emoji) || '📌',
  };

  // ---------- Teatro en inglés (js/teatro.js; el guion, en js/teatro-guion.js) ----------
  // Aquí solo las instrucciones en español: lo que se dice en inglés va aparte (audio/teatro/).
  const teatro = {
    escucha: 'Escucha al lobo.',
    ahoraTu: '¡Ahora tú!',
    sopla: '¡Sopla muy fuerte!',
    ensayo: 'Escucha a los cerditos y di la frase del lobo.',
    queDice: '¿Qué dice ahora el lobo?',
    funcion: '¡Bravo, qué función!',
  };

  // ---------- Comunes ----------
  const comun = {
    quien: '¿Quién va a jugar?',
    aQueJugamos: '¿A qué jugamos?',
    comoTeLlamas: '¿Cómo te llamas?',
    cuantosAnos: '¿Cuántos años tienes?',
    animo: ['¡Uy! Prueba otra vez.', '¡Casi! Inténtalo otra vez.'],
  };

  // Todas las frases que hay que convertir en audio.
  function listaFrases() {
    const f = [comun.quien, comun.aQueJugamos, comun.comoTeLlamas, comun.cuantosAnos, ...comun.animo];
    f.push(bienvenida(null), ...felicitaciones(null));
    Object.keys(PERFILES_CON_VOZ).forEach((id) => f.push(bienvenida(id), ...felicitaciones(id)));
    f.push(trazar.intro);
    [...'0123456789', ...ORDEN_LETRAS].forEach((c) => f.push(trazar.empezar(c), trazar.fin(c)));
    f.push(sonidos.intro);
    Object.entries(PALABRAS_INICIO).forEach(([letra, lista]) => {
      f.push(FONEMA[letra]);
      lista.forEach(([palabra]) => f.push(palabra, sonidos.pregunta(palabra), sonidos.acierto(palabra, letra)));
    });
    f.push(silabas.intro);
    SILABAS.forEach((s) => f.push(s, silabas.pregunta(s)));
    f.push(palabras.intro);
    PALABRAS.forEach((w) => f.push(palabras.pregunta(w.p), palabras.fin(w.p), ...w.s));
    f.push(silabas.introEscribir);
    SILABAS.forEach((s) => f.push(silabas.escribir(s)));
    f.push(contar.intro, contar.pregunta);
    NUMEROS.slice(1, 6).forEach((n) => f.push(n));
    f.push(colores.intro);
    COLORES.forEach((c) => f.push(colores.pregunta(c.id), colores.acierto(c.id)));
    f.push(...DIAS.map(dias.nombre), dias.todos, dias.hoyEs, dias.mananaEs, dias.tren, dias.falta,
      dias.cole, dias.hayCole, dias.finde, ...dias.toca.map((t) => t.pregunta));
    f.push(letras.intro);
    LETRAS_PEQUES.forEach((c) => f.push(letras.pregunta(c)));
    f.push(...Object.values(teatro));
    return [...new Set(f)];
  }

  // Audios que suenan mal sueltos (sonidos de letras y sílabas aisladas): el juego no
  // los reproduce hasta que se regeneren. En una frase completa sí suenan bien.
  const AUDIO_BLOQUEADO = [...new Set([
    ...Object.values(FONEMA), ...SILABAS, ...PALABRAS.flatMap((w) => w.s),
  ])];

  const CONTENIDO = {
    AUDIO_BLOQUEADO,
    PERFILES_CON_VOZ, felicitaciones, bienvenida,
    NUMEROS, NOMBRE_LETRA, ORDEN_LETRAS, trazar,
    FONEMA, NIVELES, PALABRAS_INICIO, sonidos,
    CONSONANTES, VOCALES, SILABAS, silabas,
    PALABRAS, palabras, comun, listaFrases,
    DIAS, dias, VIDEO_DIAS,
    EDAD_PEQUES, contar, COLORES, colores, LETRAS_PEQUES, letras,
    teatro,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CONTENIDO;
  else root.CONTENIDO = CONTENIDO;
})(typeof window !== 'undefined' ? window : globalThis);
