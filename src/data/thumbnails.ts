/* ============================================================================
 * thumbnails.ts - procedurally generated poster art.
 *
 * Shipping real JPEGs would bloat the repo and break offline previews, so every
 * thumbnail/poster is an inline SVG data-URI built from the video's own title,
 * category and colour pair. It always renders - no network, no 404s - and every
 * card/e-mail/download row therefore has a genuine image to show.
 * ==========================================================================*/

/** Escape characters that would break an SVG or a data-URI. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap long titles onto at most 3 lines of ~24 characters. */
function wrap(title: string, perLine = 24, maxLines = 3): string[] {
  const words = title.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > perLine && line) {
      lines.push(line.trim());
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  return lines.slice(0, maxLines);
}

export interface ThumbOptions {
  title: string;
  subtitle: string;
  from: string;
  to: string;
  icon?: string;
  badge?: string;
  width?: number;
  height?: number;
}

/**
 * Build a data-URI SVG poster:
 *   - diagonal gradient background
 *   - subtle grid + vignette so it reads as art, not as a placeholder
 *   - wrapped title in the lower-left, category eyebrow above it
 *   - optional badge chip in the top-right
 */
export function makeThumbnail(opts: ThumbOptions): string {
  const w = opts.width ?? 640;
  const h = opts.height ?? 360;
  const lines = wrap(opts.title);
  const titleBlock = lines
    .map(
      (line, i) =>
        `<text x="34" y="${h - 62 - (lines.length - 1 - i) * 30}" font-family="Inter,Segoe UI,sans-serif" font-size="26" font-weight="700" fill="#ffffff">${esc(line)}</text>`,
    )
    .join('');

  const badge = opts.badge
    ? `<rect x="${w - 150}" y="22" rx="14" width="128" height="30" fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.5)"/>
       <text x="${w - 86}" y="42" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" font-weight="600" fill="#fff">${esc(opts.badge)}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${opts.from}"/>
      <stop offset="100%" stop-color="${opts.to}"/>
    </linearGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.78)"/>
    </linearGradient>
    <pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect width="${w}" height="${h}" fill="url(#p)"/>
  <circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.34}" fill="rgba(255,255,255,0.10)"/>
  <circle cx="${w * 0.16}" cy="${h * 0.22}" r="${h * 0.22}" fill="rgba(0,0,0,0.14)"/>
  ${opts.icon ? `<text x="34" y="92" font-size="56">${opts.icon}</text>` : ''}
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  <text x="34" y="${h - 96}" font-family="Inter,sans-serif" font-size="14" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.75)">${esc(opts.subtitle.toUpperCase())}</text>
  ${titleBlock}
  <g transform="translate(34,${h - 42})">
    <rect rx="6" width="150" height="26" fill="rgba(255,255,255,0.2)"/>
    <text x="10" y="18" font-family="Inter,sans-serif" font-size="13" font-weight="600" fill="#fff">▶ NexStream</text>
  </g>
  ${badge}
</svg>`;

  // encodeURIComponent keeps the payload valid inside a CSS/img URL.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Square avatar tile used by call participants, security lists and comments. */
export function makeAvatar(name: string, color: string, size = 96): string {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#0f172a"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${size / 2}" fill="url(#a)"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter,sans-serif" font-size="${size * 0.36}" font-weight="700" fill="#fff">${esc(initials)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
