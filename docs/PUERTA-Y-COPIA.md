# Puerta con contraseña, lo guardado en cada aparato y la copia en la nube

Tres cosas para la web en tu hosting:

- **La puerta**: sin la contraseña no se ve nada de la web (ni la página, ni los audios, ni los
  vídeos, ni el 1 contra 1, ni la copia). La comprueba el servidor (Apache, con el `.htaccess`) en
  cada petición: no es un candado de JavaScript que se pueda saltar.
- **Lo guardado** (perfiles, fotos, estrellas, partidas regaladas): vive en el navegador de cada
  aparato. Aquí está qué hace la app para no perderlo y qué hay que evitar (sección 8).
- **La copia en la nube** (sección 11): si la pones, lo guardado se copia también en el propio
  hosting, **cifrado en el aparato** con un código de familia de 5 palabras que el servidor no
  conoce. Con ese código se recupera todo en otro aparato (o en el mismo, si se borra) y varios
  aparatos se mantienen al día solos. Lo que se guarda y dónde, para el registro de actividades del
  RGPD, está en la sección 12.

Sin configurar, la puerta no hace nada y la web se ve como siempre (así sale la versión pública). La
copia solo funciona con la puerta puesta (sección 11) y, hasta que alguien pulse «Guardar en la nube» en
un aparato, no guarda nada.

En los ejemplos, la web está en `https://tu-dominio.es/juegos/`. En el servidor es la carpeta de la
web, la misma de `docs/DUELO.md` (sección F).

## 1. Cómo funciona, en corto

- `api/puerta.php` es la puerta: la pantalla «🔒 Escribe la contraseña» y la configuración.
- Al configurarla, escribe en el `.htaccess` de la carpeta de la web, entre las marcas
  `# PUERTA-INICIO` y `# PUERTA-FIN`, una regla de mod_rewrite con un token secreto. En el repo, entre
  las marcas hay una **red de seguridad** que sin puerta no hace nada (sección 3).
- Con la contraseña buena, el navegador se queda una cookie (`jp_puerta`) con el token durante
  400 días. Apache deja pasar solo las peticiones con esa cookie:
  - sin ella, todo va a la puerta (redirección 302) y la API (`api/sala.php` y `api/copia.php`)
    responde `401 {"error":"puerta"}`;
  - pasan sin ella: la propia puerta, los iconos y el manifiesto (para que el icono de la pantalla
    de inicio se vea) y el `ping` de la sala (`api/sala.php?accion=ping`, para la limpieza
    programada; solo responde `{"ok":true}`).
- La contraseña se escribe **una vez en cada aparato** (y en cada navegador). En el iPad, la app de
  la pantalla de inicio cuenta como otro navegador: hay que escribirla también dentro.
- La contraseña y el token se guardan en `api/datos/puerta.php` (la contraseña, cifrada con
  `password_hash`: no se puede leer). `api/datos/` no se puede abrir por URL.

## 2. Ponerla la primera vez (con FileZilla)

1. Sube la versión nueva como siempre (`docs/DUELO.md`, sección F), con `api/puerta.php` y el
   `.htaccess` de la raíz (ya trae las marcas, con la red de seguridad). Si en el servidor el
   `.htaccess` tenía otras líneas tuyas, júntalos: no lo pises.
2. En FileZilla: **Servidor → Forzar mostrar archivos ocultos** (para ver los `.htaccess`).
3. En el navegador (el que vas a usar para configurarla) abre
   `https://tu-dominio.es/juegos/api/puerta.php`. Sale «🔓 Esta web no tiene contraseña» y el nombre
   de un archivo con un código, por ejemplo **`PERMITIR_PUERTA-k7m2p9xq4d`**, con un botón «Copiar».
   El código es **de ese navegador** (lo guarda en una cookie): un extraño que abra la puerta a la vez
   ve otro código y no puede usar el tuyo.
4. En FileZilla, a la derecha (el servidor), entra en la carpeta `api/datos/` de la web. Botón
   derecho → **«Crear nuevo archivo»** → pega ese nombre (tal cual, sin extensión) → Aceptar. Se crea
   vacío. Es la prueba de que eres el dueño: solo quien entra por FTP puede crearlo.
   - Si lo creas en tu ordenador y lo subes, que sea un archivo vacío. Si Windows le pone `.txt`, también
     vale.
   - Vale **30 minutos** desde que se sube. Después, la puerta lo borra y hay que crearlo otra vez.
   - Un `PERMITIR_PUERTA` sin código (como se hacía antes) ya no vale: la puerta lo borra y lo avisa.
5. Vuelve al navegador y **recarga** la página. Sale **«🔑 Elige la contraseña»**. Escríbela dos veces
   y pulsa **Guardar**.
   - Al menos 12 letras, números o signos. Mejor una frase fácil para ti y difícil para los niños
     (por ejemplo, tres o cuatro palabras con un número). Puedes dejar que el navegador la recuerde.
   - Si al recargar sale otro código, ese navegador no guarda las cookies de la web: permítelas (o usa
     otro navegador) y empieza otra vez.
