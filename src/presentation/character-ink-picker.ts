import { CHARACTER_INKS, characterColor, type CharacterColor } from '../shared/character-color.js';
import { inkCss } from './ink/palette.js';

const colors = [
  ['original', 'Original red'],
  ['blue', 'Blue'],
  ['graphite', 'Graphite'],
  ['green', 'Green'],
] as const satisfies ReadonlyArray<readonly [CharacterColor, string]>;

function swatchStyle(color: CharacterColor): string {
  const ink = CHARACTER_INKS[color];
  return `--ink-light:${inkCss(ink, 'light')};--ink-dark:${inkCss(ink, 'dark')}`;
}

export function characterInkPickerHTML(selected: CharacterColor) {
  const options = colors.map(
    ([color, label]) => `<label class="ink-option" title="${label}">
      <input type="radio" name="characterColor" value="${color}" aria-label="${label}" ${color === selected ? 'checked' : ''}>
      <span style="${swatchStyle(color)}" aria-hidden="true"></span>
    </label>`,
  );
  return `<fieldset class="character-ink" id="characterInk">
    <legend>Character ink</legend>
    <div class="ink-options">
      ${options.join('')}
      <span class="ink-preview" style="${swatchStyle(selected)}" aria-hidden="true"></span>
    </div>
  </fieldset>`;
}

export function wireCharacterInkPicker(panel: ParentNode, select: (color: CharacterColor) => void) {
  const picker = panel.querySelector('#characterInk');
  const preview = picker?.querySelector<HTMLElement>('.ink-preview');
  picker?.addEventListener('change', (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement) || !option.checked) return;
    const color = characterColor(option.value);
    select(color);
    if (preview) preview.style.cssText = swatchStyle(color);
  });
}
