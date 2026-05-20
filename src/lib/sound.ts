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
      master.gain.value = 0.12;
      master.connect(ctx.destination);

      const makeBeep = (frequency: number, delaySec: number, durationSec: number) => {
        const start = ctx.currentTime + delaySec;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = frequency;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.85, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + durationSec);
      };

      makeBeep(880, 0, 0.12);
      makeBeep(1046, 0.16, 0.15);

      setTimeout(() => {
        master.disconnect();
      }, 700);
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
