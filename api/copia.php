<?php
/* Copia en la nube de lo guardado en cada aparato, cifrada de extremo a extremo
 * (docs/PUERTA-Y-COPIA.md, secciones 11 y 12).
 *
 * El servidor no sabe leerla: cifra y descifra el navegador (js/nube.js) con una clave que sale del
 * código de familia, y el código no sale nunca del aparato. Aquí solo llegan un identificador (que
 * también sale del código, por un camino que no deja volver a él) y el texto cifrado.
 *
 * Endpoint único y sin base de datos: cada copia es un archivo dentro de api/datos/copias/.
 *   POST {accion:'leer',     id, tengo?}       → {version, datos} o, si tengo === version,
 *                                                {version, igual:true} (no hace falta bajarla)
 *   POST {accion:'escribir', id, version, datos} → {version} (la nueva). version es la que tenía el
 *                                                cliente (0 = crearla): si no es la de ahora, 409
 *                                                {error:'version', version, datos} y el cliente
 *                                                mezcla y vuelve a probar
 *   POST {accion:'borrar',   id}               → {ok:true}
 * La acción va en el cuerpo o en la URL (?accion=leer). El cuerpo es JSON, con Content-Type
 * application/json o text/plain. Todas las respuestas llevan «ahora» (ms, la hora del servidor: con ella
 * los aparatos ponen las marcas de tiempo aunque su reloj vaya mal). Errores: {error:'...'} con 4xx/5xx:
 *   400 json | accion | invalido (+campo)   403 origen | sin-puerta   404 no-existe   405 metodo
 *   409 version | existe   413 grande   415 contenido   429 limite (+Retry-After)
 *   500 almacen | servidor   503 lleno
 * Tarea programada (línea de órdenes, sin HTTP): «php copia.php limpiar» limpia y sale.
 *
 * Lo usan niños, así que:
 * - Nada en claro: de cada copia se guardan solo la versión, la fecha y el texto cifrado. El
 *   archivo se llama como un hash del identificador (no como el identificador): quien vea la lista
 *   de archivos (por FTP) no puede usarlos para leer, escribir ni borrar por la API.
 * - Solo funciona detrás de la puerta (api/puerta.php configurada: sin la contraseña de la web no
 *   se llega ni aquí) o si quien aloja la web lo pide a propósito con el archivo
 *   api/datos/COPIA_SIN_PUERTA. Si no, 403 {error:'sin-puerta'}: abierta a cualquiera, se podrían
 *   llenar las copias del hosting o probar identificadores sin parar.
 * - El identificador es el permiso: quien lo tiene puede leer el texto cifrado, cambiarlo o
 *   borrarlo (sin la clave no puede leerlo ni hacer uno que el navegador acepte). Para probar
 *   identificadores al azar hay un límite de intentos con los que no existen por huella de IP
 *   (HMAC de la IP, del /64 en IPv6, con una pimienta que cambia cada hora, recortado a 20 bits: con
 *   el archivo no se saca la IP). No hay cupo entre todas: con él, cualquiera dejaba sin copia a
 *   todas las familias, y probar al azar 128 bits no tiene sentido.
 * - Tamaño máximo por copia, número máximo de copias y copias nuevas por IP: protegen el disco del
 *   hosting.
 * - Lo que lleva un año sin usarse (ni leerse ni escribirse) se borra en la limpieza, que corre
 *   como mucho cada hora con cualquier petición y con la tarea programada. El «último uso» es la
 *   fecha del archivo.
 * - Los datos son archivos .php que empiezan por la misma guarda que los de sala.php (corta la
 *   ejecución) y, como todo api/datos/, no se pueden abrir por URL (el .htaccess de datos/).
 * - Un candado (flock) para todo el almacén de copias: compartido para leer y exclusivo para
 *   cambiar algo. Cada archivo se escribe entero en un temporal y se cambia con rename.
 * - Solo POST y sin CORS: si el navegador manda Origin, tiene que ser esta misma web.
 *
 * Compatible con PHP 7.4 a 8.x.
 */
declare(strict_types=1);

