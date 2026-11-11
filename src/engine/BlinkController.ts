export type BlinkState = "open" | "closing" | "closed" | "opening";

export interface BlinkControllerOptions {
  /**
   * Minimum random delay (in seconds) between blinks.
   * @default 2.0
   */
  minInterval?: number;

  /**
   * Maximum random delay (in seconds) between blinks.
   * @default 6.0
   */
  maxInterval?: number;

  /**
   * Duration (in seconds) for eyelids to close.
   * @default 0.06 (60 ms)
   */
  closingDuration?: number;

  /**
   * Duration (in seconds) for eyelids to remain fully closed.
   * @default 0.04 (40 ms)
   */
  closedDuration?: number;

  /**
   * Duration (in seconds) for eyelids to open back up.
   * @default 0.08 (80 ms)
   */
  openingDuration?: number;

  /**
   * Probability (0.0 to 1.0) of triggering a rapid double blink after opening.
   * @default 0.15 (15%)
   */
  doubleBlinkChance?: number;

  /**
   * Delay (in seconds) between the first and second blink in a double blink sequence.
   * @default 0.1 (100 ms)
   */
  doubleBlinkDelay?: number;

  /**
   * Custom pseudo-random number generator producing values in [0, 1).
   * Defaults to Math.random. Useful for deterministic unit testing.
   */
  random?: () => number;
}

/**
 * Procedural blink state machine controller.
 * Cycles through: open -> closing (60ms) -> closed (40ms) -> opening (80ms) -> open.
 * Evaluates random intervals (2-6s) and 15% probability of double blinking.
 */
export class BlinkController {
  public readonly minInterval: number;
  public readonly maxInterval: number;
  public readonly closingDuration: number;
  public readonly closedDuration: number;
  public readonly openingDuration: number;
  public readonly doubleBlinkChance: number;
  public readonly doubleBlinkDelay: number;
  private readonly rng: () => number;

  private _state: BlinkState = "open";
  private _value = 0;
  private _elapsedInState = 0;
  private _nextInterval = 0;
  private _isDoubleBlink = false;

  constructor(options: BlinkControllerOptions = {}) {
    this.minInterval = Math.max(0, options.minInterval ?? 2.0);
    this.maxInterval = Math.max(this.minInterval, options.maxInterval ?? 6.0);
    this.closingDuration = Math.max(0.001, options.closingDuration ?? 0.06);
    this.closedDuration = Math.max(0.001, options.closedDuration ?? 0.04);
    this.openingDuration = Math.max(0.001, options.openingDuration ?? 0.08);
    this.doubleBlinkChance = Math.min(
      1,
      Math.max(0, options.doubleBlinkChance ?? 0.15)
    );
    this.doubleBlinkDelay = Math.max(0.001, options.doubleBlinkDelay ?? 0.1);
    this.rng = options.random ?? Math.random;

    this.reset();
  }

  /** Current phase of the blink animation */
  public get state(): BlinkState {
    return this._state;
  }

  /** Current normalized blink weight in [0, 1] */
  public get value(): number {
    return this._value;
  }

  /** Time elapsed in the current state in seconds */
  public get elapsedInState(): number {
    return this._elapsedInState;
  }

  /** Scheduled interval until the next blink starts */
  public get nextInterval(): number {
    return this._nextInterval;
  }

  /** Whether the current or upcoming blink is the second of a double-blink pair */
  public get isDoubleBlink(): boolean {
    return this._isDoubleBlink;
  }

  /**
   * Resets the controller back to the 'open' state with fresh intervals.
   */
  public reset(): void {
    this._state = "open";
    this._value = 0;
    this._elapsedInState = 0;
    this._isDoubleBlink = false;
    this._nextInterval = this.computeRandomInterval();
  }

  /**
   * Immediately triggers a blink transition if the eyes are currently open.
   */
  public triggerBlink(): void {
    if (this._state === "open") {
      this._state = "closing";
      this._elapsedInState = 0;
      this._value = 0;
    }
  }

  /**
   * Steps the state machine forward by delta time `dt` seconds.
   * @param dt Elapsed time in seconds.
   * @returns Current blink expression weight in [0, 1].
   */
  public update(dt: number): number {
    if (dt <= 0) {
      return this._value;
    }

    let remaining = dt;
    // Guard against potential infinite loops on unusually large dt steps
    let iterations = 0;
    const maxIterations = 20;

    while (remaining > 0 && iterations < maxIterations) {
      iterations++;

      if (this._state === "open") {
        const timeNeeded = this._nextInterval - this._elapsedInState;
        if (remaining < timeNeeded) {
          this._elapsedInState += remaining;
          remaining = 0;
          this._value = 0;
        } else {
          remaining -= timeNeeded;
          this._state = "closing";
          this._elapsedInState = 0;
          this._value = 0;
        }
      } else if (this._state === "closing") {
        const timeNeeded = this.closingDuration - this._elapsedInState;
        if (remaining < timeNeeded) {
          this._elapsedInState += remaining;
          remaining = 0;
          this._value = Math.min(
            1,
            Math.max(0, this._elapsedInState / this.closingDuration)
          );
        } else {
          remaining -= timeNeeded;
          this._state = "closed";
          this._elapsedInState = 0;
          this._value = 1;
        }
      } else if (this._state === "closed") {
        const timeNeeded = this.closedDuration - this._elapsedInState;
        if (remaining < timeNeeded) {
          this._elapsedInState += remaining;
          remaining = 0;
          this._value = 1;
        } else {
          remaining -= timeNeeded;
          this._state = "opening";
          this._elapsedInState = 0;
          this._value = 1;
        }
      } else if (this._state === "opening") {
        const timeNeeded = this.openingDuration - this._elapsedInState;
        if (remaining < timeNeeded) {
          this._elapsedInState += remaining;
          remaining = 0;
          this._value = Math.min(
            1,
            Math.max(0, 1 - this._elapsedInState / this.openingDuration)
          );
        } else {
          remaining -= timeNeeded;
          this._state = "open";
          this._elapsedInState = 0;
          this._value = 0;

          // Decide if a double blink occurs
          if (!this._isDoubleBlink && this.rng() < this.doubleBlinkChance) {
            this._isDoubleBlink = true;
            this._nextInterval = this.doubleBlinkDelay;
          } else {
            this._isDoubleBlink = false;
            this._nextInterval = this.computeRandomInterval();
          }
        }
      }
    }

    return this._value;
  }

  private computeRandomInterval(): number {
    return (
      this.minInterval + this.rng() * (this.maxInterval - this.minInterval)
    );
  }
}
