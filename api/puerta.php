<?php
/* Puerta con contraseña de la web (docs/PUERTA-Y-COPIA.md).
 *
 * Sin configurar no hace nada: la web se ve sin contraseña (así sale la versión pública). Configurada,
 * el .htaccess de la carpeta de la web (entre «# PUERTA-INICIO» y «# PUERTA-FIN», lo escribe este
 * archivo) no deja ver nada sin la cookie jp_puerta con el token: la API responde 401 y todo lo demás
 * redirige aquí. Lo comprueba Apache (mod_rewrite) en cada petición: no depende del JS.
 *
 *   GET                  → «🔒 Escribe la contraseña» (si ya se tiene la cookie buena, a la web)
 *   POST clave           → la buena: cookie y a la web (303). Si no, otra vez con aviso (o 429).
 *   ?no=api              → 401 {"error":"puerta"} (a esto reescribe el .htaccess la API sin cookie)
 *   ?accion=revisar      → {ok:true}. Si la puerta está configurada y el .htaccess no tiene su bloque
 *                          (se ha subido por FTP el del repo, con la red de seguridad: RED), lo vuelve a escribir.
 *                          Lo pide app.js al arrancar en los aparatos que ya pasaron (cookie jp_puerta_hay).
 *                          (La red también manda aquí la primera petición que llegue, sea de quien sea.)
 *   ?configurar          → poner o cambiar la contraseña, cerrar la sesión en todos los aparatos o
 *                          quitarla. Solo con el permiso de ESTE navegador: la página le da un código (en
 *                          una cookie HttpOnly) y el dueño crea por FTP api/datos/PERMITIR_PUERTA-<código>,
 *                          vacío (es la prueba de que lo es; vale 30 min). Un extraño que mire la puerta a
 *                          la vez ve otro código: ni puede usar ese archivo ni sabe que está. Al terminar,
 *                          se borra.
 *
 * Seguridad:
 * - La contraseña, con password_hash. El token, 32 bytes de random_bytes, nuevo cada vez que se
 *   configura: así se cierra la sesión en todos los aparatos. Los dos, en api/datos/puerta.php, con la
 *   misma guarda que los datos de sala.php (y el .htaccess de datos/, que no deja abrir nada por URL).
 * - Intentos: 10 por huella de IP y 60 entre todas cada 15 min. Se apuntan antes de comprobar la
 *   contraseña (así no se cuelan en paralelo) y, si era la buena, se olvidan los de esa huella. La
 *   huella: HMAC de la IP (del /64 en IPv6) con una pimienta propia que cambia cada hora (y con ella se
 *   borran las huellas), recortado a 20 bits (cada valor vale para miles de IPs: con el archivo no se
 *   saca la IP). Todo en un archivo con un máximo de huellas: no crece.
 * - Los intentos que se comprueban tardan lo mismo (TIEMPO_POST): por el tiempo no se sabe si la
 *   contraseña era buena. Los que no se comprueban (límite pasado, desde otra web, sin permiso), al
 *   momento: su respuesta ya dice por qué, y así no dejan a PHP sin procesos para la API.
 * - Los aparatos con la cookie no pasan por aquí: aunque alguien agote los intentos, la familia sigue
 *   jugando (solo no podría entrar un aparato nuevo durante 15 min).
 * - Cookie HttpOnly, SameSite=Lax, Secure si la conexión es https y Path = la carpeta de la web.
 * - Páginas sin nada de fuera (ni fuentes ni scripts: CSP con nonce) y sin CORS (si el navegador manda
 *   Origin, tiene que ser esta misma web).
 * - El bloque: sin mod_rewrite da error 500 en toda la carpeta (mejor cerrada que abierta); vale también
 *   en las subcarpetas aunque tengan su propio .htaccess con reglas (RewriteOptions InheritDownBefore,
 *   Apache 2.4.8 o más; en uno más viejo, error 500); y lo de detrás de la puerta sale con
 *   «Cache-Control: private» y «Vary: Cookie» (si hay mod_headers), para que una caché compartida no se
 *   lo dé a otro.
 *
 * Compatible con PHP 7.4 a 8.x.
 */
declare(strict_types=1);

// Nunca se enseñan avisos ni rutas: los errores van solo al registro del servidor
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
ignore_user_abort(true); // si se corta a medias, la configuración se acaba igual
umask(0077);             // los datos, 0600: solo los lee el usuario de PHP (el .htaccess, aparte)
header_remove('X-Powered-By');
define('EMPEZO', isset($_SERVER['REQUEST_TIME_FLOAT']) ? (float)$_SERVER['REQUEST_TIME_FLOAT'] : microtime(true));

const DATOS = __DIR__ . '/datos';
const CONFIG = DATOS . '/puerta.php';            // hash, token, carpeta de la web y fecha
const INTENTOS = DATOS . '/puerta-intentos.php'; // pimienta y momentos de los intentos
const CANDADO = DATOS . '/puerta.lock';
const PERMISO = 'PERMITIR_PUERTA';               // + «-<código>» (y .txt, si Windows se lo pone sin avisar)
const HTACCESS = __DIR__ . '/../.htaccess';      // el de la carpeta de la web
const GUARDA = "<?php http_response_code(404); exit; ?>\n";
const JSON_OPCIONES = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG;