// Nunca se enseñan avisos ni rutas: los errores van solo al registro del servidor
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
ignore_user_abort(true); // si se corta a medias, la escritura se acaba igual
umask(0077);             // carpetas 0700 y archivos 0600: solo los lee el usuario de PHP
header_remove('X-Powered-By');

const DATOS = __DIR__ . '/datos';
const COPIAS = DATOS . '/copias';
const PUERTA = DATOS . '/puerta.php';            // la configuración de la puerta (api/puerta.php)
const SIN_PUERTA = DATOS . '/COPIA_SIN_PUERTA';  // (o .txt) para usar la copia sin puerta, a propósito
const INTENTOS = COPIAS . '/intentos.php';       // pimienta, fallos por huella y copias creadas
const MARCA_LIMPIEZA = COPIAS . '/limpieza.php'; // su fecha es la de la última limpieza
const GUARDA = "<?php http_response_code(404); exit; ?>\n";
const JSON_OPCIONES = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG;

const ACCIONES = ['leer', 'escribir', 'borrar'];
const MAX_DATOS = 2097152;       // el texto cifrado de una copia, como mucho 2 MB...
const MAX_CUERPO = 2101248;      // ...y la petición entera, eso y 4 KB
const MAX_COPIAS = 50;           // copias a la vez (una familia usa una)
const VIDA_COPIA = 31536000;     // sin usarse un año (365 días), se borra
const TOCAR_CADA = 86400;        // al leerla se apunta el uso, como mucho una vez al día
const FALLOS_IP = 10;            // identificadores que no existen, por huella de IP...
const VENTANA_FALLOS = 600;      // ...cada 10 min
const CREAR_IP = 10;             // copias nuevas por huella de IP...
const VENTANA_CREAR = 3600;      // ...cada hora
const VIDA_PIMIENTA = 3600;      // la pimienta de las huellas (y con ella las huellas), una hora
const MAX_HUELLAS = 200;         // huellas apuntadas como mucho (no crece con más IPs)
const LIMPIAR_CADA = 3600;       // la limpieza corre como mucho cada hora

// Un error con su respuesta: se lanza desde cualquier sitio y lo responde principal()
class Fallo extends Exception
{
    public $estado;
    public $cuerpo;
    public $cabeceras;

    public function __construct(int $estado, array $cuerpo, array $cabeceras = [])
    {
        parent::__construct(isset($cuerpo['error']) ? (string)$cuerpo['error'] : 'fallo');
        $this->estado = $estado;
        $this->cuerpo = $cuerpo;
        $this->cabeceras = $cabeceras;
    }
}

function invalido(string $campo): Fallo
{
    return new Fallo(400, ['error' => 'invalido', 'campo' => $campo]);
}

function almacen(): Fallo
{
    return new Fallo(500, ['error' => 'almacen']);
}

/* ---------- Respuesta ---------- */

function cabeceras_json(int $estado): void
{
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Referrer-Policy: no-referrer');
}

function responder(int $estado, array $cuerpo, array $cabeceras = []): void
{
    candado(LOCK_UN);
    $cuerpo['ahora'] = (int)floor(microtime(true) * 1000); // la hora de aquí, en ms (ver arriba)
    $json = json_encode($cuerpo, JSON_OPCIONES);
    if ($json === false) {
        $estado = 500;
        $json = '{"error":"servidor"}';
    }
    if (!headers_sent()) {
        cabeceras_json($estado);
        foreach ($cabeceras as $c) {
            header($c);
        }
    }
    echo $json;
    exit;
}

// Un error fatal (memoria, por ejemplo) también responde JSON y sin detalles
register_shutdown_function(function () {
    $e = error_get_last();
    $fatales = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if ($e !== null && in_array($e['type'], $fatales, true) && !headers_sent()) {
        cabeceras_json(500);
        echo '{"error":"servidor"}';
    }
});

/* ---------- Validación ---------- */

function texto_hex($v, int $largo): bool
{
    return is_string($v) && preg_match('/\A[0-9a-f]{' . $largo . '}\z/', $v) === 1;
}

