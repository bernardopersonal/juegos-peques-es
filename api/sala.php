<?php
/* Sala del 1 contra 1 en red de la Batalla de bloques (docs/DUELO.md, sección C).
 *
 * Endpoint único y sin base de datos: las salas son archivos dentro de api/datos/.
 *   GET  ?accion=ping                                   → {ok:true}  (ligero: no prueba a escribir)
 *   GET  ?accion=ping&comprobar=1                       → {ok:true}  (para el despliegue: escribe
 *                                                          de verdad en cada carpeta y prueba el candado)
 *   POST {accion:'crear',  heroe}                       → {sala, token, codigo:[a,b,c,d], yo:0}
 *   POST {accion:'unirse', codigo:[a,b,c,d], cid?}      → {sala, token, yo:1, heroeRival}
 *   POST {accion:'leer',   sala, token, desde}          → {mensajes:[{n, tipo, datos}],
 *                                                           rival:{unido, conectado, visto}, cerrada}
 *   POST {accion:'enviar', sala, token, tipo, datos, cid} → {n}
 *   POST {accion:'salir',  sala, token}                 → {ok:true}
 * La acción va en el cuerpo o en la URL (?accion=leer). El cuerpo es JSON, con Content-Type
 * application/json o text/plain (lo que manda sendBeacon). Errores: {error:'...'} con 4xx/5xx:
 *   400 json | accion | invalido (+campo)   403 token | origen   404 no-existe   405 metodo
 *   409 llena | cerrada | tope   413 grande   415 contenido   429 limite (+Retry-After)
 *   500 almacen | servidor   503 ocupado
 * rival.visto: segundos desde que se vio al rival (null si aún no ha entrado).
 * Tarea programada (línea de órdenes, sin HTTP): «php sala.php limpiar» limpia y sale.
 *
 * Lo usan niños, así que:
 * - De ellos no se guarda nada: solo el héroe y las jugadas. Las IPs, nunca en claro: para
 *   limitar intentos se guarda un HMAC de la IP (del /64 en IPv6) con una pimienta que cambia
 *   cada hora, y al cambiarla se borran todos los límites. Mientras dura, quien copiase datos/
 *   podría probar IPs contra ella: es un dato seudónimo, no anónimo.
 * - Lo caducado no desaparece solo: lo borra la limpieza, que corre como mucho cada 5 min con
 *   cualquier petición (también el ping) y con la tarea programada. Se lleva las salas con 3 h
 *   sin actividad y los códigos caducados, y si la pimienta ya tiene una hora, la cambia y borra
 *   todos los límites. Si nadie llama, todo se queda como estaba: para eso es la tarea programada.
 * - Los datos son archivos .php que empiezan por una guarda que corta la ejecución, y sus
 *   nombres no se pueden adivinar (la sala es aleatoria y el código, un HMAC con la sal secreta).
 *   Si el .htaccess de datos/ no se aplicase, por URL no se leería nada ni se podrían buscar
 *   códigos, pero sí se vería qué archivos existen: lo que protege de verdad es el .htaccess.
 *   Se guardan con < y > escapados (JSON_HEX_TAG), así que dentro nunca aparece otra etiqueta
 *   de PHP.
 * - Un único candado (flock) para todo el almacén: compartido para leer y exclusivo para
 *   cambiar algo. Cada archivo se escribe entero en un temporal y se cambia con rename.
 * - Tokens con random_bytes. Solo se guarda su hash y se compara con hash_equals.
 * - Sin CORS: solo responde a la propia web (si el navegador manda Origin, tiene que coincidir).
 *
 * Compatible con PHP 7.4 a 8.x.
 */
declare(strict_types=1);

// Nunca se enseñan avisos ni rutas: los errores van solo al registro del servidor
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
ini_set('serialize_precision', '-1'); // los decimales de las jugadas salen tal cual entraron
error_reporting(E_ALL);
ignore_user_abort(true); // si el niño cierra la pestaña a medias, la escritura se acaba igual
umask(0077);             // carpetas 0700 y archivos 0600: solo los lee el usuario de PHP
header_remove('X-Powered-By');

