import { TUTORIAL_STEPS, tutorialProgress, type GetDef } from '../core/tutorial.ts';
import type { VehicleBlueprint } from '../core/types.ts';

interface TutorialUI {
  highlightPaletteButton(defId: string | null): void;
}

/** Small DOM guide that mirrors the pure tutorial state machine. */
export class TutorialOverlay {
  private readonly panel = document.createElement('div');

  constructor(
    root: HTMLElement,
    private readonly ui: TutorialUI,
    private readonly onExit: () => void,
  ) {
    this.panel.className = 'panel tutorial-panel';
    root.classList.add('tutorial-active');
    root.appendChild(this.panel);
  }

  update(bp: VehicleBlueprint, getDef: GetDef): void {
    const stepIndex = tutorialProgress(bp, getDef);
    this.panel.replaceChildren();

    if (stepIndex === TUTORIAL_STEPS.length) {
      const message = document.createElement('div');
      message.textContent = 'You built a truck. Press the green TEST DRIVE button.';
      this.panel.appendChild(message);
      this.ui.highlightPaletteButton(null);
      return;
    }

    const step = TUTORIAL_STEPS[stepIndex];
    const count = document.createElement('small');
    count.textContent = `Step ${stepIndex + 1} of ${TUTORIAL_STEPS.length}`;
    const title = document.createElement('div');
    title.className = 'tutorial-title';
    title.textContent = step.title;
    const text = document.createElement('div');
    text.textContent = step.text;
    const skip = document.createElement('button');
    skip.textContent = 'Skip Tutorial';
    skip.addEventListener('click', this.onExit);
    this.panel.append(count, title, text, skip);
    this.ui.highlightPaletteButton(step.paletteDefId ?? null);
  }

  dispose(): void {
    this.ui.highlightPaletteButton(null);
    this.panel.parentElement?.classList.remove('tutorial-active');
    this.panel.remove();
  }
}
