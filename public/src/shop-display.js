// Original, self-contained SVG art. No external images, fonts, DOM or shared SVG IDs.
// Faceted surfaces deliberately echo the village's warm timber and forged-metal palette.
const TIERS = Object.freeze({
  wood: { face: '#ad7945', light: '#dbb272', edge: '#785034', dark: '#513921' },
  stone: { face: '#819296', light: '#c4cdca', edge: '#56666e', dark: '#35454c' },
  iron: { face: '#b9c6cb', light: '#f0e4bd', edge: '#718b97', dark: '#3b505e' },
});
const THEME_COLORS = Object.freeze({
  tools: ['#403b31','#645744','#ad7745','#80784e'],
  weapons: ['#333d42','#566168','#785141','#9e674c'],
  tinker: ['#3b4641','#596e61','#a17a49','#778d6b'],
  food: ['#55513b','#827654','#ae7541','#b7a266'],
  merchant: ['#4a3c49','#796279','#986548','#b7a470'],
  stable: ['#47493a','#777952','#8a6541','#a4a36b'],
  bank: ['#343f40','#5a706e','#826745','#aab4a1'],
  market: ['#474835','#7d7953','#9c7243','#b8a778'],
});
const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const poly = (points, fill, extra = '') => `<polygon points="${points}" fill="${fill}" ${extra}/>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const ellipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, color, width = 2) => `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
const group = (transform, body, extra = '') => `<g transform="${transform}" ${extra}>${body}</g>`;
const rivet = (x,y) => ellipse(x,y,2.3,2.3,'#dcc18c') + ellipse(x+.4,y+.6,1.1,1.1,'#796148');
const handle = (x = 117, y = 52, height = 99) => path(`M${x-5} ${y}L${x+7} ${y-1}L${x+5} ${y+height-3}Q${x+1} ${y+height+4} ${x-6} ${y+height}Z`,'#916137') + path(`M${x-3} ${y+2}L${x+1} ${y+1}L${x-1} ${y+height-3}L${x-4} ${y+height-5}Z`,'#d1a266') + line(x+2,y+18,x+1,y+height-12,'#63472e',1.5);

