import { LEVELS, type MapKey } from '../domain/maps.js';
import { MAP_VOTE_SECONDS } from '../domain/map-vote.js';

export function mapVoteHTML(): string {
  return `<section class="online" aria-labelledby="voteTitle"><h2 id="voteTitle">Vote for the next map · <span id="voteTime">${MAP_VOTE_SECONDS}s</span></h2>
      <div class="row">${LEVELS.map(({ key, name }) => `<button type="button" class="mapbtn" data-vote-map="${key}" aria-pressed="false">${name}<i>0 votes</i></button>`).join('')}</div></section>`;
}

export class MapVoteView {
  constructor(private readonly panel: HTMLElement) {}

  private buttons() {
    return [...this.panel.querySelectorAll<HTMLButtonElement>('button[data-vote-map]')];
  }

  bind(onVote: (map: MapKey) => void) {
    const buttons = this.buttons();
    for (const button of buttons) {
      const map = LEVELS.find(({ key }) => key === button.dataset.voteMap);
      if (map) button.addEventListener('click', () => onVote(map.key));
    }
    buttons[0]?.focus();
  }

  update(counts: ReadonlyMap<MapKey, number>, chosen: MapKey | undefined, seconds: number) {
    const time = this.panel.querySelector('#voteTime');
    if (!time) return;
    time.textContent = seconds + 's';
    for (const button of this.buttons()) {
      const map = LEVELS.find(({ key }) => key === button.dataset.voteMap);
      if (!map) continue;
      const selected = map.key === chosen;
      const votes = counts.get(map.key) ?? 0;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = seconds === 0;
      const count = button.querySelector('i');
      if (count) count.textContent = votes + (votes === 1 ? ' vote' : ' votes');
    }
  }

  moveFocus(step: number) {
    const buttons = this.buttons();
    const index = buttons.findIndex((button) => button === this.panel.ownerDocument.activeElement);
    if (buttons.length)
      buttons[index < 0 ? 0 : (index + step + buttons.length) % buttons.length].focus();
  }

  confirm() {
    this.buttons()
      .find((button) => button === this.panel.ownerDocument.activeElement)
      ?.click();
  }
}
