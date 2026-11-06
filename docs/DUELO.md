# Batalla de bloques: 1 contra 1 y suelo rompible

Modo de dos jugadores (Steve contra Alex) y suelo que se rompe hasta el agua. Lo implementan el
motor (`js/minijuegos/batalla.js`), el cliente de red (`js/minijuegos/red.js`), el servidor
(`api/sala.php`) y la app (`index.html`, `js/app.js`, `css/estilos.css`). Las cabeceras de esos
archivos y el comentario del protocolo en `js/app.js` («1 contra 1 en red») dicen lo mismo que este
documento. Si alguna vez no coinciden, manda el código y hay que corregir esto.

Decisiones del usuario (no cambiarlas sin preguntar):
- Dos modos de 1 contra 1: **en esta tablet** (se pasan el iPad) y **en red con código**
  (uno crea la sala, el otro entra con el código).
- Arena: **solo Steve contra Alex**, sin monstruos. Misma vida (100) para los dos.
- Cada partida de 1 contra 1 **gasta 1 partida** (las que se ganan con estrellas) a cada jugador,
  en su propio aparato. En la tablet compartida, al perfil que tiene la sesión abierta.
- Código de sala: **4 animales** (se eligen tocando dibujos; lo pueden hacer sin leer).
- Suelo: se puede romper **hasta el agua en los dos modos** (contra monstruos y 1 contra 1).
  En modo fácil (peques) el héroe se sigue rescatando del agua (¡Plof!) como ahora.
- Dureza: un agujero hasta el agua cuesta **2-3 disparos en el mismo sitio**, y **se ve cómo el
  suelo se va debilitando** (grietas).

---

## Privacidad (los jugadores son niños)

### Qué viaja por la red

Entre las dos tablets, a través de `api/sala.php`, solo va esto:
- el héroe de cada uno (`steve` o `alex`);
- las jugadas: andar, saltar, cambiar de arma, y el ángulo, la fuerza y el arma de cada disparo;
- el estado de la partida: el mapa (bloques y grietas), dónde está cada héroe, cuánta vida le
  queda y de quién es el turno;
- la revancha: si la pide, si puede jugar otra (sí o no) y el número de duelo en esa sala;
- el adiós al salir.

**No viajan ni el nombre, ni la edad, ni la foto** del perfil. Tampoco sus estrellas ni sus
partidas (solo el «no puede jugar otra»), ni si es peque: la ayuda 🎯 se decide y se dibuja solo en
su tablet. El perfil sigue guardado solo en el aparato, como siempre. Cada petición lleva, como en
cualquier web, la IP del aparato; `sala.php` no la guarda en claro (ver «La huella de la IP»).

### Qué se guarda en el servidor y cuánto dura

Todo va en archivos dentro de `api/datos/`, sin base de datos. Son archivos `.php` que empiezan
por una guarda: pedidos por URL, responden 404 vacío.

| Qué | Archivo | Qué hay dentro | Cuándo se borra |
|---|---|---|---|
| Sala | `salas/<sala>.php` | El héroe de cada uno y el hash (SHA-256) de su token. Además: cuándo se creó, cuándo entró cada uno y cuándo se le vio por última vez, si ha salido, el código de la sala y el número del último mensaje | **En cuanto salen los dos**, o cuando sale el que la creó sin que haya entrado nadie (cancelar, código caducado). Si no, por ejemplo con una tablet apagada o sin red: **a las 3 h sin actividad**, en la siguiente limpieza |
| Mensajes | `salas/<sala>.mensajes.php` | Lo de «Qué viaja por la red». Cada mensaje lleva además su número, de quién es y un identificador aleatorio (`cid`). Al llegar a 500 mensajes se quedan los 100 últimos, y como mucho ocupan 4 MB | Con su sala |
| Código | `codigos/<HMAC>.php` (el nombre es un HMAC del código con la sal, no el código) | A qué sala lleva y si ya se ha usado | Deja de valer **a los 15 min**. El archivo se borra con su sala o en la primera limpieza después de esos 15 min |
| Límites | `limites/u-<x>.php` y `limites/c-<x>.php` (16 de cada tipo como mucho), `limites/u-todos.php` | Por cada huella de IP, los momentos de sus intentos de unirse fallidos (últimos 10 min) o de las salas que ha creado (última hora). En `u-todos`, los fallos de todos juntos, sin huellas | En la limpieza, cada archivo que lleva **1 h** sin cambiar. Y **todos** a la vez cuando cambia la pimienta |
| Pimienta | `pimienta.php` | Un valor aleatorio y cuándo se creó | Se sustituye por otra cuando tiene **1 h**: en la siguiente limpieza o en el siguiente crear o unirse |
| Sal | `sal.php` | Un valor aleatorio secreto: da nombre a los archivos de los códigos y firma los tokens de unirse | Nunca (no es un dato de nadie) |
| Marca y candado | `limpieza.php`, `candado.lock` | La fecha de la última limpieza; el candado está vacío | No se borran (no tienen datos de nadie) |

### La huella de la IP es un dato seudónimo

Para limitar intentos (que nadie pruebe códigos hasta dar con la partida de un niño), `sala.php` no
guarda la IP. Guarda un HMAC-SHA256 de la IP con la **pimienta**, recortado a 32 caracteres; en
IPv6 se usa solo el /64.
- La pimienta **cambia cada hora** y, al cambiar, se borran todos los límites. La vieja se
  sobrescribe, y sin ella las huellas viejas ya no se pueden revertir.
- **Mientras dura la pimienta, el HMAC es un dato seudónimo, no anónimo**: quien tuviese una copia de
  `api/datos/` (la pimienta y los límites a la vez) podría probar todas las IPv4 y saber a qué IP
  corresponde cada huella.
- Cuánto puede vivir una huella: la hora de su pimienta más lo que tarde la siguiente limpieza. Con
  la limpieza programada cada hora (sección F), unas **2 h como mucho**. Sin ella, hasta la próxima
  petición a `sala.php`, que puede tardar semanas si nadie juega.
- Las copias de seguridad automáticas del hosting pueden guardar la pimienta y los límites juntos.
  Dentro de esas copias siguen siendo datos seudónimos mientras el hosting las conserve.

### La limpieza

Borra:
- las salas con 3 h sin actividad;
- los códigos caducados;
- los límites de más de 1 h;
- los temporales de escrituras que se cortaron (de más de 10 min);
- y, si la pimienta tiene 1 h, la cambia por otra y borra todos los límites.