6. Sale **«✅ Contraseña guardada»** y, debajo, la propia página se comprueba como la vería un
   extraño (sin cookies): tienen que salir las cuatro líneas en verde ✔. Si alguna sale en rojo ✘,
   mira [«Si algo falla»](#7-si-algo-falla).
7. En FileZilla, actualiza `api/datos/` (F5): el `PERMITIR_PUERTA-…` ya no está (se borra solo; si
   siguiese ahí, bórralo tú). Hay un `puerta.php` nuevo: no lo toques ni lo subas nunca desde tu
   ordenador.
8. En cada aparato, abre la web: pedirá la contraseña una vez. En el iPad, abre también la app desde
   el icono de la pantalla de inicio y escríbela allí.

## 3. Subir versiones nuevas sin abrir la puerta

- **No vuelvas a subir el `.htaccess` de la raíz** encima del del servidor: el del repo no tiene el
  bloque de la puerta. Cuando FileZilla diga que el archivo ya existe, elige **«Omitir»** para ese
  archivo (el paso 6 de la sección F de `docs/DUELO.md` no se hace con la puerta puesta).
  - Si alguna vez el `.htaccess` del repo trae líneas nuevas fuera del bloque, ábrelo en el
    servidor (botón derecho → «Ver/Editar») y añádelas a mano, sin tocar lo de entre las marcas.
- Si se sube por error, **la web no se queda abierta**: entre las marcas, el del repo trae una red de
  seguridad. Si existe `api/datos/puerta.php` (hay puerta) y el bloque es la red, la primera petición
  que llegue, sea de quien sea, va a la puerta (menos los iconos y el manifiesto), y la puerta vuelve
  a escribir su bloque. La familia vuelve sola a la web con su cookie; un extraño se queda en la
  contraseña. (Además, los aparatos que ya habían entrado se lo piden a la puerta al abrir la app.)
  Sin puerta, la red no hace nada.
- Lo demás se sube como siempre (`js/`, `css/`, `api/sala.php`, `api/puerta.php`, `api/copia.php`,
  `index.html` el último…).
- No subas nunca desde tu ordenador nada de `api/datos/` que no sea `.htaccess` o `index.html`: ni
  `puerta.php`, ni `puerta-intentos.php`, ni `puerta.lock`, ni la carpeta `copias/` (los crea el
  servidor; git no los guarda). Y no la borres: ahí están las copias en la nube. Tampoco pongas allí
  una copia de seguridad vieja de `copias/` (sección 11).
- Después de subir, comprueba en una **ventana privada** que pide la contraseña (sección 5).

## 4. Cambiar la contraseña, cerrar la sesión en todos los aparatos o quitarla

Siempre igual: abre `https://tu-dominio.es/juegos/api/puerta.php?configurar` (o pulsa «Cambiar la
contraseña», debajo de «Entrar»), crea en `api/datos/` el archivo con el nombre que sale (pasos 3 a 5
de la sección 2) y recarga. Ahí puedes:

- **Cambiar la contraseña**: se escribe dos veces y Guardar. Todos los aparatos la tendrán que
  escribir otra vez (menos este, que se queda dentro).
- **Cerrar la sesión en todos los aparatos**, con la misma contraseña: por ejemplo, si se pierde una
  tablet o se la ha dicho alguien que no debía. Todos tendrán que volver a escribirla.
- **Quitar la contraseña**: marca «Sí, quiero que la web se vea sin contraseña» y pulsa el botón.

Si **se te olvida la contraseña**, haz lo mismo: no hace falta saber la vieja (la prueba de que eres
el dueño es el archivo, que solo se puede crear por FTP).

En los tres casos se genera un token nuevo (al quitarla, entre las marcas vuelve la red del repo) y se
borra el archivo de permiso.

## 5. Comprobar

En una **ventana privada** (o en un aparato que no haya entrado nunca):

1. `https://tu-dominio.es/juegos/` → pide la contraseña.
2. `https://tu-dominio.es/juegos/js/app.js` → también pide la contraseña.
3. `https://tu-dominio.es/juegos/api/sala.php?accion=leer` → `{"error":"puerta"}`.
4. `https://tu-dominio.es/juegos/api/sala.php?accion=ping` → `{"ok":true}` (este sí: es para la
   limpieza programada y no dice nada).
5. `https://tu-dominio.es/juegos/api/datos/puerta.php` → error 403.
6. `https://tu-dominio.es/juegos/api/copia.php` → `{"error":"puerta"}`.

Y en un aparato que ya ha entrado, todo como siempre, también el 1 contra 1 en red y la copia en la
nube (en «👪 Padres», «☁️ Copia al día»).

## 6. Una sola dirección: https:// y sin www.

Para el navegador, `http://tu-dominio.es`, `https://tu-dominio.es`, `http://www.tu-dominio.es` y
`https://www.tu-dominio.es` son **cuatro sitios distintos**, y lo guardado en uno no se ve en los
otros. Si un día se entra por otra dirección, los perfiles «desaparecen» (siguen en la otra).

Por eso, al arrancar:

- **La app** pasa a `https://` sin `www.` si se ha entrado por `http://` o por `www.`. Sin
  dominios escritos a mano: lo deduce de la dirección. Solo lo hace si la dirección de destino
  responde (si el hosting no tuviese certificado, se queda donde está) y **nunca si en esa dirección
  ya hay algo de los niños guardado**: así no los deja atrás. En localhost, con una IP o con un
  puerto propio (pruebas) no hace nada.
- **La puerta** hace lo mismo, pero por `http://` va siempre a `https://` (la contraseña no viaja
  nunca sin cifrar; si había perfiles en esa dirección, mantiene el `www.`).
- Si la puerta se configuró por `https://`, el propio `.htaccess` manda a la puerta por `https://`
  a quien llegue sin cookie por `http://`.

No se hace en el `.htaccess` con una regla «de http a https»: en un hosting compartido el https lo
pone un proxy delante de Apache, y Apache puede creer que todo llega por http y redirigir sin fin.

Recomendación: abre siempre `https://tu-dominio.es/juegos/` y añade **esa** dirección a la pantalla
de inicio.

## 7. Si algo falla

- **Error 500 en toda la web justo después de ponerla**: el hosting no tiene mod_rewrite (o no deja
  usarlo en el `.htaccess`), o su Apache es anterior a 2.4.8 (no entiende `RewriteOptions
  InheritDownBefore`). La web queda cerrada para todos: mejor cerrada que abierta. Para abrirla otra
  vez, en FileZilla:
  1. borra `api/datos/puerta.php` (si no, la puerta volvería a escribir el bloque);
  2. abre el `.htaccess` de la carpeta de la web (botón derecho → «Ver/Editar») y borra las líneas
     de **entre** `# PUERTA-INICIO` y `# PUERTA-FIN` (deja las dos marcas). Guarda y deja que lo
     suba.
- **Error 403 en toda la web, sin puerta**: ese hosting tiene mod_rewrite pero no deja usarlo en el
  `.htaccess` sin `FollowSymLinks` (raro). La red de seguridad no puede ir ahí: borra las líneas de
  entre las marcas (como arriba). Con ese hosting, la puerta tampoco podría funcionar.

  Ojo: el paso 4 de «Comprobar» de la sección F de `docs/DUELO.md` («si da error 500, borra el
  `.htaccess`») no sirve con la puerta: el bloque volvería en cuanto entrase un aparato.
- **«⚠️ La puerta está a medias»** o **«No se ha podido terminar»**: no ha podido escribir el
  `.htaccess`. Mira que hay **una sola** línea `# PUERTA-INICIO` y **una sola** `# PUERTA-FIN`
  (en ese orden) y que PHP puede escribir en la carpeta de la web y en el `.htaccess` (sus permisos,
  como los de cualquier archivo que hayas subido). Luego vuelve a abrir la puerta.
- **Pide la contraseña una y otra vez**: el navegador no guarda cookies de esta web (en el iPad:
  Ajustes → Safari → «Bloquear todas las cookies», desactivado). La puerta lo avisa.
- **«Demasiados intentos»**: 10 intentos por conexión (y 60 entre todas) cada 15 minutos. Espera y
  vuelve a probar. Los aparatos que ya estaban dentro siguen jugando.
- **Has movido la web a otra carpeta**: la regla lleva la carpeta. Abre
  `…/api/puerta.php?configurar` en la carpeta nueva, con su permiso (sección 4), y pulsa «Cerrar la
  sesión en todos los aparatos» (o cambia la contraseña).

## 8. Lo guardado en cada aparato

Los perfiles, sus fotos, las estrellas y las partidas regaladas se guardan **en el navegador de cada
aparato**. Sin la copia en la nube, solo ahí (no viajan a ninguna parte); con ella, también cifrados
en el hosting (sección 11). Subir versiones nuevas **no borra nada** mientras la dirección sea la
misma: el `?v=` de `index.html` solo cambia los archivos de la web, no lo guardado.

Lo que sí lo hace perder (o que «desaparezca»):

- entrar por otra dirección (sección 6);
- en Safari, «Borrar historial y datos de sitios web», o Ajustes → Safari → Avanzado → Datos de
  sitios web → borrar los de la web;
- **borrar el icono de la pantalla de inicio del iPad**: esa app tiene su propio almacén y se va con
  el icono. Si se vuelve a añadir, empieza vacía;
- que el navegador lo borre por su cuenta: cuando le falta espacio o, en Safari, si se usa la web
  en Safari (no desde el icono) y pasan 7 días de uso del navegador sin abrirla.

Lo que hace la app: la primera vez que guarda algo en cada visita pide al navegador que lo guarde
**de forma persistente** (`navigator.storage.persist()`), es decir, que no lo borre él solo. Chrome,
Edge y Safari deciden sin preguntar (es más fácil que digan que sí con la app en la pantalla de
inicio); Firefox puede preguntar: di «Permitir». Si dicen que no, todo sigue funcionando igual.

Consejo: en el iPad, usad siempre el icono de la pantalla de inicio y no lo borréis. Y poned la
copia en la nube (sección 11): si pasa algo de lo de arriba, se recupera todo con el código.

## 9. Seguridad y privacidad (resumen)

- **Qué guarda el servidor**: en `api/datos/puerta.php`, el hash de la contraseña (bcrypt), el
  token, la carpeta de la web, si se configuró por https y la fecha. En `api/datos/puerta-intentos.php`,
  los momentos de los intentos de contraseña: por **huella** de la conexión y el total. La huella es un
  HMAC de la IP (del /64 en IPv6) con una pimienta que cambia cada hora y se lleva todas las huellas,
  recortado a 20 bits; como mucho 200. Es una **IP seudonimizada**, no anónima: con el archivo (la
  pimienta está dentro) cada huella corresponde a unas 4096 IPv4, así que no se saca la IP, pero sí se
  podría comprobar una IP sospechosa. Nunca la IP ni la contraseña en claro. Pasada la hora, las huellas
  se borran en la siguiente petición a la puerta (si nadie la abre, se quedan hasta entonces). Los
  registros de acceso del hosting siguen como siempre: no dependen de esto.
- **Cookie**: `HttpOnly` (el JavaScript no la ve), `SameSite=Lax`, `Secure` cuando la conexión es
  https, `Path` = la carpeta de la web, 400 días. Además, `jp_puerta_hay=1` (sin nada secreto) para
  que la app sepa que este aparato ya pasó y pida revisar el bloque.
- **Intentos**: 10 por huella y 60 en total cada 15 minutos, contados antes de comprobar (no se
  cuelan en paralelo). Las respuestas a un intento que se comprueba tardan 1 s: por el tiempo no se
  sabe si la contraseña era buena. Las que no se comprueban (límite pasado, desde otra web, sin
  permiso) salen al momento: su respuesta ya dice por qué, y así unas decenas de envíos seguidos no
  dejan a PHP sin procesos para el 1 contra 1 ni la copia.
- **Permiso para configurar**: el archivo `api/datos/PERMITIR_PUERTA-<código>`, con el código que la
  puerta da a **tu navegador** (en una cookie `HttpOnly`) y que solo se puede crear por FTP. Vale
  30 minutos y una vez. Un extraño que mire la puerta mientras tanto tiene otro código: no puede usar
  tu archivo, ni sabe que existe (le sale lo mismo con ventana que sin ella).
- **El bloque del `.htaccess`** vale también en las subcarpetas aunque tengan su propio `.htaccess`
  con reglas (`RewriteOptions InheritDownBefore`, Apache 2.4.8 o más) y hace que lo de detrás de la
  puerta salga con `Cache-Control: private` y `Vary: Cookie`, para que una caché compartida (un CDN o
  un proxy) no guarde lo que pidió la familia y se lo dé a otro.
- **La red de seguridad** (sección 3): si se sube el `.htaccess` del repo encima, la web no se queda
  abierta.
- **La página de la puerta** no carga nada de fuera (ni fuentes ni scripts: CSP con nonce), no se
  puede meter en otra web (`frame-ancestors 'none'`) y solo acepta envíos desde la propia web.
- **Sin mod_rewrite**, error 500: falla cerrada.
- **La copia en la nube** va detrás de la puerta como el resto de la API: sin la contraseña no se
  puede ni probar códigos. Sin puerta, no funciona (sección 11). Lo que guarda el servidor, en la
  sección 12.

Límites conocidos:

- El token es **uno para todos los aparatos**. Si se pierde uno, «Cerrar la sesión en todos los
  aparatos» (sección 4).
- El token está en claro en el `.htaccess`. Apache no sirve nunca los `.ht*` y la propia puerta lo
  tapa, pero quien entre por FTP lo ve (como todo lo demás).
- Quien entre por FTP puede hacerlo todo (como siempre): poner o quitar la puerta y leer el token del
  `.htaccess`. Cuida esa contraseña más que la de la puerta.
- Los límites cuentan por IP. Si el hosting diese a PHP la IP de su proxy en vez de la de cada
  conexión, el límite por IP sería en realidad uno para todos.
- Agotar los intentos a propósito deja sin poder **entrar** a los aparatos nuevos durante
  15 minutos (los que ya tienen la cookie siguen jugando).
- Cada aparato guarda en su caché lo que ya descargó (como siempre). Si el hosting tiene un CDN o una
  caché delante, no lo actives para la carpeta de la web (o exclúyela): el bloque pide que no se
  comparta, pero uno mal configurado podría no hacer caso.
- **Todo el dominio es la misma web para el navegador.** La app vive en
  `https://tu-dominio.es/juegos/`, pero lo guardado en el aparato (`localStorage`: perfiles con sus
  fotos, estrellas y, con la copia, el código de familia y su clave) es de todo `tu-dominio.es`, no de
  la carpeta, y la cookie de la puerta viaja en las peticiones a `/juegos/` hechas desde cualquier
  página del dominio. Cualquier otra página con JavaScript en ese dominio (otra web en otra carpeta,
  un WordPress, o un fallo XSS en cualquiera de ellas) podría leerlo todo, descargar lo de detrás de
  la puerta y leer o pisar la copia. Por eso: **no tengas nada más con scripts en ese dominio**. Lo
  mejor es darle a la app su propio subdominio (por ejemplo `juegos.tu-dominio.es`), que la aísla de
  verdad; para pasar lo guardado, con la copia: «Guardar en la nube» en la dirección vieja y
  «Recuperar con código» en la nueva. Además, cualquier PHP de la misma cuenta del hosting (otras
  webs del mismo alojamiento) puede leer el token del `.htaccess` y `api/datos/`.
- Si un aparato tenía perfiles en `http://` o en `www.`, la app no lo cambia de dirección para no
  perderlos de vista; la puerta, por `http://`, sí lo pasa a `https://` (con el mismo `www.`). No
  hay forma automática de pasar lo guardado de una dirección a otra. Con la copia en la nube sí hay
  una a mano: en la dirección vieja, si es `https://` (con `www.`), «Guardar en la nube»; en la
  buena, «Recuperar con código». Por `http://` la copia no funciona (sección 11).

## 10. Pruebas en local

- `php -S` no lee los `.htaccess`: con él se prueba la pantalla de la puerta (configurar, entrar,
  límites), pero no que la web quede cerrada. Eso solo se prueba con un Apache con mod_rewrite y
  `AllowOverride All`, con PHP (por ejemplo, PHP-FPM o `php-cgi -b` por FastCGI), y la web en una
  subcarpeta como en el hosting.
- Las pruebas dejan en `api/datos/` `puerta.php`, `puerta-intentos.php` y `puerta.lock` (git los
  ignora). Para empezar de cero: bórralos y deja entre las marcas del `.htaccess` la red del repo.
- `PERMITIR_PUERTA-<código>` vale 30 minutos según la fecha del archivo (`touch` para renovarlo).
- La copia en la nube funciona con `php -S` (no necesita el `.htaccess`) en `http://127.0.0.1` o
  `http://localhost`: el navegador los trata como seguros y hay Web Crypto. Con otro nombre por
  `http://` no (sección 11). Sin puerta configurada, crea antes un `api/datos/COPIA_SIN_PUERTA` vacío
  (sección 11; git lo ignora). Las pruebas dejan las copias en `api/datos/copias/` (git las ignora):
  para empezar de cero, borra esa carpeta y, en el navegador, las claves `jp-nube` y
  `jp-nube-copia`.

## 11. Copia en la nube (cifrada)

### Qué es

Una copia de todo lo que la app guarda en el aparato, **cifrada en el propio aparato** antes de
salir, en el hosting de la web (`api/datos/copias/`). Sin servicios de fuera. La clave sale de un
**código de familia** de 5 palabras sencillas (por ejemplo «gato luna mesa tren nube») que se elige
al azar en el aparato y no se envía nunca: el servidor guarda un texto que no sabe leer.

Con el código:

- se recupera todo en un aparato nuevo, en el mismo si se borra (o se borra el icono del iPad), o en
  otra dirección de la web;
- varios aparatos (las dos tablets, el móvil) se mantienen al día solos: lo que gana un niño en una
  tablet aparece en la otra.

Necesita que la web se abra por **`https://`** (sin cifrado de la conexión, el navegador no deja
cifrar: el panel lo dice), PHP (en GitHub Pages no hay) y **la puerta puesta** (sección 2). Va en
**«👪 Padres»**, detrás de la multiplicación: desde la pantalla de inicio (abajo, junto a los
créditos) o desde la Batalla.

Sin puerta, `api/copia.php` no responde (`403 {"error":"sin-puerta"}`) y el panel dice que hace falta:
abierta a cualquiera, cualquiera podría llenar las copias del servidor con basura (son 50 como mucho)
o probar códigos sin parar. Si alojas la web para otros sin contraseña y aun así quieres la copia, crea
en `api/datos/` un archivo vacío `COPIA_SIN_PUERTA`: funciona, con esos riesgos (ver Límites).

### Ponerla (en el primer aparato)

1. Con la puerta puesta, sube `api/copia.php`, `js/nube.js` y lo demás de la versión como siempre
   (`index.html` el último). No hay que configurar nada más en el servidor: la carpeta
   `api/datos/copias/` se crea sola.
2. En el aparato que tenga más cosas guardadas: **👪 Padres** → la cuenta → **☁️ Guardar en la
   nube**. Tarda un momento («Calculando la clave»: es a propósito, para que probar códigos sea
   lento).
3. Sale el código, grande: **apúntalo en papel** (las 5 palabras, en orden) y guárdalo bien. Sin él
   no se puede recuperar la copia; con él (y la contraseña de la web) cualquiera podría leerla.
   Pulsa «Ya lo he apuntado».

Si lo pierdes: en un aparato que ya tenga la copia, «👁️ Ver el código» lo enseña otra vez.

### Unir otro aparato (o recuperar)

**👪 Padres** → la cuenta → **🔑 Recuperar con código** → escribe las 5 palabras (da igual
mayúsculas, tildes o comas; si una palabra no es de la lista, avisa y propone la más parecida) →
**Recuperar**.

- Si el aparato está vacío, se trae todo.
- Si ya tiene cosas, se juntan: los perfiles que solo están en un sitio, las estrellas (de cada
  niño, el número más alto de los dos), las letras trazadas (todas), el nivel desbloqueado de la
  Batalla (el más alto)... **Nunca se pierde lo de este aparato sin preguntar**: si un mismo perfil
  está distinto en los dos sitios (otra foto, otro tema, uno borrado) o algún ajuste no coincide
  (tipo de letra, nivel...), sale la lista y se elige **«Lo de este aparato»** o **«Lo de la
  nube»** (o Cancelar, y no cambia nada). Si con «Lo de la nube» se fuesen a borrar aquí perfiles que
  se borraron en otro aparato (con sus estrellas), lo pregunta otra vez aparte: «Sí, borrarlos aquí» o
  «No, quedármelos» (y lo demás, lo de la nube). Si te los quedas, vuelven también a los demás aparatos.

### Día a día

No hay que hacer nada. La app guarda sola unos segundos después de cada cambio (agrupando: no envía
una vez por estrella), al abrirla, al volver a ella y cada 5 minutos si está abierta. Nunca para el
juego ni enseña nada a los niños. En **👪 Padres** se ve cómo va:

| Aviso | Qué pasa |
|---|---|
| ☁️ Copia al día (hace 2 min) | Todo guardado. |
| 🔄 Hay cambios: se guardan en unos segundos | Normal mientras juegan. |
| 📴 Sin conexión: se guardará cuando vuelva | Se sigue jugando igual; al volver internet, se guarda sola. |
| 🔒 La web ha vuelto a pedir la contraseña | Se ha cambiado la contraseña o cerrado la sesión en todos los aparatos (sección 4): cierra la web, ábrela y escribe la contraseña. |
| 🔒 La copia en la nube solo funciona con la contraseña de la web puesta | No hay puerta (o se ha quitado): ponla (sección 2). |
| ⏳ Demasiados intentos | Alguien (o tú, con códigos mal escritos) ha probado muchos códigos: espera unos minutos. |
| ⚠️ No cabe en la nube (más de 2 MB) | Demasiadas fotos: quita alguna. |
| ⚠️ La copia ya no está en la nube | Se borró desde otro aparato, o llevaba un año sin usarse. «Guardarla otra vez (mismo código)» la sube de nuevo con lo de este aparato; o «Dejar de sincronizar». |
| ⚠️ La copia es de una versión más nueva de la web | Recarga la página (este aparato tiene una versión vieja de la web). |
| ⚠️ La copia de la nube no se puede leer | El texto del servidor está estropeado o no es de este código (o algo entre medias, como un proxy, ha respondido otra cosa). Se vuelve a probar sola, con calma; lo de este aparato sigue bien. Si no se arregla, «Borrar la copia» y «Guardar en la nube» otra vez (con código nuevo). |

«🔄 Sincronizar ahora» la guarda ya (por ejemplo, antes de pasar a la otra tablet).

### Dejar de sincronizar, borrar la copia y cambiar de código

- **Dejar de sincronizar en este aparato**: antes guarda lo último que se haya jugado (si estaba
  esperando los segundos de agrupar y hay red); luego deja de guardar en la nube y olvida el código.
  Lo que tiene se queda. La copia sigue en el servidor para los demás.
- **Borrar la copia de la nube** (pide confirmación): se borra del servidor. Lo de cada aparato se
  queda; los demás aparatos verán «La copia ya no está en la nube».
- **Cambiar de código** (si alguien que no debía lo ha visto): «Borrar la copia de la nube» en un
  aparato y «Guardar en la nube» en el mismo (sale un código nuevo). En los demás, «Dejar de
  sincronizar» (no «Guardarla otra vez»: volvería a subir la del código viejo) y «Recuperar con
  código» con el nuevo.

### Cómo se juntan dos aparatos

Clave a clave, sin que importe el orden ni cuántas veces se junte lo mismo:

- **Perfiles**: por su id. De cada uno gana el cambio más nuevo (foto, nombre, tema...), y borrarlo
  también es un cambio con su fecha: si se borra en una tablet, se borra en las demás (con sus
  estrellas). Si en otra tablet que aún no se había enterado se juega con él **después** de borrarlo
  (estrellas, letras, Batalla), vuelve, con lo jugado: no se pierde lo que un niño acaba de hacer.
- **Estrellas y partidas usadas y regaladas**: cada aparato apunta lo que ha sumado él y la copia
  lleva la suma. Si dos tablets juegan a la vez con el mismo niño, no se pierde ninguna estrella. Al
  unir un aparato que ya tenía cosas, de cada contador se queda el más alto de los dos (no la suma:
  podría ser lo mismo contado dos veces).
- **Nivel desbloqueado de la Batalla**: el más alto. **Letras trazadas**: todas las de todos.
- **Lo demás** (tipo de letra, nivel elegido de sonidos y sílabas, modos de Sílabas y Días, héroe,
  contra quién, «Libre hoy»): el último que se cambió.
- **Lo del aparato no se copia**: que se vio el vídeo de presentación o el de los días, el 🔇 de la
  Batalla y lo de la propia copia (`jp-nube`, `jp-nube-copia`).
- Si cambia entre que se lee y se escribe (dos tablets guardando a la vez), el servidor responde 409
  y el aparato vuelve a leer, juntar y escribir.
- Las fechas de los cambios van con la **hora del servidor** (la manda en cada respuesta): un aparato
  con el reloj mal no gana ni pierde por eso.
- Lo que llega se junta también con la última copia que conocía el aparato: si el servidor vuelve
  atrás (alguien pone en `api/datos/copias/` una copia de seguridad vieja, o el hosting restaura una),
  ningún aparato pierde lo que ya había visto (ni baja ninguna estrella) y la copia se vuelve a subir
  entera. Aun así, **no restaures copias de seguridad viejas de `api/datos/copias/`**: lo que solo
  estuviese en un aparato que ya no se abre no vuelve.
- Lo que llega de la nube se revisa campo a campo: de cada perfil, solo nombre, edad, tema, emoji y la
  foto como imagen dentro de la copia (nunca la dirección de otra web, que avisaría a otro de cuándo y
  desde dónde se abre la app); los contadores, con un tope (un millón); y la página no carga imágenes
  de otras webs (`Content-Security-Policy` en `index.html`).

### Tarea programada (opcional)

La copia que lleva **365 días sin usarse** (ni leerse ni escribirse) se borra en la limpieza, que
hace `api/copia.php` como mucho una vez por hora con cualquier petición. Si nadie abre la web en
mucho tiempo, no se limpia sola: para eso, en el panel del hosting, una tarea programada (diaria
basta) con `php /ruta/de/la/web/juegos/api/copia.php limpiar`, como la de la sala
(`docs/DUELO.md`).

### Límites conocidos

- **El código es la llave**: quien lo tenga y pueda entrar en la web (la contraseña de la puerta)
  puede leer la copia. Por eso hacen falta las dos cosas. Si se pierde en todos los aparatos y en el
  papel, la copia no se puede leer (ni por el servidor ni por nadie).
- El código se guarda en cada aparato que tiene la copia (en el navegador, `jp-nube`), para poder
  enseñarlo otra vez y sincronizar sin pedirlo. Quien pueda abrir el aparato y resolver la
  multiplicación de «Padres» puede verlo.
- La clave sale del código con PBKDF2-SHA256 (300 000 vueltas) y HKDF. Aquí (un ordenador) tarda
  unos 0,2 s; en un móvil lento, más (el panel dice cuánto ha tardado en «Ver el código»: si en
  algún aparato pasase de 2 s, conviene saberlo). Solo se calcula al guardar o recuperar, no al
  sincronizar.
- Es una copia de **lo último**, no un historial: si un niño borra un perfil, se borra en todas
  partes (como en el aparato). Para deshacerlo no hay versiones anteriores.
- Si dos aparatos cambian lo mismo (la foto del mismo niño) casi a la vez, gana el último. Las fechas
  van con la hora del servidor; solo lo que un aparato cambie antes de hablar con él por primera vez
  va con su propio reloj.
- Con la copia sin puerta (`COPIA_SIN_PUERTA`), cualquiera puede gastar las 50 copias del servidor
  (10 nuevas por conexión y hora): nadie más podría crear una durante un año, aunque las que ya hay
  siguen funcionando. Y 10 códigos mal desde una misma IP (una wifi compartida) frenan 10 minutos la
  copia de esa IP.
- Si el almacenamiento del aparato está lleno, lo que llega de la nube y no cabe se queda solo en la
  memoria hasta cerrar la app (no se marca como guardado, así que al volver a abrir se vuelve a pedir).
  Lo que se cambie en la app mientras está lleno solo llega a la nube si da tiempo antes de cerrarla.
- El 409 y los demás avisos del servidor salen en la consola del navegador como líneas de red
  («Failed to load resource: 409»): es el navegador, no un error de la app.
- Por `http://` (o en navegadores sin Web Crypto) no funciona: lo dice el panel y no se pierde nada
  (el aparato la recupera cuando se abra por `https://`).
- Sin probar en el hosting real ni en Safari (iPad): las pruebas son con Chromium, `php -S` y un
  Apache 2.4 con la puerta.

## 12. Qué se guarda y dónde (para el registro de actividades)

Para el registro de actividades de tratamiento (art. 30 RGPD) de quien use la web. Con la familia
como únicos usuarios, probablemente es una actividad doméstica (art. 2.2.c RGPD); aun así, este es
el inventario.

**En cada aparato** (navegador, `localStorage`; no sale del aparato sin la copia en la nube):

| Dato | Clave | De quién |
|---|---|---|
| Perfiles: nombre, edad, tema, emoji y **foto** (JPEG de 256 px, si se pone) | `jp-perfiles` | de cada niño |
| Estrellas, letras trazadas, nivel de los juegos, tipo de letra, modos | `jp-estrellas-<id>`, `jp-trazados-<id>`, `jp-nivel-<id>`, `jp-letra-<id>`, `jp-modo-silabas-<id>`, `jp-guia-<id>`, `jp-modo-dias-<id>` | de cada niño |
| Batalla: partidas usadas y regaladas, «Libre hoy», nivel, héroe, contra quién | `jp-batalla-*-<id>` | de cada niño |
| Vídeo de presentación y de los días ya vistos, 🔇 de la Batalla | `jp-intro-vista`, `jp-video-dias-visto-<id>`, `jp-batalla-silencio` | del aparato (no se copia) |
| La copia en la nube: el **código de familia**, el id, la clave derivada, el id del aparato, marcas de tiempo, la versión | `jp-nube` | del aparato (no se copia) |
| La última copia juntada (lo mismo que lo de arriba, para no bajarla cada vez) | `jp-nube-copia` | del aparato (no se copia) |
| Cookies de la puerta (`jp_puerta` con el token, `jp_puerta_hay`; al configurarla, `jp_puerta_permiso` con el código del permiso, 2 h) | cookies | del aparato |

**En el servidor**, en `api/datos/copias/` (no se puede abrir por URL; archivos `0600`):

| Archivo | Qué tiene | Cuánto dura |
|---|---|---|
| `<hash>.php`, uno por copia | La versión (un número), la fecha de la última escritura y el **texto cifrado** (AES-256-GCM): todo lo de la tabla de arriba que se copia, fotos incluidas. El nombre es un hash del identificador, no el identificador. La fecha del archivo es la del último uso. | Hasta «Borrar la copia» o 365 días sin usarse |
| `intentos.php` | Los momentos de los intentos con identificadores que no existen y de las copias nuevas, por **huella** de la conexión: la IP seudonimizada (HMAC de la IP con una pimienta que cambia cada hora, recortado a 20 bits: cada huella corresponde a unas 4096 IPv4; como mucho 200 huellas) | Pasada una hora, hasta la siguiente petición a la copia o la tarea programada |
| `limpieza.php`, `candado.lock`, `index.html` | Nada (fecha de la última limpieza, el candado, una página vacía) | — |

Lo que **no** guarda nunca el servidor: el código, la clave, nombres, fotos ni ningún dato en claro,
ni IPs en claro (solo las huellas de arriba, seudonimizadas). Lo que sí puede ver quien tenga el servidor: cuántas copias hay, cuándo se escribió y usó
cada una y su tamaño (redondeado a 4 KB). Los registros de acceso del hosting (IPs, fechas,
`POST /juegos/api/copia.php`) los lleva el hosting como siempre: no dependen de esto.

**Cifrado**: el código (5 palabras de una lista de 1024: 50 bits de azar, `crypto.getRandomValues`)
→ PBKDF2-SHA256 (300 000 vueltas, sal fija con separador de dominio) → HKDF-SHA256 → un
identificador de 128 bits para el servidor y una clave AES-GCM de 256 bits. Cada envío, con un IV
aleatorio de 96 bits nuevo y, como datos asociados, el formato y el identificador (una copia no se
puede hacer pasar por otra; si se toca, no se descifra). Todo con Web Crypto, en el navegador.

**Encargado**: el hosting de la web (guarda los archivos cifrados). **Destinatarios**: Google, por
Google Fonts: `index.html` pide las fuentes Fredoka y Pixelify Sans a `fonts.googleapis.com` y
`fonts.gstatic.com`, así que cada aparato que abre la web les da su IP, su navegador y la dirección
de la web (nada de los niños ni de lo guardado). Para quitarlo, habría que servir las fuentes desde la
propia web (son de licencia OFL). **Transferencias internacionales**: posibles, a Google LLC (EE. UU.),
por lo mismo. Ningún destinatario más.

**Derechos**: ver y corregir, en la propia app (perfiles); borrar, con «Borrar perfil» (se borra en
todos los aparatos con la copia) y «Borrar la copia de la nube»; llevárselo, con el código a otro
aparato.

**Medidas**: la puerta con contraseña (sección 9; sin ella, la copia no funciona), https obligatorio
para la copia, cifrado de extremo a extremo, el `.htaccess` de `api/datos/`, la guarda de los
archivos, `flock` y escrituras atómicas, tamaño máximo por copia (2 MB) y número máximo de copias (50),
10 copias nuevas por conexión y hora, 10 identificadores que no existen por conexión cada 10 minutos,
solo `POST` desde la propia web (Origin), lo que llega de la nube revisado campo a campo y sin
imágenes de otras webs (CSP), y ningún tercero con los datos de los niños (el único, Google Fonts, ve
la conexión: arriba).
