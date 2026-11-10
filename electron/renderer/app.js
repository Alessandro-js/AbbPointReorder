'use strict';

const state = {
  input: null,
  result: null,
  savePath: null,
  analyzeSeq: 0,
  debounceTimer: null
};

const $ = (id) => document.getElementById(id);

const els = {
  inputPath: $('inputPath'),
  outputFolder: $('outputFolder'),
  filePill: $('filePill'),
  btnBrowseInput: $('btnBrowseInput'),
  btnBrowseFolder: $('btnBrowseFolder'),
  chkRename: $('chkRename'),
  chkRenameOnlyUsed: $('chkRenameOnlyUsed'),
  namingMode: $('namingMode'),
  prefix: $('prefix'),
  start: $('start'),
  width: $('width'),
  prefixHint: $('prefixHint'),
  chkReorder: $('chkReorder'),
  btnAnalyze: $('btnAnalyze'),
  btnSave: $('btnSave'),
  status: $('status'),
  emptyState: $('emptyState'),
  resultArea: $('resultArea'),
  stats: $('stats'),
  targetRows: $('targetRows'),
  procedureRows: $('procedureRows'),
  targetFilterInfo: $('targetFilterInfo'),
  chkShowOnlyUsed: $('chkShowOnlyUsed'),
  preview: $('preview'),
  previewInfo: $('previewInfo'),
  warningsList: $('warningsList'),
  warnCount: $('warnCount'),
  btnCopy: $('btnCopy')
};

function setStatus(message, type = 'info') {
  els.status.className = `status visible ${type}`;
  els.status.textContent = message;
}

function clearStatus() {
  els.status.className = 'status';
  els.status.textContent = '';
}

function setBusy(busy) {
  els.btnAnalyze.disabled = busy || !state.input;
  els.btnSave.disabled = busy || !state.result;
  els.btnBrowseInput.disabled = busy;
  els.btnAnalyze.textContent = busy ? 'Analisi...' : 'Analizza';
}

function updateControls() {
  const hasInput = Boolean(state.input);
  const rename = els.chkRename.checked;
  const prefixMode = rename && els.namingMode.value === 'prefix';

  els.btnAnalyze.disabled = !hasInput;
  els.btnSave.disabled = !(hasInput && state.result);
  els.namingMode.disabled = !rename;
  els.chkRenameOnlyUsed.disabled = !rename;
  els.prefix.disabled = !prefixMode;
  els.start.disabled = !rename;
  els.width.disabled = !rename;

  const suggested = state.result && state.result.analysis
    ? state.result.analysis.suggestedPrefix
    : null;
  const prefixes = state.result && state.result.analysis && Array.isArray(state.result.analysis.prefixes)
    ? state.result.analysis.prefixes
    : [];

  if (!rename) {
    els.prefixHint.textContent = 'La rinomina è disattivata: verranno riordinate solo le dichiarazioni.';
  } else if (els.namingMode.value === 'auto') {
    if (prefixes.length === 1) {
      els.prefixHint.textContent = `Prefisso rilevato: ${suggested}. I robtarget con suffisso numerico verranno rinumerati per comparire in ordine crescente nelle procedure.`;
    } else if (prefixes.length > 1) {
      const preview = prefixes.slice(0, 6).join(', ') + (prefixes.length > 6 ? ', …' : '');
      els.prefixHint.textContent = `Più prefissi rilevati (${preview}): ogni gruppo viene rinumerato separatamente. Usa "Prefisso personalizzato" per ottenere un'unica numerazione progressiva.`;
    } else {
      els.prefixHint.textContent = 'Nessun prefisso numerico rilevato. Usa "Prefisso personalizzato" se vuoi rinominare i target.';
    }
  } else {
    els.prefixHint.textContent = 'Se vuoto, viene usato il prefisso rilevato automaticamente dal file.';
  }
}

function gatherOptions() {
  return {
    rename: els.chkRename.checked,
    onlyUsed: els.chkRenameOnlyUsed.checked,
    reorder: els.chkReorder.checked,
    namingMode: els.namingMode.value,
    prefix: els.prefix.value.trim(),
    start: Number(els.start.value) || 1,
    width: Number(els.width.value) || 0
  };
}

function resetResults() {
  state.result = null;
  state.savePath = null;
  els.emptyState.hidden = false;
  els.resultArea.hidden = true;
  els.targetRows.replaceChildren();
  els.procedureRows.replaceChildren();
  els.warningsList.replaceChildren();
  els.preview.textContent = '';
  els.stats.replaceChildren();
  updateControls();
}

