import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureRoleStats,tickRoleStats,absorbDamage } from '../server/roles.js';

const player=(role='guard',extra={})=>({role,hp:100,maxHp:100,online:true,downed:false,...extra});

test('fresh role traits and save migration preserve the health fraction',()=>{
  const guard=ensureRoleStats(player(),{fresh:true,clock:20});
  assert.equal(guard.maxHp,100);assert.equal(guard.shield,40);assert.equal(guard.maxShield,40);
  const healthy=ensureRoleStats(player('priest'),{clock:20});
  assert.equal(healthy.hp,125);assert.equal(healthy.maxHp,125);assert.equal(healthy.shield,0);
  const hurt=ensureRoleStats(player('priest',{hp:40}),{clock:20});
  assert.equal(hurt.hp,50);
  const fallen=ensureRoleStats(player('priest',{hp:0,downed:true}),{fresh:true,clock:20});
  assert.equal(fallen.hp,0);assert.equal(fallen.maxHp,125);assert.equal(fallen.shield,0);
});

test('changing roles cannot heal an injury or refill a guard shield',()=>{
  const p=ensureRoleStats(player('guard',{hp:40}),{clock:10});
  assert.equal(p.shield,40,'an older guard save receives its new trait once');
  absorbDamage({clock:11},p,40);
  ensureRoleStats(p,{clock:12});
  assert.equal(p.shield,0,'reloading role stats does not repeat the migration grant');
  p.role='priest';ensureRoleStats(p,{clock:13});
  assert.equal(p.hp,50);assert.equal(p.maxShield,0);
  p.role='villager';ensureRoleStats(p,{clock:14});
  assert.equal(p.hp,40);
  p.role='guard';ensureRoleStats(p,{clock:15});
  assert.equal(p.hp,40);assert.equal(p.shield,0);assert.equal(p.shieldHitAt,15);
  tickRoleStats({clock:20.9},p,5.9);assert.equal(p.shield,0);
  tickRoleStats({clock:21.5},p,.6);assert.equal(p.shield,2);
});

test('shield absorbs damage before HP and subsequent hits restart recovery',()=>{
  const p=ensureRoleStats(player(),{fresh:true});
  assert.equal(absorbDamage({clock:10},p,15),0);
  assert.equal(p.shield,25);assert.equal(p.hp,100);
  assert.equal(absorbDamage({clock:14},p,30),5);
  assert.equal(p.shield,0);assert.equal(p.shieldHitAt,14);
  p.hp-=5;
  assert.equal(absorbDamage({clock:18},p,9),9);
  assert.equal(p.shieldHitAt,18,'HP-only hits also postpone regeneration');
  for(const damage of [0,-1,NaN,Infinity])assert.equal(absorbDamage({clock:19},p,damage),0);
  assert.equal(p.shieldHitAt,18,'invalid or zero damage is not a hit');
  const priest=ensureRoleStats(player('priest'),{fresh:true});
  assert.equal(absorbDamage({clock:20},priest,9),9);assert.equal(priest.shield,0);
});

test('shield regenerates only after six seconds and caps at forty with partial tick accuracy',()=>{
  const p=ensureRoleStats(player(),{fresh:true});
  absorbDamage({clock:10},p,40);
  assert.equal(tickRoleStats({clock:15.5},p,5.5),0);
  assert.equal(tickRoleStats({clock:16.5},p,1),2,'only half of the tick is after the delay');
  assert.equal(tickRoleStats({clock:17.5},p,1),6);
  assert.equal(tickRoleStats({clock:50},p,32.5),40);
  assert.equal(p.hp,100,'shield recovery does not heal health');
});

test('downed and offline players never regenerate and revival starts with an empty shield',()=>{
  const p=ensureRoleStats(player(),{fresh:true});
  p.downed=true;p.hp=0;
  assert.equal(tickRoleStats({clock:100},p,100),0);
  assert.equal(p.hp,0);assert.equal(p.shieldHitAt,100);
  p.downed=false;p.hp=45;
  assert.equal(tickRoleStats({clock:105},p,5),0);
  assert.equal(tickRoleStats({clock:107},p,2),4);
  p.online=false;
  assert.equal(tickRoleStats({clock:200},p,93),4);
  p.online=true;
  assert.ok(Math.abs(tickRoleStats({clock:200.1},p,.1)-4.4)<1e-8,'reconnect earns only the current tick');
  ensureRoleStats(p,{fresh:true,clock:201});
  assert.equal(p.hp,100);assert.equal(p.shield,40,'an explicitly fresh life restores the guard shield');
});

test('role and shield timers survive save restoration without granting another shield',()=>{
  const p=ensureRoleStats(player(),{fresh:true,clock:100});
  absorbDamage({clock:105},p,40);
  const restored=JSON.parse(JSON.stringify(p));
  ensureRoleStats(restored);
  assert.equal(restored.shieldHitAt,105,'normalizing without a supplied clock preserves an existing timer');
  ensureRoleStats(restored,{clock:106});
  assert.equal(restored.shield,0);assert.equal(restored.shieldHitAt,105);
  tickRoleStats({clock:111.25},restored,5.25);
  assert.equal(restored.shield,1);
  restored.shield=900;restored.shieldHitAt=Infinity;
  ensureRoleStats(restored,{clock:120});
  assert.equal(restored.shield,40);assert.equal(restored.shieldHitAt,120);
});
