/**
 * Splits and recombines hex colors with an alpha channel
 * (`#RRGGBBAA`, 8 digits) into the two pieces a plain `<input
 * type="color">` (6-digit hex only, no alpha) and a separate opacity
 * control can each actually handle. Several of this app's own theme
 * CSS variables use exactly this 8-digit form (e.g. `--border:
 * #ffffff22`), which a color input alone can't represent or edit.
 */

/**
 * Splits a hex color into `{ rgb, alpha }` -- `rgb` a 6-digit
 * `#RRGGBB` string (safe to hand straight to a color input), `alpha`
 * a 0-255 integer (0 = fully transparent, 255 = fully opaque, safe to
 * drive a 0-100 opacity slider from with simple scaling). A 6-digit
 * input (no alpha channel at all) gets `alpha: 255` -- fully opaque,
 * matching how a color with no explicit alpha is normally understood.
 * Anything that isn't a well-formed 6- or 8-digit hex string falls
 * back to `{ rgb: '#000000', alpha: 255 }` rather than throwing --
 * this is a UI-facing helper, and a person's mid-edit or momentarily
 * invalid input shouldn't crash the color picker.
 */
function splitHexAlpha(hex) {
  const trimmed = String(hex || '').trim();
  const shortMatch = /^#([0-9a-fA-F]{3})([0-9a-fA-F])?$/.exec(trimmed);
  const expanded = shortMatch
    ? '#' +
      [...shortMatch[1]].map((c) => c + c).join('') +
      (shortMatch[2] ? shortMatch[2] + shortMatch[2] : '')
    : trimmed;
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(expanded);
  if (!match) return { rgb: '#000000', alpha: 255 };
  const rgb = '#' + match[1].toLowerCase();
  const alpha = match[2] ? parseInt(match[2], 16) : 255;
  return { rgb, alpha };
}

/**
 * Recombines an `{ rgb, alpha }` pair (same shape splitHexAlpha
 * returns) back into a single hex string -- 6-digit if alpha is 255
 * (fully opaque; no reason to carry a redundant "ff" suffix around,
 * and it keeps a never-touched-the-opacity-slider color visually
 * identical to how it would have been typed by hand), 8-digit
 * otherwise.
 */
function combineHexAlpha(rgb, alpha) {
  const rgbMatch = /^#([0-9a-fA-F]{6})$/.exec(String(rgb || '').trim());
  const rgbPart = rgbMatch ? rgbMatch[1].toLowerCase() : '000000';
  const clampedAlpha = Math.max(0, Math.min(255, Math.round(alpha)));
  if (clampedAlpha === 255) return '#' + rgbPart;
  return '#' + rgbPart + clampedAlpha.toString(16).padStart(2, '0');
}

export { splitHexAlpha, combineHexAlpha };
