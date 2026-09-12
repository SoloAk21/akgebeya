import type { Request,Response,RequestHandler } from 'express';
import { z } from 'zod';
import { authenticatedContext } from '../auth/middleware.js';
import { HttpError } from '../errors.js';
import { draftInput,pagination } from './input.js';
import type { ListingService } from './service.js';
const empty=z.object({}).strict(),idParams=z.object({listingId:z.string().uuid()}).strict();
function validate(req:Request,body:z.ZodType,params:z.ZodType=empty,query:z.ZodType=empty,json=false){
 const hasBody=req.body!==undefined||req.headers['transfer-encoding']!==undefined||Number(req.headers['content-length']??0)>0;
 if(((json||hasBody)&&!req.is('application/json'))||!z.object({body,params,query}).safeParse({body:req.body,params:req.params,query:req.query}).success)throw new HttpError('BAD_REQUEST');
}
function match(req:Request){
 let count=0;for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i]?.toLowerCase()==='if-match')count++;
 if(count>1)throw new HttpError('BAD_REQUEST');
 const value=req.headers['if-match'];return typeof value==='string'?value:undefined;
}
function reply(res:Response,listing:Awaited<ReturnType<ListingService['get']>>,status=200){res.set('ETag',listing.etag).status(status).json({listing});}
export function listingController(service:ListingService){
 const create:RequestHandler=async(req,res)=>{validate(req,draftInput,empty,empty,true);reply(res,await service.create(authenticatedContext(req),req.body),201);};
 const mine:RequestHandler=async(req,res)=>{validate(req,empty.optional(),empty,pagination);res.json(await service.mine(authenticatedContext(req),req.query));};
 const get:RequestHandler=async(req,res)=>{validate(req,empty.optional(),idParams);reply(res,await service.get(authenticatedContext(req),String(req.params.listingId)));};
 const update:RequestHandler=async(req,res)=>{validate(req,draftInput,idParams,empty,true);reply(res,await service.update(authenticatedContext(req),String(req.params.listingId),req.body,match(req)));};
 const remove:RequestHandler=async(req,res)=>{validate(req,empty.optional(),idParams);await service.update(authenticatedContext(req),String(req.params.listingId),{},match(req),true);res.json({status:'ok'});};
 const transition=(target:'COMPLETE'|'VALIDATE'):RequestHandler=>async(req,res)=>{
  validate(req,empty,idParams,empty,true);
  reply(res,await service.transition(authenticatedContext(req),String(req.params.listingId),target,match(req)));
 };
 const aiAssist:RequestHandler=async(req,res)=>{
  validate(req,empty.optional(),idParams);
  reply(res,await service.aiAssist(authenticatedContext(req),String(req.params.listingId),match(req)));
 };
 return {create,mine,get,update,remove,aiAssist,complete:transition('COMPLETE'),validate:transition('VALIDATE')};
}
