import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim();
let fails=0; const ok=(c,m)=>{console.log((c?'OK    ':'ÉCHEC ')+m); if(!c)fails++;};
const call=async(j,p,o={})=>{const r=await fetch(B+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json',Cookie:j?.c||'',...o.headers},body:o.body&&JSON.stringify(o.body)});const sc=r.headers.get('set-cookie');if(sc&&j)j.c=sc.split(';')[0];return{status:r.status,data:await r.json().catch(()=>null)};};
const A={c:''}; await call(A,'/admin/login',{body:{login:'admin',password:PW}});
await call(A,'/admin/agencies',{body:{name:'Agence Centre',city:'Pointe-Noire',address:'Av. X',hours:'8h-18h',phone:'061111111',active:true}});
const T=Date.now()%1e6; const mk=async(role)=>{const u=(await call(A,'/admin/staff',{body:{name:role+' Test',login:role+T,role,company:'Fournisseur SA'}})).data; const j={c:''}; await call(j,'/admin/login',{body:{login:role+T,password:u.password}}); return j;};
const O=await mk('orders'), CAT=await mk('catalog'), SUP=await mk('courier'); // (21/10/2026) plus de fournisseurs : le livreur sert de 3e rôle
// Visiteur
const g0=(await call(null,'/chat')).data;
ok(g0.conversation===null && g0.welcome.quick.length>3,'visiteur : message d\'accueil avec sujets');
const m1=await call(null,'/chat/messages',{body:{text:'Bonjour, quels sont vos délais de livraison ?'}});
const tok=m1.data.token;
ok(m1.status===201 && /^[a-f0-9]{32}$/.test(tok) && m1.data.conversation.messages.at(-1).from==='bot' && /viennent de France/.test(m1.data.conversation.messages.at(-1).text) && /livraison sous 24 h/.test(m1.data.conversation.messages.at(-1).text),'assistant : répond tout de suite (livraison : France, puis 24 h)');
const H={'X-Chat-Token':tok};
const m2=await call(null,'/chat/messages',{body:{text:'Paiement'},headers:H});
ok(/agence/i.test(m2.data.conversation.messages.at(-1).text) && /Agence Centre/.test(m2.data.conversation.messages.at(-1).text),'assistant : paiement en agence + liste des agences');
ok((await call(null,'/chat')).data.conversation===null,'sans sa clé, un autre visiteur ne voit pas la conversation');
ok((await call(O,'/admin/chat/conversations')).data.find(c=>c.status==='bot'),'Kamwa Pro : conversation visible (avec l\'assistant)');
const h=await call(null,'/chat/messages',{body:{text:'Je veux parler à un conseiller'},headers:H});
ok(h.data.needContact===true && h.data.conversation.status==='open','demande de conseiller : passe à l\'équipe, coordonnées demandées');
ok((await call(null,'/chat/human',{body:{name:'Awa',phone:'123'},headers:H})).status===400,'numéro invalide refusé');
await call(null,'/chat/human',{body:{name:'Awa Test',phone:'06 123 45 67'},headers:H});
const un=(await call(O,'/admin/chat/unread')).data;
ok(un.support===1 && un.waiting===1,'Kamwa Pro : pastille « 1 client attend »');
const list=(await call(O,'/admin/chat/conversations')).data; const cid=list[0].id;
ok(list[0].name==='Awa Test' && list[0].phone==='061234567','fiche : nom et numéro du visiteur');
await call(O,'/admin/chat/conversations/'+cid+'/messages',{body:{text:'Bonjour Awa, je regarde ça.'}});
await call(O,'/admin/chat/conversations/'+cid+'/messages',{body:{text:'Cliente à rappeler demain',internal:true}});
const cv=(await call(null,'/chat',{headers:H})).data.conversation;
ok(cv.messages.some(m=>m.from==='staff'&&m.text.startsWith('Bonjour Awa')&&m.staffName==='orders') && !cv.messages.some(m=>/rappeler demain/.test(m.text)) && cv.unread===1,'client : voit la réponse du conseiller (prénom), jamais la note interne');
await call(null,'/chat/messages',{body:{text:'Merci beaucoup'},headers:H});
ok((await call(null,'/chat',{headers:H})).data.conversation.messages.at(-1).from==='customer','conseiller en charge : l\'assistant ne répond plus');
ok((await call(CAT,'/admin/chat/conversations')).status===403 && (await call(SUP,'/admin/chat/conversations')).status===403,'conversations clients : interdites au responsable catalogue et au livreur');
await call(O,'/admin/chat/conversations/'+cid+'/close',{body:{}});
ok((await call(null,'/chat',{headers:H})).data.conversation===null,'conversation terminée : le client repart sur une nouvelle');
// Client connecté
const ID={idType:'cni',idPhoto:'data:image/jpeg;base64,'+fs.readFileSync(process.argv[3]).toString('base64')};
const C={c:''}; const reg=await call(C,'/account/register',{body:{name:'Jean Client',phone:'069999991',...ID}});
const mc=await call(C,'/chat/messages',{body:{text:'Ma pièce d\'identité est validée ?'}});
ok(/vérification/.test(mc.data.conversation.messages.at(-1).text),'client connecté : l\'assistant connaît l\'état de sa pièce');
const mo=await call(C,'/chat/messages',{body:{text:'Où est ma commande ?'}});
ok(/pas encore de commande/.test(mo.data.conversation.messages.at(-1).text),'client connecté : l\'assistant regarde ses commandes');
// Salon de l'équipe
await call(CAT,'/admin/chat/team',{body:{text:'Bonjour l\'équipe, nouveaux produits en ligne'}});
ok((await call(O,'/admin/chat/unread')).data.team===1,'salon Équipe : message non lu signalé aux autres');
const t=(await call(O,'/admin/chat/team')).data;
ok(t.messages.at(-1).staffName==='catalog Test' && (await call(O,'/admin/chat/unread')).data.team===0,'salon Équipe : lu, nom de l\'auteur affiché');
ok((await call(SUP,'/admin/chat/team')).status===200 && (await call(null,'/admin/chat/team')).status===401,'salon Équipe : ouvert au livreur, refusé sans connexion');
ok((await call(null,'/admin/chat/team')).status===401,'salon Équipe : invisible sans connexion');
let blocked=false; for(let i=0;i<25;i++){ const r=await call(null,'/chat/messages',{body:{text:'spam '+i},headers:H}); if(r.status===429){blocked=true;break;} }
ok(blocked,'trop de messages en une minute : bloqué');
console.log(fails? fails+' ÉCHEC(S)':'TOUT EST OK');