const DATOS = __DIR__ . '/datos';
const MARCA_LIMPIEZA = DATOS . '/limpieza.php'; // su fecha es la de la última limpieza
const GUARDA = "<?php http_response_code(404); exit; ?>\n";
const JSON_OPCIONES = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG;

const ACCIONES = ['ping', 'crear', 'unirse', 'leer', 'enviar', 'salir'];
const TIPOS = ['inicio', 'jugada', 'turno', 'otra', 'adios'];
const HEROES = ['steve', 'alex'];
const ANIMALES = 12;             // Red.ANIMALES: el código son 4 índices de 0 a 11

const MAX_CUERPO = 32768;        // bytes por petición
const MAX_MENSAJES = 500;        // guardados por sala; al llegar aquí...
const RECORTE_MENSAJES = 100;    // ...se quedan solo los últimos (lo viejo ya está entregado)
const MAX_BYTES_SALA = 4194304;  // lo que pueden ocupar los mensajes de una sala (4 MB)
const MAX_SALAS = 200;           // salas vivas a la vez (protege el disco del hosting)
const VIDA_CODIGO = 900;         // el código caduca a los 15 min
const VIDA_SALA = 10800;         // la sala, a las 3 h sin actividad
const VIDA_LIMITES = 3600;       // los contadores de intentos y la pimienta de sus huellas, a la hora
const CONECTADO = 25;            // el rival está conectado si se le ha visto hace menos de 25 s
const LATIDO = 5;                // el «visto» de leer se apunta como mucho cada 5 s
const UNIRSE_FALLOS = 10;        // unirse fallidos por IP...
const UNIRSE_FALLOS_TODOS = 40;  // ...y entre todas las IPs (≤ 50: apuntar_intento guarda 50)...
const UNIRSE_VENTANA = 600;      // ...cada 10 min
const REINTENTO_UNIRSE = 120;    // unirse repetido con el mismo cid: vale 2 min
const CREAR_MAX = 30;            // salas creadas por IP...
const CREAR_VENTANA = 3600;      // ...cada hora
const TODOS = 'todos';           // la «huella» del cupo de todas las IPs juntas
const HUELLAS_POR_CUBO = 64;     // límites: 16 archivos por tipo, con 64 huellas como mucho cada uno
const LIMPIAR_CADA = 300;        // la limpieza corre como mucho cada 5 min

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

function credenciales(stdClass $e): array
{
    $sala = campo($e, 'sala');
    $token = campo($e, 'token');
    if (!texto_hex($sala, 16)) {
        throw invalido('sala');
    }
    if (!texto_hex($token, 32)) {
        throw invalido('token');
    }
    return [$sala, $token];
}

// Identificador que pone el cliente a cada envío para que los reintentos no dupliquen
function cid_valido($cid): bool
{
    return is_string($cid) && preg_match('/\A[A-Za-z0-9_-]{1,64}\z/', $cid) === 1;
}

// Código de sala: exactamente 4 enteros de 0 a 11 (sin textos, decimales ni claves raras)
function validar_codigo($c): array
{
    if (!is_array($c) || array_keys($c) !== [0, 1, 2, 3]) {
        throw invalido('codigo');
    }
    foreach ($c as $x) {
        if (!is_int($x) || $x < 0 || $x >= ANIMALES) {
            throw invalido('codigo');
        }
    }
    return $c;
}

// Si el navegador dice de dónde viene la petición, tiene que ser de esta misma web
// (evita que otra página use la sala a escondidas con un formulario o un sendBeacon).
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

