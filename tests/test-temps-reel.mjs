import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim();
let fails=0; const ok=(c,m)=>{console.log((c?'OK    ':'ÉCHEC ')+m); if(!c)fails++;};
const call=async(j,p,o={})=>{const r=await fetch(B+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json',Cookie:j?.c||'',...o.headers},body:o.body&&JSON.stringify(o.body)});const sc=r.headers.get('set-cookie');if(sc&&j)j.c=sc.split(';')[0];return{status:r.status,data:await r.json().catch(()=>null)};};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
// Lecteur de flux : garde chaque événement avec l'heure de réception
function listen(path, cookie){ const ev=[]; const ac=new AbortController(); (async()=>{ try{ const r=await fetch(B+path,{headers:{Cookie:cookie||''},signal:ac.signal}); const rd=r.body.getReader(); let buf=''; for(;;){ const {value,done}=await rd.read(); if(done)break; buf+=new TextDecoder().decode(value); let i; while((i=buf.indexOf('\n\n'))>=0){ const blk=buf.slice(0,i); buf=buf.slice(i+2); const e=/event: (\w+)/.exec(blk)?.[1]; const d=/data: (.*)/.exec(blk)?.[1]; if(e) ev.push({e, d:d&&JSON.parse(d), t:Date.now()}); } } }catch{} })(); return {ev, stop:()=>ac.abort()}; }
const A={c:''}; await call(A,'/admin/login',{body:{login:'admin',password:PW}});
await call(A,'/admin/settings/sales',{method:'PUT',body:{accountRequired:false}});
const ag=(await call(A,'/admin/agencies',{body:{name:'Agence',city:'Pointe-Noire'}})).data;
const T=Date.now()%1e6; const mk=async(role)=>{const u=(await call(A,'/admin/staff',{body:{name:role,login:role+T,role,company:'F'}})).data; const j={c:''}; await call(j,'/admin/login',{body:{login:role+T,password:u.password}}); return j;};
const CAT=await mk('catalog'), LIV=await mk('courier');
const ID={idType:'cni',idPhoto:'data:image/jpeg;base64,'+fs.readFileSync(process.argv[3]).toString('base64')};
const C1={c:''}; await call(C1,'/account/register',{body:{name:'Client Un',phone:'069000001',...ID}});
const C2={c:''}; await call(C2,'/account/register',{body:{name:'Client Deux',phone:'069000002',...ID}});
const pro=listen('/admin/events',A.c), cat=listen('/admin/events',CAT.c), liv=listen('/admin/events',LIV.c), s1=listen('/events',C1.c), s2=listen('/events',C2.c), guest=listen('/events','');
await sleep(500);
ok(pro.ev[0]?.e==='hello' && s1.ev[0]?.e==='hello','flux ouverts (Kamwa Pro et boutique)');
ok((await fetch(B+'/admin/events')).status===401,'flux Kamwa Pro : refusé sans connexion');
// Commande du client 1
let t0=Date.now(); const o=(await call(C1,'/orders',{body:{items:[{productId:'a002',qty:1}],customer:{name:'Client Un',phone:'069000001',city:'Pointe-Noire',address:'X'}}})).data;
await sleep(400);
const pe=pro.ev.find(e=>e.e==='change'&&e.d.topic==='orders'), ce=s1.ev.find(e=>e.e==='change'&&e.d.topic==='order');
ok(pe && pe.t-t0<400,`Kamwa Pro prévenu de la nouvelle commande en ${pe?pe.t-t0:'?'} ms`);
ok(ce && ce.d.id===o.id,'client 1 prévenu de SA commande');
ok(!s2.ev.some(e=>e.e==='change'&&e.d.topic==='order') && !guest.ev.some(e=>e.e==='change'&&e.d.topic==='order'),'client 2 et visiteur : rien sur la commande du client 1');
ok(!cat.ev.some(e=>e.d?.topic==='orders') && !liv.ev.some(e=>e.d?.topic==='orders'),'employé Catalogue et livreur : pas prévenus d\'une commande qui ne les concerne pas');
ok(!JSON.stringify(pro.ev).includes('Client Un'),'le signal ne contient aucune donnée (ni nom, ni adresse)');
// L'admin change un prix : boutiques prévenues
t0=Date.now(); await call(A,'/admin/products/a002',{method:'PATCH',body:{price:12000}}); await sleep(400);
const ge=guest.ev.find(e=>e.d?.topic==='catalog'); const ke=cat.ev.find(e=>e.d?.topic==='products');
ok(ge && ge.t-t0<400 && ke,`prix changé : boutique (même sans compte) et Catalogue prévenus en ${ge?ge.t-t0:'?'} ms`);
// Le client écrit à la messagerie : Kamwa Pro prévenu
t0=Date.now(); await call(C1,'/chat/messages',{body:{text:'Bonjour'}}); await sleep(400);
const me=pro.ev.find(e=>e.d?.topic==='chat');
ok(me && me.t-t0<400,`message client : Kamwa Pro prévenu en ${me?me.t-t0:'?'} ms`);
ok(!cat.ev.some(e=>e.d?.topic==='chat'),'employé Catalogue : pas les conversations clients');
// Salon équipe
await call(CAT,'/admin/chat/team',{body:{text:'Salut'}}); await sleep(300);
ok(liv.ev.some(e=>e.d?.topic==='team') && pro.ev.some(e=>e.d?.topic==='team'),'salon Équipe : toute l\'équipe prévenue');
// Rafale : 10 modifications d'un coup = 1 seul signal
const n0=pro.ev.length; for(let i=0;i<10;i++) await call(A,'/admin/products/a002',{method:'PATCH',body:{stock:5+i}}); await sleep(400);
ok(pro.ev.length-n0<=3,`rafale de 10 modifications regroupée (${pro.ev.length-n0} signal(s))`);
[pro,cat,liv,s1,s2,guest].forEach(x=>x.stop());
console.log(fails? fails+' ÉCHEC(S)':'TOUT EST OK');
process.exit(0);
