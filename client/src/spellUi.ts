// Mana orb (Diablo-style liquid with a rolling surface) and the spell bar, driven by the local predicted kart.
import type { KartState } from 'shared/kart';
import { MANA, SPELLS, cooldownOf, type Spell } from 'shared/spells';

// Simple glyphs, stroked in the spell's colour.
const ICONS: Record<Spell['id'], string> = {
  haste: '<path d="M3 6l6 6-6 6M10 6l6 6-6 6M17 7l4 5-4 5"/>',
  smite: '<path d="M14 2L5 13h6l-2 9 10-12h-6l1-8z"/><circle cx="12" cy="12" r="10.5" opacity=".35"/>',
  snare: '<circle cx="12" cy="12" r="9"/><path d="M12 4.5l6.5 11.5h-13z"/><path d="M12 9v4M12 15.5v.5"/>',
  ward: '<path d="M12 2.5l8 3v6c0 5-3.6 8.6-8 10-4.4-1.4-8-5-8-10v-6z"/><path d="M12 7v10M8.5 10.5h7"/>',
};
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const root = document.getElementById('spells')!;
root.innerHTML =
  `<div class="orb" role="meter" aria-label="Mana" aria-valuemin="0" aria-valuemax="${MANA.max}">` +
  `<div class="liquid"><div class="wave"></div></div><div class="glass"></div><span></span></div>` +
  `<div class="bar">` +
  SPELLS.map((s, i) =>
    `<div class="slot" style="--c:${hex(s.color)}" title="${s.name} — ${s.cost} mana">` +
    `<kbd>${i + 1}</kbd>` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[s.id]}</svg>` +
    `<b>${s.name}</b><small class="cost">${s.cost}</small>` +
    `<div class="cd"><span></span></div></div>`).join('') +
  `</div>`;
const orb = root.querySelector<HTMLElement>('.orb')!;
const liquid = root.querySelector<HTMLElement>('.liquid')!;
const label = root.querySelector<HTMLElement>('.orb span')!;
const slots = [...root.querySelectorAll<HTMLElement>('.slot')];

let last = '';
export function renderSpells(k: KartState) {
  const key = `${Math.floor(k.mana)}|${k.cd0.toFixed(1)}${k.cd1.toFixed(1)}${k.cd2.toFixed(1)}${k.cd3.toFixed(1)}|${k.stunTime > 0}`;
  if (key === last) return; // only touch the DOM when something visible changed
  last = key;
  liquid.style.height = `${(k.mana / MANA.max) * 100}%`;
  label.textContent = String(Math.floor(k.mana));
  orb.setAttribute('aria-valuenow', String(Math.floor(k.mana)));
  orb.classList.toggle('full', k.mana >= MANA.max);
  SPELLS.forEach((s, i) => {
    const cd = cooldownOf(k, i);
    const slot = slots[i];
    slot.classList.toggle('poor', k.mana < s.cost);
    slot.classList.toggle('ready', k.mana >= s.cost && cd <= 0 && k.stunTime <= 0);
    slot.style.setProperty('--cd', String(cd / s.cooldown));
    slot.querySelector('.cd span')!.textContent = cd > 0.3 ? cd.toFixed(1) : '';
  });
}

/** A cast was refused (not enough mana, cooling down, or stunned): flash the slot and shake the orb. */
export function deniedCast(slot: number) {
  for (const el of [slots[slot], slots[slot] && orb]) {
    if (!el) continue;
    el.classList.remove('denied');
    void el.offsetWidth; // restart the animation
    el.classList.add('denied');
  }
}