// Lee la petición: devuelve [acción, cuerpo]. El cuerpo es un objeto (stdClass) para que
// los datos de las jugadas se guarden y devuelvan tal cual ({} sigue siendo {}).
function peticion(): array
{
    $metodo = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
    $enUrl = isset($_GET['accion']) ? $_GET['accion'] : null;
    if ($enUrl !== null && !in_array($enUrl, ACCIONES, true)) {
        throw new Fallo(400, ['error' => 'accion']);
    }
    if ($enUrl === 'ping' && ($metodo === 'GET' || $metodo === 'HEAD' || $metodo === 'POST')) {
        return ['ping', new stdClass()];
    }
    if ($metodo !== 'POST') {
        throw new Fallo(405, ['error' => 'metodo'], ['Allow: GET, POST']);
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
    $e = json_decode($cuerpo, false, 32);
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

// Candado único de todo el almacén. $modo: LOCK_SH (leer), LOCK_EX (cambiar) o LOCK_UN.
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
        $h = @fopen(DATOS . '/candado.lock', 'c');
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

// Las carpetas de dentro de datos/ se crean solas la primera vez (con un index.html vacío).
// Con $crear = false solo mira que se pueda escribir, sin crear nada (el ping normal).
function preparar(bool $crear = true): bool
{
    if (!is_dir(DATOS) || !is_writable(DATOS)) {
        return false;
    }
    foreach (['salas', 'codigos', 'limites'] as $d) {
        $ruta = DATOS . '/' . $d;
        if (!is_dir($ruta)) {
            if (!$crear) {
                continue;
            }
            if (!@mkdir($ruta, 0700) && !is_dir($ruta)) {
                return false; // (otro proceso pudo crearla a la vez: entonces vale)
            }
            @file_put_contents($ruta . '/index.html', '');
        }
        if (!is_writable($ruta)) {
            return false;
        }
    }
    return true;
}

// Para el ping con comprobar=1: escribe y borra de verdad un archivo en cada carpeta
function probar_escritura(): bool
{
    foreach (['', '/salas', '/codigos', '/limites'] as $d) {
        $tmp = DATOS . $d . '/prueba-' . bin2hex(random_bytes(6)) . '.tmp.php';
        $f = @fopen($tmp, 'xb');
        if ($f === false) {
            return false;
        }
        $ok = fwrite($f, GUARDA) === strlen(GUARDA);
        fclose($f);
        @unlink($tmp);
        if (!$ok) {
            return false;
        }
    }
    return true;
}

// Las rutas solo se construyen con ids ya validados (y se vuelven a comprobar aquí)
function ruta_sala(string $sala, bool $mensajes = false): string
{
    if (!texto_hex($sala, 16)) {
        throw new LogicException('sala');
    }
    return DATOS . '/salas/' . $sala . ($mensajes ? '.mensajes' : '') . '.php';
}

// El archivo de un código no se llama como el código (se podría ver por URL cuáles existen y
// recorrerlos todos sin gastar intentos), sino como un HMAC suyo con la sal secreta
function ruta_codigo(array $codigo): string
{
    $clave = 'codigo|' . implode('-', validar_codigo($codigo));
    return DATOS . '/codigos/' . substr(hash_hmac('sha256', $clave, sal()), 0, 32) . '.php';
}

// Los límites van en cubos: 16 archivos por tipo (por el primer carácter de la huella), cada uno
// con un mapa huella → momentos, así que no hay más archivos por haber más IPs. El cupo de todos
// va en su propio archivo (ninguna huella lo puede echar de un cubo lleno).
function ruta_limite(string $tipo, string $huella): string
{
    if ($tipo !== 'u' && $tipo !== 'c') {
        throw new LogicException('limite');
    }
    if ($huella === TODOS) {
        return DATOS . '/limites/' . $tipo . '-todos.php';
    }
    if (!texto_hex($huella, 32)) {
        throw new LogicException('limite');
    }
    return DATOS . '/limites/' . $tipo . '-' . $huella[0] . '.php';
}

// Lee un archivo de datos (quitando la guarda). null si no existe o está roto.
function leer_archivo(string $ruta, bool $asociativo)
{
    if (candado(null) === LOCK_UN) {
        throw new LogicException('leer sin candado');
    }
    $txt = @file_get_contents($ruta);
    if (!is_string($txt) || strncmp($txt, GUARDA, strlen(GUARDA)) !== 0) {
        return null;
    }
    return json_decode(substr($txt, strlen(GUARDA)), $asociativo, 64);
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
function escribir(string $ruta, string $json): void
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

// Nombres de los archivos de una carpeta de datos que cumplen el patrón
function listar(string $carpeta, string $patron): array
{
    $nombres = @scandir(DATOS . '/' . $carpeta);
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

/* ---------- Salas, códigos y límites ---------- */

// La sala viva, o null si no existe o lleva 3 h sin actividad
function cargar_sala(string $sala): ?array
{
    $ruta = ruta_sala($sala);
    if (edad($ruta) > VIDA_SALA) {
        return null;
    }
    $m = leer_archivo($ruta, true);
    if (!is_array($m) || !isset($m['j'][0]['token']) || !array_key_exists(1, $m['j'])) {
        return null;
    }
    return $m;
}

function guardar_sala(string $sala, array $m): void
{
    escribir(ruta_sala($sala), codificar($m));
}

// Lista de mensajes de la sala (objetos: los datos vuelven tal cual llegaron). Si el
// archivo existe pero no se entiende, error: nunca se empieza de cero encima de él.
function cargar_mensajes(string $sala): array
{
    $ruta = ruta_sala($sala, true);
    if (edad($ruta) === PHP_INT_MAX) {
        return [];
    }
    $l = leer_archivo($ruta, false);
    if (!is_array($l)) {
        throw almacen();
    }
    return $l;
}

// ¿Qué jugador es este token? (0 o 1). Si no es de la sala, 403.
function jugador(array $m, string $token): int
{
    $hash = hash('sha256', $token);
    $yo = -1;
    foreach ([0, 1] as $i) {
        $t = isset($m['j'][$i]['token']) ? $m['j'][$i]['token'] : null;
        if (is_string($t) && hash_equals($t, $hash)) {
            $yo = $i;
        }
    }
    if ($yo < 0) {
        throw new Fallo(403, ['error' => 'token']);
    }
    return $yo;
}

function nuevo_jugador(string $heroe, string $token): array
{
    $ahora = time();
    return ['heroe' => $heroe, 'token' => hash('sha256', $token), 'entro' => $ahora, 'visto' => $ahora, 'fuera' => false, 'ultimo' => 0];
}

function borrar_sala(string $sala, array $m): void
{
    @unlink(ruta_sala($sala, true));
    @unlink(ruta_sala($sala));
    // y su código, si todavía apunta a esta sala
    $c = isset($m['codigo']) ? $m['codigo'] : null;
    if (is_string($c) && preg_match('/\A([0-9]|1[01])(-([0-9]|1[01])){3}\z/', $c) === 1) {
        $rc = ruta_codigo(array_map('intval', explode('-', $c)));
        $dc = leer_archivo($rc, true);
        if (is_array($dc) && isset($dc['sala']) && $dc['sala'] === $sala) {
            @unlink($rc);
        }
    }
}

// La sal secreta: aleatoria, guardada en datos/ (con guarda) la primera vez, y no cambia nunca
// (firma los tokens de unirse con cid y da nombre a los archivos de los códigos)
function sal(): string
{
    static $sal = null;
    if ($sal !== null) {
        return $sal;
    }
    $ruta = DATOS . '/sal.php';
    $s = leer_archivo($ruta, true);
    if (is_array($s) && isset($s['sal']) && texto_hex($s['sal'], 64)) {
        $sal = $s['sal'];
    } else {
        $sal = bin2hex(random_bytes(32));
        escribir($ruta, codificar(['sal' => $sal]));
    }
    return $sal;
}

// La pimienta de las huellas de IP: aleatoria, aparte de la sal y nueva cada hora. Al cambiarla
// se borran todos los límites, así que ninguna huella vive más que su pimienta.
function pimienta(): string
{
    $ruta = DATOS . '/pimienta.php';
    $p = leer_archivo($ruta, true);
    if (is_array($p) && isset($p['pimienta'], $p['creada']) && texto_hex($p['pimienta'], 64)
        && is_int($p['creada']) && $p['creada'] <= time() && time() - $p['creada'] < VIDA_LIMITES) {
        return $p['pimienta'];
    }
    foreach (listar('limites', '/\.php\z/') as $n) {
        @unlink(DATOS . '/limites/' . $n);
    }
    $nueva = bin2hex(random_bytes(32));
    escribir($ruta, codificar(['pimienta' => $nueva, 'creada' => time()]));
    return $nueva;
}

// Huella de la IP (nunca la IP en claro). En IPv6 cuenta el /64: es lo que tiene una casa
// (quien tenga muchas, choca con el cupo de todos de unirse).
function huella_ip(): string
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
    return substr(hash_hmac('sha256', $clave, pimienta()), 0, 32);
}

// Los momentos (segundos) de una lista que siguen dentro de la ventana
function recientes($lista, int $ventana): array
{
    $r = [];
    if (is_array($lista)) {
        foreach ($lista as $t) {
            if (is_int($t) && $t > time() - $ventana) {
                $r[] = $t;
            }
        }
    }
    return $r;
}

// Momentos de los intentos de esta huella que siguen dentro de la ventana
function intentos(string $tipo, string $huella, int $ventana): array
{
    $cubo = leer_archivo(ruta_limite($tipo, $huella), true);
    return is_array($cubo) && isset($cubo[$huella]) ? recientes($cubo[$huella], $ventana) : [];
}

// Apunta un intento más. Las otras huellas del cubo se quedan con lo que siga dentro de la
// ventana y, si aun así son demasiadas, se van las que llevan más tiempo sin intentar nada
// (el mapa va en ese orden: la que apunta pasa al final).
function apuntar_intento(string $tipo, string $huella, array $lista, int $ventana): void
{
    $ruta = ruta_limite($tipo, $huella);
    $antes = leer_archivo($ruta, true);
    $cubo = [];
    if (is_array($antes)) {
        foreach ($antes as $h => $ts) {
            $ts = recientes($ts, $ventana);
            if ($ts !== [] && (string)$h !== $huella) {
                $cubo[(string)$h] = $ts;
            }
        }
    }
    $lista[] = time();
    $cubo[$huella] = array_slice($lista, -50);
    escribir($ruta, codificar(array_slice($cubo, -HUELLAS_POR_CUBO, null, true)));
}

function demasiados(array $lista, int $ventana): Fallo
{
    $espera = max(1, min($lista) + $ventana - time());
    return new Fallo(429, ['error' => 'limite'], ['Retry-After: ' . $espera]);
}

// ¿Este código está repartido ahora mismo (aunque ya se haya usado)?
function codigo_vivo(string $ruta): bool
{
    return edad($ruta) <= VIDA_CODIGO;
}

function contar_salas(): int
{
    return count(listar('salas', '/\A[0-9a-f]{16}\.php\z/'));
}

// Limpieza: códigos caducados, salas sin actividad, contadores viejos, temporales huérfanos (de
// una escritura que se cortó) y la pimienta si ya tiene una hora (y con ella, los límites). Primero
// borra y luego escribe: con el disco lleno, lo que se pueda borrar se borra igual.
function limpiar(): void
{
    candado(LOCK_EX);
    foreach (listar('codigos', '/\A[0-9a-f]{32}\.php\z/') as $n) {
        $ruta = DATOS . '/codigos/' . $n;
        if (edad($ruta) > VIDA_CODIGO) {
            @unlink($ruta);
        }
    }
    foreach (listar('salas', '/\A[0-9a-f]{16}(\.mensajes)?\.php\z/') as $n) {
        $sala = substr($n, 0, 16);
        if (edad(ruta_sala($sala)) > VIDA_SALA) {
            @unlink(DATOS . '/salas/' . $n); // (sin la sala, sus mensajes tampoco sirven)
        }
    }
    foreach (listar('limites', '/\A[uc]-([0-9a-f]|todos)\.php\z/') as $n) {
        $ruta = DATOS . '/limites/' . $n;
        if (edad($ruta) > VIDA_LIMITES) {
            @unlink($ruta);
        }
    }
    foreach (['.', 'salas', 'codigos', 'limites'] as $d) {
        foreach (listar($d, '/\.tmp\.php\z/') as $n) {
            $ruta = DATOS . '/' . $d . '/' . $n;
            if (edad($ruta) > 600) {
                @unlink($ruta);
            }
        }
    }
    pimienta();
    escribir(MARCA_LIMPIEZA, '{}');
}

// La limpieza, como mucho cada 5 min, la pida quien la pida (también el ping): mirar si toca
// es solo leer la fecha de la marca.
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
            error_log('sala.php: no se pudo limpiar: ' . $f->getMessage()); // (la petición sigue)
        }
    }
    candado(LOCK_UN);
}

