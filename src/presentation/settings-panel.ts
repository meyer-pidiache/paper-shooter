import { bindingLabel, KEY_BINDING_ACTIONS, KEY_BINDING_LABELS } from '../shared/key-bindings.js';
import type { BindingDevice, KeyBindingAction, KeyBindings } from '../shared/key-bindings.js';
import { controlsHTML } from './input-guide.js';

interface SettingsView {
  readonly settings: { readonly sens: number; readonly invert: boolean };
  readonly musicWanted: boolean;
  readonly appearance: 'light' | 'dark';
  readonly nerdStats: boolean;
  readonly keyBindings: KeyBindings;
}
interface SettingsCommands {
  setSensitivity(value: number): void;
  setInvert(value: boolean): void;
  setMusic(value: boolean): void;
  setName(value: string): void;
  setAppearance(value: 'light' | 'dark'): void;
  setNerdStats(value: boolean): void;
  getKeyBindings(): KeyBindings;
  keyLabel(action: string): string;
  setBinding(
    action: KeyBindingAction,
    device: BindingDevice,
    value: string | number,
  ): string | null;
  clearBinding(action: KeyBindingAction, device: BindingDevice): void;
  resetKeyBindings(): void;
  releasePointerLock(): void;
}

/** DOM event translation and markup only; the command receiver owns persistence and adapter state. */
export class SettingsPanel {
  private capture: { action: KeyBindingAction; device: BindingDevice; button: HTMLElement } | null =
    null;
  private captureKeydown: ((event: KeyboardEvent) => void) | null = null;
  private captureMousedown: ((event: MouseEvent) => void) | null = null;

  constructor(
    private readonly view: SettingsView,
    private readonly commands: SettingsCommands,
  ) {}

  html() {
    const keyLabel = (action: string) => this.commands.keyLabel(action);
    return `<details class="settings-shell" id="settingsShell">
      <summary>SETTINGS &amp; CONTROLS</summary>
      <div class="settings" id="settings">
        <label>look sensitivity <input type="range" id="setSens" min="25" max="250" step="5" value="${this.view.settings.sens}"><b id="setSensV">${this.view.settings.sens}%</b></label>
        <label><input type="checkbox" id="setInv" ${this.view.settings.invert ? 'checked' : ''}> invert vertical look</label>
        <label><input type="checkbox" id="setMus" ${this.view.musicWanted ? 'checked' : ''}> music <span class="k">(${keyLabel('music')})</span></label>
        <label>appearance <select id="setAppearance"><option value="light" ${this.view.appearance === 'light' ? 'selected' : ''}>light</option><option value="dark" ${this.view.appearance === 'dark' ? 'selected' : ''}>dark</option></select></label>
        <label><input type="checkbox" id="setNerdStats" ${this.view.nerdStats ? 'checked' : ''}> nerd stats · FPS and multiplayer ping</label>
        <details class="controls-editor">
          <summary>KEYBOARD &amp; MOUSE BINDINGS</summary>
          <p class="settings-help">Changing a key or mouse button replaces that action's bindings for the device. Reset restores the default aliases. Escape cancels capture; browser shortcuts are reserved.</p>
          <div class="binding-list" id="controlBindings">${this.bindingsHTML()}</div>
          <div class="binding-actions"><button type="button" class="alt" id="resetBindings">RESET TO DEFAULTS</button></div>
          <div class="binding-status" id="bindingStatus" aria-live="polite"></div>
          <details class="control-guide"><summary>CONTROL GUIDE</summary><div class="dynamic-controls">${controlsHTML(keyLabel)}</div></details>
        </details>
      </div>
    </details>`;
  }

  wire(panel: ParentNode) {
    const box = panel.querySelector<HTMLElement>('#settings');
    if (!box) return;
    const shell = panel.querySelector('#settingsShell');
    shell?.addEventListener('click', (event) => event.stopPropagation());
    shell?.addEventListener('keydown', (event) => event.stopPropagation());
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('keydown', (event) => event.stopPropagation());
    const sensitivity = box.querySelector<HTMLInputElement>('#setSens');
    const output = box.querySelector('#setSensV');
    if (sensitivity && output)
      sensitivity.addEventListener('input', () => {
        const value = Number(sensitivity.value);
        output.textContent = value + '%';
        this.commands.setSensitivity(value);
      });
    const invert = box.querySelector<HTMLInputElement>('#setInv');
    invert?.addEventListener('change', () => this.commands.setInvert(invert.checked));
    const music = box.querySelector<HTMLInputElement>('#setMus');
    music?.addEventListener('change', () => this.commands.setMusic(music.checked));
    const appearance = box.querySelector<HTMLSelectElement>('#setAppearance');
    appearance?.addEventListener('change', () =>
      this.commands.setAppearance(appearance.value === 'dark' ? 'dark' : 'light'),
    );
    const nerdStats = box.querySelector<HTMLInputElement>('#setNerdStats');
    nerdStats?.addEventListener('change', () => this.commands.setNerdStats(nerdStats.checked));
    box.querySelector('#controlBindings')?.addEventListener('click', (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button[data-action]')
          : null;
      if (!target) return;
      const action = target.dataset.action as KeyBindingAction;
      const device = target.dataset.device as BindingDevice;
      if (target.dataset.capture) this.startCapture(action, device, target, box);
      else if (target.dataset.clear) {
        this.commands.clearBinding(action, device);
        this.refreshBindings(box);
        this.setStatus(
          box,
          `${KEY_BINDING_LABELS[action]} ${device === 'key' ? 'key' : 'mouse'} binding cleared.`,
        );
      }
    });
    box.querySelector('#resetBindings')?.addEventListener('click', () => {
      this.cancelCapture();
      this.commands.resetKeyBindings();
      this.refreshBindings(box);
      this.setStatus(box, 'Default keyboard and mouse bindings restored.');
    });
  }

