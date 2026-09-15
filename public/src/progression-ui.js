import { MILESTONES, GUIDE_STEPS, COSMETIC_PALETTES, COSMETIC_CRESTS, normalizeProgression, unlockedCosmetics } from '../../shared/progression.js';
import { BUILDINGS, PLOTS, RESOURCES, CAVE_ENTRANCE, caveAreaAt, resolveResource } from '../../shared/world.js';
import { BUILDING_TYPES } from '../../shared/content.js';
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot } from '../../shared/access.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function guideView(progress) {
  const p=normalizeProgression(progress),next=GUIDE_STEPS.find(s=>!p.guide.done.includes(s.id));
  return {hidden:p.guide.dismissed,completed:p.guide.done.length,total:GUIDE_STEPS.length,next,steps:GUIDE_STEPS.map(s=>({...s,done:p.guide.done.includes(s.id)}))};
}
export function createProgressionUI({getState,getMe,getActivePanel,openPanel,send,markWaypoint=()=>{},container=()=>document.getElementById('first-watch-guide')}) {
  let signature='',guideSignature='',expanded=false;const drafts=new Map();
  const host=()=>typeof container==='function'?container():container;
  const content=()=>document.getElementById('panel-content');
  const command=(kind,extra={})=>send({type:'action',kind,...extra});
  const options=(ids,catalog,selected)=>ids.map(id=>`<option value="${esc(id)}"${selected===id?' selected':''}>${esc(typeof catalog[id]==='string'?catalog[id]:catalog[id].name)}</option>`).join('');
  function destination(id) {
    if(id==='gate')return {x:0,z:12,label:'Village gate'};
    if(id==='gather') {
      const p=getMe(),tool=p?.tool,resource=tool==='axe'?'timber':tool==='scythe'?'wheat':'stone';
      if(resource==='stone'&&!caveAreaAt(p.x,p.z))return {...CAVE_ENTRANCE,label:'Mountain mine entrance'};
      const available=new Map((getState()?.resources??[]).map(n=>[n.id,n]));
      const node=RESOURCES.map(n=>resolveResource(n,available.get(n.id))).filter(n=>n.type===resource&&available.get(n.id)?.available!==false).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
      return node?{x:node.x,z:node.z,label:`Gather ${resource}`}:null;
    }
    const b=BUILDINGS.find(b=>b.id===id);return b?{...buildingEntrance(b),label:b.name}:null;
  }
  function renderGuide(force=false) {
    const element=host();if(!element)return;
    const s=getState(),view=guideView(s?.progression);
    element.hidden=!s||view.hidden;
    if(element.hidden){guideSignature='';return;}
    const nextSignature=JSON.stringify([view,expanded]);if(!force&&nextSignature===guideSignature)return;guideSignature=nextSignature;
    element.innerHTML=`<div class="guide-heading"><button class="guide-toggle" aria-expanded="${expanded}">First watch · ${view.completed}/${view.total}</button><button class="guide-dismiss" aria-label="Dismiss first-watch guide" title="Reopen from the village menu">×</button></div>${view.next?`<p class="guide-next">${esc(view.next.name)}</p><p class="guide-detail">${esc(view.next.detail)}</p><button class="guide-mark secondary-button">Mark destination</button>`:'<p>First watch complete. Check the noticeboard for your next village task.</p>'}${expanded?`<ol class="guide-checklist">${view.steps.map(step=>`<li class="${step.done?'complete':''}"><span aria-label="${step.done?'Completed':'Not yet completed'}">${step.done?'✓':'○'}</span> ${esc(step.name)}</li>`).join('')}</ol>`:''}`;
    element.querySelector('.guide-toggle').onclick=()=>{expanded=!expanded;renderGuide(true);};
    element.querySelector('.guide-dismiss').onclick=()=>command('guide_visibility',{dismissed:true});
    const mark=element.querySelector('.guide-mark');if(mark)mark.onclick=()=>{const target=destination(view.next.destination);if(target)markWaypoint(target);};
  }
  function show() {
    const s=getState(),p=getMe();if(!s||!p)return;
    const progress=normalizeProgression(s.progression),available=unlockedCosmetics(progress);
    const own=(s.plots??[]).filter(plot=>plot.ownerId===p.id&&plot.building&&plot.hp>0);
    const atKeep=canUseBuilding(p,BUILDINGS.find(b=>b.id==='keep'));
    const milestoneHtml=MILESTONES.map(m=>{const earned=progress.nights>=m.nights;return `<div class="progression-milestone ${earned?'earned':''}"><strong>${earned?'✓ ':''}${esc(m.name)}</strong><span>${Math.min(progress.nights,m.nights)} / ${m.nights} nights</span><p>${esc(COSMETIC_PALETTES[m.palette].name)} color · ${esc(COSMETIC_CRESTS[m.crest])} crest</p></div>`;}).join('');
    const select=(id,label,ids,catalog,selected)=>`<label>${label}<select id="${id}">${options(ids,catalog,drafts.get(id)??selected)}</select></label>`;
    openPanel(`<div class="progression-panel"><p class="eyebrow">YOUR LASTING LEGACY</p><h2>Watch honors & appearance</h2><p>${progress.nights} nights credited across your villages. Be online and alive for at least half a night to earn credit when the keep survives dawn. Colors and crests are cosmetic and stay with your account.</p><div class="progression-milestones">${milestoneHtml}</div><h3>Your dwarf</h3><p>Choose a colored sash and a crest badge. Original colors removes the sash.</p><div class="transfer-form">${select('appearance-palette','Sash color',available.palettes,COSMETIC_PALETTES,progress.selected.palette)}${select('appearance-crest','Crest',available.crests,COSMETIC_CRESTS,progress.selected.crest)}<button id="appearance-save">Apply appearance</button></div><h3>Owned buildings</h3><p>Earned colors decorate your building trim and its pennant. Visit your building entrance or plot front gate to apply a color. Deeds and decorations belong to this village run.</p>${own.length?own.map(plot=>`<div class="panel-row"><span>${esc(PLOTS.find(m=>m.id===plot.id)?.name??plot.id)} · ${esc(BUILDING_TYPES[plot.building]?.name??plot.building)}</span><select id="plot-color-${esc(plot.id)}" aria-label="Decoration color for ${esc(plot.id)}" data-plot-color="${esc(plot.id)}">${options(available.palettes,COSMETIC_PALETTES,drafts.get('plot-color-'+plot.id)??s.cosmetics?.plots?.[plot.id]??'natural')}</select><button data-decorate="${esc(plot.id)}"${canUsePlot(p,PLOTS.find(m=>m.id===plot.id),plot)?'':' disabled'}>Apply</button><button data-mark-plot="${esc(plot.id)}" class="secondary-button">Mark entrance</button></div>`).join(''):'<p>Buy a plot and build a structure to decorate it.</p>'}<h3>Village banner</h3><p>Village honors: ${MILESTONES.filter(m=>(s.progression?.villageMilestones??[]).includes(m.id)).map(m=>esc(m.name)).join(', ')||'The first watch is still ahead.'}</p>${s.progression?.canChooseBanner?`<p>As founder, choose the keep’s banner from your earned colors and crests. Visit the Hearthkeep entrance to apply it. This choice lasts for this village.</p><div class="transfer-form">${select('banner-palette','Banner color',available.palettes,COSMETIC_PALETTES,s.cosmetics?.banner?.palette)}${select('banner-crest','Banner crest',available.crests,COSMETIC_CRESTS,s.cosmetics?.banner?.crest)}<button id="banner-save"${atKeep?'':' disabled'}>Apply keep banner</button><button id="banner-mark" class="secondary-button">Mark keep entrance</button></div>`:'<p>The village founder chooses the keep banner. Your own appearance and building choices are yours.</p>'}<h3>First-watch guide</h3><p>An optional checklist for tools, gathering, trade, food, and finding the gate. Progress is remembered.</p><button id="progression-guide-toggle">${progress.guide.dismissed?'Show':'Hide'} beginner guide</button></div>`,'progression');
    for(const select of content().querySelectorAll('select'))select.onchange=()=>drafts.set(select.id,select.value);
    content().querySelector('#appearance-save').onclick=()=>{drafts.delete('appearance-palette');drafts.delete('appearance-crest');command('cosmetic_player',{palette:content().querySelector('#appearance-palette').value,crest:content().querySelector('#appearance-crest').value});};
    for(const button of content().querySelectorAll('[data-decorate]'))button.onclick=()=>{const plotId=button.dataset.decorate,select=[...content().querySelectorAll('[data-plot-color]')].find(el=>el.dataset.plotColor===plotId);drafts.delete('plot-color-'+plotId);command('cosmetic_plot',{plotId,palette:select.value});};
    for(const button of content().querySelectorAll('[data-mark-plot]'))button.onclick=()=>{const site=PLOTS.find(p=>p.id===button.dataset.markPlot),plot=s.plots.find(p=>p.id===site?.id);if(site)markWaypoint({...plotEntrance(site,plot),label:site.name});};
    const bannerMark=content().querySelector('#banner-mark');if(bannerMark)bannerMark.onclick=()=>markWaypoint(destination('keep'));
    const banner=content().querySelector('#banner-save');if(banner)banner.onclick=()=>{drafts.delete('banner-palette');drafts.delete('banner-crest');command('cosmetic_banner',{palette:content().querySelector('#banner-palette').value,crest:content().querySelector('#banner-crest').value});};
    content().querySelector('#progression-guide-toggle').onclick=()=>command('guide_visibility',{dismissed:!progress.guide.dismissed});
    signature=JSON.stringify([s.progression,s.cosmetics?.banner,s.cosmetics?.plots,atKeep,own.map(plot=>[plot.id,plot.building,canUsePlot(p,PLOTS.find(m=>m.id===plot.id),plot)])]);
  }
  function refresh() {
    renderGuide();
    if(getActivePanel?.()!=='progression')return;
    const s=getState(),p=getMe();if(!s||!p)return;
    const own=(s.plots??[]).filter(plot=>plot.ownerId===p.id&&plot.building&&plot.hp>0);
    const next=JSON.stringify([s.progression,s.cosmetics?.banner,s.cosmetics?.plots,canUseBuilding(p,BUILDINGS.find(b=>b.id==='keep')),own.map(plot=>[plot.id,plot.building,canUsePlot(p,PLOTS.find(m=>m.id===plot.id),plot)])]);
    if(content()?.contains?.(document.activeElement)&&document.activeElement?.tagName==='SELECT')return;
    if(next!==signature)show();
  }
  return {show,refresh,renderGuide,showGuide:()=>command('guide_visibility',{dismissed:false}),clear(){signature='';guideSignature='';expanded=false;drafts.clear();const el=host();if(el){el.replaceChildren();el.hidden=true;}}};
}