/* ---------- Acciones ---------- */

function crear(stdClass $e): array
{
    $heroe = campo($e, 'heroe');
    if (!in_array($heroe, HEROES, true)) {
        throw invalido('heroe');
    }
    candado(LOCK_EX);
    $huella = huella_ip();
    $hechas = intentos('c', $huella, CREAR_VENTANA);
    if (count($hechas) >= CREAR_MAX) {
        throw demasiados($hechas, CREAR_VENTANA);
    }
    if (contar_salas() >= MAX_SALAS) {
        throw new Fallo(503, ['error' => 'ocupado'], ['Retry-After: 60']);
    }
    // Un código que no esté repartido (hay 12^4 = 20 736)
    $codigo = null;
    for ($i = 0; $i < 60 && $codigo === null; $i++) {
        $c = [random_int(0, ANIMALES - 1), random_int(0, ANIMALES - 1), random_int(0, ANIMALES - 1), random_int(0, ANIMALES - 1)];
        if (!codigo_vivo(ruta_codigo($c))) {
            $codigo = $c;
        }
    }
    $sala = bin2hex(random_bytes(8));
    if ($codigo === null || edad(ruta_sala($sala)) !== PHP_INT_MAX) {
        throw new Fallo(503, ['error' => 'ocupado'], ['Retry-After: 60']);
    }
    $token = bin2hex(random_bytes(16));
    guardar_sala($sala, [
        'v' => 1,
        'creada' => time(),
        'codigo' => implode('-', $codigo),
        'cerrada' => false,
        'n' => 0,
        'j' => [nuevo_jugador($heroe, $token), null],
    ]);
    escribir(ruta_codigo($codigo), codificar(['sala' => $sala, 'usado' => false]));
    apuntar_intento('c', $huella, $hechas, CREAR_VENTANA);
    return ['sala' => $sala, 'token' => $token, 'codigo' => $codigo, 'yo' => 0];
}

