import { CONFIG, BUILDINGS, PLOTS } from '../shared/world.js';
import { canUseBuilding, canUsePlot } from '../shared/access.js';
import { MILESTONES, GUIDE_STEPS, COSMETIC_PALETTES, COSMETIC_CRESTS, freshProgression, normalizeProgression, unlockedCosmetics, cosmeticChoice } from '../shared/progression.js';

export function ensureProgression(village) {
  village.progression ??= { banner:{palette:'natural',crest:'none'}, lastSurvivedNight:0, watch:null };
  village.progression.banner=cosmeticChoice(village.progression.banner);
  village.progression.lastSurvivedNight=Number.isSafeInteger(village.progression.lastSurvivedNight)?village.progression.lastSurvivedNight:0;
}
function playerProgress(sim, player) {
  player.accountProgression ??= normalizeProgression(sim.store.progression?.(player.id) ?? freshProgression());
  return player.accountProgression;
}
function savePlayer(sim, player, progress) {
  player.accountProgression=sim.store.saveProgression?.(player.id,progress) ?? normalizeProgression(progress);
  return player.accountProgression;
}
export function joinProgression(sim, village, player) {
  ensureProgression(village);
  player.accountProgression=normalizeProgression(sim.store.progression?.(player.id) ?? player.accountProgression ?? freshProgression());
}
export function progressionNight(village) {
  ensureProgression(village);
  village.progression.watch={night:village.day,startedAt:village.clock,duration:village.phaseRemaining,seconds:{},awarded:false};
}
export function progressionTick(sim, village, dt) {
  ensureProgression(village);
  // A recovered pre-upgrade night can accrue only time actually observed now.
  if(village.phase==='night'&&village.progression.watch?.night!==village.day) {
    village.progression.watch={night:village.day,startedAt:village.clock-Math.max(0,(sim.nightSeconds??CONFIG.nightSeconds)-village.phaseRemaining),duration:sim.nightSeconds??CONFIG.nightSeconds,seconds:{},awarded:false};
  }
  const watch=village.progression.watch;
  for(const player of Object.values(village.players)) {
    if(!player.online)continue;
    const progress=playerProgress(sim,player);
    if(!player.downed&&Math.hypot(player.x,player.z-18)<=6&&!progress.guide.done.includes('gate')) {
      progress.guide.done.push('gate');savePlayer(sim,player,progress);
    }
    if(village.phase==='night'&&watch&&!watch.awarded&&!player.downed&&player.hp>0) {
      const end=watch.startedAt+watch.duration;
      const observed=Math.max(0,Math.min(village.clock,end)-Math.max(watch.startedAt,village.clock-Math.max(0,dt)));
      watch.seconds[player.id]=Math.min(watch.duration,(watch.seconds[player.id]??0)+observed);
    }
  }
}
export function progressionDawn(sim, village, completedNight, { earlyClear=false }={}) {
  ensureProgression(village);
  const watch=village.progression.watch;
  if(village.status!=='active'||village.keep.hp<=0||!watch||watch.night!==completedNight||watch.awarded)return;
  watch.awarded=true;
  village.progression.lastSurvivedNight=Math.max(village.progression.lastSurvivedNight,completedNight);
  const requiredDuration=earlyClear?Math.min(watch.duration,Math.max(0,village.clock-watch.startedAt)):watch.duration;
  for(const player of Object.values(village.players)) {
    if(!(requiredDuration>0)||(watch.seconds[player.id]??0)<=0||(watch.seconds[player.id]??0)+1e-7<requiredDuration*.5)continue;
    if(sim.store.recordSurvivedNight) {
      const result=sim.store.recordSurvivedNight(player.id,village.id,completedNight);
      player.accountProgression=result.progress;
    } else { const progress=playerProgress(sim,player); progress.nights++;savePlayer(sim,player,progress); }
  }
}
function requirePalette(progress,palette) {
  if(!Object.hasOwn(COSMETIC_PALETTES,palette)||!unlockedCosmetics(progress).palettes.includes(palette))throw new Error('Earn that color by surviving more nights first.');
}
function requireCrest(progress,crest) {
  if(!Object.hasOwn(COSMETIC_CRESTS,crest)||!unlockedCosmetics(progress).crests.includes(crest))throw new Error('Earn that crest by surviving more nights first.');
}
export function progressionAction(sim,village,player,action) {
  if(!['cosmetic_player','cosmetic_plot','cosmetic_banner','guide_visibility'].includes(action.kind))return null;
  ensureProgression(village);
  const progress=playerProgress(sim,player);
  if(action.kind==='guide_visibility') {
    if(typeof action.dismissed!=='boolean')throw new Error('Choose whether to show the first-watch guide.');
    progress.guide.dismissed=action.dismissed;savePlayer(sim,player,progress);
    return action.dismissed?'First-watch guide hidden. Reopen it from the village menu.':'First-watch guide opened.';
  }
  requirePalette(progress,action.palette);
  if(action.kind==='cosmetic_player') {
    requireCrest(progress,action.crest);
    progress.selected={palette:action.palette,crest:action.crest};savePlayer(sim,player,progress);
    return 'Your appearance has been saved for this and future villages.';
  }
  if(action.kind==='cosmetic_plot') {
    const plot=village.plots?.find(p=>p.id===action.plotId);
    if(!plot||plot.ownerId!==player.id)throw new Error('You can decorate only a building you own.');
    if(!plot.building||plot.hp<=0)throw new Error('Build or restore this plot before decorating it.');
    if(!canUsePlot(player,PLOTS.find(p=>p.id===plot.id),plot))throw new Error('Visit your building entrance or plot front gate to decorate it.');
    plot.cosmeticPalette=action.palette;
    return 'Your building decoration has been updated.';
  }
  if(village.creatorId!==player.id)throw new Error('Only the village founder can choose the keep banner.');
  if(!canUseBuilding(player,BUILDINGS.find(b=>b.id==='keep')))throw new Error('Visit the Hearthkeep entrance to choose the village banner.');
  requireCrest(progress,action.crest);
  village.progression.banner={palette:action.palette,crest:action.crest};
  return 'The village banner has been updated.';
}
export function recordProgressionAction(sim,village,player,action) {
  // A newly purchased or replaced deed cannot inherit another owner’s earned dye.
  if(['plot_buy','plot_build','plot_demolish'].includes(action.kind)) {
    const plot=village.plots?.find(p=>p.id===action.plotId);if(plot)delete plot.cosmeticPalette;
  }
  if(action.kind==='role_change')for(const plot of village.plots??[])if(!plot.building)delete plot.cosmeticPalette;
  let id;
  if(action.kind==='buyTool'&&['axe','pickaxe','scythe'].includes(action.tool))id='tool';
  if(action.kind==='gather')id='gather';
  if(action.kind==='sell')id='sell';
  if(action.kind==='buyFood')id='food';
  if(!id)return;
  const progress=playerProgress(sim,player);
  if(!progress.guide.done.includes(id)) {progress.guide.done.push(id);savePlayer(sim,player,progress);}
}
export function progressionSnapshot(sim,village,viewerId) {
  ensureProgression(village);
  const viewer=village.players[viewerId];
  const progress=viewer?normalizeProgression(playerProgress(sim,viewer)):freshProgression();
  return {
    cosmetics:{
      players:Object.fromEntries(Object.values(village.players).map(p=>[p.id,cosmeticChoice(playerProgress(sim,p).selected)])),
      plots:Object.fromEntries((village.plots??[]).filter(p=>p.ownerId&&p.building&&p.hp>0).map(p=>[p.id,Object.hasOwn(COSMETIC_PALETTES,p.cosmeticPalette)?p.cosmeticPalette:'natural'])),
      banner:cosmeticChoice(village.progression.banner)
    },
    progression:{...progress,available:unlockedCosmetics(progress),canChooseBanner:viewerId===village.creatorId,
      villageMilestones:MILESTONES.filter(m=>village.progression.lastSurvivedNight>=m.nights).map(m=>m.id),
      requiredParticipation:50,guide:{...progress.guide,total:GUIDE_STEPS.length}}
  };
}