Corre en dos casos:
- **con cualquier petición** a `sala.php` (también el ping), **si la anterior fue hace más de
  5 min**;
- **con la tarea programada** (`php sala.php limpiar`, sección F), cada vez que se lanza.

Si nadie llama y no hay tarea programada, **no se borra nada**: todo se queda como estaba hasta la
próxima petición.

### Fuera de `sala.php`

- El hosting apunta en sus registros de acceso y de errores la IP, la fecha y la URL de cada
  petición, como en cualquier web. Las jugadas van en el cuerpo de la petición, que no se apunta.
  Esos registros los gestiona el hosting, no este código: hay que tenerlos en cuenta en el registro de
  actividades de tratamiento.
- `sala.php` solo escribe en el registro de errores mensajes técnicos, sin datos de los jugadores.
- Sin analítica ni otros terceros en el 1 contra 1. La web ya cargaba antes las fuentes de Google
  Fonts, pero eso es de toda la web.

---

## A. Suelo rompible con grietas (los dos modos)

Hecho. Las constantes están en `batalla.js`: `RESISTENCIA`, `ALCANCE_EXTRA` y `etapaGrieta`.

1. **Sin roca madre** (ya no hay `LECHO`):
   - Las filas `y < AGUA` de la isla son rompibles.
   - Las filas `y >= AGUA` son **mar abierto** (`AIRE`): el fondo del lienzo pinta azul profundo
     por debajo de `yAgua`, y la banda de agua se dibuja encima.
   - Un agujero que atraviesa la fila `AGUA-1` deja caer al personaje al mar (`y > AGUA + 0.3` en
     vuelo → `alAgua(e)`).
   - Los proyectiles que caen por el agujero hacen chapuzón como en la orilla.
2. **Daño por bloque (`dano`).** Cada celda guarda el daño acumulado (de 0 a 1 de lo que aguanta).
   - Resistencias: hierba, tierra y arena 1; piedra 1,4; madera y hojas 0,82.
   - Una explosión da a cada bloque un golpe que vale 1 justo en su radio y baja hasta 0 a
     2 bloques más allá (`ALCANCE_EXTRA`), donde solo agrieta.
   - La TNT castiga más a la piedra (×1,4). En tierra hace el cráter de siempre, pero 2 TNT llegan
     al agua.
   - La celda se rompe al llegar a 1. Lo que no se rompe queda **agrietado**.
3. **Grietas visibles**: 3 etapas (daño desde 0,1, desde 0,4 y desde 0,7). Son una capa de píxeles
   **dibujada por nosotros** (estilo Minecraft pero arte propio, nada copiado), pintada encima de la
   textura del bloque, en la capa del terreno. Solo se repinta la celda que cambia de etapa.
4. **Objetivo de dureza**: desde una superficie típica (alturas de los niveles 1-6), abrir un
   agujero hasta el agua disparando al mismo sitio tiene que costar:
   - **2-3 bazucas (mediana)**, nunca 1;
   - **TNT: 2**.
5. **Seguridad del movimiento**:
   - El héroe no anda hacia el agua (`destino` → `peligro`), tampoco por un pozo que llega al mar.
   - Los monstruos evitan igualmente los pozos.
   - Lo único que mete a alguien en el agua es una explosión que rompe el suelo bajo sus pies o
     que lo empuja.
6. **Modo fácil**: el héroe nunca pierde por agua. El rescate lo deja en suelo firme cerca de la
   columna donde empezó el turno (`casa`). Si ya no queda ningún sitio de pie (la isla está
   destruida entera), el rescate pone una plataforma de 3 bloques de piedra en la fila `AGUA-1`, en
   la columna libre más cerca de su casa, y lo deja encima (`stats.plataformas`).
7. **Regresión del modo contra monstruos**: la simulación de 48 partidas (niveles 1-8, normal y
   fácil) tiene que acabar todas, con 0 errores.

## B. Motor: modo duelo

`window.Batalla.iniciar(contenedor, { duelo: {...}, alTerminar, alElegir, infoFin, hueco })`. Si
`opciones.duelo` existe, la partida es un duelo. Si no, todo sigue como contra los monstruos.

### Opciones de `duelo`

```js
duelo: {
  jugadores: [               // 0 = el de la izquierda, 1 = el de la derecha
    { heroe: 'steve', local: true,  ayuda: false },
    { heroe: 'alex',  local: false, ayuda: false },
  ],                         // (si traen el mismo héroe, el 1 pasa a ser el otro)
  empieza: 0,                // índice del que tira primero
  semilla: 123456,           // para generar el mapa (si no hay estadoInicial)
  estadoInicial: null,       // instantánea: el que se une recibe el mapa del que crea
                             // (si no vale, sale el mapa de la semilla)
  tiempoTurno: 60,           // segundos por turno local; 0 = sin límite. Por defecto, 60 si hay
                             // un jugador remoto y 0 si no (la app pone 60 en red y 0 en la tablet)
  alListo(estado),           // mapa listo (instantánea), dentro de iniciar() y de nuevoDuelo(),
                             // antes de volver: el que crea la sala lo manda al otro
  alEmpezarTurno({ n, jugador, local }), // empieza un turno, local o remoto (opcional): la app
                             // ajusta el ritmo del sondeo
  alJugadaLocal(jugada),     // un jugador local acaba de disparar o pasar (enviar ya: el otro
                             // empieza a ver el tiro sin esperar al final del turno)
  alTurnoLocal(turno),       // el turno local ha terminado del todo (todo quieto): resultado oficial
}
```

### La `api` en el duelo

Además de `detener()`, `reiniciar()`, `enCurso()` y `pausar(bool)`:
- `duelo` (solo lectura): `true` en un duelo. Con un `batalla.js` viejo de la caché no existe, y
  así lo detecta la app.
- `recibirJugada(jugada)`: la jugada del rival. Se reproduce en cuanto le toca.
- `recibirTurno(turno)`: el resultado oficial del rival.
  - Si ya se reprodujo su jugada, se espera a que todo esté quieto y se **aplica la instantánea**.
  - Si no llegó la jugada, primero se reproduce y luego se aplica.
  - Se ignora lo repetido o viejo (`n` ya aplicado), lo de otro mapa (`id` distinto) y lo de quien
    no tiene el turno. Lo adelantado (hasta 20 turnos) espera en cola.
  - Las dos devuelven `true` si lo guardan.
