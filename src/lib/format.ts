const nf = new Intl.NumberFormat('fr-FR');
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const int = (n: number | null | undefined) => (n == null ? '–' : nf.format(Math.round(n)));
export const pos = (n: number | null | undefined) => (n == null ? '–' : nf1.format(n));
export const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? '–' : new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export function day(iso: string | null | undefined, withYear = false) {
  if (!iso) return '–';
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Variation de position : positif = gain de places. */
export function delta(n: number | null | undefined) {
  if (n == null) return { text: '', cls: 'flat' };
  if (Math.abs(n) < 0.5) return { text: '=', cls: 'flat' };
  return { text: (n > 0 ? '▲ ' : '▼ ') + nf1.format(Math.abs(n)), cls: n > 0 ? 'up' : 'down' };
}

/** Variation relative d'un volume (clics, impressions). */
export function change(cur: number | null, prev: number | null, invert = false) {
  if (cur == null || prev == null || prev === 0) return { text: '', cls: 'flat' };
  const r = (cur - prev) / prev;
  if (Math.abs(r) < 0.005) return { text: '=', cls: 'flat' };
  const good = invert ? r < 0 : r > 0;
  return { text: (r > 0 ? '+' : '') + new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 }).format(r), cls: good ? 'up' : 'down' };
}

/** Tracé SVG d'une série ; les valeurs nulles coupent la ligne. */
export function linePath(values: (number | null)[], w: number, h: number, opts: { invert?: boolean; min?: number; max?: number; pad?: number } = {}) {
  const pad = opts.pad ?? 2;
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return '';
  const min = opts.min ?? Math.min(...nums);
  const max = opts.max ?? Math.max(...nums);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    const x = pad + i * step;
    const t = (v - min) / span;
    const y = opts.invert ? pad + t * (h - pad * 2) : h - pad - t * (h - pad * 2);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}
