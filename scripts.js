// scripts.js - griglia, diff, albero, statistiche, associazioni multi-periodo bidirezionali
var grid = document.getElementById('grid');
var toggleDiffBtn = document.getElementById('toggle-diff');
var toggleTreeBtn = document.getElementById('toggle-tree');
var floatingLabel = document.getElementById('floating-label');
var treePanel = document.getElementById('tree-panel');
var treeCanvas = document.getElementById('tree-canvas');
var treePeriodSelect = document.getElementById('tree-period');
var treeSideSelect = document.getElementById('tree-side');
var treeCloseBtn = document.getElementById('tree-close');
var treeFullscreenBtn = document.getElementById('tree-fullscreen');
var zoomInBtn = document.getElementById('zoom-in');
var zoomOutBtn = document.getElementById('zoom-out');
var resetViewBtn = document.getElementById('reset-view');
var periodJumpV1 = document.getElementById('period-jump-v1');
var periodJumpV2 = document.getElementById('period-jump-v2');

var diffVisible = false;
var cachedStructures = { v1: {}, v2: {} };
var v2Matches = {}; // pid v2 -> array di pid v1
var svgRoot = null;
var currentTransform = { k: 1, x: 0, y: 0 };
var isPanning = false;
var panStart = null;
var collapsedNodes = {};

function safeStr(s){ return s == null ? '' : String(s); }
function normalizeWord(w){
  try { return String(w).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); }
  catch(e) { return String(w).replace(/[^A-Za-z0-9\u00C0-\u017E]/g, '').toLowerCase(); }
}
function stripPunctuation(s){
  try { return String(s).replace(/[^\p{L}\p{N}\p{M}\u2019\u0027\u2018\s-]/gu, '').replace(/\s+/g,' ').trim(); }
  catch(e) { return String(s).replace(/[^A-Za-z0-9\u00C0-\u017E\u2019\u0027\u2018\s-]/g, '').replace(/\s+/g,' ').trim(); }
}
function levelToRoman(level){ return {'0':'','I':'I','II':'II','III':'III','IV':'IV','V':'V'}[level] || ''; }
function levelToGradoLabel(level){ var r = levelToRoman(safeStr(level).trim()); return (r && r !== '') ? r + ' grado' : ''; }

function generateGrammaticalLabel(rawType, level, parent, mode){
  var typeNorm = safeStr(rawType).toLowerCase().trim();
  var modeNorm = safeStr(mode).toLowerCase().trim();
  if(typeNorm === 'principale') return 'Proposizione principale';
  var label = '', gradoLabel = levelToGradoLabel(level);
  if(typeNorm.startsWith('coordinata alla subordinata ')){
    label = 'Proposizione coordinata';
    if(modeNorm) label += ' (' + modeNorm + ')';
    label += ' alla subordinata ' + typeNorm.substring('coordinata alla subordinata '.length);
    if(gradoLabel) label += ' (' + gradoLabel + ')'; return label;
  } else if(typeNorm === 'coordinata alla principale'){
    label = 'Proposizione coordinata';
    if(modeNorm) label += ' (' + modeNorm + ')';
    label += ' alla principale'; return label;
  } else if(typeNorm.startsWith('coordinata ')){
    label = 'Proposizione coordinata';
    if(modeNorm) label += ' (' + modeNorm + ')';
    label += ' ' + typeNorm.substring('coordinata '.length);
    if(gradoLabel) label += ' (' + gradoLabel + ')'; return label;
  }
  if(typeNorm.startsWith('subordinata ')){
    label = 'Proposizione subordinata ' + typeNorm.substring('subordinata '.length);
    var parts = []; if(gradoLabel) parts.push(gradoLabel); if(modeNorm) parts.push(modeNorm);
    if(parts.length > 0) label += ' (' + parts.join(', ') + ')'; return label;
  }
  label = stripPunctuation(rawType);
  var parts2 = []; if(gradoLabel) parts2.push(gradoLabel); if(modeNorm) parts2.push(modeNorm);
  if(parts2.length > 0) label += ' (' + parts2.join(', ') + ')'; return label;
}

// === EVENT LISTENERS ===
if(toggleDiffBtn) toggleDiffBtn.addEventListener('click', function(){
  diffVisible = !diffVisible;
  toggleDiffBtn.setAttribute('aria-pressed', String(diffVisible));
  buildGrid(cachedStructures.v1 || {}, cachedStructures.v2 || {});
});
if(toggleTreeBtn && treePanel) toggleTreeBtn.addEventListener('click', async function(){
  var open = treePanel.getAttribute('aria-hidden') === 'false';
  if(open){ treePanel.setAttribute('aria-hidden','true'); treePanel.classList.remove('tree-fullscreen'); toggleTreeBtn.setAttribute('aria-pressed','false'); }
  else { await ensureCache(); populateTreePeriodSelect(); treePanel.setAttribute('aria-hidden','false'); toggleTreeBtn.setAttribute('aria-pressed','true'); collapsedNodes = {}; renderTree(); }
});
if(treeCloseBtn) treeCloseBtn.addEventListener('click', function(){
  if(treePanel){ treePanel.setAttribute('aria-hidden','true'); treePanel.classList.remove('tree-fullscreen'); }
  if(toggleTreeBtn) toggleTreeBtn.setAttribute('aria-pressed','false');
});
if(treeFullscreenBtn) treeFullscreenBtn.addEventListener('click', function(){
  if(treePanel){ treePanel.classList.toggle('tree-fullscreen'); treeFullscreenBtn.title = treePanel.classList.contains('tree-fullscreen') ? 'Esci fullscreen' : 'Schermo intero'; }
});
if(zoomInBtn) zoomInBtn.addEventListener('click', function(){ applyZoom(1.2); });
if(zoomOutBtn) zoomOutBtn.addEventListener('click', function(){ applyZoom(1/1.2); });
if(resetViewBtn) resetViewBtn.addEventListener('click', function(){ currentTransform = {k:1,x:0,y:0}; updateSvgTransform(); });

function setupJumpSelect(sel, sideClass){
  if(!sel) return;
  sel.addEventListener('change', function(){
    var val = sel.value; if(!val) return;
    if(val === '__stats'){
      var statsEl = document.getElementById('stats-section');
      if(statsEl) statsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sel.value = ''; return;
    }
    var target = document.getElementById(sideClass + '-period-' + val);
    if(target){ target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('period-highlight'); setTimeout(function(){ target.classList.remove('period-highlight'); }, 1500); }
    sel.value = '';
  });
}
setupJumpSelect(periodJumpV1, 'v1');
setupJumpSelect(periodJumpV2, 'v2');