- `estado()`: la instantánea actual.
- `nuevoDuelo({ semilla, estadoInicial, empieza, tiempoTurno, jugadores })`: otro duelo (la
  revancha). Llama a `alListo` antes de volver.
- `aviso(texto | null, { salir })`: un cartel fijo encima del juego, para avisos de la app como
  «Esperando a Alex…» o «Alex se ha ido». Con el cartel del final a la vista, va dentro de él.
  - Con `salir: true` lleva un botón **Salir**, que llama a `alElegir({ accion: 'salir' })`.
  - Mientras hay un aviso con Salir (y no está el cartel del final), no sale ningún cartel grande,
    ni de turno ni de final, y se quita el que hubiera. El confeti y el sonido del final sí salen,
    y 1,7 s después sale el cartel del final con el aviso dentro.
  - Con `null` se quita.
- `rival()`: `{ esperando, bloqueado, n, turnoDe }`.
  - `esperando`: se espera al jugador remoto (desde que empieza su turno hasta que llega su turno
    oficial).
  - `bloqueado`: no se puede seguir sin algo de la red.
  - `n` y `turnoDe`: el turno actual y de quién es.

### Flujo de turnos

1. **Al empezar cada turno**:
   - el cartel: «¡Tu turno!» o «Turno de Alex» en red, y «¡Turno de Alex!» en la tablet;
   - se llama a `alEmpezarTurno`.
2. **Turno local.** Funciona como el turno del héroe contra los monstruos: andar, saltar, elegir
   arma y apuntar con el tirachinas.
   - Se graban las `acciones` con su tiempo relativo al inicio del turno.
   - Al disparar, al pasar o al acabarse el tiempo, se llama a `alJugadaLocal`. Si se acaba el
     tiempo, sale «¡Se acabó el tiempo!».
   - Cuando todo queda quieto se llama a `alTurnoLocal` con la instantánea. Esa instantánea se
     aplica también aquí, para que los dos aparatos empiecen igual el turno siguiente.
3. **Turno remoto** (fase `'remoto'`).
   - Controles desactivados; tocar el lienzo no hace nada.
   - Al llegar la jugada, se reproducen las acciones a su tiempo: andar y saltar por la misma
     cola, y el disparo con el mismo ángulo, fuerza y arma.
   - Al quedar todo quieto y tener el turno oficial, se aplica su instantánea, que manda sobre lo
     simulado. Corrige las pequeñas diferencias entre aparatos y el azar de los empujones.
4. **Tablet compartida.** Los dos jugadores son locales. No hay jugada ni turno que enviar, aunque
   se llaman igual.
5. **Fin.** Cuando un héroe queda sin vida o cae al agua:
   - Se llama a `alTerminar({ duelo: true, ganador, empate, gano, tablet, heroeGanador, motivos, n })`:
     - `ganador`: índice del que gana, o `null` si hay empate (caen los dos a la vez);
     - `gano`: si gana un jugador local;
     - `motivos`: por cada héroe, `'vida'`, `'agua'` o `null`;
     - `n`: turnos jugados.
   - Cartel de fin con el texto de quien gana:
     - en red, desde el punto de vista local: «¡Has ganado!» / «¡Gana Alex!»;
     - en la tablet: «¡Gana Steve!»;
     - si caen los dos a la vez: «¡Empate!».
   - Botones «Revancha» y «Salir». `alElegir({ accion: 'otra' | 'salir', duelo: true, ganador, gano })`
     decide qué hacer.
   - Si `infoFin` devuelve `seguir: false`, sale «Revancha 🔒», que se ve pero no se puede tocar.
   - El botón de la revancha se apaga al primer toque, hasta el duelo nuevo (los niños tocan
     cinco veces).

### Reglas del duelo

- **Daño:**
  - La rebaja de daño por tus propias explosiones (`autodano`) se aplica solo al que dispara.
  - El rival recibe el daño completo.
  - El empuje a los héroes es igual para los dos.
- **`ayuda`** por jugador es solo visual:
  - muestra la trayectoria completa y el círculo de dónde explota;
  - no hay imán, ni radio extra, ni inmunidad. Es justo para los dos.
- **Mundo:**
  - Sin monstruos y sin orbes. Sin viento (`viento = 0`) en esta versión.
  - Relieve de nivel 3: colinas, alguna cueva y árboles.
  - El jugador 0 aparece hacia `x≈10` y el jugador 1 hacia `x≈W-11`, los dos en tierra seca.
  - El héroe 1 mira a la izquierda.
- Nada del código de monstruos se rompe porque no haya monstruos: IA, imán, mano de ayuda que
  apunta «al monstruo más cercano» (en duelo, al rival), `separar`, orbes…
- **Marcador:**
  - Una barra de vida por héroe: el 0 arriba a la izquierda y el 1 arriba a la derecha, sin
    pisar el botón del sonido ni el hueco del botón de volver.
  - El texto del turno.
  - Una cuenta atrás visible en los últimos 10 s si hay `tiempoTurno`.
- **Pausa** (`api.pausar`) igual que contra los monstruos.

### Instantánea (`estado`)

JSON compacto de unos 3 KB (tiene que ocupar menos de 8 KB).

```js
{
  v: 1, W, H,
  celdas: '...',      // W*H caracteres, uno por celda (LETRA_BLOQUE)
  dano: '...',        // W*H cifras '0'-'9' (décimas del daño); al leer vale también [[i, d], ...]
  cueva: [i, ...],    // índices de celdas con fondo de cueva
  heroes: [{ x, y, vida, vivo, fuera, dir }, { ... }],
  turnoN, siguiente,  // nº de turnos jugados y a quién le toca
}
```

Una instantánea con un héroe vivo bajo el agua (`y > AGUA`) no vale y se rechaza entera.

### Jugada y turno

```js
jugada = { id, n, jugador, acciones: [{ t, a: 'andar'|'salto'|'arma'|'disparo'|'pasar', dir, arma, ang, fuerza }] }
turno  = { id, n, jugador, acciones: [...], estado: instantanea }
```

- `n` es el número de turno del duelo: 1, 2, 3… seguidos. En las acciones, `t` va en segundos
  con 2 decimales.
- `id` es un resumen del mapa con el que empezó el duelo. Lo que llega con otro `id` (de un duelo
  anterior) se ignora.
- Lo que llega se limpia: solo acciones conocidas, tiempos que no van hacia atrás, como mucho
  150 acciones y nada después del disparo o de pasar.

