/* unified diff generator (no git) — Myers O(ND) greedy diff with trace */
const fs = require('fs');
const norm = f => fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n').split('\n');
const A = norm(process.argv[2]);
const B = norm(process.argv[3]);

function myers(a, b) {
  const N = a.length, M = b.length, MAX = N + M;
  const v = new Int32Array(2 * MAX + 2);
  const trace = [];
  const offset = MAX;
  let found = -1;
  for (let d = 0; d <= MAX; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) x = v[k + 1 + offset];
      else x = v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[k + offset] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // backtrack
  const ops = [];
  let x = N, y = M;
  for (let d = found; d > 0; d--) {
    const vprev = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && vprev[k - 1 + offset] < vprev[k + 1 + offset])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vprev[prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push([' ', x]); }
    if (x === prevX) { y--; ops.push(['+', y]); }
    else { x--; ops.push(['-', x]); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push([' ', x]); }
  ops.reverse();
  return ops;
}

const ops = myers(A, B);
if (!ops) { console.error('diff failed'); process.exit(1); }

const out = [];
out.push('--- ' + (process.argv[2] || '').split(/[\\/]/).pop() + '\n');
out.push('+++ ' + (process.argv[3] || '').split(/[\\/]/).pop() + '\n');

const CTX = 3;
let i = 0;
while (i < ops.length) {
  if (ops[i][0] === ' ') { i++; continue; }
  let s = i, e = i;
  while (e < ops.length) {
    if (ops[e][0] !== ' ') { e++; continue; }
    let f = e, cnt = 0;
    while (f < ops.length && ops[f][0] === ' ' && cnt < CTX * 2) { f++; cnt++; }
    if (cnt >= CTX * 2) break;
    e = f;
  }
  s = Math.max(0, s - CTX);
  e = Math.min(ops.length, e + CTX);
  let aStart = 0, bStart = 0, aCount = 0, bCount = 0, first = true;
  for (let t = s; t < e; t++) {
    const op = ops[t][0];
    if (op === ' ') { if (first) { aStart = ops[t][1]; bStart = ops[t][1]; first = false; } aCount++; bCount++; }
    else if (op === '-') { if (first) { aStart = ops[t][1]; bStart = 0; first = false; } aCount++; }
    else { if (first) { aStart = 0; bStart = ops[t][1]; first = false; } bCount++; }
  }
  out.push('@@ -' + (aStart + 1) + ',' + aCount + ' +' + (bStart + 1) + ',' + bCount + ' @@\n');
  for (let t = s; t < e; t++) {
    const op = ops[t][0];
    const line = op === '+' ? B[ops[t][1]] : A[ops[t][1]];
    out.push(op + line + '\n');
  }
  i = e;
}
fs.writeFileSync(process.argv[4] || 'diff.patch', out.join(''), 'utf8');
const adds = out.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
const dels = out.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
console.log(`diff written: +${adds} / -${dels} lines  (${out.filter(l => l.startsWith('@@')).length} hunks)`);
