# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repo contains two parallel environments for the same travel chatbot:

- **`travel-chatbot/`** — WordPress plugin (production)
- **`local-test/`** — Standalone Node.js dev server (zero dependencies, for testing without WordPress)

Both environments implement the same chatbot logic: fetch WP posts → build AI context → handle a booking flow state machine → call OpenAI or Claude API.

## Local Development

```bash
cd local-test
node server.js
# Open http://localhost:3000
```

Config lives in `local-test/.env`. Copy and edit it with real API keys before running. The server fetches posts from the live WordPress site defined in `WP_URL` (authenticated via `WP_USERNAME` + `WP_APP_PASSWORD`).

There are no build steps, linters, or test suites in this project.

## Architecture: Request Flow

### WordPress Plugin (PHP)

1. **`class-travel-chatbot.php`** — Singleton boot class. Registers WP hooks: enqueues assets, renders `<div id="tc-root">` in footer, registers two AJAX actions (`travel_chatbot_query`, `travel_chatbot_config`).

2. **`class-ajax-handler.php`** — Core request handler (`Travel_Chatbot_Ajax::handle()`). Pipeline:
   - Nonce verification → rate limit (30 req/hr/IP via WP transients) → input sanitization
   - Fetches posts (WP transient cache, 30 min) → builds AI context string
   - **Booking flow state machine**: `detect_flow_step()` regex-matches the user message to one of `flight_start`, `hotel_start`, `attraction_start`, `flow_travelers_answer`, `flow_dates_answer`, or `content`. Non-`content` steps return pre-built responses without hitting the AI at all.
   - For `content` steps: checks AI response cache (1 hr) then calls `Travel_Chatbot_AI_Client::query()`.

3. **`class-ai-client.php`** — Wraps OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) APIs. Provider is selected by the `travel_chatbot_api_provider` option (`openai` or `claude`). The system prompt instructs the AI to reply in the user's language (Hebrew/English), use numbered lists for recommendations, always include a source link, and optionally append `[CHIPS: a | b | c]` for quick-reply suggestions. `parse_reply()` strips that tag out of the raw text.

4. **`class-context-builder.php`** — Converts WP posts into a numbered text block for the system prompt (800 chars/post, 60k total). Also extracts Hebrew location keywords from post titles (frequency-based, with stopwords) to use as destination chips.

5. **`class-post-fetcher.php`** — Runs `WP_Query` for published posts, optionally filtered by tag IDs. Also has `detect_primary_destination()` that auto-detects the site's main destination from post title frequency.

### Local Dev Server (Node.js)

`local-test/server.js` reimplements the same pipeline in pure Node.js with no npm packages. It fetches WP posts via the REST API (`/wp-json/wp/v2/posts`) using HTTP Basic auth. The booking flow state machine, AI prompt, CHIPS parsing, and caching logic mirror the PHP implementation exactly.

`local-test/flow-map.html` is a visual diagram of the booking flow states (static HTML, open in browser).

## Key Data Shapes

**AJAX response** (`wp_send_json_success`):
```json
{
  "reply": "markdown string",
  "suggestions": ["chip 1", "chip 2"],
  "suggestion_type": "chips" | "traveler_picker"
}
```

**Booking flow `collected` object** (parsed from last 10 history messages):
```json
{ "destination": "בחריין", "iata": "BAH", "adults": 2, "children": 0, "month": "בקיץ" }
```

## WordPress Plugin Settings

All options are prefixed `travel_chatbot_`:
- `api_provider` (`openai` | `claude`), `api_key`, `model`
- `tag_ids`, `max_posts`
- `widget_title`, `subtitle`, `welcome_message`, `site_name`
- `destination`, `iata` (auto-detected from posts if empty)
- `skyscanner_id`, `booking_id`, `secretflights_key`, `secretflights_url`

## External APIs

- **SecretFlights** (`api.secretflights.co.il/deals/v2/{IATA}`) — flight deals. Falls back to Skyscanner deep-link if key/IATA missing or API fails.
- **Skyscanner** — affiliate deep-link fallback for flights.
- **Booking.com** — affiliate deep-link for hotels.
- **OpenAI** / **Anthropic** — AI responses.

## Language Note

The booking flow regex and UI strings are bilingual (Hebrew + English). Hebrew uses Unicode range `\x{05D0}-\x{05EA}`. The IATA lookup table in `class-ajax-handler.php` maps common Hebrew city names to airport codes.