function campo(stdClass $e, string $nombre)
{
    return property_exists($e, $nombre) ? $e->$nombre : null;
}

// El identificador: 32 caracteres hexadecimales (128 bits que js/nube.js saca del código)
function validar_id($id): string
{
    if (!texto_hex($id, 32)) {
        throw invalido('id');
    }
    return $id;
}

// La versión que tenía el cliente: un entero de 0 en adelante
function validar_version($v, string $nombre): int
{
    if (!is_int($v) || $v < 0) {
        throw invalido($nombre);
    }
    return $v;
}

// El texto cifrado, tal cual lo hace js/nube.js: «jp<formato>.<iv>.<cifrado>» en base64url. Aquí
// no se descifra (no se puede): solo se mira que tenga esa forma y que no pase del tamaño.
function validar_datos($d): string
{
    if (!is_string($d)) {
        throw invalido('datos');
    }
    if (strlen($d) > MAX_DATOS) {
        throw new Fallo(413, ['error' => 'grande']);
    }
    if (preg_match('/\Ajp[0-9]{1,3}\.[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{22,}\z/', $d) !== 1) {
        throw invalido('datos');
    }
    return $d;
}

// Si el navegador dice de dónde viene la petición, tiene que ser de esta misma web (como en sala.php)
function origen_valido(): bool
{
    if (!isset($_SERVER['HTTP_ORIGIN'])) {
        return true; // navegadores antiguos y herramientas: no hay nada que comparar
    }
    $o = parse_url((string)$_SERVER['HTTP_ORIGIN']);
    if (!is_array($o) || !isset($o['host']) || $o['host'] === '') {
        return false; // incluye «Origin: null» (iframes aislados, archivos locales...)
    }
    $origen = $o['host'] . (isset($o['port']) ? ':' . $o['port'] : '');
    $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : '';
    // (sin :80 ni :443, por si el proxy del hosting los añade al Host)
    $origen = (string)preg_replace('/:(80|443)\z/', '', strtolower($origen));
    $host = (string)preg_replace('/:(80|443)\z/', '', strtolower($host));
    return $host !== '' && hash_equals($host, $origen);
}

// Lee la petición: devuelve [acción, cuerpo]. Solo POST.
function peticion(): array
{
    $metodo = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
    if ($metodo !== 'POST') {
        throw new Fallo(405, ['error' => 'metodo'], ['Allow: POST']);
    }
    $enUrl = isset($_GET['accion']) ? $_GET['accion'] : null;
    if ($enUrl !== null && !in_array($enUrl, ACCIONES, true)) {
        throw new Fallo(400, ['error' => 'accion']);
    }
    if (!origen_valido()) {
        throw new Fallo(403, ['error' => 'origen']);
    }

    $tipo = '';
    if (isset($_SERVER['CONTENT_TYPE'])) {
        $tipo = (string)$_SERVER['CONTENT_TYPE'];
    } elseif (isset($_SERVER['HTTP_CONTENT_TYPE'])) {
        $tipo = (string)$_SERVER['HTTP_CONTENT_TYPE'];
    }
    $tipo = strtolower(trim(explode(';', $tipo)[0], " \t"));
    if ($tipo !== 'application/json' && $tipo !== 'text/plain') {
        throw new Fallo(415, ['error' => 'contenido']);
    }

    if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > MAX_CUERPO) {
        throw new Fallo(413, ['error' => 'grande']);
    }
    $cuerpo = file_get_contents('php://input', false, null, 0, MAX_CUERPO + 1);
    if (!is_string($cuerpo)) {
        throw new Fallo(400, ['error' => 'json']);
    }
    if (strlen($cuerpo) > MAX_CUERPO) {
        throw new Fallo(413, ['error' => 'grande']);
    }
    $e = json_decode($cuerpo, false, 8);
    if (!($e instanceof stdClass)) {
        throw new Fallo(400, ['error' => 'json']);
    }

    $enCuerpo = campo($e, 'accion');
    if ($enCuerpo !== null && !in_array($enCuerpo, ACCIONES, true)) {
        throw new Fallo(400, ['error' => 'accion']);
    }
    if ($enUrl !== null && $enCuerpo !== null && $enUrl !== $enCuerpo) {
        throw new Fallo(400, ['error' => 'accion']);
    }
    $accion = $enCuerpo !== null ? $enCuerpo : $enUrl;
    if ($accion === null) {
        throw new Fallo(400, ['error' => 'accion']);
    }
    return [$accion, $e];
}

