// @ts-check
// The frame of the Settings screen: a home list of categories (a sidebar when there is room), one page of cards per category,
// a search box, and the "Order of settings" card that lets the person rearrange both. The cards themselves are built by
// settings-view.js and handed in by id; this file only decides where they go.
import { moveInList, orderToStore, resolveSettingsLayout } from '../src/settings-layout.js';
import { S } from './app-state.js';
import { QUICK_SETTINGS_FIELDS } from './settings-fields.js';
import { setSettingsOrder } from './settings.js';
import { kv } from './singletons.js';
import { menuButton } from './ui-widgets.js';

/** @typedef {import('../src/settings-layout.js').SettingsCategory} SettingsCategory */

/** Where the person is in Settings. Kept here, not in the render, so a re-render after a change stays on the same page. */
const place = { category: /** @type {string | null} */ (null), query: '' };

const WIDE_FROM = 720;

/** The title of a card, read from the heading it already shows.
 * @param {string} id
 * @param {HTMLElement | undefined} el */
function cardTitle(id, el) {
  const heading = el && el.querySelector('.panel-section-title');
  return (heading && heading.textContent && heading.textContent.trim()) || id.replace(/^quick:/, '');
}

/** How many Quick Settings in a category the person has set to something.
 * @param {SettingsCategory} category */
function customizedCount(category) {
  let n = 0;
  for (const id of category.cards) {
    if (!id.startsWith('quick:')) continue;
    const group = id.slice('quick:'.length);
    for (const field of QUICK_SETTINGS_FIELDS) if (field.section === group && S.globalVariables[field.key] !== undefined) n++;
  }
  return n;
}

/** @param {string} text @param {string} style */
function el(text, style) {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = style;
  return d;
}

/**
 * The "Order of settings" card (Advanced): ▲ ▼ on every category, and on every card within one; Reset puts the defaults back.
 * @param {SettingsCategory[]} layout
 * @param {Map<string, HTMLElement>} cards
 * @param {() => void} rerender
 */
function buildOrderCard(layout, cards, rerender) {
  const card = document.createElement('div');
  card.className = 'settings-section';
  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'Order of settings';
  card.appendChild(title);
  card.appendChild(el('Move categories, and the cards inside a category, to where you want them. Saved on this device and included in Export settings.', 'font-size: 11px; opacity: 0.6; margin: 2px 0 10px'));

  /** @param {SettingsCategory[]} next */
  async function save(next) {
    await setSettingsOrder(kv, orderToStore(next));
    rerender();
  }

  /** @param {string} label @param {string} aria @param {boolean} disabled @param {() => void} onClick */
  const arrow = (label, aria, disabled, onClick) => {
    const b = menuButton(label, onClick, disabled);
    b.setAttribute('aria-label', aria);
    b.style.minWidth = '44px';
    b.style.minHeight = '44px';
    return b;
  };

  layout.forEach((category, ci) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 6px';
    row.appendChild(el(category.title, 'flex: 1 1 auto; font-weight: 600; font-size: 14px'));
    row.appendChild(
      arrow('▲', `Move ${category.title} up`, ci === 0, () => {
        const ids = moveInList(layout.map((c) => c.id), ci, -1);
        save(ids.map((id) => /** @type {SettingsCategory} */ (layout.find((c) => c.id === id))));
      })
    );
    row.appendChild(
      arrow('▼', `Move ${category.title} down`, ci === layout.length - 1, () => {
        const ids = moveInList(layout.map((c) => c.id), ci, 1);
        save(ids.map((id) => /** @type {SettingsCategory} */ (layout.find((c) => c.id === id))));
      })
    );
    card.appendChild(row);

    const details = document.createElement('details');
    details.style.cssText = 'margin: 0 0 10px 12px';
    const summary = document.createElement('summary');
    summary.textContent = `Cards in ${category.title} (${category.cards.length})`;
    summary.style.cssText = 'font-size: 12px; opacity: 0.75; cursor: pointer; min-height: 32px';
    details.appendChild(summary);
    category.cards.forEach((id, i) => {
      const line = document.createElement('div');
      line.style.cssText = 'display: flex; align-items: center; gap: 6px; margin: 4px 0';
      line.appendChild(el(cardTitle(id, cards.get(id)), 'flex: 1 1 auto; font-size: 13px'));
      const reorder = (/** @type {number} */ delta) => {
        const moved = moveInList(category.cards, i, delta);
        save(layout.map((c) => (c.id === category.id ? { ...c, cards: moved } : c)));
      };
      line.appendChild(arrow('▲', `Move ${cardTitle(id, cards.get(id))} up`, i === 0, () => reorder(-1)));
      line.appendChild(arrow('▼', `Move ${cardTitle(id, cards.get(id))} down`, i === category.cards.length - 1, () => reorder(1)));
      details.appendChild(line);
    });
    card.appendChild(details);
  });

  const resetRow = document.createElement('div');
  resetRow.className = 'panel-row';
  resetRow.appendChild(menuButton('Reset to default order', () => save(resolveSettingsLayout(null))));
  card.appendChild(resetRow);
  return card;
}

