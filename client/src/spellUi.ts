// Mana orb (Diablo-style fill) and the spell bar, driven by the local predicted kart.
import type { KartState } from 'shared/kart';
import { MANA, SPELLS, cooldownOf } from 'shared/spells';

const root = document.getElementById('spells')!;
root.innerHTML =
  `<div class="orb" title="Mana"><div class="fill"></div><span></span></div>` +
  SPELLS.map((s, i) =>
    `<div class="slot" style="--c:#${s.color.toString(16).padStart(6, '0')}"><kbd>${i + 1}</kbd>` +
    `<b>${s.name}</b><small>${s.cost}</small><div class="cd"></div></div>`).join('');
const fill = root.querySelector<HTMLElement>('.fill')!;
const label = root.querySelector<HTMLElement>('.orb span')!;
const slots = [...root.querySelectorAll<HTMLElement>('.slot')];

let last = '';
export function renderSpells(k: KartState) {
  const key = `${Math.floor(k.mana)}|${k.cd0.toFixed(1)}${k.cd1.toFixed(1)}${k.cd2.toFixed(1)}${k.cd3.toFixed(1)}|${k.stunTime > 0}`;
  if (key === last) return; // only touch the DOM when something visible changed
  last = key;
  fill.style.height = `${(k.mana / MANA.max) * 100}%`;
  label.textContent = String(Math.floor(k.mana));
  SPELLS.forEach((s, i) => {
    const cd = cooldownOf(k, i);
    slots[i].classList.toggle('off', k.mana < s.cost || cd > 0 || k.stunTime > 0);
    slots[i].querySelector<HTMLElement>('.cd')!.style.height = `${(cd / s.cooldown) * 100}%`;
  });
}