### Ganchos de prueba (`__prueba`)

Lo de siempre más:
- `estado()` con `duelo: { activo, n, turnoDe, esperandoRemoto, bloqueado, id, ganador, tiempoTurno, queda, acciones, jugadores }`;
- `instantanea()`;
- `aplicar(inst)`.

`disparar`, `mover` y `saltar` actúan sobre el héroe activo cuando es local.

## C. Servidor: `api/sala.php` (PHP 7.4 a 8.x, sin base de datos)

Un solo archivo. Se llama con `POST` y cuerpo JSON, con `Content-Type` `application/json` o
`text/plain` (lo que manda `sendBeacon`). La acción va en el cuerpo o en la URL (`?accion=leer`);
si va en los dos, tiene que ser la misma.

| acción | entrada | salida |
|---|---|---|
| `ping` (GET) | `?accion=ping` | `{ok:true}`. Ligero: mira que `datos/` se pueda escribir, sin escribir (como cualquier petición, le puede tocar la limpieza) |
| `ping` de despliegue | `?accion=ping&comprobar=1` | `{ok:true}`. Crea las carpetas, escribe y borra de verdad un archivo en cada una y prueba el candado |
| `crear` | `{heroe}` | `{sala, token, codigo:[a,b,c,d], yo:0}` |
| `unirse` | `{codigo:[a,b,c,d], cid?}` | `{sala, token, yo:1, heroeRival}` |
| `leer` | `{sala, token, desde}` | `{mensajes:[{n, tipo, datos}], rival:{unido, conectado, visto}, cerrada}` |
| `enviar` | `{sala, token, tipo, datos, cid}` | `{n}` |
| `salir` | `{sala, token}` | `{ok:true}` |

Si el ping no puede escribir (o `datos/` no existe), responde 500 `{ok:false, error:'almacen'}`.

Errores, siempre `{error:'…'}`:

| HTTP | `error` | cuándo |
|---|---|---|
| 400 | `json`, `accion`, `invalido` (+ `campo`) | el cuerpo no es un objeto JSON; acción desconocida, o distinta en la URL y en el cuerpo; un campo mal (`campo` dice cuál) |
| 403 | `token`, `origen` | el token no es de esa sala; la petición viene de otra web |
| 404 | `no-existe` | la sala o el código no existen o han caducado |
| 405 | `metodo` | no es `POST` (salvo el ping) |
| 409 | `llena`, `cerrada`, `tope` | el código ya se usó; enviar a una sala cerrada; la sala pasaría de 4 MB |
| 413 | `grande` | cuerpo de más de 32 KB |
| 415 | `contenido` | `Content-Type` que no es `application/json` ni `text/plain` |
| 429 | `limite` (+ `Retry-After`) | demasiados intentos (ver «Límites») |
| 500 | `almacen`, `servidor` | no se puede leer o escribir en `datos/`; cualquier otro fallo (sin detalles) |
| 503 | `ocupado` (+ `Retry-After: 60`) | ya hay 200 salas vivas (o no se encuentra un código libre) |

Formato y validación:
- `codigo`: exactamente 4 enteros de 0 a 11 (índices de `Red.ANIMALES`).
- `sala`: 16 hex aleatorios. `token`: 32 hex aleatorios por jugador (`random_bytes`). Solo se guarda
  su SHA-256, y se compara con `hash_equals`.
- `cid` de `enviar`: de 1 a 64 caracteres (`A-Z a-z 0-9 _ -`). Si ese jugador ya mandó ese `cid`,
  devuelve el mismo `n`: los reintentos no duplican.
- `cid` de `unirse` (opcional): de 16 a 64 caracteres. El mismo `cid` en 120 s devuelve el mismo
  token, en vez de «llena». Ese token es un HMAC de la sala y el `cid` con la sal.
- `tipo`: lista blanca `inicio`, `jugada`, `turno`, `otra`, `adios`. `datos`: cualquier JSON (lo
  comprueba quien lo recibe).
- `leer`:
  - Devuelve solo los mensajes **del rival** con `n > desde`. `n` es un contador de la sala, sin
    saltos.
  - Apunta mi `visto` (el latido) como mucho cada 5 s.
  - `rival.conectado`: no ha salido y se le vio hace menos de 25 s.
  - `rival.visto`: segundos desde que se le vio, o `null` si aún no ha entrado.
  - Todo sale de la misma lectura que los mensajes. Si el rival manda algo y sale justo en medio,
    `cerrada: true` llega en el `leer` siguiente, junto con lo último que mandó.
- `unirse`: el código no se borra al usarlo. Queda marcado como usado hasta sus 15 min, para poder
  contestar «llena».
- `salir`: el rival ve `cerrada: true`. Si no había rival o ya había salido, la sala y su código se
  borran en el momento.

Almacenamiento (en `api/datos/`; qué hay en cada archivo, en «Privacidad»):
- `salas/<sala>.php`, `salas/<sala>.mensajes.php`, `codigos/<HMAC>.php`, `limites/[uc]-<x>.php`,
  `limites/u-todos.php`, `sal.php`, `pimienta.php`, `limpieza.php` y `candado.lock`.
- Todos son `.php` con una guarda al principio (`<?php http_response_code(404); exit; ?>`), con el
  JSON detrás y `<` y `>` escapados.
- Un único candado (`candado.lock`, con `flock`) para todo el almacén: compartido para leer y
  exclusivo para cambiar algo. Cada archivo se escribe entero en un temporal y se cambia con
  `rename`.
- Las carpetas se crean solas, con un `index.html` vacío. Las carpetas tienen permisos 0700 y los
  archivos 0600.
- `api/datos/.htaccess` niega todo (Apache 2.2 y 2.4) y es la protección de verdad. Sin él no se
  podría leer nada (guarda) ni buscar códigos (nombres HMAC), pero se vería qué archivos existen.

Límites:
- Cuerpo: 32 KB como mucho.
- Mensajes: al llegar a 500 se quedan los 100 últimos (`n` sigue sin saltos). Como mucho 4 MB por
  sala (409 `tope`).
- Salas vivas a la vez: 200 (503 `ocupado`).
- `unirse` fallidos (404 o 409): 10 cada 10 min por IP **y** 40 cada 10 min entre todas las IPs.
  Al pasarse, 429 `limite` con `Retry-After` (600 s como mucho).
