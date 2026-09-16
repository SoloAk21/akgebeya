import { checkDatabase, disconnectDatabase, getDatabase } from './database.js';
import { readProbe, saveProbe } from './probe.js';

async function main() {
  const command = process.argv[2];
  if (command !== 'write' && command !== 'read') {
    console.error('Usage: npm run db:probe:write OR npm run db:probe:read');
    process.exitCode = 1;
    return;
  }
  try {
    await checkDatabase();
    const database = getDatabase();
    const record = command === 'write' ? await saveProbe(database) : await readProbe(database);
    if (!record) {
      console.error('Controlled record not found. Run npm run db:probe:write first.');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ status: 'ok', record }, null, 2));
  } catch {
    // Driver errors can include credentials, SQL or server details. Do not print them.
    console.error('Database check failed. Check the development connection, PostGIS, and migrations.');
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