// === XML LOADING ===
async function loadXMLStructure(path, isV2){
  try{
    var res = await fetch(path); if(!res.ok) return {};
    var txt = await res.text();
    var xml = new DOMParser().parseFromString(txt, "application/xml");
    var periods = {};
    var periodNodes = xml.querySelectorAll('period');
    if(periodNodes && periodNodes.length){
      periodNodes.forEach(function(p){
        var pid = p.getAttribute('id') || '';
        if(isV2){
          var matchAttr = p.getAttribute('match') || '';
          if(matchAttr){
            v2Matches[pid] = matchAttr.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
          }
        }
        var props = [];
        Array.from(p.querySelectorAll('prop')).forEach(function(prop){
          var propId = prop.getAttribute('id') || '';
          var propType = prop.getAttribute('type') || '';
          var segments = [];
          Array.from(prop.querySelectorAll('seg')).forEach(function(seg){
            segments.push({ id: seg.getAttribute('id') || propId+'_seg', text: seg.textContent || '' });
          });
          if(segments.length === 0) segments.push({ id: propId+'_full', text: prop.textContent || '' });
          props.push({ id: propId, type: propType, segments: segments });
        });
        var groups = {};
        Array.from(p.querySelectorAll('group')).forEach(function(g){
          var gid = g.getAttribute('id') || '';
          if(gid) groups[gid] = {
            type: g.getAttribute('type')||'', level: g.getAttribute('level')||'',
            mode: g.getAttribute('mode')||'', parent: g.getAttribute('parent')||'',
            members: Array.from(g.querySelectorAll('member')).map(function(m){ return m.getAttribute('ref')||''; })
          };
        });
        if(pid) periods[pid] = { props: props, groups: groups };
      });
    }
    return periods;
  }catch(e){ console.error("Errore caricamento XML", e); return {}; }
}

// === UTILITY ===
function tokenizeToWords(text){ return safeStr(text).trim().split(/\s+/).filter(Boolean); }
function diffWords(aWords, bWords){
  var n = aWords.length, m = bWords.length, lcs = [];
  for(var i = 0; i <= n; i++){ lcs[i] = []; for(var j = 0; j <= m; j++) lcs[i][j] = 0; }
  for(var i2 = n-1; i2 >= 0; i2--) for(var j2 = m-1; j2 >= 0; j2--){
    if(aWords[i2] === bWords[j2]) lcs[i2][j2] = 1 + lcs[i2+1][j2+1];
    else lcs[i2][j2] = Math.max(lcs[i2+1][j2], lcs[i2][j2+1]);
  }
  var ops = [], ii = 0, jj = 0;
  while(ii < n && jj < m){
    if(aWords[ii] === bWords[jj]){ ops.push({type:'equal'}); ii++; jj++; }
    else if(lcs[ii+1][jj] >= lcs[ii][jj+1]){ ops.push({type:'del',aIndex:ii}); ii++; }
    else { ops.push({type:'ins',bIndex:jj}); jj++; }
  }
  while(ii < n){ ops.push({type:'del',aIndex:ii}); ii++; }
  while(jj < m){ ops.push({type:'ins',bIndex:jj}); jj++; }
  return ops;
}
function formatPeriodLabel(pidRaw){ return pidRaw.replace(/_/g, '.'); }
function comparePeriods(a, b){
  var parseId = function(id){ var m = id.match(/^([A-Z]+)_(\d+)$/); if(!m) return {roman:'',num:0}; return {roman:m[1],num:parseInt(m[2],10)}; };
  var pa = parseId(a), pb = parseId(b);
  var ro = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10};
  if((ro[pa.roman]||999) !== (ro[pb.roman]||999)) return (ro[pa.roman]||999) - (ro[pb.roman]||999);
  return pa.num - pb.num;
}
function populateJumpIndex(v1Pids, v2Pids){
  function fill(sel, pids){
    if(!sel) return;
    while(sel.options.length > 2) sel.remove(2);
    pids.forEach(function(pid){ var o = document.createElement('option'); o.value = pid; o.textContent = formatPeriodLabel(pid); sel.appendChild(o); });
  }
  fill(periodJumpV1, v1Pids);
  fill(periodJumpV2, v2Pids);
}

// === GRID CELLS ===
function makeWordSpans(seg, propId, side, sg, pid){
  return tokenizeToWords(seg && seg.text ? seg.text : '').map(function(w, idx){
    var span = document.createElement('span'); span.className = 'word'; span.textContent = w;
    span.dataset.wordId = seg.id+'::w'+idx; span.dataset.segId = seg.id; span.dataset.propId = propId;
    span.dataset.periodId = pid; span.dataset.side = side; span.dataset.norm = normalizeWord(w);
    var gm = sg[seg.id];
    if(gm){ span.dataset.groupId=gm.gid; span.dataset.label=gm.gtype||''; span.dataset.level=gm.level||''; span.dataset.mode=gm.mode||''; span.dataset.parent=gm.parent||''; }
    else { span.dataset.label=''; span.dataset.level=''; span.dataset.mode=''; span.dataset.parent=''; }
    span.tabIndex = 0;
    span.addEventListener('mouseenter', function(){ hoverWord(span); });
    span.addEventListener('mouseleave', function(){ leaveWord(span); });
    span.addEventListener('focus', function(){ hoverWord(span); });
    span.addEventListener('blur', function(){ leaveWord(span); });
    span.addEventListener('click', function(ev){ togglePersistentSelection(span, ev); });
    return span;
  });
}

function buildPeriodCell(pid, periodsData, side){
  var cell = document.createElement('div');
  cell.className = 'cell data-row';
  cell.id = side + '-period-' + pid;
  var p = periodsData[pid];
  if(!p || !p.props || !p.props.length){
    cell.classList.add('empty'); cell.textContent = '\u2014';
    return { cell: cell, words: [] };
  }
  var fl = formatPeriodLabel(pid);
  var ll = document.createElement('div'); ll.className = 'period-label'; ll.textContent = fl;
  var pw = document.createElement('div'); pw.className = 'props';
  var sg = {};
  Object.keys(p.groups||{}).forEach(function(gid){
    var g = p.groups[gid];
    (g.members||[]).forEach(function(m){ sg[m] = {gid:gid,gtype:g.type,level:g.level,mode:g.mode||'',parent:g.parent}; });
  });
  var allWords = [];
  p.props.forEach(function(prop){
    (prop.segments||[]).forEach(function(seg){
      var ws = makeWordSpans(seg, prop.id, side, sg, pid);
      ws.forEach(function(w,i){ pw.appendChild(w); if(i<ws.length-1) pw.appendChild(document.createTextNode(' ')); });
      pw.appendChild(document.createTextNode(' '));
      allWords = allWords.concat(ws);
    });
  });
  cell.appendChild(ll); cell.appendChild(pw);
  return { cell: cell, words: allWords };
}

function applyDiff(leftWords, rightWords){
  try{
    var ln = leftWords.map(function(e){ return normalizeWord(e.textContent||''); });
    var rn = rightWords.map(function(e){ return normalizeWord(e.textContent||''); });
    var ops = diffWords(ln, rn), li = 0, ri = 0;
    ops.forEach(function(op){
      if(op.type==='equal'){ li++; ri++; }
      else if(op.type==='del'){ if(leftWords[li]) leftWords[li].classList.add('removed'); li++; }
      else { if(rightWords[ri]) rightWords[ri].classList.add('added'); ri++; }
    });
  } catch(e){ console.warn('Diff error', e); }
}

