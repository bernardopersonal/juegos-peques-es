(function () {
  const C = window.CONTENIDO;
  const TEMAS = window.TEMAS;
  const { hablar } = window.Voz;
  const $ = (s) => document.querySelector(s);
  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const barajar = (lista) => lista.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  // ¿Es k una clave propia de o? (lo guardado puede llegar de la copia en la nube: «__proto__», «constructor»...)
  const propia = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const temaDe = (id) => (propia(TEMAS, id) ? TEMAS[id] : TEMAS.divertido);

  // ---------- Guardado local (en este dispositivo, si el navegador lo permite) ----------
  // Si el navegador no deja guardar (almacenamiento bloqueado o lleno), se guarda en memoria:
  // así las estrellas y las partidas regaladas valen al menos mientras la página siga abierta.
  // Cada cambio se avisa a la copia en la nube (js/nube.js), que lo sube unos segundos después si está puesta.
  const memoria = new Map();
  const avisarNube = (k) => { if (window.Nube) window.Nube.cambio(k); };
  const guardado = {
    leer(k, def) {
      if (memoria.has(k)) return memoria.get(k) ?? def;
      try { return JSON.parse(localStorage.getItem('jp-' + k)) ?? def; } catch { return def; }
    },
    escribir(k, v) {
      let ok = true;
      try { localStorage.setItem('jp-' + k, JSON.stringify(v)); memoria.delete(k); pedirPersistencia(); } catch { memoria.set(k, v); ok = false; }
      avisarNube(k);
      return ok;
    },
    borrar(k) { memoria.delete(k); try { localStorage.removeItem('jp-' + k); } catch { /* nada */ } avisarNube(k); },
    // Lo que hay guardado (sin el «jp-»), también lo que solo está en memoria: para la copia en la nube
    claves() {
      const r = new Set(memoria.keys());
      try {
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('jp-')) r.add(k.slice(3)); }
      } catch { /* sin almacenamiento */ }
      return [...r];
    },
  };
  // La primera vez que se guarda algo, se pide al navegador que no lo borre por su cuenta (cuando le
  // falta espacio o, en Safari, tras unos días sin abrir la web). Puede decir que no o no saber: se
  // sigue guardando igual. Una vez por página; si ya lo tiene, no lo vuelve a pedir.
  let persistenciaPedida = false;
  function pedirPersistencia() {
    if (persistenciaPedida) return;
    persistenciaPedida = true;
    try {
      const s = navigator.storage;
      if (!s || typeof s.persist !== 'function') return;
      Promise.resolve(typeof s.persisted === 'function' ? s.persisted() : false)
        .then((ya) => ya || s.persist())
        .catch(() => { /* nada */ });
    } catch { /* nada */ }
  }

  // ---------- Perfiles ----------
  // Los niños con voz propia vienen de PERFILES_CON_VOZ (js/familia.js); sus cambios (foto, tema...) se
  // guardan encima. Los demás perfiles se crean desde "+ Otro niño" ("+ Nuevo jugador" si aún no hay ninguno).
  function cargarPerfiles() {
    const guardados = guardado.leer('perfiles', {});
    const lista = Object.entries(C.PERFILES_CON_VOZ).map(([id, p]) => ({
      id, nombre: p.nombre, edad: p.edad, tema: p.tema, emoji: p.emoji, foto: null, conVoz: true,
      ...(guardados[id] || {}),
    }));
    Object.values(guardados).forEach((p) => { if (!C.PERFILES_CON_VOZ[p.id]) lista.push({ ...p, conVoz: false }); });
    return lista;
  }
  let perfiles = cargarPerfiles();
  let perfil = null; // el que está jugando

  function guardarPerfil(p) {
    const guardados = guardado.leer('perfiles', {});
    const { conVoz, ...datos } = p;
    const fotoAntes = (guardados[p.id] && guardados[p.id].foto) || null;
    guardados[p.id] = datos;
    if (!guardado.escribir('perfiles', guardados) && p.foto) {
      // Si no cabe la foto nueva, se guarda con la que tenía (o sin foto): con la copia en la nube, guardarla
      // sin foto la borraría en todos los aparatos
      guardados[p.id] = { ...datos, foto: fotoAntes };
      guardado.escribir('perfiles', guardados);
    }
    perfiles = cargarPerfiles();
  }
  function borrarPerfil(id) {
    const guardados = guardado.leer('perfiles', {});
    delete guardados[id];
    guardado.escribir('perfiles', guardados);
    ['estrellas', 'trazados', 'nivel', 'letra', ...CLAVES_BATALLA, ...CLAVES_TEATRO].forEach((k) => guardado.borrar(k + '-' + id));
    perfiles = cargarPerfiles();
  }
  const dato = (k, def) => guardado.leer(k + '-' + perfil.id, def);
  const guardarDato = (k, v) => guardado.escribir(k + '-' + perfil.id, v);

  // ---------- Tipo de letra: ABC (mayúsculas) / abc (minúsculas) / Abc (mixto) ----------
  // Se recuerda por niño. Los valores internos (respuestas, audios) no cambian: solo cómo se ven.
  const MODOS_LETRA = { mayus: 'ABC', minus: 'abc', mixto: 'Abc' };
  const SIGUIENTE_LETRA = { mayus: 'minus', minus: 'mixto', mixto: 'mayus' };
  const NOMBRE_MODO_LETRA = { mayus: 'mayúsculas', minus: 'minúsculas', mixto: 'mayúscula y minúsculas' };
  function modoLetra() {
    const m = perfil ? dato('letra', 'mayus') : 'mayus';
    return propia(MODOS_LETRA, m) ? m : 'mayus';
  }
  // Cómo se escribe en pantalla un texto según el modo.
  // Mixto: primera letra mayúscula y el resto minúscula (inicial: false → todo minúscula);
  // una letra suelta se enseña en pareja: "M m", separadas por un espacio fino
  // (juntas, "Ll" se lee como la elle de "Llama").
  const ESPACIO_FINO = ' ';
  function comoLetra(texto, { inicial = true } = {}) {
    const t = String(texto);
    const modo = modoLetra();
    if (modo === 'mayus') return t.toUpperCase();
    const min = t.toLowerCase();
    if (modo === 'minus' || !inicial) return min;
    if (min.length === 1 && min !== min.toUpperCase()) return min.toUpperCase() + ESPACIO_FINO + min;
    return min.charAt(0).toUpperCase() + min.slice(1);
  }
  // ¿Hay trazos para este carácter? (las minúsculas se van añadiendo en js/trazos.js)
  const tieneGlifo = (c) => { const g = window.Trazos.glifo(c); return !!(g && g.length); };
  // Carácter que se traza según el modo: en minúsculas, la minúscula (si ya tiene trazos);
  // en mayúsculas y en mixto (un carácter suelto), la mayúscula. Los números no cambian.
  function casoTrazo(c) {
    const min = c.toLowerCase();
    return modoLetra() === 'minus' && tieneGlifo(min) ? min : c.toUpperCase();
  }
  // Pone un texto "para leer" en un elemento y lo apunta para repintarlo si cambia el tipo de letra.
  // Solo toca el primer nodo de texto, así no se pierden los hijos (el 🔊 de las fichas).
  function letrero(el, texto, { inicial = true } = {}) {
    el.dataset.letra = texto;
    if (!inicial) el.dataset.inicial = 'no';
    pintarLetrero(el);
    return el;
  }
  function pintarLetrero(el) {
    const s = comoLetra(el.dataset.letra, { inicial: el.dataset.inicial !== 'no' });
    const n = el.firstChild;
    if (n && n.nodeType === Node.TEXT_NODE) n.nodeValue = s;
    else el.insertBefore(document.createTextNode(s), n);
    el.classList.toggle('pareja', el.dataset.letra.length === 1 && s.length > 1); // "M m"
    el.classList.toggle('minus', s.length === 1 && s !== s.toUpperCase()); // una minúscula suelta: algo más grande
    el.classList.toggle('caps', s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase()); // "MIÉRCOLES"
  }

  function pintarAvatar(caja, p) {
    caja.innerHTML = '';
    if (p.foto) {
      const img = document.createElement('img');
      img.src = p.foto;
      img.alt = '';
      caja.appendChild(img);
    } else caja.textContent = p.emoji || '🙂';
  }

  // ---------- Temas ----------
  function aplicarTema(t) {
    const r = document.documentElement;
    ['fondo', 'tinta', 'tarjeta', 'guia', 'c1', 'c2', 'c3', 'c4', 'acento'].forEach((k) => r.style.setProperty('--' + k, t[k]));
    r.classList.toggle('oscuro', !!t.oscuro);
    [...r.classList].filter((c) => c.startsWith('tema-')).forEach((c) => r.classList.remove(c));
    if (t.clase) r.classList.add(t.clase);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = t.fondo;
    const deco = $('#deco');
    deco.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.textContent = t.deco[i % t.deco.length];
      s.style.left = ((i * 37) % 100) + 'vw';
      s.style.top = ((i * 61 + 7) % 100) + 'vh';
      s.style.animationDelay = -i * 0.7 + 's';
      deco.appendChild(s);
    }
    temaActual = t;
  }
  let temaActual = window.TEMA_INICIO;

  // ---------- Navegación ----------
  const PADRE = {
    perfil: 'inicio', menu: 'inicio', elegir: 'menu', trazar: 'elegir', juego: 'menu', minijuegos: 'menu', batalla: 'minijuegos',
    tablet: 'minijuegos', sala: 'minijuegos', teatro: 'menu',
  };
  let vista = 'inicio';
  // Doble toque de un niño: el 2.º toque caería en lo que haya debajo en la pantalla nueva (un animal en
  // Unirme, Crear partida...). Un rato después de cambiar de pantalla, los clicks no cuentan (los controles
  // de la partida van con pointerdown: no les afecta)
  let calmaHasta = 0;
  document.addEventListener('click', (ev) => {
    if (performance.now() < calmaHasta) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);

  function ir(destino) {
    if (destino !== vista) calmaHasta = performance.now() + 450;
    if (destino !== 'batalla') pararBatalla(); // al salir de la partida, se para (y se quita del todo)
    if (destino !== 'batalla' && destino !== 'sala') cerrarRed(); // 1 contra 1 en red: fuera de la sala y de la partida, se sale
    if (destino !== 'teatro' && window.Teatro) window.Teatro.cerrar(); // al salir del teatro: sin sonido, sin micro y sin grabaciones
    vista = destino;
    document.body.classList.toggle('en-batalla', destino === 'batalla');
    document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.id !== 'v-' + destino));
    $('#btn-atras').hidden = destino === 'inicio';
    if (destino === 'inicio') {
      perfil = null;
      aplicarTema(window.TEMA_INICIO);
      pintarPerfiles();
    }
    const enJuego = !!perfil && destino !== 'perfil';
    $('#avatar-mini').hidden = !enJuego;
    if (enJuego) pintarAvatar($('#avatar-mini'), perfil);
    $('#titulo').textContent =
      destino === 'inicio' ? 'Juegos peques'
        : destino === 'perfil' ? (editando && editando.nombre ? editando.nombre : 'Nuevo jugador')
          : perfil.nombre;
    pintarEstrellas();
    pintarBtnLetra();
    if (destino === 'elegir') pintarRejillas(); // con el tipo de letra de ahora y las letras ya hechas
    if (destino === 'menu') { pintarTarjetaBatalla(); pintarTarjetaTeatro(); } // partidas que quedan (cambian al ganar estrellas)
    if (destino === 'minijuegos') pintarMinijuegos();
    if (destino === 'tablet') pintarTablet();
    if (destino === 'sala') pintarSala();
    window.scrollTo(0, 0);
    if (destino === 'trazar') ajustarLienzo();
  }
  $('#btn-atras').addEventListener('click', () => {
    // En mitad de una partida de Batalla, antes de salir se pregunta (en la propia página)
    if (vista === 'batalla' && batalla && batalla.enCurso()) { pedirSalirBatalla(); return; }
    ronda++;
    limpiarTrazadores();
    ir(PADRE[vista]);
  });

  // Botón ABC → abc → Abc (solo mientras juega un niño)
  function pintarBtnLetra() {
    const b = $('#btn-letra');
    b.hidden = !perfil || !['menu', 'elegir', 'trazar', 'juego'].includes(vista);
    if (b.hidden) return;
    const m = modoLetra();
    b.textContent = MODOS_LETRA[m];
    // El nombre accesible empieza por lo que se ve (ABC / abc / Abc): así se encuentra también por voz
    b.setAttribute('aria-label', MODOS_LETRA[m] + ': letra en ' + NOMBRE_MODO_LETRA[m] + '. Toca para cambiar.');
  }
  $('#btn-letra').addEventListener('click', () => {
    if (!perfil) return;
    guardarDato('letra', SIGUIENTE_LETRA[modoLetra()]);
    pintarBtnLetra();
    repintarLetras();
  });
  // Repinta la pantalla actual con el nuevo tipo de letra, sin empezar otra ronda.
  function repintarLetras() {
    if (vista === 'elegir') pintarRejillas();
    else if (vista === 'trazar' && actual) {
      const nuevo = casoTrazo(actual);
      if (nuevo !== actual) { actual = nuevo; principal.cargar(nuevo); } // se llama igual: no hace falta volver a decirlo
    } else if (vista === 'juego') {
      if (juego === 'silabas' && modoSilabas() === 'escribir') rehacerEscritura();
      else document.querySelectorAll('#v-juego [data-letra]').forEach(pintarLetrero);
    }
  }

  // ---------- Estrellas y fiesta ----------
  function pintarEstrellas() {
    const e = $('#estrellas');
    e.hidden = !perfil || vista === 'perfil';
    if (!e.hidden) e.querySelector('b').textContent = dato('estrellas', 0);
  }
  function ganarEstrella(n = 1) {
    guardarDato('estrellas', dato('estrellas', 0) + n);
    pintarEstrellas();
  }
  function fiesta() {
    const caja = $('#fiesta');
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      s.textContent = azar(temaActual.fiesta);
      s.style.left = Math.random() * 100 + 'vw';
      s.style.animationDelay = Math.random() * 0.5 + 's';
      caja.appendChild(s);
      setTimeout(() => s.remove(), 2400);
    }
  }
  let ctxAudio;
  function pip(frec = 660) {
    try {
      ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctxAudio.createOscillator();
      const g = ctxAudio.createGain();
      o.frequency.value = frec;
      g.gain.setValueAtTime(0.15, ctxAudio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctxAudio.currentTime + 0.25);
      o.connect(g).connect(ctxAudio.destination);
      o.start();
      o.stop(ctxAudio.currentTime + 0.25);
    } catch { /* sin sonido */ }
  }
  // Felicitación: con nombre solo para los perfiles con voz (los que tienen audio con su nombre)
  const bravo = () => azar(C.felicitaciones(perfil.id));

  // =====================================================
  // INICIO: ¿QUIÉN JUEGA?
  // =====================================================
  function pintarPerfiles() {
    const caja = $('#perfiles');
    caja.innerHTML = '';
    perfiles.forEach((p) => {
      const t = temaDe(p.tema);
      const el = document.createElement('div');
      el.className = 'perfil';
      el.innerHTML = '<button class="entrar"><span class="avatar"></span><span class="nombre"></span></button>' +
        '<button class="editar" aria-label="Cambiar foto o tema">✏️</button>';
      const entrar = el.querySelector('.entrar');
      entrar.style.background = t.c1;
      pintarAvatar(el.querySelector('.avatar'), p);
      el.querySelector('.nombre').textContent = p.nombre;
      entrar.addEventListener('click', () => elegirPerfil(p));
      el.querySelector('.editar').addEventListener('click', () => abrirFormulario(p));
      caja.appendChild(el);
    });
    const nuevo = document.createElement('div');
    nuevo.className = 'perfil nuevo';
    nuevo.innerHTML = '<button class="entrar"><span class="avatar">➕</span></button>';
    nuevo.querySelector('.entrar').append(perfiles.length ? 'Otro niño' : 'Nuevo jugador');
    nuevo.querySelector('.entrar').addEventListener('click', () => abrirFormulario(null));
    caja.appendChild(nuevo);
  }

  async function elegirPerfil(p) {
    perfil = p;
    aplicarTema(temaDe(p.tema));
    prepararMenu();
    ir('menu');
    await hablar(C.bienvenida(p.id));
    if (perfil === p && vista === 'menu') hablar(C.comun.aQueJugamos);
  }

  // =====================================================
  // CREAR / EDITAR PERFIL
  // =====================================================
  const EMOJIS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦁', '🐵', '🐰', '🦋', '🦖', '🦄', '🐙', '🐯', '🐨', '🚀', '⚽', '👑', '🚗'];
  let editando = null;

  function abrirFormulario(p) {
    const esNuevo = !p;
    editando = p ? { ...p } : { id: 'p' + Date.now(), nombre: '', edad: null, tema: 'divertido', emoji: azar(EMOJIS), foto: null, conVoz: false };
    $('#pf-nombre').value = editando.nombre;
    $('#pf-nombre').disabled = editando.conVoz; // el nombre de los perfiles con voz va unido a sus audios
    $('#pf-borrar').hidden = esNuevo || editando.conVoz;
    $('#pf-confirmar').hidden = true;
    $('#pf-guardar').textContent = esNuevo ? '¡A jugar!' : 'Guardar';
    pintarFormulario();
    ir('perfil');
    if (esNuevo) hablar(C.comun.comoTeLlamas).then(() => $('#pf-nombre').focus());
  }

  function pintarFormulario() {
    aplicarTema(temaDe(editando.tema));
    pintarAvatar($('#pf-avatar'), editando);

    const edades = $('#pf-edades');
    edades.innerHTML = '';
    for (let e = 2; e <= 10; e++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (editando.edad === e ? ' activo' : '');
      b.textContent = e;
      b.addEventListener('click', () => { editando.edad = e; pintarFormulario(); });
      edades.appendChild(b);
    }

    const emojis = $('#pf-emojis');
    emojis.querySelectorAll('button').forEach((b) => b.remove());
    $('.chip-foto').classList.toggle('activo', !!editando.foto);
    EMOJIS.forEach((em) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (!editando.foto && editando.emoji === em ? ' activo' : '');
      b.textContent = em;
      b.addEventListener('click', () => { editando.emoji = em; editando.foto = null; pintarFormulario(); });
      emojis.appendChild(b);
    });

    const temas = $('#pf-temas');
    temas.innerHTML = '';
    Object.entries(TEMAS).forEach(([id, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tema' + (editando.tema === id ? ' activo' : '');
      b.style.background = t.fondo;
      b.style.color = t.tinta;
      b.innerHTML = '<span class="emoji"></span><span></span>';
      b.firstChild.textContent = t.emoji;
      b.lastChild.textContent = t.nombre;
      b.addEventListener('click', () => { editando.tema = id; pintarFormulario(); });
      temas.appendChild(b);
    });
  }

  // Foto: se recorta en cuadrado de 256 px y se guarda solo en este dispositivo
  $('#pf-foto').addEventListener('change', (ev) => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      cv.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      editando.foto = cv.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(img.src);
      pintarFormulario();
    };
    img.src = URL.createObjectURL(archivo);
    ev.target.value = '';
  });

  $('#form-perfil').addEventListener('submit', (ev) => {
    ev.preventDefault();
    editando.nombre = editando.conVoz ? editando.nombre : $('#pf-nombre').value.trim();
    if (!editando.nombre) { $('#pf-nombre').focus(); hablar(C.comun.comoTeLlamas); return; }
    if (!editando.edad) { $('#pf-edades').scrollIntoView({ block: 'center' }); hablar(C.comun.cuantosAnos); return; }
    guardarPerfil(editando);
    const p = perfiles.find((x) => x.id === editando.id);
    editando = null;
    elegirPerfil(p);
  });
  $('#pf-borrar').addEventListener('click', () => { $('#pf-confirmar').hidden = false; });
  $('#pf-borrar-no').addEventListener('click', () => { $('#pf-confirmar').hidden = true; });
  $('#pf-borrar-si').addEventListener('click', () => { borrarPerfil(editando.id); editando = null; ir('inicio'); });

  // =====================================================
  // MENÚ DE JUEGOS (según la edad)
  // =====================================================
  const JUEGOS = {
    trazar: { emoji: '✏️', nombre: 'Trazar' },
    contar: { emoji: '🔢', nombre: 'Contar' },
    colores: { emoji: '🎨', nombre: 'Colores' },
    letras: { emoji: '🔤', nombre: 'Letras' },
    sonidos: { emoji: '👂', nombre: 'Sonidos' },
    silabas: { emoji: '🧩', nombre: 'Sílabas' },
    palabras: { emoji: '📖', nombre: 'Palabras' },
    dias: { emoji: '🚂', nombre: 'Días de la semana' },
    teatro: { emoji: '🐺', nombre: 'Teatro', obra: 'The Three Little Pigs' },
    batalla: { emoji: '🎮', nombre: 'Batalla' },
  };
  const esPeque = () => perfil.edad <= C.EDAD_PEQUES;

  function prepararMenu() {
    // Mayores: Días y Teatro arriba, la mitad de la fila cada una (con un index.html o un teatro.js viejos, sin Teatro)
    const conTeatro = !esPeque() && !!window.Teatro && !!$('#v-teatro');
    const lista = esPeque() ? ['trazar', 'contar', 'colores', 'letras']
      : ['dias', ...(conTeatro ? ['teatro'] : []), 'trazar', 'sonidos', 'silabas', 'palabras'];
    const caja = $('#juegos');
    caja.classList.toggle('peques', esPeque());
    caja.innerHTML = '';
    // El minijuego (premio), para los dos menús: al final, debajo del nivel de los juegos de aprender
    $('#juegos-premio').replaceChildren(crearTarjetaBatalla());
    let k = 0; // los colores t1-t4, en orden, de las tarjetas normales
    lista.forEach((id) => {
      if (id === 'teatro') { caja.appendChild(crearTarjetaTeatro()); return; }
      const b = document.createElement('button');
      const ancha = esPeque() ? id === 'trazar' : id === 'dias' && !conTeatro;
      const media = id === 'dias' && conTeatro;
      b.className = 'tarjeta ' + (id === 'dias' ? 'tarjeta-dias' : 't' + ((k++ % 4) + 1)) + (ancha ? ' ancha' : '') + (media ? ' media' : '');
      b.innerHTML = '<span class="emoji"></span><span></span>';
      b.firstChild.textContent = JUEGOS[id].emoji;
      b.lastChild.textContent = JUEGOS[id].nombre;
      b.addEventListener('click', () => abrirJuego(id));
      caja.appendChild(b);
    });
    $('#nivel-caja').hidden = esPeque();
    if (!esPeque()) pintarNiveles();
  }
  function nivelActual() {
    const def = perfil.edad >= 7 ? 1 : 0, n = dato('nivel', def);
    return Number.isInteger(n) && n >= 0 && n < C.NIVELES.length ? n : def;
  }
  function pintarNiveles() {
    const caja = $('#niveles');
    caja.innerHTML = '';
    C.NIVELES.forEach((n, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === nivelActual() ? ' activo' : '');
      b.textContent = i + 1 + '. ' + n.nombre;
      b.addEventListener('click', () => { guardarDato('nivel', i); pintarNiveles(); });
      caja.appendChild(b);
    });
  }

  async function abrirJuego(id) {
    if (id === 'batalla') { abrirMinijuegos(); return; }
    if (id === 'teatro') { abrirTeatro(); return; }
    if (id === 'trazar') {
      ir('elegir');
      hablar(C.trazar.intro);
      return;
    }
    juego = id;
    ir('juego');
    if (id === 'dias' && C.VIDEO_DIAS && !dato('video-dias-visto', false)) {
      guardarDato('video-dias-visto', true);
      abrirIntro(C.VIDEO_DIAS); // la primera vez, el vídeo de los días (si js/familia.js trae uno)
    }
    pintarModos();
    const r = ++ronda;
    limpiarTrazadores();
    $('#escena').innerHTML = '';
    $('#opciones').innerHTML = '';
    if (introJuego()) await hablar(introJuego());
    if (r === ronda) nuevaRonda();
  }
  function introJuego() {
    if (juego === 'silabas' && modoSilabas() === 'escribir') return C.silabas.introEscribir;
    if (juego === 'dias') return null;
    return C[juego].intro;
  }

  // =====================================================
  // TRAZADOR: motor de trazado (Trazar y escribir sílabas)
  // modo 'completo': guía + bolita siempre (Trazar)
  // modo 'guia':     letra clarita; la bolita sale con la pista
  // modo 'oculto':   hoja en blanco; con la pista sale la letra y la bolita
  // =====================================================
  // La letra se da por buena en cuanto se acaba su último trazo. Cada trazo se sigue en orden, y vale
  // empezarlo en cualquiera de sus 5 primeros puntos (los peques no siempre aciertan con la bolita).
  // Sin guía, la letra se coloca a lo ancho donde el niño empieza a escribirla.
  const ESPERA_PISTA = 5000; // ms sin avanzar antes de enseñar la pista
  // Con pauta, la letra va de y=10 (b, d, l...) a y=94 (rabito de g, p, q...) y la guía tiene 15 de grueso:
  // se dibuja todo al 90 % y centrado para que no se corte contra el borde del lienzo.
  const MARGEN_PAUTA = { s: 0.9, dx: 5, dy: 3.2 };
  // Mezcla dos colores #rrggbb (p = cuánto del segundo)
  function mezclar(a, b, p) {
    const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const A = rgb(a), B = rgb(b);
    return '#' + A.map((v, i) => Math.round(v * (1 - p) + B[i] * p).toString(16).padStart(2, '0')).join('');
  }
  let trazadores = [];
  function limpiarTrazadores() { trazadores.forEach((t) => t.destruir()); trazadores = []; }

  class Trazador {
    constructor(lienzo, opciones = {}) {
      this.cv = lienzo;
      this.ctx = lienzo.getContext('2d');
      this.op = opciones;
      this.activo = true;
      this.T = null;
      // Los dedos que tocan ahora el lienzo (pointerId → su tinta, último punto y recorrido): cada uno va por su
      // cuenta, así la palma o un segundo dedo no cortan el trazo del que dibuja ni le pintan una raya hasta él
      this.dedos = new Map();
      lienzo.addEventListener('pointerdown', (ev) => this.abajo(ev));
      lienzo.addEventListener('pointermove', (ev) => this.mover(ev));
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((e) => lienzo.addEventListener(e, (ev) => this.arriba(ev)));
    }
    get modo() { return this.op.modo || 'completo'; }
    // Tolerancia en unidades de la cuadrícula. Sin guía, las minúsculas (la mitad de altas) con menos:
    // con 16 una raya hacía la 'e' o la 's'.
    get tol() {
      if (this.modo === 'oculto' && this.T && window.Trazos.esMinuscula(this.T.c)) return 11;
      return { completo: 12, guia: 13, oculto: 16 }[this.modo];
    }
    cargar(c) {
      // pauta: true = siempre (Escribir); 'auto' = solo con las minúsculas (Trazar)
      const pauta = this.op.pauta === 'auto' ? window.Trazos.esMinuscula(c) : !!this.op.pauta;
      const trazos = window.Trazos.glifo(c, { pauta }) || window.Trazos.glifo(c.toUpperCase(), { pauta });
      const guias = trazos.map((t) => window.Trazos.puntos(t));
      const xs = guias.flat().map((q) => q[0]);
      this.T = {
        c, pauta, i: 0, j: 0, tinta: [], fin: false,
        dx: 0, // sin guía: cuánto a la derecha (o izquierda) ha empezado el niño la letra
        ult: null, // sin guía: dónde levantó el dedo tras un trazo de verdad (para seguir desde ahí)
        xmin: Math.min(...xs), xmax: Math.max(...xs),
        guias,
        ctrl: trazos.map((t) => window.Trazos.controles(t)),
      };
      this.dedos.clear();
      this.conPista = this.modo === 'completo';
      this.reloj();
      this.dibujar();
    }
    activar(si) { this.activo = si; this.reloj(); this.dibujar(); }
    pista() { this.conPista = true; clearTimeout(this._reloj); this.dibujar(); }
    reloj() {
      clearTimeout(this._reloj);
      if (this.activo && this.T && !this.T.fin && !this.conPista) this._reloj = setTimeout(() => this.pista(), ESPERA_PISTA);
    }
    destruir() { clearTimeout(this._reloj); this.T = null; }
    ajustar() {
      const r = this.cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.cv.width = Math.round(r.width * dpr);
      this.cv.height = Math.round(r.height * dpr);
      this.dibujar();
    }
    camino(pts, hasta = pts.length) {
      const k = this.cv.width / 100;
      const ctx = this.ctx;
      ctx.beginPath();
      pts.slice(0, hasta).forEach(([x, y], n) => (n ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      if (Math.min(hasta, pts.length) === 1) ctx.lineTo(pts[0][0] * k + 0.01, pts[0][1] * k); // un punto (el de la i): que se vea
    }
    // Pauta de 4 líneas del cuaderno: arriba y abajo suaves, la de la x discontinua, la base más marcada
    pintarPauta() {
      const { asc, x, base, desc } = window.Trazos.LINEAS;
      const ctx = this.ctx;
      const k = this.cv.width / 100;
      const linea = (y, alfa, grosor, discontinua) => {
        ctx.globalAlpha = alfa;
        ctx.lineWidth = grosor * k;
        ctx.setLineDash(discontinua ? [2.5 * k, 2 * k] : []);
        ctx.beginPath(); ctx.moveTo(4 * k, y * k); ctx.lineTo(96 * k, y * k); ctx.stroke();
      };
      ctx.save();
      ctx.strokeStyle = temaActual.tinta;
      ctx.lineCap = 'butt';
      linea(asc, 0.16, 0.6);
      linea(desc, 0.16, 0.6);
      linea(x, 0.3, 0.7, true);
      linea(base, this.modo === 'completo' ? 0.5 : 0.35, 1.1);
      ctx.restore();
    }
    dibujar() {
      const T = this.T;
      const ctx = this.ctx;
      const k = this.cv.width / 100;
      const t = temaActual;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      if (!T) return;
      if (T.pauta) ctx.setTransform(MARGEN_PAUTA.s, 0, 0, MARGEN_PAUTA.s, MARGEN_PAUTA.dx * k, MARGEN_PAUTA.dy * k);
      ctx.lineCap = ctx.lineJoin = 'round';
      const modo = this.modo;

      if (T.pauta) this.pintarPauta();

      // Sin guía, la letra (pista, avance y letra terminada) va donde la empezó el niño
      ctx.save();
      if (T.dx) ctx.translate(T.dx * k, 0);
      const verGuia = modo !== 'oculto' || this.conPista || T.fin;
      if (verGuia) {
        // Con guía (Escribir): un tono más fuerte que el de Trazar y opaco, para que se vea por encima
        // de la pauta y no salgan manchas donde se juntan los trazos. En Trazar, con pauta (minúsculas),
        // algo más fuerte también: si no, la línea base destaca más que la letra (sobre todo en Espacio).
        const colorGuia = modo === 'completo' ? (T.pauta ? mezclar(t.guia, t.tinta, 0.2) : t.guia) : mezclar(t.guia, t.tinta, 0.35);
        // Las minúsculas son la mitad de altas: guía más fina para que no se cierren el ojo de la e o la s
        const grosorGuia = window.Trazos.esMinuscula(T.c) ? 12 : 15;
        T.guias.forEach((g) => {
          this.camino(g); ctx.strokeStyle = colorGuia; ctx.lineWidth = grosorGuia * k; ctx.stroke();
        });
        T.guias.forEach((g) => {
          if (modo !== 'oculto' || this.conPista) {
            this.camino(g); ctx.setLineDash([2 * k, 3 * k]); ctx.strokeStyle = t.tinta; ctx.globalAlpha = 0.3;
            ctx.lineWidth = 1.2 * k; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
          }
        });
      }

      T.ctrl.forEach((cp, n) => {
        const hasta = n < T.i ? cp.length : n === T.i ? T.j : 0;
        if (hasta > 1 || (hasta === 1 && cp.length === 1)) { this.camino(cp, hasta); ctx.strokeStyle = t.acento; ctx.lineWidth = 11 * k; ctx.stroke(); }
      });
      ctx.restore();

      // La tinta, donde ha pasado el dedo de verdad
      ctx.strokeStyle = t.c2; ctx.globalAlpha = 0.45; ctx.lineWidth = 4 * k;
      T.tinta.forEach((tr) => { this.camino(tr); ctx.stroke(); });
      ctx.globalAlpha = 1;

      if (T.fin || !this.activo || !this.conPista) return;

      // Bolita que marca por dónde seguir, con una flecha con palo: se lee bien en cualquier dirección
      // (un triángulo solo, en diagonal, parece apuntar a otro lado)
      const cp = T.ctrl[T.i];
      const [x, y] = cp[Math.min(T.j, cp.length - 1)];
      const [nx, ny] = cp[Math.min(T.j + 3, cp.length - 1)];
      ctx.save();
      if (T.dx) ctx.translate(T.dx * k, 0);
      ctx.fillStyle = '#3fbf7f';
      ctx.beginPath(); ctx.arc(x * k, y * k, 6.5 * k, 0, Math.PI * 2); ctx.fill();
      if (nx !== x || ny !== y) {
        ctx.translate(x * k, y * k); ctx.rotate(Math.atan2(ny - y, nx - x));
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(4.8 * k, 0);
        ctx.lineTo(0.6 * k, -3.6 * k); ctx.lineTo(0.6 * k, -1.3 * k); ctx.lineTo(-4 * k, -1.3 * k);
        ctx.lineTo(-4 * k, 1.3 * k); ctx.lineTo(0.6 * k, 1.3 * k); ctx.lineTo(0.6 * k, 3.6 * k);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    punto(ev) {
      const r = this.cv.getBoundingClientRect();
      const p = [((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100];
      if (!this.T || !this.T.pauta) return p;
      const { s, dx, dy } = MARGEN_PAUTA; // de la pantalla a la cuadrícula
      return [(p[0] - dx) / s, (p[1] - dy) / s];
    }
    // Sin guía no se ve dónde va la letra a lo ancho (la altura ya la marca la pauta):
    // la letra se coloca donde el niño empieza el primer trazo, si empieza a la altura de la salida,
    // en cualquier sitio del recuadro (sin que la letra se salga).
    anclar(p) {
      const T = this.T;
      const c0 = T.ctrl[0][0];
      if (Math.abs(p[1] - c0[1]) >= this.tol) return 0;
      return Math.max(2 - T.xmin, Math.min(98 - T.xmax, p[0] - c0[0]));
    }
    // Sin guía, con el primer trazo a medias: ¿vuelve a poner el dedo donde lo levantó (o en la bolita de la
    // pista), más cerca de ahí que de la salida? Entonces sigue la letra; si no, la empieza otra vez.
    // T.ult solo lo deja un trazo de verdad (8 o más de recorrido): un toque suelto no se encadena con otro.
    sigue(p) {
      const T = this.T;
      if (!T.j || !T.ult) return false;
      const cp = T.ctrl[0];
      const dist = (q, dx = 0) => Math.hypot(p[0] - dx - q[0], p[1] - q[1]);
      let cerca = dist(T.ult);
      if (this.conPista) cerca = Math.min(cerca, dist(cp[Math.min(T.j, cp.length - 1)], T.dx));
      return cerca < this.tol && cerca < dist(cp[0], T.dx);
    }
    // ¿Hay otro dedo dibujando (no solo apoyado)?
    dibujando() { return [...this.dedos.values()].some((d) => d.largo >= 8); }
    avanzar(p) {
      const T = this.T;
      if (T.dx) p = [p[0] - T.dx, p[1]];
      const cp = T.ctrl[T.i];
      const antes = T.j;
      // Sin guía, la letra empieza por la salida del primer trazo: un toque suelto en otro sitio no cuenta
      if (this.modo === 'oculto' && T.i === 0 && T.j === 0 && Math.hypot(p[0] - cp[0][0], p[1] - cp[0][1]) >= this.tol) return;
      // En orden, mirando los 5 puntos siguientes: así también vale empezar un poco por delante de la bolita
      for (let n = T.j; n < Math.min(T.j + 5, cp.length); n++) {
        if (Math.hypot(p[0] - cp[n][0], p[1] - cp[n][1]) < this.tol) T.j = n + 1;
      }
      if (T.j !== antes) this.reloj();
      if (T.j < cp.length) return;
      T.i++; T.j = 0;
      if (T.i >= T.ctrl.length) {
        T.fin = true; T.tinta = [];
        clearTimeout(this._reloj);
        this.dibujar();
        if (this.op.alTerminar) this.op.alTerminar(T.c);
        return;
      }
      pip(660);
      // La n, la m, la u... se pueden seguir sin levantar el dedo; los puntos de la i y la j, con un toque aparte
      if (T.ctrl[T.i].length <= 2) this.dedos.clear();
    }
    abajo(ev) {
      const T = this.T;
      if (!T || T.fin || !this.activo) return;
      try { this.cv.setPointerCapture(ev.pointerId); } catch (e) { /* ese dedo ya no está */ }
      const p = this.punto(ev);
      // Sin guía, hasta acabar el primer trazo, poner el dedo empieza la letra otra vez, colocada donde lo pone
      // (un toque perdido o un falso comienzo no estorban); salvo si sigue por donde iba o si otro dedo está
      // dibujando (entonces este es la palma o un dedo de más: no borra nada)
      if (this.modo === 'oculto' && T.i === 0 && !this.dibujando() && !this.sigue(p)) {
        T.j = 0; T.dx = this.anclar(p); T.ult = null;
      }
      this.dedos.set(ev.pointerId, { k: T.tinta.push([p]) - 1, p, largo: 0 });
      this.avanzar(p);
      this.dibujar();
    }
    mover(ev) {
      const T = this.T;
      const d = this.dedos.get(ev.pointerId);
      if (!T || T.fin || !d) return;
      const p = this.punto(ev);
      d.largo += Math.hypot(p[0] - d.p[0], p[1] - d.p[1]);
      d.p = p;
      T.tinta[d.k].push(p);
      this.avanzar(p);
      this.dibujar();
    }
    arriba(ev) {
      const d = this.dedos.get(ev.pointerId);
      if (!d) return;
      this.dedos.delete(ev.pointerId);
      if (this.T && d.largo >= 8) this.T.ult = d.p; // por si vuelve a poner el dedo ahí (sigue())
    }
  }

  // =====================================================
  // TRAZAR (números y letras)
  // =====================================================
  const DIGITOS = [...'0123456789'];
  // Qué letras se ven según el modo: ABC → mayúsculas; abc → minúsculas; Abc → las dos.
  // Las minúsculas van en el mismo orden (a e i o u m p l s...) y solo las que ya tienen trazos.
  // (Si aún no hay ninguna minúscula, se enseñan las mayúsculas.)
  function letrasTrazar() {
    const modo = modoLetra();
    const minus = C.ORDEN_LETRAS.map((c) => c.toLowerCase()).filter(tieneGlifo);
    const verMinus = modo !== 'mayus' && minus.length > 0;
    return { mayus: modo !== 'minus' || !verMinus ? C.ORDEN_LETRAS : [], minus: verMinus ? minus : [] };
  }
  // Orden del botón ➡️: el de lo que se ve en la rejilla
  function secuenciaTrazar() {
    const { mayus, minus } = letrasTrazar();
    return [...DIGITOS, ...mayus, ...minus];
  }

  function pintarRejillas() {
    const hechos = new Set(dato('trazados', [])); // por carácter: la 'm' y la 'M' son distintas
    const crear = (caja, titulo, lista) => {
      caja.innerHTML = '';
      caja.hidden = !lista.length;
      if (titulo) titulo.hidden = !lista.length;
      lista.forEach((c) => {
        const b = document.createElement('button');
        b.textContent = c;
        if (hechos.has(c)) b.classList.add('hecho');
        b.addEventListener('click', () => empezarTrazo(c));
        caja.appendChild(b);
      });
    };
    const { mayus, minus } = letrasTrazar();
    crear($('#rejilla-numeros'), null, DIGITOS);
    crear($('#rejilla-letras'), $('#titulo-mayus'), mayus);
    crear($('#rejilla-minus'), $('#titulo-minus'), minus);
  }

  const principal = new Trazador($('#lienzo'), { modo: 'completo', pauta: 'auto', alTerminar: terminarTrazo });
  let actual = null; // carácter que se está trazando

  function empezarTrazo(c) {
    actual = c;
    ir('trazar');
    principal.cargar(c);
    hablar(C.trazar.empezar(c));
  }
  function ajustarLienzo() { principal.ajustar(); }
  window.addEventListener('resize', () => {
    if (vista === 'trazar') principal.ajustar();
    trazadores.forEach((t) => t.ajustar());
    if (vista === 'minijuegos') pintarHeroes(); // el tamaño de los dibujos depende de la pantalla
    if (vista === 'tablet') pintarTablet();
    if (vista === 'sala') pintarSala();
    if (vista === 'menu') { pintarTarjetaBatalla(); pintarTarjetaTeatro(); }
  });

  async function terminarTrazo(c) {
    pip(880);
    const hechos = new Set(dato('trazados', []));
    hechos.add(c);
    guardarDato('trazados', [...hechos]);
    ganarEstrella();
    fiesta();
    principal.dibujar();
    await hablar(C.trazar.fin(c));
    if (actual !== c || vista !== 'trazar') return;
    await esperar(250);
    if (actual === c && vista === 'trazar') hablar(bravo()); // puede haberse ido mientras tanto
  }

  $('#trazar-oir').addEventListener('click', () => actual && hablar(principal.T && principal.T.fin ? C.trazar.fin(actual) : C.trazar.empezar(actual)));
  $('#trazar-borrar').addEventListener('click', () => actual && empezarTrazo(actual));
  $('#trazar-sig').addEventListener('click', () => {
    if (!actual) return;
    const sec = secuenciaTrazar();
    let i = sec.indexOf(actual);
    if (i < 0) i = sec.indexOf(casoTrazo(actual)); // por si se cambió el tipo de letra (P → p)
    empezarTrazo(sec[(i + 1) % sec.length]);
  });

  // =====================================================
  // JUEGOS CON RONDAS
  // =====================================================
  const CONS_NIVEL = [['m'], ['m', 'p'], ['m', 'p', 'l', 's', 't']];
  let ronda = 0; // para cancelar rondas viejas
  let repetir = () => {};
  let juego = null;
  let anterior = null;

  $('#juego-oir').addEventListener('click', () => repetir());
  $('#juego-pista').addEventListener('click', () => {
    const t = trazadores.find((x) => x.activo && x.T && !x.T.fin);
    if (t) t.pista();
  });

  // Sílabas: Buscar / Escribir y con / sin guía (se recuerda por niño)
  const modoSilabas = () => dato('modo-silabas', 'buscar');
  const conGuia = () => dato('guia', true);
  function pintarModos() {
    $('#modos-dias').hidden = juego !== 'dias';
    document.querySelectorAll('[data-dias]').forEach((b) => b.classList.toggle('activo', b.dataset.dias === modoDias()));
    const enSilabas = juego === 'silabas';
    $('#modos').hidden = !enSilabas;
    const escribir = enSilabas && modoSilabas() === 'escribir';
    document.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('activo', enSilabas && b.dataset.modo === modoSilabas()));
    $('#btn-guia').hidden = !escribir;
    $('#btn-guia').textContent = conGuia() ? '✅ Con guía' : '⬜ Sin guía';
    $('#juego-pista').hidden = !escribir;
  }
  document.querySelectorAll('[data-modo]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (modoSilabas() === b.dataset.modo) return;
      guardarDato('modo-silabas', b.dataset.modo);
      abrirJuego('silabas');
    })
  );
  $('#btn-guia').addEventListener('click', () => {
    guardarDato('guia', !conGuia());
    pintarModos();
    nuevaRonda();
  });

  // texto = valor interno (la respuesta se compara con él, no con lo que se ve)
  function ficha(texto, alOir, { inicial = true } = {}) {
    const b = document.createElement('button');
    b.className = 'ficha';
    letrero(b, texto, { inicial });
    if (alOir) {
      const o = document.createElement('span');
      o.className = 'oir';
      o.textContent = '🔊';
      o.addEventListener('click', (ev) => { ev.stopPropagation(); alOir(); });
      b.appendChild(o);
    }
    return b;
  }

  function sinRepetir(lista) {
    const opciones = lista.length > 1 ? lista.filter((x) => x !== anterior) : lista;
    anterior = azar(opciones);
    return anterior;
  }
  // La respuesta correcta y dos más, mezcladas
  const conOtras = (meta, lista, n = 2) => barajar([meta, ...barajar(lista.filter((x) => x !== meta)).slice(0, n)]);

  async function acierto(r, ...frases) {
    pip(880);
    ganarEstrella();
    fiesta();
    for (const [i, f] of frases.entries()) {
      if (i) await esperar(350);
      await hablar(f);
      if (r !== ronda) return;
    }
    await esperar(500);
    if (r === ronda && vista === 'juego') nuevaRonda();
  }
  function fallo(b) {
    b.classList.remove('mal');
    void b.offsetWidth;
    b.classList.add('mal');
    pip(220);
    hablar(azar(C.comun.animo));
  }

  function nuevaRonda() {
    const r = ++ronda;
    limpiarTrazadores();
    const escena = $('#escena');
    const opciones = $('#opciones');
    escena.innerHTML = '';
    opciones.innerHTML = '';
    const ronda_ = { r, escena, opciones };
    ({ sonidos: rondaSonidos, silabas: modoSilabas() === 'escribir' ? rondaEscribir : rondaBuscar, palabras: rondaPalabras,
      contar: rondaContar, colores: rondaColores, letras: rondaLetras, dias: rondaDias })[juego](ronda_);
    repetir();
  }

  // ---------- Sonidos ----------
  function rondaSonidos({ r, escena, opciones }) {
    const letras = C.NIVELES[nivelActual()].letras;
    const letra = sinRepetir(letras);
    const [palabra, emoji] = azar(C.PALABRAS_INICIO[letra]);
    escena.innerHTML = '<div class="dibujo"></div>';
    escena.firstChild.textContent = emoji;
    conOtras(letra, letras).forEach((l) => {
      const b = ficha(l);
      b.addEventListener('click', () => {
        if (l === letra) { b.classList.add('bien'); acierto(r, C.sonidos.acierto(palabra, letra)); }
        else fallo(b);
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.sonidos.pregunta(palabra));
  }

  // ---------- Sílabas: buscar ----------
  const silabasNivel = () => C.SILABAS.filter((s) => CONS_NIVEL[nivelActual()].includes(s[0]));
  function rondaBuscar({ r, escena, opciones }) {
    const posibles = silabasNivel();
    const meta = sinRepetir(posibles);
    const misma = barajar(posibles.filter((s) => s[0] === meta[0] && s !== meta))[0];
    const otra = barajar(C.SILABAS.filter((s) => s !== meta && s !== misma && s[1] === meta[1]))[0]
      || barajar(C.SILABAS.filter((s) => s !== meta && s !== misma))[0];
    escena.innerHTML = '<div class="dibujo">👂</div>';
    barajar([meta, misma, otra]).forEach((s) => {
      const b = ficha(s, () => hablar(C.silabas.pregunta(s)));
      b.addEventListener('click', () => {
        if (s === meta) { b.classList.add('bien'); acierto(r, bravo()); }
        else fallo(b);
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.silabas.pregunta(meta));
  }

  // ---------- Sílabas: escribir ----------
  // Cada letra en su recuadro con la pauta de 4 líneas: MA / ma / Ma según el tipo de letra.
  // (Si alguna minúscula aún no tiene trazos, la sílaba entera va en mayúsculas.)
  let escribiendo = null; // sílaba de la ronda (para repintarla si cambia el tipo de letra)
  function rondaEscribir({ r, escena }, meta = sinRepetir(silabasNivel())) {
    escribiendo = meta;
    let letras = [...comoLetra(meta)];
    if (!letras.every(tieneGlifo)) letras = [...meta.toUpperCase()];
    const modo = conGuia() ? 'guia' : 'oculto';
    escena.innerHTML = '<div class="cuaderno"></div>';
    const cuaderno = escena.firstChild;
    const cajas = letras.map((L, i) => {
      const caja = document.createElement('div');
      caja.className = 'lienzo-caja' + (i === 0 ? ' activa' : ' espera');
      const cv = document.createElement('canvas');
      caja.appendChild(cv);
      cuaderno.appendChild(caja);
      const tz = new Trazador(cv, {
        modo, pauta: true,
        alTerminar: async () => {
          pip(880);
          caja.classList.remove('activa');
          tz.dibujar();
          const siguiente = cajas[i + 1];
          if (siguiente) {
            siguiente.caja.classList.remove('espera');
            siguiente.caja.classList.add('activa');
            siguiente.tz.activar(true);
            hablar(C.FONEMA[L.toLowerCase()]);
          } else {
            await hablar(C.FONEMA[L.toLowerCase()]);
            if (r !== ronda) return;
            await esperar(500);
            if (r === ronda) acierto(r, meta, bravo());
          }
        },
      });
      tz.activo = i === 0;
      trazadores.push(tz);
      return { caja, tz, L };
    });
    requestAnimationFrame(() => cajas.forEach((c) => { c.tz.ajustar(); c.tz.cargar(c.L); }));
    repetir = () => hablar(C.silabas.escribir(meta));
  }
  // La misma sílaba otra vez, con el nuevo tipo de letra (sin volver a decirla)
  function rehacerEscritura() {
    if (!escribiendo || !$('#escena .cuaderno')) return; // la ronda aún no ha empezado: ya saldrá con la letra nueva
    if (trazadores.length && trazadores.every((t) => t.T && t.T.fin)) return; // ya está escrita: la siguiente saldrá con la letra nueva
    const r = ++ronda;
    limpiarTrazadores();
    $('#escena').innerHTML = '';
    $('#opciones').innerHTML = '';
    rondaEscribir({ r, escena: $('#escena'), opciones: $('#opciones') }, escribiendo);
  }

  // ---------- Palabras ----------
  function rondaPalabras({ r, escena, opciones }) {
    const posibles = nivelActual() < 2 ? C.PALABRAS.filter((w) => w.s.length === 2) : C.PALABRAS;
    const w = sinRepetir(posibles);
    escena.innerHTML = '<div class="dibujo"></div><div class="huecos"></div>';
    escena.querySelector('.dibujo').textContent = w.e;
    const huecos = escena.querySelector('.huecos');
    w.s.forEach(() => { const h = document.createElement('div'); h.className = 'hueco'; huecos.appendChild(h); });
    const extra = azar(C.SILABAS.filter((s) => !w.s.includes(s)));
    let pos = 0;
    // En mixto solo la primera sílaba de la palabra lleva mayúscula: "Pa" + "to" (y la de despiste, en minúscula)
    barajar([...w.s.map((s, i) => [s, i === 0]), [extra, false]]).forEach(([s, inicial]) => {
      const b = ficha(s, null, { inicial });
      b.addEventListener('click', async () => {
        if (pos >= w.s.length) return;
        if (s !== w.s[pos]) return fallo(b);
        b.classList.add('usada');
        const h = huecos.children[pos];
        letrero(h, s, { inicial: pos === 0 });
        h.classList.add('lleno');
        pos++;
        pip(660);
        await hablar(s);
        if (pos === w.s.length && r === ronda) {
          // Hueco para que el niño la diga, y luego la palabra entera
          await esperar(1000);
          if (r === ronda) acierto(r, C.palabras.fin(w.p), bravo());
        }
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.palabras.pregunta(w.p));
  }

  // ---------- Peques: contar ----------
  function rondaContar({ r, escena, opciones }) {
    const n = sinRepetir([1, 2, 3, 4, 5]);
    const cosa = azar(temaActual.deco.filter((e) => e !== '☁️'));
    escena.innerHTML = '<div class="monton"></div>';
    const monton = escena.firstChild;
    let contadas = 0;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.className = 'cosa';
      b.textContent = cosa;
      b.addEventListener('click', () => {
        if (b.classList.contains('contada')) return;
        contadas++;
        b.classList.add('contada');
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = contadas;
        b.appendChild(num);
        hablar(C.NUMEROS[contadas]);
      });
      monton.appendChild(b);
    }
    conOtras(n, [1, 2, 3, 4, 5]).forEach((x) => {
      const b = ficha(x);
      b.addEventListener('click', () => {
        if (x === n) { b.classList.add('bien'); acierto(r, C.trazar.fin(String(n)), bravo()); }
        else fallo(b);
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.contar.pregunta);
  }

  // ---------- Peques: colores ----------
  function rondaColores({ r, escena, opciones }) {
    const meta = sinRepetir(C.COLORES);
    escena.innerHTML = '<div class="bote">🎨</div>';
    conOtras(meta, C.COLORES).forEach((c) => {
      const b = document.createElement('button');
      b.className = 'color';
      b.style.background = c.hex;
      b.setAttribute('aria-label', c.id);
      b.addEventListener('click', () => {
        if (c === meta) { b.classList.add('bien'); acierto(r, C.colores.acierto(c.id), bravo()); }
        else fallo(b);
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.colores.pregunta(meta.id));
  }

  // ---------- Peques: ¿dónde está la letra? ----------
  function rondaLetras({ r, escena, opciones }) {
    const meta = sinRepetir(C.LETRAS_PEQUES);
    escena.innerHTML = '<div class="dibujo">🔍</div>';
    conOtras(meta, C.LETRAS_PEQUES).forEach((c) => {
      const b = ficha(c);
      b.addEventListener('click', () => {
        if (c === meta) { b.classList.add('bien'); acierto(r, C.trazar.fin(c), bravo()); }
        else fallo(b);
      });
      opciones.appendChild(b);
    });
    repetir = () => hablar(C.letras.pregunta(meta));
  }

  // =====================================================
  // DÍAS DE LA SEMANA (con la rutina de js/familia.js, si la trae)
  // =====================================================
  const D = C.DIAS;
  const nombreDia = (i) => C.dias.nombre(D[(i + 7) % 7]);
  const hayRutina = C.dias.toca.length > 0;
  const modoDias = () => { const m = dato('modo-dias', 'hoy'); return !['hoy', 'tren', 'falta', 'cole', 'toca'].includes(m) || (m === 'toca' && !hayRutina) ? 'hoy' : m; };
  // Sin rutina no hay «¿Qué toca?»; sin vídeo de los días, no hay 🎬
  $('[data-dias="toca"]').hidden = !hayRutina;
  $('[data-dias="toca"]').textContent = C.dias.emojiToca + ' ¿Qué toca?';
  $('#btn-video-dias').hidden = !C.VIDEO_DIAS;
  document.querySelectorAll('[data-dias]').forEach((b) =>
    b.addEventListener('click', () => { guardarDato('modo-dias', b.dataset.dias); pintarModos(); nuevaRonda(); })
  );
  // Dice varias frases seguidas con una pausa; null = silencio (el hueco de "¿qué falta?")
  async function decir(r, ...frases) {
    for (const [i, f] of frases.entries()) {
      if (r !== ronda) return;
      if (i) await esperar(300);
      if (f === null) await esperar(700);
      else await hablar(f);
    }
  }
  function vagon(i, { oir = false, clase = '' } = {}) {
    const d = D[(i + 7) % 7];
    const b = document.createElement('button');
    b.className = 'vagon ' + clase;
    b.style.setProperty('--c', d.color);
    b.dataset.dia = (i + 7) % 7;
    b.innerHTML = '<span class="ico"></span><span class="nom"></span><span class="ruedas"></span>';
    b.querySelector('.ico').textContent = d.emoji;
    letrero(b.querySelector('.nom'), d.nombre);
    if (oir) {
      const o = document.createElement('span');
      o.className = 'oir';
      o.textContent = '🔊';
      o.addEventListener('click', (ev) => { ev.stopPropagation(); hablar(C.dias.nombre(d)); });
      b.appendChild(o);
    }
    return b;
  }
  const hueco = (texto = '') => {
    const h = document.createElement('div');
    h.className = 'vagon hueco-vagon';
    h.textContent = texto;
    return h;
  };
  const locomotora = () => {
    const l = document.createElement('div');
    l.className = 'locomotora';
    l.textContent = '🚂';
    return l;
  };
  const hoyIndice = () => (new Date().getDay() + 6) % 7; // lunes = 0

  function rondaDias(args) {
    ({ hoy: diasHoy, tren: diasTren, falta: diasFalta, cole: diasCole, toca: diasToca })[modoDias()](args);
  }

  // 📅 Hoy es… mañana es…
  function diasHoy({ r, escena, opciones }) {
    const h = hoyIndice();
    escena.innerHTML = '<div class="hoy"><div class="hoy-col"><b></b></div><div class="hoy-col manana"><b></b></div></div>';
    const [colHoy, colMan] = escena.querySelectorAll('.hoy-col');
    letrero(colHoy.firstChild, 'hoy');
    letrero(colMan.firstChild, 'mañana');
    colHoy.appendChild(vagon(h, { clase: 'grande' }));
    colMan.appendChild(vagon(h + 1));
    const etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta-cole';
    etiqueta.append(D[h].cole ? '🏫 ' : '🎉 ', letrero(document.createElement('span'), D[h].cole ? 'Hay cole' : 'Fin de semana'));
    colHoy.appendChild(etiqueta);
    const b = document.createElement('button');
    b.className = 'btn-principal';
    b.textContent = '🚂 ¡A jugar con el tren!';
    b.addEventListener('click', () => { guardarDato('modo-dias', 'tren'); pintarModos(); nuevaRonda(); });
    opciones.appendChild(b);
    repetir = () => decir(r, C.dias.hoyEs, nombreDia(h), C.dias.mananaEs, nombreDia(h + 1));
  }

  // 🚂 Ordena los 7 vagones
  function diasTren({ r, escena, opciones }) {
    escena.innerHTML = '<div class="tren"></div>';
    const tren = escena.firstChild;
    tren.appendChild(locomotora());
    const huecos = D.map(() => tren.appendChild(hueco()));
    huecos[0].classList.add('siguiente');
    let pos = 0;
    barajar(D.map((_, i) => i)).forEach((i) => {
      const v = vagon(i, { oir: true });
      v.addEventListener('click', async () => {
        if (pos >= 7) return;
        if (i !== pos) return fallo(v);
        v.classList.add('usada');
        huecos[pos].replaceWith(vagon(i, { clase: 'puesto' }));
        pos++;
        if (huecos[pos]) huecos[pos].classList.add('siguiente');
        pip(660);
        await hablar(nombreDia(i));
        if (pos === 7 && r === ronda) {
          tren.classList.add('arranca');
          acierto(r, C.dias.todos, bravo());
        }
      });
      opciones.appendChild(v);
    });
    repetir = () => hablar(C.dias.tren);
  }

  // ❓ ¿Qué día falta? (la semana da la vuelta: después del domingo, lunes)
  function diasFalta({ r, escena, opciones }) {
    const inicio = sinRepetir([0, 1, 2, 3, 4, 5, 6]);
    const k = azar([1, 1, 2]); // casi siempre falta el del medio
    const meta = (inicio + k) % 7;
    escena.innerHTML = '<div class="tren"></div>';
    const tren = escena.firstChild;
    tren.appendChild(locomotora());
    const piezas = [0, 1, 2].map((j) => tren.appendChild(j === k ? hueco('?') : vagon(inicio + j, { clase: 'puesto' })));
    conOtras(meta, D.map((_, i) => i)).forEach((i) => {
      const v = vagon(i, { oir: true });
      v.addEventListener('click', () => {
        if (i !== meta) return fallo(v);
        piezas[k].replaceWith(vagon(i, { clase: 'puesto' }));
        v.classList.add('bien');
        acierto(r, nombreDia(i), bravo());
      });
      opciones.appendChild(v);
    });
    repetir = () => decir(r, C.dias.falta, ...[0, 1, 2].map((j) => (j === k ? null : nombreDia(inicio + j))));
  }

  // 🏫 ¿Cole o fin de semana?
  function diasCole({ r, escena, opciones }) {
    const i = sinRepetir([0, 1, 2, 3, 4, 5, 6, 5, 6]); // salen más los del fin de semana
    escena.appendChild(vagon(i, { oir: true, clase: 'grande' }));
    [['cole', '🏫', 'Hay cole', true], ['finde', '🎉', 'Fin de semana', false]].forEach(([id, emoji, texto, esCole]) => {
      const b = document.createElement('button');
      b.className = 'tarjeta respuesta-cole ' + id;
      b.innerHTML = '<span class="emoji"></span><span></span>';
      b.firstChild.textContent = emoji;
      letrero(b.lastChild, texto);
      b.addEventListener('click', () => {
        if (D[i].cole !== esCole) return fallo(b);
        b.classList.add('bien');
        acierto(r, D[i].cole ? C.dias.hayCole : C.dias.finde, bravo());
      });
      opciones.appendChild(b);
    });
    repetir = () => decir(r, nombreDia(i), C.dias.cole);
  }

  // ¿Qué día toca…? (la rutina de la familia)
  function diasToca({ r, escena, opciones }) {
    const t = sinRepetir(C.dias.toca);
    escena.innerHTML = '<div class="dibujo"></div>';
    escena.firstChild.textContent = D[t.dias[0]].emoji;
    const encontrados = new Set();
    D.forEach((_, i) => {
      const v = vagon(i, { oir: true });
      v.addEventListener('click', () => {
        if (encontrados.has(i)) return;
        if (!t.dias.includes(i)) return fallo(v);
        encontrados.add(i);
        v.classList.add('bien');
        if (encontrados.size === t.dias.length) acierto(r, ...t.dias.map(nombreDia), bravo());
        else { pip(660); hablar(nombreDia(i)); }
      });
      opciones.appendChild(v);
    });
    repetir = () => hablar(t.pregunta);
  }

  // =====================================================
  // TEATRO EN INGLÉS (js/teatro.js): The Three Little Pigs, para los mayores
  // El juego va en js/teatro.js; aquí, la tarjeta del menú, la pantalla y las estrellas que da (cuentan para la
  // Batalla como las demás: ⭐ por frase repetida, la primera vez en el día; ⭐⭐⭐ al acabar el ensayo; ⭐ por
  // acierto a la primera en «¿Qué viene ahora?»). Lo que guarda es del niño (CLAVES_TEATRO); las grabaciones, no.
  // =====================================================
  const CLAVES_TEATRO = ['teatro-acento', 'teatro-modo', 'teatro-escena', 'teatro-dia'];
  function crearTarjetaTeatro() {
    const b = document.createElement('button');
    b.className = 'tarjeta tarjeta-teatro media';
    b.innerHTML = '<canvas class="tj-sprite tj-lobo" aria-hidden="true"></canvas>' +
      '<span class="tj-texto"><span class="tj-nombre"><span class="emoji"></span><span></span></span><span class="tj-obra" lang="en"></span></span>' +
      '<canvas class="tj-sprite tj-cerdito" aria-hidden="true"></canvas>';
    b.querySelector('.emoji').textContent = JUEGOS.teatro.emoji;
    b.querySelector('.tj-nombre').lastChild.textContent = JUEGOS.teatro.nombre;
    b.querySelector('.tj-obra').textContent = JUEGOS.teatro.obra;
    b.setAttribute('aria-label', JUEGOS.teatro.nombre + ': ' + JUEGOS.teatro.obra);
    b.addEventListener('click', () => abrirJuego('teatro'));
    return b;
  }
  // El lobo y un cerdito pintados con los sprites (como los de la Batalla)
  function pintarTarjetaTeatro() {
    const b = $('#juegos .tarjeta-teatro');
    if (!b || !perfil) return;
    const esc = window.innerWidth < 500 ? 2 : 3;
    pintarSprite(b.querySelector('.tj-lobo'), 'lobo_cabeza', esc);
    pintarSprite(b.querySelector('.tj-cerdito'), 'cerdito1', esc);
  }
  function abrirTeatro() {
    if (!window.Teatro) return;
    ir('teatro');
    const ok = window.Teatro.abrir({
      dato, guardarDato, ganarEstrella, hablar, bravo, fiesta, pip,
      animo: () => azar(C.comun.animo),
      frases: C.teatro || {},
      avatar: (el) => { if (el && perfil) pintarAvatar(el, perfil); },
    });
    if (!ok) ir('menu');
  }

  // =====================================================
  // BATALLA DE BLOQUES (minijuego: js/minijuegos/*.js)
  // Se desbloquea con estrellas: cada 5 ⭐ de los juegos de aprender = 1 partida.
  // Partidas = floor(estrellas / 5) + regaladas − usadas (todo por niño). Empezar un nivel gasta 1.
  // Los padres pueden regalar partidas o dejarlo "libre hoy" (candado: una multiplicación).
  // Ganar en el minijuego no da estrellas. Sin frases nuevas: texto en pantalla y sonidos 8-bit.
  // 1 contra 1 (docs/DUELO.md, sección E): Steve contra Alex en esta tablet o en red con un código de
  // 4 animales. Cada duelo (y cada revancha) gasta 1 partida a cada jugador en su aparato; en la
  // tablet, al perfil abierto.
  // =====================================================
  const ESTRELLAS_PARTIDA = 5;
  const CLAVES_BATALLA = ['batalla-usadas', 'batalla-regalo', 'batalla-libre', 'batalla-nivel', 'batalla-heroe', 'batalla-modo'];
  const HEROES = { steve: 'Steve', alex: 'Alex' };
  const hoyTexto = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const numero = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const plural = (n, una, varias) => n + ' ' + (n === 1 ? una : varias);
  // Con el verbo también en singular o plural: "Te queda 1 partida" / "Te faltan 3 ⭐"
  const teQuedan = (n) => (n === 1 ? 'Te queda ' : 'Te quedan ') + plural(n, 'partida', 'partidas');
  const teFaltan = (n) => (n === 1 ? 'Te falta ' : 'Te faltan ') + n + ' ⭐';

  function partidas() {
    const estrellas = numero(dato('estrellas', 0));
    const usadas = numero(dato('batalla-usadas', 0));
    const regalo = numero(dato('batalla-regalo', 0));
    const libre = dato('batalla-libre', null) === hoyTexto(); // hasta las 23:59 de hoy
    const quedan = Math.max(0, Math.floor(estrellas / ESTRELLAS_PARTIDA) + regalo - usadas);
    const faltan = quedan > 0 ? 0 : Math.max(1, ESTRELLAS_PARTIDA * (usadas - regalo + 1) - estrellas);
    return { estrellas, libre, quedan, faltan, puede: libre || quedan > 0 };
  }
  function gastarPartida() {
    const p = partidas();
    if (p.libre) return true; // "Libre hoy": no gasta
    if (p.quedan <= 0) return false;
    guardarDato('batalla-usadas', numero(dato('batalla-usadas', 0)) + 1);
    return true;
  }
  const nivelMaxBatalla = () => Math.max(1, numero(dato('batalla-nivel', 1)));
  const heroeBatalla = () => (propia(HEROES, dato('batalla-heroe', 'steve')) ? dato('batalla-heroe', 'steve') : 'steve');
  const otroHeroe = (h) => (h === 'alex' ? 'steve' : 'alex');
  // ¿Contra quién? 'monstruos' o 'duelo' (1 contra 1). Se recuerda por niño.
  const contraBatalla = () => (dato('batalla-modo', 'monstruos') === 'duelo' ? 'duelo' : 'monstruos');
  const clic = () => { try { if (window.Sfx) window.Sfx.click(); } catch { /* sin sonido */ } };
  // La línea de partidas del cartel del final (monstruos y 1 contra 1)
  const textoPartidasFin = (p) => (p.libre ? '∞ Hoy, partidas libres' : p.quedan > 0 ? teQuedan(p.quedan)
    : '🔒 ' + teFaltan(p.faltan) + ' para otra partida');

  // Un sprite del minijuego en un canvas, a escala entera (píxeles nítidos). Sin Sprites, no pinta nada.
  function pintarSprite(cv, nombre, escala, op = {}) {
    const S = window.Sprites;
    if (!S || typeof S.dibujar !== 'function') { cv.hidden = true; return; }
    const { w, h } = S.tam(nombre);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const e = escala * dpr;
    cv.width = Math.round((w + 2) * e); // +1 px de arte a cada lado: el contorno
    cv.height = Math.round((h + 2) * e);
    cv.style.width = (w + 2) * escala + 'px';
    cv.style.height = (h + 2) * escala + 'px';
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    S.dibujar(g, nombre, e, e, e, op);
  }

  // ---------- Tarjeta del menú ----------
  function crearTarjetaBatalla() {
    const b = document.createElement('button');
    b.className = 'tarjeta tarjeta-batalla ancha';
    b.innerHTML = '<canvas class="tj-sprite tj-heroe" aria-hidden="true"></canvas>' +
      '<span class="tj-texto"><span class="tj-nombre"><span class="emoji"></span><span></span></span><span class="insignia"></span></span>' +
      '<canvas class="tj-sprite tj-monstruo" aria-hidden="true"></canvas>';
    b.querySelector('.emoji').textContent = JUEGOS.batalla.emoji;
    b.querySelector('.tj-nombre').lastChild.textContent = JUEGOS.batalla.nombre;
    b.addEventListener('click', () => abrirJuego('batalla'));
    return b;
  }
  function textoInsignia(p) {
    if (p.libre) return '∞ Libre hoy';
    if (p.quedan > 0) return '▶ ' + plural(p.quedan, 'partida', 'partidas');
    return '🔒 ' + teFaltan(p.faltan);
  }
  function pintarTarjetaBatalla() {
    const b = $('#juegos-premio .tarjeta-batalla');
    if (!b || !perfil) return;
    const p = partidas();
    b.querySelector('.insignia').textContent = textoInsignia(p);
    b.classList.toggle('bloqueada', !p.puede);
    b.classList.toggle('libre', p.libre);
    b.setAttribute('aria-label', 'Batalla: ' + textoInsignia(p).replace(/^\W+\s*/, ''));
    const esc = window.innerHeight <= 1100 ? 3 : window.innerWidth < 500 ? 4 : 5; // más bajita si la pantalla no es muy alta (ver estilos.css)

    pintarSprite(b.querySelector('.tj-heroe'), heroeBatalla(), esc);
    pintarSprite(b.querySelector('.tj-monstruo'), 'creeper', esc, { voltear: true });
  }

  // ---------- Antes de jugar: héroe y nivel ----------
  let nivelElegido = 1;
  function abrirMinijuegos() {
    nivelElegido = nivelMaxBatalla(); // el último desbloqueado (se puede elegir otro)
    ir('minijuegos');
  }
  function pintarMinijuegos() {
    if (!perfil) return;
    const p = partidas();
    $('#mj-estado').textContent = p.libre ? '∞ Hoy puedes jugar todo lo que quieras'
      : p.quedan > 0 ? 'Tienes ' + plural(p.quedan, 'partida', 'partidas')
        : '🔒 ' + teFaltan(p.faltan) + ' para jugar';
    // Las 5 estrellas de la próxima partida: las que ya tiene, encendidas.
    // Solo cuando no le quedan partidas (con partidas, 5 estrellas apagadas parecerían "no tengo").
    const prog = $('#mj-progreso');
    prog.hidden = p.libre || p.quedan > 0;
    prog.innerHTML = '';
    const llenas = Math.max(0, ESTRELLAS_PARTIDA - p.faltan);
    for (let i = 0; i < ESTRELLAS_PARTIDA; i++) {
      const e = document.createElement('span');
      e.textContent = '⭐';
      if (i >= llenas) e.className = 'apagada';
      prog.appendChild(e);
    }
    prog.append(' = ' + JUEGOS.batalla.emoji);
    // ¿Contra quién? Con los monstruos, nivel y ¡A jugar!; en el 1 contra 1, los niveles no hacen falta
    // (con un index.html viejo de la caché, sin el 1 contra 1, solo monstruos)
    const cajaMonstruos = $('#mj-monstruos'), cajaDuelo = $('#mj-duelo');
    const duelo = contraBatalla() === 'duelo' && !!cajaDuelo;
    document.querySelectorAll('[data-contra]').forEach((b) => {
      const si = b.dataset.contra === (duelo ? 'duelo' : 'monstruos');
      b.classList.toggle('activo', si);
      b.setAttribute('aria-pressed', si ? 'true' : 'false');
    });
    if (cajaMonstruos) cajaMonstruos.hidden = duelo;
    if (cajaDuelo) cajaDuelo.hidden = !duelo;
    pintarHeroes();
    if (duelo) { pintarBotonesDuelo(p); return; }
    // Nivel: ◀ N ▶ en una sola fila (los niveles no se acaban: una fila de botones no cabría)
    const max = nivelMaxBatalla();
    nivelElegido = Math.min(Math.max(1, nivelElegido), max);
    $('#mj-nivel-num').textContent = nivelElegido;
    $('#mj-nivel-menos').disabled = nivelElegido <= 1;
    const mas = $('#mj-nivel-mas');
    mas.disabled = nivelElegido >= max; // el siguiente se ve con candado: hay que ganar el anterior
    mas.textContent = nivelElegido >= max ? '🔒' : '▶';
    mas.setAttribute('aria-label', nivelElegido >= max ? 'Nivel ' + (max + 1) + ', bloqueado' : 'Nivel siguiente');
    const jugar = $('#mj-jugar');
    jugar.disabled = !p.puede;
    jugar.textContent = p.puede ? '▶ ¡A jugar!' : '🔒 ' + teFaltan(p.faltan);
  }
  function pintarHeroes() {
    const caja = $('#mj-heroes');
    caja.innerHTML = '';
    // (móvil en vertical no muy alto: más pequeños, para que quepa todo sin desplazar)
    const esc = window.innerHeight < 520 ? 3 : window.innerWidth < 500 ? (window.innerHeight < 760 ? 3 : 4) : window.innerHeight < 700 ? 5 : 6;
    Object.entries(HEROES).forEach(([id, nombre]) => {
      const b = document.createElement('button');
      b.className = 'mj-heroe' + (heroeBatalla() === id ? ' activo' : '');
      b.dataset.heroe = id;
      b.setAttribute('aria-pressed', heroeBatalla() === id ? 'true' : 'false');
      b.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
      b.lastChild.textContent = nombre;
      pintarSprite(b.firstChild, id, esc);
      b.addEventListener('click', () => {
        guardarDato('batalla-heroe', id);
        clic();
        pintarHeroes();
      });
      caja.appendChild(b);
    });
  }
  $('#mj-jugar').addEventListener('click', () => empezarBatalla(nivelElegido));
  $('#mj-nivel-menos').addEventListener('click', () => { nivelElegido--; pintarMinijuegos(); });
  $('#mj-nivel-mas').addEventListener('click', () => { nivelElegido++; pintarMinijuegos(); });
  document.querySelectorAll('[data-contra]').forEach((b) => b.addEventListener('click', () => {
    if (!perfil) return;
    guardarDato('batalla-modo', b.dataset.contra);
    clic();
    pintarMinijuegos();
  }));

  // ---------- 1 contra 1: los tres botones ----------
  // Sin partidas, con candado (y lo que falta debajo). Sin servidor (ping fallido: vista previa, GitHub
  // Pages, sin red...), solo queda «En esta tablet». Mientras se pregunta, los de red esperan apagados.
  let hayRed = null; // ¿se puede jugar en red aquí? (null = aún no se sabe)
  let preguntandoRed = false, relojRed = 0;
  function comprobarRed(forzar) {
    if (!window.Red) { hayRed = false; return; }
    if (preguntandoRed) return;
    preguntandoRed = true;
    window.Red.disponible(forzar).then((ok) => {
      preguntandoRed = false;
      // Un no (la Wi-Fi aún conectando al desbloquear, el hosting lento...) se vuelve a probar al rato,
      // mientras se siga en la pantalla; también al volver la red o la página
      clearTimeout(relojRed);
      if (!ok) relojRed = setTimeout(reprobarRed, 16000);
      if (ok === hayRed) return;
      hayRed = ok;
      if (vista === 'minijuegos') pintarMinijuegos();
    }, () => { preguntandoRed = false; });
  }
  // (solo con los botones del 1 contra 1 a la vista y si aún no se sabe que hay red)
  function reprobarRed() {
    if (vista === 'minijuegos' && perfil && contraBatalla() === 'duelo' && hayRed !== true) comprobarRed(true);
  }
  window.addEventListener('online', reprobarRed);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reprobarRed(); });
  function pintarBotonesDuelo(p) {
    if (hayRed !== true) comprobarRed(); // (el sí se recuerda; el no se vuelve a probar al rato)
    const tablet = $('#mj-tablet'), enRed = [$('#mj-crear'), $('#mj-unirme')];
    [tablet, ...enRed].forEach((b) => {
      b.disabled = !p.puede || (b !== tablet && hayRed !== true);
      b.classList.toggle('bloqueado', !p.puede);
    });
    enRed.forEach((b) => { b.hidden = hayRed === false; });
    $('.mj-dbotones').classList.toggle('solo', hayRed === false); // (solo la tablet: centrada)
    $('#mj-sinred').hidden = hayRed !== false;
    const falta = $('#mj-duelo-falta');
    falta.hidden = p.puede;
    falta.textContent = p.puede ? '' : '🔒 ' + teFaltan(p.faltan);
  }
  // (?.: con un index.html viejo de la caché, sin estos botones, el resto de la app sigue funcionando)
  $('#mj-tablet')?.addEventListener('click', () => abrirTablet());
  $('#mj-crear')?.addEventListener('click', () => abrirCrear());
  $('#mj-unirme')?.addEventListener('click', () => abrirUnirme());

  // ---------- La partida ----------
  let batalla = null; // la partida en marcha ({ detener, reiniciar, enCurso })
  let semillaBatalla = 1;
  const nuevaSemilla = () => 1 + Math.floor(Math.random() * 999999); // un mapa distinto cada vez
  const HUECO_ATRAS = { ancho: 64, alto: 64 }; // donde flota ⬅️ encima del juego (ver estilos.css)

  function empezarBatalla(nivel) {
    if (!window.Batalla || !gastarPartida()) { pintarMinijuegos(); return; }
    try { if (window.Sfx) window.Sfx.activar(); } catch { /* sin sonido */ }
    semillaBatalla = nuevaSemilla();
    ir('batalla');
    batalla = window.Batalla.iniciar($('#batalla-caja'), {
      heroe: heroeBatalla(),
      nivel,
      facil: esPeque(), // los peques (hasta EDAD_PEQUES): los monstruos no hacen daño y se ve toda la trayectoria
      semilla: semillaBatalla,
      hueco: HUECO_ATRAS,
      alTerminar: finBatalla,
      alElegir: elegirFinBatalla,
      infoFin: () => {
        const p = partidas();
        return { texto: textoPartidasFin(p), seguir: p.puede };
      },
    });
  }
  function finBatalla({ gano, nivel }) {
    const quien = perfil;
    if (gano) {
      guardarDato('batalla-nivel', Math.max(nivelMaxBatalla(), nivel + 1)); // desbloquea el siguiente
      nivelElegido = nivel + 1;
    }
    // Solo frases que ya tienen audio: la felicitación o el ánimo de siempre
    setTimeout(() => {
      if (perfil === quien && vista === 'batalla') hablar(gano ? bravo() : azar(C.comun.animo));
    }, 900);
  }
  function elegirFinBatalla({ accion, siguiente }) {
    if (accion === 'salir' || !batalla) { ir('minijuegos'); return; }
    if (!gastarPartida()) { ir('minijuegos'); return; } // sin partidas: ahí se ve lo que falta
    if (accion === 'siguiente') semillaBatalla = nuevaSemilla(); // "Otra vez": el mismo mapa
    nivelElegido = siguiente;
    batalla.reiniciar(siguiente, semillaBatalla);
  }
  function pararBatalla() {
    $('#aviso-salir').hidden = true;
    if (!batalla) return;
    try { batalla.detener(); } catch { /* ya estaba parada */ }
    batalla = null;
  }
  // Mientras se pregunta, la partida se queda en pausa (los monstruos no siguen jugando detrás). En red, no:
  // el reloj del turno (60 s) sigue y el otro no se queda esperando. Al cerrar, solo se reanuda lo que se pausó aquí
  function pausarBatalla(si) { try { if (batalla && batalla.pausar) batalla.pausar(si); } catch { /* nada */ } }
  let pausaSalir = false;
  function pedirSalirBatalla() {
    pausaSalir = !red;
    if (pausaSalir) pausarBatalla(true);
    $('#aviso-salir').hidden = false;
    $('#btn-atras').hidden = true;
    $('#salir-no').focus();
  }
  $('#salir-si').addEventListener('click', () => ir('minijuegos'));
  $('#salir-no').addEventListener('click', () => {
    $('#aviso-salir').hidden = true;
    $('#btn-atras').hidden = false;
    if (pausaSalir) pausarBatalla(false);
    pausaSalir = false;
  });

  // ---------- 1 contra 1: lo común a la tablet y a la red ----------
  function opcionesDuelo(duelo) {
    return { duelo, hueco: HUECO_ATRAS, alTerminar: finDuelo, alElegir: elegirFinDuelo, infoFin: infoFinDuelo };
  }
  // ¿El motor sabe de duelos? Con un batalla.js viejo de la caché, iniciar() ignora el duelo y arranca
  // contra monstruos: entonces se para y no se gasta la partida (se gasta siempre después de comprobarlo)
  const motorDuelo = () => !!(batalla && batalla.duelo === true && typeof batalla.nuevoDuelo === 'function');
  function iniciarDuelo(duelo) {
    ir('batalla');
    batalla = window.Batalla.iniciar($('#batalla-caja'), opcionesDuelo(duelo));
    if (motorDuelo()) return true;
    ir('minijuegos');
    return false;
  }
  function finDuelo(d) {
    const quien = perfil;
    const r = red;
    if (r && !d.tablet) {
      r.fin = true;
      if (r.con) {
        r.con.ritmo('rapido'); // ahora se espera la revancha (o el adiós) del otro
        // Sin partidas para la revancha: el otro lo sabe ya («Steve no puede jugar más hoy»)
        if (!partidas().puede) r.con.enviar('otra', { puede: false, partida: r.partida });
      }
      pintarAvisoRed(r);
    }
    // Solo frases que ya tienen audio. En red, la felicitación con su nombre o el ánimo de siempre;
    // en la tablet, sin nombre (quien gana puede no ser el perfil abierto)
    const frase = d.tablet ? (d.ganador != null ? azar(C.felicitaciones(null)) : null) : d.gano ? bravo() : azar(C.comun.animo);
    setTimeout(() => {
      if (frase && perfil === quien && vista === 'batalla') hablar(frase);
    }, 900);
  }
  // La línea de partidas en el cartel del final; sin partidas (o si el otro ya no está), «Revancha 🔒»
  function infoFinDuelo() {
    const p = partidas();
    const r = red;
    return { texto: textoPartidasFin(p), seguir: p.puede && !(r && (r.ida || r.noPuede)) };
  }
  function elegirFinDuelo({ accion }) {
    if (accion === 'salir' || !motorDuelo()) { ir('minijuegos'); return; }
    if (red) { pedirRevancha(red); return; }
    // En la tablet: otro duelo ya (gasta 1), con otro mapa y empezando cualquiera de los dos
    if (!gastarPartida()) { ir('minijuegos'); return; }
    batalla.nuevoDuelo({ semilla: nuevaSemilla(), empieza: azar([0, 1]) });
  }

  // ---------- 1 contra 1 en esta tablet ----------
  // Tu héroe a la izquierda (el 0) y el otro a la derecha. Cada uno con su 🎯 Ayuda, que solo se ve (la
  // trayectoria entera y dónde explota): en tu lado viene encendida si eres peque.
  let ayudasTablet = [false, false];
  function abrirTablet() {
    if (!window.Batalla || !partidas().puede) { pintarMinijuegos(); return; }
    clic();
    ayudasTablet = [esPeque(), false];
    ir('tablet');
  }
  function pintarTablet() {
    if (!perfil) return;
    const mio = heroeBatalla();
    const esc = window.innerHeight < 520 ? 3 : window.innerWidth < 500 ? 4 : window.innerHeight < 700 ? 5 : 6;
    [mio, otroHeroe(mio)].forEach((h, k) => {
      const lado = $('#dl-lado-' + k);
      lado.innerHTML = '<div class="dl-heroe"><canvas aria-hidden="true"></canvas><span class="dl-nombre"></span></div>' +
        '<button class="dl-ayuda"><span>🎯 Ayuda</span><span class="dl-interruptor" aria-hidden="true"></span></button>';
      const caja = lado.firstChild;
      if (k === 0) { // tu lado: con tu foto o tu dibujo
        const tu = document.createElement('span');
        tu.className = 'dl-tu';
        pintarAvatar(tu, perfil);
        caja.prepend(tu);
      }
      pintarSprite(caja.querySelector('canvas'), h, esc, k ? { voltear: true } : {});
      caja.querySelector('.dl-nombre').textContent = HEROES[h];
      const b = lado.querySelector('.dl-ayuda');
      b.setAttribute('aria-label', 'Ayuda de ' + HEROES[h]);
      b.setAttribute('aria-pressed', ayudasTablet[k] ? 'true' : 'false');
      b.addEventListener('click', () => {
        ayudasTablet[k] = !ayudasTablet[k];
        b.setAttribute('aria-pressed', ayudasTablet[k] ? 'true' : 'false');
        clic();
      });
    });
    $('#dl-jugar').disabled = !partidas().puede;
  }
  $('#dl-jugar')?.addEventListener('click', () => {
    if (!window.Batalla || !partidas().puede) { ir('minijuegos'); return; }
    try { if (window.Sfx) window.Sfx.activar(); } catch { /* sin sonido */ }
    const mio = heroeBatalla();
    if (iniciarDuelo({
      jugadores: [{ heroe: mio, local: true, ayuda: ayudasTablet[0] }, { heroe: otroHeroe(mio), local: true, ayuda: ayudasTablet[1] }],
      empieza: azar([0, 1]), semilla: nuevaSemilla(), tiempoTurno: 0,
    })) gastarPartida();
  });

  // ---------- 1 contra 1 en red (js/minijuegos/red.js) ----------
  // El que crea la sala es el jugador 0 (izquierda) y el que se une, el 1 (derecha, con el otro héroe).
  // Por la red solo van el héroe y las jugadas; nunca el nombre, la edad ni la foto del perfil:
  //   inicio {estado, empieza, heroes, partida}   el que crea manda el mapa (y en cada revancha)
  //   jugada / turno                              lo que da el motor (alJugadaLocal / alTurnoLocal)
  //   otra {puede, partida}                       revancha: hace falta que la pidan los dos
  //   adios                                       se va (además, al salir, el otro ve la sala cerrada)
  // partida = nº de duelo en esta sala (1, 2...): lo que llegue de un duelo anterior no cuenta.
  const CADUCA_CODIGO = 14.5 * 60 * 1000; // el servidor borra el código a los 15 min
  const RIVAL_PERDIDO = 2 * 60 * 1000; // sin ver al otro tanto tiempo (y sin despedirse), se ha ido
  const NOMBRES_ANIMALES = ['cerdo', 'vaca', 'gallina', 'perro', 'gato', 'conejo', 'rana', 'mono', 'león', 'oso', 'panda', 'zorro'];
  const ERRORES_UNIRSE = {
    'no-existe': 'No encuentro esa partida. Mira bien los animales',
    llena: 'Esa partida ya ha empezado',
    limite: 'Espera un poquito…',
    puerta: '🔒 La web ha vuelto a pedir la contraseña: ciérrala y ábrela otra vez',
    red: 'Sin conexión',
  };
  let red = null; // la sala en marcha (ver nuevaSala)

  function nuevaSala(modo, yo, heroes) {
    return {
      modo, yo, heroes, paso: '', // crear: creando, codigo, error, caducado, ida · unirme: teclear, uniendo, esperar, dentro · jugando
      sesion: null, con: null, partida: 0, codigo: [], malo: null, error: '',
      rival: { unido: false, conectado: false, sinRed: false },
      ida: false, cortada: false, noPuede: false, // el otro se ha ido / la sala ya no vale / no puede jugar más hoy
      yoPido: false, rivalPide: false, fin: false, // revancha
      reloj: 0, relojEspera: 0, relojRival: 0, caduca: 0, // (caduca: hora de verdad en que el código deja de valer)
    };
  }
  const nombreRival = (r) => (r.heroes ? HEROES[r.heroes[1 - r.yo]] : '');

  // Pantalla encendida mientras haya sala o duelo en red: si el aparato se bloquea en el turno del otro o
  // enseñando el código, la partida se para en los dos. El navegador la suelta al ocultarse la página: se
  // vuelve a pedir al volver. Se suelta al salir. Sin Wake Lock (Safari antes de 16.4...), nada.
  let candado = null, pidiendoCandado = false;
  function mantenerPantalla() {
    if (!navigator.wakeLock) return;
    const quiero = () => !!red && document.visibilityState === 'visible';
    if (!quiero()) {
      if (candado) { candado.release().catch(() => {}); candado = null; }
      return;
    }
    if (candado || pidiendoCandado) return;
    pidiendoCandado = true;
    Promise.resolve().then(() => navigator.wakeLock.request('screen')).then((c) => {
      pidiendoCandado = false;
      if (!quiero()) { c.release().catch(() => {}); return; } // (se salió mientras se pedía)
      candado = c;
      c.addEventListener('release', () => { if (candado === c) candado = null; });
    }, () => { pidiendoCandado = false; });
  }
  document.addEventListener('visibilitychange', mantenerPantalla);
  window.addEventListener('pageshow', mantenerPantalla);

  // Al salir de la sala o de la partida: adiós al otro y fuera (sin esperar a la red)
  function cerrarRed() {
    const r = red;
    if (!r) return;
    red = null;
    mantenerPantalla();
    clearTimeout(r.reloj);
    clearTimeout(r.relojEspera);
    clearTimeout(r.relojRival);
    if (!r.con) return; // (si aún se está creando o entrando, se sale al llegar la respuesta)
    try {
      // (el adiós, solo si hay alguien para leerlo: con la sala aún vacía, salir la borra enseguida)
      if (!r.ida && (r.yo === 1 || r.rival.unido)) r.con.enviar('adios', null);
      r.con.salir();
    } catch (e) { console.error(e); }
  }
  // Una sala que llega cuando ya no se quiere (se canceló mientras se creaba o se entraba): se sale.
  // Red.crear y Red.unirse dan la misma promesa a dos peticiones iguales seguidas (cancelar y volver a
  // crear enseguida): si la sala nueva se ha quedado con esa misma sesión, no se toca.
  function soltarSesion(s) {
    setTimeout(() => {
      if (red && red.sesion && red.sesion.sala === s.sala) return;
      try { window.Red.conectar(s, {}).salir(); } catch (e) { console.error(e); }
    }, 0);
  }
  function manejadoresRed(r) {
    return {
      alMensaje: (m) => { if (red === r) mensajeRed(r, m); },
      alRival: (v) => {
        if (red !== r) return;
        r.rival = v;
        vigilarRival(r);
        if (r.yo === 0 && r.paso === 'codigo' && v.unido) empezarDueloRed(r); // (si ha entrado, el código valía)
        else if (r.paso === 'jugando') pintarAvisoRed(r);
        else { caducarCodigo(r); pintarSala(); } // (en la sala: «Sin conexión» si este aparato se ha quedado sin red)
      },
      alCerrada: () => { if (red === r) rivalSeVa(r, false); },
      // La sala ya no sirve (no-existe, token, tope...): además del aviso, fuera, para que el otro la vea cerrada
      alError: () => {
        if (red !== r) return;
        rivalSeVa(r, true);
        try { if (r.con) r.con.salir(); } catch (e) { console.error(e); }
      },
    };
  }
  // El otro no se ve (y este aparato sí tiene red): puede volver, pero si en 2 min no vuelve, se ha ido (sin
  // revancha) y se sale de la sala, para que él, si vuelve, lo vea. Con la página oculta no se decide: lo que
  // se sabe del otro es de antes de ocultarse (al volver se lee enseguida)
  function vigilarRival(r) {
    const perdido = r.rival.unido && !r.rival.conectado && !r.rival.sinRed && !r.ida;
    if (!perdido) { clearTimeout(r.relojRival); r.relojRival = 0; return; }
    if (!r.relojRival) r.relojRival = setTimeout(() => rivalPerdido(r), RIVAL_PERDIDO);
  }
  function rivalPerdido(r) {
    r.relojRival = 0;
    if (red !== r || r.ida || !r.con) return;
    if (document.visibilityState !== 'visible') { r.relojRival = setTimeout(() => rivalPerdido(r), 5000); return; }
    const con = r.con;
    rivalSeVa(r, false);
    try { con.salir(); } catch (e) { console.error(e); }
  }

  // --- Crear partida: el código (4 animales) y esperar a que entre el otro
  function abrirCrear() {
    if (!window.Red || hayRed !== true || !partidas().puede) { pintarMinijuegos(); return; }
    clic();
    try { if (window.Sfx) window.Sfx.activar(); } catch { /* sin sonido */ }
    cerrarRed();
    const mio = heroeBatalla();
    red = nuevaSala('crear', 0, [mio, otroHeroe(mio)]);
    red.paso = 'creando';
    if (vista !== 'sala') ir('sala');
    crearSala(red);
    mantenerPantalla();
  }
  function crearSala(r) {
    pintarSala();
    window.Red.crear(r.heroes[0]).then((s) => {
      if (red !== r) { soltarSesion(s); return; }
      r.sesion = s;
      r.paso = 'codigo';
      r.con = window.Red.conectar(s, manejadoresRed(r));
      r.caduca = Date.now() + CADUCA_CODIGO;
      r.reloj = setTimeout(() => caducarCodigo(r), CADUCA_CODIGO);
      pintarSala();
    }, (e) => {
      if (red !== r) return;
      r.paso = 'error';
      r.error = ERRORES_UNIRSE[e && (e.codigo === 'limite' || e.codigo === 'puerta') ? e.codigo : 'red'];
      pintarSala();
    });
  }
  // El código caduca con la hora de verdad, no solo con el temporizador (con el iPad dormido, los
  // temporizadores no avanzan): se mira también con cada novedad de la sala y al volver a la página
  function caducarCodigo(r) {
    if (red !== r || r.paso !== 'codigo' || Date.now() < r.caduca) return;
    clearTimeout(r.reloj);
    r.paso = 'caducado'; // nadie ha entrado: ese código ya no vale
    r.con.salir();
    r.con = null;
    pintarSala();
  }
  // (al volver, primero se deja leer la sala: puede que el otro haya entrado mientras tanto)
  function mirarCodigoAlVolver() {
    const r = red;
    if (r && r.paso === 'codigo' && document.visibilityState === 'visible') setTimeout(() => caducarCodigo(r), 2000);
  }
  document.addEventListener('visibilitychange', mirarCodigoAlVolver);
  window.addEventListener('pageshow', mirarCodigoAlVolver);
  // Ha entrado el otro: se hace el mapa, se le manda (alListo) y se gasta la partida
  function empezarDueloRed(r) {
    clearTimeout(r.reloj);
    if (!partidas().puede) { ir('minijuegos'); return; } // (sin partidas no se puede crear: no debería pasar)
    r.partida = 1;
    r.paso = 'jugando';
    if (iniciarDueloRed(r, { semilla: nuevaSemilla(), empieza: azar([0, 1]) })) gastarPartida();
  }

  // --- Unirme: 4 huecos y 12 animales; con los 4 puestos, se intenta entrar solo
  function abrirUnirme() {
    if (!window.Red || hayRed !== true || !partidas().puede) { pintarMinijuegos(); return; }
    clic();
    try { if (window.Sfx) window.Sfx.activar(); } catch { /* sin sonido */ }
    cerrarRed();
    red = nuevaSala('unirme', 1, null);
    red.paso = 'teclear';
    ir('sala');
    mantenerPantalla();
  }
  function teclaAnimal(i) {
    const r = red;
    if (!r || r.modo !== 'unirme' || r.paso !== 'teclear' || r.codigo.length >= 4) return;
    clic();
    r.error = '';
    r.malo = null;
    r.codigo.push(i);
    pintarSala();
    if (r.codigo.length === 4) unirseSala(r);
  }
  function borrarAnimal() {
    const r = red;
    if (!r || r.paso !== 'teclear' || !r.codigo.length) return;
    clic();
    r.codigo.pop();
    pintarSala();
  }
  function unirseSala(r) {
    r.paso = 'uniendo';
    pintarSala();
    window.Red.unirse(r.codigo.slice()).then((s) => {
      if (red !== r) { soltarSesion(s); return; }
      r.sesion = s;
      r.heroes = [s.heroeRival, s.heroe]; // el otro héroe: el que ha elegido quien creó la sala
      r.paso = 'dentro';
      r.con = window.Red.conectar(s, manejadoresRed(r));
      pintarSala();
    }, (e) => {
      if (red !== r) return;
      const codigo = e && ERRORES_UNIRSE[e.codigo] ? e.codigo : 'red';
      r.error = ERRORES_UNIRSE[codigo];
      r.malo = r.codigo; // se ve lo que ha puesto (para compararlo) hasta que toque otro animal
      r.codigo = [];
      r.paso = 'teclear';
      if (codigo === 'limite') {
        // Demasiados intentos: el teclado descansa un rato
        r.paso = 'esperar';
        r.relojEspera = setTimeout(() => {
          if (red !== r || r.paso !== 'esperar') return;
          r.paso = 'teclear';
          r.error = '';
          pintarSala();
        }, 1000 * Math.min(60, Math.max(5, Number(e.espera) || 30)));
      }
      pip(220);
      pintarSala();
      const h = $('#sala-huecos');
      h.classList.remove('mal');
      void h.offsetWidth;
      h.classList.add('mal');
    });
  }

  // --- Lo que llega del otro
  function mensajeRed(r, m) {
    const d = m.datos;
    if (m.tipo === 'inicio') { if (r.yo === 1) inicioRed(r, d); }
    else if (m.tipo === 'jugada' || m.tipo === 'turno') {
      if (!batalla || r.paso !== 'jugando') return;
      try {
        if (m.tipo === 'jugada') batalla.recibirJugada(d);
        else batalla.recibirTurno(d);
      } catch (e) { console.error(e); }
    } else if (m.tipo === 'otra') otraRed(r, d);
    else if (m.tipo === 'adios') rivalSeVa(r, false);
  }
  // El mapa del que creó la sala: el duelo empieza (gasta 1 partida); en una revancha, solo si la he pedido
  function inicioRed(r, d) {
    if (!d || typeof d !== 'object' || !d.estado || typeof d.estado !== 'object') return;
    if (!Number.isInteger(d.partida) || d.partida <= r.partida) return;
    const empieza = d.empieza === 1 ? 1 : 0;
    if (r.paso === 'dentro') {
      if (Array.isArray(d.heroes) && d.heroes.length === 2 && d.heroes.every((h) => propia(HEROES, h)) && d.heroes[0] !== d.heroes[1]) r.heroes = d.heroes.slice();
      if (!partidas().puede) { ir('minijuegos'); return; } // (sin partidas no se puede entrar: no debería pasar)
      r.partida = d.partida;
      r.paso = 'jugando';
      if (iniciarDueloRed(r, { estadoInicial: d.estado, empieza })) gastarPartida();
    } else if (r.paso === 'jugando' && motorDuelo() && r.yoPido) {
      r.partida = d.partida;
      if (!gastarPartida()) {
        r.yoPido = false;
        r.con.enviar('otra', { puede: false, partida: r.partida });
        pintarAvisoRed(r);
        return;
      }
      r.yoPido = r.rivalPide = r.fin = false;
      batalla.nuevoDuelo({ estadoInicial: d.estado, empieza });
      pintarAvisoRed(r);
    }
  }
  function otraRed(r, d) {
    if (!d || typeof d !== 'object' || d.partida !== r.partida || r.paso !== 'jugando') return;
    if (d.puede === false) r.noPuede = true;
    else {
      r.rivalPide = true;
      if (r.yo === 0 && r.yoPido) { empezarRevancha(r); return; }
    }
    pintarAvisoRed(r);
  }
  function rivalSeVa(r, cortada) {
    r.ida = true;
    r.cortada = r.cortada || cortada;
    clearTimeout(r.reloj);
    clearTimeout(r.relojRival);
    if (r.paso === 'jugando') { pintarAvisoRed(r); pararSinRival(r); return; }
    if (r.modo === 'crear') { r.paso = 'ida'; pintarSala(); return; }
    // Unirme: se vuelve a teclear otro código
    if (r.con) r.con.salir();
    red = nuevaSala('unirme', 1, null);
    red.paso = 'teclear';
    red.error = nombreRival(r) ? nombreRival(r) + ' se ha ido' : 'Sin conexión';
    pintarSala();
  }

  // El otro se ha ido de verdad: el duelo no sigue (el niño dispararía a nadie) y queda el aviso con Salir.
  // Si su último turno ya ha llegado entero, se ve hasta el final (y si acaba el duelo, sale el cartel del
  // final); si no, la partida se para ya. Después, cada turno que empiece se para nada más empezar.
  function pararSinRival(r) {
    if (red !== r || !r.ida || !motorDuelo() || !batalla.enCurso()) return;
    try {
      const v = batalla.rival();
      if (v.turnoDe === r.yo || v.esperando) pausarBatalla(true);
    } catch (e) { console.error(e); }
  }

  // --- El duelo en red (true si ha empezado)
  function iniciarDueloRed(r, o) {
    if (!window.Batalla) { ir('minijuegos'); return false; }
    if (!iniciarDuelo(Object.assign({
      jugadores: r.heroes.map((h, k) => ({ heroe: h, local: k === r.yo, ayuda: k === r.yo && esPeque() })),
      tiempoTurno: 60,
      // El mapa está listo (se llama dentro de iniciar y de nuevoDuelo): el que creó la sala se lo manda al otro
      alListo: (estado) => {
        if (red === r && r.yo === 0 && estado) r.con.enviar('inicio', { estado, empieza: estado.siguiente, heroes: r.heroes, partida: r.partida });
      },
      // En mi turno basta con el latido; en el del otro (o esperando algo), se lee a menudo
      alEmpezarTurno: ({ local }) => {
        if (red !== r) return;
        r.con.ritmo(local ? 'lento' : 'rapido');
        pararSinRival(r);
      },
      alJugadaLocal: (j) => { if (red === r) r.con.enviar('jugada', j); },
      alTurnoLocal: (tr) => {
        if (red !== r) return;
        r.con.enviar('turno', tr);
        r.con.ritmo('rapido');
      },
    }, o))) return false;
    pintarAvisoRed(r);
    return true;
  }
  // Revancha: se pide (otra) y se espera al otro; cuando la han pedido los dos, el que creó la sala hace
  // el mapa nuevo (gasta 1) y manda inicio; el otro gasta la suya al recibirlo
  function pedirRevancha(r) {
    if (r.ida || r.noPuede || r.yoPido || !partidas().puede || !r.con) { pintarAvisoRed(r); return; }
    r.yoPido = true;
    r.con.enviar('otra', { puede: true, partida: r.partida });
    if (r.yo === 0 && r.rivalPide) empezarRevancha(r);
    else pintarAvisoRed(r);
  }
  function empezarRevancha(r) {
    if (!motorDuelo()) return;
    if (!gastarPartida()) {
      r.yoPido = false;
      r.con.enviar('otra', { puede: false, partida: r.partida });
      pintarAvisoRed(r);
      return;
    }
    r.partida++;
    r.yoPido = r.rivalPide = r.fin = false;
    batalla.nuevoDuelo({ semilla: nuevaSemilla(), empieza: azar([0, 1]) }); // (alListo manda el inicio)
    pintarAvisoRed(r);
  }
  // El cartel fijo del juego (encima del mundo, o dentro del cartel del final): lo más importante primero
  function pintarAvisoRed(r) {
    if (!r || red !== r || r.paso !== 'jugando' || !batalla) return;
    const rival = nombreRival(r);
    let txt = null;
    const salir = r.ida || r.noPuede;
    // El otro no se ve: puede volver (el botón se quita solo), pero el niño también se puede ir
    const perdido = !salir && !r.rival.sinRed && r.rival.unido && !r.rival.conectado;
    if (r.cortada) txt = 'Se ha cortado la partida';
    else if (r.ida) txt = rival + ' se ha ido';
    else if (r.noPuede) txt = rival + ' no puede jugar más hoy';
    else if (r.rival.sinRed) txt = 'Sin conexión…';
    else if (perdido) txt = 'Esperando a ' + rival + '…';
    else if (r.fin && r.yoPido) txt = 'Esperando a ' + rival + '…';
    else if (r.fin && r.rivalPide) txt = '¡' + rival + ' quiere revancha!';
    try { batalla.aviso(txt, { salir: salir || perdido }); } catch (e) { console.error(e); }
    // Con el otro fuera, la revancha ya no se puede (si el cartel del final aún no ha salido, lo dice infoFin)
    if (salir) document.querySelectorAll('#batalla-caja .bt-fin-botones [data-accion="otra"]').forEach((b) => { b.disabled = true; });
  }

  // --- La pantalla de la sala (crear o unirme)
  function pintarSala() {
    const r = red;
    if (!r || !perfil) return;
    const crear = r.modo === 'crear';
    $('#sala-crear').hidden = !crear;
    $('#sala-unirme').hidden = crear;
    if (crear) pintarSalaCrear(r);
    else pintarSalaUnirme(r);
  }
  function animales(caja, lista, clase) {
    caja.innerHTML = '';
    for (let k = 0; k < 4; k++) {
      const s = document.createElement('span');
      const i = lista ? lista[k] : null;
      s.className = 'sala-animal' + (i == null ? ' vacio' : '') + (clase ? ' ' + clase : '');
      s.textContent = i == null ? '' : window.Red.ANIMALES[i];
      if (i != null) s.setAttribute('aria-label', NOMBRES_ANIMALES[i]);
      caja.appendChild(s);
    }
  }
  function pintarSalaCrear(r) {
    animales($('#sala-codigo'), r.sesion && r.sesion.codigo, r.paso === 'caducado' || r.paso === 'ida' ? 'apagado' : '');
    const textos = {
      codigo: r.rival.sinRed ? 'Sin conexión' : 'Dile a la otra persona que toque estos animales en su tablet',
      error: r.error, caducado: 'Este código ya no vale',
      ida: r.rival.unido ? nombreRival(r) + ' se ha ido' : 'Este código ya no vale', // (la sala se ha borrado sin que entre nadie)
    };
    $('#sala-texto').textContent = textos[r.paso] || '';
    $('#sala-espera').hidden = r.paso !== 'creando' && r.paso !== 'codigo';
    $('#sala-otra').hidden = !['error', 'caducado', 'ida'].includes(r.paso);
  }
  function pintarSalaUnirme(r) {
    const dentro = r.paso === 'dentro';
    const malo = !r.codigo.length && r.malo;
    animales($('#sala-huecos'), malo || r.codigo, malo ? 'malo' : r.paso === 'uniendo' ? 'uniendo' : '');
    const sig = $('#sala-huecos').children[r.codigo.length];
    if (sig && r.paso === 'teclear' && !malo) sig.classList.add('siguiente');
    $('#sala-borrar').hidden = dentro;
    $('#sala-borrar').disabled = r.paso !== 'teclear' || !r.codigo.length;
    $('#sala-error').textContent = dentro && r.rival.sinRed ? 'Sin conexión' : r.error || '';
    const teclado = $('#sala-animales');
    teclado.hidden = dentro;
    if (!teclado.children.length) {
      window.Red.ANIMALES.forEach((a, i) => {
        const b = document.createElement('button');
        b.textContent = a;
        b.dataset.animal = i;
        b.setAttribute('aria-label', NOMBRES_ANIMALES[i]);
        b.addEventListener('click', () => teclaAnimal(i));
        teclado.appendChild(b);
      });
    }
    teclado.querySelectorAll('button').forEach((b) => { b.disabled = r.paso !== 'teclear'; });
    const d = $('#sala-dentro');
    d.hidden = !dentro;
    if (dentro && r.heroes) { // ya dentro: con qué héroe va a jugar (el otro elige el suyo al crear)
      const esc = window.innerHeight < 520 ? 3 : window.innerWidth < 500 ? 4 : 5;
      pintarSprite(d.querySelector('canvas'), r.heroes[1], esc, { voltear: true });
      d.querySelector('.dl-nombre').textContent = HEROES[r.heroes[1]];
    }
  }
  $('#sala-cancelar')?.addEventListener('click', () => { clic(); ir('minijuegos'); });
  $('#sala-otra')?.addEventListener('click', () => abrirCrear());
  $('#sala-borrar')?.addEventListener('click', () => borrarAnimal());

  // ---------- Para padres: candado con una multiplicación (6-9 × 6-9) ----------
  let cuenta = null;
  let respuesta = '';
  function nuevaCuenta() {
    let a, b;
    do { a = 6 + Math.floor(Math.random() * 4); b = 6 + Math.floor(Math.random() * 4); }
    while (cuenta && a === cuenta.a && b === cuenta.b);
    cuenta = { a, b };
    respuesta = '';
    $('#padres-pregunta').textContent = a + ' × ' + b;
    pintarRespuesta();
  }
  function pintarRespuesta() { $('#padres-respuesta').textContent = respuesta || '?'; }
  // Tras cada fallo seguido, el teclado espera un rato (con cuenta atrás): probar números al azar
  // (o copiar uno que vio teclear a papá) deja de compensar. Se reinicia al acertar.
  const ESPERAS_PADRES = [3, 10, 30, 60]; // segundos
  let fallosPadres = 0, bloqueoPadres = 0, relojPadres = 0;
  const esperaPadres = () => Math.max(0, Math.ceil((bloqueoPadres - Date.now()) / 1000));
  function pintarBloqueoPadres() {
    const queda = $('#padres').hidden ? 0 : esperaPadres();
    document.querySelectorAll('#padres-teclado button').forEach((b) => { b.disabled = queda > 0; });
    const txt = $('#padres-texto');
    if (queda > 0) {
      txt.textContent = 'No es correcto. Espera ' + queda + ' s';
      txt.classList.add('mal');
      if (!relojPadres) relojPadres = setInterval(pintarBloqueoPadres, 250);
      return;
    }
    if (relojPadres) {
      clearInterval(relojPadres);
      relojPadres = 0;
      txt.textContent = 'Prueba con esta:';
      txt.classList.remove('mal');
    }
  }
  function abrirPadres() {
    $('#padres').hidden = false;
    $('#padres-candado').hidden = false;
    $('#padres-panel').hidden = true;
    const txt = $('#padres-texto');
    txt.textContent = 'Resuelve la cuenta para entrar';
    txt.classList.remove('mal');
    cuenta = null;
    nuevaCuenta();
    pintarBloqueoPadres(); // si aún tiene que esperar (cerrar y abrir no se salta la espera)
  }
  function cerrarPadres() {
    $('#padres').hidden = true;
    pintarBloqueoPadres(); // para el reloj de la espera
    if (vista === 'minijuegos') pintarMinijuegos();
  }
  function teclaPadres(k) {
    if (esperaPadres() > 0) return;
    if (/^\d$/.test(k)) { if (respuesta.length < 2) respuesta += k; pintarRespuesta(); return; }
    if (k === 'borrar') { respuesta = respuesta.slice(0, -1); pintarRespuesta(); return; }
    if (k !== 'ok' || !respuesta) return;
    if (Number(respuesta) === cuenta.a * cuenta.b) { fallosPadres = 0; abrirPanelPadres(); return; }
    // Mal: un rato de espera y otra cuenta distinta
    fallosPadres++;
    bloqueoPadres = Date.now() + ESPERAS_PADRES[Math.min(fallosPadres, ESPERAS_PADRES.length) - 1] * 1000;
    const c = $('.padres-cuenta');
    c.classList.remove('mal');
    void c.offsetWidth;
    c.classList.add('mal');
    pip(220);
    nuevaCuenta();
    pintarBloqueoPadres();
  }
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'].forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tecla = k;
    b.textContent = k === 'borrar' ? '⌫' : k === 'ok' ? 'OK' : k;
    if (k === 'borrar') { b.className = 'borrar'; b.setAttribute('aria-label', 'Borrar'); }
    if (k === 'ok') b.className = 'ok';
    b.addEventListener('click', () => teclaPadres(k));
    $('#padres-teclado').appendChild(b);
  });
  // Regalar partidas, si hay un niño jugando (desde la Batalla); la copia en la nube, siempre (también desde el
  // inicio: así se puede recuperar en un aparato vacío)
  function abrirPanelPadres() {
    $('#padres-candado').hidden = true;
    $('#padres-panel').hidden = false;
    $('#padres-hecho').textContent = '';
    $('#padres-regalos').hidden = !perfil;
    pintarPanelPadres();
    if (window.Nube) window.Nube.pintar();
  }
  function pintarPanelPadres() {
    if (!perfil) return;
    const p = partidas();
    $('#padres-info').textContent = p.libre
      ? perfil.nombre + ' tiene partidas libres hoy (hasta las 23:59).'
      : perfil.nombre + ' tiene ' + plural(p.quedan, 'partida', 'partidas') + '.';
  }
  document.querySelectorAll('[data-regalo]').forEach((b) => b.addEventListener('click', () => {
    if (!perfil) return;
    const r = b.dataset.regalo;
    let guardo;
    if (r === 'libre') {
      guardo = guardarDato('batalla-libre', hoyTexto());
      $('#padres-hecho').textContent = '¡Hecho! Hoy puede jugar sin límite.';
    } else {
      const n = Number(r);
      guardo = guardarDato('batalla-regalo', numero(dato('batalla-regalo', 0)) + n); // se suman a las de las estrellas
      $('#padres-hecho').textContent = '¡Hecho! ' + plural(n, 'partida más', 'partidas más') + ' para ' + perfil.nombre + '.';
    }
    // Navegador sin almacenamiento: vale, pero solo mientras no se cierre la página
    if (!guardo) $('#padres-hecho').textContent += ' (Este navegador no deja guardar: vale hasta cerrar la página.)';
    pip(880);
    pintarPanelPadres();
    if (vista === 'minijuegos') pintarMinijuegos();
  }));
  $('#mj-padres').addEventListener('click', abrirPadres);
  $('#inicio-padres').addEventListener('click', abrirPadres);
  $('#padres-cerrar').addEventListener('click', cerrarPadres);
  $('#padres').addEventListener('click', (ev) => { if (ev.target === $('#padres')) cerrarPadres(); });
  // Con teclado de verdad (ordenador): números, borrar, Intro y Escape
  document.addEventListener('keydown', (ev) => {
    if ($('#padres').hidden) return;
    if (ev.key === 'Escape') cerrarPadres();
    else if ($('#padres-candado').hidden) return;
    else if (/^\d$/.test(ev.key)) teclaPadres(ev.key);
    else if (ev.key === 'Backspace') teclaPadres('borrar');
    else if (ev.key === 'Enter') teclaPadres('ok');
    else return;
    ev.preventDefault();
  });

  // =====================================================
  // VÍDEO DE PRESENTACIÓN (se ve solo la primera vez; luego, con el botón)
  // =====================================================
  const intro = $('#intro');
  const video = $('#intro-video');
  function abrirIntro(src = 'media/intro.mp4') {
    if (!video.src.endsWith(src)) { video.src = src; video.poster = src.replace('.mp4', '.jpg'); }
    else if (falta()) { sinVideo(); return; } // ya se sabe que no está: no se abre
    intro.hidden = false;
    video.currentTime = 0;
    video.play().catch(() => { /* sin toque previo: el niño pulsa ▶ */ });
  }
  // 🎬 en Días: mientras se ve el vídeo se cancela la ronda (que no hable encima); al cerrarlo, ronda nueva
  let rondaTrasVideo = false;
  function cerrarIntro() {
    video.pause();
    intro.hidden = true;
    guardado.escribir('intro-vista', true);
    if (rondaTrasVideo) {
      rondaTrasVideo = false;
      if (vista === 'juego' && juego === 'dias') nuevaRonda();
    }
  }
  // Si falta el vídeo (media/intro.mp4 o el de los días): se cierra sin más y su botón 🎬 desaparece.
  // Solo en navegadores que reproducen H.264: en los demás el fallo es del formato, no de que falte,
  // y se queda como siempre (el niño pulsa Saltar).
  const puedeH264 = video.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"') !== '';
  const falta = () => puedeH264 && !!video.error;
  function sinVideo() {
    if (!falta()) return;
    const src = video.getAttribute('src');
    if (src === 'media/intro.mp4') $('#btn-video').hidden = true;
    if (src === C.VIDEO_DIAS) $('#btn-video-dias').hidden = true;
    if (!intro.hidden) cerrarIntro();
  }
  video.addEventListener('error', sinVideo);
  $('#btn-video').addEventListener('click', () => abrirIntro());
  $('#btn-video-dias').addEventListener('click', () => { ronda++; rondaTrasVideo = true; abrirIntro(C.VIDEO_DIAS); });
  $('#intro-saltar').addEventListener('click', cerrarIntro);
  video.addEventListener('ended', cerrarIntro);

  // =====================================================
  // UNA SOLA DIRECCIÓN Y LA PUERTA (docs/PUERTA-Y-COPIA.md)
  // =====================================================
  // Lo guardado (perfiles, estrellas...) es de cada dirección: con http:// o https://, con www. o sin él,
  // para el navegador son cuatro sitios distintos y cada uno tiene lo suyo. Por eso se va siempre a
  // https:// sin www. Sin dominios escritos: solo si la dirección de destino responde (sin certificado,
  // se queda donde está) y nunca en localhost, una IP o con un puerto propio (las pruebas). Y nunca si
  // en esta dirección ya hay algo de los niños: dejarlo atrás es justo lo que se quiere evitar.
  // (no cuentan haber visto el vídeo ni el 🔇 de la Batalla)
  const NO_CUENTAN = ['jp-intro-vista', 'jp-batalla-silencio'];
  function hayAlgoGuardado() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('jp-') && !NO_CUENTAN.includes(k)) return true;
      }
    } catch { /* sin almacenamiento */ }
    return [...memoria.keys()].some((k) => !NO_CUENTAN.includes('jp-' + k));
  }
  function unaSolaDireccion() {
    const { protocol, hostname, port, pathname, search, hash } = location;
    const destino = hostname.replace(/^www\./i, '');
    if ((protocol !== 'http:' && protocol !== 'https:') || port || !destino.includes('.')) return;
    if (/^[\d.]+$|^\[|\.(local|localhost|lan|home\.arpa|internal|test)$/i.test(destino)) return;
    if ((protocol === 'https:' && destino === hostname) || hayAlgoGuardado()) return;
    const carpeta = pathname.replace(/[^/]*$/, '');
    fetch('https://' + destino + carpeta + 'manifest.webmanifest', { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
      .then(() => location.replace('https://' + destino + pathname + search + hash), () => { /* sin https: se queda */ });
  }
  unaSolaDireccion();
  // En los aparatos que ya pasaron la puerta (la cookie jp_puerta_hay; la del token no se ve desde aquí),
  // se pide a api/puerta.php que mire que su bloque sigue en el .htaccess: si se ha subido el del repo
  // (con la red de seguridad, no el bloque), lo vuelve a escribir. Sin puerta o sin PHP, no pasa nada.
  try {
    if (/(?:^|;\s*)jp_puerta_hay=1(?:;|$)/.test(document.cookie)) {
      fetch('api/puerta.php?accion=revisar', { cache: 'no-store', credentials: 'same-origin' }).catch(() => { /* nada */ });
    }
  } catch { /* sin cookies */ }

  // =====================================================
  // COPIA EN LA NUBE (js/nube.js, docs/PUERTA-Y-COPIA.md)
  // =====================================================
  // Ha llegado algo de otro aparato: se recargan los perfiles y se repinta lo que se ve, sin cambiar de
  // pantalla ni cortar lo que esté haciendo el niño (el perfil que juega se actualiza en el sitio)
  function alCambiarNube() {
    perfiles = cargarPerfiles();
    const nuevo = perfil && perfiles.find((p) => p.id === perfil.id);
    if (nuevo) Object.assign(perfil, nuevo);
    if (vista === 'inicio') pintarPerfiles();
    if (perfil && !$('#avatar-mini').hidden) pintarAvatar($('#avatar-mini'), perfil);
    pintarEstrellas();
    if (perfil && !$('#btn-letra').hidden && $('#btn-letra').textContent !== MODOS_LETRA[modoLetra()]) { pintarBtnLetra(); repintarLetras(); }
    if (vista === 'menu') { pintarTarjetaBatalla(); if (!esPeque()) pintarNiveles(); }
    if (vista === 'teatro' && window.Teatro) window.Teatro.repintar();
    if (vista === 'elegir') pintarRejillas();
    if (vista === 'minijuegos') pintarMinijuegos();
    if (!$('#padres').hidden) pintarPanelPadres();
  }
  if (window.Nube) window.Nube.iniciar({ guardado, alCambiar: alCambiarNube });

  ir('inicio');
  if (falta()) sinVideo();
  else if (!guardado.leer('intro-vista', false)) abrirIntro();
})();