function axe(t) {
  return group('rotate(29 120 94)',handle() + path('M105 39Q82 33 64 47L58 82Q81 92 105 72L124 71L128 47Z',t.face) + path('M65 48Q83 40 105 46L121 53L103 55Q84 79 60 77Z',t.light) + path('M59 79Q82 89 105 69L124 69L125 57L104 59Q85 80 59 79Z',t.edge) + rect(109,43,15,33,t.dark,'rx="3"') + rivet(116,54)+rivet(116,66));
}
function pickaxe(t) {
  return group('rotate(27 120 94)',handle(117,48,103) + path('M47 76Q62 34 115 34Q165 30 190 64L153 53L126 55L105 54L72 61Z',t.face) + path('M47 76Q66 45 106 44L125 44Q164 42 190 64L163 43L139 33L113 32L77 40L58 54Z',t.light) + poly('72,61 105,54 126,55 153,53 190,64 161,56 126,62 101,61 66,67',t.edge) + rect(108,33,19,28,t.dark,'rx="3"') + rivet(117,43)+rivet(117,54));
}
function scythe(t) {
  return group('rotate(20 121 95)',handle(124,24,137) + path('M119 34Q163 9 197 22Q160 22 127 57L111 62L107 42Z',t.face) + path('M119 34Q163 9 197 22Q161 13 117 48L110 49L110 41Z',t.light) + path('M111 62L127 57Q158 24 197 22Q151 22 116 54Z',t.edge) + path('M118 88L93 93L87 89L88 83L118 80Z','#b88a51') + rect(114,32,17,21,t.dark,'rx="2"') + rivet(123,43));
}
function hammer(t) {
  return group('rotate(30 120 94)',handle(117,61,93) + poly('71,32 151,32 169,41 166,78 86,79 69,68',t.face) + poly('71,32 151,32 169,41 89,44',t.light) + poly('89,44 169,41 166,78 88,79',t.edge) + poly('71,32 89,44 88,79 69,68',t.face) + rect(108,33,18,45,t.dark) + rivet(116,45)+rivet(116,69));
}
function sword(t) {
  return group('rotate(31 120 92)',path('M117 16L133 39L128 110L109 110L104 39Z',t.face) + poly('117,16 117,109 109,110 104,39',t.light) + poly('117,16 133,39 128,110 117,109',t.edge) + path('M91 110Q118 103 145 110L143 120Q116 114 93 120Z','#b39455') + poly('91,110 117,106 145,110 140,113 116,111 94,114','#ead198') + rect(111,117,15,32,'#6e4130','rx="3"') + [123,130,137,144].map(y=>line(112,y,125,y+3,'#b67e50',2.4)).join('') + path('M108 150L118 159L129 150L126 145L112 145Z','#ac8748') + ellipse(118,149,3,3,'#f0d88e'));
}
function bow() {
  return group('rotate(23 121 95)',path('M106 23Q177 86 110 159L101 154Q157 89 100 28Z','#69472c') + path('M102 24Q165 88 105 156L102 151Q151 86 100 28Z','#c59a5a') + line(102,26,105,154,'#e0d2ac',1.6) + path('M132 77L139 80L137 103L130 106Z','#553b2d') + [82,88,94,100].map(y=>line(132,y,139,y-2,'#b99264',1.8)).join('') + group('rotate(-12 107 92)',line(67,91,171,91,'#c1a476',3)+poly('179,91 162,84 164,91 162,98','#9cbbc2')+poly('66,91 57,84 71,84 80,91 69,98 57,98','#e7e0c3')));
}
function arrows() {
  const arrow=(x,angle)=>group(`rotate(${angle} ${x} 91)`,line(x,42,x,150,'#c9a671',4)+poly(`${x},25 ${x-7},46 ${x},42 ${x+7},46`,'#bed0d1')+poly(`${x},29 ${x},42 ${x+7},46`,'#6d8b99')+poly(`${x-1},129 ${x-11},139 ${x-11},154 ${x},145 ${x+10},153 ${x+10},138 ${x+2},130`,'#e4d6ac')+line(x,126,x,153,'#93764a',2));
  return arrow(93,-15)+arrow(116,1)+arrow(138,17)+path('M91 97Q116 108 144 94L146 112Q120 126 96 114Z','#86583a')+path('M94 101Q119 113 144 101L145 107Q120 119 96 110Z','#bc8950')+rivet(119,110);
}
function musket() {
  return group('rotate(38 120 90)', path('M106 152L97 116L111 96L111 38L123 37L124 102L137 158Q119 167 106 160Z','#98653b') + path('M106 151L102 120L114 102L115 40L119 40L119 107L130 158Z','#bd8c55') + rect(116,14,9,96,'#64747a','rx="3"') + rect(118,15,3,89,'#b0bdbd') + [46,70,96].map(y=>rect(108,y,20,5,'#c6a460')).join('') + rect(127,85,8,17,'#7f8e91','rx="2"') + path('M130 86L139 78L142 82L135 91Z','#bcc5ba') + ellipse(129,119,8,11,'none','stroke="#b49454" stroke-width="4"') + rect(102,156,34,6,'#b99b5b','rx="2"') + ellipse(120,14,4,2,'#1c302c'));
}
function powder() {
  return path('M81 62Q65 86 70 142Q117 164 166 141Q169 89 153 63Z','#846347') + path('M89 66Q80 102 87 143L103 148L98 66Z','#b58d5d') + ellipse(117,62,36,15,'#a88860') + ellipse(117,60,29,10,'#35413e') + [0,1,2,3,4,5,6,7,8].map(i=>ellipse(97+(i%4)*13,56+Math.floor(i/4)*5,4,2,'#66716a')).join('') + rect(73,79,90,9,'#554a3d','rx="4"') + rect(73,131,91,9,'#554a3d','rx="4"') + path('M120 88L112 107L120 107L113 126L133 101L124 101L132 88Z','#dac16c');
}
function musketShots() {
  const ball=(x,y)=>ellipse(x,y,19,19,'#56676e')+ellipse(x-4,y-5,12,11,'#91a4a9')+ellipse(x-7,y-9,4,3,'#dce1cf');
  return path('M64 102Q114 88 170 102L177 145Q121 163 59 145Z','#8e653f') + path('M62 132Q118 147 176 132L177 145Q121 163 59 145Z','#bc945d') + ball(89,104)+ball(144,111)+ball(117,91)+path('M64 101L85 133L118 126L107 91Z','#ddcc9c')+line(74,107,101,100,'#a38e60',2)+line(78,118,107,109,'#a38e60',2);
}
function cart() {
  const wheel=(x,y)=>ellipse(x,y,18,26,'#352d27')+ellipse(x,y,13,20,'#91613b')+line(x,y-16,x,y+16,'#48382b',3)+line(x-11,y-10,x+11,y+10,'#48382b',3)+line(x-11,y+10,x+11,y-10,'#48382b',3)+ellipse(x,y,4,6,'#c7aa76');
  return ellipse(116,155,73,9,'#182d29','opacity=".13"')+wheel(148,123)+poly('54,69 133,48 185,75 109,100','#cba16a')+poly('54,69 109,100 109,138 55,105','#9d683f')+poly('109,100 185,75 181,114 109,138','#765035')+poly('67,70 133,55 171,75 108,93','#5e482f')+[0,1,2].map(i=>line(56,78+i*12,109,108+i*12,'#513a28',2)+line(110,108+i*12,182,85+i*12,'#493629',2)).join('')+line(54,69,54,111,'#d6b078',5)+line(109,98,109,140,'#bd915a',5)+line(184,75,181,118,'#b58c55',5)+wheel(91,131)+line(162,108,203,141,'#a27b4a',6)+line(173,103,218,133,'#b88f58',6);
}
function backpack(level) {
  const colors=[['#a1784c','#c8a36c','#795135'],['#4d7667','#8ba689','#345547'],['#567687','#98b0b1','#374f63'],['#784e50','#b98c78','#523c45']][level];
  return ellipse(121,155,44,8,'#182d29','opacity=".13"')+path('M84 57Q59 73 71 144L83 144Q75 89 94 75M151 57Q177 78 163 144L151 141Q165 88 140 75','#594934')+path('M104 45Q99 23 121 23Q144 24 141 46L132 45Q134 33 122 32Q110 33 113 45Z','#b28b5e')+path('M85 45Q119 32 153 47L164 139Q121 164 76 139Z',colors[0])+path('M85 45L95 62L91 143L76 139Z',colors[2])+path('M95 62L150 58L156 140L91 148Z',colors[0])+path('M83 45Q122 33 155 47L151 86Q123 99 88 84Z',colors[1])+path('M88 79Q122 91 153 79L151 88Q120 101 88 86Z',colors[2])+rect(99,62,9,41,'#91683e')+rect(135,61,9,43,'#91683e')+rect(97,81,13,14,'#d5b772','rx="2"')+rect(133,81,13,14,'#d5b772','rx="2"')+rect(101,84,5,8,'#4f4635')+rect(137,84,5,8,'#4f4635')+path('M102 111L142 109L144 136Q121 146 103 138Z',colors[2])+path('M102 111L142 109L141 118L104 122Z',colors[1])+rivet(122,117)+(level>0?group('translate(64 48) rotate(-5)',rect(0,0,113,21,'#aaa783','rx="10"')+ellipse(5,10,6,10,'#767c65')+ellipse(5,10,3,6,'#a2a78b')+rect(25,0,8,21,'#745b3e')+rect(79,0,8,21,'#745b3e')):'')+(level>1?path('M155 96L173 97L175 128L162 133Z','#b1a587')+rect(161,91,10,9,'#8a7657'):'')+(level>2?poly('121,51 127,60 124,72 116,72 112,60','#e1bb65')+poly('121,55 123,62 121,67 118,62','#fff0bc'):'');
}
function bread() {
  return ellipse(118,139,62,10,'#382e20','opacity=".14"')+path('M55 115Q40 83 76 64Q118 34 162 61Q190 80 182 115Q122 151 55 115Z','#a16431')+path('M55 105Q53 80 79 67Q119 43 159 64Q182 80 179 102Q119 134 55 105Z','#ddb265')+path('M61 104Q115 127 177 99L172 112Q115 140 59 113Z','#c18d46')+[0,1,2].map(i=>path(`M${85+i*28} ${65-i*2}Q${68+i*28} ${83-i*2} ${91+i*28} ${96-i*2}Q${78+i*28} ${79-i*2} ${94+i*28} ${66-i*2}Z`,'#f5d793')).join('')+[0,1,2,3,4,5].map(i=>ellipse(71+i*18,103+(i%2)*5,1.5,1,'#efd3a0')).join('');
}
function meal(feast=false) {
  return ellipse(118,136,75,19,'#b9b8a0')+ellipse(118,128,75,19,'#e2dcc1')+ellipse(118,128,63,14,'#77794e')+(feast?path('M91 117Q71 76 113 65Q159 53 169 94L178 113Q147 144 91 117Z','#925130')+path('M94 100Q89 72 120 69Q150 67 159 93L167 111Q134 126 100 111Z','#c48141')+path('M95 93Q112 74 141 84L146 93Q120 87 108 104Z','#e0a35a')+path('M157 103L182 85L185 90L166 115Z','#ae794b')+ellipse(184,85,8,6,'#ede0ba')+ellipse(188,91,6,7,'#ede0ba'):path('M67 101Q116 125 165 100L157 129Q116 157 76 129Z','#8b6b42')+ellipse(116,100,49,16,'#c29b61')+ellipse(116,100,42,12,'#69462d')+ellipse(117,101,36,9,'#b27836')+[0,1,2,3,4,5].map(i=>ellipse(90+(i%3)*23,98+Math.floor(i/3)*7,6,3,['#dbaa55','#c48442','#819356'][i%3])).join(''))+[0,1,2].map(i=>group(`translate(${feast?64+i*14:174} ${feast?115+i%2*9:106+i*10}) rotate(${i*32})`,ellipse(0,0,14,6,'#698456')+line(-8,0,10,0,'#a5b277',1))).join('')+(feast?group('translate(-14 61) scale(.42)',bread()):line(178,72,175,126,'#c0b18b',5)+ellipse(179,66,6,10,'#b8b7a4'));
}
function horse() {
  return ellipse(117,158,71,8,'#172922','opacity=".16"')+path('M52 76Q33 78 34 121L25 133Q39 132 42 112Q43 88 61 87Z','#4a3024')+path('M76 100L66 151L57 151L62 101M135 98L150 145L143 151L122 107','#795332')+path('M59 72Q87 60 119 69L144 57L157 88Q139 112 99 111L65 105Q50 93 59 72Z','#a97845')+path('M114 75Q134 71 137 42L141 28L172 40L165 62L154 84L143 98Z','#a97845')+path('M139 46L136 70L128 81L143 84L149 61L157 43Z','#c59a61')+path('M141 29L142 16L151 27L164 18L165 37L179 51Q184 63 172 65L154 53L146 42Z','#bd8a52')+path('M167 43L182 54L179 64L167 59Z','#d7b685')+path('M144 29Q131 40 130 66L121 77L133 72Q145 57 145 39L155 32Z','#50372a')+ellipse(164,40,2.4,2.4,'#1f2b24')+ellipse(165,39.4,.7,.7,'#e3d2a9')+line(169,53,180,54,'#6f523b',1.8)+path('M70 104L76 151L87 152L84 106M134 99L127 151L138 151L147 100','#ba8a51')+path('M77 146L76 154L88 155L87 147M126 146L125 155L138 155L139 147M58 146L55 154L68 154L67 146M142 145L142 153L153 148L149 141','#413c31')+path('M80 74L113 75L119 98L85 100Z','#657869')+path('M81 73Q94 67 110 73L115 84Q98 86 83 82Z','#704930')+line(100,85,100,113,'#725233',4)+ellipse(101,115,5,7,'none','stroke="#bba570" stroke-width="3"')+path('M157 36L152 54L171 60M153 53Q135 81 109 81','none','stroke="#6f523b" stroke-width="3"');
}
function wheat() {
  let body='';
  for(let i=0;i<7;i++){
    const x=89+i*10,top=30+Math.abs(i-3)*7;
    let stem=line(119,153,x,top,'#a38540',2.8);
    for(let j=0;j<5;j++)stem+=ellipse(x-5,top+8+j*10,3.7,7.1,j%2?'#dfbc61':'#cda449',`transform="rotate(-39 ${x-5} ${top+8+j*10})"`)+ellipse(x+5,top+8+j*10,3.7,7.1,'#e9c775',`transform="rotate(39 ${x+5} ${top+8+j*10})"`);
    body+=stem;
  }
  return body+path('M101 117Q120 123 137 118L135 126Q118 130 104 125Z','#9c7140')+path('M121 121Q151 127 133 140L120 127Q99 139 105 128Z','none','stroke="#dab77c" stroke-width="3"');
}
function timber() {
  const log=(x,y)=>poly(`${x},${y} ${x+75},${y-30} ${x+90},${y-13} ${x+10},${y+23}`,'#855635')+poly(`${x},${y} ${x+75},${y-30} ${x+82},${y-23} ${x+7},${y+8}`,'#ba8650')+line(x+15,y+10,x+77,y-15,'#573d2a',2)+ellipse(x+6,y+10,15,18,'#d3b078',`transform="rotate(-20 ${x+6} ${y+10})"`)+ellipse(x+6,y+10,10,12,'none',`stroke="#a47745" stroke-width="2" transform="rotate(-20 ${x+6} ${y+10})"`)+ellipse(x+6,y+10,4,5,'#bc905a')+line(x+5,y+9,x-4,y+21,'#9b7345',1.4);
  return log(66,116)+log(99,123)+log(83,87);
}
function ore(kind) {
  const palette=kind==='sulfur'?['#c6ad3b','#efe08a','#81722b','#fff0a4']:kind==='coal'?['#354246','#526066','#202d34','#738086']:kind==='iron'?['#687b7c','#9daba5','#485a61','#c39263']:['#7b8c88','#b0b9a5','#596e70','#ced0b5'];
  return ellipse(120,147,69,8,'#213c34','opacity=".13"')+poly('51,119 75,78 122,62 166,76 190,117 174,145 81,149',palette[0])+poly('75,78 122,62 145,96 92,111 51,119',palette[1])+poly('145,96 166,76 190,117 174,145 137,140',palette[2])+poly('51,119 92,111 112,136 81,149',palette[2])+poly('92,111 145,96 137,140 112,136',palette[0])+line(79,85,116,73,palette[3],2)+(kind==='iron'?poly('91,91 103,85 115,94 110,109 98,112','#bb8b5b')+poly('91,91 102,91 104,104 98,112','#e0b781')+poly('149,116 163,108 172,119 163,128','#bb8b5b')+poly('148,80 157,83 156,93 151,98 145,94','#c39c69'):'')+poly('49,141 60,128 75,134 79,150 59,154',palette[1])+poly('173,150 187,136 201,145 195,155',palette[2]);
}
function gold() {
  const coin=(x,y,rx=23,ry=8)=>ellipse(x,y+5,rx,ry,'#997237')+rect(x-rx,y,rx*2,5,'#b48b3f')+ellipse(x,y,rx,ry,'#e5c470')+ellipse(x,y,rx-4,ry-2,'none','stroke="#aa873f" stroke-width="1.3"');
  let art=ellipse(121,150,70,8,'#18352b','opacity=".12"');
  for(const [x,bottom,count] of [[93,137,4],[144,131,6],[113,112,7]])for(let i=0;i<count;i++)art+=coin(x,bottom-i*6);
  art+=ellipse(71,139,21,7,'#d7b35a')+ellipse(166,148,21,7,'#d7b35a')+ellipse(71,139,16,4.5,'none','stroke="#9d7938" stroke-width="1.4"')+ellipse(166,148,16,4.5,'none','stroke="#9d7938" stroke-width="1.4"');
  art+=group('rotate(13 151 83)',ellipse(151,83,25,31,'#95703b')+ellipse(149,82,23,29,'#e4be61')+ellipse(149,82,18,24,'none','stroke="#ae873e" stroke-width="2"')+poly('149,65 159,71 157,85 149,96 141,86 139,71','#b38a3e')+path('M149 70L153 78L147 82L151 88L146 91L143 80Z','#f4d786'));
  return art;
}
const ITEM_NAMES = new Set(['axe','pickaxe','scythe','hammer','sword','bow','arrows','musket','gunpowder','musket_ammo','cart','backpack','food','good_food','best_food','horse','wheat','timber','stone','iron','coal','sulfur','gold']);