async function browseInput() {
  try {
    const data = await window.api.openInput();
    if (!data) return;

    state.input = data;
    state.result = null;
    state.savePath = null;
    els.inputPath.value = data.filePath;
    els.filePill.textContent = data.fileName;
    els.filePill.title = data.filePath;
    if (!els.outputFolder.value) els.outputFolder.value = data.dir;

    resetResults();
    clearStatus();
    updateControls();
    await analyzeNow();
  } catch (error) {
    setStatus(`Errore durante l'apertura del file: ${error.message}`, 'error');
  }
}

async function browseFolder() {
  try {
    const defaultPath = els.outputFolder.value || (state.input && state.input.dir) || undefined;
    const folder = await window.api.openFolder(defaultPath);
    if (!folder) return;
    els.outputFolder.value = folder;
    updateControls();
  } catch (error) {
    setStatus(`Errore durante la selezione della cartella: ${error.message}`, 'error');
  }
}

function scheduleAnalyze() {
  if (!state.input) return;
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    analyzeNow();
  }, 220);
}

async function analyzeNow() {
  if (!state.input) return;

  const seq = ++state.analyzeSeq;
  setBusy(true);

  try {
    const result = await window.api.transform(state.input.text, gatherOptions());
    if (seq !== state.analyzeSeq) return;

    state.result = result;

    if (els.namingMode.value === 'prefix' && !els.prefix.value.trim() && result.analysis.suggestedPrefix) {
      els.prefix.value = result.analysis.suggestedPrefix;
    }

    renderResult(result);
    updateControls();

    if (result.warnings.length > 0) {
      setStatus(`Analisi completata con ${result.warnings.length} avviso/i. Controlla la scheda "Avvisi".`, 'info');
    } else {
      setStatus('Analisi completata. Controlla l\'anteprima, poi salva il file elaborato.', 'success');
    }
  } catch (error) {
    if (seq !== state.analyzeSeq) return;
    resetResults();
    setStatus(`Errore durante l'analisi: ${error.message}`, 'error');
  } finally {
    if (seq === state.analyzeSeq) {
      setBusy(false);
      updateControls();
    }
  }
}

function createStat(value, label, className = '') {
  const card = document.createElement('div');
  card.className = `stat ${className}`.trim();

  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = String(value);

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;

  card.append(valueEl, labelEl);
  return card;
}

function addCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function renderResult(result) {
  els.emptyState.hidden = true;
  els.resultArea.hidden = false;

  const stats = result.stats;
  els.stats.replaceChildren(
    createStat(stats.procedures, 'Procedure'),
    createStat(stats.targets, 'Robtarget'),
    createStat(stats.renamed, 'Rinominati', 'accent'),
    createStat(stats.reordered, 'Dichiarazioni spostate', 'accent'),
    createStat(stats.unused, 'Robtarget non usati', 'warning')
  );

  const targetRows = document.createDocumentFragment();
  const onlyUsed = els.chkShowOnlyUsed.checked;
  const visibleTargets = onlyUsed
    ? result.mapping.filter((item) => item.used)
    : result.mapping;

  for (const item of visibleTargets) {
    const row = document.createElement('tr');

    addCell(row, item.execIndex === null ? '—' : String(item.execIndex + 1), 'num');
    addCell(row, item.oldName, 'old-name');
    addCell(row, '→', 'arrow');

    const newCell = document.createElement('td');
    newCell.className = item.changed ? 'new-name changed' : 'new-name';
    newCell.textContent = item.newName;
    row.appendChild(newCell);

    addCell(row, String(item.refCount), 'num');

    const usedCell = document.createElement('td');
    const usedPill = document.createElement('span');
    usedPill.className = item.used ? 'pill yes' : 'pill no';
    usedPill.textContent = item.used ? 'Sì' : 'No';
    usedCell.appendChild(usedPill);
    row.appendChild(usedCell);

    addCell(row, item.scope, 'scope');
    addCell(row, String(item.line), 'num');

    targetRows.appendChild(row);
  }

  if (visibleTargets.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'empty-row';
    cell.textContent = 'Nessun robtarget utilizzato da mostrare.';
    row.appendChild(cell);
    targetRows.appendChild(row);
  }

  els.targetFilterInfo.textContent = `${visibleTargets.length} di ${result.mapping.length} robtarget mostrati`;
  els.targetRows.replaceChildren(targetRows);

  const procedureRows = document.createDocumentFragment();
  for (const procedure of result.analysis.procedures) {
    const row = document.createElement('tr');
    addCell(row, procedure.name, 'old-name');
    addCell(row, procedure.kind);
    addCell(row, String(procedure.line), 'num');

    const sequence = (procedure.targets || []).map((target) => target.newName);
    const sequenceCell = addCell(row, sequence.length > 0 ? sequence.join(' → ') : '—', 'sequence');
    sequenceCell.title = (procedure.targets || [])
      .map((target) => `${target.oldName} → ${target.newName}`)
      .join('\n');

    const statusCell = document.createElement('td');
    const statusPill = document.createElement('span');
    statusPill.className = procedure.ordered ? 'pill yes' : 'pill warn';
    statusPill.textContent = procedure.ordered ? 'Ordinata' : 'Verifica';
    statusCell.appendChild(statusPill);
    row.appendChild(statusCell);

    procedureRows.appendChild(row);
  }
  els.procedureRows.replaceChildren(procedureRows);

  els.warningsList.replaceChildren();
  if (result.warnings.length === 0) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = 'Nessun avviso: il file è stato analizzato senza anomalie.';
    els.warningsList.appendChild(item);
  } else {
    for (const warning of result.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      els.warningsList.appendChild(item);
    }
  }
  els.warnCount.textContent = String(result.warnings.length);

  els.preview.textContent = result.output;
  const lineCount = result.output.split(/\r\n|\n|\r/).length;
  els.previewInfo.textContent = `${lineCount} righe · ${stats.renamed} rinomine · ${stats.reordered} dichiarazioni spostate`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.className = 'clipboard-helper';
    area.value = text;
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

