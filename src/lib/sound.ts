let audioCtx: AudioContext | null = null;
let primedCtx: AudioContext | null = null;
let unlockListenersBound = false;
let audioReady = false;
let audioInitStarted = false;
let keepAliveTimer: number | null = null;
let pendingAlerts = 0;
let lastAlertAt = 0;
let lastDesktopNotificationAt = 0;

const AUDIO_UNLOCK_KEY = "bh_audio_unlocked";
const ALERT_DEBOUNCE_MS = 900;
const DESKTOP_NOTIFICATION_DEBOUNCE_MS = 1200;
const KEEPALIVE_MS = 20000;

const playRestaurantBell = (ctx: AudioContext, intensity = 1.0) => {
  const start = ctx.currentTime;

  const master = ctx.createGain();
  // master overall gain; intensity multiplies to get much louder when requested
  master.gain.value = Math.min(1.2, 0.6 * intensity);
  master.connect(ctx.destination);

  const strike = (delaySec: number, strikeIntensity = 1) => {
    const t0 = start + delaySec;

    // Parciais inarmônicos para soar como sino metálico.
    const partials = [
      { mult: 1.0, gain: 1.25, type: "sine" as OscillatorType },
      { mult: 2.31, gain: 0.8, type: "triangle" as OscillatorType },
      { mult: 3.92, gain: 0.55, type: "sine" as OscillatorType },
      { mult: 5.44, gain: 0.38, type: "sine" as OscillatorType },
    ];

    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = p.type;
      osc.frequency.setValueAtTime(600 * p.mult, t0);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.6, p.gain * strikeIntensity * intensity), t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);

      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + 2.25);
    });

    // Ataque percussivo para o "clique" inicial do sino.
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = "square";
    clickOsc.frequency.setValueAtTime(2600, t0);
    clickGain.gain.setValueAtTime(0.0001, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.9 * strikeIntensity * intensity, t0 + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    clickOsc.connect(clickGain);
    clickGain.connect(master);
    clickOsc.start(t0);
    clickOsc.stop(t0 + 0.1);
  };

  // Duplo toque típico de sino de balcão, com segundo toque um pouco mais suave.
  strike(0, 1);
  strike(0.22, 0.85);

  setTimeout(() => {
    try { master.disconnect(); } catch {}
  }, 3000);
};

const playShortBeep = (ctx: AudioContext, intensity = 1.0) => {
  const start = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(1.2, 0.35 * intensity);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(1 * intensity, start + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(start + 0.15);

  setTimeout(() => { try { master.disconnect(); } catch {} }, 500);
};

const playChime = (ctx: AudioContext, intensity = 1.0) => {
  const start = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(1.2, 0.45 * intensity);
  master.connect(ctx.destination);

  const freqs = [660, 880, 1320];
  freqs.forEach((f, i) => {
    const t0 = start + i * 0.08;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = i % 2 === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9 * intensity, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6 + i * 0.1);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.8 + i * 0.1);
  });

  setTimeout(() => { try { master.disconnect(); } catch {} }, 1500);
};

// Additional presets implementations (gong, tritone, alarm, dingdong, metallic)
const playGong = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(1.5, 0.7 * intensity);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(1 * intensity, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 4.0);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(start + 4.0);
  setTimeout(() => { try { master.disconnect(); } catch {} }, 4200);
};

const playTriTone = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(1.2, 0.55 * intensity);
  master.connect(ctx.destination);
  const freqs = [440, 660, 880];
  freqs.forEach((f, i) => {
    const t0 = start + i * 0.12;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = i % 2 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.95 * intensity, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5 + i * 0.05);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + 0.6 + i * 0.05);
  });
  setTimeout(() => { try { master.disconnect(); } catch {} }, 1000);
};