/* ---------- Almacén ---------- */

// Candado único del almacén de copias. $modo: LOCK_SH (leer), LOCK_EX (cambiar) o LOCK_UN.
// Devuelve el modo actual (con null, solo lo consulta).
function candado(?int $modo): int
{
    static $f = null;
    static $actual = LOCK_UN;
    if ($modo === null || $modo === $actual) {
        return $actual;
    }
    if ($modo === LOCK_UN) {
        if ($f !== null) {
            flock($f, LOCK_UN);
        }
        $actual = LOCK_UN;
        return $actual;
    }
    if ($f === null) {
        $h = @fopen(COPIAS . '/candado.lock', 'c');
        if ($h === false) {
            throw almacen();
        }
        $f = $h;
    }
    if ($actual !== LOCK_UN) {
        flock($f, LOCK_UN); // cambiar de compartido a exclusivo no es atómico: se suelta antes
    }
    if (!flock($f, $modo)) {
        $actual = LOCK_UN;
        throw almacen();
    }
    $actual = $modo;
    return $actual;
}

// La carpeta de las copias se crea sola la primera vez (con un index.html vacío)
function preparar(): bool
{
    if (!is_dir(DATOS) || !is_writable(DATOS)) {
        return false;
    }
    if (!is_dir(COPIAS)) {
        if (!@mkdir(COPIAS, 0700) && !is_dir(COPIAS)) {
            return false; // (otro proceso pudo crearla a la vez: entonces vale)
        }
        @file_put_contents(COPIAS . '/index.html', '');
    }
    return is_writable(COPIAS);
}

// El archivo de una copia no se llama como su identificador (con la lista de archivos se podría
// usar la API), sino como un hash suyo con separador de dominio. No hace falta sal secreta: el
// identificador sale del código pasando por PBKDF2, así que probar códigos es igual de lento
// desde aquí que desde el identificador.
function ruta_copia(string $id): string
{
    if (!texto_hex($id, 32)) {
        throw new LogicException('id');
    }
    return COPIAS . '/' . substr(hash('sha256', 'juegos-peques/copia/archivo|' . $id), 0, 32) . '.php';
}

// Lee un archivo de datos (quitando la guarda). null si no existe o está roto.
function leer_archivo(string $ruta)
{
    if (candado(null) === LOCK_UN) {
        throw new LogicException('leer sin candado');
    }
    $txt = @file_get_contents($ruta);
    if (!is_string($txt) || strncmp($txt, GUARDA, strlen(GUARDA)) !== 0) {
        return null;
    }
    return json_decode(substr($txt, strlen(GUARDA)), true, 8);
}

function codificar($valor): string
{
    $json = json_encode($valor, JSON_OPCIONES);
    if ($json === false) {
        throw new RuntimeException('json');
    }
    return $json;
}

// Escritura atómica: temporal (también .php y con guarda) y rename encima del bueno
function escribir_archivo(string $ruta, string $json): void
{
    if (candado(null) !== LOCK_EX) {
        throw new LogicException('escribir sin candado');
    }
    $texto = GUARDA . $json . "\n";
    $tmp = $ruta . '.' . bin2hex(random_bytes(6)) . '.tmp.php';
    $f = @fopen($tmp, 'xb');
    if ($f === false) {
        throw almacen();
    }
    $ok = fwrite($f, $texto) === strlen($texto) && fflush($f);
    fclose($f);
    if (!$ok || !@rename($tmp, $ruta)) {
        @unlink($tmp);
        throw almacen();
    }
}

// Nombres de los archivos de la carpeta de copias que cumplen el patrón
function listar(string $patron): array
{
    $nombres = @scandir(COPIAS);
    if (!is_array($nombres)) {
        return [];
    }
    $r = [];
    foreach ($nombres as $n) {
        if (preg_match($patron, $n) === 1) {
            $r[] = $n;
        }
    }
    return $r;
}

