// Guion del vídeo de presentación (scripts/hacer-video.mjs): una frase por escena.
// Si cambias un texto, solo se regenera esa frase. La narración se guarda en
// video/narracion/<slug del texto>.mp3.
export const GUION = [
  { id: 'titulo', tipo: 'titulo', titulo: 'JUEGOS PEQUES', min: 5,
    texto: '¡Bienvenidos a Juegos peques! Un mundo de bloques y unicornios para aprender jugando.' },
  { id: 'jugador', titulo: 'Elige tu jugador', min: 6,
    texto: 'Primero, elige tu jugador. Pon tu foto y tu tema favorito: unicornios, espacio, fútbol… ¡o bloques!' },
  { id: 'trazar', titulo: 'Trazar', min: 7,
    texto: 'Con Trazar, sigue la bolita verde con el dedo y aprende a escribir números y letras.' },
  { id: 'peques', titulo: 'Para los más peques', min: 6,
    texto: 'Los más peques pueden contar, buscar colores y encontrar letras.' },
  { id: 'sonidos', titulo: 'Sonidos', min: 4.5,
    texto: 'En Sonidos, escucha la palabra y toca el sonido con el que empieza.' },
  { id: 'silabas', titulo: 'Sílabas', min: 6.5,
    texto: 'En Sílabas, busca la sílaba que oyes… o escríbela tú con el dedo.' },
  { id: 'palabras', titulo: 'Palabras', min: 5,
    texto: 'Y en Palabras, junta las sílabas para formar palabras de verdad.' },
  { id: 'final', tipo: 'final', titulo: '¡A JUGAR!', min: 6,
    texto: '¡Gana estrellas, sube de nivel y conviértete en un campeón! ¿Preparados? ¡A jugar!' },
];
