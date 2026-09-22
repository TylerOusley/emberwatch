import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryHUDModel, createInventoryHUD } from '../public/src/inventory-hud.js';

test('corner inventory counts private carried supplies once, including bound food and all owned tools', () => {
  const player = { role:'villager', inventory:{timber:12,stone:17,iron:3,iron_ingot:6,steel_ingot:2,coal:9,sulfur:4,gunpowder:7,musket_ammo:16,wheat:21,food:2,good_food:4,best_food:1,arrows:24,cart:1}, boundInventory:{food:2}, durability:{axe:55,pickaxe:150,sword:0,bow:30,musket:90}, tiers:{pickaxe:'stone'}, crateEquipment:{utility:'mining_pack'} };
  const model = inventoryHUDModel(player);
  assert.equal(model.items.length,15);
  for (const item of model.items) assert.equal(item.amount,player.inventory[item.id]);
  assert.deepEqual(model.tools.map(item=>item.id),['axe','pickaxe','bow','musket']);
  assert.equal(model.tools.find(item=>item.id==='musket').label,'Musket');
  assert.ok(model.tools.every(item=>item.amount===1));
  assert.equal(model.tools.find(item=>item.id==='pickaxe').uses,150);
  assert.deepEqual(model.gear,[{id:'mining_pack',label:'Mining Pack',amount:1}]);
  assert.equal(model.capacity,150); assert.ok(model.weight>0);
});

test('inventory HUD keeps absent resource counts visible and never renders an unknown equipment asset', () => {
  assert.equal(inventoryHUDModel(null),null);
  const model=inventoryHUDModel({inventory:{stone:-3,coal:NaN,iron:Infinity},crateEquipment:{head:'../../bad'}});
  assert.equal(model.items.length,14); assert.ok(model.items.every(item=>item.amount===0));
  assert.deepEqual(model.gear,[]);
});

test('inventory HUD distinguishes ore and ingots and warns only above the carrying allowance', () => {
  const root={hidden:true,set innerHTML(value){this.markup=value;},querySelector:()=>({}),replaceChildren(){}};
  const hud=createInventoryHUD(root),player={role:'guard',inventory:{wheat:100},durability:{}};
  hud.update(player);assert.doesNotMatch(root.markup,/Encumbered/);
  player.inventory.wheat++;hud.update(player);
  assert.match(root.markup,/Encumbered/);assert.match(root.markup,/45% speed · No sprint/);
  assert.match(root.markup,/101 \/ 100/);assert.match(root.markup,/aria-valuenow="100"/);
  assert.match(root.markup,/Iron ore/);assert.match(root.markup,/Iron ingot/);assert.match(root.markup,/Steel ingot/);
  player.inventory={wheat:99,arrows:10};hud.update(player);assert.doesNotMatch(root.markup,/Encumbered/);
});

test('inventory HUD updates on quantity changes without rebuilding for position snapshots and clears on leave', () => {
  let writes=0,opened=0;const button={};
  const root={hidden:true,set innerHTML(value){this.markup=value;writes++;},querySelector:()=>button,replaceChildren(){this.markup='';}};
  const hud=createInventoryHUD(root,{onOpen:()=>opened++}),player={inventory:{timber:4},durability:{}};
  hud.update(player);assert.equal(root.hidden,false);assert.match(root.markup,/Wood: 4 carried/);
  button.onclick();assert.equal(opened,1);
  hud.update({...player,x:100,z:50});assert.equal(writes,1);
  player.inventory.timber=10;hud.update(player);assert.equal(writes,2);assert.match(root.markup,/Wood: 10 carried/);
  hud.clear();assert.equal(root.hidden,true);assert.equal(root.markup,'');
});
