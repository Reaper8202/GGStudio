import {
  deriveGarageTourProgress,
  type GarageTourSnapshot,
  type GarageTourStep,
  type TutorialPartSpec,
} from '../core/tutorial.ts';
import { startTypewriter } from '../ui/typewriter.ts';

interface TutorialUI {
  /** Exact DOM/canvas marker the current step allows the player to press. */
  tutorialAnchor(step: GarageTourStep): HTMLElement | null;
  /** Reveal, arm, orient, and frame the prescribed target for this step. */
  prepareTutorialStep(step: GarageTourStep): void;
  /** Quiet speech tick after each complete word. */
  playWordSound(): void;
  /** Exact keyboard action currently permitted by tutorial state. */
  allowKey(event: KeyboardEvent): boolean;
}

const CARD_GAP = 14;
const SPOTLIGHT_PAD = 7;
const VIEWPORT_MARGIN = 10;
type Side = 'right' | 'left' | 'top' | 'bottom';

/**
 * Forced first-car coach marks. Capture guards reject every pointer/key action
 * outside the exact bright target; EditorMode repeats the rule before mutation.
 */
export class TutorialOverlay {
  private readonly spotlight = document.createElement('div');
  private readonly arrow = document.createElement('div');
  private readonly card = document.createElement('aside');
  private readonly count = document.createElement('small');
  private readonly title = document.createElement('div');
  private readonly body = document.createElement('p');
  private readonly action = document.createElement('div');
  private readonly nextButton = document.createElement('button');
  private readonly skipButton = document.createElement('button');
  private readonly portrait = document.createElement('div');
  private stepIndex = 0;
  private welcomeAcknowledged = false;
  private latest: GarageTourSnapshot;
  private frame = 0;
  private ringed: HTMLElement | null = null;
  private lastAnchorKey = '';
  private disposed = false;
  private dragging = false;
  private stopTyping: () => void = () => undefined;

  private readonly onResize = (): void => {
    this.lastAnchorKey = '';
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly ui: TutorialUI,
    start: GarageTourSnapshot,
    /** Coached script for the rig being taught, welcome and fight included. */
    private readonly steps: readonly GarageTourStep[],
    /** That rig's recipe, in placement order, Chassis Core first. */
    private readonly specs: readonly TutorialPartSpec[],
    private readonly onSkip: () => void,
  ) {
    this.latest = start;
    this.spotlight.className = 'tutorial-spotlight';
    this.arrow.className = 'tutorial-arrow';
    this.arrow.setAttribute('aria-hidden', 'true');
    this.card.className = 'panel tutorial-coach';
    this.card.setAttribute('role', 'dialog');

    const character = document.createElement('div');
    character.className = 'tutorial-coach__character';
    this.portrait.className = 'tutorial-coach__portrait';
    this.portrait.textContent = '🧑‍🔧';
    this.portrait.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.className = 'tutorial-coach__name';
    name.textContent = 'Roxy Rivet';
    character.append(this.portrait, name);

    const speech = document.createElement('div');
    speech.className = 'tutorial-coach__speech';
    this.count.className = 'tutorial-coach__count';
    this.title.className = 'tutorial-title';
    this.action.className = 'tutorial-coach__action';
    speech.append(this.count, this.title, this.body, this.action);

    const actions = document.createElement('div');
    actions.className = 'tutorial-coach__actions';
    this.skipButton.type = 'button';
    this.skipButton.className = 'tutorial-coach__skip';
    this.skipButton.textContent = 'Skip Tutorial';
    this.skipButton.addEventListener('click', this.onSkipClick);
    this.nextButton.type = 'button';
    this.nextButton.className = 'primary';
    this.nextButton.textContent = 'Let’s Build!';
    this.nextButton.addEventListener('click', this.advance);
    actions.append(this.skipButton, this.nextButton);

    this.card.append(character, speech, actions);
    root.classList.add('tutorial-active');
    root.append(this.spotlight, this.arrow, this.card);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerdown', this.guardPointer, true);
    document.addEventListener('pointerup', this.guardPointer, true);
    document.addEventListener('click', this.guardPointer, true);
    document.addEventListener('contextmenu', this.guardPointer, true);
    document.addEventListener('keydown', this.guardKey, true);
    this.render();
    this.frame = requestAnimationFrame(this.track);
  }