  wireName(panel: ParentNode) {
    const name = panel.querySelector<HTMLInputElement>('#setName');
    name?.addEventListener('input', () => this.commands.setName(name.value));
  }

  private bindingsHTML() {
    const bindings = this.commands.getKeyBindings();
    return KEY_BINDING_ACTIONS.map(
      (action) => `<div class="binding-row">
      <span class="binding-name">${KEY_BINDING_LABELS[action]}</span>
      <kbd>${bindingLabel(action, bindings)}</kbd>
      <button type="button" class="alt" data-action="${action}" data-device="key" data-capture="key">CHANGE KEY</button>
      <button type="button" class="alt" data-action="${action}" data-device="mouse" data-capture="mouse">CHANGE MOUSE</button>
      <button type="button" class="alt clear-binding" data-action="${action}" data-device="key" data-clear="key">CLEAR KEY</button>
      <button type="button" class="alt clear-binding" data-action="${action}" data-device="mouse" data-clear="mouse">CLEAR MOUSE</button>
    </div>`,
    ).join('');
  }

  private refreshBindings(box: HTMLElement) {
    const list = box.querySelector('#controlBindings');
    if (list) list.innerHTML = this.bindingsHTML();
    const guide = box.querySelector('.dynamic-controls');
    if (guide) guide.innerHTML = controlsHTML((action) => this.commands.keyLabel(action));
  }

  private startCapture(
    action: KeyBindingAction,
    device: BindingDevice,
    button: HTMLElement,
    box: HTMLElement,
  ) {
    this.cancelCapture();
    this.commands.releasePointerLock();
    this.capture = { action, device, button };
    const noun = device === 'key' ? 'key' : 'mouse button';
    this.setStatus(box, `Press a ${noun} for ${KEY_BINDING_LABELS[action]}. Escape cancels.`);
    button.textContent = 'PRESS INPUT…';
    this.captureKeydown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        this.cancelCapture();
        this.setStatus(box, 'Binding change cancelled.');
        return;
      }
      if (event.repeat) return;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ['Tab', 'F5', 'F11', 'F12'].includes(event.code)
      ) {
        this.setStatus(
          box,
          'That browser shortcut is reserved. Choose another key or press Escape.',
        );
        return;
      }
      if (device !== 'key') return;
      const conflict = this.commands.setBinding(action, 'key', event.code);
      if (conflict) {
        this.setStatus(
          box,
          `That key is already assigned to ${KEY_BINDING_LABELS[conflict as KeyBindingAction] ?? conflict}. Choose another key.`,
        );
        return;
      }
      this.cancelCapture();
      this.refreshBindings(box);
      this.setStatus(box, `${KEY_BINDING_LABELS[action]} now uses ${event.key}.`);
    };
    this.captureMousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (device !== 'mouse') return;
      if (event.button > 4) {
        this.setStatus(
          box,
          'That mouse button is not supported. Choose buttons 1–5 or press Escape.',
        );
        return;
      }
      const conflict = this.commands.setBinding(action, 'mouse', event.button);
      if (conflict) {
        this.setStatus(
          box,
          `That mouse button is already assigned to ${KEY_BINDING_LABELS[conflict as KeyBindingAction] ?? conflict}. Choose another button.`,
        );
        return;
      }
      this.cancelCapture();
      this.refreshBindings(box);
      this.setStatus(box, `${KEY_BINDING_LABELS[action]} mouse binding updated.`);
    };
    window.addEventListener('keydown', this.captureKeydown, true);
    document.addEventListener('mousedown', this.captureMousedown, true);
  }

  cancelCapture() {
    if (this.captureKeydown) window.removeEventListener('keydown', this.captureKeydown, true);
    if (this.captureMousedown)
      document.removeEventListener('mousedown', this.captureMousedown, true);
    this.captureKeydown = null;
    this.captureMousedown = null;
    if (this.capture?.button.isConnected) {
      const device = this.capture.device;
      this.capture.button.textContent = device === 'key' ? 'CHANGE KEY' : 'CHANGE MOUSE';
    }
    this.capture = null;
  }

  private setStatus(box: ParentNode, message: string) {
    const status = box.querySelector('#bindingStatus');
    if (status) status.textContent = message;
  }
}
