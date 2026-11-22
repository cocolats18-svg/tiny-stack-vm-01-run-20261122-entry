// Tiny stack VM — faithful interpreter of make.fun's tiny stack ISA v1
// (ISA.md + reference vm.mjs in the competition kit). Node 22, stdlib only.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256, CALLS_MAX = 64, MEM_WORDS = 256;
const STEP_LIMIT = 1_000_000, OUTPUT_MAX = 65_536;

// pops/pushes/imm-bytes per opcode, mirroring the ISA table.
function info(op: number): [number, number, number] | null {
  switch (op) {
    case 0x00: return [0, 0, 0];
    case 0x01: return [1, 0, 1];
    case 0x02: return [4, 0, 1];
    case 0x03: return [0, 1, 0];
    case 0x04: return [0, 1, 2];
    case 0x05: return [0, 2, 2];
    case 0x06: return [0, 2, 3];
    case 0x07: return [0, 3, 3];
    case 0x17: case 0x1b: return [0, 1, 1];
    case 0x30: return [2, 0, 0];
    case 0x31: case 0x32: return [2, 1, 0];
    case 0x33: return [2, 0, 0];
    case 0x34: return [0, 0, 0];
    case 0x40: return [0, 1, 1];
    case 0x41: return [0, 2, 0];
    case 0x50: case 0x51: case 0x53: return [0, 1, 0];
    case 0x52: return [0, 0, 1];
    default:
      // Only the binary opcodes listed in the ISA table — 0x1f names no
      // opcode, so it must trap 5 (a bare range check would swallow it).
      if (op === 0x10 || op === 0x11 || op === 0x12 || op === 0x13 || op === 0x14 ||
          op === 0x15 || op === 0x16 || op === 0x18 || op === 0x19 || op === 0x1a ||
          op === 0x1c || op === 0x1d || op === 0x1e || op === 0x20 || op === 0x21 || op === 0x22) return [0, 2, 1];
      return null;
  }
}

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const n = p.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let cp = 0;
  const M = new Int32Array(MEM_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let ol = 0;
  let ip = 0, pc = 0, steps = 0;
  const done = (code: number) => ({ out: out.slice(0, ol), code });
  for (;;) {
    if (steps === STEP_LIMIT) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const meta = info(p[pc]);
    if (meta === null) return done(5);
    const [imm, pops, pushes] = meta;
    if (pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return done(2);
    if (sp - pops + pushes > STACK_MAX) return done(3);
    const op = p[pc];
    pc = next;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return done(4); r = b === -1 ? 0 : (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = ((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; D[sp++] = r; break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (cp === CALLS_MAX) return done(7);
        C[cp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= MEM_WORDS) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr >= MEM_WORDS) return done(6);
        sp -= 2; M[addr] = v;
        break;
      }
      case 0x50: {
        // PRINT writes the decimal ASCII of v, no allocation: digits are ASCII.
        const s = String(D[sp - 1]);
        if (ol + s.length > OUTPUT_MAX) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > OUTPUT_MAX) return done(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
