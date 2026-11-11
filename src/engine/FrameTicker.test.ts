import { describe, expect, it } from "vitest";
import { FrameTicker } from "./FrameTicker";

describe("FrameTicker", () => {
  it("initializes with default 30 FPS", () => {
    const ticker = new FrameTicker();
    expect(ticker.fpsCap).toBe(30);
    expect(ticker.targetInterval).toBeCloseTo(1000 / 30, 2);
    expect(ticker.isPaused).toBe(false);
  });

  it("throws if fpsCap is zero or negative", () => {
    expect(() => new FrameTicker({ fpsCap: 0 })).toThrow(RangeError);
    expect(() => new FrameTicker({ fpsCap: -10 })).toThrow(RangeError);
  });

  it("allows updating fpsCap dynamically", () => {
    const ticker = new FrameTicker({ fpsCap: 30 });
    ticker.setFpsCap(60);
    expect(ticker.fpsCap).toBe(60);
    expect(ticker.targetInterval).toBeCloseTo(1000 / 60, 2);

    expect(() => ticker.setFpsCap(0)).toThrow(RangeError);
  });

  it("renders on the first tick and starts timing", () => {
    const ticker = new FrameTicker({ fpsCap: 30 });
    const first = ticker.tick(100);
    expect(first.shouldRender).toBe(true);
    expect(first.dt).toBe(0);
  });

  it("skips frames when ticked faster than fpsCap", () => {
    const ticker = new FrameTicker({ fpsCap: 30 }); // ~33.33ms interval
    ticker.tick(0); // first tick

    // 16ms later (~60Hz RAF tick)
    const second = ticker.tick(16);
    expect(second.shouldRender).toBe(false);
    expect(second.dt).toBe(0);

    // 34ms after start (34 >= 33.33)
    const third = ticker.tick(34);
    expect(third.shouldRender).toBe(true);
    expect(third.dt).toBeCloseTo(0.034, 3);
  });

  it("caps frames over time to the desired frame rate", () => {
    const ticker = new FrameTicker({ fpsCap: 30 });
    let renderCount = 0;

    // Simulate 1000ms with a 120Hz display (every ~8.33ms)
    for (let t = 0; t <= 1000; t += 8.33) {
      const res = ticker.tick(t);
      if (res.shouldRender) {
        renderCount++;
      }
    }

    // 1000ms at 30 FPS should produce ~30-31 rendered frames (including frame 0)
    expect(renderCount).toBeGreaterThanOrEqual(30);
    expect(renderCount).toBeLessThanOrEqual(32);
  });

  it("clamps delta time to maxDelta during sudden stalls", () => {
    const ticker = new FrameTicker({ fpsCap: 30, maxDelta: 0.1 });
    ticker.tick(0);

    // 5 seconds later
    const result = ticker.tick(5000);
    expect(result.shouldRender).toBe(true);
    expect(result.dt).toBe(0.1);
  });

  it("does not render when paused and resumes cleanly", () => {
    const ticker = new FrameTicker({ fpsCap: 30 });
    ticker.tick(0);

    ticker.pause();
    expect(ticker.isPaused).toBe(true);

    const pausedTick = ticker.tick(100);
    expect(pausedTick.shouldRender).toBe(false);

    ticker.resume();
    expect(ticker.isPaused).toBe(false);

    // After resume, next tick resets timing and renders without huge dt
    const resumeTick = ticker.tick(200);
    expect(resumeTick.shouldRender).toBe(true);
    expect(resumeTick.dt).toBe(0);
  });
});
