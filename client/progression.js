/* Rooster progression rules shared by UI and authoritative match setup. */
(function(root){
  'use strict';
  const TYPES={grain:{label:'Thóc',score:1},grasshopper:{label:'Châu chấu',score:5},hen:{label:'Gà mái',score:20}};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function integer(v){v=Number(v);return Number.isFinite(v)?Math.max(0,Math.floor(v)):0;}
  function normalizeRooster(raw={}){
    return {id:typeof raw.id==='string'?raw.id:'',name:Array.from(String(raw.name||'Chiến kê').normalize('NFC').trim()).slice(0,24).join('')||'Chiến kê',grain:integer(raw.grain),grasshopper:integer(raw.grasshopper),hen:integer(raw.hen)};
  }
  function rewardScore(rooster){const r=normalizeRooster(rooster);return r.grain*TYPES.grain.score+r.grasshopper*TYPES.grasshopper.score+r.hen*TYPES.hen.score;}
  function powerRating(rooster){return clamp(100+Math.floor(Math.sqrt(rewardScore(rooster))*2),100,130);}
  function matchRules(mode,left,right){const powerMode=mode==='progression'?'progression':'balanced';return {powerMode,powerRatings:powerMode==='progression'?[powerRating(left),powerRating(right)]:[100,100]};}
  root.RoosterProgression={TYPES,normalizeRooster,rewardScore,powerRating,matchRules};
  if(typeof module==='object'&&module.exports)module.exports=root.RoosterProgression;
})(typeof window!=='undefined'?window:globalThis);