  get index(): number {
    return this.stepIndex;
  }

  get total(): number {
    return this.steps.length;
  }

  get step(): GarageTourStep {
    return this.steps[this.stepIndex];
  }

  /** Switch spotlight from Store source to exact canvas drop target. */
  setDragging(dragging: boolean): void {
    if (this.dragging === dragging) return;
    this.dragging = dragging;
    this.applyRing();
    this.lastAnchorKey = '';
    this.position();
  }

  /** Replace current action line for a within-step rotate phase. */
  setAction(text: string): void {
    this.action.textContent = text;
    this.action.hidden = false;
    this.lastAnchorKey = '';
  }

  update(snapshot: GarageTourSnapshot): void {
    this.latest = snapshot;
    const progress = deriveGarageTourProgress(
      snapshot,
      this.specs,
      this.steps,
      this.welcomeAcknowledged,
    );
    if (!progress.valid || progress.step === null) return;
    if (progress.stepIndex === this.stepIndex) return;
    this.stepIndex = progress.stepIndex;
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.stopTyping();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerdown', this.guardPointer, true);
    document.removeEventListener('pointerup', this.guardPointer, true);
    document.removeEventListener('click', this.guardPointer, true);
    document.removeEventListener('contextmenu', this.guardPointer, true);
    document.removeEventListener('keydown', this.guardKey, true);
    this.nextButton.removeEventListener('click', this.advance);
    this.skipButton.removeEventListener('click', this.onSkipClick);
    this.ringed?.classList.remove('tutorial-ring');
    this.ringed = null;
    this.root.classList.remove('tutorial-active');
    this.spotlight.remove();
    this.arrow.remove();
    this.card.remove();
  }

  /** Debug seam + welcome button. Action steps never advance by narration. */
  readonly advance = (): void => {
    if (this.step.kind !== 'welcome') return;
    this.welcomeAcknowledged = true;
    const progress = deriveGarageTourProgress(
      this.latest,
      this.specs,
      this.steps,
      true,
    );
    if (!progress.valid || progress.step === null) return;
    this.stepIndex = progress.stepIndex;
    this.render();
  };

  private readonly onSkipClick = (): void => this.onSkip();

  private render(): void {
    const step = this.step;
    this.ui.prepareTutorialStep(step);
    this.count.textContent = `Step ${this.stepIndex + 1} of ${this.total}`;
    this.title.textContent = step.title;
    this.action.textContent = step.action ?? '';
    const showAction = step.advance === 'action';
    this.action.hidden = true;
    this.stopTyping();
    this.body.classList.add('is-typing');
    this.stopTyping = startTypewriter(this.body, step.text, {
      onWord: () => this.ui.playWordSound(),
      onCharacter: () => {
        this.lastAnchorKey = '';
      },
      onDone: () => {
        this.body.classList.remove('is-typing');
        this.action.hidden = !showAction;
        this.lastAnchorKey = '';
      },
    });
    this.nextButton.hidden = step.kind !== 'welcome';
    if (step.kind !== 'welcome' && document.activeElement === this.nextButton) {
      this.skipButton.focus();
    }
    this.card.dataset.step = step.id;
    this.applyRing();
    this.lastAnchorKey = '';
    this.position();
  }

  private applyRing(): void {
    this.ringed?.classList.remove('tutorial-ring');
    const anchor = this.ui.tutorialAnchor(this.step);
    this.ringed = anchor;
    anchor?.classList.add('tutorial-ring');
  }

  private readonly track = (): void => {
    this.position();
    this.frame = requestAnimationFrame(this.track);
  };

