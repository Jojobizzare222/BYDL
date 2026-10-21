import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim(), UP=process.argv[3];
let fails=0; const ok=(c,m)=>{console.log((c?'OK    ':'ÉCHEC ')+m); if(!c)fails++;};
const call=async(j,p,o={})=>{const r=await fetch(B+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':o.type||'application/json',Cookie:j?.c||''},body:o.raw||(o.body&&JSON.stringify(o.body))});const sc=r.headers.get('set-cookie');if(sc&&j)j.c=sc.split(';')[0];return{status:r.status,data:await r.json().catch(()=>null)};};
const A={c:''},S={c:''},C={c:''},S2={c:''};
await call(A,'/admin/login',{body:{login:'admin',password:PW}});
const T=Date.now()%1e6; const mk=async(b)=>(await call(A,'/admin/staff',{body:b})).data;
// (21/10/2026) plus de fournisseurs : deux responsables catalogue proposent des produits
const sup=await mk({name:'F',login:'fcat'+T,role:'catalog'}), sup2=await mk({name:'G',login:'gcat'+T,role:'catalog'});
await call(S,'/admin/login',{body:{login:'fcat'+T,password:sup.password}}); await call(S2,'/admin/login',{body:{login:'gcat'+T,password:sup2.password}});
const P={name:'Produit test',brand:'X',universe:'Électronique',category:'Audio',costPrice:5000,stock:5,description:'d'};
// photo envoyée par le responsable catalogue
const upr=await fetch(B+'/admin/uploads',{method:'POST',headers:{'Content-Type':'image/png',Cookie:S.c},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}); const up=await upr.json(); if(!up.url) console.log('UPLOAD', upr.status, JSON.stringify(up), S.c.length);
const p1=(await call(S,'/admin/products',{body:{...P,images:[up.url]}})).data;
const file=up.url.split('/').pop();
ok(fs.existsSync(UP+'/'+file),'photo enregistrée');
ok((await call(S2,'/admin/products/'+p1.id,{method:'DELETE'})).status===403,'un autre responsable catalogue : pas la proposition d\'un autre');
ok((await call(null,'/admin/products/'+p1.id,{method:'DELETE'})).status===401,'sans connexion : refusé');
ok((await call(S,'/admin/products/'+p1.id,{method:'DELETE'})).status===200,'il retire SA proposition en attente');
await new Promise(r=>setTimeout(r,200));
ok(!fs.existsSync(UP+'/'+file),'sa photo est effacée du disque');
// produit publié : seul l'admin peut le supprimer
const p2=(await call(S,'/admin/products',{body:P})).data;
await call(A,'/admin/products/'+p2.id,{method:'PATCH',body:{price:9000}}); await call(A,'/admin/products/'+p2.id+'/approve',{method:'POST'});
ok((await call(S,'/admin/products/'+p2.id,{method:'DELETE'})).status===403,'produit publié : le responsable catalogue ne peut pas le supprimer');
// commande en cours de paiement → refus admin
const o=(await call(null,'/orders',{body:{items:[{productId:p2.id,qty:1}],customer:{name:'Cli',phone:'061234567',city:'Pointe-Noire',address:'x'}}})).data;
ok(o&&o.id,'commande créée sur le produit');
const pay=await call(null,'/payments',{body:{orderId:o.id,token:o.token,phone:'061234567'}});
ok(pay.status<300,'paiement lancé');
ok((await call(A,'/admin/products/'+p2.id,{method:'DELETE'})).status===409,'paiement en cours : suppression refusée');
await new Promise(r=>setTimeout(r,10000)); await call(null,'/payments/'+pay.data.id);
const del=await call(A,'/admin/products/'+p2.id,{method:'DELETE'});
ok(del.status===200,'admin : suppression OK une fois payé');
ok((await call(null,'/products/'+p2.id)).status===404,'produit absent de la boutique');
const ord=(await call(A,'/admin/orders')).data; const oo=(ord.orders||ord).find(x=>x.id===o.id);
ok(oo&&oo.status==='paid'&&oo.lines[0].name==='Produit test','la commande reste intacte (nom, statut)');
ok((await call(A,'/admin/stats')).status===200&&(await call(A,'/admin/export/orders.csv')).status===200,'tableau de bord et export fonctionnent toujours');
ok((await call(A,'/admin/activity')).data.some(a=>a.action==='Produit supprimé'&&/1 commande/.test(a.details)),'suppression inscrite au journal');
ok((await call(A,'/admin/products/'+p2.id,{method:'DELETE'})).status===404,'deuxième suppression : introuvable');
console.log(fails?fails+' ÉCHEC(S)':'TOUT EST BON');