- `crear`: 30 por hora por IP.
- Las huellas van en 16 cubos por tipo, con 64 huellas como mucho por cubo: 33 archivos en total,
  vengan las IPs que vengan.

Respuestas:
- JSON con estas cabeceras:
  - `Cache-Control: no-store`;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`;
  - `Referrer-Policy: no-referrer`.
- Sin `X-Powered-By`.
- Sin CORS: si el navegador manda `Origin`, tiene que ser la propia web (si no, 403 `origen`).
- Nunca se enseñan avisos ni rutas de PHP (`display_errors` apagado). Un error fatal responde
  500 `{error:'servidor'}`.

Limpieza: con cualquier petición, como mucho cada 5 min, y con la línea de órdenes (ver
«Privacidad»). `php sala.php limpiar` limpia y sale con 0 (bien), 1 (error, con el mensaje por
la salida de errores) o 2 (orden que no es `limpiar`).

## D. Cliente de red: `js/minijuegos/red.js` → `window.Red`

```js
Red.ANIMALES = ['🐷','🐮','🐔','🐶','🐱','🐰','🐸','🐵','🦁','🐻','🐼','🦊']
Red.disponible(forzar)  → Promise<bool>  // ping; el sí se recuerda, el no se vuelve a probar
                                         // pasados 15 s (o con forzar)
Red.crear(heroe)        → Promise<{sala, token, codigo, yo: 0, heroe}>
Red.unirse(codigo)      → Promise<{sala, token, codigo, yo: 1, heroe, heroeRival}>
Red.conectar(sesion, {alMensaje(m), alRival(r), alCerrada(), alError(e)})
  → { enviar(tipo, datos) → Promise<n>, ritmo('rapido'|'lento'), salir() → Promise<bool>, cerrar(), estado() }
