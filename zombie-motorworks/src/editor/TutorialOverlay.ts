import {
  advanceGarageTour,
  GARAGE_TOUR_STEPS,
  type GarageTourSnapshot,
  type GarageTourStep,
  type TourAnchor,
} from '../core/tutorial.ts';

interface TutorialUI {
  /** Element a tour step points at, or null when it is not on screen. */
  tourAnchor(anchor: TourAnchor): HTMLElement | null;
  /** Un-collapse the Store so a store-anchored step has something to spotlight. */
  openStorePanel(): void;
  highlightPaletteButton(defId: string | null): void;
}

/** Gap between the spotlight ring and the coach card, in CSS pixels. */
const CARD_GAP = 14;
/** How far the spotlight ring is inflated past the element it frames. */
const SPOTLIGHT_PAD = 6;
/** Keep the card off the very edge of the window. */
const VIEWPORT_MARGIN = 10;

type Side = 'right' | 'left' | 'top' | 'bottom';

/**
 * Coach-mark tour of the garage: a dimming spotlight over one panel at a time
 * with a card beside it. Narration steps advance on a button; action steps
 * advance when `update` is fed a garage state that satisfies them.
 *
 * The spotlight is a transparent box whose enormous outer shadow does the
 * dimming, so the framed panel needs no z-index games to stay bright and stays
 * clickable — the player has to reach the Store and the truck through it.
 */
export class TutorialOverlay {
  private readonly spotlight = document.createElement('div');
  private readonly card = document.createElement('aside');
  private readonly count = document.createElement('small');
  private readonly title = document.createElement('div');
  private readonly body = document.createElement('p');
  private readonly action = document.createElement('div');
  private readonly nextButton = document.createElement('button');
  private readonly actions = document.createElement('div');
  private stepIndex = 0;
  private latest: GarageTourSnapshot;
  private frame = 0;
  /** Element currently wearing the scrim-free frame, so it can be taken off. */
  private ringed: HTMLElement | null = null;
  /** Last rect the card was laid out against; skips redundant style writes. */
  private lastAnchorKey = '';
  private readonly onResize = (): void => {
    this.lastAnchorKey = '';
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly ui: TutorialUI,
    /** Garage state when the tour opened; action steps are measured from it. */
    private readonly start: GarageTourSnapshot,
    private readonly onExit: () => void,
  ) {
    this.latest = start;

    this.spotlight.className = 'tutorial-spotlight';
    this.card.className = 'panel tutorial-coach';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');

    this.count.className = 'tutorial-coach__count';
    this.title.className = 'tutorial-title';
    this.action.className = 'tutorial-coach__action';
    this.actions.className = 'tutorial-coach__actions';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'tutorial-coach__skip';
    skip.textContent = 'Skip tour';
    skip.addEventListener('click', this.onExit);
    this.nextButton.type = 'button';
    this.nextButton.className = 'primary';
    this.nextButton.addEventListener('click', () => this.advance());
    this.actions.append(skip, this.nextButton);

    this.card.append(this.count, this.title, this.body, this.action, this.actions);
    root.classList.add('tutorial-active');
    root.append(this.spotlight, this.card);

    window.addEventListener('resize', this.onResize);
    this.render();
    this.frame = requestAnimationFrame(this.track);
  }

  /** Step the tour is showing; the seam reports it for tests. */
  get index(): number {
    return this.stepIndex;
  }

  get total(): number {
    return GARAGE_TOUR_STEPS.length;
  }

