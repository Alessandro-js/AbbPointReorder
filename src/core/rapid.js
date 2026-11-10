'use strict';

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function normalizeKey(name) {
  return name.toLowerCase().replace(/_/g, '');
}

function lineAndColumn(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function maskText(text) {
  const chars = text.split('');
  const len = text.length;
  const blank = (index) => {
    if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  };

  let i = 0;
  while (i < len) {
    const c = text[i];
    if (c === '"') {
      blank(i);
      i += 1;
      while (i < len) {
        if (text[i] === '\\' && i + 1 < len) {
          blank(i);
          blank(i + 1);
          i += 2;
        } else if (text[i] === '"') {
          if (text[i + 1] === '"') {
            blank(i);
            blank(i + 1);
            i += 2;
          } else {
            blank(i);
            i += 1;
            break;
          }
        } else {
          blank(i);
          i += 1;
        }
      }
    } else if (c === '!') {
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        blank(i);
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

function findModuleName(text, masked) {
  const match = /(?:^|[\r\n])\s*MODULE\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(masked);
  return match ? match[1] : null;
}

function findHeaderEnd(masked, afterName) {
  const len = masked.length;
  let i = afterName;
  while (i < len && (masked[i] === ' ' || masked[i] === '\t')) i += 1;

  let parenIndex = -1;
  if (masked[i] === '(') {
    parenIndex = i;
  } else if (masked[i] === '\n' || masked[i] === '\r') {
    let lookahead = i;
    while (lookahead < len && /\s/.test(masked[lookahead])) lookahead += 1;
    if (masked[lookahead] === '(') parenIndex = lookahead;
  }

  if (parenIndex !== -1) {
    let depth = 0;
    let j = parenIndex;
    for (; j < len; j += 1) {
      if (masked[j] === '(') depth += 1;
      else if (masked[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    let k = j;
    while (k < len && masked[k] !== '\n' && masked[k] !== '\r') k += 1;
    if (masked[k] === '\r') k += 1;
    if (masked[k] === '\n') k += 1;
    return { headerEnd: j, bodyStart: k };
  }

  let k = i;
  while (k < len && masked[k] !== '\n' && masked[k] !== '\r' && masked[k] !== ';') k += 1;
  if (masked[k] === ';') k += 1;
  if (masked[k] === '\r') k += 1;
  if (masked[k] === '\n') k += 1;
  return { headerEnd: k, bodyStart: k };
}

function findProcedures(text, masked) {
  const procedures = [];
  const re = /(?<![A-Za-z0-9_])(PROC|TRAP|FUNC)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let match;

  while ((match = re.exec(masked))) {
    const kind = match[1].toUpperCase();
    const name = match[2];
    const start = match.index;
    const header = findHeaderEnd(masked, re.lastIndex);
    const endRe = new RegExp(`(?<![A-Za-z0-9_])END${kind}(?![A-Za-z0-9_])`, 'gi');
    endRe.lastIndex = header.bodyStart;
    const endMatch = endRe.exec(masked);
    const bodyEnd = endMatch ? endMatch.index : text.length;
    const end = endMatch ? endMatch.index + endMatch[0].length : text.length;
    const location = lineAndColumn(text, start);

    procedures.push({
      kind,
      name,
      key: name.toLowerCase(),
      start,
      headerEnd: header.headerEnd,
      bodyStart: header.bodyStart,
      bodyEnd,
      end,
      line: location.line,
      warning: endMatch ? null : `END${kind} non trovato per ${name}.`
    });

    re.lastIndex = end;
  }

  return procedures;
}

function findTargets(text, masked, procedures) {
  const targets = [];
  const re = /(?<![A-Za-z0-9_])((?:(?:LOCAL|TASK)\s+)?(?:CONST|VAR|PERS)\s+robtarget\s+)([A-Za-z_][A-Za-z0-9_]*)(\s*\{[^}]*\})?/gi;
  let match;

  while ((match = re.exec(masked))) {
    const start = match.index;
    const name = match[2];
    const arraySuffix = match[3] || '';
    const inHeader = procedures.some((p) => start >= p.start && start < p.bodyStart);

    if (inHeader) {
      continue;
    }

    const semicolon = masked.indexOf(';', re.lastIndex);
    if (semicolon === -1) break;

    let end = semicolon + 1;
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') lineEnd += 1;
    const trailing = text.slice(end, lineEnd);
    if (/^[ \t]*!/.test(trailing)) end = lineEnd;

    const declaration = text.slice(start, end);
    const nameStart = start + match[1].length;
    const location = lineAndColumn(text, start);
    const typeMatch = /(CONST|VAR|PERS)/i.exec(match[1]);
    const type = typeMatch ? typeMatch[1].toUpperCase() : 'CONST';

    targets.push({
      name,
      key: name.toLowerCase(),
      type,
      isLocal: /(?:^|\s)LOCAL\s/i.test(match[1]),
      isTask: /(?:^|\s)TASK\s/i.test(match[1]),
      arraySuffix,
      start,
      end,
      nameStart,
      nameEnd: nameStart + name.length,
      declaration,
      line: location.line,
      column: location.column,
      scopeKey: '__module__',
      scopeName: null,
      refCount: 0,
      used: false,
      execIndex: null,
      newName: name,
      changed: false
    });

    re.lastIndex = end;
  }

  for (const target of targets) {
    const owner = procedures.find((p) => target.start >= p.bodyStart && target.start < p.bodyEnd);
    if (owner) {
      target.scopeKey = owner.key;
      target.scopeName = owner.name;
    }
  }

  return targets;
}

function tokenizeIdentifiers(masked, from = 0, to = masked.length) {
  const re = new RegExp(IDENTIFIER_RE.source, 'g');
  re.lastIndex = from;
  const tokens = [];
  let match;
  while ((match = re.exec(masked)) && match.index < to) {
    tokens.push({
      value: match[0],
      key: match[0].toLowerCase(),
      start: match.index,
      end: re.lastIndex
    });
  }
  return tokens;
}

function isInsideAny(spans, index) {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid];
    if (index < span.start) hi = mid - 1;
    else if (index >= span.end) lo = mid + 1;
    else return true;
  }
  return false;
}

function computeExecutionOrder(procedures, events, targets) {
  const warnings = [];
  const visited = new Set();
  const seenTargets = new Set();
  const order = [];

  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const items = events.get(key) || [];
    for (const event of items) {
      if (event.type === 'target') {
        if (!seenTargets.has(event.key)) {
          seenTargets.add(event.key);
          order.push(event.key);
        }
      } else if (event.type === 'call') {
        visit(event.key);
      }
    }
  };

  const main = procedures.find((p) => p.key === 'main');
  if (main) {
    visit(main.key);
  } else if (procedures.length > 0) {
    const called = new Set();
    for (const items of events.values()) {
      for (const event of items) {
        if (event.type === 'call') called.add(event.key);
      }
    }
    const roots = procedures.filter((p) => !called.has(p.key));
    const entries = roots.length > 0 ? roots : procedures;
    for (const procedure of entries) visit(procedure.key);
    warnings.push('Nessuna PROC main trovata: uso le routine non chiamate come punti di ingresso.');
  }

  for (const procedure of procedures) visit(procedure.key);

  for (const target of targets) {
    if (!seenTargets.has(target.key)) {
      seenTargets.add(target.key);
      order.push(target.key);
    }
  }

  return { order, warnings };
}

function computeProcedureOrder(procedures, events, targets, executionOrder) {
  const warnings = [];
  const targetKeys = new Set(targets.map((target) => target.key));
  const targetNames = new Map();
  const targetStarts = new Map();

  for (const target of targets) {
    if (!targetNames.has(target.key)) targetNames.set(target.key, target.name);
    if (!targetStarts.has(target.key)) targetStarts.set(target.key, target.start);
  }

  const executionIndex = new Map(executionOrder.map((key, index) => [key, index]));
  const edges = new Map();
  const indegree = new Map();
  const referenced = new Set();

  const addNode = (key) => {
    if (!edges.has(key)) {
      edges.set(key, new Set());
      indegree.set(key, 0);
    }
  };

  for (const procedure of procedures) {
    const sequence = [];
    const seen = new Set();

    for (const event of events.get(procedure.key) || []) {
      if (event.type !== 'target') continue;
      if (!targetKeys.has(event.key)) continue;
      if (seen.has(event.key)) continue;
      seen.add(event.key);
      sequence.push(event.key);
      referenced.add(event.key);
      addNode(event.key);
    }

    for (let i = 1; i < sequence.length; i += 1) {
      const from = sequence[i - 1];
      const to = sequence[i];
      if (from === to) continue;
      if (!edges.get(from).has(to)) {
        edges.get(from).add(to);
        indegree.set(to, (indegree.get(to) || 0) + 1);
      }
    }
  }

  const priority = (key) => ({
    execution: executionIndex.has(key) ? executionIndex.get(key) : Number.MAX_SAFE_INTEGER,
    start: targetStarts.has(key) ? targetStarts.get(key) : Number.MAX_SAFE_INTEGER
  });

  const comparePriority = (a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa.execution !== pb.execution) return pa.execution - pb.execution;
    return pa.start - pb.start;
  };

  const remaining = new Set(edges.keys());
  const order = [];
  const forced = [];

  while (remaining.size > 0) {
    let candidate = null;

    for (const key of remaining) {
      if ((indegree.get(key) || 0) !== 0) continue;
      if (candidate === null || comparePriority(key, candidate) < 0) candidate = key;
    }

    if (candidate === null) {
      for (const key of remaining) {
        if (candidate === null || comparePriority(key, candidate) < 0) candidate = key;
      }
      if (candidate !== null) forced.push(candidate);
    }

    if (candidate === null) break;

    order.push(candidate);
    remaining.delete(candidate);

    for (const next of edges.get(candidate) || []) {
      if (remaining.has(next)) {
        indegree.set(next, Math.max(0, (indegree.get(next) || 0) - 1));
      }
    }
  }

  if (forced.length > 0) {
    const names = [...new Set(forced)]
      .map((key) => targetNames.get(key) || key)
      .slice(0, 8)
      .join(', ');
    warnings.push(
      `Alcuni robtarget sono usati in ordini diversi in procedure diverse: non è possibile avere numeri crescenti in tutte le procedure. ` +
      `L'ordine è stato completato usando l'ordine di esecuzione come fallback (es. ${names}).`
    );
  }

  for (const target of targets) {
    if (!referenced.has(target.key)) order.push(target.key);
  }

  return { order, warnings };
}

function detectCommonPrefix(targets) {
  const prefixes = detectPrefixes(targets);
  return prefixes.length === 1 ? prefixes[0] : null;
}

function detectPrefixes(targets) {
  const prefixes = new Set();
  for (const target of targets) {
    const match = /^(.*?)(\d+)$/.exec(target.name);
    if (match && match[1]) prefixes.add(match[1]);
  }
  return [...prefixes];
}

function buildState(text) {
  const masked = maskText(text);
  const moduleName = findModuleName(text, masked);
  const procedures = findProcedures(text, masked);
  const targets = findTargets(text, masked, procedures);
  const warnings = [];

  for (const procedure of procedures) {
    if (procedure.warning) warnings.push(procedure.warning);
  }

  const targetMap = new Map();
  for (const target of targets) {
    if (targetMap.has(target.key)) {
      warnings.push(`Robtarget duplicato: ${target.name}.`);
    } else {
      targetMap.set(target.key, target);
    }
  }

  const routineMap = new Map();
  for (const procedure of procedures) {
    if (routineMap.has(procedure.key)) {
      warnings.push(`Routine duplicata: ${procedure.name}.`);
    } else {
      routineMap.set(procedure.key, procedure);
    }
  }

  const normalizedTargets = new Map();
  for (const target of targets) {
    const normalized = normalizeKey(target.name);
    if (!normalizedTargets.has(normalized)) normalizedTargets.set(normalized, []);
    normalizedTargets.get(normalized).push(target);
  }

  const ambiguousNormalized = new Map();
  for (const [normalized, list] of normalizedTargets) {
    if (list.length > 1) ambiguousNormalized.set(normalized, list);
  }
  if (ambiguousNormalized.size > 0) {
    const examples = [...ambiguousNormalized.values()]
      .slice(0, 5)
      .map((list) => list.map((target) => target.name).join(' / '));
    warnings.push(
      `Nomi equivalenti ignorando gli underscore ma ambigui: ${examples.join('; ')}.`
    );
  }

  const declaredNames = new Set();
  const declarationRe = /(?<![A-Za-z0-9_])(?:(?:LOCAL|TASK)\s+)?(?:CONST|VAR|PERS)\s+[A-Za-z_][A-Za-z0-9_]*\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let declarationMatch;
  while ((declarationMatch = declarationRe.exec(masked))) {
    declaredNames.add(declarationMatch[1].toLowerCase());
  }
  for (const key of targetMap.keys()) declaredNames.delete(key);

  const aliasMap = new Map();
  const aliasNames = new Map();
  for (const token of tokenizeIdentifiers(masked)) {
    if (targetMap.has(token.key)) continue;
    if (routineMap.has(token.key)) continue;
    if (declaredNames.has(token.key)) continue;

    const list = normalizedTargets.get(normalizeKey(token.value));
    if (!list || list.length !== 1) continue;
    const target = list[0];
    if (target.key === token.key) continue;

    aliasMap.set(token.key, target.key);
    if (!aliasNames.has(token.key)) aliasNames.set(token.key, token.value);
  }

  if (aliasMap.size > 0) {
    const examples = [...aliasMap.entries()]
      .slice(0, 8)
      .map(([aliasKey, targetKey]) => {
        const target = targetMap.get(targetKey);
        return `${aliasNames.get(aliasKey) || aliasKey} → ${target ? target.name : targetKey}`;
      });
    warnings.push(
      `Riconosciuti ${aliasMap.size} riferimenti con nome equivalente (differenze di underscore): ` +
      `${examples.join(', ')}${aliasMap.size > 8 ? ', …' : ''}. Verranno allineati ai nomi dichiarati.`
    );
  }

  const unresolvedReferences = [];
  for (const procedure of procedures) {
    const body = masked.slice(procedure.bodyStart, procedure.bodyEnd);
    const moveRe = /\bMove[JLC]\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s*[,;])/gi;
    let moveMatch;
    while ((moveMatch = moveRe.exec(body))) {
      const name = moveMatch[1];
      const key = name.toLowerCase();
      if (targetMap.has(key) || aliasMap.has(key) || routineMap.has(key)) continue;
      const location = lineAndColumn(text, procedure.bodyStart + moveMatch.index);
      unresolvedReferences.push(`${name} (${procedure.name}, riga ${location.line})`);
    }
  }
  if (unresolvedReferences.length > 0) {
    const unique = [...new Set(unresolvedReferences)];
    warnings.push(
      `Riferimenti robtarget non dichiarati: ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? ', …' : ''}.`
    );
  }

  const declarationSpans = targets
    .map((target) => ({ start: target.start, end: target.end }))
    .sort((a, b) => a.start - b.start);

  const events = new Map();
  const resolveTarget = (token) => {
    const exact = targetMap.get(token.key);
    if (exact) return exact;
    const aliasTargetKey = aliasMap.get(token.key);
    if (aliasTargetKey) return targetMap.get(aliasTargetKey) || null;
    return null;
  };

  for (const procedure of procedures) {
    const items = [];
    for (const token of tokenizeIdentifiers(masked, procedure.bodyStart, procedure.bodyEnd)) {
      if (isInsideAny(declarationSpans, token.start)) continue;

      const target = resolveTarget(token);
      if (target) {
        target.refCount += 1;
        items.push({ type: 'target', key: target.key });
      } else if (routineMap.has(token.key)) {
        items.push({ type: 'call', key: token.key });
      }
    }
    events.set(procedure.key, items);
  }

  const execution = computeExecutionOrder(procedures, events, targets);
  warnings.push(...execution.warnings);

  const procedureOrder = computeProcedureOrder(procedures, events, targets, execution.order);
  warnings.push(...procedureOrder.warnings);

  const orderIndex = new Map(procedureOrder.order.map((key, index) => [key, index]));
  for (const target of targets) {
    target.execIndex = orderIndex.has(target.key) ? orderIndex.get(target.key) : null;
    target.used = target.refCount > 0;
  }

  const procedureTargetKeys = (procedureKey) => {
    const keys = [];
    const seen = new Set();
    for (const event of events.get(procedureKey) || []) {
      if (event.type !== 'target') continue;
      if (seen.has(event.key)) continue;
      seen.add(event.key);
      keys.push(event.key);
    }
    return keys;
  };

  const analysis = {
    moduleName,
    procedures: procedures.map((procedure) => ({
      name: procedure.name,
      key: procedure.key,
      kind: procedure.kind,
      line: procedure.line,
      start: procedure.start,
      end: procedure.end,
      targetKeys: procedureTargetKeys(procedure.key)
    })),
    targets,
    orderKeys: procedureOrder.order,
    suggestedPrefix: detectCommonPrefix(targets),
    prefixes: detectPrefixes(targets),
    warnings
  };

  return { masked, procedures, targets, analysis, targetMap, routineMap, events, aliasMap, aliasNames };
}

function analyze(text) {
  return buildState(text).analysis;
}

function sanitizePrefix(prefix) {
  let value = String(prefix || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!value || !/^[A-Za-z_]/.test(value)) value = `P${value}`;
  return value;
}

function trailingDigits(name) {
  const match = /^(.*?)(\d+)$/.exec(name);
  return match && match[1] ? match[2] : null;
}

function planNames(targets, orderKeys, options, reservedKeys) {
  const warnings = [];
  const orderIndex = new Map(orderKeys.map((key, index) => [key, index]));
  const ordered = targets.slice().sort((a, b) => {
    const ai = orderIndex.has(a.key) ? orderIndex.get(a.key) : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b.key) ? orderIndex.get(b.key) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.start - b.start;
  });

  const start = Number.isFinite(Number(options.start)) && Number(options.start) > 0
    ? Math.floor(Number(options.start))
    : 1;
  const userWidth = Number.isFinite(Number(options.width)) && Number(options.width) > 0
    ? Math.floor(Number(options.width))
    : 0;
  const names = new Map();
  const assigned = new Set(reservedKeys);

  const buildName = (prefix, number, width) => `${prefix}${String(number).padStart(width, '0')}`;

  const assignGroup = (prefixValue, items, baseWidth) => {
    const neededWidth = String(start + items.length - 1).length;
    const width = userWidth > 0
      ? Math.max(userWidth, neededWidth)
      : Math.max(baseWidth, neededWidth);
    let next = start;
    for (const target of items) {
      let number = next;
      next += 1;
      let candidate = buildName(prefixValue, number, width);
      let guard = 0;
      while (assigned.has(candidate.toLowerCase()) && guard < 100000) {
        number = next;
        next += 1;
        candidate = buildName(prefixValue, number, width);
        guard += 1;
      }
      if (guard >= 100000) {
        warnings.push(`Impossibile generare un nome univoco per ${target.name}.`);
      }
      assigned.add(candidate.toLowerCase());
      names.set(target.key, candidate);
    }
  };

  if (options.namingMode === 'prefix') {
    let prefix = (options.prefix || '').trim();
    if (!prefix) {
      prefix = detectCommonPrefix(targets) || 'P';
      warnings.push(`Prefisso non specificato: uso "${prefix}".`);
    }
    const sanitized = sanitizePrefix(prefix);
    if (sanitized !== prefix) {
      warnings.push(`Prefisso "${prefix}" non valido per RAPID: uso "${sanitized}".`);
      prefix = sanitized;
    }

    const widths = targets
      .map((target) => trailingDigits(target.name))
      .filter(Boolean)
      .map((digits) => digits.length);
    const baseWidth = widths.length > 0 ? Math.max(...widths) : 3;
    assignGroup(prefix, ordered, baseWidth);
  } else {
    const groups = new Map();
    const nonNumeric = [];

    for (const target of ordered) {
      const match = /^(.*?)(\d+)$/.exec(target.name);
      if (match && match[1]) {
        const groupKey = match[1].toLowerCase();
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { prefix: match[1], items: [], maxWidth: 0 });
        }
        const group = groups.get(groupKey);
        group.items.push(target);
        group.maxWidth = Math.max(group.maxWidth, match[2].length);
      } else {
        nonNumeric.push(target);
      }
    }

    if (groups.size === 0) {
      warnings.push('Nessun robtarget con suffisso numerico: nessuna rinomina automatica.');
      for (const target of targets) names.set(target.key, target.name);
    } else {
      if (groups.size > 1) {
        warnings.push('Rilevati più prefissi: ogni gruppo viene rinumerato separatamente.');
      }
      for (const group of groups.values()) {
        assignGroup(group.prefix, group.items, group.maxWidth);
      }
      if (nonNumeric.length > 0) {
        warnings.push(`Robtarget senza suffisso numerico lasciati invariati: ${nonNumeric.map((t) => t.name).join(', ')}.`);
        for (const target of nonNumeric) names.set(target.key, target.name);
      }
    }
  }

  for (const target of targets) {
    if (!names.has(target.key)) names.set(target.key, target.name);
  }

  return { names, warnings };
}