// === GRID BUILD (bidirezionale) ===
function buildGrid(periods1, periods2){
  if(!grid) return; periods1 = periods1 || {}; periods2 = periods2 || {}; grid.innerHTML = '';

  // Analizza i match: costruisci associazioni bidirezionali
  // v2ToV1: pidV2 -> [pidV1...]  (1 v2 corrisponde a N v1)
  // v1ToV2: pidV1 -> [pidV2...]  (N v2 corrispondono a 1 v1)
  var v2ToV1 = {};
  var v1ToV2 = {};

  Object.keys(v2Matches).forEach(function(pidV2){
    var targets = v2Matches[pidV2];
    if(!targets || targets.length === 0) return;
    targets.forEach(function(pidV1){
      // v2 -> v1
      if(!v2ToV1[pidV2]) v2ToV1[pidV2] = [];
      if(v2ToV1[pidV2].indexOf(pidV1) === -1) v2ToV1[pidV2].push(pidV1);
      // v1 -> v2 (inverso)
      if(!v1ToV2[pidV1]) v1ToV2[pidV1] = [];
      if(v1ToV2[pidV1].indexOf(pidV2) === -1) v1ToV2[pidV1].push(pidV2);
    });
  });

  var v1Pids = Object.keys(periods1).sort(comparePeriods);
  var v2Pids = Object.keys(periods2).sort(comparePeriods);
  var rows = [];
  var v1Used = {};
  var v2Used = {};

  v1Pids.forEach(function(pidV1){
    if(v1Used[pidV1]) return;

    // Caso 1: questo pidV1 è target di più pidV2 (N v2 → 1 v1)
    if(v1ToV2[pidV1] && v1ToV2[pidV1].length > 1){
      var v2Group = v1ToV2[pidV1].filter(function(p){ return periods2[p] && !v2Used[p]; }).sort(comparePeriods);
      if(v2Group.length > 1){
        rows.push({ type: 'manyV2', v1pid: pidV1, v2pids: v2Group });
        v1Used[pidV1] = true;
        v2Group.forEach(function(p){ v2Used[p] = true; });
        return;
      }
    }

    // Caso 2: un pidV2 punta a questo pidV1 insieme ad altri (1 v2 → N v1)
    // Cerca se qualche v2 ha un match che include questo pidV1
    var foundV2Group = null;
    Object.keys(v2ToV1).forEach(function(pidV2){
      if(v2Used[pidV2]) return;
      var targets = v2ToV1[pidV2];
      if(targets && targets.indexOf(pidV1) !== -1 && targets.length > 1){
        foundV2Group = pidV2;
      }
    });

    if(foundV2Group && !v2Used[foundV2Group]){
      var v1Group = v2ToV1[foundV2Group].filter(function(p){ return periods1[p]; }).sort(comparePeriods);
      rows.push({ type: 'manyV1', v1pids: v1Group, v2pid: foundV2Group });
      v1Group.forEach(function(p){ v1Used[p] = true; });
      v2Used[foundV2Group] = true;
      return;
    }

    // Caso 3: match 1:1 tramite match attribute
    if(v1ToV2[pidV1] && v1ToV2[pidV1].length === 1){
      var matchedV2 = v1ToV2[pidV1][0];
      if(!v2Used[matchedV2] && periods2[matchedV2]){
        rows.push({ type: 'normal', v1pid: pidV1, v2pid: matchedV2 });
        v1Used[pidV1] = true;
        v2Used[matchedV2] = true;
        return;
      }
    }

    // Caso 4: corrispondenza per stesso id
    if(periods2[pidV1] && !v2Used[pidV1]){
      rows.push({ type: 'normal', v1pid: pidV1, v2pid: pidV1 });
      v1Used[pidV1] = true;
      v2Used[pidV1] = true;
    } else {
      rows.push({ type: 'normal', v1pid: pidV1, v2pid: null });
      v1Used[pidV1] = true;
    }
  });

  // v2 rimasti senza corrispondenza
  v2Pids.forEach(function(pidV2){
    if(!v2Used[pidV2]){
      rows.push({ type: 'normal', v1pid: null, v2pid: pidV2 });
    }
  });

  populateJumpIndex(v1Pids, v2Pids);

  rows.forEach(function(row){
    if(row.type === 'normal'){
      renderNormalRow(row.v1pid, row.v2pid, periods1, periods2);
    } else if(row.type === 'manyV1'){
      renderManyV1Row(row.v1pids, row.v2pid, periods1, periods2);
    } else if(row.type === 'manyV2'){
      renderManyV2Row(row.v1pid, row.v2pids, periods1, periods2);
    }
  });
}

function renderNormalRow(v1pid, v2pid, periods1, periods2){
  var left, right;
  if(v1pid){
    left = buildPeriodCell(v1pid, periods1, 'v1');
  } else {
    var emptyL = document.createElement('div');
    emptyL.className = 'cell data-row empty'; emptyL.textContent = '\u2014';
    left = { cell: emptyL, words: [] };
  }
  if(v2pid){
    right = buildPeriodCell(v2pid, periods2, 'v2');
  } else {
    var emptyR = document.createElement('div');
    emptyR.className = 'cell data-row empty'; emptyR.textContent = '\u2014';
    right = { cell: emptyR, words: [] };
  }
  if(diffVisible && left.words.length > 0 && right.words.length > 0) applyDiff(left.words, right.words);
  grid.appendChild(left.cell);
  grid.appendChild(right.cell);
}

// 1 v2 → N v1: colonna sinistra impilata, colonna destra centrata
function renderManyV1Row(v1pids, v2pid, periods1, periods2){
  var leftWrapper = document.createElement('div');
  leftWrapper.className = 'group-bracket';
  leftWrapper.style.display = 'flex';
  leftWrapper.style.flexDirection = 'column';
  leftWrapper.style.gap = 'var(--gap)';
  var allLeftWords = [];
  v1pids.forEach(function(pid){
    var res = buildPeriodCell(pid, periods1, 'v1');
    leftWrapper.appendChild(res.cell);
    allLeftWords = allLeftWords.concat(res.words);
  });
  var rightWrapper = document.createElement('div');
  rightWrapper.style.display = 'flex';
  rightWrapper.style.flexDirection = 'column';
  rightWrapper.style.justifyContent = 'center';
  rightWrapper.style.height = '100%';
  var rightRes = buildPeriodCell(v2pid, periods2, 'v2');
  rightWrapper.appendChild(rightRes.cell);
  if(diffVisible && allLeftWords.length > 0 && rightRes.words.length > 0) applyDiff(allLeftWords, rightRes.words);
  grid.appendChild(leftWrapper);
  grid.appendChild(rightWrapper);
}