async function saveFile() {
  if (!state.input || !state.result) return;

  let folder = els.outputFolder.value.trim();
  if (!folder) {
    folder = await window.api.openFolder(state.input.dir);
    if (!folder) {
      setStatus('Seleziona un\'area di lavoro prima di salvare.', 'error');
      return;
    }
    els.outputFolder.value = folder;
  }

  setBusy(true);
  try {
    const savedPath = await window.api.save(folder, state.input.fileName, state.result.output);
    state.savePath = savedPath;

    els.status.className = 'status visible success';
    els.status.replaceChildren(document.createTextNode(`File salvato: ${savedPath}`));

    const revealButton = document.createElement('button');
    revealButton.type = 'button';
    revealButton.className = 'btn secondary small';
    revealButton.textContent = 'Mostra nella cartella';
    revealButton.addEventListener('click', () => window.api.reveal(savedPath));

    els.status.appendChild(document.createElement('br'));
    els.status.appendChild(revealButton);
  } catch (error) {
    setStatus(`Errore durante il salvataggio: ${error.message}`, 'error');
  } finally {
    setBusy(false);
    updateControls();
  }
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const panels = [...document.querySelectorAll('.tab-panel')];

  const activate = (tab) => {
    for (const item of tabs) {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab));
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
  }
}

function setupEvents() {
  els.btnBrowseInput.addEventListener('click', browseInput);
  els.btnBrowseFolder.addEventListener('click', browseFolder);
  els.btnAnalyze.addEventListener('click', analyzeNow);
  els.btnSave.addEventListener('click', saveFile);

  els.chkRename.addEventListener('change', () => {
    updateControls();
    scheduleAnalyze();
  });

  els.chkReorder.addEventListener('change', () => {
    updateControls();
    scheduleAnalyze();
  });

  els.chkRenameOnlyUsed.addEventListener('change', () => {
    updateControls();
    scheduleAnalyze();
  });

  els.chkShowOnlyUsed.addEventListener('change', () => {
    if (state.result) renderResult(state.result);
  });

  els.namingMode.addEventListener('change', () => {
    if (els.namingMode.value === 'prefix' && !els.prefix.value.trim()) {
      const suggested = state.result && state.result.analysis
        ? state.result.analysis.suggestedPrefix
        : null;
      if (suggested) els.prefix.value = suggested;
    }
    updateControls();
    scheduleAnalyze();
  });

  for (const input of [els.prefix, els.start, els.width]) {
    input.addEventListener('input', () => {
      updateControls();
      scheduleAnalyze();
    });
  }

  els.btnCopy.addEventListener('click', async () => {
    if (!state.result) return;
    const copied = await copyText(state.result.output);
    setStatus(
      copied ? 'Contenuto copiato negli appunti.' : 'Impossibile copiare negli appunti.',
      copied ? 'success' : 'error'
    );
  });

  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === 'o') {
      event.preventDefault();
      browseInput();
    } else if (key === 's' && !els.btnSave.disabled) {
      event.preventDefault();
      saveFile();
    }
  });

  window.addEventListener('error', (event) => {
    setStatus(`Errore inatteso: ${event.message}`, 'error');
  });
}

if (!window.api) {
  setStatus('API Electron non disponibile. Avvia l\'app con "npm start".', 'error');
} else {
  setupTabs();
  setupEvents();
  updateControls();
}
