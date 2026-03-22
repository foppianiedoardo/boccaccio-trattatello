// scripts.js - carica xml/versione1.xml e xml/versione2.xml e costruisce la griglia
const propsOrder = ["p1","p2","p3"]; // ordine delle proposizioni; potremo generarlo dinamicamente
const grid = document.getElementById('grid');
const toggleBtn = document.getElementById('toggle-anno');

let annoVisible = true;
toggleBtn.addEventListener('click', () => {
  annoVisible = !annoVisible;
  document.body.classList.toggle('annot-visible', annoVisible);
});

// funzione per leggere un XML e restituire mappa id -> {text,type}
async function loadXMLMap(path){
  try{
    const res = await fetch(path);
    if(!res.ok) return {};
    const txt = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(txt, "application/xml");
    const props = xml.querySelectorAll('prop');
    const map = {};
    props.forEach(p => {
      const id = p.getAttribute('id') || p.getAttribute('xml:id') || p.id;
      const type = p.getAttribute('type') || '';
      const text = p.textContent.trim();
      if(id) map[id] = {text,type};
    });
    return map;
  }catch(e){
    console.error("Errore caricamento XML", e);
    return {};
  }
}

// costruisce la griglia: per ogni prop in propsOrder crea due celle (v1, v2)
function buildGrid(map1, map2){
  // rimuovi eventuali righe precedenti (lascia header già presente)
  // rimuoviamo tutte le righe non-header
  const existing = Array.from(grid.querySelectorAll('.data-row'));
  existing.forEach(n => n.remove());

  propsOrder.forEach(pid => {
    const rowLeft = document.createElement('div');
    rowLeft.className = 'cell data-row';
    const rowRight = document.createElement('div');
    rowRight.className = 'cell data-row';

    // versione 1
    if(map1[pid]){
      const span = document.createElement('span');
      span.className = 'prop';
      span.textContent = map1[pid].text;
      if(map1[pid].type) span.setAttribute('data-type', map1[pid].type);
      rowLeft.appendChild(span);
    } else {
      rowLeft.classList.add('empty');
    }

    // versione 2
    if(map2[pid]){
      const span = document.createElement('span');
      span.className = 'prop';
      span.textContent = map2[pid].text;
      if(map2[pid].type) span.setAttribute('data-type', map2[pid].type);
      rowRight.appendChild(span);
    } else {
      rowRight.classList.add('empty');
    }

    // inserisci le due celle nella griglia come due colonne affiancate
    grid.appendChild(rowLeft);
    grid.appendChild(rowRight);
  });
}

// inizializzazione
(async function init(){
  const map1 = await loadXMLMap('xml/versione1.xml');
  const map2 = await loadXMLMap('xml/versione2.xml');
  buildGrid(map1, map2);
})();