// N v2 → 1 v1: colonna sinistra centrata, colonna destra impilata
function renderManyV2Row(v1pid, v2pids, periods1, periods2){
  var leftWrapper = document.createElement('div');
  leftWrapper.style.display = 'flex';
  leftWrapper.style.flexDirection = 'column';
  leftWrapper.style.justifyContent = 'center';
  leftWrapper.style.height = '100%';
  var leftRes = buildPeriodCell(v1pid, periods1, 'v1');
  leftWrapper.appendChild(leftRes.cell);
  var rightWrapper = document.createElement('div');
  rightWrapper.className = 'group-bracket';
  rightWrapper.style.display = 'flex';
  rightWrapper.style.flexDirection = 'column';
  rightWrapper.style.gap = 'var(--gap)';
  var allRightWords = [];
  v2pids.forEach(function(pid){
    var res = buildPeriodCell(pid, periods2, 'v2');
    rightWrapper.appendChild(res.cell);
    allRightWords = allRightWords.concat(res.words);
  });
  if(diffVisible && leftRes.words.length > 0 && allRightWords.length > 0) applyDiff(leftRes.words, allRightWords);
  grid.appendChild(leftWrapper);
  grid.appendChild(rightWrapper);
}
// === HOVER / LABELS ===
function showSimpleLabelAbove(el, text){
  if(!floatingLabel || !el) return;
  floatingLabel.textContent = text || ''; floatingLabel.style.display = 'block';
  var r = el.getBoundingClientRect(); var x = r.left + r.width/2, y = r.top - 8;
  floatingLabel.style.left = x+'px'; floatingLabel.style.top = y+'px';
  setTimeout(function(){ var lr2 = floatingLabel.getBoundingClientRect(); if(lr2.right > window.innerWidth) floatingLabel.style.left = (x-(lr2.right-window.innerWidth)-10)+'px'; if(lr2.left < 0) floatingLabel.style.left = (x+Math.abs(lr2.left)+10)+'px'; }, 0);
  floatingLabel.setAttribute('aria-hidden', 'false');
}
function hideSimpleLabel(){ if(!floatingLabel) return; floatingLabel.style.display = 'none'; floatingLabel.setAttribute('aria-hidden', 'true'); }
function hoverWord(el){
  var side = el.dataset.side, gid = el.dataset.groupId||'', pid = el.dataset.periodId;
  if(gid){
    document.querySelectorAll('.word[data-side="'+side+'"][data-group-id="'+gid+'"]').forEach(function(x){ if(!x.dataset.persistent) x.classList.add('group-selected'); });
    var f = document.querySelector('.word[data-side="'+side+'"][data-group-id="'+gid+'"]');
    if(f) showSimpleLabelAbove(f, generateGrammaticalLabel(f.dataset.label||'',f.dataset.level||'',f.dataset.parent||'',f.dataset.mode||''));
    highlightTreeNode(gid, true);
  } else {
    document.querySelectorAll('.word[data-side="'+side+'"][data-period-id="'+pid+'"]').forEach(function(x){ if(!x.dataset.persistent) x.classList.add('group-selected'); });
    var f2 = document.querySelector('.word[data-side="'+side+'"][data-period-id="'+pid+'"]');
    if(f2) showSimpleLabelAbove(f2, 'periodo ' + formatPeriodLabel(pid));
  }
}
function leaveWord(el){
  var side = el.dataset.side, gid = el.dataset.groupId||'', pid = el.dataset.periodId;
  if(gid){ document.querySelectorAll('.word[data-side="'+side+'"][data-group-id="'+gid+'"]').forEach(function(x){ if(!x.dataset.persistent) x.classList.remove('group-selected'); }); hideSimpleLabel(); highlightTreeNode(gid, false); }
  else { document.querySelectorAll('.word[data-side="'+side+'"][data-period-id="'+pid+'"]').forEach(function(x){ if(!x.dataset.persistent) x.classList.remove('group-selected'); }); hideSimpleLabel(); }
}
function togglePersistentSelection(el, ev){
  var side = el.dataset.side, gid = el.dataset.groupId||'', pid = el.dataset.periodId;
  var sel = gid ? '.word[data-side="'+side+'"][data-group-id="'+gid+'"]' : '.word[data-side="'+side+'"][data-period-id="'+pid+'"]';
  if(document.querySelectorAll(sel+'.group-selected').length > 0){
    document.querySelectorAll(sel).forEach(function(x){ x.classList.remove('group-selected'); delete x.dataset.persistent; }); hideSimpleLabel();
  } else {
    document.querySelectorAll(sel).forEach(function(x){ x.classList.add('group-selected'); x.dataset.persistent = '1'; });
    var s = document.querySelector(sel);
    if(s) showSimpleLabelAbove(s, gid ? generateGrammaticalLabel(s.dataset.label||'', s.dataset.level||'', s.dataset.parent||'', s.dataset.mode||'') : 'periodo '+formatPeriodLabel(pid));
  }
  if(ev && ev.preventDefault) ev.preventDefault();
}

// ===== ALBERO =====
function isCoordinata(t){ return safeStr(t).toLowerCase().trim().startsWith('coordinata'); }
var FIXED_NODE_W = 200;
var NODE_LINE_H = 14;
var NODE_PAD_Y = 12;

function calcNodeHeight(text){
  var maxCharsPerLine = 26;
  var words = safeStr(text).split(/\s+/).filter(Boolean);
  if(!words.length) return NODE_PAD_Y * 2 + NODE_LINE_H;
  var lines = 1, lineLen = 0;
  words.forEach(function(w){
    if(lineLen + w.length + (lineLen > 0 ? 1 : 0) <= maxCharsPerLine){
      lineLen += w.length + (lineLen > 0 ? 1 : 0);
    } else { lines++; lineLen = w.length; }
  });
  return NODE_PAD_Y * 2 + lines * NODE_LINE_H;
}

function buildTreeModel(periodData){
  var nodes = {}, groups = periodData.groups||{}, props = periodData.props||[];
  var segText = {}, segOrder = {}, segIndex = 0;
  props.forEach(function(p){ (p.segments||[]).forEach(function(s){ segText[s.id] = safeStr(s.text).trim(); segOrder[s.id] = segIndex++; }); });
  Object.keys(groups).forEach(function(gid){
    var g = groups[gid], members = g.members||[];
    var fullLabel = members.map(function(m){ return segText[m]||''; }).filter(Boolean).join(' ');
    fullLabel = stripPunctuation(fullLabel) || gid;
    var minOrder = Infinity;
    members.forEach(function(m){ var o = segOrder[m]; if(o !== undefined && o < minOrder) minOrder = o; });
    nodes[gid] = { id: gid, fullLabel: fullLabel, label: fullLabel, meta: g, children: [], textOrder: minOrder };
  });
  Object.keys(nodes).forEach(function(gid){
    var parentId = nodes[gid].meta.parent;
    if(parentId && nodes[parentId]) nodes[parentId].children.push(nodes[gid]);
  });
  return { nodes: nodes };
}

function getSubordinates(node){
  if(collapsedNodes[node.id]) return [];
  return (node.children||[]).filter(function(c){ return !isCoordinata(c.meta.type); }).sort(function(a,b){ return a.textOrder - b.textOrder; });
}
function getCoordinates(node){
  if(collapsedNodes[node.id]) return [];
  return (node.children||[]).filter(function(c){ return isCoordinata(c.meta.type); }).sort(function(a,b){ return a.textOrder - b.textOrder; });
}

