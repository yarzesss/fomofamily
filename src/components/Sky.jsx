import React, { useEffect, useRef } from 'react';

// Space backdrop: twinkling stars, shooting stars, a planet horizon, and a
// hyperspace "warp" burst when the intro hands over to the app.
export default function Sky() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w, h, stars = [], shots = [], raf, t = 0, warp = 0, dpr = Math.min(2, devicePixelRatio || 1);
    const resize = () => {
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      const n = Math.floor((w * h) / (8000 * dpr));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: (Math.random() * 1.3 + 0.3) * dpr,
        p: Math.random() * Math.PI * 2, s: 0.4 + Math.random() * 1.2,
        v: (0.02 + Math.random() * 0.06) * dpr, z: 0.3 + Math.random() * 0.7,
        c: Math.random() < 0.1 ? '#9fb0ff' : Math.random() < 0.05 ? '#ffd7f4' : '#ffffff',
      }));
    };
    const spawnShot = () => shots.push({ x: Math.random() * w, y: Math.random() * h * 0.5, vx: (6 + Math.random() * 6) * dpr, vy: (2 + Math.random() * 3) * dpr, life: 1 });
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      for (const s of stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
        ctx.globalAlpha = a * 0.85;
        if (warp > 0.01) {
          // stretch stars away from the centre
          const dx = s.x - cx, dy = s.y - cy;
          const len = warp * 60 * s.z * dpr;
          const d = Math.hypot(dx, dy) || 1;
          ctx.strokeStyle = s.c; ctx.lineWidth = s.r;
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + (dx / d) * len, s.y + (dy / d) * len); ctx.stroke();
          s.x += (dx / d) * warp * 8 * s.z * dpr; s.y += (dy / d) * warp * 8 * s.z * dpr;
          if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) { s.x = cx + (Math.random() - 0.5) * w * 0.4; s.y = cy + (Math.random() - 0.5) * h * 0.4; }
        } else {
          ctx.fillStyle = s.c;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
          if (!reduce) { s.y -= s.v; if (s.y < -2) { s.y = h + 2; s.x = Math.random() * w; } }
        }
      }
      if (warp > 0) warp *= 0.94;
      if (!reduce && Math.random() < 0.004 && shots.length < 2) spawnShot();
      for (const sh of shots) {
        ctx.globalAlpha = sh.life;
        const g = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 12, sh.y - sh.vy * 12);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - sh.vx * 12, sh.y - sh.vy * 12); ctx.stroke();
        sh.x += sh.vx; sh.y += sh.vy; sh.life -= 0.02;
      }
      shots = shots.filter(s => s.life > 0);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    const onWarp = () => { if (!reduce) warp = 1; };
    resize(); draw();
    window.addEventListener('resize', resize);
    window.addEventListener('warp', onWarp);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('warp', onWarp); };
  }, []);
  return (
    <div className="sky">
      <canvas ref={ref} />
      <div className="planet" />
      <div className="noise" />
    </div>
  );
}
