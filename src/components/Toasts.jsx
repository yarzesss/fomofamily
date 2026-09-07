import React, { useEffect, useRef, useState } from 'react';
import { useLocalState } from '../lib/hooks.js';

// Global toast bus: toast(text, kind). kind 'up' also fires confetti + edge flash + (optional) sound.
export function toast(text, kind = '') {
  window.dispatchEvent(new CustomEvent('toast', { detail: { text, kind } }));
}

let audioCtx = null;
function blip(up) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const notes = up ? [523, 659, 784, 1047] : [440, 392];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.09);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.3);
    });
  } catch {}
}

function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  const colors = ['#516af6', '#fd5dd3', '#21c95e', '#ffbf17', '#eaedff'];
  const ps = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.3, y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr, vy: (-14 - Math.random() * 10) * dpr,
    w: (4 + Math.random() * 6) * dpr, h: (6 + Math.random() * 8) * dpr,
    c: colors[(Math.random() * colors.length) | 0], a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, life: 1,
  }));
  let raf;
  const step = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of ps) {
      p.vy += 0.45 * dpr; p.x += p.vx; p.y += p.vy; p.a += p.va; p.life -= 0.008;
      if (p.life <= 0) continue; alive = true;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(step); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  cancelAnimationFrame(raf); step();
}

export default function Toasts() {
  const [items, setItems] = useState([]);
  const canvasRef = useRef(null);
  const [sound] = useLocalState('fomo.sound', false);
  const soundRef = useRef(sound);
  useEffect(() => { soundRef.current = sound; }, [sound]);

  useEffect(() => {
    const on = e => {
      const id = Math.random().toString(36).slice(2);
      setItems(prev => [...prev.slice(-3), { id, ...e.detail }]);
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 6500);
      if (e.detail.kind === 'up' || e.detail.kind === 'down') {
        document.body.classList.remove('flash-up', 'flash-down');
        void document.body.offsetWidth;
        document.body.classList.add(`flash-${e.detail.kind}`);
        setTimeout(() => document.body.classList.remove(`flash-${e.detail.kind}`), 1600);
        if (e.detail.kind === 'up' && canvasRef.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) confetti(canvasRef.current);
        if (soundRef.current) blip(e.detail.kind === 'up');
      }
    };
    window.addEventListener('toast', on);
    return () => window.removeEventListener('toast', on);
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="confetti" />
      <div className="edge-flash" />
      <div className="toasts">
        {items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </>
  );
}
