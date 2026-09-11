import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createDatabaseClient } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { PrismaAuthRepository } from '../src/auth/repository.js';
import { ProviderService } from '../src/providers/service.js';
import { PrismaProviderRepository } from '../src/providers/repository.js';
import { parseAuthConfig, parseProviderConfig, type AuthConfig } from '../src/config.js';

export async function withProviderDatabaseFixture(
  run: (fixture: Awaited<ReturnType<typeof prepare>>) => Promise<void>,
  config: AuthConfig = parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url'), AUTH_SESSION_TTL_SECONDS: '3600' }),
) {
  const db=createDatabaseClient(); const ids: string[]=[];
  try {
    const fixture=await prepare(db,ids,config);
    await run(fixture);
    assert.ok((await db.user.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}})).every(user =>
      fixture.identities.get(user.id)===digest(user)), 'Existing authentication identities changed');
  } finally {
    try {
      await db.verification.deleteMany({where:{userId:{in:ids}}});
      await db.provider.deleteMany({where:{userId:{in:ids}}});
      await db.user.deleteMany({where:{id:{in:ids}}});
      assert.equal(await db.user.count({where:{id:{in:ids}}}),0);
      assert.equal(await db.verification.count({where:{userId:{in:ids}}}),0);
      assert.equal(await db.session.count({where:{userId:{in:ids}}}),0);
    } finally { await db.$disconnect(); }
  }
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_k,v:unknown)=>typeof v==='bigint'?v.toString():v)).digest('hex');
async function prepare(db:ReturnType<typeof createDatabaseClient>,ids:string[],config:AuthConfig) {
  const auth=new AuthService(new PrismaAuthRepository(db),config);
  const service=new ProviderService(new PrismaProviderRepository(db),parseProviderConfig({}));
  const actors={} as Record<'owner'|'other'|'admin'|'spare',{id:string;token:string;context:Awaited<ReturnType<AuthService['authenticate']>>}>;
  const identities=new Map<string,string>();
  for(const name of ['owner','other','admin','spare'] as const) {
    const user=await db.user.create({data:{email:randomUUID()+'@example.com',displayName:'Provider verification fixture',
      role:name==='admin'?'ADMIN':'USER', ...(name==='owner'?{phone:'+2519'+randomBytes(4).readUInt32BE().toString().padStart(8,'0').slice(-8),googleSub:randomUUID(),telegramId:BigInt('8'+String(Date.now()))}:{})}});
    ids.push(user.id); identities.set(user.id,digest(user));
    const session=await auth.createSessionForVerifiedUser(user.id);
    actors[name]={id:user.id,token:session.token,context:await auth.authenticate(session.token)};
  }
  return {db,auth,service,actors,identities};
}