const playAlarm = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime;
  const master = ctx.createGain(); master.gain.value = Math.min(1.5, 0.7 * intensity); master.connect(ctx.destination);
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.type = "sawtooth"; osc.frequency.setValueAtTime(520, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(1 * intensity, start + 0.01);
  const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(8, start); lfo.type = "sine"; lfoGain.gain.setValueAtTime(0.5, start);
  lfo.connect(lfoGain); lfoGain.connect(g.gain);
  osc.connect(g); g.connect(master); osc.start(start); lfo.start(start);
  setTimeout(() => { try { osc.stop(); lfo.stop(); master.disconnect(); } catch {} }, 800);
};

const playDingDong = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.6 * intensity); master.connect(ctx.destination);
  const make = (freq: number, delay: number) => {
    const t0 = start + delay; const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sine"; osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.95 * intensity, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + 0.95);
  };
  make(880, 0); make(660, 0.22);
  setTimeout(() => { try { master.disconnect(); } catch {} }, 1200);
};

const playMetallicPing = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.65 * intensity); master.connect(ctx.destination);
  for (let i = 0; i < 3; i++) {
    const t0 = start + i * 0.06; const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "square"; osc.frequency.setValueAtTime(1200 + i * 140, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.95 * intensity, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2 + i * 0.03);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + 0.25 + i * 0.03);
  }
  setTimeout(() => { try { master.disconnect(); } catch {} }, 800);
};

// New presets: marimba, glass, cash, cowbell, retro, siren
const playMarimba = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.5 * intensity); master.connect(ctx.destination);
  const pattern = [880, 740, 660, 740];
  pattern.forEach((f, i) => {
    const t0 = start + i * 0.12; const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "square"; osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.95 * intensity, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    const env = ctx.createBiquadFilter(); env.type = "lowpass"; env.frequency.setValueAtTime(1200, t0);
    osc.connect(g); g.connect(env); env.connect(master); osc.start(t0); osc.stop(t0 + 0.26);
  });
  setTimeout(() => { try { master.disconnect(); } catch {} }, 800);
};

const playGlassChime = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.45 * intensity); master.connect(ctx.destination);
  const freqs = [1760, 2093, 2637];
  freqs.forEach((f, i) => {
    const t0 = start + i * 0.06; const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sine"; osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.9 * intensity, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2 + i * 0.2);
    const hf = ctx.createBiquadFilter(); hf.type = "highpass"; hf.frequency.setValueAtTime(800, t0);
    osc.connect(g); g.connect(hf); hf.connect(master); osc.start(t0); osc.stop(t0 + 1.2 + i * 0.2);
  });
  setTimeout(() => { try { master.disconnect(); } catch {} }, 1600);
};

const playCashRegister = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.4, 0.8 * intensity); master.connect(ctx.destination);
  // quick metallic tick + short arpeggio
  const tick = ctx.createOscillator(); const tg = ctx.createGain(); tick.type = "square"; tick.frequency.setValueAtTime(2500, start);
  tg.gain.setValueAtTime(0.0001, start); tg.gain.exponentialRampToValueAtTime(1 * intensity, start + 0.002); tg.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
  tick.connect(tg); tg.connect(master); tick.start(start); tick.stop(start + 0.07);
  // arpeggio
  [1320, 1760, 2093].forEach((f, i) => {
    const t0 = start + 0.08 + i * 0.06; const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sine"; osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.85 * intensity, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + 0.22);
  });
  setTimeout(() => { try { master.disconnect(); } catch {} }, 800);
};

const playCowbell = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.6 * intensity); master.connect(ctx.destination);
  const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "square"; osc.frequency.setValueAtTime(900, start);
  g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(1 * intensity, start + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.setValueAtTime(800, start);
  osc.connect(g); g.connect(hp); hp.connect(master); osc.start(start); osc.stop(start + 0.16);
  setTimeout(() => { try { master.disconnect(); } catch {} }, 400);
};