const COOKIE = 'jp_puerta';          // el token (HttpOnly)
const COOKIE_HAY = 'jp_puerta_hay';  // «este aparato ya pasó»: la lee app.js para pedir revisar
const COOKIE_PERMISO = 'jp_puerta_permiso'; // el código del permiso de este navegador (HttpOnly)
const VIDA_COOKIE = 34560000;        // 400 días (lo máximo que guardan los navegadores)
const VIDA_PERMISO = 1800;           // PERMITIR_PUERTA-<código> vale 30 min desde que se sube
const VIDA_CODIGO = 7200;            // el código, 2 h en el navegador (para crear el archivo con calma)
const LETRAS_CODIGO = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32: sin l, o, 0 ni 1, que se confunden
const LARGO_CODIGO = 10;             // 50 bits
const FALLOS_IP = 10;                // intentos por huella de IP...
const FALLOS_TODOS = 60;             // ...y entre todas...
const VENTANA = 900;                 // ...cada 15 min
const VIDA_PIMIENTA = 3600;          // la pimienta de las huellas (y con ella las huellas), una hora
const MAX_HUELLAS = 200;
const TIEMPO_POST = 1.0;             // segundos que tarda un intento de contraseña
const CLAVE_MIN = 12;
const CLAVE_MAX = 72;                // bytes (password_hash no mira más allá)
const MARCA_INICIO = '# PUERTA-INICIO';
const MARCA_FIN = '# PUERTA-FIN';
// Lo que se ve sin la cookie (no tiene nada de la familia): los iconos y el manifiesto, para que el
// icono de la pantalla de inicio salga (el navegador los pide sin cookies). Va tal cual al .htaccess.
const LIBRES = 'icono-180\.png|icono-512\.png|icono\.svg|manifest\.webmanifest';
// Lo que va entre las marcas sin puerta (igual que en el .htaccess del repo): una red por si, con la puerta
// puesta, se sube por FTP el .htaccess del repo encima del del servidor. Si existe api/datos/puerta.php y
// entre las marcas está esto (no el bloque de la puerta), todo lo que no sea la puerta, los iconos o el
// manifiesto va a la puerta (302), que al abrirse vuelve a escribir su bloque: la familia vuelve sola a la
// web con su cookie y un extraño se queda fuera. Las condiciones sacan, de la propia petición, la carpeta
// de la web en el disco (para mirar el archivo) y en la URL (para la redirección). Sin puerta solo mira si
// está el archivo, y sin mod_rewrite no hace nada (así la versión pública funciona en cualquier hosting).
const RED = "# Red de seguridad de la puerta (api/puerta.php): sin puerta no hace nada. Si la hay y aquí está esto\n"
    . "# en vez de su bloque (se ha subido el .htaccess del repo encima), todo va a la puerta, que lo arregla.\n"
    . "<IfModule mod_rewrite.c>\n"
    . "RewriteEngine On\n"
    . 'RewriteCond $1 !^(api/puerta\.php|' . LIBRES . ")\$\n"
    . 'RewriteCond %{REQUEST_FILENAME}::$1 ^(.*/)(.*)::\2$' . "\n"
    . "RewriteCond %1api/datos/puerta.php -f\n"
    . 'RewriteCond %{REQUEST_URI}::$1 ^(.*/)(.*)::\2$' . "\n"
    . 'RewriteRule ^(.*)$ %1api/puerta.php [R=302,L]' . "\n"
    . "</IfModule>\n";

/* ---------- Utilidades ---------- */

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function texto_hex($v, int $largo): bool
{
    return is_string($v) && preg_match('/\A[0-9a-f]{' . $largo . '}\z/', $v) === 1;
}

// Hasta que el POST haya tardado TIEMPO_POST (si ya ha tardado más, nada)
function igualar_tiempo(): void
{
    $falta = EMPEZO + TIEMPO_POST - microtime(true);
    if ($falta > 0) {
        usleep((int)($falta * 1000000));
    }
}

// La carpeta de la web vista desde fuera («/juegos/»), sacada de la ruta de este script. Va a la
// cookie (Path) y al .htaccess, así que solo vale con letras, números y . _ ~ - entre barras.
function base_actual(): ?string
{
    $s = isset($_SERVER['SCRIPT_NAME']) ? (string)$_SERVER['SCRIPT_NAME'] : '';
    if (preg_match('#\A((?:/[A-Za-z0-9._~-]+)*)/api/puerta\.php\z#', $s, $m) !== 1) {
        return null;
    }
    foreach (explode('/', $m[1]) as $trozo) {
        if ($trozo === '.' || $trozo === '..') {
            return null;
        }
    }
    return $m[1] . '/';
}

// ¿Llega por https? Vale cualquier señal (el proxy del hosting no siempre pone HTTPS=on, y el
// formulario dice lo que ve el navegador). Si alguna mintiese, la cookie saldría Secure por http y el
// navegador no la guardaría: solo se quedaría fuera quien miente.
function es_https(): bool
{
    $s = $_SERVER;
    $proto = isset($s['HTTP_X_FORWARDED_PROTO']) ? strtolower(trim(explode(',', (string)$s['HTTP_X_FORWARDED_PROTO'])[0])) : '';
    return (isset($s['HTTPS']) && $s['HTTPS'] !== '' && strtolower((string)$s['HTTPS']) !== 'off')
        || (isset($s['SERVER_PORT']) && (string)$s['SERVER_PORT'] === '443')
        || (isset($s['REQUEST_SCHEME']) && strtolower((string)$s['REQUEST_SCHEME']) === 'https')
        || $proto === 'https'
        || (isset($s['HTTP_ORIGIN']) && strncasecmp((string)$s['HTTP_ORIGIN'], 'https://', 8) === 0)
        || (isset($_POST['https']) && $_POST['https'] === '1');
}

// Si el navegador dice de dónde viene el POST, tiene que ser de esta misma web (como en sala.php)
function origen_valido(): bool
{
    if (!isset($_SERVER['HTTP_ORIGIN'])) {
        return true;
    }
    $o = parse_url((string)$_SERVER['HTTP_ORIGIN']);
    if (!is_array($o) || !isset($o['host']) || $o['host'] === '') {
        return false; // incluye «Origin: null»
    }
    $origen = $o['host'] . (isset($o['port']) ? ':' . $o['port'] : '');
    $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : '';
    $origen = (string)preg_replace('/:(80|443)\z/', '', strtolower($origen));
    $host = (string)preg_replace('/:(80|443)\z/', '', strtolower($host));
    return $host !== '' && hash_equals($host, $origen);
}

/* ---------- Almacén (api/datos/, como sala.php) ---------- */

// Candado propio (no el de sala.php): exclusivo para todo lo que cambia algo
function candado(bool $coger): void
{
    static $f = null;
    if (!$coger) {
        if ($f !== null) {
            flock($f, LOCK_UN);
        }
        return;
    }
    if ($f === null) {
        $a = @fopen(CANDADO, 'c');
        if ($a === false) {
            throw new RuntimeException('candado');
        }
        $f = $a;
    }
    if (!flock($f, LOCK_EX)) {
        throw new RuntimeException('candado');
    }
}

// Un archivo de datos (sin la guarda): array, o null si no está o está roto
function leer(string $ruta): ?array
{
    $txt = @file_get_contents($ruta);
    if (!is_string($txt) || strncmp($txt, GUARDA, strlen(GUARDA)) !== 0) {
        return null;
    }
    $v = json_decode(substr($txt, strlen(GUARDA)), true, 16);
    return is_array($v) ? $v : null;
}

// Escritura atómica: temporal (también .php y con guarda) y rename encima
function escribir(string $ruta, array $valor): void
{
    $json = json_encode($valor, JSON_OPCIONES);
    if ($json === false) {
        throw new RuntimeException('json');
    }
    $texto = GUARDA . $json . "\n";
    $tmp = $ruta . '.' . bin2hex(random_bytes(6)) . '.tmp.php';
    $ok = @file_put_contents($tmp, $texto) === strlen($texto);
    if (!$ok || !@rename($tmp, $ruta)) {
        @unlink($tmp);
        throw new RuntimeException('escribir ' . basename($ruta));
    }
}

