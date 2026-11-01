// Trusted process fixture: never loaded from a research source or config.
import {openMemory} from '../../memory/store.mjs';
import {createHarness} from '../../harness/engine.mjs';
const [mode, dataDir, index = '0'] = process.argv.slice(2);
const memory = openMemory({dataDir, scope: 'public', write: true, timeout: 1000});
if (mode === 'hold' || mode === 'crash') {
  memory.db.exec('BEGIN IMMEDIATE');
  memory.db.prepare('INSERT INTO metadata VALUES (?,?)').run('uncommitted-test-marker', 'must roll back');
  if (mode === 'crash') process.exit(79);
  console.log('LOCKED');
  setTimeout(() => { memory.db.exec('ROLLBACK'); memory.close(); }, 10000);
} else {
  try {
    const harness = createHarness({}, {clock: () => Date.parse('2026-10-31T00:00:00Z'),
      fixture: {version: 1, items: [{id: `parallel-${index}`, content: `Параллельная запись ${index}`}]}});
    memory.storeRun(await harness.discover('fixture'), {key: `parallel-${index}`});
    console.log('COMMITTED');
  } finally { memory.close(); }
}