// cid (opcional, aleatorio, 16-64 caracteres): si se corta la red y se pierde la respuesta,
// el reintento con el mismo cid en los 2 minutos siguientes recibe el mismo token en vez de
// «llena». El token sale de la sal secreta, la sala y el cid (HMAC): tampoco va en claro.
function unirse(stdClass $e): array
{
    $codigo = validar_codigo(campo($e, 'codigo'));
    $cid = campo($e, 'cid');
    if ($cid !== null && (!cid_valido($cid) || strlen($cid) < 16)) {
        throw invalido('cid');
    }
    candado(LOCK_EX);
    $huella = huella_ip();
    $fallos = intentos('u', $huella, UNIRSE_VENTANA);
    if (count($fallos) >= UNIRSE_FALLOS) {
        throw demasiados($fallos, UNIRSE_VENTANA);
    }
    // Y el cupo de todos: hay solo 12^4 códigos y con muchas IPs (un bloque IPv6, proxies) se
    // podrían probar todos. El precio: quien ataque deja a todo el mundo sin poder unirse
    // durante 10 min, que es mejor que un extraño entre en la partida de un niño.
    $fallosTodos = intentos('u', TODOS, UNIRSE_VENTANA);
    if (count($fallosTodos) >= UNIRSE_FALLOS_TODOS) {
        throw demasiados($fallosTodos, UNIRSE_VENTANA);
    }
    $rc = ruta_codigo($codigo);
    $dc = codigo_vivo($rc) ? leer_archivo($rc, true) : null;
    $sala = is_array($dc) && isset($dc['sala']) && texto_hex($dc['sala'], 16) ? $dc['sala'] : null;
    $m = $sala !== null ? cargar_sala($sala) : null;
    if ($m === null || !empty($m['cerrada'])) {
        apuntar_intento('u', $huella, $fallos, UNIRSE_VENTANA);
        apuntar_intento('u', TODOS, $fallosTodos, UNIRSE_VENTANA);
        throw new Fallo(404, ['error' => 'no-existe']);
    }
    $rival = $m['j'][0]['heroe'] === 'alex' ? 'alex' : 'steve';
    $token = $cid !== null
        ? substr(hash_hmac('sha256', 'unirse|' . $sala . '|' . $cid, sal()), 0, 32)
        : bin2hex(random_bytes(16));
    $respuesta = ['sala' => $sala, 'token' => $token, 'yo' => 1, 'heroeRival' => $rival];
    if (!empty($dc['usado']) || $m['j'][1] !== null) {
        $j = $m['j'][1];
        if ($cid !== null && is_array($j) && isset($j['entro']) && time() - (int)$j['entro'] <= REINTENTO_UNIRSE
            && is_string($j['token']) && hash_equals($j['token'], hash('sha256', $token))) {
            return $respuesta; // es el mismo que acaba de entrar: reintento
        }
        apuntar_intento('u', $huella, $fallos, UNIRSE_VENTANA);
        apuntar_intento('u', TODOS, $fallosTodos, UNIRSE_VENTANA);
        throw new Fallo(409, ['error' => 'llena']);
    }
    $m['j'][1] = nuevo_jugador($rival === 'steve' ? 'alex' : 'steve', $token);
    guardar_sala($sala, $m);
    // Un solo uso: queda marcado como usado (para poder decir «ya ha empezado») y caduca
    // a los 15 min de crearse, como cualquier código.
    $creado = time() - edad($rc);
    escribir($rc, codificar(['sala' => $sala, 'usado' => true]));
    @touch($rc, $creado);
    return $respuesta;
}

