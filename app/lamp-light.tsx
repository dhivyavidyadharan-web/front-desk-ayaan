'use client';
import { useEffect } from 'react';

const RADIUS = 150; // px: how far away a button starts to glow

/**
 * The lamp effect: every button's bulb warms up as the cursor approaches (--lit, 0..1),
 * and a soft warm light follows the cursor across the page (--cx/--cy).
 */
export function LampLight() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    let x = -1000;
    let y = -1000;
    let frame = 0;

    const update = () => {
      frame = 0;
      root.style.setProperty('--cx', `${x}px`);
      root.style.setProperty('--cy', `${y}px`);
      document.querySelectorAll<HTMLElement>('button, .btn').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -RADIUS || r.top > window.innerHeight + RADIUS) return;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        el.style.setProperty('--lit', d >= RADIUS ? '0' : (1 - d / RADIUS).toFixed(2));
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      schedule();
    };
    const onLeave = () => {
      x = -1000;
      y = -1000;
      schedule();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', schedule);
      document.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