function edad(string $ruta): int
{
    clearstatcache(true, $ruta);
    $t = @filemtime($ruta);
    return $t === false ? PHP_INT_MAX : time() - $t;
}

// La copia viva, o null si no existe, lleva un año sin usarse o está rota
function cargar_copia(string $id): ?array
{
    $ruta = ruta_copia($id);
    if (edad($ruta) > VIDA_COPIA) {
        return null;
    }
    $c = leer_archivo($ruta);
    if (!is_array($c) || !isset($c['version'], $c['datos']) || !is_int($c['version']) || !is_string($c['datos'])) {
        return null;
    }
    return $c;
}

function contar_copias(): int
{
    return count(listar('/\A[0-9a-f]{32}\.php\z/'));
}

/* ---------- Límites ---------- */

// Los momentos (segundos) de una lista que siguen dentro de la ventana
function recientes($lista, int $ventana): array
{
    $r = [];
    if (is_array($lista)) {
        foreach ($lista as $t) {
            if (is_int($t) && $t > time() - $ventana && $t <= time()) {
                $r[] = $t;
            }
        }
    }
    return $r;
}

// Todo en un archivo: {pimienta, creada, fallos: {huella: [momentos]}, crear: {huella: [momentos]}}.
// Si la pimienta ya tiene una hora (o no hay archivo), se empieza de cero con otra: ninguna huella vive
// más que su pimienta.
function cargar_intentos(): array
{
    $i = leer_archivo(INTENTOS);
    if (is_array($i) && isset($i['pimienta'], $i['creada']) && texto_hex($i['pimienta'], 64)
        && is_int($i['creada']) && $i['creada'] <= time() && time() - $i['creada'] < VIDA_PIMIENTA) {
        return [
            'pimienta' => $i['pimienta'],
            'creada' => $i['creada'],
            'fallos' => isset($i['fallos']) && is_array($i['fallos']) ? $i['fallos'] : [],
            'crear' => isset($i['crear']) && is_array($i['crear']) ? $i['crear'] : [],
        ];
    }
    return ['pimienta' => bin2hex(random_bytes(32)), 'creada' => time(), 'fallos' => [], 'crear' => [], 'nueva' => true];
}

// Guarda los intentos con solo lo que sigue dentro de su ventana y, como mucho, MAX_HUELLAS
// huellas por mapa (se van las que llevan más tiempo sin intentar nada: la que apunta pasa al final)
function guardar_intentos(array $i): void
{
    $limpiar = function (array $mapa, int $ventana): array {
        $r = [];
        foreach ($mapa as $h => $ts) {
            $ts = recientes($ts, $ventana);
            if ($ts !== [] && texto_hex((string)$h, 5)) {
                $r[(string)$h] = array_slice($ts, -60);
            }
        }
        return array_slice($r, -MAX_HUELLAS, null, true);
    };
    escribir_archivo(INTENTOS, codificar([
        'pimienta' => $i['pimienta'],
        'creada' => $i['creada'],
        'fallos' => (object)$limpiar($i['fallos'], VENTANA_FALLOS),
        'crear' => (object)$limpiar($i['crear'], VENTANA_CREAR),
    ]));
}

// Huella de la IP (nunca la IP en claro). En IPv6 cuenta el /64: es lo que tiene una casa. Solo 20 bits
// del HMAC: cada valor corresponde a unas 4096 IPv4, así que ni con la pimienta (está en el mismo
// archivo) se saca la IP. Que dos conexiones compartan huella solo hace el límite algo más estricto.
function huella_ip(string $pimienta): string
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : '';
    $bin = @inet_pton($ip);
    if ($bin === false) {
        $clave = 'desconocida';
    } elseif (strlen($bin) === 16 && substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        $clave = (string)inet_ntop(substr($bin, 12)); // IPv4 escrita como IPv6
    } elseif (strlen($bin) === 16) {
        $clave = bin2hex(substr($bin, 0, 8)) . '/64';
    } else {
        $clave = (string)inet_ntop($bin);
    }
    return substr(hash_hmac('sha256', $clave, $pimienta), 0, 5);
}