function leer(stdClass $e): array
{
    list($sala, $token) = credenciales($e);
    $desde = campo($e, 'desde');
    if ($desde === null) {
        $desde = 0;
    }
    if (!is_int($desde) || $desde < 0) {
        throw invalido('desde');
    }
    candado(LOCK_SH);
    $m = cargar_sala($sala);
    if ($m === null) {
        throw new Fallo(404, ['error' => 'no-existe']);
    }
    $yo = jugador($m, $token);
    $otro = 1 - $yo;
    $mensajes = [];
    if (is_array($m['j'][$otro]) && $m['j'][$otro]['ultimo'] > $desde) {
        foreach (cargar_mensajes($sala) as $msj) {
            if ($msj->de === $otro && $msj->n > $desde) {
                $mensajes[] = ['n' => $msj->n, 'tipo' => $msj->tipo, 'datos' => $msj->datos];
            }
        }
    }
    // Latido: apunta mi «visto» (sin reescribir la sala en cada sondeo). La respuesta sale de la
    // primera lectura, la de los mensajes: si en el hueco del candado el rival manda algo y sale,
    // «cerrada» llega en la lectura siguiente, junto con lo último que mandó.
    if (time() - $m['j'][$yo]['visto'] >= LATIDO) {
        candado(LOCK_EX);
        $m2 = cargar_sala($sala);
        if ($m2 !== null) {
            $m2['j'][$yo]['visto'] = time();
            guardar_sala($sala, $m2);
        }
    }
    candado(LOCK_UN);
    $rival = $m['j'][$otro];
    $visto = is_array($rival) ? max(0, time() - (int)$rival['visto']) : null;
    return [
        'mensajes' => $mensajes,
        'rival' => [
            'unido' => is_array($rival),
            'conectado' => is_array($rival) && empty($rival['fuera']) && $visto < CONECTADO,
            'visto' => $visto,
        ],
        'cerrada' => !empty($m['cerrada']),
    ];
}

