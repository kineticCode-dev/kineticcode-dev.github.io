/**
 * Renders a category breakdown as an inline SVG donut chart.
 * segments: [{ label, count, colorVar }]  colorVar e.g. "var(--chart-1)"
 */
export function renderDonut(segments, { total, centerLabel, centerSubLabel } = {}) {
  const size = 220;
  const r = 78;
  const strokeWidth = 26;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const totalCount = total ?? segments.reduce((s, seg) => s + seg.count, 0);

  const circles = segments
    .filter((seg) => seg.count > 0)
    .map((seg) => {
      const fraction = totalCount > 0 ? seg.count / totalCount : 0;
      const dash = fraction * circumference;
      const gap = circumference - dash;
      const rotation = (offset / circumference) * 360 - 90;
      offset += dash;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.colorVar}" stroke-width="${strokeWidth}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" transform="rotate(${rotation.toFixed(2)} ${cx} ${cy})" stroke-linecap="butt"><title>${seg.label}: ${seg.count}</title></circle>`;
    })
    .join("");

  // Wrap the sub-label into up to 2 lines so it fits inside the donut hole
  // regardless of language (German/French labels run noticeably longer).
  const words = (centerSubLabel ?? "").toUpperCase().split(" ");
  let lines = [words.join(" ")];
  if (words.join(" ").length > 13 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  const subLabelTspans = lines
    .map((line, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : 11}">${line}</tspan>`)
    .join("");
  const numberY = lines.length > 1 ? cy - 8 : cy - 2;
  const labelY = lines.length > 1 ? cy + 14 : cy + 20;

  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${centerLabel ?? ""}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border-soft)" stroke-width="${strokeWidth}"></circle>
    ${circles}
    <text x="${cx}" y="${numberY}" text-anchor="middle" font-family="var(--font-display)" font-size="32" fill="var(--text)">${totalCount}</text>
    <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="var(--font-mono)" font-size="9.5" letter-spacing="0.04em" fill="var(--text-faint)">${subLabelTspans}</text>
  </svg>`;
}
