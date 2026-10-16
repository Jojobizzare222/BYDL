// Choisir (ou changer) le mot de passe de l'espace admin.
// Usage, dans le Terminal :  npm run admin:password
// Variante :                 npm run admin:hash  -> n'enregistre rien, affiche l'EMPREINTE du mot de passe
//                            à coller dans le réglage ADMIN_PASSWORD_HASH de la vitrine de démo sur Vercel.
// Le mot de passe ne s'affiche pas pendant la saisie (des • apparaissent à la place).
const HASH_ONLY = process.argv.includes('--hash');
const { setPassword, isPasswordSet, hashPassword } = require('../src/admin/auth');

const MIN_LENGTH = 10;

function ask(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          process.stdout.write('\nAnnulé.\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += ch;
        process.stdout.write('•');
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  if (!process.stdin.isTTY) {
    console.error('Lancez cette commande directement dans le Terminal.');
    process.exit(1);
  }
  console.log(HASH_ONLY ? 'Empreinte du mot de passe admin pour la démo Vercel (rien n\'est enregistré ici).' : isPasswordSet() ? 'Changement du mot de passe admin Kamwa.' : 'Création du mot de passe admin Kamwa.');
  console.log(`Au moins ${MIN_LENGTH} caractères. Une phrase facile à retenir marche très bien.\n`);
  const first = await ask('Nouveau mot de passe : ');
  if (first.length < MIN_LENGTH) {
    console.error(`Trop court (${first.length} caractères, minimum ${MIN_LENGTH}). Rien n'a été changé.`);
    process.exit(1);
  }
  const second = await ask('Retapez-le : ');
  if (first !== second) {
    console.error("Les deux saisies sont différentes. Rien n'a été changé.");
    process.exit(1);
  }
  if (HASH_ONLY) {
    console.log('\nCopiez cette ligne entière dans Vercel → Settings → Environment Variables, nom : ADMIN_PASSWORD_HASH\n');
    console.log(hashPassword(first) + '\n');
    process.exit(0);
  }
  setPassword(first);
  console.log('✓ Mot de passe enregistré. Connectez-vous sur http://localhost:3000/admin');
  process.exit(0);
})();
