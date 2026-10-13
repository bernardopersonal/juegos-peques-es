// Temas visuales. Cada niño elige el suyo en su perfil.
// fondo/tinta/tarjeta: superficie; c1-c4: colores de las tarjetas de juego;
// acento: trazo y botones activos; deco: emojis del fondo; fiesta: confeti.
(function (root) {
  root.TEMAS = {
    unicornios: {
      nombre: 'Unicornios', emoji: '🦄',
      fondo: '#fdf1ff', tinta: '#4a2a5e', tarjeta: '#ffffff', guia: '#f1e1f5',
      c1: '#ff8fc8', c2: '#b48cff', c3: '#7cc8ff', c4: '#ffc46b', acento: '#e05fb0',
      deco: ['🦄', '🌈', '✨', '☁️', '💖'], fiesta: ['🦄', '🌈', '✨', '💖', '⭐'],
    },
    princesas: {
      nombre: 'Princesas', emoji: '👑',
      fondo: '#fff3f6', tinta: '#5a2340', tarjeta: '#ffffff', guia: '#f8e1e8',
      c1: '#f06292', c2: '#ce93d8', c3: '#f6c453', c4: '#90caf9', acento: '#d81b60',
      deco: ['👑', '🏰', '💎', '🌸', '🪄'], fiesta: ['👑', '💎', '🌸', '✨', '💖'],
    },
    divertido: {
      nombre: 'Divertido', emoji: '🤪',
      fondo: '#fff8e1', tinta: '#2f2a40', tarjeta: '#ffffff', guia: '#f3ead2',
      c1: '#ff7a59', c2: '#4fc3f7', c3: '#9ccc65', c4: '#ba68c8', acento: '#ff5722',
      deco: ['🎈', '🍭', '🤪', '🎉', '🍦'], fiesta: ['🎉', '🎈', '🍭', '🤩', '🎊'],
    },
    futbol: {
      nombre: 'Fútbol', emoji: '⚽',
      fondo: '#eaf7ea', tinta: '#123b22', tarjeta: '#ffffff', guia: '#d6ecd6',
      c1: '#2e9e4f', c2: '#1e6fd9', c3: '#f2b705', c4: '#e53935', acento: '#1b7f3a',
      deco: ['⚽', '🥅', '🏆', '👟', '🎽'], fiesta: ['⚽', '🏆', '🥇', '🎉', '⭐'],
    },
    espacio: {
      nombre: 'Espacio', emoji: '🚀', oscuro: true,
      fondo: '#141a3a', tinta: '#eef0ff', tarjeta: '#232b5c', guia: '#323b73',
      c1: '#7c5cff', c2: '#00bcd4', c3: '#ff7043', c4: '#ffd54f', acento: '#ffd54f',
      deco: ['🚀', '🪐', '⭐', '🌙', '👽'], fiesta: ['🚀', '🪐', '⭐', '🌟', '👽'],
    },
    coches: {
      nombre: 'Coches', emoji: '🏎️',
      fondo: '#eef3f8', tinta: '#1d2b3a', tarjeta: '#ffffff', guia: '#dde5ee',
      c1: '#e53935', c2: '#1e88e5', c3: '#fdd835', c4: '#43a047', acento: '#e53935',
      deco: ['🚗', '🏎️', '🚒', '🚦', '🏁'], fiesta: ['🏁', '🏎️', '🚗', '🏆', '⭐'],
    },
    bloques: {
      nombre: 'Bloques', emoji: '⛏️', clase: 'tema-bloques',
      fondo: '#9fd6ff', tinta: '#1d2a14', tarjeta: '#d0d0d0', guia: '#9a9a9a',
      c1: '#5fae3a', c2: '#2fc6c9', c3: '#e8b923', c4: '#c0392b', acento: '#2fc6c9',
      deco: ['⛏️', '💎', '🌲', '🍄', '☁️'], fiesta: ['💎', '⛏️', '🟩', '🟫', '⭐'],
    },
    dinosaurios: {
      nombre: 'Dinosaurios', emoji: '🦖',
      fondo: '#f2f6e4', tinta: '#2e3a1c', tarjeta: '#ffffff', guia: '#e2e9cc',
      c1: '#7cb342', c2: '#ff8a3d', c3: '#26a69a', c4: '#8d6e63', acento: '#558b2f',
      deco: ['🦖', '🦕', '🌋', '🌿', '🥚'], fiesta: ['🦖', '🦕', '🥚', '🌿', '⭐'],
    },
  };
  root.TEMA_INICIO = {
    fondo: '#fff7e8', tinta: '#3b2f4a', tarjeta: '#ffffff', guia: '#efe6d8',
    c1: '#ff8fb8', c2: '#5cc7a3', c3: '#7fb2ff', c4: '#ffb347', acento: '#ff6fa5',
    deco: ['⭐', '🎈', '🌈', '✏️', '🔤'], fiesta: ['⭐', '🎉', '✨', '🌈', '💖'],
  };
})(window);
