'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyze, transform } = require('../src/core/rapid');

const samplePath = path.join(__dirname, '..', 'samples', 'demo.modx');
const sample = fs.readFileSync(samplePath, 'utf8');

function targetMap(text) {
  const map = new Map();
  const re = /robtarget\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*\[\[([^\[\]]+)\]/gi;
  let match;
  while ((match = re.exec(text))) {
    map.set(match[1].toLowerCase(), match[2].trim());
  }
  return map;
}

function moveCoordinates(text) {
  const targets = targetMap(text);
  const moves = [];
  const re = /\bMove[JL]\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let match;
  while ((match = re.exec(text))) {
    const key = match[1].toLowerCase();
    assert.ok(targets.has(key), `Target ${match[1]} non dichiarato`);
    moves.push(targets.get(key));
  }
  return moves;
}

test('analizza modulo, procedure e ordine progressivo dei robtarget', () => {
  const analysis = analyze(sample);

  assert.equal(analysis.moduleName, 'DemoModule');
  assert.deepEqual(analysis.procedures.map((p) => p.name), ['main', 'PickPart']);
  assert.equal(analysis.targets.length, 5);
  assert.deepEqual(analysis.orderKeys, ['p004', 'p003', 'p001', 'p002', 'p005']);
  assert.equal(analysis.suggestedPrefix, 'P');

  const byName = new Map(analysis.targets.map((target) => [target.name, target]));
  assert.equal(byName.get('P005').used, false);
  assert.equal(byName.get('P004').used, true);
  assert.equal(byName.get('P004').refCount, 1);
});

test('rinomina e riordina senza cambiare il percorso', () => {
  const result = transform(sample, { rename: true, reorder: true });
  const movesBefore = moveCoordinates(sample);
  const movesAfter = moveCoordinates(result.output);

  assert.deepEqual(movesAfter, movesBefore);
  assert.equal(result.stats.targets, 5);
  assert.equal(result.stats.renamed, 4);
  assert.equal(result.stats.reordered, 3);

  const mapping = new Map(result.mapping.map((item) => [item.oldName, item.newName]));
  assert.equal(mapping.get('P004'), 'P001');
  assert.equal(mapping.get('P003'), 'P002');
  assert.equal(mapping.get('P001'), 'P003');
  assert.equal(mapping.get('P002'), 'P004');
  assert.equal(mapping.get('P005'), 'P005');

  const declarations = [...result.output.matchAll(/robtarget\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*\[\[([^\[\]]+)\]/gi)]
    .map((match) => [match[1], match[2].trim()]);
  assert.deepEqual(declarations, [
    ['P001', '400,0,500'],
    ['P002', '300,0,500'],
    ['P003', '100,0,500'],
    ['P004', '200,0,500'],
    ['P005', '500,0,500']
  ]);

  assert.ok(result.output.includes('! Commento di prova: P001 e P002 non devono essere modificati qui'));
  assert.ok(result.output.includes('CONST string sMsg := "P002 resta una stringa";'));
  assert.ok(result.output.includes('PERS tooldata tGripper'));
});

test('la dichiarazione non-target resta nella stessa posizione', () => {
  const result = transform(sample, { rename: true, reorder: true });
  const lines = result.output.split(/\r?\n/);
  const toolIndex = lines.findIndex((line) => line.includes('PERS tooldata tGripper'));
  const p004Index = lines.findIndex((line) => /robtarget P004/.test(line));
  const p005Index = lines.findIndex((line) => /robtarget P005/.test(line));

  assert.ok(toolIndex > p004Index);
  assert.ok(toolIndex < p005Index);
});

test('con rinomina disattivata riordina soltanto le dichiarazioni', () => {
  const result = transform(sample, { rename: false, reorder: true });
  assert.equal(result.stats.renamed, 0);
  assert.ok(result.output.includes('CONST robtarget P004 := [[400,0,500]'));
  assert.ok(!result.output.includes('CONST robtarget P001 := [[400,0,500]'));
  assert.ok(result.output.includes('MoveJ P004'));
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(sample));
});

test('con riordino disattivato rinomina soltanto i simboli', () => {
  const result = transform(sample, { rename: true, reorder: false });
  assert.equal(result.stats.reordered, 0);
  const declarationsBefore = [...sample.matchAll(/robtarget\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
  const declarationsAfter = [...result.output.matchAll(/robtarget\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
  assert.deepEqual(declarationsAfter, ['P002', 'P003', 'P001', 'P004', 'P005']);
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(sample));
  assert.equal(declarationsBefore.length, declarationsAfter.length);
});

test('supporta un prefisso personalizzato', () => {
  const result = transform(sample, {
    rename: true,
    reorder: true,
    namingMode: 'prefix',
    prefix: 'POS',
    start: 10,
    width: 2
  });

  assert.equal(result.mapping[0].newName, 'POS10');
  assert.equal(result.mapping[1].newName, 'POS11');
  assert.equal(result.mapping[4].newName, 'POS14');
  assert.ok(result.output.includes('CONST robtarget POS10 := [[400,0,500]'));
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(sample));
});

test('usa le routine non chiamate come ingresso se main manca', () => {
  const text = [
    'MODULE NoMain',
    '  CONST robtarget A1 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget B1 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC Start()',
    '    MoveJ B1, v100, fine, tool0;',
    '    Sub;',
    '  ENDPROC',
    '  PROC Sub()',
    '    MoveL A1, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\r\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.deepEqual(result.analysis.orderKeys, ['b1', 'a1']);
  assert.equal(result.analysis.warnings.some((w) => w.includes('main')), true);
  assert.ok(result.output.includes('\r\n'));
});

test('rinomina i riferimenti senza distinzione tra maiuscole e minuscole', () => {
  const text = [
    'MODULE CaseTest',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL p02, v100, fine, tool0;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.deepEqual(result.analysis.orderKeys, ['p02', 'p01']);
  assert.ok(/MoveL P01,/.test(result.output));
  assert.ok(/MoveL P02,/.test(result.output));
});

test('non rinomina target senza suffisso numerico in modalità automatica', () => {
  const text = [
    'MODULE NoDigits',
    '  CONST robtarget pHome := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget pPick := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL pPick, v100, fine, tool0;',
    '    MoveL pHome, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.equal(result.stats.renamed, 0);
  assert.ok(result.warnings.some((w) => w.includes('suffisso numerico')));
  assert.ok(result.output.includes('pHome'));
  assert.ok(result.output.includes('pPick'));
});

test('gestisce dichiarazioni su più righe', () => {
  const text = [
    'MODULE MultiLine',
    '  CONST robtarget P02 := [[2,0,0],',
    '    [1,0,0,0],',
    '    [0,0,0,0],',
    '    [9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P01 := [[1,0,0],',
    '    [1,0,0,0],',
    '    [0,0,0,0],',
    '    [9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P01, v100, fine, tool0;',
    '    MoveL P02, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));
  assert.ok(result.output.includes('CONST robtarget P01 := [[1,0,0],'));
});

test('non interpreta i parametri robtarget della testata come dichiarazioni', () => {
  const text = [
    'MODULE HeaderParams',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P02, v100, fine, tool0;',
    '    Helper P01;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    '  PROC Helper(VAR robtarget px)',
    '    MoveL px, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const analysis = analyze(text);
  assert.equal(analysis.targets.length, 2);
  assert.deepEqual(analysis.orderKeys, ['p02', 'p01']);

  const result = transform(text, { rename: true, reorder: true });
  assert.ok(result.output.includes('PROC Helper(VAR robtarget px)'));
  const before = targetMap(text);
  const after = targetMap(result.output);
  assert.equal(after.get('p01'), before.get('p02'));
  assert.equal(after.get('p02'), before.get('p01'));
});

test('mantiene le dichiarazioni locali nel loro scope', () => {
  const text = [
    'MODULE LocalTargets',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    CONST robtarget L01 := [[9,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '    MoveL P02, v100, fine, tool0;',
    '    MoveL L01, v100, fine, tool0;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  const mainStart = result.output.indexOf('PROC main()');
  const localIndex = result.output.indexOf('robtarget L01');
  const endProcIndex = result.output.indexOf('ENDPROC');

  assert.ok(localIndex > mainStart);
  assert.ok(localIndex < endProcIndex);
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));
});

test('gestisce procedure senza parentesi seguite da un IF', () => {
  const text = [
    'MODULE NoParen',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC Start',
    '    CONST robtarget L01 := [[9,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '    IF (TRUE) THEN',
    '      MoveL P02, v100, fine, tool0;',
    '    ENDIF',
    '    MoveL L01, v100, fine, tool0;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const analysis = analyze(text);
  assert.equal(analysis.procedures.length, 1);
  assert.equal(analysis.targets.length, 3);
  const local = analysis.targets.find((target) => target.name === 'L01');
  assert.equal(local.scopeName, 'Start');

  const result = transform(text, { rename: true, reorder: true });
  const procStart = result.output.indexOf('PROC Start');
  const localIndex = result.output.indexOf('robtarget L01');
  const endProcIndex = result.output.indexOf('ENDPROC');
  assert.ok(localIndex > procStart);
  assert.ok(localIndex < endProcIndex);
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));
});

test('sposta i commenti di fine riga insieme alla dichiarazione', () => {
  const text = [
    'MODULE TrailingComments',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]; ! secondo',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]; ! primo',
    '  PROC main()',
    '    MoveL P01, v100, fine, tool0;',
    '    MoveL P02, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.ok(result.output.includes('robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]; ! primo'));
  assert.ok(result.output.includes('robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]; ! secondo'));
});

test('numera i target in ordine crescente dentro ogni procedura', () => {
  const text = [
    'MODULE ProcOrder',
    '  CONST robtarget P005 := [[5,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P003 := [[3,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P001 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P005, v100, fine, tool0;',
    '    Pick;',
    '    MoveL P001, v100, fine, tool0;',
    '  ENDPROC',
    '  PROC Pick()',
    '    MoveL P003, v100, fine, tool0;',
    '    MoveL P005, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  const mapping = new Map(result.mapping.map((item) => [item.oldName, item.newName]));

  assert.equal(mapping.get('P003'), 'P001');
  assert.equal(mapping.get('P005'), 'P002');
  assert.equal(mapping.get('P001'), 'P003');

  const mainStart = result.output.indexOf('PROC main');
  const mainEnd = result.output.indexOf('ENDPROC', mainStart);
  const mainBody = result.output.slice(mainStart, mainEnd);
  const pickStart = result.output.indexOf('PROC Pick');
  const pickEnd = result.output.indexOf('ENDPROC', pickStart);
  const pickBody = result.output.slice(pickStart, pickEnd);

  assert.ok(/MoveL P002[\s\S]*MoveL P003/.test(mainBody));
  assert.ok(/MoveL P001[\s\S]*MoveL P002/.test(pickBody));
  assert.deepEqual(
    [...result.output.matchAll(/robtarget\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((match) => match[1]),
    ['P001', 'P002', 'P003']
  );
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));

  const mainProcedure = result.analysis.procedures.find((procedure) => procedure.name === 'main');
  const pickProcedure = result.analysis.procedures.find((procedure) => procedure.name === 'Pick');
  assert.deepEqual(mainProcedure.targets.map((target) => target.newName), ['P002', 'P003']);
  assert.equal(mainProcedure.ordered, true);
  assert.deepEqual(pickProcedure.targets.map((target) => target.newName), ['P001', 'P002']);
  assert.equal(pickProcedure.ordered, true);
});

test('segnala i conflitti quando i target condivisi hanno ordini contrastanti', () => {
  const text = [
    'MODULE Conflict',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P01, v100, fine, tool0;',
    '    MoveL P02, v100, fine, tool0;',
    '  ENDPROC',
    '  PROC Other()',
    '    MoveL P02, v100, fine, tool0;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true });
  assert.ok(result.warnings.some((warning) => warning.includes('ordini diversi')));
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));

  const mainProcedure = result.analysis.procedures.find((procedure) => procedure.name === 'main');
  const otherProcedure = result.analysis.procedures.find((procedure) => procedure.name === 'Other');
  assert.equal(mainProcedure.ordered, true);
  assert.equal(otherProcedure.ordered, false);
  assert.deepEqual(mainProcedure.targets.map((target) => target.newName), ['P01', 'P02']);
  assert.deepEqual(otherProcedure.targets.map((target) => target.newName), ['P02', 'P01']);
});

test('riconosce riferimenti equivalenti ignorando gli underscore', () => {
  const text = [
    'MODULE Underscore',
    '  PERS robtarget P_02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PERS robtarget P_01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P02_, v100, fine, tool0;',
    '    MoveL P01_, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true, onlyUsed: true });
  const mapping = new Map(result.mapping.map((item) => [item.oldName, item.newName]));

  assert.equal(mapping.get('P_02'), 'P_01');
  assert.equal(mapping.get('P_01'), 'P_02');
  assert.ok(result.output.includes('MoveL P_01,'));
  assert.ok(result.output.includes('MoveL P_02,'));
  assert.ok(!result.output.includes('P02_'));
  assert.ok(!result.output.includes('P01_'));
  assert.ok(result.warnings.some((warning) => warning.includes('equivalente')));

  const target = result.analysis.targets.find((item) => item.name === 'P_02');
  assert.equal(target.used, true);
  assert.equal(target.refCount, 1);
  assert.equal(result.stats.unused, 0);
  assert.deepEqual(moveCoordinates(result.output), ['2,0,0', '1,0,0']);
});

test('rinomina solo i punti utilizzati quando richiesto', () => {
  const text = [
    'MODULE OnlyUsed',
    '  CONST robtarget P05 := [[5,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  CONST robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P02, v100, fine, tool0;',
    '    MoveL P01, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const result = transform(text, { rename: true, reorder: true, onlyUsed: true });
  const mapping = new Map(result.mapping.map((item) => [item.oldName, item.newName]));

  assert.equal(mapping.get('P02'), 'P01');
  assert.equal(mapping.get('P01'), 'P02');
  assert.equal(mapping.get('P05'), 'P05');
  assert.equal(result.stats.renamed, 2);
  assert.equal(result.stats.unused, 1);
  assert.ok(result.output.includes('CONST robtarget P05 := [[5,0,0]'));
  assert.deepEqual(moveCoordinates(result.output), moveCoordinates(text));
});

test('riconosce qualificatori LOCAL e TASK', () => {
  const text = [
    'MODULE Qualifiers',
    '  LOCAL CONST robtarget P02 := [[2,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  TASK PERS robtarget P01 := [[1,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];',
    '  PROC main()',
    '    MoveL P01, v100, fine, tool0;',
    '    MoveL P02, v100, fine, tool0;',
    '  ENDPROC',
    'ENDMODULE'
  ].join('\n');

  const analysis = analyze(text);
  assert.equal(analysis.targets.length, 2);
  assert.equal(analysis.targets[0].isLocal, true);
  assert.equal(analysis.targets[1].isTask, true);
});
