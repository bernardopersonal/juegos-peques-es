// Teatro en inglés: «The Three Little Pigs». El niño hace de lobo y aprende sus 9 frases.
// Cada escena: lo que dice antes otro personaje (el pie, para saber cuándo le toca), la frase del lobo,
// su traducción (para los padres) y qué pasa en la escena (casa y animación).
// Lo usan el juego (js/teatro.js) y el generador de voces (scripts/generar-teatro.mjs): si cambias
// un texto, vuelve a generar los audios de ese texto.
//   casa:  paja | palos | ladrillos | null (sin casa delante)
//   tipo:  entrar (llama y pide entrar) · soplar (huff and puff) · cansado (no puede tirarla) ·
//          triste (pide perdón) · amable (acaba bien)
//   ruido: 'toc' = llaman a la puerta antes del pie
//   trozos (opcional): cómo partir la frase del lobo en 🐢 (índices de palabra [primera, última]); si no, por
//          las comas y los puntos. No cambia ningún audio.
(function (root) {
  const TEATRO = {
    titulo: 'The Three Little Pigs',
    personaje: 'Wolf',
    escenas: [
      {
        id: 'l1', casa: 'paja', tipo: 'entrar',
        pie: { quien: 'pig1', ruido: 'toc', texto: "Who's there?", es: '¿Quién es?' },
        frase: 'Little pig, little pig, let me come in!', es: 'Cerdito, cerdito, ¡déjame entrar!',
      },
      {
        id: 'l2', casa: 'paja', tipo: 'soplar',
        pie: { quien: 'pig1', texto: 'No, no! Not by the hair of my chinny chin chin!', es: '¡No, no! ¡Ni por los pelos de mi barbilla!' },
        frase: "Then I'll huff and I'll puff!", es: '¡Pues soplaré y soplaré!', trozos: [[0, 2], [3, 5]],
      },
      {
        id: 'l3', casa: 'palos', tipo: 'entrar',
        pie: { quien: 'pigs', ruido: 'toc', texto: "Who's there?", es: '¿Quién es?' },
        frase: 'Little pigs, let me come in!', es: 'Cerditos, ¡dejadme entrar!',
      },
      {
        id: 'l4', casa: 'palos', tipo: 'soplar',
        pie: { quien: 'pigs', texto: 'No, no! Not by the hair of our chinny chin chins!', es: '¡No, no! ¡Ni por los pelos de nuestras barbillas!' },
        frase: "Then I'll huff and I'll puff!", es: '¡Pues soplaré y soplaré!', trozos: [[0, 2], [3, 5]],
      },
      {
        id: 'l5', casa: 'ladrillos', tipo: 'entrar',
        pie: { quien: 'pigs', ruido: 'toc', texto: "Who's there?", es: '¿Quién es?' },
        frase: 'Little pigs, let me come in!', es: 'Cerditos, ¡dejadme entrar!',
      },
      {
        id: 'l6', casa: 'ladrillos', tipo: 'soplar',
        pie: { quien: 'pigs', texto: 'No, no! Not by the hair of our chinny chin chins!', es: '¡No, no! ¡Ni por los pelos de nuestras barbillas!' },
        frase: "Then I'll huff and I'll puff!", es: '¡Pues soplaré y soplaré!', trozos: [[0, 2], [3, 5]],
      },
      {
        id: 'l7', casa: 'ladrillos', tipo: 'cansado',
        pie: { quien: 'pigs', texto: 'Ha ha! Our house is made of bricks!', es: '¡Ja, ja! ¡Nuestra casa es de ladrillo!' },
        frase: "Oh! I can't blow it down!", es: '¡Oh! ¡No puedo tirarla!',
      },
      {
        id: 'l8', casa: null, tipo: 'triste',
        pie: { quien: 'pigs', texto: "That wasn't very kind, Mr Wolf!", es: '¡Eso no ha estado nada bien, señor Lobo!' },
        frase: "I'm sorry. I was being unkind.", es: 'Lo siento. No me estaba portando bien.',
      },
      {
        id: 'l9', casa: null, tipo: 'amable',
        pie: { quien: 'pigs', texto: 'Can you be kind?', es: '¿Sabes portarte bien?' },
        frase: 'I can be kind!', es: '¡Sé portarme bien!',
      },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TEATRO;
  else root.TEATRO = TEATRO;
})(typeof window !== 'undefined' ? window : globalThis);
