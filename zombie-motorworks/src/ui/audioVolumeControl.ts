export interface AudioVolumeControlClasses {
  row: string;
  label?: string;
  input: string;
  output: string;
}

export interface AudioVolumeControl {
  row: HTMLLabelElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  setPercent(percent: number): void;
}

export interface AudioVolumeControlOptions {
  label: string;
  classes: AudioVolumeControlClasses;
  initialPercent?: number;
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/**
 * Builds the shared labelled range row used by audio settings dialogs.
 * Callers supply their existing class hooks so each screen keeps its layout.
 */
export function createAudioVolumeControl(
  options: AudioVolumeControlOptions,
): AudioVolumeControl {
  const row = document.createElement('label');
  row.className = options.classes.row;

  const label = document.createElement('span');
  if (options.classes.label !== undefined) {
    label.className = options.classes.label;
  }
  label.textContent = options.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.className = options.classes.input;
  input.setAttribute('aria-label', `${options.label} volume`);

  const output = document.createElement('output');
  output.className = options.classes.output;
  // The range already exposes its current value to assistive technology.
  // Keeping the visual duplicate out of the label prevents a noisy name such
  // as "Music 75%" from changing on every adjustment.
  output.setAttribute('aria-hidden', 'true');

  const control: AudioVolumeControl = {
    row,
    input,
    output,
    setPercent(percent: number): void {
      const next = clampPercent(percent);
      input.value = String(next);
      input.setAttribute('aria-valuetext', `${next}%`);
      output.value = `${next}%`;
    },
  };

  control.setPercent(options.initialPercent ?? 100);
  row.append(label, input, output);
  return control;
}
