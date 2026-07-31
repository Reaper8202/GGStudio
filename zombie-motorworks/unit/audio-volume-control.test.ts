import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioVolumeControl } from '../src/ui/audioVolumeControl.ts';

class FakeElement {
  className = '';
  textContent: string | null = null;
  type = '';
  min = '';
  max = '';
  step = '';
  value = '';
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function installFakeDocument(): void {
  vi.stubGlobal('document', {
    createElement: () => new FakeElement(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('audio volume control', () => {
  it('builds an accessible range while preserving caller class hooks', () => {
    installFakeDocument();
    const control = createAudioVolumeControl({
      label: 'Sound effects',
      classes: {
        row: 'settings-row',
        label: 'settings-label',
        input: 'settings-range',
        output: 'settings-value',
      },
      initialPercent: 65,
    });

    const row = control.row as unknown as FakeElement;
    const input = control.input as unknown as FakeElement;
    const output = control.output as unknown as FakeElement;
    expect(row.className).toBe('settings-row');
    expect(row.children.map((child) => child.className)).toEqual([
      'settings-label',
      'settings-range',
      'settings-value',
    ]);
    expect(input).toMatchObject({
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: '65',
    });
    expect(input.attributes.get('aria-label')).toBe('Sound effects volume');
    expect(input.attributes.get('aria-valuetext')).toBe('65%');
    expect(output.value).toBe('65%');
    expect(output.attributes.get('aria-hidden')).toBe('true');
  });

  it('rounds and clamps values before synchronising the input and output', () => {
    installFakeDocument();
    const control = createAudioVolumeControl({
      label: 'Music',
      classes: { row: 'row', input: 'input', output: 'output' },
    });

    control.setPercent(101.8);
    expect(control.input.value).toBe('100');
    expect(control.output.value).toBe('100%');

    control.setPercent(-4);
    expect(control.input.value).toBe('0');
    expect(control.output.value).toBe('0%');
  });
});
