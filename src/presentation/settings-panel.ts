import { bindingLabel, KEY_BINDING_ACTIONS, KEY_BINDING_LABELS } from '../shared/key-bindings.js';
import type { BindingDevice, KeyBindingAction, KeyBindings } from '../shared/key-bindings.js';
import { controlsHTML } from './input-guide.js';
import type { CharacterColor } from '../shared/character-color.js';
import { characterInkPickerHTML, wireCharacterInkPicker } from './character-ink-picker.js';

interface SettingsView {
  readonly settings: { readonly sens: number; readonly invert: boolean };
  readonly musicWanted: boolean;
  readonly appearance: 'light' | 'dark';
  readonly playerColor: CharacterColor;
  readonly characterInkLocked?: boolean;
  readonly nerdStats: boolean;
}
interface SettingsCommands {
  setSensitivity(value: number): void;
  setInvert(value: boolean): void;
  setMusic(value: boolean): void;
  setName(value: string): void;
  setAppearance(value: 'light' | 'dark'): void;
  setPlayerColor(color: CharacterColor): void;
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
  private dialog: HTMLDialogElement | null = null;
  private capture: { device: BindingDevice; button: HTMLButtonElement } | null = null;
  private captureKeydown: ((event: KeyboardEvent) => void) | null = null;
  private captureMousedown: ((event: MouseEvent) => void) | null = null;

  constructor(
    private readonly view: SettingsView,
    private readonly commands: SettingsCommands,
  ) {}

  get open() {
    return Boolean(this.dialog?.isConnected && this.dialog.open);
  }

  close() {
    this.cancelCapture();
    if (this.open) this.dialog?.close();
    this.dialog = null;
  }

  html() {
    const keyLabel = (action: string) => this.commands.keyLabel(action);
    return `<button type="button" class="settings-button" id="openSettings" aria-haspopup="dialog">Settings &amp; Controls</button>
    <dialog class="settings-dialog" id="settingsShell" aria-labelledby="settingsTitle">
      <div class="settings" id="settings">
        <header class="settings-header">
          <h2 id="settingsTitle">Settings &amp; Controls</h2>
          <button type="button" id="closeSettings" autofocus>Close</button>
        </header>
        <div class="settings-nav" role="group" aria-label="Settings sections">
          <button type="button" aria-controls="settingsPreferences" aria-pressed="true">Preferences</button>
          <button type="button" aria-controls="settingsBindings" aria-pressed="false">Key bindings</button>
          <button type="button" aria-controls="settingsGuide" aria-pressed="false">Control guide</button>
        </div>
        <div class="settings-scroll">
          <div class="settings-preferences" id="settingsPreferences">
          <label class="settings-row" for="setSens">Look sensitivity <b id="setSensV">${this.view.settings.sens}%</b></label>
          <input type="range" id="setSens" min="25" max="250" step="5" value="${this.view.settings.sens}" aria-describedby="setSensV">
          <label class="settings-row">Invert vertical look <input type="checkbox" id="setInv" ${this.view.settings.invert ? 'checked' : ''}></label>
          <label class="settings-row"><span>Music <small id="musicBinding">(${keyLabel('music')})</small></span><input type="checkbox" id="setMus" ${this.view.musicWanted ? 'checked' : ''}></label>
          <label class="settings-row">Appearance <select id="setAppearance"><option value="light" ${this.view.appearance === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${this.view.appearance === 'dark' ? 'selected' : ''}>Dark</option></select></label>
          ${characterInkPickerHTML(this.view.playerColor, this.view.characterInkLocked)}
          <label class="settings-row"><span>Nerd stats <small>FPS and multiplayer ping</small></span><input type="checkbox" id="setNerdStats" ${this.view.nerdStats ? 'checked' : ''}></label>
          </div>
          <div id="settingsBindings" hidden>
          <p class="settings-help">Changing a key or mouse button replaces that action's bindings for the device. Reset restores the default aliases. Escape cancels capture; browser shortcuts are reserved.</p>
          <button type="button" id="resetBindings">Reset to defaults</button>
          <div class="binding-list" id="controlBindings">${this.bindingsHTML()}</div>
          </div>
          <div id="settingsGuide" class="dynamic-controls" hidden>${controlsHTML(keyLabel)}</div>
        </div>
        <div class="binding-status" id="bindingStatus" role="status"></div>
      </div>
    </dialog>`;
  }

