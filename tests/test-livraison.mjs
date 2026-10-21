import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim();
let fails=0; const ok=(c,m)=>{console.log((c?'OK    ':'ÉCHEC ')+m); if(!c)fails++;};
const call=async(j,p,o={})=>{const r=await fetch(B+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json',Cookie:j?.c||'',...o.headers},body:o.body&&JSON.stringify(o.body)});const sc=r.headers.get('set-cookie');if(sc&&j)j.c=sc.split(';')[0];return{status:r.status,data:await r.json().catch(()=>null)};};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const A={c:''},E={c:''},L={c:''},L2={c:''};
await call(A,'/admin/login',{body:{login:'admin',password:PW}});
const T=Date.now()%1e6;
const mk=async(b)=>(await call(A,'/admin/staff',{body:b})).data;
const emp=await mk({name:'Emp',login:'emp'+T,role:'orders'}), liv=await mk({name:'Livreur Un',login:'liv'+T,role:'courier',phone:'061111111'}), liv2=await mk({name:'Livreur Deux',login:'livb'+T,role:'courier'});
ok(liv?.user?.role==='courier','compte Livreur créé');
await call(E,'/admin/login',{body:{login:'emp'+T,password:emp.password}}); await call(L,'/admin/login',{body:{login:'liv'+T,password:liv.password}}); await call(L2,'/admin/login',{body:{login:'livb'+T,password:liv2.password}});
ok((await call(E,'/admin/settings/cod',{method:'PUT',body:{deposit:1000}})).status===403,'réglages : refusés à l\'employé');
ok((await call(A,'/admin/settings/cod',{method:'PUT',body:{enabled:true,deposit:2000,depositPercent:0,trustedAfter:2,maxRefusals:2}})).status===200,'réglages enregistrés par l\'admin');
ok((await call(L,'/admin/orders')).status===403 && (await call(L,'/admin/finance')).status===403,'livreur : pas accès aux commandes ni aux finances');
const st=(await call(L,'/admin/stats')).data; ok(st.role==='courier' && !JSON.stringify(st).includes('Chiffre'),'livreur : tableau de bord sans chiffre d\'affaires');
const P=(await call(A,'/admin/products',{body:{name:'Enceinte test',brand:'X',universe:'Électronique',category:'Audio',price:10000,costPrice:6000,stock:50,description:'d'}})).data;
const m=(await call(null,'/payments/methods')).data; ok(m.cod?.enabled && m.cod.deposit===2000,'moyens de paiement : « à la réception » proposé, acompte 2 000');
const PHONE='06'+String(T).padStart(7,'0').slice(-7);
const newOrder=async(qty=1,phone=PHONE)=>(await call(null,'/orders',{body:{items:[{productId:P.id,qty}],customer:{name:'Cli',phone,city:'Pointe-Noire',address:'Quartier test'}}})).data;
const waitPay=async(id)=>{await sleep(9500); return (await call(null,'/payments/'+id)).data;};
// 1. nouveau client : acompte
const o1=await newOrder(2); ok(/^\d{4}$/.test(o1.deliveryCode),'commande : code de livraison à 4 chiffres pour le client');
const p1=await call(null,'/payments',{body:{orderId:o1.id,token:o1.token,method:'cod',phone:PHONE}});
ok(p1.status===201 && p1.data.amount===2000 && p1.data.status==='PENDING','nouveau client : acompte de 2 000 demandé en Mobile Money');
const stockBefore=(await call(null,'/products/'+P.id)).data.stock;
await waitPay(p1.data.id);
let v=(await call(null,'/orders/'+o1.id,{headers:{'X-Order-Token':o1.token}})).data;
ok(v.status==='confirmed' && v.paymentPlan==='cod' && v.balance===18000,'acompte reçu : commande confirmée, reste 18 000 à la livraison');
ok((await call(null,'/products/'+P.id)).data.stock===stockBefore-2,'articles réservés (stock diminué)');
let eo=(await call(E,'/admin/orders')).data.orders.find(x=>x.id===o1.id), ao=(await call(A,'/admin/orders')).data.orders.find(x=>x.id===o1.id);
ok(eo.deliveryCode===undefined && ao.deliveryCode===o1.deliveryCode,'code de livraison : visible par l\'admin, caché à l\'employé');
ok(eo.reliability && eo.reliability.delivered===0 && eo.toCollect===18000,'fiche : fiabilité du client et reste à encaisser');
ok((await call(E,'/admin/orders/'+o1.id+'/call',{body:{}})).data.callConfirmedAt,'appel de confirmation noté');
ok((await call(E,'/admin/orders/'+o1.id+'/assign',{body:{courierId:liv.user.id}})).data.status==='shipped','commande confiée au livreur : en livraison');
let d=(await call(L,'/admin/courier/deliveries')).data; let c1=d.current.find(x=>x.id===o1.id);
ok(c1 && c1.customer.phone===PHONE && c1.toCollect===18000 && !('deliveryCode' in c1),'livreur : voit adresse, téléphone et somme à encaisser, PAS le code');
ok(!(await call(L2,'/admin/courier/deliveries')).data.current.some(x=>x.id===o1.id),'un autre livreur ne voit pas cette livraison');
ok((await call(L2,'/admin/courier/deliveries/'+o1.id+'/deliver',{body:{code:o1.deliveryCode,collect:'cash'}})).status===404,'un autre livreur ne peut pas la valider');
const wrong=String((Number(o1.deliveryCode)%9000)+1000+1).slice(0,4)===o1.deliveryCode?'0000':String((Number(o1.deliveryCode)%9000)+1000+1);
ok((await call(L,'/admin/courier/deliveries/'+o1.id+'/deliver',{body:{code:wrong,collect:'cash'}})).status===400,'code faux refusé');
ok((await call(L,'/admin/courier/deliveries/'+o1.id+'/deliver',{body:{code:o1.deliveryCode}})).status===400,'bon code mais reste non encaissé : refusé');
ok((await call(L,'/admin/courier/deliveries/'+o1.id+'/deliver',{body:{code:o1.deliveryCode,collect:'cash'}})).data?.delivered,'bon code + espèces : livrée');
d=(await call(L,'/admin/courier/deliveries')).data; ok(d.cashHeld===18000,'livreur : 18 000 en espèces à remettre');
v=(await call(null,'/orders/'+o1.id,{headers:{'X-Order-Token':o1.token}})).data;
ok(v.status==='delivered' && !('courierId' in v) && !('cashHeldBy' in v),'client : livrée, sans données internes');
let f=(await call(A,'/admin/finance?from=&to=')).data;
ok(f.cashHeld.some(h=>h.id===liv.user.id && h.amount===18000),'finances : espèces chez le livreur');
const cashBefore=f.balances.cash;
ok((await call(A,'/admin/finance/remit/'+liv.user.id,{body:{}})).data.total===18000,'espèces remises par le livreur');
f=(await call(A,'/admin/finance?from=&to=')).data; ok(f.balances.cash===cashBefore+18000 && !f.cashHeld.length,'caisse espèces augmentée de 18 000');
// 2. paiement Mobile Money devant le livreur
const o2=await newOrder(1); const p2=await call(null,'/payments',{body:{orderId:o2.id,token:o2.token,method:'cod',phone:PHONE}}); await waitPay(p2.data.id);
await call(E,'/admin/orders/'+o2.id+'/assign',{body:{courierId:liv.user.id}});
const r2=await call(L,'/admin/courier/deliveries/'+o2.id+'/deliver',{body:{code:o2.deliveryCode,collect:'momo'}});
ok(r2.status===202 && r2.data.amount===8000,'reste demandé en Mobile Money au client (8 000)');
await sleep(9500); const s2=(await call(L,'/admin/courier/payments/'+r2.data.paymentId)).data;
ok(s2.status==='SUCCESSFUL' && s2.orderStatus==='delivered','Mobile Money validé : commande livrée');
// 3. client fiable (2 livraisons) : plus d'acompte
const o3=await newOrder(1); const p3=await call(null,'/payments',{body:{orderId:o3.id,token:o3.token,method:'cod'}});
ok(p3.data.status==='SUCCESSFUL' && p3.data.deposit===0,'client fiable : pas d\'acompte, commande confirmée tout de suite');
// échec : absent puis refus
await call(E,'/admin/orders/'+o3.id+'/assign',{body:{courierId:liv.user.id}});
ok((await call(L,'/admin/courier/deliveries/'+o3.id+'/fail',{body:{reason:'absent'}})).status===200 && (await call(A,'/admin/orders')).data.orders.find(x=>x.id===o3.id).status==='confirmed','client absent : commande remise « à livrer »');
// 4. nouveau numéro qui refuse 2 fois -> bloqué
const PH2='05'+String(T).padStart(7,'0').slice(-7);
for (let i=0;i<2;i++){ const o=await newOrder(1,PH2); const p=await call(null,'/payments',{body:{orderId:o.id,token:o.token,method:'cod',phone:PH2}}); await waitPay(p.data.id);
  await call(E,'/admin/orders/'+o.id+'/assign',{body:{courierId:liv.user.id}}); await call(L,'/admin/courier/deliveries/'+o.id+'/fail',{body:{reason:'refus'}}); }
const refused=(await call(A,'/admin/orders')).data.orders.filter(x=>x.customer.phone===PH2);
ok(refused.every(x=>x.status==='cancelled'),'colis refusés : commandes annulées, stock remis');
f=(await call(A,'/admin/finance?from=&to=')).data; ok(f.kpis.retainedDeposits>=4000 && f.kpis.failedDeliveries>=3,'finances : acomptes conservés et livraisons ratées comptés');
ok(!f.refundsToDo.some(r=>refused.some(x=>x.id===r.id)),'acompte conservé après refus : rien à rembourser');
const o5=await newOrder(1,PH2); ok((await call(null,'/payments',{body:{orderId:o5.id,token:o5.token,method:'cod',phone:PH2}})).status===403,'2 refus : paiement à la réception refusé pour ce numéro');
// 5. codes faux bloquent ; admin débloque / force
const o6=await newOrder(1); const p6=await call(null,'/payments',{body:{orderId:o6.id,token:o6.token,method:'cod'}});
await call(E,'/admin/orders/'+o6.id+'/assign',{body:{courierId:liv.user.id}});
for(let i=0;i<5;i++) await call(L,'/admin/courier/deliveries/'+o6.id+'/deliver',{body:{code:'0000'===o6.deliveryCode?'1111':'0000',collect:'cash'}});
ok(/bloqu/.test((await call(L,'/admin/courier/deliveries/'+o6.id+'/deliver',{body:{code:o6.deliveryCode,collect:'cash'}})).data.error||''),'5 codes faux : livraison bloquée même avec le bon code');
ok((await call(E,'/admin/orders/'+o6.id+'/deliver',{body:{force:true,collect:'cash'}})).status===400,'employé : ne peut pas forcer sans code');
await call(A,'/admin/orders/'+o6.id+'/unlock',{body:{}});
ok((await call(L,'/admin/courier/deliveries/'+o6.id+'/deliver',{body:{code:o6.deliveryCode,collect:'cash'}})).data?.delivered,'après déblocage par l\'admin : livraison validée');
// 6. commande payée en ligne : livrée seulement avec le code
const o7=await newOrder(1,'061234567'); const p7=await call(null,'/payments',{body:{orderId:o7.id,token:o7.token,method:'momo',phone:'061234567'}}); await waitPay(p7.data.id);
ok((await call(E,'/admin/orders/'+o7.id,{method:'PATCH',body:{status:'shipped'}})).status===400 && (await call(E,'/admin/orders/'+o7.id,{method:'PATCH',body:{status:'delivered'}})).status===400,'payée en ligne : « En livraison » (sans livreur) et « Livrée » ne se choisissent plus à la main');
ok((await call(E,'/admin/orders/'+o7.id+'/deliver',{body:{code:o7.deliveryCode}})).data?.delivered,'payée en ligne : livrée avec le code, rien à encaisser');
ok((await call(A,'/admin/activity')).data.some(a=>a.action==='Code de livraison faux'),'journal : codes faux enregistrés');
console.log(fails?fails+' ÉCHEC(S)':'TOUT EST BON');