function demasiados(array $lista, int $ventana): Fallo
{
    $espera = max(1, min($lista) + $ventana - time());
    return new Fallo(429, ['error' => 'limite'], ['Retry-After: ' . $espera]);
}

// Antes de buscar una copia: si esta conexión ya ha probado demasiados identificadores que no
// existen, 429 para todo (también para los que existen: si no, el 429 diría cuáles no existen y el
// límite no serviría de nada).
function mirar_fallos(): void
{
    $i = cargar_intentos();
    $h = huella_ip($i['pimienta']);
    $mios = recientes(isset($i['fallos'][$h]) ? $i['fallos'][$h] : [], VENTANA_FALLOS);
    if (count($mios) >= FALLOS_IP) {
        throw demasiados($mios, VENTANA_FALLOS);
    }
}

// Un identificador que no existe: se apunta para esta huella y 404
function no_existe(): Fallo
{
    candado(LOCK_EX);
    $i = cargar_intentos();
    $h = huella_ip($i['pimienta']);
    $mios = recientes(isset($i['fallos'][$h]) ? $i['fallos'][$h] : [], VENTANA_FALLOS);
    unset($i['fallos'][$h]);
    $mios[] = time();
    $i['fallos'][$h] = $mios;
    guardar_intentos($i);
    return new Fallo(404, ['error' => 'no-existe']);
}

/* ---------- Limpieza ---------- */

// Copias que llevan un año sin usarse, temporales huérfanos (de una escritura que se cortó) y la
// pimienta si ya tiene una hora (y con ella, las huellas). Primero borra y luego escribe: con el
// disco lleno, lo que se pueda borrar se borra igual.
function limpiar(): void
{
    candado(LOCK_EX);
    foreach (listar('/\A[0-9a-f]{32}\.php\z/') as $n) {
        $ruta = COPIAS . '/' . $n;
        if (edad($ruta) > VIDA_COPIA) {
            @unlink($ruta);
        }
    }
    foreach (listar('/\.tmp\.php\z/') as $n) {
        $ruta = COPIAS . '/' . $n;
        if (edad($ruta) > 600) {
            @unlink($ruta);
        }
    }
    $i = cargar_intentos();
    if (!empty($i['nueva']) || edad(INTENTOS) > VENTANA_CREAR) {
        guardar_intentos($i); // pimienta nueva (o lo viejo ya caducado fuera)
    }
    escribir_archivo(MARCA_LIMPIEZA, '{}');
}

// La limpieza, como mucho cada hora, la pida quien la pida: mirar si toca es solo leer la fecha
// de la marca.
function limpiar_si_toca(): void
{
    if (edad(MARCA_LIMPIEZA) < LIMPIAR_CADA) {
        return;
    }
    candado(LOCK_EX);
    if (edad(MARCA_LIMPIEZA) >= LIMPIAR_CADA) { // (otro pudo limpiar mientras se esperaba)
        try {
            limpiar();
        } catch (Fallo $f) {
            error_log('copia.php: no se pudo limpiar: ' . $f->getMessage()); // (la petición sigue)
        }
    }
    candado(LOCK_UN);
}

/* ---------- Acciones ---------- */

function leer(stdClass $e): array
{
    $id = validar_id(campo($e, 'id'));
    $tengo = campo($e, 'tengo');
    if ($tengo !== null) {
        $tengo = validar_version($tengo, 'tengo');
    }
    candado(LOCK_SH);
    mirar_fallos();
    $c = cargar_copia($id);
    if ($c === null) {
        throw no_existe();
    }
    // El «último uso» es la fecha del archivo: se apunta al leer (una vez al día basta)
    $ruta = ruta_copia($id);
    if (edad($ruta) > TOCAR_CADA) {
        @touch($ruta);
    }
    if ($tengo !== null && $tengo === $c['version']) {
        return ['version' => $c['version'], 'igual' => true];
    }
    return ['version' => $c['version'], 'datos' => $c['datos']];
}

