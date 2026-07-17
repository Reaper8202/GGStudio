export interface TitleScreenHandlers {
  onNewGame(): void;
  onContinue(): void;
}

/** DOM-only boot screen. It owns and removes every listener it installs. */
export class TitleScreen {
  readonly root = document.createElement('section');

  private readonly newGameButton = document.createElement('button');
  private readonly continueButton = document.createElement('button');
  private readonly confirmation = document.createElement('div');
  private readonly confirmButton = document.createElement('button');
  private readonly cancelButton = document.createElement('button');
  private disposed = false;

  private readonly onNewGameClick = (): void => {
    this.requestNewGame();
  };

  private readonly onContinueClick = (): void => {
    this.continueGame();
  };

  private readonly onConfirmClick = (): void => {
    if (this.disposed) return;
    this.handlers.onNewGame();
  };

  private readonly onCancelClick = (): void => {
    if (this.disposed) return;
    this.confirmation.hidden = true;
    this.newGameButton.disabled = false;
    this.continueButton.disabled = !this.hasSave;
  };

  constructor(
    container: HTMLElement,
    private readonly hasSave: boolean,
    private readonly handlers: TitleScreenHandlers,
  ) {
    this.root.className = 'title-screen';
    this.root.setAttribute('aria-labelledby', 'game-title');

    const panel = document.createElement('div');
    panel.className = 'panel title-panel';

    const kicker = document.createElement('div');
    kicker.className = 'title-kicker';
    kicker.textContent = 'SCRAP. BUILD. SURVIVE.';

    const title = document.createElement('h1');
    title.id = 'game-title';
    title.textContent = 'ZOMBIE MOTORWORKS';

    const subtitle = document.createElement('p');
    subtitle.className = 'title-subtitle';
    subtitle.textContent = 'Build the last ride out of the graveyard.';

    const actions = document.createElement('div');
    actions.className = 'title-actions';

    this.newGameButton.type = 'button';
    this.newGameButton.className = 'primary title-action';
    this.newGameButton.textContent = 'New Game';

    this.continueButton.type = 'button';
    this.continueButton.className = 'title-action';
    this.continueButton.textContent = 'Continue';
    this.continueButton.hidden = !hasSave;
    this.continueButton.disabled = !hasSave;

    actions.append(this.newGameButton, this.continueButton);

    this.confirmation.className = 'title-confirm';
    this.confirmation.hidden = true;
    const warning = document.createElement('p');
    warning.textContent =
      'This erases your garage, money and unlocks. Start over?';
    const confirmActions = document.createElement('div');
    confirmActions.className = 'title-confirm-actions';

    this.confirmButton.type = 'button';
    this.confirmButton.className = 'danger';
    this.confirmButton.textContent = 'Confirm';
    this.cancelButton.type = 'button';
    this.cancelButton.textContent = 'Cancel';
    confirmActions.append(this.confirmButton, this.cancelButton);
    this.confirmation.append(warning, confirmActions);

    panel.append(kicker, title, subtitle, actions, this.confirmation);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.newGameButton.addEventListener('click', this.onNewGameClick);
    this.continueButton.addEventListener('click', this.onContinueClick);
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    this.cancelButton.addEventListener('click', this.onCancelClick);
  }

  /** Starts immediately for a fresh profile, or asks before replacing a save. */
  requestNewGame(): boolean {
    if (this.disposed) return false;
    if (this.hasSave) {
      this.confirmation.hidden = false;
      this.newGameButton.disabled = true;
      this.continueButton.disabled = true;
      return false;
    }
    this.handlers.onNewGame();
    return true;
  }

  continueGame(): boolean {
    if (this.disposed || !this.hasSave) return false;
    this.handlers.onContinue();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.newGameButton.removeEventListener('click', this.onNewGameClick);
    this.continueButton.removeEventListener('click', this.onContinueClick);
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.cancelButton.removeEventListener('click', this.onCancelClick);
    this.root.remove();
  }
}
