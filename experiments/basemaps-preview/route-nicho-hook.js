(function(){
'use strict';
function sx(){try{return typeof COORD_SCALE_X==='number'&&COORD_SCALE_X>0?COORD_SCALE_X:1}catch{return 1}}
function sy(){try{return typeof COORD_SCALE_Y==='number'&&COORD_SCALE_Y>0?COORD_SCALE_Y:1}catch{return 1}}
function collect(v,out){if(!Array.isArray(v))return;if(v.length>=2&&typeof v[0]==='number'&&typeof v[1]==='number'){out.push([Number(v[0]),Number(v[1])]);return}v.forEach(x=>collect(x,out))}
function centerRaw(feature){const pts=[];collect(feature?.geometry?.coordinates,pts);if(!pts.length)return null;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;pts.forEach(p=>{minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1])});return[(minX+maxX)/2/sx(),(minY+maxY)/2/sy()]}
function destination(){const state=window.NICHOS_V2_PREVIEW?.state;if(!state?.selectedFeature||!state?.zoneFeature)return null;const coord=centerRaw(state.zoneFeature);if(!coord)return null;const p=state.selectedFeature.properties||{},code=p.codigo||p.id||'Nicho',zone=state.zoneId||state.zoneFeature?.properties?.id||'';return{type:'nicho',coord,label:`${zone?zone+' · ':''}${code}`,codigo:code,zona:zone,feature:state.selectedFeature,zoneFeature:state.zoneFeature}}
function emit(dest){if(!dest)return;try{window.dispatchEvent(new CustomEvent('jp:route-destination',{detail:{destination:dest}}))}catch{} }
function install(){const api=window.NICHOS_V2_PREVIEW,state=api?.state;if(!state?.selectedFeature)return;const dest=destination();if(!dest)return;const signature=`${dest.zona}|${dest.codigo}`;if(state.modal?.dataset?.jpLastRouteNicho===signature)return;if(state.modal)state.modal.dataset.jpLastRouteNicho=signature;emit(dest)}
const timer=setInterval(install,250);window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
})();