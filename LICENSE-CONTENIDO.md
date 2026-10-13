# Licencia del contenido: CC BY-NC 4.0

Copyright (c) 2026 bernardopersonal

El **contenido** de Juegos peques se publica con la licencia
[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/)
(en español, Reconocimiento-NoComercial). El texto legal completo está en
<https://creativecommons.org/licenses/by-nc/4.0/legalcode>.

## Qué es contenido

| Carpeta o archivo | Qué hay |
|---|---|
| `audio/` | Las frases con voz del juego (MP3), generadas con ElevenLabs |
| `media/` | El vídeo de presentación y su póster |
| `video/narracion/` | La narración del vídeo de presentación (MP3), generada con ElevenLabs |
| `icono.svg`, `icono-180.png`, `icono-512.png` | Los iconos de la app |
| `docs/capturas/` | Las capturas y las imágenes del README |

Todo lo demás es código (HTML, CSS, JavaScript, PHP, los scripts `.mjs` y los workflows) y va con la
licencia MIT: [LICENSE](LICENSE). Las fuentes de `video/fuentes/` tienen su propia licencia, la SIL Open
Font License 1.1: [OFL.txt](video/fuentes/OFL.txt).

## En resumen

Este resumen no sustituye a la licencia.

**Puedes:**
- **Compartir:** copiar y redistribuir el contenido en cualquier medio o formato.
- **Adaptar:** remezclarlo, transformarlo y crear a partir de él.

**Con estas condiciones:**
- **Reconocimiento:** cita la obra («Juegos peques», de bernardopersonal, con enlace a
  <https://github.com/bernardopersonal/juegos-peques-es>), enlaza la licencia e indica si has hecho
  cambios. Con los audios y la narración, cita también que las voces están generadas con ElevenLabs
  (elevenlabs.io).
- **No comercial:** no puedes usarlo con fines comerciales.
- **Sin restricciones adicionales:** no puedes añadir condiciones legales ni medidas tecnológicas que
  impidan a otros hacer lo que la licencia permite.

## Por qué no comercial

Las voces se generaron con el plan gratuito de ElevenLabs, que es para uso no comercial y pide citar a
elevenlabs.io. Si quieres usar el juego con fines comerciales, el código (MIT) lo permite, pero tienes
que cambiar el contenido: genera de nuevo todos los audios con una cuenta de ElevenLabs que lo permita
(`npm run audios -- --force`, ver el README) y pon tus propios iconos, vídeo y capturas.
