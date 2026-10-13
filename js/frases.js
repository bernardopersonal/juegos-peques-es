// Convierte cada frase en un nombre de archivo de audio y la reproduce.
// Se usa en el navegador (window.Voz) y en Node (scripts/generar-audios.mjs).
(function (root) {
  function slug(texto) {
    let h = 5381;
    for (const ch of texto) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
    const base = texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return (base || 'x') + '-' + h.toString(36);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { slug };
    return;
  }

  // ---------- Navegador ----------
  const disponibles = new Set(root.AUDIOS_DISPONIBLES || []);
  const reproductor = new Audio();
  reproductor.preload = 'auto';
  let terminar = null;

  // iOS solo deja reproducir audio después de un toque: lo "desbloqueamos" en el primero.
  function desbloquear() {
    reproductor.muted = true;
    reproductor.play().catch(() => {}).finally(() => {
      reproductor.pause();
      reproductor.muted = false;
    });
    document.removeEventListener('pointerdown', desbloquear);
  }
  document.addEventListener('pointerdown', desbloquear);

  function vozNavegador(texto) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in root)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-ES';
      u.rate = 0.9;
      const voz = speechSynthesis.getVoices().find((v) => v.lang === 'es-ES');
      if (voz) u.voice = voz;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, 6000);
    });
  }

  function hablar(texto) {
    if (terminar) terminar();
    const bloqueados = root.CONTENIDO && root.CONTENIDO.AUDIO_BLOQUEADO;
    if (bloqueados && bloqueados.includes(texto)) return Promise.resolve();
    if ('speechSynthesis' in root) speechSynthesis.cancel();
    const id = slug(texto);
    if (!disponibles.has(id)) return vozNavegador(texto);
    return new Promise((resolve) => {
      terminar = () => { terminar = null; resolve(); };
      reproductor.onended = reproductor.onerror = () => terminar && terminar();
      reproductor.src = 'audio/' + id + '.mp3';
      reproductor.play().catch(() => terminar && terminar());
    });
  }

  root.Voz = { hablar, slug };
})(typeof window !== 'undefined' ? window : globalThis);
