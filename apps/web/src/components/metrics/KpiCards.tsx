import { useEffect, useRef, useState, type ReactNode } from 'react';
import './kpi-cards.css';

function formatted(value: number, decimals: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function AnimatedMetric({ value, decimals = 0, suffix = '' }: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const current = useRef(value);
  const entered = useRef(false);
  const [display, setDisplay] = useState(value);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      if (!entered.current) { current.current = 0; setDisplay(0); entered.current = true; }
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      if (!entered.current) {
        entered.current = true;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          current.current = 0;
          setDisplay(0);
        }
      }
      setInView(true);
      observer.disconnect();
    }, { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      current.current = value;
      setDisplay(value);
      return;
    }
    if (!inView) return;

    const start = current.current;
    const startedAt = performance.now();
    const duration = 850;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = start + (value - start) * eased;
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else current.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reducedMotion, value]);

  const accessibleValue = `${formatted(value, decimals)}${suffix}`;
  return <span ref={element} className="animated-metric" aria-label={accessibleValue} aria-live="off">{formatted(display, decimals)}{suffix}</span>;
}

function MiniTrend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / span) * 22}`).join(' ');
  return <svg className="workspace-kpi-trend" viewBox="0 0 100 30" role="img" aria-label={`Recent scored evaluation values: ${values.join(', ')}`} focusable="false"><polyline points={points}/></svg>;
}

export function KpiCard({ label, value, detail, icon, decimals = 0, suffix = '', progress, trend }: {
  label: string;
  value?: number;
  detail: string;
  icon: ReactNode;
  decimals?: number;
  suffix?: string;
  progress?: { value: number; max: number; label: string };
  trend?: number[];
}) {
  return <article className="workspace-kpi-card">
    <div className="workspace-kpi-top"><span>{label}</span><span className="workspace-kpi-icon" aria-hidden="true">{icon}</span></div>
    <strong className="workspace-kpi-value">{value === undefined ? '—' : <AnimatedMetric value={value} decimals={decimals} suffix={suffix}/>}</strong>
    <small>{detail}</small>
    {(progress || (trend && trend.length > 1)) && <div className="workspace-kpi-visuals">
      {progress && progress.max > 0 && <div className="workspace-kpi-progress" role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={progress.max} aria-valuenow={Math.min(progress.value, progress.max)}><span style={{ width: `${Math.max(0, Math.min(100, progress.value / progress.max * 100))}%` }}/></div>}
      {trend && <MiniTrend values={trend}/>}
    </div>}
  </article>;
}
