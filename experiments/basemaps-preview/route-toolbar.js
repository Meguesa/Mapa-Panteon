(function(){
'use strict';

let lastDestination=null;
let selectionMode=false;
let routeButton=null;
let searchButton=null;
let backButton=null;
let sectionSelect=null;
let manzanaSelect=null;
let searchInput=null;
let lastDestinationSignature='';

function destinationSignature(dest){
  if(!dest)return'';
  return `${dest.type||''}|${dest.label||''}|${Array.isArray(dest.coord)?dest.coord.join(','):''}`;
}

function ui(){return window.JP_ROUTE_UI||null}

function routeActive(){return Boolean(ui()?.active)}

function setToast(message,ms=2400){
  try{if(typeof window.toast==='function')return window.toast(message,ms)}catch{}
  console.info('[Rutas]',message)
}

function updateButton(){
  if(!routeButton)return;
  const active=routeActive();
  routeButton.classList.toggle('is-selecting',selectionMode&&!active);
  routeButton.classList.toggle('is-routing',active);
  routeButton.setAttribute('aria-pressed',(selectionMode||active)?'true':'false');

  if(active){
    routeButton.textContent='Quitar ruta';
    routeButton.title='Quitar la ruta actual';
  }else if(selectionMode){
    routeButton.textContent='Selecciona destino…';
    routeButton.title='Selecciona sección, manzana y lote; o busca una propiedad';
  }else{
    routeButton.textContent='Cómo llegar';
    routeButton.title=lastDestination?'Calcular ruta a la propiedad seleccionada':'Elegir una propiedad y calcular la ruta';
  }
}

function setSelectionMode(value,{announce=true}={}){
  selectionMode=Boolean(value);
  window.JP_ROUTE_SELECTION_MODE=selectionMode;
  if(selectionMode&&announce){
    setToast('Selecciona una sección, una manzana y después un lote; también puedes buscar la propiedad directamente.',3600);
  }
  updateButton();
}

function clearDestination(){
  lastDestination=null;
  lastDestinationSignature='';
  window.JP_ROUTE_DESTINATION=null;
  updateButton();
}

function rememberDestination(dest){
  if(!dest?.coord)return;
  lastDestination=dest;
  lastDestinationSignature=destinationSignature(dest);
  window.JP_ROUTE_DESTINATION=dest;
  updateButton();
}

async function goToDestination(dest){
  const api=ui();
  if(!api?.go||!dest?.coord)return;
  rememberDestination(dest);
  setSelectionMode(false,{announce:false});

  if(dest.type==='nicho'){
    try{window.NICHOS_V2_PREVIEW?.close?.()}catch{}
    await new Promise(resolve=>setTimeout(resolve,80));
  }

  try{
    await api.go(dest);
  }finally{
    setTimeout(updateButton,80);
  }
}

async function handleRouteButton(){
  const api=ui();
  if(!api){
    setToast('La navegación todavía está cargando. Intenta de nuevo en un momento.');
    return;
  }

  if(routeActive()){
    api.clear?.();
    setSelectionMode(false,{announce:false});
    updateButton();
    return;
  }

  if(lastDestination?.coord){
    await goToDestination(lastDestination);
    return;
  }

  setSelectionMode(!selectionMode);
}

function onDestinationSelected(event){
  const dest=event?.detail?.destination;
  if(!dest?.coord)return;
  const signature=destinationSignature(dest);
  if(signature===lastDestinationSignature&&!selectionMode)return;
  rememberDestination(dest);

  // Si el usuario primero pulsó "Cómo llegar", el siguiente lote/nicho
  // seleccionado se convierte inmediatamente en el destino.
  if(selectionMode){
    goToDestination(dest);
  }
}

function resetForNavigationLevelChange(){
  // Cambiar sección/manzana invalida el destino anterior, pero NO cancela
  // el modo "Cómo llegar": el usuario debe poder elegir sección -> manzana -> lote.
  clearDestination();
}

function handleBackBeforeMain(){
  // El botón Volver pertenece a app.js. Limpiamos únicamente la navegación
  // ANTES de permitir que el handler original regrese a lote -> manzana -> sección.
  try{ui()?.clear?.()}catch{}
  setSelectionMode(false,{announce:false});
  clearDestination();

  // La ruta usa fitBounds con espacio para el panel. Después de que app.js
  // cambie de nivel, forzamos un resize para evitar que la vista quede "atorada".
  setTimeout(()=>{
    try{window.JP_LEAFLET_MAP?.invalidateSize?.(true)}catch{}
  },120);
}

function onSearchClick(){
  // Buscar sigue funcionando exactamente como main. No iniciamos la ruta aquí;
  // el hook de showLoteInfo notificará el destino cuando la búsqueda termine.
  if(routeActive()){
    try{ui()?.clear?.()}catch{}
  }
  updateButton();
}

function dedupeStatusLegends(){
  const panel=document.getElementById('panelBody');
  if(!panel)return;

  // lotes-nv2-match.js ya muestra la leyenda oficial con la misma paleta de
  // Nichos V2. public-ui-fixes.js conserva una leyenda histórica adicional
  // ("Colores de disponibilidad"). Cuando ambas coinciden en la misma vista,
  // eliminamos únicamente la histórica para no repetir información.
  if(!panel.querySelector('.lot-nv2-legend'))return;
  panel.querySelectorAll('.jp-status-legend').forEach(el=>el.remove());
}

function installLegendDedupeObserver(){
  const panel=document.getElementById('panelBody');
  if(!panel||panel.dataset.jpLegendDedupe==='1')return;
  panel.dataset.jpLegendDedupe='1';
  dedupeStatusLegends();

  const observer=new MutationObserver(()=>dedupeStatusLegends());
  observer.observe(panel,{childList:true,subtree:true});
  window.JP_LEGEND_DEDUPE_OBSERVER=observer;
}

function install(){
  searchButton=document.getElementById('searchBtn');
  backButton=document.getElementById('backBtn');
  sectionSelect=document.getElementById('sectionSelect');
  manzanaSelect=document.getElementById('manzanaSelect');
  searchInput=document.getElementById('searchInput');
  if(!searchButton||!backButton)return false;

  if(!document.getElementById('routeBtn')){
    routeButton=document.createElement('button');
    routeButton.type='button';
    routeButton.id='routeBtn';
    routeButton.className='jp-route-toolbar-btn';
    routeButton.textContent='Cómo llegar';
    searchButton.insertAdjacentElement('afterend',routeButton);
    routeButton.addEventListener('click',handleRouteButton);
  }else{
    routeButton=document.getElementById('routeBtn');
  }

  window.addEventListener('jp:route-destination',onDestinationSelected);

  // capture=true: limpiamos la navegación antes del onclick original de app.js,
  // pero NO prevenimos el evento ni detenemos su propagación.
  backButton.addEventListener('click',handleBackBeforeMain,true);
  searchButton.addEventListener('click',onSearchClick,true);

  sectionSelect?.addEventListener('change',resetForNavigationLevelChange,true);
  manzanaSelect?.addEventListener('change',resetForNavigationLevelChange,true);
  searchInput?.addEventListener('input',()=>{
    if(lastDestination&&!selectionMode)clearDestination();
  });

  installLegendDedupeObserver();

  // El estado de la ruta puede cambiar desde la ficha o desde código externo.
  setInterval(()=>{
    updateButton();
    dedupeStatusLegends();
  },250);
  updateButton();
  console.info('[Rutas] Botón global “Cómo llegar” instalado junto a Buscar; leyenda duplicada controlada.');
  return true;
}

let attempts=0;
const timer=setInterval(()=>{
  attempts+=1;
  if(install()){
    clearInterval(timer);
    return;
  }
  if(attempts>240)clearInterval(timer);
},50);
})();