const playRetroPulse = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.2, 0.6 * intensity); master.connect(ctx.destination);
  const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sawtooth"; osc.frequency.setValueAtTime(440, start);
  const lfo = ctx.createOscillator(); const lfoG = ctx.createGain(); lfo.type = "sine"; lfo.frequency.setValueAtTime(6, start); lfoG.gain.setValueAtTime(0.8 * intensity, start);
  lfo.connect(lfoG); lfoG.connect(g.gain);
  g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(0.9 * intensity, start + 0.02);
  osc.connect(g); g.connect(master); osc.start(start); lfo.start(start);
  setTimeout(() => { try { osc.stop(); lfo.stop(); master.disconnect(); } catch {} }, 900);
};

const playSiren = (ctx: AudioContext, intensity = 1) => {
  const start = ctx.currentTime; const master = ctx.createGain(); master.gain.value = Math.min(1.6, 0.9 * intensity); master.connect(ctx.destination);
  const osc = ctx.createOscillator(); const g = ctx.createGain(); osc.type = "sine"; osc.frequency.setValueAtTime(600, start);
  const lfo = ctx.createOscillator(); const lfoG = ctx.createGain(); lfo.type = "sine"; lfo.frequency.setValueAtTime(3.5, start);
  lfoG.gain.setValueAtTime(220 * intensity, start); lfo.connect(lfoG); lfoG.connect(osc.frequency);
  g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(0.95 * intensity, start + 0.01);
  osc.connect(g); g.connect(master); osc.start(start); lfo.start(start);
  setTimeout(() => { try { osc.stop(); lfo.stop(); master.disconnect(); } catch {} }, 1200);
};

type SoundPreset = "bell" | "beep" | "chime" | "gong" | "tritone" | "alarm" | "dingdong" | "metallic" | "marimba" | "glass" | "cash" | "cowbell" | "retro" | "siren";

const readSavedSoundSettings = (): { preset: SoundPreset; volume: number } => {
  try {
    if (typeof window === "undefined") return { preset: "bell", volume: 1 };
    const rawPreset = localStorage.getItem("bh_sound_preset") || "bell";
    const allowed = ["bell", "beep", "chime", "gong", "tritone", "alarm", "dingdong", "metallic", "marimba", "glass", "cash", "cowbell", "retro", "siren"];
    const preset = (allowed.includes(rawPreset) ? rawPreset : "bell") as SoundPreset;
    const rawVol = Number(localStorage.getItem("bh_sound_volume") ?? "1");
    const volume = Number.isFinite(rawVol) ? Math.max(0.05, Math.min(3, rawVol)) : 1;
    return { preset, volume };
  } catch {
    return { preset: "bell", volume: 1 };
  }
};

export const playPreset = (preset?: SoundPreset, volume?: number) => {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const { preset: savedPreset, volume: savedVol } = readSavedSoundSettings();
    const usePreset = preset || savedPreset;
    const useVol = typeof volume === "number" ? volume : savedVol;

    const doPlay = () => {
      if (usePreset === "bell") playRestaurantBell(ctx, useVol);
      else if (usePreset === "beep") playShortBeep(ctx, useVol);
      else if (usePreset === "chime") playChime(ctx, useVol);
      else if (usePreset === "gong") playGong(ctx, useVol);
      else if (usePreset === "tritone") playTriTone(ctx, useVol);
      else if (usePreset === "alarm") playAlarm(ctx, useVol);
      else if (usePreset === "dingdong") playDingDong(ctx, useVol);
      else if (usePreset === "metallic") playMetallicPing(ctx, useVol);
      else if (usePreset === "marimba") playMarimba(ctx, useVol);
      else if (usePreset === "glass") playGlassChime(ctx, useVol);
      else if (usePreset === "cash") playCashRegister(ctx, useVol);
      else if (usePreset === "cowbell") playCowbell(ctx, useVol);
      else if (usePreset === "retro") playRetroPulse(ctx, useVol);
      else if (usePreset === "siren") playSiren(ctx, useVol);
    };

    if (ctx.state === "suspended") {
      void ctx.resume().then(doPlay).catch(() => {});
      return;
    }
    doPlay();
  } catch {}
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

const primeAudio = async (ctx: AudioContext) => {
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
  source.stop(ctx.currentTime + 0.01);
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 20);
  });
};

