import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDatabase, getDatabase, disconnectDatabase, inspectPostgis } from '../../apps/api/src/database.ts';
import { PROBE_ID, PROBE_MESSAGE, readProbe, saveProbe } from '../../apps/api/src/probe.ts';

test('real PostgreSQL/PostGIS persistence, idempotency, constraints and rollback', async () => {
  try {
    await checkDatabase();
    const database = getDatabase();
    const initial = await saveProbe(database);
    const copies = await Promise.all(Array.from({ length: 5 }, () => saveProbe(database)));
    assert.ok(copies.every(record => record.id === initial.id && record.createdAt.getTime() === initial.createdAt.getTime()));
    assert.equal(await database.foundationProbe.count(), 1);
    // A new client/connection must read the committed record.
    await disconnectDatabase();
    const fresh = getDatabase();
    const record = await readProbe(fresh);
    assert.equal(record.id, PROBE_ID);
    assert.equal(record.message, PROBE_MESSAGE);
    assert.equal(record.createdAt.getTime(), initial.createdAt.getTime());

    const geometry = await inspectPostgis(fresh);
    assert.equal(geometry.srid, 4326);
    assert.equal(geometry.longitude, 38.7578);

    // All attempted mutations below roll back, even if a missing constraint makes them succeed.
    async function rejectsConstraint(operation, expectedSqlState) {
      const rollback = new Error('Constraint unexpectedly accepted input');
      let rejected = false;
      try {
        await fresh.$transaction(async tx => { await operation(tx); throw rollback; });
      } catch (error) {
        if (error === rollback) throw error;
        assert.equal(error.code, 'P2010');
        const sqlState = error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode;
        assert.equal(sqlState, expectedSqlState);
        rejected = true;
      }
      assert.equal(rejected, true);
    }
    await rejectsConstraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.foundation_probe (id, message) VALUES ('foundation', 'duplicate')`, '23505');
    await rejectsConstraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.foundation_probe (id, message) VALUES ('other', 'invalid singleton')`, '23514');
    await rejectsConstraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.foundation_probe SET message = ' ' WHERE id = 'foundation'`, '23514');
    await rejectsConstraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.foundation_probe SET message = ${'x'.repeat(121)} WHERE id = 'foundation'`, '22001');

    const rollback = new Error('Intentional rollback');
    await assert.rejects(fresh.$transaction(async tx => {
      const boundary = await tx.foundationProbe.update({ where: { id: PROBE_ID }, data: { message: 'x'.repeat(120) } });
      assert.equal(boundary.message.length, 120);
      throw rollback;
    }), error => error === rollback);
    assert.equal((await readProbe(fresh)).message, PROBE_MESSAGE);
    assert.equal(await fresh.foundationProbe.count(), 1);
  } finally { await disconnectDatabase(); }
});