function computeLayout(nodes){
  var coordGap = 16, rowGapY = 180, nodeGapX = 24;
  var nodeHeights = {};
  Object.keys(nodes).forEach(function(id){ nodeHeights[id] = calcNodeHeight(nodes[id].label); });
  var positions = new Map();
  function chainWidthOnly(node){
    var w = FIXED_NODE_W;
    getCoordinates(node).forEach(function(c){ w += coordGap + chainWidthOnly(c); });
    return w;
  }
  function subtreeWidth(node){
    var cw = chainWidthOnly(node);
    var chain = [];
    function buildChain(n){ chain.push(n); getCoordinates(n).forEach(function(c){ buildChain(c); }); }
    buildChain(node);
    var allSubs = [];
    chain.forEach(function(c){ allSubs = allSubs.concat(getSubordinates(c)); });
    if(allSubs.length === 0) return cw;
    var subsW = 0;
    allSubs.forEach(function(s, i){ if(i > 0) subsW += nodeGapX; subsW += subtreeWidth(s); });
    return Math.max(cw, subsW);
  }
  function placeChainAndSubs(node, cx, cy){
    var chain = [];
    function buildChain(n){ chain.push(n); getCoordinates(n).forEach(function(c){ buildChain(c); }); }
    buildChain(node);
    var maxH = 0;
    chain.forEach(function(c){ var h = nodeHeights[c.id]; if(h > maxH) maxH = h; });
    var totalChainW = 0;
    chain.forEach(function(c, i){ if(i > 0) totalChainW += coordGap; totalChainW += FIXED_NODE_W; });
    var startX = cx - totalChainW / 2;
    chain.forEach(function(c, i){
      if(i > 0) startX += coordGap;
      positions.set(c.id, { x: startX + FIXED_NODE_W / 2, y: cy, w: FIXED_NODE_W, h: nodeHeights[c.id], rowH: maxH });
      startX += FIXED_NODE_W;
    });
    chain.forEach(function(chainNode){
      var subs = getSubordinates(chainNode);
      if(subs.length === 0) return;
      var parentPos = positions.get(chainNode.id);
      var childY = cy + maxH / 2 + rowGapY;
      var totalSubsW = 0;
      subs.forEach(function(s, i){ if(i > 0) totalSubsW += nodeGapX; totalSubsW += subtreeWidth(s); });
      var subStartX = parentPos.x - totalSubsW / 2;
      subs.forEach(function(s, i){
        if(i > 0) subStartX += nodeGapX;
        var sw = subtreeWidth(s);
        placeChainAndSubs(s, subStartX + sw / 2, childY);
        subStartX += sw;
      });
    });
  }
  var roots = [];
  Object.keys(nodes).forEach(function(id){
    var n = nodes[id];
    if(!n.meta.parent || !nodes[n.meta.parent]) roots.push(n);
  });
  roots.sort(function(a,b){ return a.textOrder - b.textOrder; });
  var totalRootW = 0;
  roots.forEach(function(r, i){ if(i > 0) totalRootW += nodeGapX * 2; totalRootW += subtreeWidth(r); });
  var rootCx = 40 + totalRootW / 2;
  roots.forEach(function(r){
    var sw = subtreeWidth(r);
    placeChainAndSubs(r, rootCx - totalRootW / 2 + sw / 2, 50);
    rootCx += sw + nodeGapX * 2;
  });
  for(var pass = 0; pass < 25; pass++){
    var any = false, allIds = Array.from(positions.keys());
    for(var i = 0; i < allIds.length; i++){
      for(var j = i + 1; j < allIds.length; j++){
        var a = positions.get(allIds[i]), b = positions.get(allIds[j]);
        if(Math.abs(a.y - b.y) > 2) continue;
        var pad = 10;
        var overlapX = (a.x + a.w / 2 + pad) - (b.x - b.w / 2);
        if(overlapX > 0){ any = true; b.x += overlapX; }
      }
    }
    if(!any) break;
  }
  var maxX = 0, maxY = 0;
  positions.forEach(function(p){ if(p.x + p.w / 2 > maxX) maxX = p.x + p.w / 2; if(p.y + p.h / 2 > maxY) maxY = p.y + p.h / 2; });
  return { positions: positions, totalWidth: Math.max(600, maxX + 60), totalHeight: Math.max(200, maxY + 60) };
}

function wrapSvgText(el, text, maxChars){
  while(el.firstChild) el.removeChild(el.firstChild);
  var words = safeStr(text).split(/\s+/).filter(Boolean); if(!words.length) return;
  var line = [], lineLen = 0, lines = [];
  words.forEach(function(w){
    if(lineLen + w.length + (lineLen > 0 ? 1 : 0) <= maxChars){ line.push(w); lineLen += w.length + (lineLen > 0 ? 1 : 0); }
    else { lines.push(line.join(' ')); line = [w]; lineLen = w.length; }
  });
  if(line.length) lines.push(line.join(' '));
  var lh = NODE_LINE_H, sy = -(lines.length - 1) * (lh / 2);
  lines.forEach(function(ln, i){
    var ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    ts.setAttribute('x', '0'); ts.setAttribute('dy', i === 0 ? '' + sy : '' + lh);
    ts.textContent = ln; el.appendChild(ts);
  });
}

var treeTooltip = null;
function showTreeTooltip(evt, text){
  if(!treeTooltip){ treeTooltip = document.createElement('div'); treeTooltip.className = 'tree-tooltip'; document.body.appendChild(treeTooltip); }
  treeTooltip.textContent = text; treeTooltip.style.display = 'block';
  treeTooltip.style.left = (evt.clientX + 12) + 'px'; treeTooltip.style.top = (evt.clientY - 20) + 'px';
}
function hideTreeTooltip(){ if(treeTooltip) treeTooltip.style.display = 'none'; }

function curveHitsRect(x0,y0,cx1,cy1,cx2,cy2,x3,y3,rx,ry,rw,rh,pad){
  for(var t=0.02;t<=0.98;t+=0.02){
    var u=1-t;
    var px=u*u*u*x0+3*u*u*t*cx1+3*u*t*t*cx2+t*t*t*x3;
    var py=u*u*u*y0+3*u*u*t*cy1+3*u*t*t*cy2+t*t*t*y3;
    if(px>=(rx-rw/2-pad)&&px<=(rx+rw/2+pad)&&py>=(ry-rh/2-pad)&&py<=(ry+rh/2+pad)) return true;
  }
  return false;
}

