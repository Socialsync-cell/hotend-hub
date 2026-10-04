import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {Pool}=pg;
const __dirname=path.dirname(fileURLToPath(import.meta.url));
let pool=null;
function getPool(){
  if(pool)return pool;
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_MISSING');
  pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},
    options:'-c search_path=hotend_hub,public'
  });
  return pool;
}
export async function migrate(){
  const sql=await fs.readFile(path.join(__dirname,'..','sql','001_init.sql'),'utf8');
  await getPool().query(sql);
}
export async function q(text,params=[]){return getPool().query(text,params);}
