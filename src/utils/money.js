// Le franc CFA (XAF) n'a pas de centimes : on travaille toujours en entiers.
const formatXAF = (amount) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount) + ' FCFA';

module.exports = { formatXAF };