  private position(): void {
    const anchor = this.ui.tutorialAnchor(this.step);
    const rect = anchor?.getBoundingClientRect();
    const key =
      rect && rect.width > 0 && rect.height > 0
        ? `${this.step.id}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
        : `${this.step.id}:none`;
    if (key === this.lastAnchorKey) return;
    this.lastAnchorKey = key;

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      this.spotlight.hidden = true;
      this.arrow.hidden = true;
      this.centreCard();
      return;
    }

    this.spotlight.hidden = false;
    this.spotlight.style.left = `${rect.left - SPOTLIGHT_PAD}px`;
    this.spotlight.style.top = `${rect.top - SPOTLIGHT_PAD}px`;
    this.spotlight.style.width = `${rect.width + SPOTLIGHT_PAD * 2}px`;
    this.spotlight.style.height = `${rect.height + SPOTLIGHT_PAD * 2}px`;
    const side = this.placeCardBeside(rect);
    this.placeArrow(rect, side);
  }

  private centreCard(): void {
    const card = this.card.getBoundingClientRect();
    this.card.dataset.side = 'centre';
    this.card.style.left = `${Math.round((window.innerWidth - card.width) / 2)}px`;
    this.card.style.top = `${Math.round((window.innerHeight - card.height) / 2)}px`;
  }

  private placeCardBeside(rect: DOMRect): Side {
    const card = this.card.getBoundingClientRect();
    const pad = SPOTLIGHT_PAD + CARD_GAP;
    const room: Record<Side, number> = {
      right: window.innerWidth - rect.right - pad,
      left: rect.left - pad,
      bottom: window.innerHeight - rect.bottom - pad,
      top: rect.top - pad,
    };
    const order: Side[] = ['right', 'left', 'top', 'bottom'];
    const side =
      order.find((candidate) =>
        candidate === 'right' || candidate === 'left'
          ? room[candidate] >= card.width
          : room[candidate] >= card.height,
      ) ??
      order.reduce((best, candidate) =>
        room[candidate] > room[best] ? candidate : best,
      );

    let left: number;
    let top: number;
    if (side === 'right' || side === 'left') {
      left = side === 'right' ? rect.right + pad : rect.left - pad - card.width;
      top = rect.top + rect.height / 2 - card.height / 2;
    } else {
      left = rect.left + rect.width / 2 - card.width / 2;
      top =
        side === 'bottom' ? rect.bottom + pad : rect.top - pad - card.height;
    }
    this.card.dataset.side = side;
    this.card.style.left = `${Math.round(clamp(left, VIEWPORT_MARGIN, window.innerWidth - card.width - VIEWPORT_MARGIN))}px`;
    this.card.style.top = `${Math.round(clamp(top, VIEWPORT_MARGIN, window.innerHeight - card.height - VIEWPORT_MARGIN))}px`;
    return side;
  }

  private placeArrow(rect: DOMRect, cardSide: Side): void {
    this.arrow.hidden = false;
    this.arrow.dataset.side = cardSide;
    this.arrow.textContent =
      cardSide === 'right'
        ? '←'
        : cardSide === 'left'
          ? '→'
          : cardSide === 'bottom'
            ? '↑'
            : '↓';
    this.arrow.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    this.arrow.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  }

  private readonly guardPointer = (event: Event): void => {
    if (this.disposed) return;
    if (
      this.dragging &&
      (event.type === 'pointerup' || event.type === 'pointercancel')
    ) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && this.card.contains(target)) return;
    if (event instanceof MouseEvent) {
      const rect = this.ui.tutorialAnchor(this.step)?.getBoundingClientRect();
      if (
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return;
      }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.card.classList.remove('deny-shake');
    void this.card.offsetWidth;
    this.card.classList.add('deny-shake');
  };

  private readonly guardKey = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.onSkip();
      return;
    }
    if (this.ui.allowKey(event)) return;
    const active = document.activeElement;
    if (
      this.step.kind === 'welcome' &&
      active instanceof Node &&
      this.card.contains(active)
    ) {
      return;
    }
    if (
      active === this.skipButton &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