// La configuración guardada, o null si no hay puerta (o el archivo no se entiende)
function cargar_config(): ?array
{
    $c = leer(CONFIG);
    if ($c === null || !isset($c['hash'], $c['token'], $c['base'], $c['creada']) || !is_string($c['hash'])
        || !texto_hex($c['token'], 64) || !is_string($c['base']) || !is_int($c['creada'])
        || preg_match('#\A(/[A-Za-z0-9._~-]+)*/\z#', $c['base']) !== 1) {
        return null;
    }
    return $c;
}

function cookie_valida(array $c): bool
{
    return isset($_COOKIE[COOKIE]) && is_string($_COOKIE[COOKIE]) && hash_equals($c['token'], $_COOKIE[COOKIE]);
}

// La cookie del token y la de «ya pasó» (o, con $quitar, las borra)
function poner_cookies(array $c, bool $quitar = false): void
{
    $o = ['expires' => $quitar ? 1 : time() + VIDA_COOKIE, 'path' => $c['base'], 'secure' => es_https(), 'httponly' => true, 'samesite' => 'Lax'];
    setcookie(COOKIE, $quitar ? '' : $c['token'], $o);
    $o['httponly'] = false;
    setcookie(COOKIE_HAY, $quitar ? '' : '1', $o);
}

