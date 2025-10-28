
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.sqlite');
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

const db = new sqlite3.Database(DB_FILE);
const run = (sql, p=[]) => new Promise((res,rej)=> db.run(sql,p,function(e){e?rej(e):res(this)}));
const all = (sql, p=[]) => new Promise((res,rej)=> db.all(sql,p,(e,r)=> e?rej(e):res(r)));
const get = (sql, p=[]) => new Promise((res,rej)=> db.get(sql,p,(e,r)=> e?rej(e):res(r)));

function toISO(s){ try{ return new Date(s).toISOString(); } catch{ return null; } }
function hoursBetween(a,b){ const A=new Date(a).getTime(), B=new Date(b).getTime(); return (isFinite(A)&&isFinite(B)&&B>A)? (B-A)/36e5 : 0; }

async function init(){
  // tables
  await run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    pin TEXT DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('mechanic','admin'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS entries(
    id TEXT PRIMARY KEY,
    date TEXT,
    mechanic TEXT,
    bus TEXT,
    serviceType TEXT,
    odometer TEXT,
    laborHours TEXT,
    notes TEXT,
    photos TEXT,
    parts TEXT,
    startTime TEXT,
    endTime TEXT,
    durationHours REAL
  )`);
  await run('ALTER TABLE entries ADD COLUMN startTime TEXT').catch(()=>{});
  await run('ALTER TABLE entries ADD COLUMN endTime TEXT').catch(()=>{});
  await run('ALTER TABLE entries ADD COLUMN durationHours REAL').catch(()=>{});

  // soft seed: only when there is no admin yet
  const hasAdmin = await get(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if(!hasAdmin){
    const mechs = [
      "Angel Ramos","Fasso Yolanola","Hecktor Hernandez","Joe D.","Jorge Martinez",
      "Jose Rivas","Jose Tenesaca","Justin Tenesaca","LuzFazo","Marco Naula",
      "Marcial Rosendo","Parkash Singh","Ronaldo Guatemala","Selvin Telles",
      "Shirlene Rawana","Wilmer Guanuchi"
    ].sort((a,b)=> a.localeCompare(b));
    const stmt = db.prepare('INSERT INTO users(name,pin,role) VALUES(?,?,?)');
    mechs.forEach((n,i)=> stmt.run(n, String(1001+i), 'mechanic'));
    stmt.run('Admin 1','9991','admin'); stmt.run('Admin 2','9992','admin'); stmt.run('Admin 3','9993','admin');
    stmt.finalize();
    console.log('Seeded default admins + mechanics');
  }
}

// ---- AUTH ----
app.post('/api/login', async (req,res)=>{
  const { name, pin } = req.body||{};
  if(!name || !pin || String(pin).length!==4) return res.status(400).json({error:'name + 4-digit pin required'});
  const u = await get('SELECT * FROM users WHERE lower(name)=lower(?)',[name]);
  if(!u) return res.status(404).json({error:'user not found'});
  if(!u.pin){ await run('UPDATE users SET pin=? WHERE id=?',[String(pin),u.id]); const v=await get('SELECT * FROM users WHERE id=?',[u.id]); return res.json({ok:true,user:{id:v.id,name:v.name,role:v.role,pinSet:!!v.pin}}); }
  if(String(u.pin)!==String(pin)) return res.status(401).json({error:'wrong pin'});
  res.json({ok:true,user:{id:u.id,name:u.name,role:u.role,pinSet:!!u.pin}});
});

// ---- USERS ----
app.get('/api/users', async (req,res)=>{
  const list=await all(`SELECT id,name,role,CASE WHEN pin IS NULL OR pin='' THEN 0 ELSE 1 END AS pinSet FROM users ORDER BY name ASC`);
  res.json(list);
});
app.post('/api/users', async (req,res)=>{
  const { name, role } = req.body||{};
  if(!name || !role) return res.status(400).json({error:'name & role required'});
  try{
    await run('INSERT INTO users(name,role,pin) VALUES(?,?,\"\")',[name.trim(),role]);
    const u=await get('SELECT * FROM users WHERE name=?',[name.trim()]);
    res.json({id:u.id,name:u.name,role:u.role,pinSet:!!u.pin});
  }catch(e){ res.status(400).json({error:String(e.message||e)}); }
});
app.post('/api/users/reset-pin', async (req,res)=>{
  const { name } = req.body||{}; await run('UPDATE users SET pin=\"\" WHERE name=?',[name]); res.json({ok:true});
});
app.post('/api/users/rename', async (req,res)=>{
  const { oldName, newName } = req.body||{};
  if(!oldName || !newName) return res.status(400).json({error:'oldName + newName required'});
  try{ await run('UPDATE users SET name=? WHERE name=?',[newName.trim(),oldName.trim()]); res.json({ok:true}); }
  catch(e){ res.status(400).json({error:String(e.message||e)}); }
});
app.delete('/api/users', async (req,res)=>{
  const { name } = req.body||{}; await run('DELETE FROM users WHERE name=?',[name]); res.json({ok:true});
});

// ---- ENTRIES ----
app.get('/api/entries', async (req,res)=>{
  const q=req.query; let rows = await all('SELECT * FROM entries ORDER BY date DESC');
  if(q.role!=='admin') rows = rows.filter(e=> e.mechanic===q.name);
  rows = rows.filter(e=> (!q.from || e.date>=q.from) && (!q.to || e.date<=q.to) && (!q.bus || e.bus===q.bus) && (!q.mech || e.mechanic===q.mech) && (!q.type || e.serviceType===q.type));
  rows = rows.map(e=> ({...e, photos: JSON.parse(e.photos||'[]'), parts: JSON.parse(e.parts||'[]')}));
  res.json(rows);
});
app.post('/api/entries', async (req,res)=>{
  const e=req.body||{};
  const id = e.id || (Date.now().toString(36)+Math.random().toString(36).slice(2,8));
  const startISO = e.startTime ? toISO(e.startTime) : null;
  const endISO   = e.endTime   ? toISO(e.endTime)   : null;
  const dateISO  = startISO || toISO(new Date());
  const duration = (startISO && endISO) ? hoursBetween(startISO,endISO) : parseFloat(e.laborHours||'0')||0;
  await run('INSERT OR REPLACE INTO entries(id,date,mechanic,bus,serviceType,odometer,laborHours,notes,photos,parts,startTime,endTime,durationHours) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id,dateISO,e.mechanic,e.bus,e.serviceType,e.odometer,e.laborHours??'',e.notes,JSON.stringify(e.photos||[]),JSON.stringify(e.parts||[]),startISO,endISO,duration]);
  const saved=await get('SELECT * FROM entries WHERE id=?',[id]);
  res.json({ok:true,id,saved});
});
app.delete('/api/entries/:id', async (req,res)=>{ await run('DELETE FROM entries WHERE id=?',[req.params.id]); res.json({ok:true}); });

// Weekly rollup for admin (current week)
app.get('/api/reports/weekly', async (req,res)=>{
  const startOfWeek = d => { const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; };
  const endOfWeek = d => { const s=startOfWeek(d); const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e; };
  const now = new Date(); const s = startOfWeek(now), e = endOfWeek(now);
  const sISO = s.toISOString(), eISO = e.toISOString();
  let rows = await all('SELECT mechanic, durationHours, parts FROM entries WHERE date >= ? AND date <= ?', [sISO,eISO]);
  const by = new Map();
  for(const r of rows){
    const h = parseFloat(r.durationHours||'0')||0;
    let parts=0; try{ parts=(JSON.parse(r.parts||'[]')||[]).reduce((a,p)=> a+(Number(p.qty)||0)*(Number(p.unit)||0),0);}catch{}
    const cur = by.get(r.mechanic)||{mechanic:r.mechanic,entries:0,hours:0,parts:0};
    cur.entries++; cur.hours+=h; cur.parts+=parts; by.set(r.mechanic,cur);
  }
  const list = Array.from(by.values()).sort((a,b)=> b.hours-a.hours).map(r=> ({...r, risk:(r.hours<30||r.entries<3)?'Low activity':''}));
  res.json({start:sISO,end:eISO,rows:list});
});

// static
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

init().then(()=> app.listen(PORT, ()=> console.log('Server on http://localhost:'+PORT)))
.catch(e=>{ console.error('Init error',e); process.exit(1); });