function applyRenaming(text, masked, names) {
  const replacements = [];

  for (const token of tokenizeIdentifiers(masked)) {
    if (!names.has(token.key)) continue;
    const newName = names.get(token.key);
    if (newName !== token.value) {
      replacements.push({ start: token.start, end: token.end, value: newName });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  let output = text;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
}

function getIndent(text, index) {
  const lineStart = Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1;
  return text.slice(lineStart, index).replace(/[^\t ]/g, '');
}

function reindentDeclaration(declaration, indent, eol) {
  const lines = declaration.split(/\r\n|\n|\r/);
  if (lines.length === 1) return declaration;
  return lines
    .map((line, index) => {
      if (index === 0) return line;
      if (line.trim() === '') return '';
      return indent + line.replace(/^[ \t]+/, '');
    })
    .join(eol);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function orderMap(orderKeys) {
  return new Map(orderKeys.map((key, index) => [key, index]));
}

function reorderDeclarations(text, targets, orderKeys, eol) {
  const index = orderMap(orderKeys);
  const byScope = groupBy(targets, (target) => target.scopeKey);
  const replacements = [];

  for (const slots of byScope.values()) {
    slots.sort((a, b) => a.start - b.start);
    const desired = slots.slice().sort((a, b) => {
      const ai = index.has(a.key) ? index.get(a.key) : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b.key) ? index.get(b.key) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.start - b.start;
    });

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const source = desired[i];
      const indent = getIndent(text, slot.start);
      replacements.push({
        start: slot.start,
        end: slot.end,
        value: reindentDeclaration(source.declaration, indent, eol)
      });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  let output = text;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return output;
}

function countMovedDeclarations(targets, orderKeys) {
  const index = orderMap(orderKeys);
  const byScope = groupBy(targets, (target) => target.scopeKey);
  let moved = 0;

  for (const slots of byScope.values()) {
    slots.sort((a, b) => a.start - b.start);
    const desired = slots.slice().sort((a, b) => {
      const ai = index.has(a.key) ? index.get(a.key) : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b.key) ? index.get(b.key) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.start - b.start;
    });
    for (let i = 0; i < slots.length; i += 1) {
      if (slots[i].key !== desired[i].key) moved += 1;
    }
  }

  return moved;
}

function publicMapping(targets) {
  return targets
    .slice()
    .sort((a, b) => {
      const ai = a.execIndex === null ? Number.MAX_SAFE_INTEGER : a.execIndex;
      const bi = b.execIndex === null ? Number.MAX_SAFE_INTEGER : b.execIndex;
      if (ai !== bi) return ai - bi;
      return a.start - b.start;
    })
    .map((target) => ({
      oldName: target.name,
      newName: target.newName,
      changed: target.changed,
      execIndex: target.execIndex,
      used: target.used,
      refCount: target.refCount,
      line: target.line,
      column: target.column,
      scope: target.scopeName || 'Modulo',
      type: target.type
    }));
}

function transform(text, options = {}) {
  const state = buildState(text);
  const { masked, targets, analysis, targetMap, aliasMap } = state;
  const warnings = analysis.warnings.slice();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const renameEnabled = options.rename !== false;
  const reorderEnabled = options.reorder !== false;
  const onlyUsed = options.onlyUsed === true;

  const renameTargets = renameEnabled
    ? (onlyUsed ? targets.filter((target) => target.used) : targets)
    : [];
  const renameKeySet = new Set(renameTargets.map((target) => target.key));

  const reserved = new Set();
  for (const token of tokenizeIdentifiers(masked)) {
    if (!renameKeySet.has(token.key)) reserved.add(token.key);
  }

  let names = new Map();
  if (renameEnabled) {
    if (renameTargets.length === 0) {
      warnings.push('Nessun robtarget utilizzato da rinominare.');
    } else {
      const plan = planNames(renameTargets, analysis.orderKeys, options, reserved);
      names = plan.names;
      warnings.push(...plan.warnings);
    }
  }

  for (const target of targets) {
    target.newName = names.has(target.key) ? names.get(target.key) : target.name;
    target.changed = target.newName !== target.name;
  }

  const unorderedProcedures = [];
  for (const procedure of analysis.procedures) {
    const keys = procedure.targetKeys || [];
    procedure.targets = keys.map((key) => {
      const target = targetMap.get(key);
      return target
        ? { oldName: target.name, newName: target.newName }
        : { oldName: key, newName: key };
    });
    procedure.ordered = keys.every((key, index) => {
      if (index === 0) return true;
      const previous = targetMap.get(keys[index - 1]);
      const current = targetMap.get(key);
      if (!previous || !current) return false;
      const previousNumber = trailingDigits(previous.newName);
      const currentNumber = trailingDigits(current.newName);
      if (previousNumber === null || currentNumber === null) return false;
      return Number(previousNumber) <= Number(currentNumber);
    });
    if (!procedure.ordered) unorderedProcedures.push(procedure.name);
  }
  if (unorderedProcedures.length > 0) {
    warnings.push(
      `La numerazione non risulta crescente in: ${unorderedProcedures.join(', ')}. Controlla la scheda Procedure.`
    );
  }

  const reorderTargets = onlyUsed ? targets.filter((target) => target.used) : targets;

  let output = text;
  if (reorderEnabled) {
    output = reorderDeclarations(output, reorderTargets, analysis.orderKeys, eol);
  }
  if (renameEnabled) {
    const renaming = new Map(names);
    for (const [aliasKey, targetKey] of aliasMap.entries()) {
      if (!renameKeySet.has(targetKey)) continue;
      const target = targetMap.get(targetKey);
      if (!target) continue;
      renaming.set(aliasKey, target.newName);
    }
    output = applyRenaming(output, maskText(output), renaming);
  }

  const renamed = targets.filter((target) => target.changed).length;
  const reordered = reorderEnabled ? countMovedDeclarations(reorderTargets, analysis.orderKeys) : 0;

  analysis.warnings = warnings;
  const prefixSource = renameEnabled ? renameTargets : targets;
  analysis.suggestedPrefix = detectCommonPrefix(prefixSource);
  analysis.prefixes = detectPrefixes(prefixSource);

  return {
    output,
    analysis,
    mapping: publicMapping(targets),
    stats: {
      targets: targets.length,
      procedures: analysis.procedures.length,
      renamed,
      reordered,
      unused: targets.filter((target) => !target.used).length
    },
    warnings
  };
}

module.exports = {
  analyze,
  transform,
  maskText,
  tokenizeIdentifiers,
  findProcedures,
  findTargets
};
