const path = require('node:path');
const app = require('../server');

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