/** Decorative catalog illustration. Callers provide accessible item names outside the SVG. */
export function itemArt(itemId, options = {}) {
  const safe = options && typeof options === 'object' ? options : {};
  let id = typeof itemId === 'string' ? itemId : '';
  if(id === 'resource' && ITEM_NAMES.has(safe.resource)) id = safe.resource;
  if(!ITEM_NAMES.has(id)) id = 'backpack';
  const tier = own(TIERS,safe.tier) ? safe.tier : 'wood', t=TIERS[tier];
  const rawLevel=typeof safe.level==='number'?safe.level:typeof safe.tier==='number'?safe.tier:0;
  const level=Number.isFinite(rawLevel)?Math.max(0,Math.min(3,Math.floor(rawLevel))):0;
  const drawing=({axe:()=>axe(t),pickaxe:()=>pickaxe(t),scythe:()=>scythe(t),hammer:()=>hammer(t),sword:()=>sword(t),bow,arrows,musket,gunpowder:powder,musket_ammo:musketShots,cart,backpack:()=>backpack(level),food:bread,good_food:()=>meal(),best_food:()=>meal(true),horse,wheat,timber,stone:()=>ore('stone'),iron:()=>ore('iron'),coal:()=>ore('coal'),sulfur:()=>ore('sulfur'),gold})[id]();
  return `<svg xmlns="http://www.w3.org/2000/svg" class="shop-item-illustration" viewBox="0 0 240 180" width="240" height="180" aria-hidden="true" focusable="false" data-item="${id}" data-tier="${id==='backpack'?level:tier}">${ellipse(120,157,55,6,'#1a302a','opacity=".10"')}${drawing}</svg>`;
}

