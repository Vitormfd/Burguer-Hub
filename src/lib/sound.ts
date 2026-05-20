let audioCtx: AudioContext | null = null;
let unlockBound = false;
let lastAlertAt = 0;

const ALERT_DEBOUNCE_MS = 900;

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

    const play = () => {
      const master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);

      const makeBeep = (
        frequency: number,
        delaySec: number,
        durationSec: number,
        type: OscillatorType,
        volume: number
      ) => {
        const start = ctx.currentTime + delaySec;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.value = frequency;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + durationSec);
      };

      // Trinca de alertas curtos e marcantes, com camada harmônica para sobressair em ambiente de cozinha.
      makeBeep(920, 0.0, 0.11, "square", 0.95);
      makeBeep(1840, 0.0, 0.09, "triangle", 0.45);

      makeBeep(920, 0.16, 0.11, "square", 0.95);
      makeBeep(1840, 0.16, 0.09, "triangle", 0.45);

      makeBeep(1120, 0.34, 0.16, "square", 1.0);
      makeBeep(2240, 0.34, 0.13, "triangle", 0.5);

      setTimeout(() => {
        master.disconnect();
      }, 1000);
    };

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
