// Remet les anciennes règles de vente (achat sans compte, tous paiements) pour les anciens tests
import fs from 'node:fs';
const B='http://localhost:3999/api', PW=fs.readFileSync(process.argv[2],'utf8').trim();
const r=await fetch(B+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'admin',password:PW})});
const c=r.headers.get('set-cookie').split(';')[0];
const x=await fetch(B+'/admin/settings/sales',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({accountRequired:false,methods:{momo:true,card:true,cod:true,cash:true}})});
if(!x.ok){console.log('ÉCHEC réglages',x.status);process.exit(1);}
// Anciennes règles : pas de transport France → Pointe-Noire facturé, acompte de 2 000 FCFA au paiement à la réception (avant le 21/10/2026)
const y=await fetch(B+'/admin/settings/transport',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({freight:{enabled:false}})});
if(!y.ok){console.log('ÉCHEC réglages transport',y.status);process.exit(1);}
const z=await fetch(B+'/admin/settings/cod',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify({deposit:2000})});
if(!z.ok){console.log('ÉCHEC réglages acompte',z.status);process.exit(1);}