function renderTree(){
  if(!treeCanvas||!treePeriodSelect||!treeSideSelect) return;
  var periodId=treePeriodSelect.value||Object.keys(cachedStructures.v1||{})[0];
  var side=treeSideSelect.value||'v1';
  var cache=side==='v1'?cachedStructures.v1:cachedStructures.v2;
  var data=cache?cache[periodId]:null;
  if(!data){treeCanvas.innerHTML='<div style="padding:12px;color:#666">Nessun dato.</div>';return;}
  var model=buildTreeModel(data),layout=computeLayout(model.nodes);
  var svgNS='http://www.w3.org/2000/svg';
  var width=layout.totalWidth,height=layout.totalHeight;
  var svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('width',width);svg.setAttribute('height',height);
  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  svg.style.width='100%';svg.style.height='100%';svg.style.cursor='grab';
  var gRoot=document.createElementNS(svgNS,'g');
  gRoot.setAttribute('class','tree-root-group');svg.appendChild(gRoot);
  var allRects=[];
  Object.keys(model.nodes).forEach(function(nid){var p=layout.positions.get(nid);if(p)allRects.push({id:nid,x:p.x,y:p.y,w:p.w,h:p.h});});

  // FRECCE
  Object.keys(model.nodes).forEach(function(id){
    var node=model.nodes[id],parentId=node.meta.parent;
    if(!parentId||!model.nodes[parentId])return;
    var p1=layout.positions.get(parentId),p2=layout.positions.get(id);
    if(!p1||!p2)return;
    var anc=parentId;
    while(anc&&model.nodes[anc]){if(collapsedNodes[anc])return;anc=model.nodes[anc].meta.parent;}
    var path=document.createElementNS(svgNS,'path');var d;
    if(isCoordinata(node.meta.type)){
      var fromX=p1.x+p1.w/2-6,fromY=p1.y-p1.h/2,toX=p2.x,toY=p2.y-p2.h/2;
      var arcH=18+Math.abs(toX-fromX)*0.06;var topY=Math.min(fromY,toY)-arcH;
      d='M '+fromX+' '+fromY+' C '+fromX+' '+topY+' '+toX+' '+topY+' '+toX+' '+toY;
    } else {
      var startX=p1.x,startY=p1.y+p1.h/2,endX=p2.x,endY=p2.y-p2.h/2;
      var midY=(startY+endY)/2;var cx1=startX,cy1=midY,cx2=endX,cy2=midY;
      var needsDetour=false,hitRect=null;
      for(var r=0;r<allRects.length;r++){var rect=allRects[r];if(rect.id===id||rect.id===parentId)continue;if(curveHitsRect(startX,startY,cx1,cy1,cx2,cy2,endX,endY,rect.x,rect.y,rect.w,rect.h,4)){needsDetour=true;hitRect=rect;break;}}
      if(needsDetour&&hitRect){var detourSide=(startX<hitRect.x)?-1:1;var detourX=hitRect.x+detourSide*(hitRect.w/2+30);d='M '+startX+' '+startY+' C '+startX+' '+(startY+20)+' '+detourX+' '+(startY+20)+' '+detourX+' '+midY+' S '+endX+' '+(endY-20)+' '+endX+' '+endY;}
      else{d='M '+startX+' '+startY+' C '+cx1+' '+cy1+' '+cx2+' '+cy2+' '+endX+' '+endY;}
    }
    path.setAttribute('d',d);path.setAttribute('stroke','var(--tree-branch)');path.setAttribute('fill','none');path.setAttribute('stroke-width','1.5');gRoot.appendChild(path);
  });

  // NODI
  Object.keys(model.nodes).forEach(function(id){
    var n=model.nodes[id],pos=layout.positions.get(id);if(!pos)return;
    var ancestor=n.meta.parent;
    while(ancestor&&model.nodes[ancestor]){if(collapsedNodes[ancestor])return;ancestor=model.nodes[ancestor].meta.parent;}
    var g=document.createElementNS(svgNS,'g');
    g.setAttribute('transform','translate('+pos.x+','+pos.y+')');g.setAttribute('data-node-id',id);
    var rect=document.createElementNS(svgNS,'rect');
    rect.setAttribute('x',-pos.w/2);rect.setAttribute('y',-pos.h/2);rect.setAttribute('width',pos.w);rect.setAttribute('height',pos.h);
    rect.setAttribute('rx',6);rect.setAttribute('ry',6);rect.setAttribute('fill','#fff');rect.setAttribute('stroke','var(--tree-node-border)');
    rect.setAttribute('stroke-width','1');rect.classList.add('tree-node-rect');g.appendChild(rect);
    var text=document.createElementNS(svgNS,'text');
    text.setAttribute('x',0);text.setAttribute('y',0);text.setAttribute('text-anchor','middle');text.setAttribute('class','tree-node-text');
    wrapSvgText(text,n.fullLabel,26);g.appendChild(text);
    var gramLabel=generateGrammaticalLabel(n.meta.type||'',n.meta.level||'',n.meta.parent||'',n.meta.mode||'');
    g.addEventListener('mouseenter',function(evt){showTreeTooltip(evt,gramLabel);});
    g.addEventListener('mousemove',function(evt){if(treeTooltip&&treeTooltip.style.display!=='none'){treeTooltip.style.left=(evt.clientX+12)+'px';treeTooltip.style.top=(evt.clientY-20)+'px';}});
    g.addEventListener('mouseleave',function(){hideTreeTooltip();});
    if(n.children&&n.children.length>0){
      var isCollapsed=!!collapsedNodes[id];
      var tc=document.createElementNS(svgNS,'circle');tc.setAttribute('cx',0);tc.setAttribute('cy',pos.h/2+8);tc.setAttribute('r',7);
      tc.setAttribute('fill',isCollapsed?'var(--accent)':'var(--card)');tc.setAttribute('stroke','var(--accent)');tc.setAttribute('stroke-width','1');tc.style.cursor='pointer';g.appendChild(tc);
      var tt=document.createElementNS(svgNS,'text');tt.setAttribute('x',0);tt.setAttribute('y',pos.h/2+8);tt.setAttribute('text-anchor','middle');tt.setAttribute('class','tree-node-toggle');
      tt.setAttribute('fill',isCollapsed?'#fff':'var(--accent)');tt.textContent=isCollapsed?'+':'\u2212';tt.style.dominantBaseline='central';g.appendChild(tt);
      tc.addEventListener('click',function(evt){evt.stopPropagation();if(collapsedNodes[id])delete collapsedNodes[id];else collapsedNodes[id]=true;renderTree();});
      tt.addEventListener('click',function(evt){evt.stopPropagation();if(collapsedNodes[id])delete collapsedNodes[id];else collapsedNodes[id]=true;renderTree();});
    }
    g.addEventListener('click',function(){
      document.querySelectorAll('.word.group-selected').forEach(function(x){x.classList.remove('group-selected');delete x.dataset.persistent;});
      var sel='.word[data-side="'+side+'"][data-group-id="'+id+'"]';
      var matches=Array.from(document.querySelectorAll(sel));
      matches.forEach(function(x){x.classList.add('group-selected');x.dataset.persistent='1';});
      if(matches.length){var s=matches[0];showSimpleLabelAbove(s,generateGrammaticalLabel(s.dataset.label||'',s.dataset.level||'',s.dataset.parent||'',s.dataset.mode||''));}
    });
    gRoot.appendChild(g);
  });

  treeCanvas.innerHTML='';treeCanvas.appendChild(svg);svgRoot=gRoot;setupPanZoom(svg,gRoot);
}

// === PAN / ZOOM ===
function setupPanZoom(svg,gRoot){
  currentTransform={k:1,x:0,y:0};updateSvgTransform();
  svg.addEventListener('wheel',function(e){e.preventDefault();var delta=e.deltaY<0?1.12:1/1.12;var pt=getSvgPoint(svg,e.clientX,e.clientY);zoomAt(pt.x,pt.y,delta);},{passive:false});
  svg.addEventListener('mousedown',function(e){isPanning=true;panStart={x:e.clientX,y:e.clientY,tx:currentTransform.x,ty:currentTransform.y};svg.style.cursor='grabbing';});
  window.addEventListener('mousemove',function(e){if(!isPanning)return;currentTransform.x=panStart.tx+(e.clientX-panStart.x);currentTransform.y=panStart.ty+(e.clientY-panStart.y);updateSvgTransform();});
  window.addEventListener('mouseup',function(){if(isPanning){isPanning=false;panStart=null;if(svgRoot&&svgRoot.ownerSVGElement)svgRoot.ownerSVGElement.style.cursor='grab';}});
}
function getSvgPoint(svg,cx,cy){var pt=svg.createSVGPoint();pt.x=cx;pt.y=cy;var ctm=svg.getScreenCTM().inverse();var p=pt.matrixTransform(ctm);return{x:p.x,y:p.y};}
function zoomAt(cx,cy,sf){currentTransform.x=(currentTransform.x-cx)*sf+cx;currentTransform.y=(currentTransform.y-cy)*sf+cy;currentTransform.k*=sf;updateSvgTransform();}
function applyZoom(f){currentTransform.k*=f;updateSvgTransform();}
function updateSvgTransform(){if(!svgRoot)return;svgRoot.setAttribute('transform','translate('+currentTransform.x+','+currentTransform.y+') scale('+currentTransform.k+')');}
function highlightTreeNode(nid,on){if(!svgRoot)return;var svg=svgRoot.ownerSVGElement;if(!svg)return;var node=svg.querySelector('[data-node-id="'+nid+'"]');if(node){var rect=node.querySelector('rect');if(rect)rect.setAttribute('stroke',on?'#c9a84c':'var(--tree-node-border)');}}

