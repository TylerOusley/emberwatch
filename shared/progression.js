// Earned appearance choices never alter combat, economy, or carrying statistics.
export const MILESTONES = Object.freeze([
  Object.freeze({ id:'first_watch', nights:1, name:'First Watch', palette:'ember', crest:'flame' }),
  Object.freeze({ id:'five_watches', nights:5, name:'Steadfast Defender', palette:'azure', crest:'shield' }),
  Object.freeze({ id:'ten_watches', nights:10, name:'Veteran of the Watch', palette:'forest', crest:'oak' }),
  Object.freeze({ id:'twenty_watches', nights:20, name:'Emberwarden', palette:'royal', crest:'crown' })
]);
export const COSMETIC_PALETTES = Object.freeze({
  natural:Object.freeze({ name:'Original colors', color:0x6d7057 }),
  ember:Object.freeze({ name:'Hearth ember', color:0xb95430 }),
  azure:Object.freeze({ name:'Watch blue', color:0x387caa }),
  forest:Object.freeze({ name:'Evergreen', color:0x47855b }),
  royal:Object.freeze({ name:'Royal violet', color:0x815aa9 })
});
export const COSMETIC_CRESTS = Object.freeze({ none:'No crest', flame:'Flame', shield:'Shield', oak:'Oak leaf', crown:'Crown' });
export const GUIDE_STEPS = Object.freeze([
  Object.freeze({ id:'tool', name:'Choose your first tool', detail:'Visit Oak & Iron. Your starting 10 gold buys an axe, pickaxe, or scythe. Pick one to begin gathering.', destination:'tools' }),
  Object.freeze({ id:'gather', name:'Gather a resource', detail:'Equip your tool and use it on a tree, mineral outcrop, or wheat stalk.', destination:'gather' }),
  Object.freeze({ id:'sell', name:'Sell supplies', detail:'Bring resources to the Treasury entrance and sell your chosen quantity for wallet gold.', destination:'bank' }),
  Object.freeze({ id:'food', name:'Buy food for later', detail:'Visit The Breadboard. Food goes into your pack; equip it and eat when hungry.', destination:'food' }),
  Object.freeze({ id:'gate', name:'Find the village gate', detail:'Follow the main road to the single gate. This is where the village stands together at night.', destination:'gate' })
]);
export function freshProgression({ offerGuide=false }={}) {
  return { version:1, nights:0, unlocked:[], selected:{palette:'natural',crest:'none'}, guide:{dismissed:!offerGuide,done:[]} };
}
export function normalizeProgression(value) {
  const clean=freshProgression();
  if (!value || typeof value!=='object') return clean;
  clean.nights=Number.isSafeInteger(value.nights)&&value.nights>=0?value.nights:0;
  clean.unlocked=MILESTONES.filter(m=>clean.nights>=m.nights).map(m=>m.id);
  const permitted=unlockedCosmetics(clean);
  if(permitted.palettes.includes(value.selected?.palette))clean.selected.palette=value.selected.palette;
  if(permitted.crests.includes(value.selected?.crest))clean.selected.crest=value.selected.crest;
  clean.guide.dismissed=value.guide?.dismissed!==false;
  clean.guide.done=GUIDE_STEPS.filter(s=>Array.isArray(value.guide?.done)&&value.guide.done.includes(s.id)).map(s=>s.id);
  return clean;
}
export function unlockedCosmetics(progress={}) {
  const milestones=MILESTONES.filter(m=>Number.isSafeInteger(progress.nights)&&progress.nights>=m.nights);
  return {palettes:['natural',...milestones.map(m=>m.palette)],crests:['none',...milestones.map(m=>m.crest)]};
}
export function cosmeticChoice(value={}) {
  return {palette:Object.hasOwn(COSMETIC_PALETTES,value.palette)?value.palette:'natural',crest:Object.hasOwn(COSMETIC_CRESTS,value.crest)?value.crest:'none'};
}
