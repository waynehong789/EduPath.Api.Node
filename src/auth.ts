import type {Request,Response,NextFunction} from 'express';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {db} from './db.js';

export type Actor={id:string;displayName:string;role:string;authSubject:string};
declare global {namespace Express {interface Request {actor?:Actor}}}
const devAllowed=process.env.NODE_ENV!=='production' && process.env.DEV_AUTH_ENABLED==='true';
if(process.env.NODE_ENV==='production' && process.env.DEV_AUTH_ENABLED==='true') throw Error('Refusing DEV_AUTH_ENABLED in production');
const pool=process.env.COGNITO_USER_POOL_ID || '';
const clientId=process.env.COGNITO_CLIENT_ID || '';
const region=process.env.COGNITO_REGION || 'ap-southeast-2';
if(!devAllowed && (!pool || !clientId)) throw Error('Set Cognito pool/client or explicitly enable development auth');
const issuer=`https://cognito-idp.${region}.amazonaws.com/${pool}`;
const jwks=pool?createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)):null;
export async function auth(req:Request,res:Response,next:NextFunction){
 try{
  let subject:string;let name:string;
  if(devAllowed){
   // Local-only fake identity: NEVER expose this backend to the public internet.
   const raw=req.header('x-dev-user-id') || 'demo-student';
   if(!/^[a-zA-Z0-9_-]{1,40}$/.test(raw)) return res.status(400).json({error:'Invalid development user ID'});
   subject=`dev:${raw}`;name=raw;
  }else{
   const token=req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   if(!token||!jwks)return res.status(401).json({error:'Sign in required'});
   const verified=await jwtVerify(token,jwks,{issuer});
   // Cognito ACCESS token has client_id, token_use=access. Do not accept ID tokens as access tokens.
   if(verified.payload.token_use!=='access'||verified.payload.client_id!==clientId||!verified.payload.sub)return res.status(401).json({error:'Invalid access token'});
   subject=`cognito:${String(verified.payload.sub)}`;
   name=String(verified.payload.username||'Student');
  }
  const user=await db.user.upsert({where:{authSubject:subject},update:{},create:{authSubject:subject,displayName:name}});
  req.actor={id:user.id,displayName:user.displayName,role:user.role,authSubject:user.authSubject};next();
 }catch(e){next(e)}
}