// ===== STATISTICHE =====
function resolveCoordTarget(gid,groups){
  var g=groups[gid];if(!g)return'principale';
  var typeNorm=safeStr(g.type).toLowerCase().trim();
  if(typeNorm==='coordinata alla principale')return'principale';
  if(typeNorm.startsWith('coordinata alla subordinata'))return'subordinata';
  if(typeNorm.startsWith('coordinata')&&g.parent&&groups[g.parent]){
    var parentType=safeStr(groups[g.parent].type).toLowerCase().trim();
    if(parentType==='principale')return'principale';
    if(parentType.startsWith('subordinata'))return'subordinata';
    if(parentType.startsWith('coordinata'))return resolveCoordTarget(g.parent,groups);
    return'subordinata';
  }
  return'principale';
}

function computeStats(periods){
  var stats={totalPeriods:0,totalPropositions:0,principale:0,subordinate:0,coordPrinc:0,coordSub:0,subByGrado:{},subByType:{},coordByType:{},subByMode:{},coordByMode:{},coordDettaglio:{principale:{},subordinata:{}}};
  Object.keys(periods).forEach(function(pid){
    stats.totalPeriods++;var p=periods[pid];var groups=p.groups||{};
    Object.keys(groups).forEach(function(gid){
      var g=groups[gid];var typeNorm=safeStr(g.type).toLowerCase().trim();var level=safeStr(g.level).trim();var mode=safeStr(g.mode).toLowerCase().trim();
      stats.totalPropositions++;
      if(typeNorm==='principale'){stats.principale++;}
      else if(typeNorm.startsWith('coordinata')){
        var target=resolveCoordTarget(gid,groups);
        if(target==='principale'){stats.coordPrinc++;}else{stats.coordSub++;}
        var coordType;
        if(typeNorm.startsWith('coordinata alla subordinata '))coordType=typeNorm.substring('coordinata alla subordinata '.length);
        else if(typeNorm==='coordinata alla principale')coordType='principale';
        else if(typeNorm.startsWith('coordinata '))coordType=typeNorm.substring('coordinata '.length);
        else coordType=typeNorm;
        stats.coordByType[coordType]=(stats.coordByType[coordType]||0)+1;
        if(mode)stats.coordByMode[mode]=(stats.coordByMode[mode]||0)+1;
        if(!stats.coordDettaglio[target])stats.coordDettaglio[target]={};
        stats.coordDettaglio[target][coordType]=(stats.coordDettaglio[target][coordType]||0)+1;
      } else if(typeNorm.startsWith('subordinata ')){
        stats.subordinate++;
        if(level)stats.subByGrado[level]=(stats.subByGrado[level]||0)+1;
        var subType=typeNorm.substring('subordinata '.length);
        stats.subByType[subType]=(stats.subByType[subType]||0)+1;
        if(mode)stats.subByMode[mode]=(stats.subByMode[mode]||0)+1;
      }
    });
  });
  return stats;
}

function renderStats(stats, containerId){
  var container = document.getElementById(containerId);
  if(!container) return;
  var total = stats.totalPropositions || 1;
  var totalCoord = stats.coordPrinc + stats.coordSub;
  var subPct = ((stats.subordinate / total) * 100).toFixed(1);
  var coordTotalPct = ((totalCoord / total) * 100).toFixed(1);
  var coordPrincPctOfCoord = totalCoord > 0 ? ((stats.coordPrinc / totalCoord) * 100).toFixed(1) : '0.0';
  var coordSubPctOfCoord = totalCoord > 0 ? ((stats.coordSub / totalCoord) * 100).toFixed(1) : '0.0';
  var coordPrincPct = ((stats.coordPrinc / total) * 100).toFixed(1);
  var coordSubPct = ((stats.coordSub / total) * 100).toFixed(1);
  var mainPct = ((stats.principale / total) * 100).toFixed(1);
  var html = '';

  // === OVERVIEW ===
  html += '<div class="stats-section-block" data-section="overview">';
  html += '<div class="stats-overview">';
  html += '<div class="stats-overview-item"><span class="stats-overview-number">' + stats.totalPeriods + '</span><span class="stats-overview-label">Sezioni</span></div>';
  html += '<div class="stats-overview-item"><span class="stats-overview-number">' + stats.principale + '</span><span class="stats-overview-label">Principali</span></div>';
  html += '<div class="stats-overview-item"><span class="stats-overview-number">' + stats.subordinate + '</span><span class="stats-overview-label">Subordinate</span></div>';
  html += '<div class="stats-overview-item"><span class="stats-overview-number">' + stats.coordPrinc + '</span><span class="stats-overview-label">Coord. a princ.</span></div>';
  html += '<div class="stats-overview-item"><span class="stats-overview-number">' + stats.coordSub + '</span><span class="stats-overview-label">Coord. a sub.</span></div>';
  html += '</div>';
  html += '</div>';

  // === BARRE ===
  html += '<div class="stats-section-block" data-section="bars">';
  html += '<div class="stats-bar-row"><span class="stats-bar-label">Principali</span><div class="stats-bar-track"><div class="stats-bar-fill bar-main" style="width:' + mainPct + '%"></div></div><span class="stats-bar-value">' + mainPct + '%</span></div>';
  html += '<div class="stats-bar-row"><span class="stats-bar-label">Subordinate</span><div class="stats-bar-track"><div class="stats-bar-fill bar-sub" style="width:' + subPct + '%"></div></div><span class="stats-bar-value">' + subPct + '%</span></div>';

  // Barra coordinate unificata con divisione interna
  html += '<div class="stats-bar-row"><span class="stats-bar-label">Coordinate</span><div class="stats-bar-track"><div class="stats-bar-split" style="width:' + coordTotalPct + '%">';
  if(stats.coordPrinc > 0) html += '<div class="stats-bar-fill bar-coord-princ" style="width:' + coordPrincPctOfCoord + '%"></div>';
  if(stats.coordSub > 0) html += '<div class="stats-bar-fill bar-coord-sub" style="width:' + coordSubPctOfCoord + '%"></div>';
  html += '</div></div><span class="stats-bar-value">' + coordTotalPct + '%</span></div>';

  // Legenda sotto la barra
  html += '<div class="stats-bar-split-legend">';
  html += '<span><span class="dot dot-princ"></span>a princ. ' + coordPrincPct + '%</span>';
  html += '<span><span class="dot dot-sub"></span>a sub. ' + coordSubPct + '%</span>';
  html += '</div>';
  html += '</div>';

  // === SUBORDINATE PER GRADO ===
  html += '<div class="stats-section-block" data-section="sub-grado">';
  var gradi = Object.keys(stats.subByGrado).sort(function(a, b){ var order = {'I':1,'II':2,'III':3,'IV':4,'V':5}; return (order[a]||99) - (order[b]||99); });
  if(gradi.length > 0){
    html += '<div class="stats-detail-heading">Subordinate per grado</div><table class="stats-table"><thead><tr><th>Grado</th><th>N\u00b0</th></tr></thead><tbody>';
    gradi.forEach(function(g){ html += '<tr><td>' + g + ' grado</td><td>' + stats.subByGrado[g] + '</td></tr>'; });
    html += '<tr class="stats-row-total"><td>Totale</td><td>' + stats.subordinate + '</td></tr>';
    html += '</tbody></table>';
  }
  html += '</div>';

  // === SUBORDINATE PER TIPO ===
  html += '<div class="stats-section-block" data-section="sub-tipo">';
  var subTypes = Object.keys(stats.subByType).sort(function(a, b){ return stats.subByType[b] - stats.subByType[a]; });
  if(subTypes.length > 0){
    html += '<div class="stats-detail-heading">Subordinate per tipo</div><table class="stats-table"><thead><tr><th>Tipo</th><th>N\u00b0</th></tr></thead><tbody>';
    subTypes.forEach(function(t){ html += '<tr><td>' + t.charAt(0).toUpperCase() + t.slice(1) + '</td><td>' + stats.subByType[t] + '</td></tr>'; });
    html += '</tbody></table>';
  }
  html += '</div>';

  // === SUBORDINATE PER MODALITÀ ===
  html += '<div class="stats-section-block" data-section="sub-mode">';
  var subModes = Object.keys(stats.subByMode).sort(function(a, b){ return stats.subByMode[b] - stats.subByMode[a]; });
  if(subModes.length > 0){
    html += '<div class="stats-detail-heading">Subordinate per modalit\u00e0</div><table class="stats-table"><thead><tr><th>Modalit\u00e0</th><th>N\u00b0</th></tr></thead><tbody>';
    subModes.forEach(function(m){ html += '<tr><td>' + m.charAt(0).toUpperCase() + m.slice(1) + '</td><td>' + stats.subByMode[m] + '</td></tr>'; });
    html += '</tbody></table>';
  }
  html += '</div>';

  // === COORDINATE ALLA PRINCIPALE — DETTAGLIO ===
  html += '<div class="stats-section-block" data-section="coord-princ">';
  var coordPrincTypes = Object.keys(stats.coordDettaglio.principale || {}).sort(function(a, b){ return (stats.coordDettaglio.principale[b]||0) - (stats.coordDettaglio.principale[a]||0); });
  if(coordPrincTypes.length > 0){
    html += '<div class="stats-detail-heading">Coordinate alla principale \u2014 dettaglio</div><table class="stats-table"><thead><tr><th>Tipo</th><th>N\u00b0</th></tr></thead><tbody>';
    coordPrincTypes.forEach(function(t){ html += '<tr><td>' + t.charAt(0).toUpperCase() + t.slice(1) + '</td><td>' + stats.coordDettaglio.principale[t] + '</td></tr>'; });
    html += '<tr class="stats-row-total"><td>Totale</td><td>' + stats.coordPrinc + '</td></tr></tbody></table>';
  }
  html += '</div>';

  // === COORDINATE ALLA SUBORDINATA — DETTAGLIO ===
  html += '<div class="stats-section-block" data-section="coord-sub">';
  var coordSubTypes = Object.keys(stats.coordDettaglio.subordinata || {}).sort(function(a, b){ return (stats.coordDettaglio.subordinata[b]||0) - (stats.coordDettaglio.subordinata[a]||0); });
  if(coordSubTypes.length > 0){
    html += '<div class="stats-detail-heading">Coordinate alla subordinata \u2014 dettaglio</div><table class="stats-table"><thead><tr><th>Coordinata a</th><th>N\u00b0</th></tr></thead><tbody>';
    coordSubTypes.forEach(function(t){ html += '<tr><td>' + t.charAt(0).toUpperCase() + t.slice(1) + '</td><td>' + stats.coordDettaglio.subordinata[t] + '</td></tr>'; });
    html += '<tr class="stats-row-total"><td>Totale</td><td>' + stats.coordSub + '</td></tr></tbody></table>';
  }
  html += '</div>';

  // === COORDINATE PER MODALITÀ ===
  html += '<div class="stats-section-block" data-section="coord-mode">';
  var coordModes = Object.keys(stats.coordByMode).sort(function(a, b){ return stats.coordByMode[b] - stats.coordByMode[a]; });
  if(coordModes.length > 0){
    html += '<div class="stats-detail-heading">Coordinate per modalit\u00e0</div><table class="stats-table"><thead><tr><th>Modalit\u00e0</th><th>N\u00b0</th></tr></thead><tbody>';
    coordModes.forEach(function(m){ html += '<tr><td>' + m.charAt(0).toUpperCase() + m.slice(1) + '</td><td>' + stats.coordByMode[m] + '</td></tr>'; });
    html += '</tbody></table>';
  }
  html += '</div>';

  container.innerHTML = html;
}

