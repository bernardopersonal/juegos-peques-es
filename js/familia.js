// Lo que es de tu familia: los niños que tienen voz con su nombre y la rutina de la semana.
// Todo lo demás (juegos, frases, temas) vale para cualquiera y está en js/contenido.js.
//
// Así, vacío, el juego funciona igual para todos:
//   - en el inicio cada niño crea su perfil (nombre, edad, foto o dibujo y tema) y la voz le habla sin
//     nombre («¡Muy bien!»);
//   - Días de la semana tiene el orden, el cole y el fin de semana, pero no «¿Qué toca?»;
//   - no hay vídeo de los días.
//
// Para ponerle tus niños y vuestra semana:
//   1. Rellena perfiles, rutina y, si quieres, videoDias. Abajo hay un ejemplo comentado, con niños y
//      actividades inventados: cópialo fuera del comentario y cámbialo.
//      - perfiles: la clave (ana, mateo) es el id del perfil: en minúsculas, sin tildes ni espacios.
//        nombre, edad (hasta 4 años ven los juegos de peques), tema (uno de js/temas.js: unicornios,
//        princesas, divertido, futbol, espacio, coches, bloques, dinosaurios), emoji y bienvenida.
//      - rutina.dias: de lunes a domingo; emoji del vagón y qué toca. rutina.emoji es el del botón
//        «¿Qué toca?» y rutina.preguntas, sus preguntas (dias: los que valen, lunes = 0).
//   2. Genera los audios con tu propia cuenta de ElevenLabs (su plan gratuito es para uso no comercial
//      y pide citar a elevenlabs.io). Cada familia usa su clave: nunca la pongas en el código.
//      - Copia .env.example como .env y pon tu clave (ELEVENLABS_API_KEY) y la voz (ELEVENLABS_VOICE_ID;
//        npm run voces te enseña voces en español). El .env no se sube nunca a git.
//      - npm run audios:simular dice cuántas frases y caracteres faltan, sin gastar nada.
//      - npm run audios genera solo las que faltan: las de los nombres (bienvenida y felicitaciones con
//        nombre) y las preguntas de la rutina. Los demás audios ya vienen hechos.
//      - En GitHub, lo mismo con el Action «Generar audios» (Secret ELEVENLABS_API_KEY y variable
//        ELEVENLABS_VOICE_ID).
//      Mientras una frase no tenga audio, la dice la voz del navegador: funciona, pero con otra voz.
//   3. Vídeo de los días (opcional): rellena también actividad e icono de cada día (uno de los iconos
//      de los días de ICONOS_DEF, en video/escena.js) y videoDias.guion, y ejecuta
//      npm run video:dias (ElevenLabs para la narración; unos 420 caracteres). Copia video/dias.mp4 a
//      media/dias.mp4 y pon videoDias.archivo: 'media/dias.mp4'.
//
// Se usa en el navegador (window.FAMILIA, se carga antes de js/contenido.js) y en Node (require desde
// js/contenido.js y scripts/hacer-video-dias.mjs).
(function (root) {
  const FAMILIA = {
    perfiles: {},
    rutina: null,
    videoDias: null,

    // ---------- Ejemplo (inventado) ----------
    // perfiles: {
    //   ana: { nombre: 'Ana', edad: 9, tema: 'princesas', emoji: '🦊', bienvenida: '¡Hola, Ana! ¡Bienvenida!' },
    //   mateo: { nombre: 'Mateo', edad: 4, tema: 'coches', emoji: '🐯', bienvenida: '¡Hola, Mateo! ¡Bienvenido!' },
    // },
    // rutina: {
    //   emoji: '📚',
    //   dias: [
    //     { emoji: '📚', que: 'Biblioteca', actividad: 'Biblioteca', icono: 'libro' },
    //     { emoji: '🎵', que: 'Música', actividad: 'Música', icono: 'musica' },
    //     { emoji: '🌳', que: 'Parque', actividad: 'Parque', icono: 'parque' },
    //     { emoji: '🏊', que: 'Piscina', actividad: 'Piscina', icono: 'piscina' },
    //     { emoji: '👵', que: 'Con los abuelos', actividad: 'Con los abuelos', icono: 'abuelos' },
    //     { emoji: '🎉', que: 'Fin de semana', actividad: 'Fin de semana', icono: 'globos' },
    //     { emoji: '🛋️', que: 'Fin de semana', actividad: 'Fin de semana', icono: 'sofa' },
    //   ],
    //   preguntas: [
    //     { pregunta: '¿Qué día vamos a la biblioteca?', dias: [0] },
    //     { pregunta: '¿Qué día hay piscina?', dias: [3] },
    //     { pregunta: '¿Qué día vemos a los abuelos?', dias: [4] },
    //   ],
    // },
    // videoDias: {
    //   archivo: 'media/dias.mp4',
    //   guion: { // cada frase tiene que nombrar sus días
    //     lm: 'El lunes vamos a la biblioteca y el martes toca música.',
    //     mj: 'El miércoles, al parque, y el jueves, a la piscina.',
    //     vi: '¡Y el viernes vemos a los abuelos!',
    //   },
    // },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FAMILIA;
  else root.FAMILIA = FAMILIA;
})(typeof window !== 'undefined' ? window : globalThis);
