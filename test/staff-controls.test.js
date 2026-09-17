import test from 'node:test';
import assert from 'node:assert/strict';
import { MAGIC } from '../shared/magic.js';
import { staffCastState } from '../public/src/staff-controls.js';

test('staff input allows each spell at its exact cost, regardless of maximum mana', () => {
  for (const element of ['fire', 'frost', 'lightning']) {
    const spell = MAGIC[element];
    const player = { role: 'wizard', staffOwned: true, staffElement: element, mana: spell.mana, manaMax: 130 };
    const ready = staffCastState(player, 10);
    assert.equal(ready.ready, true);
    assert.equal(ready.spell, spell);
    assert.equal(ready.enoughMana, true);
    player.mana = spell.mana - .01;
    assert.equal(staffCastState(player, 10).ready, false);
    player.mana = spell.mana;
    player.staffReadyAt = 10.3;
    assert.equal(staffCastState(player, 10).ready, false);
    assert.equal(staffCastState(player, 10.3).ready, true);
  }
});

test('staff input requires an owned Wizard staff and safely handles lobby or invalid mana', () => {
  assert.equal(staffCastState(null).ready, false);
  const player = { role: 'wizard', staffOwned: true, mana: 40 };
  assert.equal(staffCastState(player).ready, true);
  assert.equal(staffCastState({ ...player, staffOwned: false }).ready, false);
  assert.equal(staffCastState({ ...player, role: 'villager' }).ready, false);
  for (const mana of [undefined, NaN, Infinity, -1]) assert.equal(staffCastState({ ...player, mana }).ready, false);
});