  /** Feed the latest garage state; satisfied action steps fall through. */
  update(snapshot: GarageTourSnapshot): void {
    this.latest = snapshot;
    const next = advanceGarageTour(this.stepIndex, snapshot, this.start);
    if (next === this.stepIndex) {
      // Even a step that did not advance can change — the Fight button only
      // lights up once the rig validates.
      this.renderActionState();
      return;
    }
    this.stepIndex = next;
    this.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.onResize);
    this.ui.highlightPaletteButton(null);
    this.ringed?.classList.remove('tutorial-ring');
    this.ringed = null;
    this.root.classList.remove('tutorial-active');
    this.spotlight.remove();
    this.card.remove();
  }

  /** Advance past a narration step. Past the last one the tour is over. */
  advance(): void {
    if (this.stepIndex >= GARAGE_TOUR_STEPS.length - 1) {
      this.onExit();
      return;
    }
    this.stepIndex += 1;
    this.stepIndex = advanceGarageTour(this.stepIndex, this.latest, this.start);
    if (this.stepIndex >= GARAGE_TOUR_STEPS.length) {
      this.onExit();
      return;
    }
    this.render();
  }

  private step(): GarageTourStep {
    const clamped = Math.min(this.stepIndex, GARAGE_TOUR_STEPS.length - 1);
    return GARAGE_TOUR_STEPS[clamped];
  }

  private render(): void {
    const step = this.step();
    if (step.anchor === 'store') this.ui.openStorePanel();
    this.count.textContent = `Step ${Math.min(this.stepIndex, GARAGE_TOUR_STEPS.length - 1) + 1} of ${GARAGE_TOUR_STEPS.length}`;
    this.title.textContent = step.title;
    this.body.textContent = step.text;
    this.card.dataset.step = step.id;
    this.applyRing(step);
    this.nextButton.hidden = step.advance !== 'next';
    this.nextButton.textContent =
      this.stepIndex >= GARAGE_TOUR_STEPS.length - 1 ? 'Done' : 'Next';
    this.renderActionState();
    // A fresh card is a different size, so the placement has to be recomputed.
    this.lastAnchorKey = '';
    this.position();
  }

  /**
   * A `dim: false` step gets no scrim element at all — the anchor wears its own
   * pulsing frame instead. Suppressing the whole element rather than restyling
   * it is what guarantees nothing can darken the truck the player is aiming at.
   */
  private applyRing(step: GarageTourStep): void {
    this.ringed?.classList.remove('tutorial-ring');
    this.ringed = null;
    if (step.dim !== false) return;
    const anchor = this.ui.tourAnchor(step.anchor);
    if (!anchor) return;
    anchor.classList.add('tutorial-ring');
    this.ringed = anchor;
  }

  /** The imperative line under the body, plus its blocked-reason footnote. */
  private renderActionState(): void {
    const step = this.step();
    this.action.hidden = step.advance !== 'action';
    if (step.advance !== 'action') return;
    const blocked =
      step.id === 'fight' && !this.latest.canFight
        ? ' — finish the truck first: it still fails its build check.'
        : '';
    this.action.textContent = `${step.action ?? ''}${blocked}`;
    this.action.classList.toggle('is-blocked', blocked !== '');
  }

  /** Follows the anchor every frame: panels collapse, scroll, and reflow. */
  private readonly track = (): void => {
    this.position();
    this.frame = requestAnimationFrame(this.track);
  };

  private position(): void {
    const step = this.step();
    const anchor =
      step.anchor === 'viewport' ? null : this.ui.tourAnchor(step.anchor);
    const rect = anchor?.getBoundingClientRect();
    const key =
      rect && rect.width > 0 && rect.height > 0
        ? `${step.id}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
        : `${step.id}:none`;
    if (key === this.lastAnchorKey) return;
    this.lastAnchorKey = key;

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      this.spotlight.hidden = true;
      this.centreCard();
      return;
    }
    // A ring step frames its anchor in place, so the scrim stays off entirely.
    if (step.dim === false) {
      this.spotlight.hidden = true;
      this.placeCardBeside(rect);
      return;
    }
    this.spotlight.hidden = false;
    this.spotlight.style.left = `${rect.left - SPOTLIGHT_PAD}px`;
    this.spotlight.style.top = `${rect.top - SPOTLIGHT_PAD}px`;
    this.spotlight.style.width = `${rect.width + SPOTLIGHT_PAD * 2}px`;
    this.spotlight.style.height = `${rect.height + SPOTLIGHT_PAD * 2}px`;
    this.placeCardBeside(rect);
  }

  private centreCard(): void {
    const card = this.card.getBoundingClientRect();
    this.card.dataset.side = 'centre';
    this.card.style.left = `${Math.round((window.innerWidth - card.width) / 2)}px`;
    this.card.style.top = `${Math.round((window.innerHeight - card.height) / 2)}px`;
  }

  /**
   * Park the card on whichever side of the anchor it actually fits, preferring
   * horizontal placement so a spotlit dock panel keeps its full height clear.
   */
  private placeCardBeside(rect: DOMRect): void {
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
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
