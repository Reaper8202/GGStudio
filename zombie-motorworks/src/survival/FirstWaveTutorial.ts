import { startTypewriter } from '../ui/typewriter.ts';

export type FirstWaveTutorialResult = 'completed' | 'skipped';

export interface FirstWaveTutorialOptions {
  /** Touch players get button-specific copy and an arrow aimed at the drive pad. */
  readonly touch: boolean;
  /** Release the paused wave and record how the player left the tutorial. */
  readonly onRelease: (result: FirstWaveTutorialResult) => void;
  /** Quiet speech tick after each complete word. */
  readonly onWord?: () => void;
}

let nextTutorialId = 1;

interface FirstWaveStep {
  readonly title: string;
  readonly desktopText: string;
  readonly touchText: string;
  readonly action: string;
  readonly arrow: 'controls' | 'battlefield' | null;
}

const FIRST_WAVE_STEPS: readonly FirstWaveStep[] = [
  {
    title: 'Drive the car',
    desktopText:
      'Hold W or ↑ to go. Use A and D, or ← and →, to turn. Hold S or ↓ to brake, then back up.',
    touchText:
      'Hold ↑ to go. Hold ← or → to turn. Hold ↓ to brake, then back up.',
    action: 'Next: Blasters',
    arrow: 'controls',
  },
  {
    title: 'Blaster on duty!',
    desktopText:
      'Your Zombie Blaster finds nearby zombies and shoots all by itself. You drive. It does the blasting!',
    touchText:
      'Your Zombie Blaster finds nearby zombies and shoots all by itself. You drive. It does the blasting!',
    action: 'Next: Take Aim',
    arrow: null,
  },
  {
    title: 'You can aim too',
    desktopText:
      'Want to pick a target? Point with the mouse, then hold click or F. Let go and the blaster goes back to auto-fire.',
    touchText:
      'Want to pick a target? Hold a finger on the battlefield and drag to aim. Let go and the blaster goes back to auto-fire.',
    action: 'Let’s Roll!',
    arrow: 'battlefield',
  },
];

/**
 * First-wave controls card. SurvivalMode owns pausing the wave; this class owns
 * only the short explanation, its two exit actions, and their DOM lifecycle.
 */
export class FirstWaveTutorial {
  readonly root: HTMLDivElement;

  private readonly completeButton: HTMLButtonElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLHeadingElement;
  private readonly speech: HTMLParagraphElement;
  private readonly arrow: HTMLDivElement;
  private readonly touch: boolean;
  private readonly onRelease: FirstWaveTutorialOptions['onRelease'];
  private readonly onWord: FirstWaveTutorialOptions['onWord'];
  private stopTyping: () => void = () => undefined;
  private stepIndex = 0;
  private disposed = false;

  private readonly onComplete = (): void => this.advance();
  private readonly onSkip = (): void => this.finish('skipped');
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.finish('skipped');
  };

  constructor(parent: HTMLElement, options: FirstWaveTutorialOptions) {
    this.touch = options.touch;
    this.onRelease = options.onRelease;
    this.onWord = options.onWord;

    const id = nextTutorialId;
    nextTutorialId += 1;
    const titleId = `first-wave-tutorial-title-${id}`;
    const speechId = `first-wave-tutorial-speech-${id}`;

    this.root = document.createElement('div');
    this.root.className = `first-wave-tutorial first-wave-tutorial--${options.touch ? 'touch' : 'desktop'}`;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', titleId);
    this.root.setAttribute('aria-describedby', speechId);
    this.root.addEventListener('keydown', this.onKeyDown);

    const card = document.createElement('section');
    card.className = 'panel first-wave-tutorial__card';

    const character = document.createElement('div');
    character.className = 'first-wave-tutorial__character';
    const portrait = document.createElement('div');
    portrait.className = 'first-wave-tutorial__portrait';
    portrait.textContent = '🧑‍🔧';
    portrait.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.className = 'first-wave-tutorial__name';
    name.textContent = 'Roxy Rivet';
    character.append(portrait, name);

    const copy = document.createElement('div');
    copy.className = 'first-wave-tutorial__copy';
    this.eyebrow = document.createElement('small');
    this.eyebrow.className = 'first-wave-tutorial__eyebrow';
    this.title = document.createElement('h2');
    this.title.className = 'first-wave-tutorial__title';
    this.title.id = titleId;
    this.speech = document.createElement('p');
    this.speech.className = 'first-wave-tutorial__speech';
    this.speech.id = speechId;
    this.speech.setAttribute('aria-live', 'polite');
    this.speech.setAttribute('aria-atomic', 'true');
    copy.append(this.eyebrow, this.title, this.speech);

    this.arrow = document.createElement('div');
    this.arrow.className =
      'first-wave-tutorial__arrow first-wave-tutorial__arrow--touch-controls';
    this.arrow.setAttribute('aria-hidden', 'true');
    this.arrow.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'first-wave-tutorial__actions';
    this.completeButton = document.createElement('button');
    this.completeButton.type = 'button';
    this.completeButton.className = 'primary first-wave-tutorial__complete';
    this.completeButton.addEventListener('click', this.onComplete);
    this.skipButton = document.createElement('button');
    this.skipButton.type = 'button';
    this.skipButton.className = 'first-wave-tutorial__skip';
    this.skipButton.textContent = 'Skip Tutorial';
    this.skipButton.addEventListener('click', this.onSkip);
    actions.append(this.completeButton, this.skipButton);

    card.append(character, copy, actions);
    this.root.append(card, this.arrow);
    parent.appendChild(this.root);
    this.renderStep();
    this.completeButton.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTyping();
    this.completeButton.removeEventListener('click', this.onComplete);
    this.skipButton.removeEventListener('click', this.onSkip);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  private finish(result: FirstWaveTutorialResult): void {
    if (this.disposed) return;
    const release = this.onRelease;
    this.dispose();
    release(result);
  }

  private advance(): void {
    if (this.stepIndex >= FIRST_WAVE_STEPS.length - 1) {
      this.finish('completed');
      return;
    }
    this.stepIndex += 1;
    this.renderStep();
  }

  private renderStep(): void {
    const step = FIRST_WAVE_STEPS[this.stepIndex];
    if (step === undefined) return;

    this.stopTyping();
    this.eyebrow.textContent = `First zombie wave · ${this.stepIndex + 1}/${FIRST_WAVE_STEPS.length}`;
    this.title.textContent = step.title;
    this.completeButton.textContent = step.action;
    this.root.dataset.step = String(this.stepIndex + 1);
    this.root.dataset.target = step.arrow ?? '';

    const showArrow =
      step.arrow === 'battlefield' || (step.arrow === 'controls' && this.touch);
    this.arrow.hidden = !showArrow;
    this.arrow.textContent = step.arrow === 'battlefield' ? '↗' : '↙';
    this.arrow.className = `first-wave-tutorial__arrow first-wave-tutorial__arrow--${step.arrow ?? 'none'}`;

    const text = this.touch ? step.touchText : step.desktopText;
    this.speech.classList.add('is-typing');
    this.stopTyping = startTypewriter(this.speech, text, {
      onWord: this.onWord,
      onDone: () => this.speech.classList.remove('is-typing'),
    });
  }
}
