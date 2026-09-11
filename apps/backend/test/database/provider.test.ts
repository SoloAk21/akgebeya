import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withProviderDatabaseFixture } from '../provider-database-fixture.js';
import { HttpError } from '../../src/errors.js';
import { Prisma } from '../../src/generated/prisma/client.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
async function rejectSql(run:()=>Promise<unknown>) {
  let rejected=false;
  try { await run(); } catch(e) { rejected=e instanceof Prisma.PrismaClientKnownRequestError || (e instanceof Prisma.PrismaClientUnknownRequestError && /23514|23503/.test(e.message)); }
  assert.ok(rejected,'Expected database constraint rejection');
}

test('Neon provider role, ownership triggers, review constraints, pending uniqueness and legacy data safety',async()=>{
  await withProviderDatabaseFixture(async({db,service,actors})=>{
    const expiresAt=new Date(Date.now()+60_000);
    await rejectSql(()=>db.verification.create({data:{userId:actors.owner.id,type:'PROVIDER',expiresAt}}));
    const provider=await service.create(actors.owner.context,{role:'AGENCY',nameEn:'Agency'});
    const stored=await db.provider.findUniqueOrThrow({where:{id:provider.id}});
    assert.equal(stored.userId,actors.owner.id); assert.equal(stored.role,'AGENCY');
    const v=await service.submit(actors.owner.context);
    await rejectSql(()=>db.verification.create({data:{userId:actors.owner.id,type:'PROVIDER',expiresAt}}));
    await rejectSql(()=>db.provider.delete({where:{id:provider.id}}));
    await rejectSql(()=>db.verification.update({where:{id:v.id!},data:{target:'contact'}}));
    await rejectSql(()=>db.verification.update({where:{id:v.id!},data:{status:'APPROVED',reviewerId:actors.owner.id,reviewedAt:new Date()}}));
    await rejectSql(()=>db.verification.update({where:{id:v.id!},data:{status:'APPROVED'}}));
    const legacy=await db.provider.create({data:{userId:actors.spare.id,nameEn:'Legacy'}});
    assert.equal(legacy.role,null);
    await assert.rejects(()=>service.submit(actors.spare.context),denied('FORBIDDEN'));
    await assert.rejects(()=>service.requireVerified(actors.spare.context,['OWNER']),denied('FORBIDDEN'));
    const row=await db.verification.findUniqueOrThrow({where:{id:v.id!}});
    assert.equal(row.target,null); assert.equal(row.tokenHash,null); assert.equal(row.reviewerId,null);
    await service.decide(actors.admin.context,provider.id,{verificationId:v.id},false);
    const next=await service.submit(actors.owner.context);
    assert.equal(next.state,'PENDING'); assert.notEqual(next.id,v.id);
    const chronological=await db.$queryRaw<{ordered:boolean}[]>`SELECT newer."createdAt" > older."createdAt" AS ordered
      FROM akgebeya.verifications newer, akgebeya.verifications older WHERE newer.id=${next.id}::uuid AND older.id=${v.id}::uuid`;
    assert.equal(chronological[0]?.ordered,true);

  });
});
test('Neon concurrent provider creation, submissions and decisions serialize safely and preserve authorization',async()=>{
  await withProviderDatabaseFixture(async({db,service,actors})=>{
    const creates=await Promise.allSettled(Array.from({length:3},()=>service.create(actors.owner.context,{role:'OWNER',nameEn:'Owner'})));
    assert.equal(creates.filter(r=>r.status==='fulfilled').length,1);
    assert.ok(creates.filter(r=>r.status==='rejected').every(r=>denied('PROVIDER_CONFLICT')(r.reason)));
    const p=await service.me(actors.owner.context);
    const submissions=await Promise.allSettled([service.submit(actors.owner.context),service.submit(actors.owner.context)]);
    assert.equal(submissions.filter(r=>r.status==='fulfilled').length,1);
    assert.ok(submissions.filter(r=>r.status==='rejected').every(r=>denied('PROVIDER_CONFLICT')(r.reason)));
    const v=(await service.me(actors.owner.context)).verification;
    const results=await Promise.allSettled([service.decide(actors.admin.context,p.id,{verificationId:v.id},true),service.decide(actors.admin.context,p.id,{verificationId:v.id},false)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>denied('PROVIDER_CONFLICT')(r.reason)));
    const decision=await db.verification.findUniqueOrThrow({where:{id:v.id!}});
    assert.equal(decision.reviewerId,actors.admin.id); assert.ok(decision.reviewedAt);
    assert.ok(['APPROVED','REJECTED'].includes(decision.status));
    await assert.rejects(()=>service.requireVerified(actors.other.context,['OWNER'],p.id),denied('FORBIDDEN'));
    await assert.rejects(()=>service.decide(actors.owner.context,p.id,{verificationId:v.id},true),denied('FORBIDDEN'));
    if(decision.status==='REJECTED'){
      assert.equal((await service.me(actors.owner.context)).verification.state,'REJECTED');
      const next=await service.submit(actors.owner.context);
      await service.decide(actors.admin.context,p.id,{verificationId:next.id},true);
    }
    assert.equal(await service.requireVerified(actors.owner.context,['OWNER']),p.id);
    await db.provider.update({where:{id:p.id},data:{status:'SUSPENDED'}});
    await assert.rejects(()=>service.requireVerified(actors.owner.context,['OWNER']),denied('FORBIDDEN'));
    assert.equal((await service.me(actors.owner.context)).verification.verified,false);
    assert.equal(await db.provider.count({where:{userId:actors.owner.id}}),1);
    assert.equal(await db.verification.count({where:{userId:actors.owner.id,type:'PROVIDER',status:'PENDING'}}),0);
    const sessions=await db.session.findMany({where:{userId:actors.owner.id}});
    assert.ok(sessions.every(s=>/^[a-f0-9]{64}$/.test(s.tokenHash)&&s.tokenHash!==actors.owner.token));
    await assert.rejects(()=>service.decide(actors.admin.context,p.id,{verificationId:randomUUID()},true),denied('PROVIDER_CONFLICT'));
  });
});
