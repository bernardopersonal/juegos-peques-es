/* Efectos de sonido 8-bit de los minijuegos, sintetizados con WebAudio (sin ficheros).
 *
 * window.Sfx = {
 *   activar()        crea/desbloquea el audio (llamar en un toque del niño; luego se
 *                    desbloquea solo en cada toque, como pide iOS)
 *   silencio(bool)   quita/pone el sonido (se recuerda en este dispositivo)
 *   silenciado()     → true si está en silencio
 *   disparo() explosion(grande) salto() golpe() flecha() siseo() victoria() derrota()
 *   paso() click()   y extras: orbe() tic() agua()
 *   teatro (js/teatro.js): tocToc() viento(fuerza 0-1) inflar() casaCae() uf() aplausos()
 *   teatro(nombre, arg)  cualquiera de los de arriba para el teatro: suena aunque esté puesto el 🔇 de la
 *                    Batalla (el teatro no tiene botón de sonido y sus voces tampoco le hacen caso)
 * }
 * Nunca lanza excepciones: si el navegador no tiene audio, simplemente no suena.
 */
(function () {
  'use strict';

  const CLAVE = 'jp-batalla-silencio';
  const VOLUMEN = 0.55;
  let ctx = null;
  let master = null;
  let masterTeatro = null; // el del teatro: no le afecta el 🔇
  let paraTeatro = false;  // mientras se programa un sonido de Sfx.teatro()
  let ruido = null;
  let mudo = false;
  let escuchando = false;
  const ultimo = {}; // último instante de cada sonido (para no saturar en cadenas)

  try { mudo = localStorage.getItem(CLAVE) === '1'; } catch (e) { /* sin almacenamiento */ }

  function asegurar() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = mudo ? 0 : VOLUMEN;
        // Compresor: varias explosiones a la vez no saturan
        let salida = ctx.destination;
        if (ctx.createDynamicsCompressor) {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -14;
          comp.ratio.value = 6;
          comp.connect(ctx.destination);
          salida = comp;
        }
        master.connect(salida);
        masterTeatro = ctx.createGain();
        masterTeatro.gain.value = VOLUMEN;
        masterTeatro.connect(salida);
      }
      // Suspendido o, en iOS, «interrupted» (tras una llamada o Siri): se reanuda
      if (ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return ctx;
    } catch (e) {
      return null;
    }
  }

  // iOS solo deja sonar después de un toque: en cada toque se intenta reanudar
  function desbloquear() {
    const c = asegurar();
    if (!c) return;
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* nada */ }
  }

  function activar() {
    desbloquear();
    if (escuchando) return;
    escuchando = true;
    try {
      ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach((ev) =>
        window.addEventListener(ev, desbloquear, { passive: true, capture: true }));
    } catch (e) { /* nada */ }
  }

  // Devuelve el contexto solo si se puede sonar ya (si no, el sonido se pierde:
  // mejor eso que una ráfaga de sonidos acumulados al desbloquear).
  function listo(nombre, separacion) {
    if ((mudo && !paraTeatro) || !ctx || !master || ctx.state !== 'running') return null;
    if (nombre) {
      const ahora = ctx.currentTime;
      if (ultimo[nombre] != null && ahora - ultimo[nombre] < (separacion || 0.03)) return null;
      ultimo[nombre] = ahora;
    }
    return ctx;
  }

  function tono(c, o) {
    const t0 = c.currentTime + (o.retraso || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.onda || 'square';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const vol = o.vol || 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.ataque || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(paraTeatro && masterTeatro ? masterTeatro : master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  function soplo(c, o) {
    if (!ruido) {
      ruido = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      const d = ruido.getChannelData(0);
      // ruido "8-bit": cada valor se repite unas muestras (suena más granulado)
      let v = 0;
      for (let i = 0; i < d.length; i++) { if (i % 3 === 0) v = Math.random() * 2 - 1; d[i] = v; }
    }
    const t0 = c.currentTime + (o.retraso || 0);
    const s = c.createBufferSource();
    s.buffer = ruido;
    const f = c.createBiquadFilter();
    f.type = o.filtro || 'lowpass';
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t0 + o.dur);
    f.Q.value = o.q || 0.7;
    const g = c.createGain();
    const vol = o.vol || 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.ataque || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    s.connect(f);
    f.connect(g);
    g.connect(paraTeatro && masterTeatro ? masterTeatro : master);
    s.start(t0, Math.random() * 0.4);
    s.stop(t0 + o.dur + 0.05);
  }

  function notas(c, lista, o) {
    let r = o.retraso || 0;
    lista.forEach((f, i) => {
      const dur = (o.duraciones && o.duraciones[i]) || o.dur;
      tono(c, { onda: o.onda || 'square', f0: f, dur: dur * 0.95, vol: o.vol || 0.12, retraso: r });
      r += dur;
    });
  }

  // Envuelve cada sonido: nunca lanza
  function seguro(nombre, separacion, fn) {
    return function (arg) {
      try {
        const c = listo(nombre, separacion);
        if (c) fn(c, arg);
      } catch (e) { /* sin sonido */ }
    };
  }

  const Sfx = {
    activar() { try { activar(); } catch (e) { /* nada */ } },
    silencio(b) {
      try {
        mudo = !!b;
        try { localStorage.setItem(CLAVE, mudo ? '1' : '0'); } catch (e) { /* nada */ }
        if (ctx && master) master.gain.setTargetAtTime(mudo ? 0 : VOLUMEN, ctx.currentTime, 0.02);
      } catch (e) { /* nada */ }
    },
    silenciado() { return mudo; },
    // Un sonido para el teatro, con o sin el 🔇 (cada sonido se programa de golpe: basta con la marca)
    teatro(nombre, arg) {
      if (['teatro', 'activar', 'silencio', 'silenciado'].includes(nombre) || typeof Sfx[nombre] !== 'function') return;
      paraTeatro = true;
      try { Sfx[nombre](arg); } catch (e) { /* sin sonido */ } finally { paraTeatro = false; }
    },

    disparo: seguro('disparo', 0.05, (c) => {
      soplo(c, { f0: 2400, f1: 300, dur: 0.28, vol: 0.32 });
      tono(c, { onda: 'square', f0: 190, f1: 55, dur: 0.22, vol: 0.16 });
    }),
    explosion: seguro('explosion', 0.06, (c, grande) => {
      const d = grande ? 1.05 : 0.75;
      soplo(c, { f0: 1600, f1: 70, dur: d, vol: grande ? 0.85 : 0.7, ataque: 0.004 });
      tono(c, { onda: 'sine', f0: 120, f1: 32, dur: d * 0.8, vol: 0.55 });
      tono(c, { onda: 'square', f0: 70, f1: 28, dur: 0.3, vol: 0.12 });
    }),
    salto: seguro('salto', 0.05, (c) => {
      tono(c, { onda: 'square', f0: 250, f1: 640, dur: 0.15, vol: 0.12 });
    }),
    golpe: seguro('golpe', 0.05, (c) => {
      soplo(c, { filtro: 'bandpass', f0: 900, f1: 400, dur: 0.1, vol: 0.45, q: 1.2 });
      tono(c, { onda: 'square', f0: 170, f1: 80, dur: 0.12, vol: 0.16 });
    }),
    flecha: seguro('flecha', 0.05, (c) => {
      soplo(c, { filtro: 'highpass', f0: 1800, f1: 4000, dur: 0.18, vol: 0.22 });
      tono(c, { onda: 'triangle', f0: 950, f1: 420, dur: 0.14, vol: 0.08 });
    }),
    siseo: seguro('siseo', 0.2, (c) => {
      soplo(c, { filtro: 'highpass', f0: 3200, f1: 5200, dur: 1.0, vol: 0.32, ataque: 0.75 });
    }),
    victoria: seguro('victoria', 0.5, (c) => {
      notas(c, [523, 659, 784, 1047, 784, 1047], { dur: 0.11, duraciones: [0.11, 0.11, 0.11, 0.2, 0.11, 0.45], vol: 0.12 });
      notas(c, [262, 330, 392, 523], { onda: 'triangle', dur: 0.27, vol: 0.12 });
    }),
    derrota: seguro('derrota', 0.5, (c) => {
      notas(c, [392, 330, 262, 196], { dur: 0.22, duraciones: [0.22, 0.22, 0.22, 0.55], vol: 0.12 });
      notas(c, [196, 165, 131, 98], { onda: 'triangle', dur: 0.22, duraciones: [0.22, 0.22, 0.22, 0.55], vol: 0.14 });
    }),
    paso: seguro('paso', 0.06, (c) => {
      soplo(c, { f0: 650, f1: 200, dur: 0.06, vol: 0.18 });
    }),
    click: seguro('click', 0.03, (c) => {
      tono(c, { onda: 'square', f0: 880, dur: 0.045, vol: 0.08 });
    }),
    orbe: seguro('orbe', 0.06, (c) => {
      const f = 1100 + Math.random() * 500;
      tono(c, { onda: 'square', f0: f, f1: f * 1.6, dur: 0.07, vol: 0.06 });
    }),
    tic: seguro('tic', 0.15, (c) => {
      tono(c, { onda: 'square', f0: 1250, dur: 0.035, vol: 0.06 });
    }),
    agua: seguro('agua', 0.1, (c) => {
      soplo(c, { filtro: 'bandpass', f0: 700, f1: 180, dur: 0.4, vol: 0.4 });
      [0, 0.07, 0.14].forEach((r) => tono(c, { onda: 'sine', f0: 280 + r * 900, f1: 750, dur: 0.07, vol: 0.06, retraso: r }));
    }),

    // ---- Teatro (The Three Little Pigs) ----
    // Toc, toc: dos golpes de madera en la puerta (a la vez que los del dibujo, cada 0,38 s)
    tocToc: seguro('tocToc', 0.5, (c) => {
      [0, 0.38].forEach((r) => {
        soplo(c, { filtro: 'bandpass', f0: 1300, f1: 600, dur: 0.06, vol: 0.55, q: 2.6, retraso: r });
        tono(c, { onda: 'triangle', f0: 230, f1: 120, dur: 0.1, vol: 0.34, retraso: r });
      });
    }),
    // Una ráfaga de viento (al soplar se repite; más fuerte cuanto más sopla)
    viento: seguro('viento', 0.22, (c, fuerza) => {
      const f = Math.max(0.2, Math.min(1, fuerza == null ? 1 : +fuerza || 0));
      soplo(c, { filtro: 'bandpass', f0: 450 + 900 * f, f1: 280, dur: 0.5, vol: 0.12 + 0.24 * f, q: 0.9, ataque: 0.09 });
    }),
    // Huff: el lobo coge aire e infla los mofletes
    inflar: seguro('inflar', 0.4, (c) => {
      soplo(c, { filtro: 'bandpass', f0: 380, f1: 1500, dur: 0.55, vol: 0.2, q: 1.3, ataque: 0.35 });
      tono(c, { onda: 'square', f0: 160, f1: 420, dur: 0.5, vol: 0.05 });
    }),
    // La casa de paja o de palos se viene abajo: el golpe, unas notas que bajan y los palitos que caen
    casaCae: seguro('casaCae', 0.5, (c) => {
      soplo(c, { f0: 1500, f1: 90, dur: 0.9, vol: 0.55, ataque: 0.01 });
      notas(c, [523, 392, 311, 233, 175], { onda: 'square', dur: 0.09, vol: 0.08 });
      for (let i = 0; i < 7; i++) {
        soplo(c, { filtro: 'bandpass', f0: 1800 + Math.random() * 1500, dur: 0.05, vol: 0.24, q: 3, retraso: 0.1 + i * 0.09 + Math.random() * 0.04 });
      }
    }),
    // ¡Uf!: el lobo, agotado, suelta el aire
    uf: seguro('uf', 0.5, (c) => {
      soplo(c, { filtro: 'lowpass', f0: 900, f1: 240, dur: 0.75, vol: 0.3, ataque: 0.05 });
      tono(c, { onda: 'triangle', f0: 330, f1: 130, dur: 0.65, vol: 0.12 });
    }),
    // Aplausos al acabar la función: muchas palmadas que se van apagando
    aplausos: seguro('aplausos', 2, (c) => {
      for (let i = 0; i < 70; i++) {
        const r = Math.pow(Math.random(), 1.6) * 2.6;
        soplo(c, { filtro: 'bandpass', f0: 1300 + Math.random() * 2400, dur: 0.03 + Math.random() * 0.02, vol: (0.1 + Math.random() * 0.2) * (1 - r / 3), q: 1.3, retraso: r });
      }
    }),
  };

  window.Sfx = Sfx;
})();
