import { expect, it } from 'vitest';
import { EventEmitter } from '../src/EventEmitter';

it('delivers synchronously with typed data and keeps scene instances independent', () => {
  const first = new EventEmitter<{ begin: { owner: object } }>();
  const second = new EventEmitter<{ begin: { owner: object } }>();
  const owner = {}, seen: object[] = [];
  const stop = first.on('begin', event => seen.push(event.owner));
  second.emit('begin', { owner });
  expect(seen).toEqual([]);
  first.emit('begin', { owner });
  expect(seen).toEqual([owner]);
  stop(); stop();
  first.emit('begin', { owner });
  expect(seen).toEqual([owner]);
});

it('honors removal during dispatch and defers new listeners until the next event', () => {
  const events = new EventEmitter<{ interrupt: string }>();
  const seen: string[] = [];
  const late = (reason: string) => seen.push(`late:${reason}`);
  let stopOld = () => {};
  events.on('interrupt', reason => {
    seen.push(`first:${reason}`);
    stopOld();
    events.on('interrupt', late);
  });
  stopOld = events.on('interrupt', reason => seen.push(`old:${reason}`));
  events.emit('interrupt', 'select');
  expect(seen).toEqual(['first:select']);
  events.emit('interrupt', 'craft');
  expect(seen).toEqual(['first:select', 'first:craft', 'late:craft']);
  events.off('interrupt', late);
});
