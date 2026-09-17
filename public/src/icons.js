const paths={
bow:'M6 3c16 3 16 15 0 18L9 12ZM3 12h18m-4-3 4 3-4 3',
musket:'m3 20 4-6 3 1 10-12 2 2-11 13-4-1-2 5Zm7-5 3 3m0-7 2 2',
sulfur:'m3 18 3-9 5 2 4-8 6 14-8 5Zm3-9 3 8 6-14m-6 14 12 0',
gunpowder:'M8 5h8l1 4 3 5v7H4v-7l3-5ZM8 2h8v3H8Zm-1 14h10m-8-3h6',
musket_ammo:'M5 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0Zm6 10a4 4 0 1 0 8 0 4 4 0 1 0-8 0Z',
sword:'M5 20 18 7m-7 11-5-5m8-3 5-7 2 1-1 5-5 5M3 21l3-3',
axe:'M7 22 15 3m-3 4c4-3 7-2 9 0l-3 6c-2-2-5-2-8-1',
pickaxe:'M8 22 14 5M4 7c6-5 12-5 17 3l-8-4Z',
scythe:'M8 22 11 4m-1 0c8-1 12 4 12 9-3-4-6-6-12-5',
hammer:'M10 22 14 9m-7-5 11 3-2 6L5 10Z',
food:'M4 17v-7C3 6 6 3 9 4c2-2 5-2 7 0 4-1 7 3 5 6v9H4Zm3-9 2 2m4-4 2 2m3 1 1 2',
heal:'M12 3v19M5 9h14M7 4l5-2 5 2M8 18l4-2 4 2',
guard:'m12 2 8 4v8c-1 4-5 6-8 8-3-2-7-4-8-8V6Zm0 4v11m-4-7h8',
priest:'M12 3v18M6 8h12m-9 11 3 3 3-3M5 4 3 2m16 2 2-2',
villager:'m5 18 12-12M4 21l-2-2 3-4 4 4ZM13 3l7 7 2-2-7-7Z',
timber:'M4 17 14 3l7 5-10 14Z M4 17c0-3 7 1 7 5M7 13l7 5M10 9l7 5',
stone:'m3 17 2-10 7-5 8 5 2 10-8 5ZM5 7l7 4 8-4M12 11l2 11',
wheat:'M12 23V4m0 13c-5 0-7-3-6-6 4 1 6 3 6 6Zm0-6c-4 0-6-3-5-6 3 1 5 3 5 6Zm0 6c5 0 7-3 6-6-4 1-6 3-6 6Zm0-6c4 0 6-3 5-6-3 1-5 3-5 6ZM12 6c-3-3-2-5 0-6 2 1 3 3 0 6Z',
pack:'M6 8V5c0-4 12-4 12 0v3M4 8h16v14H4Zm0 5h16M9 8v6h6V8',
gold:'m12 2 9 10-9 10L3 12Zm0 4v12M8 10h8m-8 4h8'
};
export function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.pack}"/></svg>`;}
