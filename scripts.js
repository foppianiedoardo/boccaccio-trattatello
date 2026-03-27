// scripts.js — carica XML con struttura period/seg/group/member e costruisce la griglia
const grid = document.getElementById('grid');
const toggleBtn = document.getElementById('toggle-anno');

let annoVisible = true;
toggleBtn.addEventListener('click', () => {
  annoVisible = !annoVisible;
  document.body.classList.toggle('annot-visible', annoVisible);
  if (!annoVisible) {
    tooltip.style.display = 'none';
  }
});

// Traduzione mode
const MODE_LABELS = { e: 'espl.', i: 'impl.', s: 'sott.' };

function modeLabel(mode) {
  return MODE_LABELS[mode] || mode || '';
}

function groupLabel(group) {
  const parts = [group.type];
  if (group.level != null) {
    parts.push(`(${group.level})`);
  }
  if (group.mode) {
    parts.push(modeLabel(group.mode));
  }
  return parts.join(' ');
}

// Tooltip globale
const tooltip = document.createElement('div');
tooltip.className = 'seg-tooltip';
tooltip.style.display = 'none';
document.body.appendChild(tooltip);

function positionTooltip(e) {
  const x = e.clientX + window.scrollX + 14;
  const y = e.clientY + window.scrollY + 22;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

// Carica e parsa un XML
async function loadXML(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const txt = await res.text();
    const parser = new DOMParser();
    return parser.parseFromString(txt, 'application/xml');
  } catch (e) {
    console.error('Errore caricamento XML', e);
    return null;
  }
}

// Parsa un <period> e restituisce { id, segs, groups }
function parsePeriod(periodEl) {
  const id = periodEl.getAttribute('id');

  // Leggi i <seg> dalla <prop type="full">
  const fullProp = periodEl.querySelector('prop[type="full"]');
  const segs = [];
  if (fullProp) {
    fullProp.querySelectorAll('seg').forEach(segEl => {
      segs.push({
        id: segEl.getAttribute('id'),
        text: segEl.textContent
      });
    });
  }

  // Leggi i <group>
  const groups = [];
  periodEl.querySelectorAll('group').forEach(groupEl => {
    const members = [];
    groupEl.querySelectorAll('member').forEach(m => {
      members.push(m.getAttribute('ref'));
    });
    groups.push({
      id: groupEl.getAttribute('id'),
      type: groupEl.getAttribute('type') || '',
      level: groupEl.getAttribute('level'),
      mode: groupEl.getAttribute('mode'),
      parent: groupEl.getAttribute('parent'),
      members
    });
  });

  return { id, segs, groups };
}

// Costruisce il rendering di un period nella colonna data
function renderPeriod(period, container) {
  const periodDiv = document.createElement('div');
  periodDiv.className = 'period';

  // Mappa segId → gruppi che lo contengono
  const segToGroups = {};
  for (const seg of period.segs) {
    segToGroups[seg.id] = [];
  }
  for (const group of period.groups) {
    for (const ref of group.members) {
      if (!segToGroups[ref]) segToGroups[ref] = [];
      segToGroups[ref].push(group);
    }
  }

  // Mappa segId → span element
  const segSpans = {};

  // Render dei seg come span inline
  const textDiv = document.createElement('div');
  textDiv.className = 'period-text';

  for (const seg of period.segs) {
    const span = document.createElement('span');
    span.className = 'seg';
    span.setAttribute('data-seg-id', seg.id);
    span.textContent = seg.text;
    segSpans[seg.id] = span;
    textDiv.appendChild(span);
  }

  periodDiv.appendChild(textDiv);
  container.appendChild(periodDiv);

  // Hover events
  let currentlyHighlighted = [];

  for (const seg of period.segs) {
    const span = segSpans[seg.id];
    const myGroups = segToGroups[seg.id] || [];

    span.addEventListener('mouseenter', e => {
      if (!annoVisible) return;

      // Determine primary level from first group for color
      const primaryLevel = myGroups.length > 0 ? (myGroups[0].level || 'I') : 'I';
      const hlClass = `seg-hl-${primaryLevel}`;

      // Evidenzia tutti i seg nei gruppi di questo seg
      const allMembers = new Set();
      for (const g of myGroups) {
        for (const ref of g.members) {
          allMembers.add(ref);
        }
      }
      for (const ref of allMembers) {
        if (segSpans[ref]) {
          segSpans[ref].classList.add('seg-highlighted', hlClass);
          currentlyHighlighted.push({ el: segSpans[ref], hlClass });
        }
      }

      // Mostra tooltip con le etichette di tutti i gruppi
      if (myGroups.length > 0) {
        const labels = myGroups.map(groupLabel).join(' | ');
        tooltip.textContent = labels;
        tooltip.style.display = 'block';
        positionTooltip(e);
      }
    });

    span.addEventListener('mousemove', positionTooltip);

    span.addEventListener('mouseleave', () => {
      for (const { el, hlClass } of currentlyHighlighted) {
        el.classList.remove('seg-highlighted', hlClass);
      }
      currentlyHighlighted = [];
      tooltip.style.display = 'none';
    });
  }
}

// Carica XML e restituisce array di periodi
async function loadPeriods(path) {
  const xml = await loadXML(path);
  if (!xml) return [];
  const periods = [];
  xml.querySelectorAll('period').forEach(el => periods.push(parsePeriod(el)));
  return periods;
}

// Costruisce la griglia con i periodi
function buildGrid(periods1, periods2) {
  // Rimuovi righe precedenti
  Array.from(grid.querySelectorAll('.data-row')).forEach(n => n.remove());

  const maxLen = Math.max(periods1.length, periods2.length);

  for (let i = 0; i < maxLen; i++) {
    const leftCell = document.createElement('div');
    leftCell.className = 'cell data-row';
    const rightCell = document.createElement('div');
    rightCell.className = 'cell data-row';

    if (periods1[i]) {
      renderPeriod(periods1[i], leftCell);
    } else {
      leftCell.classList.add('empty');
    }

    if (periods2[i]) {
      renderPeriod(periods2[i], rightCell);
    } else {
      rightCell.classList.add('empty');
    }

    grid.appendChild(leftCell);
    grid.appendChild(rightCell);
  }
}

// Init
(async function init() {
  const [periods1, periods2] = await Promise.all([
    loadPeriods('xml/versione1.xml'),
    loadPeriods('xml/versione2.xml')
  ]);
  buildGrid(periods1, periods2);
})();

