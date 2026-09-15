export const GUARD_ORDERS = Object.freeze({
  defend: Object.freeze({ label: 'Defend the gate', color: 0xd6b568 }),
  hold: Object.freeze({ label: 'Hold position', color: 0x65c3dd }),
  follow: Object.freeze({ label: 'Follow me', color: 0x86c989 }),
  retreat: Object.freeze({ label: 'Retreat to barracks', color: 0xe79a72 })
});

export const GUARD_ORDER_RULES = Object.freeze({
  acquireRange: 12, holdLeash: 8, followLeash: 9, retreatLeash: 3
});
