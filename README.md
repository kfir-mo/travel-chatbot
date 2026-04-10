# Travel Chatbot

A WordPress plugin and standalone Node.js development server for an AI-powered travel booking chatbot. Uses OpenAI or Anthropic APIs to help users plan trips.

## Quick Start (Local Development)

### Prerequisites
- Node.js 14+
- API key from OpenAI or Anthropic
- WordPress site (for fetching travel content)

### Setup

```bash
cd local-test
cp .env.example .env
# Edit .env with your API keys and WordPress URL
node server.js
# Open http://localhost:3000
```

## Project Structure

- **`travel-chatbot/`** — WordPress plugin for production deployment
- **`local-test/`** — Standalone Node.js dev server (no npm dependencies)
- **`CLAUDE.md`** — Full architecture documentation

## Features

- **Booking Flow State Machine** — Multi-step conversation flow for flights, hotels, attractions
- **AI Context Building** — Fetches WordPress posts to provide travel recommendations
- **Bilingual Support** — Hebrew and English
- **Multiple AI Providers** — OpenAI and Anthropic (Claude)
- **Quick Chips UI** — Button suggestions for quick replies
- **Affiliate Links** — Skyscanner, Booking.com, SecretFlights integration

## Deployment

### WordPress Plugin
Copy the `travel-chatbot/` folder to your WordPress plugins directory and activate.

### Public Testing (Vercel)
Deploy the `local-test/` server using Vercel for public access and mobile testing.

## Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed architecture, API documentation, and configuration guide.
