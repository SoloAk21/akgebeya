import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import { retryTransaction, isLockFailure } from '../src/auth/transaction-retry.js';

test('transaction retries are bounded and only retry explicitly permitted failures', async () => {
  const lock = new Prisma.PrismaClientKnownRequestError('Lock timeout', {
    code: 'P2010', clientVersion: 'test', meta: { code: '55P03' },
  });
  let attempts = 0;
  assert.equal(await retryTransaction(async () => { attempts++; if (attempts < 3) throw lock; return 'ok'; }, isLockFailure), 'ok');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryTransaction(async () => { attempts++; throw lock; }, isLockFailure), error => error === lock);
  assert.equal(attempts, 4);
  attempts = 0;
  await assert.rejects(retryTransaction(async () => { attempts++; throw new Error('Business failure'); }, isLockFailure));
  assert.equal(attempts, 1);
  let processingStarted = false;
  attempts = 0;
  await assert.rejects(retryTransaction(async () => { attempts++; processingStarted = true; throw lock; },
    error => !processingStarted && isLockFailure(error)), error => error === lock);
  assert.equal(attempts, 1, 'Never repeat an OTP delivery or verification after processing starts');
});
