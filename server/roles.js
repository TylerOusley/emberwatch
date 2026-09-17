import { ROLE_STATS } from '../shared/roles.js';
import { roleSkills } from '../shared/skills.js';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const clockOf=village=>Number.isFinite(village?.clock)?Math.max(0,village.clock):0;

// Apply once at load/join and after changing roles. The persisted role marker
// distinguishes an older save from a role change, so cycling jobs cannot refill
// a depleted guard shield. `fresh` is reserved for a new life, never a revival.
export function ensureRoleStats(player,{fresh=false,clock}={}) {
  const role=Object.hasOwn(ROLE_STATS,player.role)?player.role:'villager';
  const base=ROLE_STATS[role], skills=roleSkills(player), stats={...base,maxHp:base.maxHp+skills.maxHpBonus,maxShield:base.maxShield+skills.extraShield},previousRole=player.roleStatsRole;
  const oldMax=Number.isFinite(player.maxHp)&&player.maxHp>0?player.maxHp:100;
  const oldHp=Number.isFinite(player.hp)?clamp(player.hp,0,oldMax):oldMax;
  const now=Number.isFinite(clock)?Math.max(0,clock):Number.isFinite(player.shieldHitAt)?Math.max(0,player.shieldHitAt):0;
  const changedRole=previousRole!==undefined&&previousRole!==role;
  player.maxHp=stats.maxHp;
  player.hp=player.downed?0:fresh?stats.maxHp:oldMax===stats.maxHp?oldHp:oldHp/oldMax*stats.maxHp;
  player.maxShield=stats.maxShield;
  if(!stats.maxShield || player.downed) player.shield=0;
  else if(fresh) player.shield=stats.maxShield;
  else if(changedRole) player.shield=0;
  else if(Number.isFinite(player.shield)) player.shield=clamp(player.shield,0,stats.maxShield);
  else player.shield=previousRole===undefined?stats.maxShield:0;
  if(fresh || changedRole || player.downed || !Number.isFinite(player.shieldHitAt)) player.shieldHitAt=now;
  // A persisted clock must belong to this run; reject future timers that would
  // otherwise prevent regeneration forever after restoring an older snapshot.
  player.shieldHitAt=clamp(player.shieldHitAt,0,now);
  player.roleStatsRole=role;
  return player;
}

// village.clock is the end of this simulation step. Only the portion of dt
// after the last hit's cooldown earns shield, including a straddling step.
export function tickRoleStats(village,player,dt) {
  const now=clockOf(village);
  ensureRoleStats(player,{clock:now});
  if(player.downed || player.hp<=0) {
    player.shield=0;player.shieldHitAt=now;
    return 0;
  }
  if(player.online===false || !player.maxShield || !Number.isFinite(dt) || dt<=0) return player.shield;
  const stats=ROLE_STATS[player.roleStatsRole];
  const elapsed=clamp(now-player.shieldHitAt-stats.shieldDelay,0,dt);
  player.shield=Math.min(player.maxShield,player.shield+elapsed*stats.shieldRegen);
  return player.shield;
}

// The caller applies the returned overflow to HP and handles becoming downed.
// Every real hit restarts recovery even when the shield has already run out.
export function absorbDamage(village,player,damage) {
  if(!Number.isFinite(damage) || damage<=0) return 0;
  const now=clockOf(village);
  ensureRoleStats(player,{clock:now});
  if(player.maxShield) player.shieldHitAt=now;
  const absorbed=Math.min(damage,player.shield);
  player.shield-=absorbed;
  return damage-absorbed;
}
