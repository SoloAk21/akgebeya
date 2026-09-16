import { getDatabase, disconnectDatabase } from '../apps/api/src/database.js';
import { UUID } from '../apps/api/src/admin.js';

const [action, accountId, ...extra] = process.argv.slice(2);
try {
  if (!['grant', 'revoke'].includes(action ?? '') || !accountId || !UUID.test(accountId) || extra.length) {
    throw new Error('Usage: npm run admin:access -- grant|revoke ACCOUNT_UUID');
  }
  const account = await getDatabase().account.update({ where: { id: accountId }, data: { isAdmin: action === 'grant' },
    select: { id: true, email: true, isAdmin: true } });
  console.log(JSON.stringify(account));
} catch {
  console.error('Admin access change could not be confirmed. Check the database; use grant|revoke and the UUID of an existing, trusted account.');
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
