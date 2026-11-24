import { isMatchDuration, type MatchDuration } from '../domain/match.js';
import { LEVELS } from '../domain/maps.js';
import type { MapKey } from '../domain/maps.js';

export interface ScreenEvents {
  begin(): void;
  online(): void;
  selectMap(map: MapKey): void;
  checkpoint(wave: number): void;
  mainMenu(): void;
  quickPlay(): void;
  createLobby(isPublic: boolean): void;
  joinLobby(code: string): void;
  rejoin(): void;
  missingCode(): void;
  back(): void;
  refresh(): void;
  pickLobbyMap(map: MapKey): void;
  pickDuration?(seconds: MatchDuration): void;
  startMatch(): void;
  leave(): void;
}
interface SettingsBinding {
  wire(panel: ParentNode): void;
  wireName(panel: ParentNode): void;
}
/** Browser event adapter; routing, map authority, progress and network policy belong to commands. */
class ScreenBindings {
  constructor(
    private readonly panel: HTMLElement,
    private readonly settings: SettingsBinding,
    private readonly actions: ScreenEvents,
  ) {}
  wireSettings() {
    this.settings.wire(this.panel);
  }
  wireName(box: ParentNode) {
    this.settings.wireName(box);
  }
  wireCheckpoints(onGo: (wave: number) => void = this.actions.checkpoint) {
    const box = this.panel.querySelector('.checkpoints');
    box?.addEventListener('click', (event) => {
      event.stopPropagation();
      const button =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (button) onGo(Number(button.dataset.cp));
    });
  }
  wireMap(onPick: (map: MapKey) => void) {
    const box = this.panel.querySelector('#mapsel');
    box?.addEventListener('click', (event) => {
      event.stopPropagation();
      const button =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.mapbtn') : null;
      const map = LEVELS.find((item) => item.key === button?.dataset.map);
      if (button && !button.disabled && map) {
        onPick(map.key);
        if (event instanceof MouseEvent && event.detail === 0)
          this.panel.querySelector<HTMLButtonElement>(`.mapbtn[data-map="${map.key}"]`)?.focus();
      }
    });
  }
  main() {
    this.wireSettings();
    this.wireCheckpoints();
    this.wireMap(this.actions.selectMap);
    this.panel.querySelector('#soloBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.actions.begin();
    });
    this.panel.querySelector('#onlineBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.actions.online();
    });
  }
  online() {
    const box = this.panel.querySelector<HTMLElement>('#online');
    if (!box) return;
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('keydown', (event) => event.stopPropagation());
    this.wireName(box);
    this.wireConnection(box);
    this.wireBrowsing(box);
    this.wireMap(this.actions.pickLobbyMap);
    const duration = box.querySelector<HTMLSelectElement>('#matchDuration');
    duration?.addEventListener('change', () => {
      const seconds = Number(duration.value);
      if (isMatchDuration(seconds)) {
        this.actions.pickDuration?.(seconds);
        this.panel.querySelector<HTMLSelectElement>('#matchDuration')?.focus();
      }
    });
    box.querySelector('#startBtn')?.addEventListener('click', () => this.actions.startMatch());
    box.querySelector('#leaveBtn')?.addEventListener('click', () => this.actions.leave());
  }
  private wireConnection(box: HTMLElement) {
    box.querySelector('#quickBtn')?.addEventListener('click', () => {
      this.lockButtons(box);
      this.actions.quickPlay();
    });
    box.querySelector('#createBtn')?.addEventListener('click', () => {
      this.lockButtons(box);
      const selected = box.querySelector<HTMLInputElement>('input[name=vis]:checked');
      this.actions.createLobby(selected?.value === 'public');
    });
    const join = box.querySelector<HTMLButtonElement>('#joinBtn');
    const code = box.querySelector<HTMLInputElement>('#codeBox');
    if (join && code) {
      join.addEventListener('click', () => {
        const value = code.value.trim().toUpperCase();
        if (!value) {
          this.actions.missingCode();
          return;
        }
        this.lockButtons(box);
        this.actions.joinLobby(value);
      });
      code.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') join.click();
      });
    }
    box.querySelector('#rejoinBtn')?.addEventListener('click', () => {
      this.lockButtons(box);
      this.actions.rejoin();
    });
    box.querySelector('#backBtn')?.addEventListener('click', () => this.actions.back());
  }
  private wireBrowsing(box: HTMLElement) {
    const browse = box.querySelector<HTMLDetailsElement>('#browseFlow');
    const refresh = box.querySelector<HTMLButtonElement>('#refreshBtn');
    browse?.addEventListener('toggle', () => {
      if (browse.open && refresh && !refresh.disabled && browse.isConnected) this.actions.refresh();
    });
    refresh?.addEventListener('click', () => this.actions.refresh());
    box.querySelector('#lobbyRows')?.addEventListener('click', (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button[data-join]')
          : null;
      if (button?.dataset.join) {
        this.lockButtons(box);
        this.actions.joinLobby(button.dataset.join);
      }
    });
  }
  wireMenuBtn() {
    this.panel.querySelector('#menuBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.actions.mainMenu();
    });
  }
  lockButtons(box: ParentNode) {
    for (const button of box.querySelectorAll<HTMLButtonElement>('button'))
      if (button.id !== 'backBtn') button.disabled = true;
  }
}

export type ScreenBindingMode = 'main' | 'online' | 'onlinePause' | 'pause' | 'dead';
interface ScreenHud {
  el: { panel: HTMLElement };
  showScreen(html: string): void;
  setGameplayVisible(visible: boolean): void;
  key(action: string): string;
}
/** Presents browser screens without owning navigation, records, roster or browse transactions. */
export class BrowserScreens {
  constructor(
    private readonly hud: ScreenHud,
    private readonly settings: SettingsBinding & { html(): string },
  ) {}
  settingsHTML() {
    return this.settings.html();
  }
  confirm() {
    return this.hud.key('confirm');
  }
  show(html: string) {
    this.hud.showScreen(html);
  }
  gameplay(visible: boolean) {
    this.hud.setGameplayVisible(visible);
  }
  bind(mode: ScreenBindingMode, actions: ScreenEvents) {
    const bindings = new ScreenBindings(this.hud.el.panel, this.settings, actions);
    switch (mode) {
      case 'main':
        bindings.main();
        break;
      case 'online':
        bindings.online();
        break;
      case 'onlinePause':
        bindings.wireSettings();
        bindings.online();
        break;
      case 'pause':
        bindings.wireSettings();
        bindings.wireMenuBtn();
        break;
      case 'dead':
        bindings.wireCheckpoints();
        bindings.wireMenuBtn();
        break;
    }
  }
  status(message: string) {
    const status = this.hud.el.panel.querySelector('#status');
    if (status) status.textContent = message;
  }
  rows(html: string) {
    const rows = this.hud.el.panel.querySelector('#lobbyRows');
    if (rows) rows.innerHTML = html;
  }
  unlockButtons() {
    const box = this.hud.el.panel.querySelector('#online');
    if (box)
      for (const button of box.querySelectorAll<HTMLButtonElement>('button'))
        if (button.getAttribute('aria-disabled') !== 'true') button.disabled = false;
  }
}