// La cookie del código de permiso (con '', la borra). Solo para la carpeta api/ de la web.
function poner_cookie_permiso(string $codigo): void
{
    $base = base_actual();
    setcookie(COOKIE_PERMISO, $codigo, ['expires' => $codigo === '' ? 1 : time() + VIDA_CODIGO, 'path' => $base === null ? '/' : $base . 'api/',
        'secure' => es_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

/* ---------- El bloque del .htaccess ---------- */

// Lo que va entre las marcas. Solo depende de la configuración: así se puede comparar con el que hay.
// Si se configuró por https, la puerta va siempre por https: Apache completa la dirección con lo que
// cree que es (y detrás del proxy https de un hosting compartido puede creer que es http).
function bloque(array $c): string
{
    $t = $c['token'];
    $b = $c['base'];
    $puerta = (!empty($c['https']) ? 'https://%{HTTP_HOST}' : '') . $b . 'api/puerta.php';
    $sinCookie = 'RewriteCond %{HTTP_COOKIE} !(^|;)\s*' . COOKIE . '=' . $t . '\s*(;|$)';
    return '# Lo escribe api/puerta.php (puerta del ' . gmdate('Y-m-d H:i', $c['creada']) . " UTC): no lo cambies a mano.\n"
        . "# Sin la cookie de la puerta, la API responde 401 (JSON) y todo lo demás va a la puerta. Sin ella\n"
        . "# solo se ven la puerta, los iconos y el manifiesto (el icono de la pantalla de inicio) y el ping\n"
        . "# de la sala (la limpieza). Sin mod_rewrite, error 500: mejor cerrada que abierta. Vale también en\n"
        . "# las subcarpetas con su propio .htaccess (InheritDownBefore: Apache 2.4.8 o más; si no, error 500)\n"
        . "# y una caché compartida (CDN, proxy) no puede guardar lo de dentro para dárselo a otro.\n"
        . "RewriteEngine On\n"
        . "RewriteOptions InheritDownBefore\n"
        . "<IfModule mod_headers.c>\n"
        . "    Header always merge Cache-Control private\n"
        . "    Header always merge Vary Cookie\n"
        . "</IfModule>\n"
        . $sinCookie . "\n"
        . "RewriteCond \$1::%{QUERY_STRING} !^sala\\.php::accion=ping\$\n"
        . 'RewriteRule ^api/(?!puerta\.php$)(.*)$ ' . $b . "api/puerta.php?no=api [L]\n"
        . $sinCookie . "\n"
        . 'RewriteRule !^(api/|(' . LIBRES . ')$) ' . $puerta . " [R=302,L]\n";
}

// El texto del .htaccess con $dentro entre las marcas. Sin marcas, el bloque va al final. null si las
// marcas están mal (repetidas, una sola o al revés): entonces no se toca nada.
function con_bloque(string $texto, string $dentro): ?string
{
    $inicio = '/^' . preg_quote(MARCA_INICIO, '/') . '[ \t]*\r?$/m';
    $fin = '/^' . preg_quote(MARCA_FIN, '/') . '[ \t]*\r?$/m';
    $ni = preg_match_all($inicio, $texto);
    $nf = preg_match_all($fin, $texto);
    if ($ni === 0 && $nf === 0) {
        if ($dentro === '') {
            return $texto;
        }
        $antes = rtrim($texto);
        return ($antes === '' ? '' : $antes . "\n\n") . MARCA_INICIO . "\n" . $dentro . MARCA_FIN . "\n";
    }
    if ($ni !== 1 || $nf !== 1) {
        return null;
    }
    $patron = '/^(' . preg_quote(MARCA_INICIO, '/') . '[ \t]*\r?\n).*?^(' . preg_quote(MARCA_FIN, '/') . ')/ms';
    $n = 0;
    $r = preg_replace_callback($patron, function (array $m) use ($dentro): string {
        return $m[1] . $dentro . $m[2];
    }, $texto, 1, $n);
    return is_string($r) && $n === 1 ? $r : null;
}

// Pone el bloque de la configuración $c (o, con null, la red de RED, como en el repo) en el .htaccess.
// Escribe solo si cambia, en un temporal y con rename, con los mismos permisos que tenía (Apache lo
// tiene que poder leer). true si al acabar el .htaccess es el que toca.
function escribir_htaccess(?array $c): bool
{
    $existe = is_file(HTACCESS);
    $antes = $existe ? @file_get_contents(HTACCESS) : '';
    if (!is_string($antes)) {
        return false;
    }
    $nuevo = con_bloque($antes, $c === null ? RED : bloque($c));
    if ($nuevo === null) {
        error_log('puerta.php: las marcas del .htaccess están mal; no lo toco');
        return false;
    }
    if ($nuevo === $antes) {
        return true;
    }
    $permisos = $existe ? (@fileperms(HTACCESS) & 0777) : 0644;
    $tmp = dirname(HTACCESS) . '/.htaccess.' . bin2hex(random_bytes(6)) . '.tmp';
    $ok = @file_put_contents($tmp, $nuevo) === strlen($nuevo) && @chmod($tmp, $permisos ?: 0644) && @rename($tmp, HTACCESS);
    if (!$ok) {
        @unlink($tmp);
        error_log('puerta.php: no se pudo escribir el .htaccess');
    }
    return $ok;
}

// Si hay puerta y su bloque no está en el .htaccess, lo vuelve a poner. true si queda bien (o si no
// hay puerta). Sin configuración no toca nada: un bloque que se quedase sin ella deja fuera a los
// aparatos nuevos, nunca abre la web.
function reparar(): bool
{
    if (!is_file(CONFIG)) {
        return true;
    }
    candado(true);
    $c = cargar_config();
    $ok = $c === null || escribir_htaccess($c);
    candado(false);
    return $ok;
}

/* ---------- Intentos ---------- */

// Los momentos de una lista que siguen dentro de la ventana
function recientes($lista): array
{
    $r = [];
    if (is_array($lista)) {
        foreach ($lista as $t) {
            if (is_int($t) && $t > time() - VENTANA && $t <= time()) {
                $r[] = $t;
            }
        }
    }
    return $r;
}

// Los intentos guardados, sin lo caducado. Con la pimienta de más de una hora: pimienta nueva y fuera
// todas las huellas (el cupo de todos se queda: no es de nadie).
function cargar_intentos(): array
{
    $t = leer(INTENTOS);
    $ahora = time();
    $todos = recientes(is_array($t) && isset($t['todos']) ? $t['todos'] : []);
    if (!is_array($t) || !isset($t['pimienta'], $t['creada'], $t['ip']) || !texto_hex($t['pimienta'], 64)
        || !is_int($t['creada']) || $t['creada'] > $ahora || $ahora - $t['creada'] >= VIDA_PIMIENTA || !is_array($t['ip'])) {
        return ['pimienta' => bin2hex(random_bytes(32)), 'creada' => $ahora, 'ip' => [], 'todos' => $todos];
    }
    $ip = [];
    foreach ($t['ip'] as $huella => $lista) {
        $r = recientes($lista);
        if ($r !== []) {
            $ip[(string)$huella] = $r;
        }
    }
    return ['pimienta' => $t['pimienta'], 'creada' => $t['creada'], 'ip' => $ip, 'todos' => $todos];
}

// Huella de la IP (nunca la IP en claro): en IPv6 cuenta el /64. Solo 20 bits del HMAC: cada valor
// corresponde a unas 4096 IPv4, así que ni con la pimienta (está en el mismo archivo) se saca la IP. Que
// dos conexiones compartan huella solo hace el límite algo más estricto.
function huella(string $pimienta): string
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

// Apunta un intento antes de comprobar nada. Devuelve [huella, segundos a esperar] (0: puede probar).
// Si ya ha llegado al límite, no se apunta (así no se alarga la espera).
function apuntar_intento(): array
{
    candado(true);
    $t = cargar_intentos();
    $h = huella($t['pimienta']);
    $mias = isset($t['ip'][$h]) ? $t['ip'][$h] : [];
    $espera = 0;
    if (count($mias) >= FALLOS_IP) {
        $espera = min($mias) + VENTANA - time();
    } elseif (count($t['todos']) >= FALLOS_TODOS) {
        $espera = min($t['todos']) + VENTANA - time();
    } else {
        $mias[] = time();
        $t['todos'][] = time();
        unset($t['ip'][$h]);
        $t['ip'][$h] = $mias; // al final: si sobran huellas, se van las que llevan más sin probar
    }
    $t['ip'] = array_slice($t['ip'], -MAX_HUELLAS, null, true);
    escribir(INTENTOS, $t);
    candado(false);
    return [$h, $espera > 0 ? max(1, $espera) : 0];
}

// Era la buena: se olvidan los intentos de esa huella (los de todos se quedan)
function olvidar_intentos(string $h): void
{
    candado(true);
    $t = cargar_intentos();
    if (isset($t['ip'][$h])) {
        unset($t['ip'][$h]);
        escribir(INTENTOS, $t);
    }
    candado(false);
}

// Las huellas no se quedan más de una hora aunque nadie vuelva a probar (lo pide la revisión): con la
// pimienta de una hora, otra nueva y sin huellas. El cupo de todos se queda (si no, borrarlo sería una
// forma de saltárselo).
function caducar_intentos(): void
{
    $t = leer(INTENTOS);
    if ($t !== null && (!isset($t['creada']) || !is_int($t['creada']) || time() - $t['creada'] >= VIDA_PIMIENTA)) {
        candado(true);
        $t = leer(INTENTOS);
        if ($t !== null && (!isset($t['creada']) || !is_int($t['creada']) || time() - $t['creada'] >= VIDA_PIMIENTA)) {
            escribir(INTENTOS, cargar_intentos()); // (cargar_intentos ya la cambia, con lo de todos)
        }
        candado(false);
    }
}

/* ---------- Permiso para configurar ---------- */

// El código del permiso de este navegador (su cookie) o, si no tiene, uno nuevo al azar que se le pone.
// Solo el dueño puede crear en api/datos/ el archivo con ese código: así el permiso vale solo en el
// navegador que lo enseña. Un extraño que mire la puerta a la vez tiene otro código.
function codigo_permiso(): string
{
    $v = isset($_COOKIE[COOKIE_PERMISO]) && is_string($_COOKIE[COOKIE_PERMISO]) ? $_COOKIE[COOKIE_PERMISO] : '';
    if (preg_match('/\A[' . LETRAS_CODIGO . ']{' . LARGO_CODIGO . '}\z/', $v) === 1) {
        return $v;
    }
    $v = '';
    for ($i = 0; $i < LARGO_CODIGO; $i++) {
        $v .= LETRAS_CODIGO[random_int(0, strlen(LETRAS_CODIGO) - 1)];
    }
    poner_cookie_permiso($v);
    return $v;
}

// El archivo PERMITIR_PUERTA-<código> si está: ['ruta' => ..., 'queda' => segundos]. Si tiene más de
// 30 min, lo borra y devuelve ['viejo' => true]. null si no hay.
function permiso(string $codigo): ?array
{
    foreach ([PERMISO . '-' . $codigo, PERMISO . '-' . $codigo . '.txt'] as $n) {
        $ruta = DATOS . '/' . $n;
        clearstatcache(true, $ruta);
        if (!is_file($ruta)) {
            continue;
        }
        $t = @filemtime($ruta);
        $edad = $t === false ? PHP_INT_MAX : time() - $t;
        if ($edad > VIDA_PERMISO || $edad < -300) {
            @unlink($ruta);
            return ['viejo' => true];
        }
        return ['ruta' => $ruta, 'queda' => VIDA_PERMISO - max(0, $edad)];
    }
    return null;
}

// Los archivos de permiso que ya no valen, fuera: los de otros códigos con más de 30 min y los que no
// llevan código (como se hacía antes). true si había alguno sin código (para avisar).
function limpiar_permisos(): bool
{
    $sinCodigo = false;
    foreach ((array)@scandir(DATOS) as $n) {
        if (!is_string($n) || strncmp($n, PERMISO, strlen(PERMISO)) !== 0) {
            continue;
        }
        $ruta = DATOS . '/' . $n;
        $t = @filemtime($ruta);
        if ($n === PERMISO || $n === PERMISO . '.txt') {
            $sinCodigo = true;
            @unlink($ruta);
        } elseif ($t === false || time() - $t > VIDA_PERMISO || $t - time() > 300) {
            @unlink($ruta);
        }
    }
    return $sinCodigo;
}

// Al terminar: todos los archivos de permiso, fuera (también los de otros códigos)
function borrar_permisos(): void
{
    foreach ((array)@scandir(DATOS) as $n) {
        if (is_string($n) && strncmp($n, PERMISO, strlen(PERMISO)) === 0) {
            @unlink(DATOS . '/' . $n);
        }
    }
}

// ¿Vale como contraseña nueva? null si sí; si no, el porqué
function problema_clave(string $clave, string $otra): ?string
{
    if (!hash_equals($clave, $otra)) {
        return 'Las dos no son iguales. Escríbela otra vez en los dos huecos.';
    }
    if (strlen($clave) < CLAVE_MIN) {
        return 'Tiene que tener al menos ' . CLAVE_MIN . ' letras, números o signos.';
    }
    if (strlen($clave) > CLAVE_MAX) {
        return 'Es demasiado larga (como mucho, ' . CLAVE_MAX . ' letras).';
    }
    if (preg_match('//u', $clave) !== 1 || preg_match('/[\x00-\x1f\x7f]/', $clave) === 1) {
        return 'Tiene algún carácter raro. Usa letras, números y signos normales.';
    }
    return null;
}

/* ---------- Páginas ---------- */

// Página completa, con el estilo de la app y sin nada de fuera
function pagina(int $estado, string $titulo, string $cuerpo, string $js = '', array $cabeceras = []): void
{
    $nonce = base64_encode(random_bytes(16));
    http_response_code($estado);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    // (con no-referrer, el navegador mandaría «Origin: null» con el formulario)
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'none'; style-src 'nonce-$nonce'; script-src 'nonce-$nonce'; "
        . "img-src 'self'; connect-src 'self' https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    foreach ($cabeceras as $c) {
        header($c);
    }
    $titulo = h($titulo);
    $css = ESTILO;
    $comun = JS_DIRECCION;
    echo <<<HTML
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#fff7e8">
<title>$titulo · Juegos peques</title>
<link rel="icon" href="../icono.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../icono-180.png">
<style nonce="$nonce">$css</style>
</head>
<body>
<main class="caja">
<img class="icono" src="../icono.svg" alt="" width="72" height="72">
$cuerpo
</main>
<script nonce="$nonce">$comun
$js</script>
</body>
</html>
HTML;
    exit;
}

const ESTILO = <<<'CSS'
:root { --fondo: #fff7e8; --tinta: #3b2f4a; --tarjeta: #fff; --guia: #efe6d8; --acento: #ff6fa5; --sombra: 0 6px 0 rgba(0, 0, 0, .12);
  --letra: 'Fredoka', 'Nunito', 'Arial Rounded MT Bold', system-ui, sans-serif; color-scheme: light; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--fondo); color: var(--tinta); font-family: var(--letra); font-weight: 500; display: flex; justify-content: center;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px)); }