/**
 * Lays the cards out and returns nothing: `container` is filled in place. Called by renderSettingsView after every card exists.
 * @param {HTMLElement} container
 * @param {Map<string, HTMLElement>} cards  every card, by id
 * @param {unknown} savedOrder  what getSettingsOrder returned
 * @param {() => void} rerender  rebuilds the whole screen (used after the order changes)
 */
export function renderSettingsShell(container, cards, savedOrder, rerender) {
  const layout = resolveSettingsLayout(savedOrder).map((category) => ({ ...category, cards: category.cards.filter((id) => id === 'order' || cards.has(id)) }));
  cards.set('order', buildOrderCard(layout, cards, rerender));
  const wide = container.clientWidth >= WIDE_FROM;
  if (!place.category || !layout.some((c) => c.id === place.category)) place.category = wide ? layout[0].id : null;

  const frame = document.createElement('div');
  frame.setAttribute('data-settings-shell', wide ? 'wide' : 'narrow');
  frame.style.cssText = wide ? 'display: flex; gap: 18px; align-items: flex-start' : '';
  container.appendChild(frame);

  const nav = document.createElement('div');
  const page = document.createElement('div');
  page.style.cssText = 'flex: 1 1 auto; min-width: 0';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search settings';
  search.setAttribute('aria-label', 'Search settings');
  search.value = place.query;
  search.style.cssText = 'width: 100%; box-sizing: border-box; min-height: 44px; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); font-size: 15px';

  /** @param {HTMLElement} parent @param {SettingsCategory} category */
  function categoryButton(parent, category) {
    const n = customizedCount(category);
    const b = document.createElement('button');
    b.setAttribute('data-settings-category', category.id);
    const selected = wide && place.category === category.id && !place.query;
    b.setAttribute('aria-current', String(selected));
    b.style.cssText = `display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; min-height: ${wide ? 44 : 60}px; margin-bottom: ${wide ? 2 : 8}px; padding: 8px 12px; border-radius: 10px; border: ${wide ? '0' : '1px solid var(--border-strong)'}; background: ${selected ? 'var(--surface)' : wide ? 'transparent' : 'var(--bg)'}; color: var(--fg); font-size: 15px`;
    const text = document.createElement('span');
    text.style.cssText = 'flex: 1 1 auto; min-width: 0';
    const name = el(category.title, `font-weight: ${selected ? 700 : 600}`);
    text.appendChild(name);
    if (!wide) text.appendChild(el(category.blurb, 'font-size: 12px; opacity: 0.65; font-weight: 400'));
    b.appendChild(text);
    if (n) b.appendChild(el(`${n} set`, 'font-size: 12px; padding: 2px 8px; border-radius: 9px; background: var(--surface); border: 0.5px solid var(--border-strong)'));
    if (!wide) b.appendChild(el('›', 'opacity: 0.6; font-size: 18px'));
    b.onclick = () => {
      place.category = category.id;
      place.query = '';
      search.value = '';
      draw();
    };
    parent.appendChild(b);
  }

  function matches() {
    const q = place.query.trim().toLowerCase();
    /** @type {{ category: SettingsCategory, id: string }[]} */ const found = [];
    for (const category of layout) for (const id of category.cards) {
      const card = cards.get(id);
      if (card && (card.textContent || '').toLowerCase().includes(q)) found.push({ category, id });
    }
    return found;
  }

  function draw() {
    nav.innerHTML = '';
    page.innerHTML = '';
    const searching = place.query.trim() !== '';
    if (wide) {
      nav.style.cssText = 'flex: 0 0 240px';
      nav.appendChild(search);
      for (const category of layout) categoryButton(nav, category);
      frame.replaceChildren(nav, page);
    } else if (searching || place.category === null) {
      page.appendChild(search);
      frame.replaceChildren(page);
    } else {
      frame.replaceChildren(page);
    }
    if (searching) {
      const found = matches();
      if (!found.length) page.appendChild(el('No setting matches that.', 'opacity: 0.7; padding: 8px 2px'));
      let last = '';
      for (const { category, id } of found) {
        if (category.id !== last) page.appendChild(el(category.title, 'font-size: 12px; font-weight: 600; opacity: 0.7; margin: 10px 2px 4px'));
        last = category.id;
        page.appendChild(/** @type {HTMLElement} */ (cards.get(id)));
      }
      return;
    }
    if (place.category === null) {
      for (const category of layout) categoryButton(page, category);
      return;
    }
    const category = /** @type {SettingsCategory} */ (layout.find((c) => c.id === place.category));
    if (!wide) {
      const bar = document.createElement('div');
      bar.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 10px';
      const back = menuButton('‹ Settings', () => {
        place.category = null;
        draw();
      });
      back.setAttribute('data-settings-back', '');
      bar.appendChild(back);
      bar.appendChild(el(category.title, 'font-size: 17px; font-weight: 700; margin-left: 6px'));
      page.appendChild(bar);
    } else {
      page.appendChild(el(category.title, 'font-size: 20px; font-weight: 700; margin: 4px 0 12px'));
    }
    page.setAttribute('data-settings-page', category.id);
    for (const id of category.cards) page.appendChild(/** @type {HTMLElement} */ (cards.get(id)));
  }

  search.addEventListener('input', () => {
    place.query = search.value;
    const keepFocus = document.activeElement === search;
    draw();
    if (keepFocus) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  });
  draw();
}
