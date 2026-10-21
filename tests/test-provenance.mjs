// Provenance et fournisseur d'origine affichés au client (21/10/2026)
import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim();
let fails=0; const ok=(c,m)=>{console.log((c?'OK    ':'ÉCHEC ')+m); if(!c)fails++;};
const call=async(j,p,o={})=>{const r=await fetch(B+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json',Cookie:j?.c||''},body:o.body&&JSON.stringify(o.body)});const sc=r.headers.get('set-cookie');if(j&&sc)j.c=sc.split(';')[0];let data=null;try{data=await r.json()}catch{}return{status:r.status,data};};
const A={c:''},S={c:''};
await call(A,'/admin/login',{body:{login:'admin',password:PW}});
const list=(await call(null,'/products')).data;
ok(list.length>0 && list.every(p=>p.provenance==='France'),'catalogue : tous les produits affichent « Provenance : France »');
ok(list.filter(p=>p.brand==='Apple').every(p=>p.sourceSupplier==='Apple Store'),'produits Apple : fournisseur d\'origine Apple Store');
const np=(await call(A,'/admin/products',{body:{name:'Galaxy test',brand:'Samsung',category:'Téléphones',price:250000,stock:3,description:'d',sourceSupplier:'Samsung'}})).data;
ok(np.provenance==='France' && np.sourceSupplier==='Samsung','nouveau produit : provenance France par défaut, fournisseur saisi');
const pub=(await call(null,'/products/'+np.id)).data;
ok(pub.provenance==='France' && pub.sourceSupplier==='Samsung','fiche publique : provenance et fournisseur visibles');
ok(!('supplierPrice' in pub) && !('supplierId' in pub),'fiche publique : toujours aucun prix ni identifiant fournisseur interne');
const ch=(await call(A,'/admin/products/'+np.id,{method:'PATCH',body:{provenance:'Émirats (Dubaï)',sourceSupplier:''}})).data;
ok(ch.provenance==='Émirats (Dubaï)' && ch.sourceSupplier===null,'modification : provenance changée, fournisseur vidé');
ok(((await call(A,'/admin/products/'+np.id,{method:'PATCH',body:{provenance:'x'.repeat(200)}})).data.provenance||'').length===40,'provenance limitée à 40 caractères');
// (21/10/2026) plus de fournisseur partenaire : le responsable catalogue saisit la provenance
const T=Date.now()%1e6; ok((await call(A,'/admin/staff',{body:{name:'F',login:'prov'+T,role:'supplier',company:'F SARL'}})).status===400,'rôle fournisseur : refusé');
const cat=(await call(A,'/admin/staff',{body:{name:'C',login:'pcat'+T,role:'catalog'}})).data;
await call(S,'/admin/login',{body:{login:'pcat'+T,password:cat.password}});
const sp=(await call(S,'/admin/products',{body:{name:'Câble P',category:'Accessoires',costPrice:1000,stock:2,description:'d',provenance:'Chine'}})).data;
ok(sp.provenance==='Chine' && sp.pending===true,'responsable catalogue : choisit la provenance de sa proposition');
const ap=(await call(A,'/admin/products',{body:{name:'iPhone test',brand:'Apple',category:'Téléphones',price:600000,stock:1,description:'d',sourceSupplier:'Fnac'}})).data;
ok(ap.sourceSupplier==='Apple Store','produit Apple : fournisseur toujours « Apple Store », même si autre chose est saisi');
console.log(fails?fails+' ÉCHEC(S)':'TOUT EST OK'); process.exit(fails?1:0);
