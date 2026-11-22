import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {z} from 'zod';
import {db} from './db.js';
import {auth} from './auth.js';
import type {Request,Response,NextFunction} from 'express';

const app=express();app.disable('x-powered-by');app.use(helmet());
const origin=process.env.FRONTEND_ORIGIN||'http://localhost:5173';
app.use(cors({origin:origin.split(',').map(s=>s.trim())}));app.use(express.json({limit:'100kb'}));
app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json({user:req.actor}));
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>Promise.resolve(fn(req,res)).catch(next);
const startSchema=z.object({mode:z.enum(['FULL','DAILY','REVISION'])});
const answerSchema=z.object({questionId:z.string().min(1),selectedIndex:z.number().int().min(0).max(4).nullable()});
const snapshotOf=(q:{id:string;text:string;options:unknown;correctIndex:number;explanation:string;skill:string;reviewState:string;legacyReviewStatus:string|null})=>({questionId:q.id,text:q.text,options:Array.isArray(q.options)?q.options.map(String):[],correctIndex:q.correctIndex,explanation:q.explanation,skill:q.skill,reviewState:q.reviewState,legacyReviewStatus:q.legacyReviewStatus});
type Snap=ReturnType<typeof snapshotOf>;
function publicItem(item:{id:string;questionId:string;ordinal:number;selectedIndex:number|null;snapshot:unknown}){
 const {correctIndex,explanation,questionId=item.questionId,...safe}=item.snapshot as Snap;
 return {id:item.id,questionId,ordinal:item.ordinal,selectedIndex:item.selectedIndex,...safe};
}
function toAttempt(a:{id:string;mode:string;status:string;startedAt:Date;deadlineAt:Date;submittedAt:Date|null;score:number|null;answered:number|null;total:number;items:any[]},review=false){
 return {id:a.id,mode:a.mode,status:a.status,startedAt:a.startedAt,deadlineAt:a.deadlineAt,submittedAt:a.submittedAt,score:a.score,answered:a.answered,total:a.total,items:a.items.map(i=>review?{...publicItem(i),correctIndex:(i.snapshot as Snap).correctIndex,explanation:(i.snapshot as Snap).explanation,isCorrect:i.isCorrect}:publicItem(i))};
}
async function ownedAttempt(id:string,userId:string){return db.attempt.findFirst({where:{id,userId},include:{items:{orderBy:{ordinal:'asc'}}}})}
const ttl={FULL:40,DAILY:18,REVISION:25} as const;
app.get('/api/tests',(_req,res)=>res.json({tests:[{subject:'math',mode:'FULL',count:35,minutes:40},{subject:'math',mode:'DAILY',count:12,minutes:18},{subject:'math',mode:'REVISION',count:15,minutes:25}]}));
app.post('/api/attempts',asyncRoute(async(req,res)=>{
 const parsed=startSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid mode'});
 const mode=parsed.data.mode;const now=new Date();
 const active=await db.attempt.findFirst({where:{userId:req.actor!.id,mode,subject:'math',status:'IN_PROGRESS',deadlineAt:{gt:now}},include:{items:{orderBy:{ordinal:'asc'}}},orderBy:{startedAt:'desc'}});
 if(active)return res.status(200).json(toAttempt(active));
 const target=mode==='FULL'?35:mode==='DAILY'?12:15;
 const where={subject:'math',...(mode==='REVISION'?{legacyId:{startsWith:'math:REV-MATH-'}}:mode==='FULL'?{legacyId:{startsWith:'math:MFULL26-'}}:{})};
 const candidates=await db.question.findMany({where});
 if(candidates.length<target)return res.status(503).json({error:'Question bank incomplete. Run the seed script.'});
 // A new attempt gets immutable question snapshots; paper and order survive refresh.
 const chosen=mode==='DAILY'?candidates.sort(()=>Math.random()-0.5).slice(0,target):candidates.sort((a,b)=>a.legacyId.localeCompare(b.legacyId)).slice(0,target);
 const attempt=await db.attempt.create({data:{userId:req.actor!.id,subject:'math',mode,total:target,deadlineAt:new Date(now.getTime()+ttl[mode]*60000),items:{create:chosen.map((q,ordinal)=>({questionId:q.id,ordinal,snapshot:snapshotOf(q)}))}},include:{items:{orderBy:{ordinal:'asc'}}}});
 return res.status(201).json(toAttempt(attempt));
}));
app.get('/api/attempts/:id',asyncRoute(async(req,res)=>{
 const a=await ownedAttempt(req.params.id,req.actor!.id);if(!a)return res.status(404).json({error:'Attempt not found'});
 if(a.status==='IN_PROGRESS'&&a.deadlineAt<=new Date())return res.json(toAttempt(await finalize(a.id,req.actor!.id,'EXPIRED'),true));
 res.json(toAttempt(a,a.status!=='IN_PROGRESS'));
}));
app.patch('/api/attempts/:id/answers',asyncRoute(async(req,res)=>{
 const parsed=answerSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid answer'});
 const a=await ownedAttempt(req.params.id,req.actor!.id);if(!a)return res.status(404).json({error:'Attempt not found'});
 if(a.status!=='IN_PROGRESS'||a.deadlineAt<=new Date())return res.status(409).json({error:'Attempt ended. Refresh to review.'});
 const item=a.items.find(i=>i.questionId===parsed.data.questionId);if(!item)return res.status(400).json({error:'Question not in attempt'});
 await db.attemptItem.update({where:{id:item.id},data:{selectedIndex:parsed.data.selectedIndex,answeredAt:parsed.data.selectedIndex===null?null:new Date()}});
 res.json({ok:true,questionId:item.questionId,selectedIndex:parsed.data.selectedIndex});
}));
async function finalize(id:string,userId:string,status:'SUBMITTED'|'EXPIRED'){
 return db.$transaction(async tx=>{
  const a=await tx.attempt.findFirst({where:{id,userId},include:{items:{orderBy:{ordinal:'asc'}}}});
  if(!a)throw Object.assign(new Error('Attempt not found'),{httpStatus:404});
  if(a.status!=='IN_PROGRESS')return a;
  const score=a.items.filter(i=>i.selectedIndex!==null&&i.selectedIndex===(i.snapshot as Snap).correctIndex).length;
  const answered=a.items.filter(i=>i.selectedIndex!==null).length;
  for(const item of a.items)await tx.attemptItem.update({where:{id:item.id},data:{isCorrect:item.selectedIndex!==null&&item.selectedIndex===(item.snapshot as Snap).correctIndex}});
  return tx.attempt.update({where:{id},data:{status,submittedAt:new Date(),score,answered},include:{items:{orderBy:{ordinal:'asc'}}}});
 });
}
app.post('/api/attempts/:id/submit',asyncRoute(async(req,res)=>{
 const a=await ownedAttempt(req.params.id,req.actor!.id);if(!a)return res.status(404).json({error:'Attempt not found'});
 const status=a.deadlineAt<=new Date()?'EXPIRED':'SUBMITTED';
 res.json(toAttempt(await finalize(a.id,req.actor!.id,status),true));
}));
app.get('/api/me/results',asyncRoute(async(req,res)=>{
 const attempts=await db.attempt.findMany({where:{userId:req.actor!.id,status:{in:['SUBMITTED','EXPIRED']}},orderBy:{submittedAt:'desc'},take:100,select:{id:true,mode:true,status:true,score:true,answered:true,total:true,startedAt:true,submittedAt:true,deadlineAt:true}});
 res.json({results:attempts});
}));
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
 console.error(err);const code=typeof err==='object'&&err!==null&&'httpStatus'in err?Number((err as any).httpStatus):500;
 res.status(code).json({error:code===500?'Server error':String((err as Error).message)});
});
const port=Number(process.env.PORT||4000);
app.listen(port,'0.0.0.0',()=>console.log(`EduPath API on ${port}; development auth=${process.env.DEV_AUTH_ENABLED==='true'}`));