function enviar(stdClass $e): array
{
    list($sala, $token) = credenciales($e);
    $tipo = campo($e, 'tipo');
    if (!in_array($tipo, TIPOS, true)) {
        throw invalido('tipo');
    }
    $cid = campo($e, 'cid');
    if (!cid_valido($cid)) {
        throw invalido('cid');
    }
    $datos = campo($e, 'datos');
    candado(LOCK_EX);
    $m = cargar_sala($sala);
    if ($m === null) {
        throw new Fallo(404, ['error' => 'no-existe']);
    }
    $yo = jugador($m, $token);
    $lista = cargar_mensajes($sala);
    $ultimo = 0;
    foreach ($lista as $msj) {
        if ($msj->de === $yo && $msj->cid === $cid) {
            // Reintento de algo que ya llegó: el mismo n, sin duplicar
            if ($m['j'][$yo]['ultimo'] < $msj->n) {
                $m['j'][$yo]['ultimo'] = $msj->n; // (por si se cortó entre las dos escrituras)
                guardar_sala($sala, $m);
            }
            return ['n' => $msj->n];
        }
        $ultimo = max($ultimo, $msj->n);
    }
    if (!empty($m['cerrada'])) {
        throw new Fallo(409, ['error' => 'cerrada']);
    }
    if (count($lista) >= MAX_MENSAJES) {
        // Van por turnos: a cada uno solo le pueden faltar unos pocos mensajes del otro. Lo viejo
        // ya está entregado y sobra (se quedan los últimos, también para que el cid no duplique).
        $lista = array_slice($lista, -RECORTE_MENSAJES);
    }
    $n = $ultimo + 1;
    $lista[] = (object)['n' => $n, 'de' => $yo, 'tipo' => $tipo, 'cid' => $cid, 'datos' => $datos];
    $json = codificar($lista);
    if (strlen($json) > MAX_BYTES_SALA) {
        throw new Fallo(409, ['error' => 'tope']);
    }
    // Primero los mensajes (mandan sobre n) y luego la sala
    escribir(ruta_sala($sala, true), $json);
    $m['n'] = $n;
    $m['j'][$yo]['ultimo'] = $n;
    $m['j'][$yo]['visto'] = time();
    guardar_sala($sala, $m);
    return ['n' => $n];
}

