import { countReps } from './proofs.service.js';

const cycle = (low: number, high: number) => [high, (high + low) / 2, low, (high + low) / 2, high];

describe('server-side rep counting', () => {
  it('counts full push-up cycles', () => {
    expect(countReps(Array.from({ length: 10 }, () => cycle(70, 170)).flat(), 'pushups')).toBe(10);
  });

  it('ignores half reps that never go low enough', () => {
    expect(countReps(Array.from({ length: 10 }, () => cycle(110, 170)).flat(), 'pushups')).toBe(0);
  });

  it('needs hysteresis: jitter around one threshold is one rep at most', () => {
    expect(countReps([170, 85, 95, 85, 95, 85, 160], 'pushups')).toBe(1);
  });
});