function buildStats(){
  var statsV1 = computeStats(cachedStructures.v1 || {});
  var statsV2 = computeStats(cachedStructures.v2 || {});
  renderStats(statsV1, 'stats-body-v1');
  renderStats(statsV2, 'stats-body-v2');

  // Allinea le sezioni tra le due colonne
  alignStatsSections();
}

function alignStatsSections(){
  var sections = ['overview','bars','sub-grado','sub-tipo','sub-mode','coord-princ','coord-sub','coord-mode'];
  var bodyV1 = document.getElementById('stats-body-v1');
  var bodyV2 = document.getElementById('stats-body-v2');
  if(!bodyV1 || !bodyV2) return;

  // Reset altezze minime
  var root = document.documentElement;
  sections.forEach(function(sec){
    root.style.setProperty('--stats-h-' + sec, 'auto');
  });

  // Forza reflow
  void bodyV1.offsetHeight;

  // Per ogni sezione, trova l'altezza massima tra v1 e v2 e impostala
  sections.forEach(function(sec){
    var el1 = bodyV1.querySelector('[data-section="' + sec + '"]');
    var el2 = bodyV2.querySelector('[data-section="' + sec + '"]');
    if(!el1 || !el2) return;
    var h1 = el1.getBoundingClientRect().height;
    var h2 = el2.getBoundingClientRect().height;
    var maxH = Math.max(h1, h2);
    if(maxH > 0){
      root.style.setProperty('--stats-h-' + sec, maxH + 'px');
    }
  });
}

// ===== INIT =====
async function ensureCache(){
  try{
    if(!cachedStructures.v1||Object.keys(cachedStructures.v1).length===0)
      cachedStructures.v1=await loadXMLStructure('xml/versione1.xml',false)||{};
    if(!cachedStructures.v2||Object.keys(cachedStructures.v2).length===0)
      cachedStructures.v2=await loadXMLStructure('xml/versione2.xml',true)||{};
  }catch(e){
    console.error('ensureCache error',e);
    cachedStructures.v1=cachedStructures.v1||{};
    cachedStructures.v2=cachedStructures.v2||{};
  }
}

function populateTreePeriodSelect(){
  if(!treePeriodSelect||!treeSideSelect)return;
  var periods=Array.from(new Set(
    Object.keys(cachedStructures.v1||{}).concat(Object.keys(cachedStructures.v2||{}))
  ));
  periods.sort(comparePeriods);
  treePeriodSelect.innerHTML='';
  periods.forEach(function(pid){
    var o=document.createElement('option');
    o.value=pid;o.textContent=formatPeriodLabel(pid);
    treePeriodSelect.appendChild(o);
  });
  if(periods.length)treePeriodSelect.value=periods[0];
  treePeriodSelect.onchange=function(){renderTree();};
  treeSideSelect.onchange=function(){renderTree();};
}

async function init(){
  await ensureCache();
  buildGrid(cachedStructures.v1,cachedStructures.v2);
  buildStats();
  if(treePanel)treePanel.setAttribute('aria-hidden','true');
}

init();
