export interface FrameTickerOptions {
  /**
   * Maximum target frames per second. Defaults to 30.
   */
  fpsCap?: number;

  /**
   * Maximum allowable delta time in seconds to prevent jumps after lag.
   * Defaults to 0.1s (100ms).
   */
  maxDelta?: number;
}

export interface FrameTickResult {
  shouldRender: boolean;
  dt: number;
}

/**
 * Pure frame rate limiter and delta time calculator.
 * Decoupled from DOM/window and fully unit-testable.
 */
export class FrameTicker {
  private _fpsCap: number;
  private _targetInterval: number;
  private _maxDelta: number;
  private _lastFrameTime: number | null = null;
  private _isPaused = false;

  constructor(options: FrameTickerOptions = {}) {
    const fps = options.fpsCap ?? 30;
    if (fps <= 0) {
      throw new RangeError("fpsCap must be greater than 0");
    }
    this._fpsCap = fps;
    this._targetInterval = 1000 / fps;
    this._maxDelta = options.maxDelta ?? 0.1;
  }

  public get fpsCap(): number {
    return this._fpsCap;
  }

  public setFpsCap(fps: number): void {
    if (fps <= 0) {
      throw new RangeError("fpsCap must be greater than 0");
    }
    this._fpsCap = fps;
    this._targetInterval = 1000 / fps;
  }

  public get targetInterval(): number {
    return this._targetInterval;
  }

  public get isPaused(): boolean {
    return this._isPaused;
  }

  public pause(): void {
    this._isPaused = true;
  }

  public resume(): void {
    this._isPaused = false;
    this._lastFrameTime = null;
  }

  public reset(): void {
    this._lastFrameTime = null;
  }

  /**
   * Evaluates whether a frame should be rendered given the current timestamp in milliseconds.
   * @param now Current timestamp in milliseconds (e.g. from performance.now() or RAF timestamp).
   * @returns Object indicating whether to render and the delta time in seconds.
   */
  public tick(now: number): FrameTickResult {
    if (this._isPaused) {
      return { shouldRender: false, dt: 0 };
    }

    if (this._lastFrameTime === null) {
      this._lastFrameTime = now;
      return { shouldRender: true, dt: 0 };
    }

    const elapsed = now - this._lastFrameTime;
    if (elapsed < this._targetInterval) {
      return { shouldRender: false, dt: 0 };
    }

    const rawDt = elapsed / 1000;
    const dt = Math.min(rawDt, this._maxDelta);

    if (elapsed >= this._targetInterval * 3) {
      this._lastFrameTime = now;
    } else {
      this._lastFrameTime = now - (elapsed % this._targetInterval);
    }

    return { shouldRender: true, dt };
  }
}
