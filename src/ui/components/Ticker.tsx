import { useEffect, useRef, useState } from 'react';
import { DUR, tween } from '../motion';

/**
 * A number that changes by counting to its new value rather than swapping.
 *
 * It starts on whatever it was first given — nothing counts up from zero on
 * arrival — and from then on every change rolls, fast then gently, over the
 * ceremony duration. Calm motion gets the new number at once.
 */
export function Ticker({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  ms = DUR[5],
  className,
}: {
  value: number;
  format?: (n: number) => string;
  ms?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const at = useRef(value);
  useEffect(() => {
    if (at.current === value) return;
    return tween(at.current, value, ms, (v) => {
      at.current = v;
      setShown(v);
    });
  }, [value, ms]);
  return <span className={className}>{format(shown)}</span>;
}