  wire(panel: ParentNode) {
    const box = panel.querySelector<HTMLElement>('#settings');
    if (!box) return;
    this.wireDialog(panel, box);
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
    wireCharacterInkPicker(box, (color) => this.commands.setPlayerColor(color));
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
        this.cancelCapture();
        this.commands.clearBinding(action, device);
        this.refreshBindings(box, target);
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

  private wireDialog(panel: ParentNode, box: HTMLElement) {
    const dialog = panel.querySelector<HTMLDialogElement>('#settingsShell');
    const opener = panel.querySelector<HTMLButtonElement>('#openSettings');
    const close = box.querySelector<HTMLButtonElement>('#closeSettings');
    const scroll = box.querySelector<HTMLElement>('.settings-scroll');
    const sections = box.querySelectorAll<HTMLButtonElement>('.settings-nav button');
    if (!dialog || !opener || !close || !scroll) return;
    this.dialog = dialog;

    for (const eventName of ['click', 'keydown', 'mousedown']) {
      dialog.addEventListener(eventName, (event) => event.stopPropagation());
    }
    opener.addEventListener('mousedown', (event) => event.stopPropagation());
    opener.addEventListener('click', (event) => {
      event.stopPropagation();
      const music = box.querySelector<HTMLInputElement>('#setMus');
      if (music) music.checked = this.view.musicWanted;
      dialog.showModal();
    });
    const closeDialog = () => {
      this.cancelCapture();
      this.setStatus(box, '');
      dialog.close();
      opener.focus({ preventScroll: true });
    };
    close.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });
    for (const button of sections) {
      button.addEventListener('click', () => {
        this.cancelCapture();
        this.setStatus(box, '');
        for (const section of sections) {
          const active = button === section;
          section.setAttribute('aria-pressed', String(active));
          const content = box.querySelector<HTMLElement>(
            '#' + section.getAttribute('aria-controls'),
          );
          if (content) content.hidden = !active;
        }
        scroll.scrollTop = 0;
      });
    }
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
      <div class="binding-buttons">
        <button type="button" aria-label="Change key for ${KEY_BINDING_LABELS[action]}" data-action="${action}" data-device="key" data-capture="key">CHANGE KEY</button>
        <button type="button" aria-label="Clear key for ${KEY_BINDING_LABELS[action]}" data-action="${action}" data-device="key" data-clear="key">CLEAR KEY</button>
        <button type="button" aria-label="Change mouse for ${KEY_BINDING_LABELS[action]}" data-action="${action}" data-device="mouse" data-capture="mouse">CHANGE MOUSE</button>
        <button type="button" aria-label="Clear mouse for ${KEY_BINDING_LABELS[action]}" data-action="${action}" data-device="mouse" data-clear="mouse">CLEAR MOUSE</button>
      </div>
    </div>`,
    ).join('');
  }

  private refreshBindings(box: HTMLElement, focused?: HTMLButtonElement) {
    const list = box.querySelector('#controlBindings');
    if (list) list.innerHTML = this.bindingsHTML();
    if (focused) {
      const { action, device, capture } = focused.dataset;
      const operation = capture ? 'data-capture' : 'data-clear';
      list
        ?.querySelector<HTMLButtonElement>(
          `[data-action="${action}"][data-device="${device}"][${operation}]`,
        )
        ?.focus({ preventScroll: true });
    }
    const guide = box.querySelector('.dynamic-controls');
    if (guide) guide.innerHTML = controlsHTML((action) => this.commands.keyLabel(action));
    const music = box.querySelector('#musicBinding');
    if (music) music.textContent = `(${this.commands.keyLabel('music')})`;
  }

  private startCapture(
    action: KeyBindingAction,
    device: BindingDevice,
    button: HTMLButtonElement,
    box: HTMLElement,
  ) {
    this.cancelCapture();
    this.commands.releasePointerLock();
    this.capture = { device, button };
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
        (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') ||
        (event.metaKey && event.code !== 'MetaLeft' && event.code !== 'MetaRight') ||
        (event.altKey && event.code !== 'AltLeft' && event.code !== 'AltRight') ||
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
      this.refreshBindings(box, button);
      this.setStatus(box, `${KEY_BINDING_LABELS[action]} now uses ${event.key}.`);
    };
    this.captureMousedown = (event) => {
      if (
        event.button === 0 &&
        event.target instanceof Element &&
        event.target.closest('#closeSettings')
      )
        return;
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
      this.refreshBindings(box, button);
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
