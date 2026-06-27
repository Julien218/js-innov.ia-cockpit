const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

// Servir les fichiers statiques
app.use(express.static(DIST, {
  maxAge: '1y',
  immutable: true,
  index: false,
}));

// SPA fallback — toutes les routes → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ JS-Innov.IA Cockpit — port ${PORT}`);
});
