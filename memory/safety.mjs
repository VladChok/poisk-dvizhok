import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';

export class MemoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const fail = code => { throw new MemoryError(code); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export const MAX_FILE = 4 * 1024 * 1024;
export const MAX_INPUT = 32 * 1024 * 1024;
export function clean(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : JSON.stringify(value);
  const secrets = Object.entries(process.env).filter(([key, v]) => /TOKEN|SECRET|PASSWORD|API_KEY/.test(key) && v?.length >= 8).map(([, v]) => v);
  if (secrets.some(secret => text.includes(secret)) ||
      /(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{8,}|https?:\/\/[^\s/"<>]+@|[?&](?:token|key|api_key|access_token)=)/i.test(text)) fail('SECRET_REJECTED');
  if (typeof value === 'object' && value && !Buffer.isBuffer(value)) {
    const walk = obj => {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, v] of Object.entries(obj)) {
        if (/^(authorization|cookie|set-cookie|password|token|api_key|secret|headers)$/i.test(key)) fail('SECRET_FIELD_REJECTED');
        walk(v);
      }
    };
    walk(value);
  }
  return value;
}
export function safePath(input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('INVALID_PATH');
  const absolute = path.resolve(input), root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('SYMLINK_REJECTED');
    // lstat catches dangling links which existsSync deliberately does not follow.
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('SYMLINK_REJECTED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
export function relativeFile(name) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || /[\\<>:"|?*\x00-\x1f]/.test(name) ||
      name.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p))) fail('UNSAFE_ARTIFACT_PATH');
  return name;
}
export function readFile(file, maximum = MAX_FILE) {
  const full = safePath(file), stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.size > maximum) fail('INPUT_LIMIT');
  return clean(fs.readFileSync(full));
}
export function jsonFile(file, maximum) {
  try { return clean(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(readFile(file, maximum)).replace(/^\uFEFF/, ''))); }
  catch (error) { if (error instanceof MemoryError) throw error; fail('INVALID_JSON'); }
}
export function dataPath(dataDir, scope = 'private') {
  if (!['public', 'private'].includes(scope)) fail('INVALID_SCOPE');
  const root = dataDir || (process.platform === 'win32' ?
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'poisk-dvizhok') :
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'poisk-dvizhok'));
  return safePath(path.join(root, scope, 'memory.sqlite'));
}
export function syncFile(file) {
  const fd = fs.openSync(file, fs.statSync(file).isDirectory() ? 'r' : 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function publishFile(staged, destination) {
  syncFile(staged);
  // link is no-clobber on Windows and Linux. Both paths must be on one filesystem.
  fs.linkSync(staged, destination); fs.unlinkSync(staged);
  try { syncFile(path.dirname(destination)); } catch { /* directory fsync unavailable on Windows */ }
}
export const temporary = file => `${file}.${randomUUID()}.tmp`;
export function code(error) {
  if (error instanceof MemoryError) return error.code;
  if (error?.code?.startsWith('SQLITE_BUSY') || error?.code === 'SQLITE_LOCKED') return 'BUSY';
  if (['SQLITE_CORRUPT', 'SQLITE_NOTADB'].includes(error?.code)) return 'CORRUPT';
  if (error?.code === 'SQLITE_FULL') return 'QUOTA';
  if (error?.code?.startsWith('SQLITE_CONSTRAINT')) return 'CONSTRAINT';
  if (error?.code === 'ENOENT') return 'NOT_FOUND';
  if (error?.code === 'EEXIST') return 'TARGET_EXISTS';
  return 'STORAGE_ERROR';
}
