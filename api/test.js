// Simple test function
export default function handler(req, res) {
  res.status(200).json({ message: 'Hello from Vercel!', path: req.url, method: req.method });
}