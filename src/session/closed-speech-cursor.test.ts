import { expect, it } from 'vitest';
import { ClosedSpeechCursor } from './closed-speech-cursor';
import { closedSpan } from '../lesson-stream/core/live-test-fixtures';

it('visits each newly closed canonical span once across growing input and partial updates', () => {
  const cursor = new ClosedSpeechCursor(), spans = Array.from({ length: 1_000 }, (_, i) => closedSpan(`${i}`));
  for (let length = 1; length <= spans.length; length++) {
    const input = spans.slice(0, length);
    let span;
    while ((span = cursor.next(input, 'run'))) cursor.committed(span);
    expect(cursor.next(input, 'run')).toBeUndefined();
  }
  expect(cursor.inspected).toBe(1_000);
});
it('waits at an open tail and recovers safely when input or speech run is replaced', () => {
  const cursor = new ClosedSpeechCursor(), first = closedSpan('first');
  const open = { ...closedSpan('tail'), status: 'open' as const };
  expect(cursor.next([first, open], 'run')).toBe(first); cursor.committed(first);
  expect(cursor.next([first, open], 'run')).toBeUndefined();
  const closed = { ...open, status: 'closed' as const };
  expect(cursor.next([first, closed], 'run')).toBe(closed); cursor.committed(closed);
  expect(cursor.next([first], 'new-run')).toBe(first); cursor.committed(first);
  const replacement = { ...first };
  expect(cursor.next([replacement], 'new-run')).toBe(replacement);
});