.caja { width: 100%; max-width: 480px; margin: auto 0; background: var(--tarjeta); border-radius: 32px; box-shadow: var(--sombra);
  padding: 28px clamp(18px, 5vw, 32px); display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.icono { width: 72px; height: 72px; border-radius: 18px; box-shadow: var(--sombra); }
h1 { margin: 0; font-size: clamp(26px, 6vw, 34px); font-weight: 700; text-wrap: balance; }
h2 { margin: 8px 0 0; font-size: 20px; }
p { margin: 0; font-size: 18px; line-height: 1.4; text-wrap: balance; }
.suave { opacity: .75; font-size: 16px; }
.aviso { color: #c62828; font-weight: 700; }
.bien { color: #2e7d4f; font-weight: 700; }
form { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
label.campo { display: flex; flex-direction: column; gap: 6px; text-align: left; }
label.campo > span { font-size: 14px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
input[type=password], input[type=text] { font: inherit; font-size: 24px; padding: 12px 16px; border-radius: 18px; border: 3px solid var(--guia);
  background: var(--fondo); color: var(--tinta); width: 100%; }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 4px solid var(--acento); outline-offset: 3px; }
.ver { display: flex; align-items: center; gap: 8px; font-size: 16px; align-self: flex-start; cursor: pointer; }
.ver input { width: 22px; height: 22px; accent-color: var(--acento); }
button, .boton { font: inherit; cursor: pointer; border: 0; text-decoration: none; display: inline-block; }
.principal { background: var(--acento); color: #fff; font-size: 24px; font-weight: 700; padding: 14px 32px; border-radius: 999px; box-shadow: var(--sombra); }
.principal:active { transform: translateY(3px); box-shadow: 0 3px 0 rgba(0, 0, 0, .12); }
.secundario { background: var(--fondo); color: var(--tinta); border: 3px solid var(--guia); font-size: 18px; font-weight: 600; padding: 10px 20px; border-radius: 999px; }
.peligro { color: #c62828; border-color: #f3c4c4; }
.enlace { color: inherit; font-size: 16px; opacity: .75; }
ol { margin: 0; padding-left: 1.4em; text-align: left; font-size: 17px; line-height: 1.45; display: flex; flex-direction: column; gap: 8px; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .92em; background: var(--fondo); padding: 1px 6px; border-radius: 6px; word-break: break-all; }
hr { width: 100%; border: 0; border-top: 3px dashed var(--guia); margin: 6px 0; }
.lista { list-style: none; padding: 0; margin: 0; text-align: left; font-size: 17px; display: flex; flex-direction: column; gap: 6px; width: 100%; }
.confirmar { display: flex; align-items: flex-start; gap: 8px; font-size: 16px; text-align: left; }
.confirmar input { width: 22px; height: 22px; flex: none; accent-color: #c62828; }
.permiso { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.permiso code { font-size: 1.1em; padding: 4px 10px; user-select: all; }
CSS;

// Una sola dirección (como js/app.js): por http:// se pasa a https:// (la contraseña nunca viaja sin
// cifrar) y con www. se quita, pero solo si en esta dirección no hay nada guardado de los niños. Sin
// dominios escritos: solo si la de destino responde, y nunca en localhost, una IP o un puerto propio.
const JS_DIRECCION = <<<'JS'
(function () {
  var l = location, destino = l.hostname.replace(/^www\./i, '');
  if ((l.protocol !== 'http:' && l.protocol !== 'https:') || l.port || destino.indexOf('.') < 0) return;
  if (/^[\d.]+$|^\[|\.(local|localhost|lan|home\.arpa|internal|test)$/i.test(destino)) return;
  var guardado = false;
  try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('jp-') === 0 && k !== 'jp-intro-vista' && k !== 'jp-batalla-silencio') guardado = true; } } catch (e) { /* nada */ }
  if (l.protocol === 'https:' && (destino === l.hostname || guardado)) return;
  if (l.protocol === 'http:' && guardado) destino = l.hostname;
  var carpeta = l.pathname.replace(/[^/]*$/, '');
  fetch('https://' + destino + carpeta + '../manifest.webmanifest', { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
    .then(function () { l.replace('https://' + destino + l.pathname + l.search); }, function () { /* sin https: se queda */ });
})();
document.querySelectorAll('input[name=https]').forEach(function (c) { c.value = location.protocol === 'https:' ? '1' : '0'; });
var ver = document.querySelector('.ver input');
if (ver) ver.addEventListener('change', function () {
  document.querySelectorAll('input[data-clave]').forEach(function (c) { c.type = ver.checked ? 'text' : 'password'; });
});
// «Copiar» el nombre del archivo de permiso (si el navegador no deja, queda seleccionado)
var copiar = document.getElementById('copiar');
if (copiar) copiar.addEventListener('click', function () {
  var n = document.getElementById('nombre-permiso');
  var elegir = function () { var r = document.createRange(); r.selectNodeContents(n); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  try {
    navigator.clipboard.writeText(n.textContent).then(function () { copiar.textContent = '✔ Copiado'; }, elegir);
  } catch (e) { elegir(); }
});
JS;

// Escribe la contraseña
function pagina_entrar(string $mensaje = '', int $estado = 200, array $cabeceras = []): void
{
    $aviso = $mensaje !== '' ? '<p class="aviso" role="alert">' . h($mensaje) . '</p>' : '';
    pagina($estado, 'Escribe la contraseña', <<<HTML
<h1>🔒 Escribe la contraseña</h1>
<p class="suave">Solo hace falta una vez en cada aparato.</p>
$aviso
<form method="post" action="puerta.php" autocomplete="on">
  <input type="hidden" name="accion" value="entrar">
  <input type="hidden" name="https" value="">
  <label class="campo"><span>Contraseña</span>
    <input type="password" name="clave" data-clave autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus maxlength="200">
  </label>
  <label class="ver"><input type="checkbox"> Ver lo que escribo</label>
  <button class="principal" type="submit">Entrar</button>
</form>
<a class="enlace" href="puerta.php?configurar">Cambiar la contraseña</a>
HTML, '', $cabeceras);
}

// Los pasos para dar permiso a este navegador (con su código) y los avisos de lo que había
function pasos_permiso(?array $permiso, string $codigo, bool $sinCodigo, string $despues): string
{
    $nombre = h(PERMISO . '-' . $codigo);
    $avisos = ($permiso !== null && isset($permiso['viejo'])
        ? '<p class="aviso">El archivo de permiso tenía más de 30 minutos y lo he borrado. Crea uno nuevo.</p>' : '')
        . ($sinCodigo ? '<p class="aviso">Había un <code>' . PERMISO . '</code> sin código: ya no vale (ahora el nombre lleva el código de abajo) y lo he borrado.</p>' : '');
    return <<<HTML
$avisos
<ol>
  <li>Con FileZilla, en la carpeta <code>api/datos/</code> de la web en el servidor: botón derecho → «Crear nuevo archivo» → este nombre:
    <span class="permiso"><code id="nombre-permiso">$nombre</code> <button class="secundario" id="copiar" type="button">Copiar</button></span></li>
  <li>$despues</li>
</ol>
<p class="suave">El código vale solo en este navegador: así nadie más puede usar ese archivo. Si al recargar sale otro código, este navegador no guarda las cookies de esta web.</p>
HTML;
}

// Sin puerta: la web se ve sin contraseña
function pagina_sin_puerta(?array $permiso, string $codigo, bool $sinCodigo): void
{
    $pasos = pasos_permiso($permiso, $codigo, $sinCodigo, 'Vuelve aquí y recarga la página (tienes 30 minutos).');
    pagina(200, 'Sin contraseña', <<<HTML
<h1>🔓 Esta web no tiene contraseña</h1>
<p>Para ponerle una:</p>
$pasos
<a class="boton secundario" href="../">Ir a los juegos</a>
HTML);
}

// Para ponerla o cambiarla hace falta el permiso de este navegador (403 si se ha intentado sin él)
function pagina_sin_permiso(?array $permiso, bool $hayPuerta, string $codigo, bool $sinCodigo, int $estado = 200): void
{
    $volver = $hayPuerta ? '<a class="enlace" href="puerta.php">Volver</a>' : '<a class="enlace" href="../">Ir a los juegos</a>';
    $titulo = $hayPuerta ? 'Cambiar la contraseña' : 'Poner contraseña';
    $pasos = pasos_permiso($permiso, $codigo, $sinCodigo, 'Recarga esta página (tienes 30 minutos).');
    pagina($estado, $titulo, <<<HTML
<h1>🔑 $titulo</h1>
<p>Solo lo puede hacer quien sube la web al servidor:</p>
$pasos
$volver
HTML);
}

// Configurar: con el permiso de este navegador
function pagina_configurar(?array $c, array $permiso, string $mensaje = ''): void
{
    $min = max(1, (int)ceil($permiso['queda'] / 60));
    $aviso = $mensaje !== '' ? '<p class="aviso" role="alert">' . h($mensaje) . '</p>' : '';
    $titulo = $c === null ? 'Elige la contraseña' : 'Cambiar la contraseña';
    $minimo = CLAVE_MIN;
    $maximo = CLAVE_MAX;
    $nota = $c === null
        ? 'Para entrar en los juegos desde cualquier aparato. Al menos ' . CLAVE_MIN . ' letras, números o signos: mejor una frase de varias palabras.'
        : 'Todos los aparatos la tendrán que escribir otra vez. Al menos ' . CLAVE_MIN . ' letras, números o signos: mejor una frase de varias palabras.';
    $otras = $c === null ? '' : <<<HTML
<hr>
<form method="post" action="puerta.php?configurar">
  <input type="hidden" name="accion" value="sesiones">
  <input type="hidden" name="https" value="">
  <p class="suave">¿Se ha perdido un aparato? Con la misma contraseña, todos la tendrán que escribir otra vez:</p>
  <button class="secundario" type="submit">Cerrar la sesión en todos los aparatos</button>
</form>
<form method="post" action="puerta.php?configurar">
  <input type="hidden" name="accion" value="quitar">
  <input type="hidden" name="https" value="">
  <label class="confirmar"><input type="checkbox" name="seguro" value="1" required> Sí, quiero que la web se vea sin contraseña</label>
  <button class="secundario peligro" type="submit">Quitar la contraseña</button>
</form>
HTML;
    pagina(200, $titulo, <<<HTML
<h1>🔑 $titulo</h1>
<p class="suave">$nota</p>
$aviso
<form method="post" action="puerta.php?configurar" autocomplete="off">
  <input type="hidden" name="accion" value="clave">
  <input type="hidden" name="https" value="">
  <label class="campo"><span>Contraseña nueva</span>
    <input type="password" name="clave" data-clave autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" required minlength="$minimo" maxlength="$maximo" autofocus>
  </label>
  <label class="campo"><span>Otra vez</span>
    <input type="password" name="otra" data-clave autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" required minlength="$minimo" maxlength="$maximo">
  </label>
  <label class="ver"><input type="checkbox"> Ver lo que escribo</label>
  <button class="principal" type="submit">Guardar</button>
</form>
$otras
<p class="suave">Quedan $min min para usar el archivo de permiso. Al guardar, se borra solo.</p>
HTML);
}

// Hecho: y lo comprueba desde el navegador, sin cookies (como lo vería un extraño)
function pagina_hecha(string $que, bool $ok, string $base): void
{
    if (!$ok) {
        pagina(500, 'No se ha podido', <<<HTML
<h1>⚠️ No se ha podido terminar</h1>
<p>No he podido escribir el <code>.htaccess</code> de la carpeta de la web (permisos, o sus marcas
<code># PUERTA-INICIO</code> y <code># PUERTA-FIN</code> están repetidas o rotas).</p>
<p class="aviso">La puerta puede no estar cerrada.</p>
<p class="suave">El archivo de permiso sigue ahí: arréglalo con FileZilla y vuelve a probar (docs/PUERTA-Y-COPIA.md).</p>
HTML);
    }
    $titulos = ['clave' => '✅ Contraseña guardada', 'sesiones' => '✅ Sesiones cerradas', 'quitar' => '🔓 Contraseña quitada'];
    $textos = [
        'clave' => 'Este aparato ya está dentro. En los demás, la primera vez, la pedirá.',
        'sesiones' => 'Este aparato sigue dentro. Los demás la tendrán que escribir otra vez.',
        'quitar' => 'La web se ve otra vez sin contraseña.',
    ];
    $base = h($base);
    $js = $que === 'quitar' ? "comprobar([['../', 'pasa', 'La portada se ve sin contraseña']]);" : <<<'JS'
comprobar([
  ['../', 'redirige', 'Sin contraseña, la portada va a la puerta'],
  ['../js/app.js', 'redirige', 'Los archivos de la web, también'],
  ['../api/sala.php?accion=leer', 'api', 'La API responde 401'],
  ['../manifest.webmanifest', 'pasa', 'El icono y el manifiesto se ven (pantalla de inicio)'],
]);
JS;
    pagina(200, 'Hecho', <<<HTML
<h1>{$titulos[$que]}</h1>
<p>{$textos[$que]}</p>
<ul class="lista" id="comprobar"><li class="suave">Comprobando…</li></ul>
<p class="suave" id="resumen"></p>
<a class="boton principal" href="$base">Ir a los juegos</a>
HTML, <<<JS
function comprobar(pruebas) {
  var ul = document.getElementById('comprobar'), malas = 0;
  Promise.all(pruebas.map(function (p) {
    return fetch(p[0], { credentials: 'omit', redirect: 'manual', cache: 'no-store' }).then(function (r) {
      return p[1] === 'redirige' ? r.type === 'opaqueredirect' : p[1] === 'api' ? r.status === 401 : r.ok;
    }, function () { return false; }).then(function (bien) {
      if (!bien) malas++;
      var li = document.createElement('li');
      li.className = bien ? 'bien' : 'aviso';
      li.textContent = (bien ? '✔ ' : '✘ ') + p[2];
      return li;
    });
  })).then(function (lis) {
    ul.textContent = '';
    lis.forEach(function (li) { ul.appendChild(li); });
    document.getElementById('resumen').textContent = malas
      ? 'Algo no va como debe: mira «Si algo falla» en docs/PUERTA-Y-COPIA.md.'
      : 'Comprobado desde este navegador, sin cookies (como lo vería un extraño).';
  });
}
$js
JS);
}

/* ---------- Acciones ---------- */

function responder_json(int $estado, array $cuerpo, array $cabeceras = []): void
{
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Referrer-Policy: no-referrer');
    foreach ($cabeceras as $c) {
        header($c);
    }
    echo json_encode($cuerpo, JSON_OPCIONES);
    exit;
}

function redirigir(string $a): void
{
    http_response_code(303);
    header('Cache-Control: no-store');
    header('Location: ' . $a);
    exit;
}

// GET: la pantalla que toque
function ver(): void
{
    $bloqueBien = reparar();
    $c = cargar_config();
    $configurar = isset($_GET['configurar']);
    // Con puerta y sin ?configurar: la contraseña (un aparato de la familia sin la cookie no ve nada más)
    if ($c !== null && !$configurar) {
        if (cookie_valida($c)) {
            if ($bloqueBien) {
                redirigir($c['base']);
            }
            // (si el .htaccess no tiene el bloque bueno y no se ha podido arreglar, mandar a la web
            // volvería aquí sin parar)
            pagina(500, 'La puerta está a medias', <<<HTML
<h1>⚠️ La puerta está a medias</h1>
<p>Tu contraseña está bien, pero el <code>.htaccess</code> de la carpeta de la web no tiene su bloque y no lo he podido poner.</p>
<p class="suave">Mira «Si algo falla» en docs/PUERTA-Y-COPIA.md.</p>
HTML);
        }
        if (isset($_GET['entrar'])) {
            pagina_entrar('Este navegador no ha guardado la cookie de la puerta. Mira que acepta cookies de esta web y vuelve a probar.');
        }
        pagina_entrar();
    }
    // Sin puerta, o ?configurar: con el permiso de este navegador, se configura; sin él, cómo darlo
    $codigo = codigo_permiso();
    $p = permiso($codigo);
    $sinCodigo = limpiar_permisos();
    if ($p !== null && !isset($p['viejo'])) {
        pagina_configurar($c, $p);
    }
    if ($configurar) {
        pagina_sin_permiso($p, $c !== null, $codigo, $sinCodigo);
    }
    pagina_sin_puerta($p, $codigo, $sinCodigo);
}

// POST de la contraseña
function entrar(): void
{
    $clave = isset($_POST['clave']) && is_string($_POST['clave']) ? $_POST['clave'] : '';
    if (strlen($clave) > CLAVE_MAX || strpos($clave, "\0") !== false) {
        $clave = ''; // (no puede ser la buena; se compara igual, para que tarde lo mismo)
    }
    $c = cargar_config();
    if ($c === null) {
        pagina_sin_puerta(null, codigo_permiso(), false);
    }
    list($h, $espera) = apuntar_intento();
    if ($espera > 0) {
        // Con el límite pasado no se comprueba y se responde al momento: el 429 ya dice que hay límite (y
        // unas decenas de envíos seguidos no dejan a PHP sin procesos para la API)
        $min = (int)ceil($espera / 60);
        pagina_entrar('Demasiados intentos. Espera ' . $min . ' min y vuelve a probar.', 429, ['Retry-After: ' . $espera]);
    }
    if (password_verify($clave, $c['hash'])) {
        olvidar_intentos($h);
        poner_cookies($c);
        igualar_tiempo();
        redirigir('puerta.php?entrar=1'); // mira que la cookie se ha guardado y de ahí a la web
    }
    igualar_tiempo();
    pagina_entrar('Esa no es. Prueba otra vez.');
}

// POST de configurar: clave (poner o cambiar), sesiones (token nuevo) o quitar
function configurar(): void
{
    $que = isset($_POST['accion']) && is_string($_POST['accion']) ? $_POST['accion'] : '';
    // (lo que no llega a configurar nada responde al momento, como el 429)
    if (!in_array($que, ['clave', 'sesiones', 'quitar'], true)) {
        pagina(400, 'No se entiende', '<h1>No se entiende</h1><a class="enlace" href="puerta.php?configurar">Volver</a>');
    }
    if (!is_dir(DATOS) || !is_writable(DATOS)) {
        pagina(500, 'Falta api/datos', '<h1>⚠️ Falta <code>api/datos/</code></h1><p>Esa carpeta tiene que estar y PHP tiene que poder escribir en ella (docs/DUELO.md, sección F).</p>');
    }
    $codigo = codigo_permiso();
    candado(true);
    $c = cargar_config();
    $p = permiso($codigo);
    if ($p === null || isset($p['viejo'])) {
        candado(false);
        pagina_sin_permiso($p, $c !== null, $codigo, false, 403);
    }
    $base = base_actual();
    if ($base === null && $c !== null) {
        $base = $c['base'];
    }
    if ($base === null) {
        candado(false);
        igualar_tiempo();
        pagina(500, 'Carpeta rara', '<h1>⚠️ No puedo ponerla aquí</h1><p>El nombre de la carpeta de la web tiene caracteres raros (espacios, acentos…). Usa solo letras sin acento, números, guiones y puntos.</p>');
    }
    $nueva = null;
    if ($que === 'clave') {
        $clave = isset($_POST['clave']) && is_string($_POST['clave']) ? $_POST['clave'] : '';
        $otra = isset($_POST['otra']) && is_string($_POST['otra']) ? $_POST['otra'] : '';
        $mal = problema_clave($clave, $otra);
        if ($mal !== null) {
            candado(false);
            igualar_tiempo();
            pagina_configurar($c, $p, $mal);
        }
        $nueva = ['v' => 1, 'hash' => password_hash($clave, PASSWORD_DEFAULT), 'token' => bin2hex(random_bytes(32)), 'base' => $base,
            'https' => es_https(), 'creada' => time()];
    } elseif ($que === 'sesiones') {
        if ($c === null) {
            candado(false);
            igualar_tiempo();
            pagina_configurar(null, $p, 'Todavía no hay contraseña: elige una.');
        }
        $nueva = $c;
        $nueva['token'] = bin2hex(random_bytes(32));
        $nueva['base'] = $base;
        $nueva['https'] = es_https();
        $nueva['creada'] = time();
    } elseif (!isset($_POST['seguro']) || $_POST['seguro'] !== '1') {
        candado(false);
        igualar_tiempo();
        pagina_configurar($c, $p, 'Para quitarla, marca la casilla de «Sí, quiero…».');
    }
    // Primero los datos y luego el .htaccess: si este falla, la próxima revisión lo vuelve a intentar
    if ($nueva !== null) {
        escribir(CONFIG, $nueva);
    } else {
        @unlink(CONFIG);
    }
    $ok = escribir_htaccess($nueva);
    if ($ok) {
        borrar_permisos();
        poner_cookie_permiso(''); // (la próxima vez, otro código)
    }
    candado(false);
    if ($ok && $nueva !== null) {
        poner_cookies($nueva);
    } elseif ($ok && $c !== null) {
        poner_cookies($c, true);
    }
    igualar_tiempo();
    pagina_hecha($que, $ok, $base);
}

function principal(): void
{
    $metodo = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
    // La API sin cookie (el .htaccess la reescribe aquí): 401, sin más
    if (isset($_GET['no']) && $_GET['no'] === 'api') {
        responder_json(401, ['error' => 'puerta'], ['WWW-Authenticate: Cookie realm="puerta"']);
    }
    if (isset($_GET['accion']) && $_GET['accion'] === 'revisar') {
        $ok = reparar();
        caducar_intentos();
        responder_json($ok ? 200 : 500, ['ok' => $ok]);
    }
    if ($metodo === 'GET' || $metodo === 'HEAD') {
        ver();
    }
    if ($metodo !== 'POST') {
        responder_json(405, ['error' => 'metodo'], ['Allow: GET, POST']);
    }
    if (!origen_valido()) {
        pagina(403, 'Desde otra web no', '<h1>Desde otra web, no</h1><p><a class="enlace" href="puerta.php">Abre la puerta desde aquí</a>.</p>');
    }
    if (isset($_GET['configurar'])) {
        configurar();
    }
    entrar();
}

try {
    principal();
} catch (Throwable $t) {
    error_log('puerta.php: ' . get_class($t) . ': ' . $t->getMessage());
    candado(false);
    if (isset($_SERVER['REQUEST_METHOD']) && strtoupper((string)$_SERVER['REQUEST_METHOD']) === 'POST') {
        igualar_tiempo();
    }
    if (!headers_sent()) {
        pagina(500, 'Algo ha fallado', '<h1>Algo ha fallado</h1><p>Prueba otra vez en un rato.</p>');
    }
}
