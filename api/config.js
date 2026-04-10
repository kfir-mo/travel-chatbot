// Config endpoint for Vercel
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const destination = process.env.SITE_DESTINATION || 'בחריין';
  const iata = process.env.SITE_DESTINATION_IATA || 'BAH';
  const quickReplies = [
    { label: `✈️ טיסה ל${destination}`, message: `אני מחפש טיסה ל${destination}` },
    { label: `🏨 מלון ב${destination}`, message: `אני מחפש מלון ב${destination}` },
    { label: '📍 אטרקציות', message: `מה מומלץ לראות ב${destination}?` },
  ];

  res.status(200).json({
    siteName: process.env.SITE_NAME || 'Visit Bahrain',
    destination,
    iata,
    quickReplies
  });
}