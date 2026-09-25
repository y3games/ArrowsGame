import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  canJoin,
  createRoom,
  finishPlaying,
  playersWhoDidNotVote,
  removePlayer,
  startPlaying,
  toSummary,
  voteRematch,
} from '../src/game/room.js';

const a = { id: 'a', nickname: '가' };
const b = { id: 'b', nickname: '나' };
const c = { id: 'c', nickname: '다' };

function fullResultRoom() {
  return finishPlaying(startPlaying(addPlayer(createRoom('r1', a), b)));
}

describe('room', () => {
  it('starts as 1/2 titled after the host', () => {
    expect(toSummary(createRoom('r1', a))).toEqual({
      id: 'r1',
      title: '가의 방',
      players: 1,
      capacity: 2,
      playing: false,
    });
  });

  it('reads 2/2 once a second player joins', () => {
    const room = addPlayer(createRoom('r1', a), b);
    expect(toSummary(room).players).toBe(2);
  });

  it('refuses a third player', () => {
    const full = addPlayer(createRoom('r1', a), b);
    expect(canJoin(full)).toBe(false);
    expect(addPlayer(full, c)).toBe(full);
  });

  it('refuses joins once the match has started, even with a free seat', () => {
    const room = startPlaying(createRoom('r1', a));
    expect(canJoin(room)).toBe(false);
    expect(toSummary(room).playing).toBe(true);
  });

  it('does not seat the same player twice', () => {
    const room = createRoom('r1', a);
    expect(addPlayer(room, a).players).toHaveLength(1);
  });

  it('hands hosting to the remaining player and reopens the room', () => {
    const room = removePlayer(startPlaying(addPlayer(createRoom('r1', a), b)), 'a');
    expect(room.players).toEqual([b]);
    expect(room.phase).toBe('waiting');
    expect(toSummary(room).title).toBe('나의 방');
    expect(canJoin(room)).toBe(true);
  });

  it('starts a rematch only when both players have voted', () => {
    const first = voteRematch(fullResultRoom(), 'a');
    expect(first.start).toBe(false);
    expect(first.room.votes).toEqual(['a']);

    const second = voteRematch(first.room, 'b');
    expect(second.start).toBe(true);
  });

  it('ignores a repeated vote from the same player', () => {
    const once = voteRematch(fullResultRoom(), 'a').room;
    const twice = voteRematch(once, 'a');
    expect(twice.start).toBe(false);
    expect(twice.room.votes).toEqual(['a']);
  });

  it('ignores votes outside the result screen or from strangers', () => {
    const playing = startPlaying(addPlayer(createRoom('r1', a), b));
    expect(voteRematch(playing, 'a').room.votes).toEqual([]);
    expect(voteRematch(fullResultRoom(), 'c').room.votes).toEqual([]);
  });

  it('lists the players who did not vote', () => {
    const room = voteRematch(fullResultRoom(), 'a').room;
    expect(playersWhoDidNotVote(room)).toEqual([b]);
  });

  it('clears votes when a player leaves after voting', () => {
    const voted = voteRematch(fullResultRoom(), 'a').room;
    const left = removePlayer(voted, 'b');
    expect(left.votes).toEqual([]);
    expect(left.phase).toBe('waiting');
  });
});
