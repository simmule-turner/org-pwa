// @ts-check
// Where each setting lives in the Settings screen: seven categories, each a page of cards, and the person's own order for both.
// Pure data and functions, so the order can be changed (and tested) without touching the screen code.

/** @typedef {{ id: string, title: string, blurb: string, cards: string[] }} SettingsCategory */
/** @typedef {{ categories?: string[], cards?: Record<string, string[]> }} SettingsOrder */

/** The default layout. A card id is either a section of the Settings screen or `quick:<group>` for a group of Quick Settings fields. */
export const DEFAULT_SETTINGS_CATEGORIES = /** @type {SettingsCategory[]} */ ([
  { id: 'appearance', title: 'Appearance', blurb: 'Theme, font, spacing, reading width, menu size', cards: ['appearance-theme', 'appearance-font', 'appearance-size', 'appearance-spacing', 'appearance-width', 'appearance-menu'] },
  { id: 'editing', title: 'Editing and startup', blurb: 'Startup view, keyboard, modeline, search, logging', cards: ['quick:Startup', 'quick:Editing', 'quick:Modeline', 'quick:Keyboard', 'quick:Progress logging', 'quick:Search & tags'] },
  { id: 'agenda', title: 'Agenda, diary and weather', blurb: 'Agenda, diary, reminders, weather, location', cards: ['quick:Agenda', 'quick:Diary', 'appt', 'quick:Weather'] },
  { id: 'sync', title: 'Sync and storage', blurb: 'GitHub, WebDAV, calendar, attachments, backup', cards: ['github', 'webdav', 'calendar', 'attach', 'pending', 'backup'] },
  { id: 'export', title: 'Export', blurb: 'ASCII, HTML, LaTeX', cards: ['quick:ASCII', 'export-html', 'export-latex'] },
  { id: 'advanced', title: 'Advanced', blurb: 'Variables, capture templates, extensions, order of settings', cards: ['global-vars', 'capture', 'extensions', 'quick:Advanced (raw syntax)', 'order'] },
]);

/** Puts `saved` ids first, in the saved order, dropping any that no longer exist; ids the saved list never heard of (added by a newer version) follow in their default places.
 * @param {string[]} defaults
 * @param {unknown} saved */
export function mergeOrder(defaults, saved) {
  const known = new Set(defaults);
  const seen = new Set();
  /** @type {string[]} */ const out = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === 'string' && known.has(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
  }
  for (const id of defaults) if (!seen.has(id)) out.push(id);
  return out;
}

/** The categories in the person's order, each with its cards in the person's order. A saved order that is not an object, or mentions things that do not exist, is read as far as it makes sense.
 * @param {unknown} saved
 * @param {SettingsCategory[]} [defaults] */
export function resolveSettingsLayout(saved, defaults = DEFAULT_SETTINGS_CATEGORIES) {
  const order = saved && typeof saved === 'object' ? /** @type {SettingsOrder} */ (saved) : {};
  const byId = new Map(defaults.map((c) => [c.id, c]));
  const ids = mergeOrder(defaults.map((c) => c.id), order.categories);
  const cardOrder = order.cards && typeof order.cards === 'object' ? order.cards : {};
  return ids.map((id) => {
    const category = /** @type {SettingsCategory} */ (byId.get(id));
    return { ...category, cards: mergeOrder(category.cards, cardOrder[id]) };
  });
}

/** `list` with the item at `index` moved by `delta` places (clamped); a new array.
 * @param {string[]} list
 * @param {number} index
 * @param {number} delta */
export function moveInList(list, index, delta) {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (index < 0 || index >= list.length || to === index) return list.slice();
  const out = list.slice();
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

/** The order to store for `layout`, or null when it equals the defaults (so nothing is stored for a person who never arranged anything).
 * @param {SettingsCategory[]} layout
 * @param {SettingsCategory[]} [defaults] */
export function orderToStore(layout, defaults = DEFAULT_SETTINGS_CATEGORIES) {
  const categories = layout.map((c) => c.id);
  /** @type {Record<string, string[]>} */ const cards = {};
  for (const c of layout) {
    const original = defaults.find((d) => d.id === c.id);
    if (original && original.cards.join('|') !== c.cards.join('|')) cards[c.id] = c.cards;
  }
  const categoriesChanged = categories.join('|') !== defaults.map((d) => d.id).join('|');
  if (!categoriesChanged && Object.keys(cards).length === 0) return null;
  /** @type {SettingsOrder} */ const out = {};
  if (categoriesChanged) out.categories = categories;
  if (Object.keys(cards).length) out.cards = cards;
  return out;
}
