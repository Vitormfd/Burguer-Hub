let audioCtx: AudioContext | null = null;
let unlockBound = false;
let lastAlertAt = 0;

const ALERT_DEBOUNCE_MS = 900;

const playRestaurantBell = (ctx: AudioContext) => {
  const start = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.42;
  master.connect(ctx.destination);

  const strike = (delaySec: number, intensity = 1) => {
    const t0 = start + delaySec;

    // Parciais inarmônicos para soar como sino metálico.
    const partials = [
      { mult: 1.0, gain: 1.0, type: "sine" as OscillatorType },
      { mult: 2.31, gain: 0.55, type: "triangle" as OscillatorType },
      { mult: 3.92, gain: 0.35, type: "sine" as OscillatorType },
      { mult: 5.44, gain: 0.22, type: "sine" as OscillatorType },
    ];

    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = p.type;
      osc.frequency.setValueAtTime(1220 * p.mult, t0);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.95 * p.gain * intensity, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);

      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 1.85);
    });

    // Ataque percussivo para o "clique" inicial do sino.
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = "square";
    clickOsc.frequency.setValueAtTime(2300, t0);
    clickGain.gain.setValueAtTime(0.0001, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.5 * intensity, t0 + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    clickOsc.connect(clickGain);
    clickGain.connect(master);
    clickOsc.start(t0);
    clickOsc.stop(t0 + 0.06);
  };

  // Duplo toque típico de sino de balcão, com segundo toque um pouco mais suave.
  strike(0, 1);
  strike(0.22, 0.78);

  setTimeout(() => {
    master.disconnect();
  }, 2600);
};

const getAudioContextClass = (): typeof AudioContext | null => {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
};

const ensureAudioContext = (): AudioContext | null => {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
};

const unlockAudio = () => {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
};

export const bindAudioUnlock = () => {
  if (typeof window === "undefined" || unlockBound) return;

  const once = () => {
    unlockAudio();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
    window.removeEventListener("touchstart", once);
    unlockBound = true;
  };

  window.addEventListener("pointerdown", once, { once: true });
  window.addEventListener("keydown", once, { once: true });
  window.addEventListener("touchstart", once, { once: true });
};

export const playNewOrderAlert = () => {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const now = Date.now();
    if (now - lastAlertAt < ALERT_DEBOUNCE_MS) return;
    lastAlertAt = now;

    const play = () => playRestaurantBell(ctx);

    if (ctx.state === "suspended") {
      void ctx
        .resume()
        .then(() => {
          play();
        })
        .catch(() => {
          // Ignore: browsers may block autoplay until user interaction.
        });
      return;
    }

    play();
  } catch {
    // Ignore: browsers may block autoplay until user interaction.
  }
};