```

Si `crear` o `unirse` fallan, rechazan con un `Error` con `.codigo`:
- `'no-existe'`: no hay partida con ese código o ya caducó (y también con un código mal formado);
- `'llena'`: esa partida ya ha empezado;
- `'limite'`: demasiados intentos o servidor lleno (429 o 503). `.espera` dice cuánto esperar en
  segundos (60 si el servidor no lo dice);
- `'red'`: sin conexión, el servidor no contesta o no contesta JSON (se intenta hasta 3 veces
  antes de rendirse);
- `'invalido'`: `crear` con un héroe que no es `steve` ni `alex` (no llega a pedir nada).

`crear` solo rechaza con `'limite'`, `'red'` o `'invalido'`.

Comportamiento de `conectar`:
- **Sondeo con `leer`:**
  - Cada ~1 s en ritmo `rapido` (esperando al rival; es el de partida) y cada ~3 s en `lento` (mi
    turno: solo latido).
  - Al ocultarse la página se para. Al volver, se lee enseguida, y lo que llevaba más de 2 s en
    vuelo se repite (los iPad congelan las pestañas).
  - Si falla, se reintenta esperando 1, 2, 4, 8, 8… s. A `Retry-After` se le hace caso, hasta
    1 min.
- **`alMensaje({n, tipo, datos})`:** los mensajes del rival, en orden y nunca repetidos. Va
  apuntando en `sesion.desde` el último `n` recibido, y otro `conectar` con la misma sesión sigue
  desde ahí. Una sola conexión por sesión: conectar otra vez cierra la anterior.
- **`alRival({unido, conectado, visto, sinRed})`:** solo cuando cambia `unido`, `conectado` o
  `sinRed` (y la primera vez). `sinRed` es `true` si se llevan 12 s sin poder hablar con el
  servidor; entonces `conectado` va a `false`, porque no se sabe.
- **`alCerrada()`:** el rival ha salido, después de entregar sus últimos mensajes. Deja de sondear.
- **`alError(e)`:** la sala ya no sirve (`e.codigo` `'no-existe'`, `'token'`, `'tope'`…). Lo deja
  todo parado. Los cortes de red nunca llegan aquí: se reintenta siempre y se avisa con `sinRed`.
  Sin `alError`, se avisa con `alCerrada`.
- **`enviar`:** en orden, uno detrás de otro, con reintentos y espera creciente mientras no haya
  respuesta. Cada envío lleva su `cid`, así que un reintento nunca duplica. Rechaza con `.codigo`:
  - `'cerrada'`: sala cerrada o conexión cerrada;
  - `'grande'`: más de 32 KB;
  - `'invalido'`: el tipo o los datos;
  - o el error que paró la sala.
- **`salir()`:**
  - Espera como mucho 3 s a que salga lo pendiente (por ejemplo, un `adios`) y avisa al servidor
    (3 intentos).
  - Nunca rechaza. Contesta en 6 s como mucho y, sin red, sigue intentándolo por detrás.
  - Si la página se está cerrando (`pagehide`) o está oculta, lo hace con `sendBeacon`: primero lo
    pendiente (hasta 48 KB) y luego el salir, que siempre cabe.
  - Al cerrarse la página de verdad (`pagehide` sin caché), las conexiones vivas salen solas.
- **`cerrar()`:** para aquí sin avisar al servidor. `estado()` es para pruebas y depuración.
- Peticiones: `fetch` a `api/sala.php` (relativo a la página), con `cache: 'no-store'`,
  `credentials: 'same-origin'` y `referrerPolicy: 'same-origin'`, para que el `Origin` vaya bien.
- Sin dependencias. Por la red solo viaja lo que se pasa a `crear` (el héroe) y a `enviar` (las
  jugadas).

## E. App (`index.html`, `js/app.js`, `css/estilos.css`)

### Pantalla de la Batalla (`v-minijuegos`)

- Un selector «¿Contra quién?» con dos botones grandes: **🧟 Monstruos** | **⚔️ 1 contra 1**.
  Se recuerda por niño.
- **Monstruos**: héroe, nivel y ¡A jugar!, como siempre.
- **1 contra 1**:
  - Se mantiene la elección de héroe (el tuyo); se ocultan los niveles.
  - Tres botones: **📱 En esta tablet** · **📡 Crear partida** · **🔑 Unirme**.
  - Si no quedan partidas, desactivados con el mismo 🔒 «Te faltan N ⭐».
  - Mientras se pregunta si hay servidor (ping), los de red esperan apagados.
  - Si no hay servidor (por ejemplo, en la vista previa o en GitHub Pages), sale «El juego en red
    no está disponible aquí» y solo queda «En esta tablet», centrado. Ese «no» se vuelve a probar
    cada 16 s mientras se siga en la pantalla, al volver la red y al volver a la página.

### En esta tablet (`v-tablet`)

- Pantalla de preparación: Steve contra Alex. Tu héroe va en tu lado, con tu foto o tu dibujo
  (solo en la pantalla).
- Bajo cada héroe, un interruptor **🎯 Ayuda**. En el lado del perfil va encendido si es peque.
- ▶ ¡A jugar! gasta 1 partida, y luego cada Revancha otra. `tiempoTurno: 0`.

### Crear partida (`v-sala`)

- «Tu código» con los 4 animales grandes, el texto «Dile a la otra persona que toque estos
  animales en su tablet», un «Esperando…» animado y el botón Cancelar.
- Si este aparato se queda sin red, el texto pasa a «Sin conexión».
- Cancelar con la sala aún vacía la borra en el servidor y no manda `adios`.
- El código caduca a los 14,5 min (el servidor lo borra a los 15). Se cuenta con la hora de
  verdad, no solo con el temporizador, que no avanza con el iPad dormido: se mira con cada novedad
  de la sala y 2 s después de volver a la página. Sale «Este código ya no vale» y «🔄 Otra vez».
- Si falla al crear: «Espera un poquito…» (límite) o «Sin conexión», con «🔄 Otra vez».
- Cuando entra el rival:
  1. Se genera el mapa.
  2. Se manda `inicio` con `{estado, empieza, heroes, partida: 1}` y empieza el duelo.
  3. Se gasta 1 partida (solo si el motor ha arrancado de verdad el duelo).

### Unirme

- 4 huecos, una rejilla de 12 animales (3×4) y ⌫. Con los 4 puestos, se envía solo.
- Mensajes de error claros y sin leer mucho:
  - «No encuentro esa partida. Mira bien los animales»;
  - «Esa partida ya ha empezado»;
  - «Espera un poquito…»: el teclado descansa lo que diga el servidor, entre 5 y 60 s (30 si no lo
    dice);
  - «Sin conexión».
- El código equivocado se queda a la vista, para compararlo, hasta que se toca otro animal.
- Ya dentro, se ve el héroe con el que vas a jugar mientras se espera el `inicio`.
- Si el que creó la sala se va antes de empezar, se vuelve al teclado con «Steve se ha ido».
- Al recibir `inicio` empieza el duelo y se gasta 1 partida.

### Protocolo de mensajes (lo que se mandan las dos apps)

El que crea la sala es el jugador 0 (izquierda) y el que se une, el 1 (derecha, con el otro héroe).

| `tipo` | lo manda | `datos` | cuándo |
|---|---|---|---|
| `inicio` | el que crea | `{estado, empieza, heroes, partida}` | al empezar y en cada revancha (desde `alListo`) |
| `jugada` | el que tiene el turno | lo de `alJugadaLocal`: `{id, n, jugador, acciones}` | al disparar o pasar |
| `turno` | el que tiene el turno | lo de `alTurnoLocal`: `{id, n, jugador, acciones, estado}` | con todo quieto |
| `otra` | cualquiera de los dos | `{puede, partida}` | `puede: true`: pide la revancha. `puede: false`: no le quedan partidas. Sale solo al acabar un duelo sin partidas, o al ir a empezar una revancha que ya no puede pagar |
| `adios` | el que se va | `null` | al salir, solo si hay alguien que lo lea |

`partida` es el número de duelo en esa sala (1, 2…). Lo que llegue de un duelo anterior no cuenta.

### En red

- `ayuda` = el perfil local es peque. `tiempoTurno: 60`.
- **Ritmo del sondeo:**
  - `lento` en mi turno (desde `alEmpezarTurno`);
  - `rapido` en el turno del rival, después de mandar mi `turno` (`alTurnoLocal`) y en el final
    (esperando la revancha o el adiós).
- **Pantalla encendida (Wake Lock, Safari 16.4 o más)** mientras haya sala o duelo en red. Se
  vuelve a pedir al volver a la página y se suelta al salir. En la tablet compartida no se pide.
- **Avisos** (`api.aviso`), lo más importante primero:
  - «Se ha cortado la partida» (`alError`), con Salir;
  - «Alex se ha ido» (sala cerrada o `adios`), con Salir;
  - «Alex no puede jugar más hoy» (`otra` con `puede: false`), con Salir;
  - «Sin conexión…» (`sinRed`: es este aparato el que no llega al servidor);
  - «Esperando a Alex…» (el rival no se ve desde hace 25 s), con Salir;
  - «Esperando a Alex…» (he pedido la revancha) / «¡Alex quiere revancha!».
- **El rival no se ve** (y este aparato sí tiene red): si en **2 min** no vuelve, pasa a «Alex se
  ha ido», se apaga la revancha y se sale de la sala, para que él lo vea si vuelve. Con la página
  oculta no se decide.
- **Con el rival fuera** el duelo no sigue (el niño dispararía a nadie). Si su último turno ya
  llegó entero, se ve hasta el final; después, cada turno que empieza se para enseguida. Queda el
  aviso con Salir, y con `alError` además se sale de la sala, para que el otro la vea cerrada.
- **⬅️**: pregunta «¿Salir de la partida?». En red **no pausa**: el reloj del turno (60 s) sigue
  y el otro no se queda esperando. En la tablet y contra monstruos, sí pausa.
- **Salir** (botón o ⬅️): `adios` si hay alguien que lo lea, y `salir()`.
- **Revancha**:
  - Se manda `otra` y se espera al otro. Cuando los dos la han pedido, el que creó la sala gasta
    1 partida, genera un mapa nuevo y manda `inicio`; el otro gasta la suya al recibirlo.
  - Sin partidas: «Revancha 🔒», y el otro ve «Alex no puede jugar más hoy».

### Toques, versiones y caché

- **Doble toque**: durante 450 ms después de cambiar de pantalla no cuentan los clics (el 2.º toque
  caería en la pantalla nueva). Los controles del juego van con `pointerdown`, así que no les
  afecta. `touch-action: manipulation` en toda la página quita el zoom por doble toque (se puede
  seguir pellizcando).
- **Versión en las URLs**: `index.html` carga `css/estilos.css?v=AAAAMMDD` y todos los `<script>`
  con el mismo `?v=`. Hay que cambiarlo en cada despliegue (sección F). Solo va en el código (css y
  js), que es lo que puede mezclar versiones. Los iconos, el vídeo y su póster no lo llevan, y el
  manifiesto se revalida siempre con el `.htaccess` de la raíz. Si alguno de ellos cambia, hay que
  ponerle también un `?v=`.
- **Guardas ante una caché mezclada**:
  - Con un `index.html` viejo, `app.js` no se cae: solo queda el modo contra monstruos.
  - Con un `batalla.js` viejo (sin duelo), el duelo no arranca y se vuelve al menú. La partida se
    gasta siempre después de comprobar que el motor ha arrancado el duelo.

### Frases y textos

- Sin frases nuevas de audio.
- Al ganar en red, `bravo()` (frase con el nombre del niño local, solo en su tablet); al perder,
  el ánimo de siempre.
- En la tablet, las felicitaciones **sin nombre** (`C.felicitaciones(null)`), porque quien gana
  puede no ser el perfil abierto.
- Textos en pantalla con los nombres de los héroes (Steve / Alex), nunca nombres de niños por
  la red.

## F. Despliegue por FTP con FileZilla

Para subir la web al hosting por FTP. En los ejemplos, la web está en https://tu-dominio.es/juegos/ y,
en el servidor, en la carpeta de tu web en el hosting, por ejemplo `www/juegos/` (depende del hosting).

### 1. Antes de subir

1. En tu ordenador, abre `index.html` con un editor de texto. Mira el número que va detrás de
   `?v=` en la hoja de estilos (ahora, `20261107`). Ese número sale 17 veces: la hoja de estilos y
   los 16 scripts. Cámbialo en todas por la fecha de hoy (`AAAAMMDD`), la misma en todas. Lo más
   fácil es Buscar y reemplazar: `?v=20261014` → `?v=20261020` y «Reemplazar todo». Guarda.
2. Abre FileZilla y conéctate al hosting. En el menú: **Servidor → Forzar mostrar archivos
   ocultos**. Si no, no se ven los `.htaccess`.
3. A la izquierda, la carpeta del proyecto en tu ordenador; a la derecha, `www/juegos/` en el
   servidor.

### 2. Qué subir, en este orden

Arrastra de izquierda a derecha, cada cosa a su misma carpeta. Si FileZilla pregunta, elige
«Sobrescribir». Si falta alguna carpeta en el servidor (`api`, `api/datos`), créala antes: botón
derecho → «Crear directorio».

1. la carpeta `js/` entera (con el teatro en inglés: `js/teatro.js`, `js/teatro-escena.js` y
   `js/teatro-guion.js`);
2. la carpeta `css/` entera;
3. las voces del teatro en inglés: la carpeta `audio/teatro/` entera, con `gb/`, `us/` y
   `manifest.js` (va a `www/juegos/audio/teatro/`). Ojo: `index.html` carga
   `audio/teatro/manifest.js`, así que tiene que estar subido antes que él;
4. las frases en español nuevas: los MP3 que falten en `www/juegos/audio/` (con el teatro, las
   de «Escucha al lobo.», «¡Ahora tú!», «¡Sopla muy fuerte!», «Escucha a los cerditos y di la
   frase del lobo.», «¿Qué dice ahora el lobo?» y «¡Bravo, qué función!») y `audio/manifest.js`,
   que es el que dice cuáles hay. Lo más fácil: arrastrar la carpeta `audio/` entera y, cuando
   FileZilla pregunte por los que ya están, «Sobrescribir si la fuente es más reciente» (marca
   «Usar siempre esta acción»);
5. `api/sala.php`;
6. `api/datos/.htaccess`;
7. `api/datos/index.html`;
8. el `.htaccess` de la raíz del proyecto (va a `www/juegos/.htaccess`). Si en el servidor ya
   había uno, ábrelo antes (botón derecho → «Ver/Editar»): si tiene otras líneas, hay que juntar
   los dos, no pisarlo;
9. **el último, `index.html`.**

El orden importa: `index.html` es el que dice qué versión cargar. Si llegase antes que lo demás,
una tablet podría juntar la página nueva con código viejo.

Lo demás (`media/`, los iconos, `manifest.webmanifest`) no cambia con el 1 contra 1 ni con el
teatro. Solo hay que subirlo la primera vez, y también antes de `index.html`. `audio/` cambia cada
vez que hay frases nuevas (pasos 3 y 4).

### 3. Qué NO subir

- De `api/datos/`: `sal.php`, `pimienta.php`, `limpieza.php`, `candado.lock` y las carpetas
  `salas/`, `codigos/` y `limites/`. Son los datos de las pruebas en tu ordenador; el servidor crea
  los suyos solo.
- `docs/`, `scripts/`, `.github/`, `video/`, `package.json`, las pruebas de voces (`prueba-voz/`,
  `prueba-teatro/`) y **`.env` o cualquier `.env…`** (ahí está la clave de ElevenLabs). Tampoco
  hacen falta `README.md`, `node_modules/` ni `api/datos/.gitignore`.

Si alguna vez subiste alguno, bórralo del servidor (botón derecho → «Eliminar»). En
`api/datos/`, hazlo una sola vez y con nadie jugando: el servidor los vuelve a crear solos, con una
sal nueva. Los que cree el propio servidor después son los buenos: no hay que tocarlos.

### 4. PHP y permisos

- **Versión de PHP: 7.4 o más.** Se elige en el panel del hosting (en algunos, en un archivo de
  configuración de la carpeta raíz). Tiene que ser 7.4 o más, por ejemplo `8.2`.
  Ojo: la versión vale para todo el hosting, así que si hay otras webs, comprueba que
  funcionan con ella.
- **Permisos de `api/datos/`**: PHP tiene que poder escribir ahí. Botón derecho sobre la carpeta
  `api/datos` del servidor → «Permisos de archivo…» → valor numérico `705` (lo normal en muchos hostings) →
  Aceptar, sin marcar la casilla de los subdirectorios.

### 5. Comprobar

Abre en el navegador:

1. https://tu-dominio.es/juegos/api/sala.php?accion=ping → tiene que salir `{"ok":true}`.
   - Si se ve el código de PHP o se descarga un archivo, PHP no funciona en esa carpeta.
   - Si sale `{"ok":false,"error":"almacen"}`, no existe `api/datos/` o PHP no puede escribir en
     ella: revisa el paso 4.
2. https://tu-dominio.es/juegos/api/sala.php?accion=ping&comprobar=1 → `{"ok":true}`. Esta
   escribe y borra de verdad un archivo en cada carpeta de `api/datos/`. Si sale `almacen`,
   revisa el paso 4.
3. https://tu-dominio.es/juegos/api/datos/index.html → tiene que dar **error 403** (Forbidden).
   Si sale una página en blanco, el `.htaccess` de `api/datos/` no está o no se aplica: súbelo
   otra vez. El ping no detecta esto.
4. La portada https://tu-dominio.es/juegos/ carga. **Si da error 500 (o 403)**, borra del servidor
   `/juegos/.htaccess` (el de la raíz): ese hosting no deja poner cabeceras (o reglas de mod_rewrite,
   que lleva la red de seguridad de la puerta). Sin él todo funciona igual; solo protege algo menos de
   la caché. Con la puerta puesta, no: mira `docs/PUERTA-Y-COPIA.md`, sección 7.

### 6. Recargar el iPad

En el iPad, abre la web y recárgala (↻ en Safari). Si está en la pantalla de inicio como app,
ciérrala del todo (desliza hacia arriba en el selector de apps) y ábrela otra vez.

No borres los «Datos de sitios web» en los ajustes de Safari: ahí están los perfiles y las estrellas
de los niños.

### 7. Limpieza programada (opcional)

Sin ella, las salas que se quedan a medias y las huellas de IP solo se borran cuando alguien
vuelve a usar el 1 contra 1 (ver «Privacidad»). Con ella, cada hora: las huellas duran como mucho
unas 2 h, y las salas a medias unas 4 h (3 h sin actividad más la hora hasta la limpieza). Hay
dos formas:

- **Opción 1: tarea programada del hosting.** En el panel del hosting, en las tareas programadas
  (cron) → añadir:
  - comando: `www/juegos/api/sala.php limpiar` (la ruta depende de dónde esté la web);
  - lenguaje: PHP 7.4 o más;
  - frecuencia: cada hora;
  - la primera vez, activa que te mande el registro por correo.

  **Sin verificar:** que el hosting pase el argumento `limpiar` y lo ejecute como línea de órdenes. Si
  funciona, no escribe nada. Si en el registro sale «Uso: php sala.php limpiar» o
  `{"error":"metodo"}`, no ha limpiado: usa la opción 2.
- **Opción 2: un monitor externo.** Un servicio de «uptime» (por ejemplo, UptimeRobot) que abra cada
  hora https://tu-dominio.es/juegos/api/sala.php?accion=ping, sin `comprobar=1`. Cada ping lanza la
  limpieza si han pasado más de 5 min desde la anterior. Ese servicio solo ve esa dirección y la
  respuesta `{"ok":true}`: no le llega ningún dato de los niños.

## G. Pruebas en local

- Servidor, desde la carpeta del proyecto: `php -S 127.0.0.1:PUERTO -t .`. Sirve los estáticos y
  `api/sala.php`. Con `npm start` (serve, sin PHP), el 1 contra 1 en red sale «El juego en red no
  está disponible aquí».
- `php -S` atiende las peticiones de una en una. Para probar peticiones a la vez (carreras, el
  candado): `PHP_CLI_SERVER_WORKERS=4 php -S …`.
- `php -S` no lee los `.htaccess`: la caché de `index.html` y el 403 de `api/datos/` solo se pueden
  probar en un Apache.
- Para forzar límites (tope de mensajes, cupos…), sirve una copia propia con las constantes de
  `sala.php` más bajas.
- Limpieza a mano: `php api/sala.php limpiar`.
- Las pruebas dejan datos en `api/datos/` (git los ignora). No se suben (sección F).
- Playwright instalado con npm (`npm install` y `npx playwright install chromium`). Se pueden usar
  dos contextos de navegador para jugar en red contra uno mismo.

## H. Riesgos conocidos y pendientes

- **Servidor:**
  - `ping&comprobar=1` no pide credenciales y se puede pedir en ráfaga: cada vez escribe y borra
    4 archivos y prueba el candado. El ping normal ya no escribe.
  - Cupo de unirse entre todas las IPs (40 fallos cada 10 min): quien ataque deja a todo el mundo
    sin poder unirse durante 10 min. Es mejor eso que un extraño en la partida de un niño. Las
    erratas de los niños también cuentan para ese cupo.
  - Con IPs que van cambiando, el límite por IP pierde fuerza: los cubos se quedan solo con las
    64 huellas más recientes y la pimienta cambia cada hora. `unirse` queda cubierto por el cupo de
    todas las IPs, y `crear` por el tope de 200 salas.
  - Un reintento de un envío que ya se recortó (más de 100 mensajes atrás) se tomaría como nuevo.
    `red.js` solo reintenta el último, así que no pasa.
  - Si el `.htaccess` de `api/datos/` no se aplica, se ve qué archivos existen (no su contenido).
    Hay que comprobar el 403 en cada despliegue.
  - `/juegos/.htaccess` necesita que el hosting permita cabeceras en `.htaccess` (`AllowOverride`
    con `FileInfo`). Si no, toda la web da error 500.
  - La tarea programada del hosting con `sala.php limpiar` no se ha probado.
- **App:**
  - El `?v=` se cambia a mano. Si se olvida, vuelve el riesgo de mezclar archivos viejos y nuevos.
    Las guardas de `app.js` evitan lo peor (que no arranque o que gaste partidas sin jugar), pero
    no cubren todas las mezclas.
  - Wake Lock solo funciona desde Safari 16.4. En aparatos más viejos, la pantalla se puede
    bloquear en el turno del otro: la partida se para y, si pasan 2 min, el otro aparato lo da
    por ido.
  - Con «Esperando a Alex…» (los 2 primeros minutos sin ver al otro) los controles siguen activos
    a propósito, por si vuelve: el niño puede pasarle el turno aunque no esté. A los 2 minutos sale
    «se ha ido» y el duelo se para.
  - Sin probar en un iPad o iPhone de verdad: el zoom por doble toque de Safari, Wake Lock y el
    bloqueo real de la pantalla.
- **Motor:**
  - Contra monstruos, el héroe cae ahora al agua en más partidas (en las simulaciones, un 7 % en
    modo normal frente al 1 % de antes), casi siempre por disparar a bocajarro a un monstruo pegado
    y romperse el suelo bajo los pies. Es el comportamiento de Worms que se pidió. Si frustra, se
    puede suavizar: que tus propias explosiones agrieten pero no rompan el bloque que pisas.
