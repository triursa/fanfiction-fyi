import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface ScrollDirection {
  direction: 'up' | 'down' | 'idle';
  progress: number;
  scrollY: number;
}

export function useScrollDirection(deltaThreshold = 5): ScrollDirection {
  const [state, setState] = useState<ScrollDirection>({
    direction: 'idle',
    progress: 0,
    scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
  });

  const lastScrollY = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  const rafId = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (rafId.current !== null) return; // debounce via rAF

    rafId.current = requestAnimationFrame(() => {
      const winH = window.innerHeight;
      const docH = document.documentElement.scrollHeight;
      const scrolled = window.scrollY;
      const pct = docH <= winH ? 100 : Math.min(100, (scrolled / (docH - winH)) * 100);

      const delta = scrolled - lastScrollY.current;
      let direction: 'up' | 'down' | 'idle' = 'idle';
      if (delta < -deltaThreshold) direction = 'up';
      else if (delta > deltaThreshold) direction = 'down';

      lastScrollY.current = scrolled;

      setState({ direction, progress: pct, scrollY: scrolled });
      rafId.current = null;
    });
  }, [deltaThreshold]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [handleScroll]);

  return state;
}