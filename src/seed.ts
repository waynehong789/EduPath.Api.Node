import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();

type Raw={id:string|number;text:string;options:string[];answer:number;skill?:string;explanation?:string;reviewStatus?:string};
function read(name:string):Raw[]{return JSON.parse(readFileSync(resolve(process.cwd(),'data',name),'utf8')) as Raw[]}
const all=[...read('math.json'),...read('math-revision-01.json')];
async function main(){
 let created=0,unchanged=0,updated=0;
 for(const raw of all){
  if(!raw.text||!Array.isArray(raw.options)||raw.options.length!==5||!Number.isInteger(raw.answer)||raw.answer<0||raw.answer>=5)throw Error(`Invalid original question ${raw.id}`);
  const legacyId=`math:${String(raw.id)}`;
  const content={text:raw.text,options:raw.options,correctIndex:raw.answer,explanation:raw.explanation||'',skill:raw.skill||'mathematical_reasoning'};
  const contentHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const prev=await db.question.findUnique({where:{legacyId}});
  if(prev?.contentHash===contentHash){unchanged++;continue}
  if(prev){
   // Never silently replace a snapshot of a bank item; old attempts store snapshots.
   await db.question.update({where:{legacyId},data:{...content,contentHash,revision:{increment:1},reviewState:'PENDING_REVIEW',legacyReviewStatus:raw.reviewStatus??null}});updated++;
  }else{
   await db.question.create({data:{legacyId,subject:'math',...content,contentHash,reviewState:'LEGACY_UNVERIFIED',legacyReviewStatus:raw.reviewStatus??null}});created++;
  }
 }
 console.log({total:all.length,created,unchanged,updated,notice:'Original reviewStatus is preserved but does NOT grant APPROVED status'});
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