const markAudioUnlocked = () => {
  audioReady = true;
  try {
    sessionStorage.setItem(AUDIO_UNLOCK_KEY, "1");
  } catch {
    // ignore
  }
};

const flushPendingAlerts = () => {
  if (pendingAlerts <= 0) return;
  const count = pendingAlerts;
  pendingAlerts = 0;
  for (let i = 0; i < count; i += 1) {
    void playNewOrderAlert(true);
  }
};

const startAudioKeepAlive = () => {
  if (typeof window === "undefined" || keepAliveTimer !== null) return;
  keepAliveTimer = window.setInterval(() => {
    void tryUnlockAudio({ silent: true });
  }, KEEPALIVE_MS);
};

export const tryUnlockAudio = async (opts?: { silent?: boolean }): Promise<boolean> => {
  const ctx = ensureAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (ctx.state !== "running") return false;

    if (primedCtx !== ctx) {
      await primeAudio(ctx);
      primedCtx = ctx;
      markAudioUnlocked();
    }

    if (!opts?.silent) {
      flushPendingAlerts();
    }
    return true;
  } catch {
    return false;
  }
};

export const isAudioReady = () => audioReady;

export const bindAudioUnlock = () => {
  if (typeof window === "undefined" || unlockListenersBound) return;
  unlockListenersBound = true;

  const onGesture = () => {
    void tryUnlockAudio();
    void requestDesktopNotificationPermission();
  };

  window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  window.addEventListener("touchstart", onGesture, { capture: true, passive: true });
};

export const requestDesktopNotificationPermission = async () => {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // ignore
  }
};

/** Chamar ao entrar no painel: desbloqueio, keep-alive e alertas em segundo plano. */
export const initOrderAlertAudio = () => {
  if (typeof window === "undefined" || audioInitStarted) return;
  audioInitStarted = true;

  bindAudioUnlock();
  startAudioKeepAlive();

  const resumeIfPossible = () => {
    void tryUnlockAudio({ silent: true });
  };

  window.addEventListener("focus", resumeIfPossible);
  document.addEventListener("visibilitychange", () => {
    resumeIfPossible();
    if (!document.hidden && pendingAlerts > 0) {
      flushPendingAlerts();
    }
  });

  try {
    if (sessionStorage.getItem(AUDIO_UNLOCK_KEY) === "1") {
      void tryUnlockAudio({ silent: true });
    }
  } catch {
    // ignore
  }

  void requestDesktopNotificationPermission();
};

export const playNewOrderAlert = async (skipDebounce = false) => {
  try {
    const now = Date.now();
    if (!skipDebounce && now - lastAlertAt < ALERT_DEBOUNCE_MS) return;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await tryUnlockAudio({ silent: attempt > 0 });
      const ctx = ensureAudioContext();
      if (ctx?.state === "running") {
        if (!skipDebounce) lastAlertAt = now;
        playPreset();
        return;
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 40);
      });
    }

    pendingAlerts = Math.min(pendingAlerts + 1, 5);
  } catch {
    pendingAlerts = Math.min(pendingAlerts + 1, 5);
  }
};

export const notifyNewDeliveryOrder = (message = "Novo pedido de delivery") => {
  void playNewOrderAlert();
  showNewOrderDesktopNotification(message);
};

export const showNewOrderDesktopNotification = (message = "Novo pedido chegou") => {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  const show = () => {
    const now = Date.now();
    if (now - lastDesktopNotificationAt < DESKTOP_NOTIFICATION_DEBOUNCE_MS) return;
    lastDesktopNotificationAt = now;

    try {
      new Notification("Burguer Hub", {
        body: message,
        tag: "burguer-hub-new-order",
        renotify: true,
        silent: false,
        icon: "/favicon.ico",
      });
    } catch {
      // Ignore notification errors from restrictive browser environments.
    }
  };

  if (Notification.permission === "granted") {
    show();
    return;
  }

  if (Notification.permission === "default") {
    void Notification.requestPermission().then((perm) => {
      if (perm === "granted") show();
    });
  }
};
