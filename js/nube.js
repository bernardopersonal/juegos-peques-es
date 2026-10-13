// Copia en la nube, cifrada de extremo a extremo (docs/PUERTA-Y-COPIA.md, secciones 11 y 12).
//
// Lo que la app guarda en este aparato (perfiles con sus fotos, estrellas, letras trazadas, partidas...) se
// copia cifrado en el propio hosting (api/copia.php) y se recupera en otro aparato con el código de familia:
// 5 palabras sencillas que salen al azar aquí. El código no sale nunca del aparato:
// - Con Web Crypto, del código sale una semilla (PBKDF2-SHA256, ITERACIONES vueltas) y de ella (HKDF) el
//   identificador que ve el servidor y la clave AES-GCM de 256 bits. Del identificador no se puede volver al
//   código sin repetir ese cálculo con cada código posible (2^50).
// - Cada cifrado lleva un IV aleatorio de 96 bits (nuevo cada vez) y, como datos asociados, el formato y el
//   identificador (una copia no se puede hacer pasar por otra). El texto se rellena hasta un múltiplo de
//   4 KB: por el tamaño no se ve cuántas estrellas hay.
// - Se sincroniza sola unos segundos después de cada cambio (agrupando), al abrir la app, al volver a ella
//   y cada 5 minutos con la app a la vista. Nunca para el juego ni enseña errores a los niños: solo un
//   aviso discreto en «👪 Padres».
// - Varios aparatos: se mezcla clave a clave (ver mezclar()). Perfiles: gana el más nuevo de cada uno
//   (borrarlo también cuenta, con su marca de tiempo). Estrellas y partidas usadas o regaladas: cada
//   aparato pone lo suyo y se suma (nunca bajan; al unirse un aparato, el máximo). Nivel desbloqueado de la
//   Batalla: el máximo. Letras trazadas: todas. Lo demás (tipo de letra, nivel elegido, modos...): el
//   último que se cambió.
// - El servidor lleva una versión de cada copia: si ha cambiado entre que se leyó y se escribe, 409, y aquí
//   se mezcla con la de ahora y se vuelve a probar. Lo que llega se mezcla también con la última copia que
//   se conocía: si el servidor vuelve atrás (una copia de seguridad vieja), no se pierde nada.
// - Las marcas de tiempo van con la hora del servidor (la manda en cada respuesta): un aparato con el reloj
//   mal no gana ni pierde por eso.
// Lo que es del aparato no se copia (LOCALES): que el vídeo ya se vio, el 🔇 de la Batalla y lo de la nube.
// Sin Web Crypto (la web por http://, navegadores viejos) o sin almacenamiento, el panel lo explica y no hace
// nada más. La usa app.js: Nube.iniciar(), Nube.cambio() desde su guardado y Nube.pintar() en Padres.
(function () {
  const $ = (s) => document.querySelector(s);

  // ---------- El código de familia: 5 palabras de esta lista (1024 = 10 bits cada una: 50 bits) ----------
  // Sin tildes ni eñes, sin palabras feas, con doble sentido o que suenan igual que otra, sin nombres ni días
  // de la semana; de las parejas que se confunden (gorro/gorra, junio/julio...), solo una. No quites ninguna:
  // los códigos ya repartidos las usan (la clave sale de las palabras, no del orden de la lista).
  const PALABRAS = `
abanico abeja abeto abrazar abrazo abrigo abril abuelo acampar aceite aceituna acera acorde acuario agenda
agosto agua ajedrez ajo albornoz alce aldea alegre aletear alfombra alga alita almendra almohada alondra alpaca
alto amable amanecer amapola amarillo amasar amigo amistad ancho anchoa ancla andar anguila anidar anillo
anzuelo apio aplaudir ardilla arena arenero armario aro arpa arroyo arroz arte aseo asfalto astro astuto atajo
atar atrapar audaz aula aullar aurora avellana avena avenida aventura avestruz avispa ayudar azotea azul azulado
babero bacalao bailar bajar bajo ballena balsa banco bandeja bandera barco barra barrer barrio barro bata batido
batidora batir beber bellota beso bici billete bisonte bizcocho blanco blando bloque boca bodega boina bolera
bolos bolsa bombero bombilla bombo bondad bonito bosque botella botijo boya brasa brazo brillar brillo brincar
brindar brisa broche broma bucear bufanda burbuja buscar caballo cabeza cabo cabra cacao cactus cadena cafetera
caja calabaza calamar caldo caliente callado calle cama camello camino camisa camiseta campana campo canario
canasta cancha candado candil canela cangrejo canguro canica canoa cantar canto capa capucha cara caracol
caramelo careta carpeta carrera carreta carril carro carroza carta cartel cartero cascabel cascada casco
castillo castor catalejo catorce cazuela cebada cebolla cebra ceja celeste cena ceniza cepillo cera cereal
cereza cerilla cerrar cerro cesta chaleco chaqueta charco charlar chicle chimenea chispa chiste chopo chuche
chuleta churro cielo cien ciervo cigarra cincel cinco cine ciruela cisne ciudad claro clave clavel clavo cobaya
coche cocido cocina coco codo cofre cohete colador colcha colegio colgar coliflor colina collar colmena color
colorear columpio comba comedor comer cometa comida compota confeti contar contento coral corbata cordero
corneta corona correr corteza cortina corto corzo costa coyote crecer crema cristal cromo cruz cuaderno cuadrado
cuadro cuajada cuarenta cuarto cuatro cubo cuchara cuello cuenco cuento cuerda cuervo cueva cuidar cumbre cuna
curioso dado danza dardos decorar dedo dehesa delta desayuno deseo desierto diadema diamante diario dibujar
dibujo diente diez disfraz dividir doblar doce dorado dormido dormir dos ducha duende dulce duna duro eclipse
educado elefante embudo empatar empujar enchufe encina enero enfriar enigma enorme ensalada entrar equipo erizo
escalera escoba escribir escuchar escudo escuela esfera espalda espejo esperar espiga espinaca espiral esponja
espuma esquiar esquina establo estadio estanque estante estirar estrella estuche estufa fabada falda familia
farmacia faro farol febrero feliz felpudo feria ficha fideo fiesta filete filmar fino flamenco flan flauta
flecha flor florero flotar folio forma foto frasco frase fregona freno frente fresa fresco fruto fuego fuente
fuerte gacela gafas gaita galaxia galleta gallo galopar gamba gamo ganar gancho ganso garaje garza gatear gato
gaviota gazpacho gigante gimnasio girar girasol glaciar globo glorieta gofre gol golf goloso goma gorila gorro
grabar gracioso granada grande granero granizo granja grapa grava grifo grillo gris grueso grulla grupo guante
guapo guardar guitarra hablar hada hamaca harina helado helecho hermano hermoso hielo hierba higo hilo historia
hoguera hoja hombro hondo hora hormiga hornear horno huerta humo hundir idea iguana invierno invitar isla islote
jaguar jarra jaula jersey jirafa joya judo juego jugar jugoso jungla junio kiwi koala labio ladera ladrar
lagarto lago laguna lancha lanzar largo lata lavabo lavanda lavar lazo lechuga lechuza leer lenteja lento
leopardo letra letrero leyenda libertad libreta libro liebre ligero lila lima limpiar limpio lince linterna
lirio liso listo llama llanura llave llavero lleno llover lluvia lobo lodo lombriz loro lubina lucero luna lupa
luz maceta maestro magia mago maleta mango mano manta mantel manzana mapa mapache mar maraca marco marea
mariposa marmota marte martillo marzo maullar mayo mecha mechero medalla mediano medir medusa mejilla menta
mercado merienda mes mesa meseta meta meteoro metro mezclar miel migas mil mimoso minuto mirador mirar mirlo
misterio mochila modelar mojado mojar molino moneda mono montar monte mora morado morsa mosca mosquito moteado
moto muelle mugir museo musgo muslo nadar naranja nariz nata nave navegar nebulosa negro neptuno nevada nevar
nevera nido niebla nieve noche nombre nota noventa nube nublado nudo nueve nuez nutria oasis oca ochenta ocho
octubre oficina ojo oler olivo olla ombligo once orca ordenar oreja orilla ortiga oruga oscuro oso ostra oveja
ovillo paella paisaje pala palabra palacio palanca palmera palo paloma palomita pan panda pantano pantera
pantufla papel parada paraguas pared parque partido pasa pasear paseo pasillo pasta pastel pastor patata patinar
patines patinete patio pato pavo payaso pedal pegatina peinar peine pelo pelota peluca peluche peludo pensar
peonza pera percha perdiz perejil perla perro pesado pesar pescado pescar pez piano pie piedra pierna pijama
piloto pimiento pincel pincho pino pintar pintura pinza pipa pirata piruleta piscina pista pisto pizarra pizza
plancha planear planeta plano plantar plato playa plaza pluma plumero poema pollo polo pomelo pomo poncho porche
postal postre potaje potro pozo pradera prado pregunta premio primo princesa prisma probar promesa puchero
pueblo puente puerta puerto pulga pulido pulpo pulsera puma punto puzle queso quince quiosco rama rampa rana
raqueta rastro raya rayado rayo rebotar recoger recreo recuerdo red redondo refugio regalar regaliz regalo regar
reina reja reloj remar remo reno restar reto revista rey ribera rico rima risa risco ritmo rizado roble robot
roca rodar rodilla rodillo rojo rombo romero rosa rosado rosco rotonda rueda rugir rugoso ruidoso ruta sabio
sabroso saco sal salado salero salir salsa saltar salto saludar sandalia sano sardina saturno sauce secar seco
secreto segundo seis sello selva semana sembrar semilla sendero sepia sereno sesenta seta sierra siete siglo
silbar silbato silencio silla sincero sirena soga sol soleado sombra sombrero sonrisa sopa soplar sorbete
sorpresa suave subir suelo suerte sumar taladro taller tallo tambor tapa tapete tarde tarro tarta taxi taza
teatro techo tejado tejer tela tenedor tenis termo ternera terraza tesoro tibio tienda tierno tierra tigre
tijera timbal timbre tiza toalla tobillo tocar toldo tomate tomillo topo tormenta tornado tornillo toro torre
tortilla tortuga tostada tractor tragar travieso trece treinta tren trepar tres triciclo trigo trineo trofeo
trompeta trompo tronco trucha trueno trufa tuba tuerca ukelele uno urano urraca uva vainilla valiente valle
vaquero varita vaso vecino veinte vela velero veleta veloz vencejo ventana ventoso venus verano verdad verde
verdoso vereda verja vestido vestir viajar viaje viento villa violeta visera visitar vista vivero volante volar
yak yate yogur zafiro zapato zarpar zarza zoo zorro zueco zumbar zumo`.trim().split(/\s+/);
  const NUM_PALABRAS = 5;

  // ---------- Formato (no cambiarlo sin subir FORMATO: los aparatos viejos dejarían de entender la copia) ----------
  const FORMATO = 1;
  // PBKDF2: 300 000 vueltas. En un ordenador, 0,15 s; en un móvil lento, unas veces más (por debajo de 2 s).
  // El código tiene 50 bits de azar: no es una contraseña que se pueda adivinar, las vueltas son un extra.
  const ITERACIONES = 300000;
  const SAL = 'juegos-peques/copia/v1';
  const API = 'api/copia.php';
  const MAX_DATOS = 2097152;       // lo que acepta api/copia.php (2 MB)
  const TOPE = 1000000;            // lo más que se acepta de fuera en un contador o un máximo (más es basura)
  const RELLENO = 4096;
  const ESPERA_CAMBIO = 6000;      // ms desde el último cambio hasta guardar...
  const ESPERA_MAX = 30000;        // ...pero, con cambios seguidos, como mucho esto desde el primero
  const CADA = 300000;             // con la app a la vista, mira si hay algo nuevo cada 5 min
  const REINTENTOS = [30, 60, 120, 300, 600]; // s tras un fallo de red o del servidor
  const CLAVE_META = 'jp-nube';            // lo de la nube en este aparato (con el código): no se copia
  const CLAVE_COPIA = 'jp-nube-copia';     // la última copia mezclada (para no bajarla cada vez)

  // ---------- Qué se copia y cómo se mezcla ----------
  // Lo que es del aparato: no se copia nunca
  const LOCALES = ['intro-vista', 'batalla-silencio'];
  const LOCALES_PERFIL = ['video-dias-visto'];
  // Lo de cada niño va en «<campo>-<id del perfil>». Lo que no esté aquí (claves nuevas) se copia como 'ultimo'.
  const CAMPOS = {
    estrellas: 'contador', 'batalla-usadas': 'contador', 'batalla-regalo': 'contador',
    'batalla-nivel': 'maximo', trazados: 'conjunto',
    letra: 'ultimo', nivel: 'ultimo', 'modo-silabas': 'ultimo', guia: 'ultimo', 'modo-dias': 'ultimo',
    'batalla-libre': 'ultimo', 'batalla-heroe': 'ultimo', 'batalla-modo': 'ultimo',
  };
  const PREFIJOS = [...LOCALES_PERFIL, ...Object.keys(CAMPOS)].sort((a, b) => b.length - a.length);
  const RARAS = new Set(['__proto__', 'constructor', 'prototype']);
  const claveValida = (k) => typeof k === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(k) && !RARAS.has(k);
  const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !RARAS.has(id);

  // tipo: 'perfiles' | 'local' | 'contador' | 'maximo' | 'conjunto' | 'ultimo'; perfil: id del niño o null
  function tipoDe(k) {
    if (k === 'perfiles') return { tipo: 'perfiles', perfil: null };
    if (k === 'nube' || k.startsWith('nube-') || LOCALES.includes(k)) return { tipo: 'local', perfil: null };
    for (const c of PREFIJOS) {
      if (k.startsWith(c + '-') && k.length > c.length + 1) {
        return { tipo: LOCALES_PERFIL.includes(c) ? 'local' : CAMPOS[c], perfil: k.slice(c.length + 1) };
      }
    }
    return { tipo: 'ultimo', perfil: null };
  }

  // ---------- Utilidades ----------
  const numero = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const entradas = (o) => Object.keys(objeto(o)).filter((k) => !RARAS.has(k)).map((k) => [k, o[k]]);
  // JSON con las claves ordenadas: para comparar sin que importe el orden
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  function b64(bytes) {
    const u = new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deB64(t) {
    const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  const azar = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
  function fallo(tipo, extra) { const e = new Error(tipo); e.tipo = tipo; return Object.assign(e, extra || {}); }

  // ---------- El código: generar, escribir y revisar ----------
  // Lo escrito, en palabras: sin mayúsculas, tildes ni signos («Gato, LUNA-mesa» → gato luna mesa)
  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  function nuevoCodigo() {
    const n = crypto.getRandomValues(new Uint16Array(NUM_PALABRAS)); // 65 536 es múltiplo de 1024: sin sesgo
    return [...n].map((x) => PALABRAS[x & 1023]).join(' ');
  }
  // La palabra de la lista más parecida (para «¿querías decir...?»), si se parece bastante
  function parecida(p) {
    let mejor = null, dist = 3;
    for (const w of PALABRAS) {
      if (Math.abs(w.length - p.length) >= dist) continue;
      const d = distancia(p, w);
      if (d < dist) { dist = d; mejor = w; }
    }
    return mejor;
  }
  function distancia(a, b) {
    let fila = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const nueva = [i];
      for (let j = 1; j <= b.length; j++) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      fila = nueva;
    }
    return fila[b.length];
  }
  const LISTA = new Set(PALABRAS);
  function revisarCodigo(texto) {
    const p = normalizar(texto);
    if (!p.length) return { ok: false, error: 'Escribe las ' + NUM_PALABRAS + ' palabras del código.' };
    const malas = p.filter((w) => !LISTA.has(w));
    if (malas.length) {
      const w = malas[0], s = parecida(w);
      return { ok: false, error: '«' + w + '» no es una palabra del código.' + (s ? ' ¿Es «' + s + '»?' : '') };
    }
    if (p.length !== NUM_PALABRAS) {
      return { ok: false, error: 'El código tiene ' + NUM_PALABRAS + ' palabras y aquí hay ' + p.length + '.' };
    }
    return { ok: true, codigo: p.join(' ') };
  }

  // ---------- Claves ----------
  const subtle = () => window.crypto && window.crypto.subtle;
  const hayCripto = () => {
    try { return !!(window.isSecureContext !== false && subtle() && typeof subtle().deriveBits === 'function' && window.TextEncoder); } catch { return false; }
  };
  // Del código: {id (32 hex), clave (32 bytes en base64)}. Tarda (PBKDF2): se apunta cuánto.
  async function derivar(codigo) {
    const S = subtle(), txt = new TextEncoder();
    const base = await S.importKey('raw', txt.encode(codigo), 'PBKDF2', false, ['deriveBits']);
    const semilla = await S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: txt.encode(SAL), iterations: ITERACIONES }, base, 256);
    const hk = await S.importKey('raw', semilla, 'HKDF', false, ['deriveBits']);
    const trozo = (para, bits) => S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: txt.encode(SAL + '/hkdf'), info: txt.encode(SAL + '/' + para) }, hk, bits);
    return { id: hex(await trozo('id', 128)), clave: b64(await trozo('clave', 256)) };
  }
  let llave = null, llaveDe = null; // la CryptoKey (no exportable) de meta.clave
  async function laLlave() {
    if (!llave || llaveDe !== meta.clave) {
      llave = await subtle().importKey('raw', deB64(meta.clave), 'AES-GCM', false, ['encrypt', 'decrypt']);
      llaveDe = meta.clave;
    }
    return llave;
  }
  const asociados = (id) => new TextEncoder().encode('juegos-peques/copia/' + FORMATO + '|' + id);
  async function cifrar(doc) {
    const txt = new TextEncoder();
    let plano = txt.encode(JSON.stringify(doc));
    const falta = (RELLENO - (plano.length % RELLENO)) % RELLENO; // espacios al final: JSON.parse los ignora
    if (falta) { const r = new Uint8Array(plano.length + falta); r.set(plano); r.fill(32, plano.length); plano = r; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: asociados(meta.id), tagLength: 128 }, await laLlave(), plano);
    return 'jp' + FORMATO + '.' + b64(iv) + '.' + b64(c);
  }
  async function descifrar(texto) {
    const m = /^jp(\d{1,3})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(texto || ''));
    if (!m) throw fallo('rota');
    if (Number(m[1]) > FORMATO) throw fallo('nueva');
    let plano;
    try {
      plano = await subtle().decrypt({ name: 'AES-GCM', iv: deB64(m[2]), additionalData: asociados(meta.id), tagLength: 128 }, await laLlave(), deB64(m[3]));
    } catch { throw fallo('rota'); }
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(plano)); } catch { throw fallo('rota'); }
    if (doc && numero(doc.f) > FORMATO) throw fallo('nueva');
    return limpiarDoc(doc);
  }

  // ---------- La copia («doc») ----------
  // {f, perfiles: {id: {t, d: datos} | {t, x: 1}}, claves: {clave: entrada}} y la entrada según el tipo:
  // contador {c: {aparato: n}} (el total es la suma) · maximo {m} · conjunto {s: [...]} · ultimo {t, v} o {t, x: 1}
  // n: un número al azar de cada copia (se pone al crearla): si cambia, la copia del servidor es otra (se borró y
  // se volvió a subir con el mismo código), no la de antes vuelta atrás. u en un perfil: cuándo se jugó con él.
  const docVacio = () => ({ f: FORMATO, perfiles: {}, claves: {} });
  // Los datos de un perfil, campo a campo (los del formulario de app.js); lo demás, fuera. La foto, solo como
  // imagen dentro de la propia copia (data:): una URL de fuera avisaría a otro de cuándo y desde dónde se
  // abre la app. Lo de aquí pasa por lo mismo (así aquí y allí se comparan igual).
  const FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  function limpiarPerfil(id, d) {
    const texto = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {
      id, nombre: texto(d.nombre, 40), edad: Number.isInteger(d.edad) && d.edad >= 1 && d.edad <= 12 ? d.edad : null,
      tema: texto(d.tema, 30), emoji: texto(d.emoji, 16),
      foto: typeof d.foto === 'string' && d.foto.length <= MAX_DATOS && FOTO.test(d.foto) ? d.foto : null,
    };
  }
  const tope = (v) => Math.min(TOPE, numero(v));
  // Lo que llega de fuera, entrada a entrada: lo que no tiene la forma de su tipo, fuera
  function limpiarDoc(d) {
    const r = docVacio();
    if (/^[0-9a-f]{16}$/.test(objeto(d).n)) r.n = d.n;
    for (const [id, e] of entradas(objeto(d).perfiles)) {
      if (!idValido(id) || !e || !Number.isSafeInteger(e.t)) continue;
      if (e.x) r.perfiles[id] = { t: e.t, x: 1 };
      else if (e.d && typeof e.d === 'object' && !Array.isArray(e.d)) {
        r.perfiles[id] = { t: e.t, d: limpiarPerfil(id, e.d) };
        if (Number.isSafeInteger(e.u)) r.perfiles[id].u = e.u;
      }
    }
    for (const [k, e] of entradas(objeto(d).claves)) {
      if (!claveValida(k) || !e || typeof e !== 'object') continue;
      const { tipo } = tipoDe(k);
      if (tipo === 'contador' && e.c && typeof e.c === 'object') {
        const c = {};
        for (const [a, n] of entradas(e.c)) if (/^[0-9a-f]{16}$/.test(a)) c[a] = tope(n);
        r.claves[k] = { c };
      } else if (tipo === 'maximo') r.claves[k] = { m: tope(e.m) };
      else if (tipo === 'conjunto' && Array.isArray(e.s)) r.claves[k] = { s: e.s.filter((x) => typeof x === 'string' && x.length <= 16) };
      else if (tipo === 'ultimo' && Number.isSafeInteger(e.t)) r.claves[k] = e.x ? { t: e.t, x: 1 } : { t: e.t, v: e.v === undefined ? null : e.v };
    }
    return r;
  }
  const suma = (c) => Object.values(objeto(c)).reduce((s, n) => s + numero(n), 0);
  // El que gana entre dos entradas con marca de tiempo: la más nueva; si empatan, el borrado; y si no, una
  // cualquiera pero siempre la misma (así da igual en qué aparato se mezcle)
  function masNuevo(a, b) {
    // Un perfil con el que se ha jugado después de que otro aparato lo borrase, vuelve (con lo jugado)
    if (!!a.x !== !!b.x) { const [v, x] = a.x ? [b, a] : [a, b]; if (Math.max(v.t, v.u || 0) > x.t) return v; }
    if (a.t !== b.t) return a.t > b.t ? a : b;
    if (!!a.x !== !!b.x) return a.x ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  // Mezcla de dos copias. Da lo mismo en un orden que en otro y mezclar dos veces lo mismo no cambia nada.
  function mezclar(a, b) {
    const r = docVacio();
    if (a.n || b.n) r.n = a.n || b.n;
    for (const id of new Set([...Object.keys(a.perfiles), ...Object.keys(b.perfiles)])) {
      const x = a.perfiles[id], y = b.perfiles[id];
      r.perfiles[id] = x && y ? masNuevo(x, y) : x || y;
      const u = Math.max((x && x.u) || 0, (y && y.u) || 0);
      if (u && !r.perfiles[id].x) r.perfiles[id] = { ...r.perfiles[id], u };
    }
    for (const k of new Set([...Object.keys(a.claves), ...Object.keys(b.claves)])) {
      const x = a.claves[k], y = b.claves[k];
      if (!x || !y) { r.claves[k] = x || y; continue; }
      const { tipo } = tipoDe(k);
      if (tipo === 'contador') {
        const c = { ...x.c };
        for (const [ap, n] of Object.entries(y.c)) c[ap] = Math.max(c[ap] || 0, n);
        r.claves[k] = { c };
      } else if (tipo === 'maximo') r.claves[k] = { m: Math.max(x.m, y.m) };
      else if (tipo === 'conjunto') r.claves[k] = { s: [...new Set([...x.s, ...y.s])].sort() };
      else r.claves[k] = masNuevo(x, y);
    }
    // Lo de los niños borrados, fuera
    for (const k of Object.keys(r.claves)) {
      const p = tipoDe(k).perfil;
      if (p && r.perfiles[p] && r.perfiles[p].x) delete r.claves[k];
    }
    return r;
  }

  // ---------- Lo de la nube en este aparato ----------
  // meta: {codigo, id, clave, aparato, version, reloj, desvio, marcas, borrados, usos, mio, reflejado, ultima, ms}
  // - marcas: cuándo se cambió aquí cada perfil ('perfil:<id>') y cada clave 'ultimo' (o cuándo llegó de fuera)
  // - borrados: perfiles borrados y cuándo · usos: cuándo se jugó aquí con cada perfil (sus estrellas, letras...)
  // - mio: lo que este aparato ha puesto en cada contador
  // - reflejado: el total de la copia que ya está sumado en el valor de aquí (lo de encima es nuevo de aquí)
  // - reloj: la marca más alta vista; las nuevas siempre van por encima · desvio: ms de la hora del servidor
  //   menos la de este aparato (las marcas van con la del servidor: el reloj del aparato puede ir mal)
  let app = null;                 // {guardado, alCambiar} (de app.js)
  let meta = null;
  let copia = null;               // {version, doc}: la última copia mezclada
  let soporte = '';               // '' (bien) | 'sin-cripto' | 'sin-almacen'
  const leerLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const escribirLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const borrarLS = (k) => { try { localStorage.removeItem(k); } catch { /* nada */ } };
  function cargarMeta() {
    const m = leerLS(CLAVE_META);
    if (!m || typeof m.codigo !== 'string' || !/^[0-9a-f]{32}$/.test(m.id) || typeof m.clave !== 'string'
      || !/^[0-9a-f]{16}$/.test(m.aparato)) return null;
    for (const k of ['marcas', 'borrados', 'usos', 'mio', 'reflejado']) m[k] = objeto(m[k]);
    m.version = numero(m.version);
    m.reloj = numero(m.reloj);
    m.desvio = Number.isSafeInteger(m.desvio) ? m.desvio : 0;
    return m;
  }
  function guardarMeta() { return !!meta && escribirLS(CLAVE_META, meta); }
  function guardarCopia() {
    if (!copia || !escribirLS(CLAVE_COPIA, copia)) borrarLS(CLAVE_COPIA); // (si no cabe, se baja cuando haga falta)
  }
  function cargarCopia() {
    const c = leerLS(CLAVE_COPIA);
    return c && meta && numero(c.version) === c.version && c.version > 0 ? { version: c.version, doc: limpiarDoc(c.doc) } : null;
  }
  function nuevaMeta(codigo, der) {
    return { codigo, id: der.id, clave: der.clave, aparato: azar(8), version: 0, reloj: 0, desvio: 0, marcas: {}, borrados: {}, usos: {}, mio: {}, reflejado: {}, ultima: 0, ms: der.ms };
  }
  function subirReloj(t) { if (meta && typeof t === 'number' && t > meta.reloj) meta.reloj = t; }
  function ahora() { const t = Math.max(Date.now() + (meta.desvio || 0), meta.reloj + 1); meta.reloj = t; return t; }

  // ---------- De lo guardado aquí a la copia, y al revés ----------
  let aplicando = false;           // escribiendo lo que llega de la nube: el gancho de app.js no cuenta
  let enCurso = false;             // una vuelta de sincronización a medias...
  let cambiadosDurante = new Set();// ...y lo que se ha cambiado aquí mientras tanto (no se pisa)
  let quitarDeFoto = null;         // al recuperar con «lo de la nube»: lo que no sube de aquí
  let vistos = {};                 // perfil → canon de sus datos (para saber cuál ha cambiado)
  const perfilesAqui = () => objeto(app.guardado.leer('perfiles', {}));
  function recordarPerfiles() {
    vistos = {};
    for (const [id, d] of entradas(perfilesAqui())) vistos[id] = canon(d);
  }

  // Lo de este aparato como copia. base: el valor de cada contador en ese momento (para aplicar luego).
  function foto() {
    const doc = docVacio(), base = {};
    const P = perfilesAqui();
    for (const [id, d] of entradas(P)) {
      if (!idValido(id) || !d || typeof d !== 'object' || (quitarDeFoto && quitarDeFoto.has('perfil:' + id))) continue;
      doc.perfiles[id] = { t: meta.marcas['perfil:' + id] || 0, d: limpiarPerfil(id, d) };
      if (meta.usos[id]) doc.perfiles[id].u = meta.usos[id];
    }
    for (const [id, t] of entradas(meta.borrados)) {
      if (!idValido(id) || (quitarDeFoto && quitarDeFoto.has('perfil:' + id))) continue;
      if (!doc.perfiles[id] || doc.perfiles[id].t <= t) doc.perfiles[id] = { t, x: 1 };
    }
    for (const k of app.guardado.claves()) {
      if (!claveValida(k)) continue;
      const { tipo, perfil } = tipoDe(k);
      if (tipo === 'local' || tipo === 'perfiles' || (quitarDeFoto && quitarDeFoto.has(k))) continue;
      if (perfil && meta.borrados[perfil] && !P[perfil]) continue; // de un niño borrado
      const v = app.guardado.leer(k, null);
      if (v === null) continue;
      if (tipo === 'contador') {
        const L = numero(v);
        base[k] = L;
        const n = (meta.mio[k] || 0) + Math.max(0, L - (meta.reflejado[k] || 0));
        doc.claves[k] = { c: n ? { [meta.aparato]: n } : {} }; // (sin nada propio, nada: no hace falta escribir)
      } else if (tipo === 'maximo') doc.claves[k] = { m: numero(v) };
      else if (tipo === 'conjunto') doc.claves[k] = { s: Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] };
      else doc.claves[k] = { t: meta.marcas[k] || 0, v };
    }
    // Claves 'ultimo' que se han borrado aquí (tienen marca pero ya no valor): se borran también allí
    for (const [k, t] of entradas(meta.marcas)) {
      if (k.startsWith('perfil:') || doc.claves[k] || !claveValida(k) || (quitarDeFoto && quitarDeFoto.has(k))) continue;
      const { tipo, perfil } = tipoDe(k);
      if (tipo === 'ultimo' && !perfil) doc.claves[k] = { t, x: 1 };
    }
    return { doc, base };
  }

  // Borra aquí lo de un niño (se ha borrado en otro aparato)
  function borrarClavesDe(id) {
    for (const k of app.guardado.claves()) {
      const t = tipoDe(k);
      if (t.perfil !== id || t.tipo === 'local') continue;
      app.guardado.borrar(k);
      delete meta.mio[k]; delete meta.reflejado[k]; delete meta.marcas[k];
    }
  }

  // Pone aquí la copia mezclada. Lo que se ha cambiado aquí durante la vuelta no se pisa: los contadores
  // suman lo de fuera a lo que haya ahora y las letras trazadas se juntan; los perfiles y lo demás, en la
  // siguiente vuelta (se apuntan en cambiadosDurante). Todo de golpe, sin esperas: el juego no se cuela en medio.
  // Si algo no cabe en el aparato (localStorage lleno: app.js lo deja solo en memoria), no se apunta como
  // puesto: si no, al volver a abrir, lo viejo de aquí tendría la marca nueva y podría pisar lo de la nube.
  function aplicar(doc, base) {
    let cambio = false;
    aplicando = true;
    try {
      const P = perfilesAqui();
      let cambiaP = false;
      const antes = {}; // las marcas de los perfiles que se cambian aquí (por si no se pueden guardar)
      const contadores = []; // [clave, valor nuevo, mio y reflejado de antes]: se escriben al final (ver abajo)
      for (const [id, e] of entradas(doc.perfiles)) {
        subirReloj(e.t);
        if (cambiadosDurante.has('perfil:' + id)) continue;
        const marca = meta.marcas['perfil:' + id] || 0;
        if (e.x) {
          if (P[id] && marca <= e.t && (meta.usos[id] || 0) <= e.t) { delete P[id]; cambiaP = true; borrarClavesDe(id); }
          if (!P[id]) { meta.borrados[id] = Math.max(meta.borrados[id] || 0, e.t); delete meta.marcas['perfil:' + id]; delete meta.usos[id]; }
        } else if (marca <= e.t) {
          if (canon(P[id]) !== canon(e.d)) { P[id] = e.d; cambiaP = true; antes[id] = marca; }
          meta.marcas['perfil:' + id] = e.t;
          delete meta.borrados[id];
        }
      }
      if (cambiaP) {
        cambio = true;
        if (!app.guardado.escribir('perfiles', P)) for (const id of Object.keys(antes)) meta.marcas['perfil:' + id] = antes[id];
      }
      for (const [k, e] of entradas(doc.claves)) {
        const { tipo, perfil } = tipoDe(k);
        if (perfil && meta.borrados[perfil] && !P[perfil]) continue; // (se ha borrado aquí mientras tanto)
        const actual = app.guardado.leer(k, null);
        if (tipo === 'contador') {
          const R = suma(e.c), L = numero(actual);
          const nuevo = R + Math.max(0, L - (base[k] || 0)); // lo de fuera más lo que se ha sumado aquí mientras tanto
          if (nuevo !== L || actual === null) { contadores.push([k, nuevo, meta.mio[k] || 0, meta.reflejado[k] || 0]); cambio = true; }
          meta.mio[k] = Math.max(meta.mio[k] || 0, e.c[meta.aparato] || 0);
          meta.reflejado[k] = R;
        } else if (tipo === 'maximo') {
          if (actual === null || e.m > numero(actual)) { app.guardado.escribir(k, Math.max(e.m, numero(actual))); cambio = true; }
        } else if (tipo === 'conjunto') {
          const aqui = Array.isArray(actual) ? actual : [];
          const faltan = e.s.filter((x) => !aqui.includes(x));
          if (faltan.length || actual === null) { app.guardado.escribir(k, [...aqui, ...faltan]); cambio = true; }
        } else if (tipo === 'ultimo') {
          subirReloj(e.t);
          if (cambiadosDurante.has(k) || (meta.marcas[k] || 0) > e.t) continue;
          if (e.x) { if (actual !== null) { app.guardado.borrar(k); cambio = true; } }
          else if (canon(actual) !== canon(e.v)) { cambio = true; if (!app.guardado.escribir(k, e.v)) continue; }
          meta.marcas[k] = e.t;
        }
      }
      // Los contadores, solo después de guardar en el aparato lo que ya está sumado en ellos (reflejado): si eso
      // no cabe (lleno), ni el valor ni su reflejado cambian (si no, al volver a abrir, lo de fuera se contaría dos
      // veces; y lo que se juegue mientras, se perdería)
      if (guardarMeta()) for (const [k, v] of contadores) app.guardado.escribir(k, v);
      else for (const [k, , mio, reflejado] of contadores) { meta.mio[k] = mio; meta.reflejado[k] = reflejado; }
    } finally {
      aplicando = false;
    }
    recordarPerfiles();
    if (cambio && app.alCambiar) { try { app.alCambiar(); } catch { /* que no pare la copia */ } }
  }

  // El gancho de app.js: cada vez que guarda o borra algo. Barato y nunca falla.
  function cambio(k) {
    try {
      if (!meta || aplicando || uniendo || typeof k !== 'string') return;
      const { tipo, perfil } = tipoDe(k);
      if (tipo === 'local') return;
      // Se ha jugado con este perfil: si otro aparato lo borra sin haberlo visto, vuelve (ver masNuevo)
      if (perfil && vistos[perfil] !== undefined) { meta.usos[perfil] = ahora(); guardarMeta(); }
      if (tipo === 'perfiles') {
        const P = perfilesAqui();
        for (const [id, d] of entradas(P)) {
          if (vistos[id] === canon(d)) continue;
          meta.marcas['perfil:' + id] = ahora();
          delete meta.borrados[id];
          if (enCurso) cambiadosDurante.add('perfil:' + id);
        }
        for (const id of Object.keys(vistos)) {
          if (P[id]) continue;
          meta.borrados[id] = ahora();
          delete meta.marcas['perfil:' + id];
          if (enCurso) cambiadosDurante.add('perfil:' + id);
        }
        recordarPerfiles();
        guardarMeta();
      } else if (tipo === 'ultimo') {
        meta.marcas[k] = ahora();
        if (enCurso) cambiadosDurante.add(k);
        guardarMeta();
      } else if (enCurso) cambiadosDurante.add(k);
      programar();
    } catch { /* nunca para el juego */ }
  }

  // ---------- El servidor ----------
  async function api(accion, cuerpo) {
    const body = JSON.stringify(Object.assign({ accion }, cuerpo));
    let r;
    try {
      r = await fetch(API, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'text/plain' }, // (sin CORS ni preflight: es la misma web)
        body,
        // Al irse de la app, lo pequeño acaba aunque se cierre (con keepalive no caben más de 64 KB)
        keepalive: document.visibilityState === 'hidden' && body.length < 60000,
      });
    } catch { throw fallo('red'); }
    let j = null;
    try { j = await r.json(); } catch { /* sin JSON: no es api/copia.php */ }
    const error = j && typeof j.error === 'string' ? j.error : '';
    if (j && Number.isSafeInteger(j.ahora) && meta) meta.desvio = j.ahora - Date.now(); // (la hora del servidor)
    if (r.ok && j && !error) return j;
    if (r.status === 401 && error === 'puerta') throw fallo('puerta');
    if (r.status === 403 && error === 'sin-puerta') throw fallo('sin-puerta');
    if (r.status === 404 && error === 'no-existe') throw fallo('no-existe');
    if (r.status === 409) throw fallo(error === 'existe' ? 'existe' : 'version', { version: j && j.version, datos: j && j.datos });
    if (r.status === 429) throw fallo('limite', { espera: numero(r.headers.get('Retry-After')) || 600 });
    if (r.status === 413) throw fallo('grande');
    if (r.status === 503 && error === 'lleno') throw fallo('lleno');
    if (!j) throw fallo('sin-servidor'); // (GitHub Pages, sin PHP...)
    throw fallo('servidor');
  }
  async function subir(doc, version) {
    const datos = await cifrar(doc);
    if (datos.length > MAX_DATOS) throw fallo('grande');
    return api('escribir', { id: meta.id, version, datos });
  }

  // ---------- Sincronizar ----------
  let estado = 'apagada';   // ver TEXTOS
  let detalle = {};         // {espera} para 'limite'
  let ocupado = false;      // una vuelta o una acción del panel a medias: nunca dos a la vez
  let pendiente = false, pendienteLeer = false; // lo que se ha pedido mientras tanto
  let temporizador = 0, primero = 0, leerLuego = false, fallos = 0, sondeo = 0;
  let uniendo = false;      // recuperando con código: hasta decidir, lo que se cambie aquí no se apunta
  const PARADA = ['perdida', 'nueva']; // sin arreglo solo: espera a los padres (o a recargar)

  function ponerEstado(e, d) { estado = e; detalle = d || {}; pintarSiSeVe(); }

  // Una vuelta: (bajar la copia si hace falta) → mezclar con lo de aquí → subir si cambia algo → aplicar aquí.
  // Con un 409, otra vez con la que hay ahora (el servidor la manda con el 409). Lanza los fallos. Devuelve
  // si se ha cambiado algo aquí mientras tanto (va en la siguiente).
  async function vuelta(leer) {
    for (let intento = 0; intento < 6; intento++) {
      if (leer || !copia) {
        const r = await api('leer', copia ? { id: meta.id, tengo: copia.version } : { id: meta.id });
        if (!r.igual || !copia) copia = await llegada(r);
      }
      leer = false;
      cambiadosDurante = new Set();
      enCurso = true;
      try {
        const { doc: aqui, base } = foto();
        const doc = mezclar(copia.doc, aqui);
        let version = copia.version;
        if (canon(doc) !== canon(copia.doc) || copia.atras) {
          try {
            version = numero((await subir(doc, copia.version)).version);
          } catch (e) {
            if (e.tipo !== 'version') throw e;
            // Ha cambiado entre medias: se mezcla con la de ahora y se vuelve a probar
            if (typeof e.datos === 'string') copia = await llegada(e);
            else leer = true;
            continue;
          }
        }
        terminar(version, doc, base);
        return cambiadosDurante.size > 0;
      } finally {
        enCurso = false;
      }
    }
    throw fallo('ocupado'); // seis 409 seguidos: otro aparato no para; se reintenta luego
  }
  // Lo que llega del servidor (al leer o con un 409). Si es la misma copia (su n) y el servidor ha vuelto
  // atrás (se ha puesto una copia de seguridad vieja de api/datos, o la ha restaurado el hosting), se mezcla
  // con la última que se conocía: todo se junta sin bajar, así que no se pierde nada de lo que ya se había
  // visto, y se vuelve a subir (atras). Si es otra (se borró y alguien la volvió a subir con el mismo código),
  // los contadores se juntan como al recuperar. Sin datos (un proxy, un servidor a medias): se reintenta.
  async function llegada(r) {
    if (typeof r.datos !== 'string') throw fallo('servidor');
    const remota = await descifrar(r.datos);
    const version = numero(r.version);
    if (!copia) return { version, doc: remota };
    if (remota.n && remota.n === copia.doc.n) {
      const doc = mezclar(copia.doc, remota);
      return { version, doc, atras: canon(doc) !== canon(remota) };
    }
    juntarContadores(remota);
    return { version, doc: remota };
  }
  function terminar(version, doc, base) {
    copia = { version, doc };
    meta.version = version;
    meta.ultima = Date.now();
    aplicar(doc, base);
    guardarCopia();
  }
  // La primera subida de una copia (nueva, o la misma otra vez porque ya no estaba): todo lo de aquí
  async function primeraSubida() {
    cambiadosDurante = new Set();
    enCurso = true;
    try {
      const { doc, base } = foto();
      doc.n = azar(8); // (esta copia: ver llegada)
      terminar(numero((await subir(doc, 0)).version), doc, base);
      return cambiadosDurante.size > 0;
    } finally {
      enCurso = false;
    }
  }
  // Al juntarse con una copia que ya existe: en los contadores que están aquí y allí, el máximo de los dos
  // (no la suma: puede ser lo mismo contado dos veces, como un aparato recuperado de esa misma copia). Lo de
  // este aparato que ya está allí cuenta como suyo; lo que no está allí, entero de aquí.
  function juntarContadores(remoto) {
    for (const k of app.guardado.claves()) {
      if (tipoDe(k).tipo !== 'contador') continue;
      const r = remoto.claves[k];
      meta.mio[k] = r ? r.c[meta.aparato] || 0 : 0;
      meta.reflejado[k] = r ? Math.min(numero(app.guardado.leer(k, 0)), suma(r.c)) : 0;
    }
  }

  // Cada cosa a su tiempo (las acciones del panel esperan a que acabe la vuelta que haya)
  async function turno(f) {
    while (ocupado) await new Promise((r) => setTimeout(r, 100));
    ocupado = true;
    clearTimeout(temporizador);
    primero = 0;
    try { return await f(); } finally { ocupado = false; despues(); }
  }
  async function sincronizar(leer) {
    if (!meta || soporte || uniendo || PARADA.includes(estado)) return;
    if (ocupado) { pendiente = true; pendienteLeer = pendienteLeer || !!leer; return; }
    ocupado = true;
    clearTimeout(temporizador);
    primero = 0;
    leer = !!leer || leerLuego;
    leerLuego = false;
    ponerEstado('guardando');
    let repetir = false;
    try {
      repetir = await vuelta(leer);
      fallos = 0;
      ponerEstado('bien');
    } catch (e) {
      tratarFallo(e);
    } finally {
      ocupado = false;
    }
    if (repetir) programar(800);
    despues();
  }
  function despues() {
    if (!pendiente) return;
    const l = pendienteLeer;
    pendiente = false; pendienteLeer = false;
    if (meta && !PARADA.includes(estado)) programar(800, l);
  }
  function tratarFallo(e) {
    const t = e && e.tipo;
    if (t === 'no-existe') { ponerEstado('perdida'); return; }
    if (t === 'nueva') { ponerEstado(t); return; }
    // Estos no se arreglan reintentando: hasta el próximo cambio, al volver a la app o en 5 min
    if (t === 'puerta' || t === 'sin-puerta' || t === 'grande' || t === 'sin-servidor') { ponerEstado(t); return; }
    // No se puede leer (o una respuesta rara de un proxy): se vuelve a probar con calma, como sin red
    if (t === 'rota') { ponerEstado('rota'); reintentar(REINTENTOS[Math.min(fallos++, REINTENTOS.length - 1)] * 1000); return; }
    if (t === 'limite') { ponerEstado('limite', { espera: e.espera }); reintentar(e.espera * 1000); return; }
    // Sin red, el servidor falla u otro aparato no para: se vuelve a probar con calma
    ponerEstado(t === 'red' ? 'sin-red' : 'servidor');
    reintentar(REINTENTOS[Math.min(fallos++, REINTENTOS.length - 1)] * 1000);
  }
  // Guardar dentro de un rato, agrupando los cambios seguidos (pero no más de ESPERA_MAX desde el primero)
  function programar(ms = ESPERA_CAMBIO, leer = false) {
    if (!meta || soporte || uniendo) return;
    const t = Date.now();
    if (!primero) primero = t;
    leerLuego = leerLuego || leer;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => sincronizar(false), Math.max(0, Math.min(ms, primero + ESPERA_MAX - t)));
    if (estado === 'bien') ponerEstado('pendiente');
  }
  function reintentar(ms) {
    clearTimeout(temporizador);
    primero = 0;
    temporizador = setTimeout(() => sincronizar(true), ms);
  }
  // Al irse de la app (o cerrarla): lo que esté esperando, ya
  function ahoraSiHayPendiente() {
    if (primero && !ocupado) sincronizar(false);
  }

  // ---------- Guardar, recuperar, borrar y dejar ----------
  let trabajando = false;   // una acción del panel a medias (los botones esperan)...
  let paso = '';            // ...y en qué va: 'calculando' | 'conectando'
  function ponerPaso(p) { paso = p; pintarSiSeVe(); }
  async function calcular(codigo) {
    ponerPaso('calculando');
    const t0 = performance.now();
    const der = await derivar(codigo);
    der.ms = Math.round(performance.now() - t0);
    ponerPaso('conectando');
    return der;
  }
  function soltar() { meta = null; copia = null; llave = null; llaveDe = null; borrarLS(CLAVE_META); borrarLS(CLAVE_COPIA); }
  // «Guardar en la nube»: código nuevo y copia nueva con todo lo de aquí
  async function crear() {
    const codigo = nuevoCodigo();
    const der = await calcular(codigo);
    return turno(async () => {
      meta = nuevaMeta(codigo, der);
      copia = null;
      try {
        const repetir = await primeraSubida();
        fallos = 0;
        ponerEstado('bien');
        empezarSondeo();
        if (repetir) programar(800);
      } catch (e) {
        // Si no se sabe si el servidor la ha guardado (la respuesta se ha perdido), se borra por si acaso: si
        // no, quedaría allí una copia que nadie puede abrir ni borrar (su código solo estaba aquí)
        if (e.tipo === 'red' || e.tipo === 'servidor') await api('borrar', { id: meta.id }).catch(() => { /* nada */ });
        soltar();
        throw e;
      }
    });
  }
  // «Recuperar con código»: se une a la copia y la mezcla con lo de aquí. elegir(conflictos) decide qué pasa
  // con lo que es distinto aquí y allí: 'aparato', 'nube' o null (dejarlo).
  async function unirse(codigo, elegir) {
    const der = await calcular(codigo);
    return turno(async () => {
      uniendo = true;
      meta = nuevaMeta(codigo, der);
      copia = null;
      try {
        copia = await llegada(await api('leer', { id: meta.id }));
        for (const e of [...Object.values(copia.doc.perfiles), ...Object.values(copia.doc.claves)]) subirReloj(e.t);
        juntarContadores(copia.doc);
        const c = conflictos(copia.doc, foto().doc);
        if (c.perfiles.length || c.ajustes.length) {
          // 'aparato', 'nube' o 'nube-menos-borrados' (lo de la nube, pero sin borrar aquí los perfiles que se
          // borraron en otro aparato)
          const eleccion = await elegir(c);
          if (!eleccion) throw fallo('cancelado');
          // Lo de este aparato: con una marca más nueva que todo lo de allí. Lo de la nube: lo de aquí no sube
          // y su marca queda por debajo de todo (se pisa al aplicar).
          const t = ahora();
          quitarDeFoto = eleccion === 'aparato' ? null : new Set();
          for (const k of [...c.perfiles.map((id) => 'perfil:' + id), ...c.ajustes]) {
            const deAqui = eleccion === 'aparato' || (eleccion === 'nube-menos-borrados' && c.borradosAlli.includes(k.slice(7)) && k.startsWith('perfil:'));
            if (deAqui) meta.marcas[k] = t; else { quitarDeFoto.add(k); meta.marcas[k] = -1; }
          }
        }
        uniendo = false;
        recordarPerfiles();
        const repetir = await vuelta(false);
        fallos = 0;
        ponerEstado('bien');
        empezarSondeo();
        if (repetir) programar(800);
      } catch (e) {
        soltar();
        ponerEstado('apagada');
        throw e;
      } finally {
        uniendo = false;
        quitarDeFoto = null;
      }
    });
  }
  // Lo que es distinto aquí y en la copia y no se puede juntar sin perder algo: perfiles con otros datos (o
  // borrados en un lado) y ajustes con otro valor. Lo que se suma (estrellas, letras...) no cuenta.
  function conflictos(remoto, aqui) {
    const perfiles = [], ajustes = [];
    for (const [id, a] of entradas(aqui.perfiles)) {
      const b = remoto.perfiles[id];
      if (!b || (a.x && b.x)) continue;
      if (!!a.x !== !!b.x || canon(a.d) !== canon(b.d)) perfiles.push(id);
    }
    for (const [k, a] of entradas(aqui.claves)) {
      const b = remoto.claves[k];
      if (b && tipoDe(k).tipo === 'ultimo' && canon(a.x ? null : a.v) !== canon(b.x ? null : b.v)) ajustes.push(k);
    }
    const nombre = (id) => { const a = aqui.perfiles[id], b = remoto.perfiles[id]; return String((a && a.d && a.d.nombre) || (b && b.d && b.d.nombre) || 'Un perfil'); };
    const nombres = perfiles.map((id) => {
      const a = aqui.perfiles[id], b = remoto.perfiles[id];
      return nombre(id) + (b && b.x ? ' (se borró en otro aparato)' : a && a.x ? ' (se borró aquí)' : '');
    });
    // Los que se borraron en otro aparato y aquí siguen (con «Lo de la nube» se borrarían aquí, con sus estrellas)
    const borradosAlli = perfiles.filter((id) => remoto.perfiles[id].x && !aqui.perfiles[id].x);
    return { perfiles, ajustes, nombres, borradosAlli, nombresBorrados: borradosAlli.map(nombre) };
  }
  // La copia ya no estaba en el servidor: se vuelve a subir, con el mismo código, todo lo de aquí
  async function recrear() {
    return turno(async () => {
      const antes = { mio: meta.mio, reflejado: meta.reflejado };
      meta.mio = {}; meta.reflejado = {};
      copia = null;
      let repetir;
      try {
        repetir = await primeraSubida();
      } catch (e) {
        if (e.tipo !== 'existe') { meta.mio = antes.mio; meta.reflejado = antes.reflejado; throw e; }
        // Otro aparato la ha vuelto a subir antes: se junta con la suya como al recuperar
        copia = await llegada(await api('leer', { id: meta.id }));
        juntarContadores(copia.doc);
        repetir = await vuelta(false);
      }
      fallos = 0;
      ponerEstado('bien');
      if (repetir) programar(800);
    });
  }
  function olvidar() {
    soltar();
    clearTimeout(temporizador); clearInterval(sondeo); primero = 0;
    ponerEstado('apagada');
  }
  async function borrarCopia() {
    return turno(async () => {
      try { await api('borrar', { id: meta.id }); } catch (e) { if (e.tipo !== 'no-existe') throw e; }
      olvidar();
    });
  }
  // Antes de dejar, lo último que se ha jugado (si estaba esperando los segundos de agrupar) va a la nube; sin
  // red, se queda solo aquí
  function dejar() {
    const habia = !!primero; // (turno lo borra)
    return turno(async () => {
      if (habia && !PARADA.includes(estado)) await vuelta(false).catch(() => { /* nada */ });
      olvidar();
    });
  }
  function empezarSondeo() {
    clearInterval(sondeo);
    sondeo = setInterval(() => { if (document.visibilityState !== 'hidden') sincronizar(true); }, CADA);
  }

  // ---------- El panel (dentro de «👪 Padres») ----------
  const TEXTOS = {
    apagada: 'Lo guardado (perfiles, fotos, estrellas...) está solo en este aparato.',
    calculando: '🔐 Calculando la clave en este aparato…',
    conectando: '🔄 Conectando con la nube…',
    uniendo: '🔑 Recuperando la copia…',
    guardando: '🔄 Sincronizando con la nube…',
    pendiente: '🔄 Hay cambios: se guardan en unos segundos.',
    'sin-red': '📴 Sin conexión: se guardará cuando vuelva.',
    servidor: '⚠️ El servidor no ha podido guardarla: se volverá a probar solo.',
    puerta: '🔒 La web ha vuelto a pedir la contraseña: ciérrala y ábrela otra vez.',
    'sin-puerta': '🔒 La copia en la nube solo funciona con la contraseña de la web puesta (docs/PUERTA-Y-COPIA.md).',
    grande: '⚠️ No cabe en la nube (más de 2 MB): quita alguna foto.',
    'sin-servidor': '⚠️ Esta web no tiene servidor para la copia (api/copia.php, con PHP).',
    nueva: '⚠️ La copia es de una versión más nueva de la web: recarga la página.',
    rota: '⚠️ La copia de la nube no se puede leer: se volverá a probar sola. Lo de este aparato sigue bien.',
    perdida: '⚠️ La copia ya no está en la nube: se borró desde otro aparato o llevaba un año sin usarse. Lo de este aparato sigue bien.',
    'sin-cripto': '🔒 La copia en la nube necesita que la web se abra con https:// (sin cifrar no se guarda nada fuera).',
    'sin-almacen': 'Este navegador no deja guardar nada en el aparato: así no se puede usar la copia.',
  };
  const FALLOS_ACCION = {
    red: 'Sin conexión. Prueba otra vez cuando haya internet.',
    puerta: 'La web ha vuelto a pedir la contraseña: ciérrala y ábrela otra vez.',
    'sin-puerta': 'La copia en la nube solo funciona con la contraseña de la web puesta (docs/PUERTA-Y-COPIA.md).',
    'no-existe': 'No hay ninguna copia con ese código. Mira que esté bien escrito.',
    limite: 'Demasiados intentos. Espera unos minutos y prueba otra vez.',
    grande: 'No cabe en la nube (más de 2 MB): quita alguna foto.',
    lleno: 'El servidor ya tiene demasiadas copias.',
    'sin-servidor': 'Esta web no tiene servidor para la copia (api/copia.php, con PHP).',
    nueva: 'Esa copia es de una versión más nueva de la web: recarga la página.',
    rota: 'Esa copia no se puede leer.',
  };
  const textoFallo = (e) => FALLOS_ACCION[e && e.tipo] || 'No se ha podido. Prueba otra vez en un rato.';
  let vistaNube = 'inicio'; // 'inicio' | 'codigo' | 'recuperar' | 'pregunta'
  let pregunta = null;      // {texto, botones: [[texto, clase, al pulsar]]}
  let aviso = '';           // lo que ha pasado al pulsar algo (✅ o ⚠️)
  let codigoNuevo = false;  // el código recién creado, hasta «Ya lo he apuntado»

  const seVe = () => { const p = $('#padres'); return !!(p && $('#nube') && !p.hidden && !$('#padres-panel').hidden); };
  function pintarSiSeVe() { if (seVe()) pintar(); }
  function haceCuanto(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'ahora mismo';
    const m = Math.round(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60);
    return h < 24 ? 'hace ' + h + ' h' : 'hace ' + Math.round(h / 24) + ' días';
  }
  function textoEstado() {
    if (soporte) return TEXTOS[soporte];
    if (trabajando && paso) return TEXTOS[paso];
    if (!meta) return TEXTOS.apagada;
    if (estado === 'bien') return '☁️ Copia al día (' + haceCuanto(meta.ultima) + ').';
    if (estado === 'limite') return '⏳ Demasiados intentos: se volverá a probar en ' + Math.max(1, Math.round((detalle.espera || 600) / 60)) + ' min.';
    return TEXTOS[estado] || TEXTOS.guardando;
  }
  function pintar() {
    const caja = $('#nube');
    if (!caja) return;
    $('#nube-estado').textContent = textoEstado();
    const av = $('#nube-aviso');
    av.textContent = aviso;
    av.classList.toggle('mal', aviso.startsWith('⚠️'));
    const enInicio = vistaNube === 'inicio' && !soporte;
    $('#nube-apagada').hidden = !enInicio || !!meta;
    $('#nube-encendida').hidden = !enInicio || !meta || estado === 'perdida';
    $('#nube-perdida').hidden = !enInicio || !meta || estado !== 'perdida';
    $('#nube-codigo').hidden = vistaNube !== 'codigo' || !meta;
    $('#nube-form').hidden = vistaNube !== 'recuperar';
    $('#nube-pregunta').hidden = vistaNube !== 'pregunta' || !pregunta;
    caja.querySelectorAll('button, input').forEach((b) => { b.disabled = !!trabajando && !b.closest('#nube-pregunta'); });
    if (vistaNube === 'codigo' && meta) {
      $('#nube-palabras').replaceChildren(...meta.codigo.split(' ').map((w) => { const li = document.createElement('li'); li.textContent = w; return li; }));
      $('#nube-ms').textContent = meta.ms ? 'La clave se calculó en este aparato en ' + (meta.ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 }) + ' s.' : '';
    }
    if (vistaNube === 'pregunta' && pregunta) {
      $('#nube-pregunta-texto').replaceChildren(...pregunta.texto.map((t) => {
        const el = document.createElement(Array.isArray(t) ? 'ul' : 'p');
        if (Array.isArray(t)) t.forEach((x) => { const li = document.createElement('li'); li.textContent = x; el.appendChild(li); });
        else el.textContent = t;
        return el;
      }));
      $('#nube-pregunta-botones').replaceChildren(...pregunta.botones.map(([t, clase, f]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = clase;
        b.textContent = t;
        b.addEventListener('click', f);
        return b;
      }));
    }
  }
  // Una pregunta en el propio panel: devuelve el valor del botón que se pulse
  function preguntar(texto, botones) {
    return new Promise((fin) => {
      pregunta = { texto, botones: botones.map(([t, clase, valor]) => [t, clase, () => { pregunta = null; vistaNube = 'inicio'; fin(valor); pintar(); }]) };
      vistaNube = 'pregunta';
      pintar();
    });
  }
  // Una acción de los botones: sin dos a la vez y con el resultado en el aviso
  async function accion(f) {
    if (trabajando) return;
    trabajando = true;
    paso = '';
    aviso = '';
    pintar();
    try { aviso = (await f()) || ''; } catch (e) { aviso = e && e.tipo === 'cancelado' ? '' : '⚠️ ' + textoFallo(e); }
    trabajando = false;
    paso = '';
    pintar();
  }
  function conectarPanel() {
    $('#nube-guardar').addEventListener('click', () => accion(async () => {
      await crear();
      codigoNuevo = true;
      vistaNube = 'codigo';
      return '';
    }));
    $('#nube-recuperar').addEventListener('click', () => {
      aviso = '';
      vistaNube = 'recuperar';
      $('#nube-error').textContent = '';
      pintar();
      $('#nube-entrada').focus();
    });
    $('#nube-cancelar').addEventListener('click', () => { vistaNube = 'inicio'; $('#nube-entrada').value = ''; pintar(); });
    $('#nube-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (trabajando) return;
      const r = revisarCodigo($('#nube-entrada').value);
      $('#nube-error').textContent = r.ok ? '' : r.error;
      if (!r.ok) return;
      accion(async () => {
        try {
          await unirse(r.codigo, async (c) => {
            paso = 'uniendo';
            const distintos = [...c.nombres];
            if (c.ajustes.length) distintos.push((c.ajustes.length === 1 ? '1 ajuste' : c.ajustes.length + ' ajustes') + ' (tipo de letra, nivel, modos...)');
            const eleccion = await preguntar([
              'En este aparato hay cosas distintas de las de la copia:', distintos,
              'Lo demás (estrellas, letras trazadas, partidas y los perfiles que solo están en un sitio) se junta sin perder nada. En lo distinto, ¿con qué te quedas?',
            ], [['📱 Lo de este aparato', 'nube-azul', 'aparato'], ['☁️ Lo de la nube', 'nube-azul', 'nube'], ['Cancelar', 'nube-texto', null]]);
            if (eleccion !== 'nube' || !c.borradosAlli.length) return eleccion;
            // Borrar aquí un perfil con lo jugado no va en el mismo «sí» que una foto o un ajuste: se pregunta aparte
            return preguntar([
              'Con «Lo de la nube» también se borran en este aparato, con sus estrellas y todo lo jugado:', c.nombresBorrados,
              'Se borraron en otro aparato. Si te los quedas, vuelven también a los demás. ¿Los borro aquí?',
            ], [['🗑️ Sí, borrarlos aquí', 'nube-rojo', 'nube'], ['📱 No, quedármelos', 'nube-azul', 'nube-menos-borrados'], ['Cancelar', 'nube-texto', null]]);
          });
        } catch (e) {
          if (e && e.tipo !== 'cancelado') { vistaNube = 'recuperar'; $('#nube-error').textContent = textoFallo(e); return ''; }
          throw e;
        }
        $('#nube-entrada').value = '';
        vistaNube = 'inicio';
        return '✅ Copia recuperada y juntada con lo de este aparato. Desde ahora se guarda sola.';
      });
    });
    $('#nube-apuntado').addEventListener('click', () => {
      vistaNube = 'inicio';
      aviso = codigoNuevo ? '✅ Copia guardada. Desde ahora se guarda sola.' : '';
      codigoNuevo = false;
      pintar();
    });
    $('#nube-ver').addEventListener('click', () => { aviso = ''; codigoNuevo = false; vistaNube = 'codigo'; pintar(); });
    $('#nube-ahora').addEventListener('click', () => { aviso = ''; sincronizar(true); });
    $('#nube-dejar').addEventListener('click', () => accion(async () => {
      const si = await preguntar(['Este aparato deja de guardar en la nube; lo de aquí se queda. Para volver a unirlo hará falta el código: ¿lo tienes apuntado?'],
        [['Sí, dejar de sincronizar', 'nube-rojo', true], ['No', 'nube-texto', false]]);
      if (!si) return '';
      await dejar();
      return '✅ Este aparato ya no guarda en la nube. Lo de aquí sigue aquí.';
    }));
    $('#nube-borrar').addEventListener('click', () => accion(async () => {
      const si = await preguntar(['¿Borrar la copia de la nube? Los demás aparatos dejarán de sincronizar. Lo de cada aparato se queda donde está.'],
        [['Sí, borrar la copia', 'nube-rojo', true], ['No', 'nube-texto', false]]);
      if (!si) return '';
      await borrarCopia();
      return '✅ Copia borrada de la nube. Lo de este aparato sigue aquí.';
    }));
    $('#nube-otra-vez').addEventListener('click', () => accion(async () => { await recrear(); return '✅ Copia guardada otra vez, con el mismo código.'; }));
    $('#nube-olvidar').addEventListener('click', () => accion(async () => { await dejar(); return '✅ Este aparato ya no guarda en la nube. Lo de aquí sigue aquí.'; }));
  }

  // ---------- Arranque ----------
  function iniciar(opciones) {
    app = opciones;
    try {
      localStorage.setItem('jp-nube-prueba', '1');
      localStorage.removeItem('jp-nube-prueba');
    } catch { soporte = 'sin-almacen'; }
    if (!soporte && !hayCripto()) soporte = 'sin-cripto';
    meta = soporte ? null : cargarMeta();
    copia = cargarCopia();
    if (meta) {
      recordarPerfiles();
      estado = 'guardando';
      setTimeout(() => sincronizar(true), 1200);
      empezarSondeo();
    }
    try { conectarPanel(); } catch { /* sin el panel (otra página): la copia funciona igual */ }
    document.addEventListener('visibilitychange', () => {
      if (!meta) return;
      if (document.visibilityState === 'hidden') ahoraSiHayPendiente();
      else sincronizar(true);
    });
    window.addEventListener('pagehide', ahoraSiHayPendiente);
    window.addEventListener('online', () => { if (meta && estado !== 'bien') sincronizar(true); });
    // Otra pestaña ha cambiado lo de la nube (unido, dejado...): se recarga aquí
    window.addEventListener('storage', (ev) => {
      if (ev.key !== CLAVE_META || ocupado || soporte) return;
      const antes = meta;
      meta = cargarMeta();
      copia = cargarCopia();
      if (!meta) { estado = 'apagada'; clearInterval(sondeo); clearTimeout(temporizador); primero = 0; }
      else { recordarPerfiles(); if (!antes) { estado = 'guardando'; empezarSondeo(); sincronizar(true); } }
      pintarSiSeVe();
    });
  }
  // Al abrir el panel de Padres
  // (con una pregunta o una acción a medias, sigue donde estaba; con el código recién creado, se vuelve a ver)
  function abrirPanel() {
    if (!trabajando) { vistaNube = codigoNuevo && meta ? 'codigo' : 'inicio'; aviso = ''; pregunta = null; }
    pintar();
  }

  window.Nube = {
    iniciar, cambio, pintar: abrirPanel,
    // Para las pruebas (scripts de prueba con Playwright); la app no lo usa
    __prueba: {
      PALABRAS, ITERACIONES, normalizar, revisarCodigo, nuevoCodigo, derivar, mezclar, tipoDe, canon,
      sincronizar: (leer) => sincronizar(!!leer),
      estado: () => ({ estado, meta, copia, soporte, ocupado, trabajando, pendiente: !!primero }),
    },
  };
})();
