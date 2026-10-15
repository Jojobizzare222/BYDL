const path = require('path');
const express = require('express');
const config = require('./config');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Fichiers statiques avec cache : important pour les connexions mobiles lentes.
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.get('/api/config', (req, res) =>
  res.json({ shopName: config.shopName, currency: config.currency, paymentMode: config.paymentMode })
);
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne' });
});

app.listen(config.port, () => {
  console.log(`${config.shopName} en ligne sur http://localhost:${config.port}`);
  console.log(`Mode de paiement : ${config.paymentMode.toUpperCase()}`);
});