function salir(stdClass $e): array
{
    list($sala, $token) = credenciales($e);
    candado(LOCK_EX);
    $m = cargar_sala($sala);
    if ($m === null) {
        throw new Fallo(404, ['error' => 'no-existe']);
    }
    $yo = jugador($m, $token);
    $m['j'][$yo]['fuera'] = true;
    $m['j'][$yo]['visto'] = time();
    $m['cerrada'] = true;
    $otro = $m['j'][1 - $yo];
    if ($otro === null || !empty($otro['fuera'])) {
        borrar_sala($sala, $m); // ya no queda nadie que tenga que enterarse: fuera datos
    } else {
        guardar_sala($sala, $m); // el rival verá cerrada: true
    }
    return ['ok' => true];
}

/* ---------- Principal ---------- */

function principal(): void
{
    list($accion, $e) = peticion();
    if ($accion === 'ping') {
        // El de siempre es ligero (lo puede pedir cualquiera): mira que PHP responde y que datos/
        // se puede escribir, sin probarlo (como a cualquier petición, le puede tocar la limpieza).
        // Con comprobar=1, para el despliegue: crea las carpetas, escribe de verdad en cada una y
        // prueba el candado.
        $comprobar = isset($_GET['comprobar']) && $_GET['comprobar'] === '1';
        $ok = false;
        try {
            $ok = $comprobar
                ? preparar() && probar_escritura() && candado(LOCK_SH) === LOCK_SH
                : preparar(false);
            if ($ok) {
                limpiar_si_toca();
            }
        } catch (Fallo $f) {
            $ok = false;
        }
        if (!$ok) {
            responder(500, ['ok' => false, 'error' => 'almacen']);
        }
        responder(200, ['ok' => true]);
    }
    if (!preparar()) {
        throw almacen();
    }
    limpiar_si_toca();
    switch ($accion) {
        case 'crear':
            $r = crear($e);
            break;
        case 'unirse':
            $r = unirse($e);
            break;
        case 'leer':
            $r = leer($e);
            break;
        case 'enviar':
            $r = enviar($e);
            break;
        default:
            $r = salir($e);
    }
    responder(200, $r);
}

// Tarea programada (en el panel del hosting, cada hora): «php sala.php limpiar»
// limpia y sale, para que lo caducado se borre aunque nadie vuelva a jugar
if (PHP_SAPI === 'cli') {
    $orden = isset($_SERVER['argv'][1]) ? (string)$_SERVER['argv'][1] : '';
    if ($orden !== 'limpiar') {
        fwrite(STDERR, "Uso: php sala.php limpiar\n");
        exit(2);
    }
    try {
        if (!preparar(false)) {
            throw almacen();
        }
        limpiar();
        candado(LOCK_UN);
    } catch (Throwable $t) {
        fwrite(STDERR, 'sala.php: no se pudo limpiar (' . get_class($t) . ': ' . $t->getMessage() . ")\n");
        exit(1);
    }
    exit(0);
}

try {
    principal();
} catch (Fallo $f) {
    responder($f->estado, $f->cuerpo, $f->cabeceras);
} catch (Throwable $t) {
    error_log('sala.php: ' . get_class($t) . ': ' . $t->getMessage());
    responder(500, ['error' => 'servidor']);
}
