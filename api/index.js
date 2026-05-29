// Vercel serverless entry point.
// Wraps the same request handler used by the standalone server (server.js).
// All /api/* requests are rewritten here via vercel.json.
const handler = require('../server.js');

module.exports = (req, res) => handler(req, res);
