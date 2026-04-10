// Simple test function using CommonJS
module.exports = function handler(req, res) {
  res.status(200).json({ message: 'Hello from Vercel!', path: req.url, method: req.method });
}