function escribir(stdClass $e): array
{
    $id = validar_id(campo($e, 'id'));
    $version = validar_version(campo($e, 'version'), 'version');
    $datos = validar_datos(campo($e, 'datos'));
    candado(LOCK_EX);
    mirar_fallos();
    $c = cargar_copia($id);
    if ($version === 0) {
        if ($c !== null) {
            // (con 128 bits no pasa por azar: es el mismo código creado otra vez)
            throw new Fallo(409, ['error' => 'existe', 'version' => $c['version']]);
        }
        $i = cargar_intentos();
        $h = huella_ip($i['pimienta']);
        $hechas = recientes(isset($i['crear'][$h]) ? $i['crear'][$h] : [], VENTANA_CREAR);
        if (count($hechas) >= CREAR_IP) {
            throw demasiados($hechas, VENTANA_CREAR);
        }
        if (contar_copias() >= MAX_COPIAS) {
            throw new Fallo(503, ['error' => 'lleno'], ['Retry-After: 3600']);
        }
        @unlink(ruta_copia($id)); // (la de hace más de un año que aún no se había limpiado)
        escribir_archivo(ruta_copia($id), codificar(['version' => 1, 'fecha' => time(), 'datos' => $datos]));
        unset($i['crear'][$h]);
        $hechas[] = time();
        $i['crear'][$h] = $hechas;
        guardar_intentos($i);
        return ['version' => 1];
    }
    if ($c === null) {
        throw no_existe();
    }
    if ($c['version'] !== $version) {
        // Ha cambiado desde que el cliente la leyó: se le da la de ahora para que mezcle
        throw new Fallo(409, ['error' => 'version', 'version' => $c['version'], 'datos' => $c['datos']]);
    }
    $nueva = $version + 1;
    escribir_archivo(ruta_copia($id), codificar(['version' => $nueva, 'fecha' => time(), 'datos' => $datos]));
    return ['version' => $nueva];
}

function borrar(stdClass $e): array
{
    $id = validar_id(campo($e, 'id'));
    candado(LOCK_EX);
    mirar_fallos();
    $ruta = ruta_copia($id);
    if (cargar_copia($id) === null) {
        throw no_existe();
    }
    if (!@unlink($ruta)) {
        throw almacen();
    }
    return ['ok' => true];
}

/* ---------- Principal ---------- */

function principal(): void
{
    list($accion, $e) = peticion();
    if (!is_file(PUERTA) && !is_file(SIN_PUERTA) && !is_file(SIN_PUERTA . '.txt')) {
        throw new Fallo(403, ['error' => 'sin-puerta']);
    }
    if (!preparar()) {
        throw almacen();
    }
    limpiar_si_toca();
    switch ($accion) {
        case 'leer':
            $r = leer($e);
            break;
        case 'escribir':
            $r = escribir($e);
            break;
        default:
            $r = borrar($e);
    }
    responder(200, $r);
}

// Tarea programada (en el hosting, una vez al día basta): «php copia.php limpiar» limpia y sale,
// para que lo caducado se borre aunque nadie vuelva a abrir la web
if (PHP_SAPI === 'cli') {
    $orden = isset($_SERVER['argv'][1]) ? (string)$_SERVER['argv'][1] : '';
    if ($orden !== 'limpiar') {
        fwrite(STDERR, "Uso: php copia.php limpiar\n");
        exit(2);
    }
    try {
        if (!preparar()) {
            throw almacen();
        }
        limpiar();
        candado(LOCK_UN);
    } catch (Throwable $t) {
        fwrite(STDERR, 'copia.php: no se pudo limpiar (' . get_class($t) . ': ' . $t->getMessage() . ")\n");
        exit(1);
    }
    exit(0);
}

try {
    principal();
} catch (Fallo $f) {
    responder($f->estado, $f->cuerpo, $f->cabeceras);
} catch (Throwable $t) {
    error_log('copia.php: ' . get_class($t) . ': ' . $t->getMessage());
    responder(500, ['error' => 'servidor']);
}
