// Artwork catalogue only. This module grants no items, stats, credits or rewards.
export const CRATE_TIERS=Object.freeze({
  basic:{label:'Basic',color:'#bcc9b6'},rare:{label:'Rare',color:'#89c6e3'},
  epic:{label:'Epic',color:'#c4a5e7'},legendary:{label:'Legendary',color:'#eac276'},
  milestone:{label:'Hundredth Watch',color:'#ffdc82'},
});
const rows=[
  ['padded_cap','Padded cap','basic','head','2% less incoming enemy damage.','Quilted linen, hand-stitched seams and a soft leather rim.'],
  ['stout_leather_boots','Stout leather boots','basic','feet','1% less incoming enemy damage.','Supple leather, reinforced soles and practical crossed laces.'],
  ['foragers_pouch',"Forager’s pouch",'basic','utility','Adds 15 carrying capacity.','An oak-leaf clasp closes a weathered gathering pouch.'],
  ['hearth_ration_kit','Hearth ration kit','basic','kit','Start a new run with two bread items.','Fresh loaves wrapped in linen and tied for the road.'],
  ['iron_coif','Iron coif','rare','head','4% less incoming enemy damage.','Overlapping iron links, leather edging and an open face.'],
  ['riveted_vest','Riveted vest','rare','body','6% less incoming enemy damage.','Riveted plates follow a fitted leather vest.'],
  ['miners_buckle',"Miner’s buckle",'rare','utility','New gathering tools have 10% more maximum durability.','A cast-metal buckle and sturdy worked-leather belt.'],
  ['tradesmans_kit',"Tradesman’s kit",'rare','kit','Start with one chosen wooden gathering tool and two bread items.','A leather tool bundle with plain timber fittings.'],
  ['mining_pack','Mining Pack','rare','utility','Stone, iron and coal weigh 20% less while carried.','A reinforced mineral pack with sample pockets and metal fittings.'],
  ['lumber_pack','Lumber Pack','rare','utility','Timber weighs 20% less while carried.','A leather log sling, secured timber and rugged canvas.'],
  ['tempered_cuirass','Tempered cuirass','epic','body','9% less incoming enemy damage.','Tempered steel with layered edges and forged trim.'],
  ['runed_helm','Runed helm','epic','head','6% less incoming enemy damage.','Engraved steel carries a restrained rune glow.'],
  ['deep_delvers_belt',"Deep-delver’s belt",'epic','utility','Adds 40 carrying capacity.','Deep-blue leather, fitted pouches and engraved metalwork.'],
  ['prospectors_kit',"Prospector’s kit",'epic','kit','Start with one chosen stone gathering tool and two hearty meals.','A prospecting bundle with dressed stone and travel provisions.'],
  ['runeforged_cuirass','Runeforged cuirass','legendary','body','12% less incoming enemy damage.','Sculpted plate, flowing engraved borders and glowing runes.'],
  ['dawnsteel_helm','Dawnsteel helm','legendary','head','8% less incoming enemy damage.','Pale polished steel, warm gold and a rising-sun crest.'],
  ['guardians_boots',"Guardian’s boots",'legendary','feet','5% less incoming enemy damage.','Articulated metal protection over fitted leather boots.'],
  ['master_expedition_kit','Master expedition kit','legendary','kit','Start with one chosen iron gathering tool and two feasts.','A master-crafted expedition bundle with polished iron fittings.'],
  ['phoenix_ember','Phoenix Ember','legendary','consumable','One self-revival preserving your inventory and wallet.','A warm living ember held within sweeping phoenix wings.'],
  ['sunforged_viking_helm','Sunforged Viking Helm','milestone','head','Proposed day-100 trophy: 6% damage reduction and Last Stand.','Reflective gold, engraved bands, a Viking nose guard and fine sparkles.'],
];
export const CRATE_ITEMS=Object.freeze(rows.map(([id,name,tier,slot,description,design])=>Object.freeze({id,name,tier,slot,description,design,wearable:['head','body','feet','utility'].includes(slot)})));
export function crateItem(id){return CRATE_ITEMS.find(item=>item.id===id)||null;}
