// Race overlay: the big centre banner (lobby prompt, countdown, results), the lap/time HUD line,
// the big placing in the corner, and the Mario Kart-style lap banner.
export interface Standing { id: string; color: number; place: number; finishTime: number; lap: number; racing: boolean; ready: boolean; bot: boolean }
export interface RaceView { phase: 'lobby' | 'countdown' | 'racing' | 'results'; timer: number; laps: number; at: number; standings: Standing[] }

const el = document.getElementById('banner')!;
const swatch = (c: number) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`;
export const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

let lastHtml = '';
const show = (html: string) => { if (html !== lastHtml) el.innerHTML = lastHtml = html; };

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

// Big placing, bottom right: gold / silver / bronze / iron, popping when it changes.
const placeEl = document.getElementById('place')!;
let shownPlace = '';
function showPlace(place: number) {
  const text = place ? ordinal(place) : '';
  if (text === shownPlace) return;
  shownPlace = text;
  placeEl.className = place ? `p${Math.min(place, 4)}` : '';
  placeEl.innerHTML = place ? `${place}<small>${text.slice(String(place).length)}</small>` : '';
  if (place) { placeEl.classList.remove('pop'); void placeEl.offsetWidth; placeEl.classList.add('pop'); }
}

// Lap banner: sweeps across when you start a new lap; the last one is "Final Lap!".
const lapEl = document.getElementById('lapflash')!;
let lastLap = 0;
function flashLap(lap: number, laps: number) {
  lapEl.className = '';
  lapEl.innerHTML = lap === laps ? 'Final Lap!' : `Lap ${lap} <small>/ ${laps}</small>`;
  void lapEl.offsetWidth; // restart the animation
  lapEl.className = lap === laps ? 'show final' : 'show';
}

/** Updates the banner and returns the HUD line for the local racer. */
export function renderRace(v: RaceView | null, myId: string, now: number, joinHint = ''): string {
  if (!v) { show(''); return ''; }
  const elapsed = (now - v.at) / 1000;
  const timer = v.phase === 'racing' ? v.timer + elapsed : Math.max(0, v.timer - elapsed);
  const me = v.standings.find(s => s.id === myId);
  const racers = v.standings.filter(s => s.racing);
  // Placing shows while you're racing (and on the results); the lap banner fires when your lap goes up.
  const racing = v.phase === 'racing' && !!me?.racing;
  showPlace(racing || (v.phase === 'results' && me?.racing) ? me!.place : 0);
  if (racing && me!.finishTime < 0 && lastLap && me!.lap > lastLap) flashLap(me!.lap, v.laps);
  lastLap = racing ? me!.lap : 0;

  switch (v.phase) {
    case 'lobby': {
      const humans = v.standings.filter(s => !s.bot), bots = v.standings.length - humans.length;
      const ready = humans.filter(s => s.ready).length;
      show(`<p>${me?.ready ? 'Ready — waiting for the others' : 'Press <kbd>Enter</kbd> to ready up'}</p>` +
        `<small>${ready}/${humans.length} ready · ${v.laps} laps · ${bots} bot${bots === 1 ? '' : 's'}</small>` +
        `<br><small><kbd>B</kbd> add a bot · <kbd>N</kbd> remove one</small>` +
        (joinHint ? `<br><small>${joinHint}</small>` : ''));
      return '';
    }
    case 'countdown':
      show(`<b class="big">${Math.ceil(timer)}</b>`);
      return '';
    case 'racing':
      if (!me?.racing) show('<small>Race in progress — you’ll join the next one</small>');
      else if (me.finishTime >= 0) show(`<p>Finished P${me.place}</p><small>${formatTime(me.finishTime)}</small>`);
      else show(timer < 1 ? '<b class="big">GO!</b>' : '');
      return me?.racing
        ? `Lap ${me.lap}/${v.laps} · ${formatTime(me.finishTime >= 0 ? me.finishTime : timer)}` // placing has its own display
        : '';
    case 'results':
      show('<p>Results</p><table>' +
        [...racers].sort((a, b) => a.place - b.place).map(s =>
          `<tr${s.id === myId ? ' class="me"' : ''}><td>P${s.place}</td><td>${swatch(s.color)}${s.id === myId ? 'You' : s.bot ? 'Bot' : ''}</td>` +
          `<td>${s.finishTime >= 0 ? formatTime(s.finishTime) : 'DNF'}</td></tr>`).join('') +
        `</table><small>Next race in ${Math.ceil(timer)}s</small>`);
      return '';
  }
}