function keeper(theme) {
  const color={tools:'#66705b',weapons:'#697582',tinker:'#718872',food:'#a3a076',merchant:'#857184',stable:'#88865e',bank:'#587773',market:'#8d805a'}[theme];
  return group('translate(847 107)',
    // Broad, rounded silhouette with bent elbows, a leather apron and braided beard.
    path('M38 115Q10 107 0 131L-15 185Q-20 204 0 206L48 187L57 144Z',color)+path('M149 114Q177 108 188 134L206 184Q211 203 191 207L151 185L136 143Z',color)+path('M49 110Q93 96 143 112Q159 146 155 213L33 213Q30 150 49 110Z',color)+path('M58 115L67 142L129 142L137 114L148 213L44 213Z','#705039')+path('M69 143Q99 151 129 142L137 213L54 213Z','#8d6643')+path('M48 128L41 157M151 129L163 159','none','stroke="#c2c1a0" stroke-width="3" opacity=".28"')+path('M48 185Q69 183 78 198L72 212L39 213L5 209Q-7 202 3 191L28 193Z','#ce9c6b')+path('M151 185Q124 188 121 200L126 212L158 215L195 209Q207 199 194 191L169 194Z','#ce9c6b')+
    ellipse(42,65,11,17,'#be875b')+ellipse(153,65,11,17,'#be875b')+path('M48 38Q60 5 102 13Q145 12 152 49L149 91Q132 119 101 117Q69 114 48 91Z','#d1a06f')+path('M48 62L58 69L62 90Q80 111 100 112Q120 114 140 93L149 63L151 91Q136 125 102 128Q67 121 48 92Z','#ae764d')+path('M50 67Q43 96 59 125L77 154L100 172L128 153Q157 125 148 68L135 88L117 99L89 100L66 85Z','#6f4a31')+path('M54 92Q64 116 83 122L91 152L100 160L105 126Q132 120 144 95L141 127L120 151L100 169L78 150L61 125Z','#956640')+path('M69 104Q80 115 85 138M122 108Q113 124 112 146M101 123L101 150','none','stroke="#c48b52" stroke-width="2.8" opacity=".65"')+ellipse(100,162,9,4,'#c2a367')+path('M72 81Q86 74 101 89Q113 72 132 81L139 93Q115 100 101 92Q86 103 66 93Z','#6c452b')+path('M74 83Q91 80 100 91Q114 80 132 84','none','stroke="#a87a4a" stroke-width="3"')+path('M96 65Q90 80 96 84L108 83L110 76L105 64Z','#deb184')+ellipse(100,82,10,5,'#e0b184')+path('M65 58Q76 52 86 57M117 57Q129 51 139 57','none','stroke="#593f2b" stroke-width="5"')+ellipse(77,64,4.5,3,'#3d4134')+ellipse(127,64,4.5,3,'#3d4134')+ellipse(78,63.5,1,1,'#f4dfb3')+ellipse(128,63.5,1,1,'#f4dfb3')+
    (theme==='food'?path('M49 42Q33 28 49 13Q42-5 65-8Q79-25 99-13Q123-23 138-8Q166-4 161 17Q175 36 150 44Z','#d6cfad')+path('M49 32Q101 21 152 33L151 46Q102 34 48 46Z','#ede5c4'):
     theme==='weapons'?path('M48 42Q50 1 101 0Q149 0 153 43L146 49Q100 37 53 49Z','#748084')+path('M91 3L103 0L114 4L113 41L94 41Z','#b4b59e')+path('M46 41Q99 29 155 41L153 51Q97 42 48 52Z','#515f64'):
     path('M47 39Q46 4 93 1Q142-2 153 39L146 44Q93 30 50 46Z',theme==='merchant'?'#8b5e67':theme==='bank'?'#3d5c59':'#64563d')+path('M46 35Q95 22 154 36L152 47Q99 35 47 49Z',theme==='merchant'?'#bea077':theme==='bank'?'#c7b177':'#9e8557'))+
    (theme==='tinker'?ellipse(76,62,13,11,'none','stroke="#b5a46d" stroke-width="3"')+ellipse(127,62,13,11,'none','stroke="#b5a46d" stroke-width="3"')+line(89,61,114,61,'#b5a46d',3):'')
  );
}
function barrel(x,y,scale=1) {
  return group(`translate(${x} ${y}) scale(${scale})`,path('M7 9Q38-1 70 9Q86 64 68 109Q37 120 7 108Q-8 61 7 9Z','#87623d')+path('M9 13Q20 7 29 7L26 110L9 107Q-3 62 9 13Z','#b18953')+path('M44 8L62 10Q77 63 62 109L44 113Z','#a47843')+[30,84].map(a=>path(`M1 ${a}Q37 ${a+11} 78 ${a}L78 ${a+10}Q38 ${a+22} 1 ${a+10}Z`,'#555d52')+rivet(16,a+9)+rivet(61,a+9)).join('')+ellipse(38,9,31,10,'#c39b60')+ellipse(38,9,25,6,'#8a643e')+line(19,8,57,8,'#ba9056',2));
}
function grainSack(x,y,scale=1) {
  return group(`translate(${x} ${y}) scale(${scale})`,path('M20 17L14 3L32 8L51 1L48 18Q72 42 64 86Q33 100 6 85Q-2 47 20 17Z','#a58b57')+path('M20 24Q6 52 14 84L27 87Q18 51 28 25Z','#c1a96f')+path('M40 26Q59 50 57 85L66 84Q76 44 48 20Z','#7f7048')+path('M19 17Q34 24 49 17L50 25Q33 30 18 24Z','#745934')+path('M21 21L44 23','none','stroke="#d4b774" stroke-width="3"')+path('M33 45L33 75M32 52L24 48M34 57L43 51M32 63L23 58M34 68L43 62','none','stroke="#e0c482" stroke-width="2.4"')+line(13,87,11,38,'#766140',1.2));
}
function marketScales(x,y,scale=1) {
  return group(`translate(${x} ${y}) scale(${scale})`,path('M47 92L106 92L115 106L38 106Z','#a58349')+path('M62 89L90 89L96 97L55 97Z','#d0b46f')+rect(72,17,8,76,'#bf9d58')+poly('68,17 76,5 85,17 76,26','#e1c174')+line(17,32,135,32,'#c6aa65',6)+line(24,34,8,73,'#a08e5a',1.8)+line(24,34,41,73,'#a08e5a',1.8)+line(126,34,109,73,'#a08e5a',1.8)+line(126,34,143,73,'#a08e5a',1.8)+path('M2 72H46Q42 87 24 88Q5 87 2 72Z','#af894b')+path('M104 72H149Q144 87 126 88Q108 87 104 72Z','#af894b')+ellipse(24,72,22,3,'#debe76')+ellipse(126,72,22,3,'#debe76')+poly('113,69 118,58 130,56 138,68','#657975')+poly('118,58 130,56 128,65 113,69','#94a196'));
}
function vaultDoor(x,y) {
  return group(`translate(${x} ${y})`,path('M0 171V30Q1 0 33 0H127Q157 0 158 31V171Z','#293b3a')+path('M8 164V32Q10 9 35 9H124Q148 9 148 32V164Z','#768681')+path('M20 156V36Q20 21 39 21H121Q136 22 136 36V156Z','#435c5b')+path('M28 149V38Q29 29 43 29H118Q128 29 128 39V148Z','#57716b')+rect(35,43,82,92,'#344e4a','rx="4"')+ellipse(78,88,30,30,'#a79059')+ellipse(78,88,23,23,'#526a60')+[0,1,2,3].map(i=>{const a=i*Math.PI/2;return line(78,88,78+Math.cos(a)*25,88+Math.sin(a)*25,'#c7ad6c',5);}).join('')+ellipse(78,88,8,8,'#d6bc7b')+rect(119,48,21,12,'#b4a176','rx="2"')+rect(119,124,21,12,'#b4a176','rx="2"')+[32,57,104,129].map(yy=>rivet(25,yy)+rivet(142,yy)).join('')+rect(56,148,42,6,'#baa16b','rx="2"'));
}
function ledger(x,y,scale=1) {
  return group(`translate(${x} ${y}) scale(${scale})`,poly('0,9 53,1 102,11 95,51 49,43 2,53','#5b4434')+poly('4,7 52,0 98,9 93,45 50,38 6,47','#e5d5a5')+poly('52,0 50,38 47,38 48,0','#a18a5b')+[0,1,2,3].map(i=>line(13,14+i*7,41,10+i*7,'#a7966b',1.1)+line(61,10+i*7,88,14+i*7,'#a7966b',1.1)).join('')+poly('66,28 71,28 69,51 64,48','#a15e48'));
}
function wallTorch(x,y) {
  // Open flame, wrapped timber and an iron wall bracket match the village torches.
  return group(`translate(${x} ${y})`,ellipse(2,-14,72,96,'#eac478','opacity=".025"')+ellipse(2,-14,43,63,'#ffd691','opacity=".065"')+rect(3,10,16,35,'#383d34','rx="4"')+rivet(11,16)+rivet(11,39)+path('M11 29L-3 23L-6 13','none','stroke="#272e29" stroke-width="5"')+line(-6,3,-2,43,'#8c6038',8)+line(-7,5,-5,37,'#c2914e',2)+path('M-12 2C-25-16-7-24-7-44C6-36 7-28 5-19C15-24 17-35 16-39C31-16 21 5 5 10Z','#d97837')+path('M-7 3C-17-10-4-20-3-32C7-25 9-18 5-7C12-9 14-16 14-20C20-5 12 8 2 8Z','#edb957')+path('M-3 7Q-10-5 2-17Q1-7 9-1Q11 9-3 7Z','#fff0b0')+path('M-14 1L12 3L7 13L-10 12Z','#534a36')+line(-11,5,9,6,'#b09a66',3)+line(-9,10,6,11,'#776544',2));
}
function insetArt(id,x,y,w=140,h=105,options={}) { return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 240 180" aria-hidden="true">${itemArt(id,options).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</svg>`; }

/** Panoramic illustrated shop interior; safe to embed multiple themes on one page. */
export function shopInterior(theme='tools') {
  theme=own(THEME_COLORS,theme)?theme:'tools';
  const [wall,stone,wood,accent]=THEME_COLORS[theme];
  let body=rect(0,0,1400,480,wall)+poly('0,0 1400,0 1220,112 180,112','#282e2b')+poly('0,480 1400,480 1210,312 190,312','#796e50')+poly('0,0 192,112 192,320 0,480','#393a30')+poly('1400,0 1210,112 1210,320 1400,480','#33382f');
  // Irregular masonry and exposed timber establish the room's depth.
  for(let row=0;row<5;row++)for(let col=0;col<12;col++){
    const x=191+col*89-(row%2)*43,y=115+row*40;
    body+=rect(x,y,84+(col%2)*2,35,stone,`rx="3" opacity="${.42+(row+col)%3*.08}"`)+line(x+5,y+3,x+78,y+3,'#d9c497',1);
  }
  body+=poly('0,0 52,0 222,107 222,329 187,342 187,122',wood)+poly('1348,0 1400,0 1217,125 1217,332 1187,320 1187,107',wood)+rect(183,92,1036,29,'#715539')+rect(193,95,1018,6,'#b19059')+poly('360,0 395,0 488,95 459,95','#71583b')+poly('999,0 1036,0 934,94 905,94','#71583b')+rect(687,0,31,110,'#73563a')+rect(691,0,6,104,'#a28655')+rect(688,112,29,209,'#705138')+rect(691,114,5,201,'#aa8550');
  // Scored grain, pegged beams and small stone chips avoid blank architectural planes.
  for(const x of [191,694,1193]){
    body+=path(`M${x+8} 131Q${x+13} 180 ${x+8} 212T${x+11} 306`,'none','stroke="#392e23" stroke-width="1.5" opacity=".32"');
    body+=ellipse(x+10,241,3.5,9,'none','stroke="#4c3827" stroke-width="1.3" opacity=".42"');
    body+=rivet(x+12,130)+rivet(x+12,307);
  }
  body+=path('M437 99Q499 94 550 100T662 99M763 108Q832 102 891 105T1007 104','none','stroke="#4e3d29" stroke-width="1.4" opacity=".5"');
  for(const [x,y] of [[412,134],[602,163],[805,178],[984,143],[1080,285],[571,308]])body+=poly(`${x},${y} ${x+13},${y-4} ${x+8},${y+3}`,accent,'opacity=".28"');
  for(let i=0;i<12;i++)body+=line(700+(i-6)*79,313,700+(i-6)*180,480,'#514d3b',2);
  for(let i=0;i<4;i++)body+=line(0,336+i*i*12,1400,336+i*i*12,'#514d3b',2);
  body+=path('M258 263L258 176Q258 116 316 116Q376 117 376 176L376 263Z','#b2a27c')+path('M270 259L270 176Q270 129 317 129Q363 130 363 176L363 259Z','#a5b99c')+path('M272 204L305 166L329 197L363 176L363 259L270 259Z','#758d79')+path('M270 235Q311 210 363 235L363 259L270 259Z','#516f60')+rect(311,132,10,132,'#66533a')+rect(270,186,93,8,'#6e5b40')+rect(250,260,134,13,'#a68756')+poly('271,185 309,194 441,316 346,316','#f6d595','opacity=".035"');
  // Back-wall display racks differ by trade. Hooks, shelves and stock sit behind the counter.
  body+=rect(423,146,229,152,'#303b32','rx="3"')+rect(426,147,8,151,wood)+rect(643,147,8,151,wood)+rect(425,281,228,10,'#bc9155');
  let props='';
  if(theme==='tools') props=insetArt('axe',426,152,112,104,{tier:'stone'})+insetArt('pickaxe',530,150,121,108,{tier:'iron'})+insetArt('hammer',471,229,99,76,{tier:'iron'})+barrel(1048,224,.78)+insetArt('timber',1087,240,142,106);
  if(theme==='weapons') props=insetArt('sword',419,150,109,133,{tier:'iron'})+insetArt('sword',498,151,112,132,{tier:'stone'})+insetArt('sword',568,154,85,124,{tier:'wood'})+path('M1070 170L1148 170L1143 244L1108 274L1074 244Z','#8b5746')+path('M1078 178L1139 178L1135 239L1108 263L1082 239Z','#bd9470')+path('M1088 189L1129 189L1125 235L1108 250L1092 235Z','#5d7471')+poly('1108,195 1113,214 1129,218 1114,225 1108,241 1102,225 1088,218 1102,214','#d6bd7e')+insetArt('arrows',1099,267,117,90);
  if(theme==='tinker') props=insetArt('bow',427,151,130,139)+insetArt('arrows',536,151,97,133)+insetArt('backpack',1071,196,132,123,{level:2})+insetArt('cart',1090,274,171,126);
  if(theme==='food') props=rect(426,212,226,8,'#b8925b')+[0,1,2].map(i=>insetArt('food',422+i*68,150,93,65)+insetArt(i===1?'best_food':'good_food',422+i*69,224,98,64)).join('')+barrel(1105,238,.75)+insetArt('wheat',1023,199,146,129)+insetArt('best_food',1072,300,159,110);
  if(theme==='merchant') props=rect(426,217,226,8,'#b8925b')+insetArt('backpack',428,160,111,127,{level:3})+insetArt('iron',534,221,104,72)+insetArt('good_food',547,157,98,73)+path('M1043 140L1178 140L1169 251L1153 272L1135 252L1110 275L1088 254L1067 273L1051 254Z','#886473')+path('M1054 151L1167 151L1159 243L1136 233L1110 253L1088 234L1062 248Z','#b7986d')+poly('1110,167 1148,203 1110,238 1072,203','#766678')+poly('1110,178 1137,203 1110,227 1083,203','#d1b67d')+insetArt('iron',1080,314,142,86)+barrel(1197,263,.6);
  if(theme==='stable') props=insetArt('backpack',428,154,133,137,{level:1})+insetArt('wheat',543,155,101,130)+path('M1024 295L1024 172Q1075 106 1177 154L1177 306Z','#273c33')+insetArt('horse',996,140,235,178)+rect(1022,272,183,15,'#977346')+rect(1022,309,183,12,'#785b3b')+rect(1023,229,15,97,'#b28952')+rect(1185,229,15,97,'#b28952')+insetArt('wheat',1085,302,151,110);
  if(theme==='bank') props=rect(426,216,226,8,'#ad966a')+[0,1,2].map(i=>insetArt('gold',429+i*65,148,92,70)).join('')+insetArt('gold',429,220,116,74)+ledger(550,238,.75)+vaultDoor(1032,135)+path('M1082 128L1140 128L1140 140L1082 140Z','#b49d68');
  if(theme==='market') props=marketScales(453,166,1.1)+grainSack(1063,228,.9)+grainSack(1120,246,.8)+barrel(1174,245,.58)+insetArt('wheat',1076,166,99,100)+insetArt('timber',1036,255,116,73)+poly('1044,291 1105,281 1131,294 1068,309','#97703f')+poly('1044,291 1068,309 1068,323 1044,311','#bb9155')+poly('1068,309 1131,294 1131,309 1068,323','#765634')+line(1069,316,1130,301,'#c29b60',3)+line(1050,295,1050,315,'#614c30',3)+line(1124,295,1124,313,'#c4a16c',3)+rect(416,276,243,17,'#a5804b')+path('M419 280H655','none','stroke="#d5b678" stroke-width="2"');
  body+=props+keeper(theme);
  // Counter spans the room; inlaid edges, drawers and forged nails give foreground scale.
  body+=poly('307,322 1161,322 1261,377 226,377','#bc915b')+poly('315,326 1157,326 1228,367 254,367','#9d794b')+line(320,335,1161,335,'#d1ad72',2)+line(297,351,1192,351,'#795b38',2)+poly('226,377 1261,377 1261,403 226,403','#6b4c33')+rect(226,378,1035,6,'#e1bc79')+poly('239,403 1248,403 1248,480 239,480','#785337')+rect(258,414,971,66,'#926b42')+[283,548,813,1078].map(x=>rect(x,423,221,57,'#674c34','rx="2"')+rect(x+5,428,211,52,'#a47a46','rx="2"')+rect(x+88,437,44,7,'#554b36','rx="3"')+rivet(x+10,431)+rivet(x+210,431)).join('')+rect(704,393,40,87,'#b08b51')+poly('708,400 740,400 740,480 708,480','#927144');
  // A balanced stock vignette on the countertop survives narrow viewport crops.
  body+=path('M540 346Q611 341 652 346T732 345M1011 359Q1083 352 1171 357','none','stroke="#67482f" stroke-width="1.6" opacity=".55"');
  body+=ellipse(598,352,13,3,'none','stroke="#61472e" stroke-width="1.2" opacity=".35"');
  body+=insetArt(theme==='food'?'food':theme==='weapons'?'sword':theme==='tinker'?'bow':theme==='merchant'?'backpack':theme==='stable'||theme==='market'?'wheat':theme==='bank'?'gold':'hammer',386,284,158,114,{tier:'iron',level:3});
  if(theme==='tinker')body+=insetArt('arrows',507,306,109,75);
  if(theme==='bank')body+=ledger(578,337,.76)+line(664,342,681,365,'#ddcba1',2.3);
  if(theme==='market')body+=insetArt('iron',550,308,120,76)+insetArt('timber',1063,308,135,76);
  body+=path('M761 343L804 343L816 359L769 361Z','#d9c394')+line(771,348,797,347,'#8e7f5c',1.4)+line(775,353,803,352,'#8e7f5c',1.4)+ellipse(821,353,7,3,'#d6b568')+ellipse(831,357,7,3,'#b8944b')+ellipse(821,350,7,3,'#e7c978');
  body+=wallTorch(742,173)+wallTorch(1160,85)+path('M0 0H1400V480H0Z','none','stroke="#172d29" stroke-width="14" opacity=".22"');
  // Gentle, sparse motes. Static decoration, not a page-level animation workload.
  for(const [x,y] of [[311,291],[331,216],[383,262],[768,244],[711,212],[780,195],[1111,103],[1210,220]])body+=ellipse(x,y,1.5,1.5,'#f2dab0','opacity=".35"');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="shop-interior-art" viewBox="0 0 1400 480" width="1400" height="480" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-shop-theme="${theme}">${body}</svg>`;
}
