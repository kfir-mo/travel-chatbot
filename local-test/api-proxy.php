<?php
/**
 * Travel Chatbot — API Proxy
 *
 * Reads config from .env, fetches posts from WordPress via REST API,
 * builds AI context, calls OpenAI, returns the reply.
 *
 * Run locally:
 *   php -S localhost:8080
 *   open http://localhost:8080
 */

header('Content-Type: application/json');

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// ── Load .env ─────────────────────────────────────────────────────────
$env = load_env(__DIR__ . '/.env');

$openai_key   = $env['OPENAI_API_KEY']   ?? '';
$openai_model = $env['OPENAI_MODEL']     ?? 'gpt-4o';
$wp_url       = rtrim($env['WP_URL']     ?? '', '/');
$wp_user      = $env['WP_USERNAME']      ?? '';
$wp_pass      = $env['WP_APP_PASSWORD']  ?? '';
$wp_tag_ids   = $env['WP_TAG_IDS']       ?? '';
$wp_max_posts = (int)($env['WP_MAX_POSTS'] ?? 10);

// ── Parse request ─────────────────────────────────────────────────────
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!$body || empty($body['message'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'message is required']);
    exit;
}

$user_message = trim(substr($body['message'], 0, 500));

// Validate history
$history = [];
if (!empty($body['history']) && is_array($body['history'])) {
    foreach (array_slice($body['history'], 0, 10) as $item) {
        if (!is_array($item)) continue;
        $role    = $item['role']    ?? '';
        $content = $item['content'] ?? '';
        if (!in_array($role, ['user', 'assistant'], true)) continue;
        if (!is_string($content)) continue;
        $history[] = ['role' => $role, 'content' => substr($content, 0, 500)];
    }
}

// ── Fetch posts from WordPress ────────────────────────────────────────
try {
    $posts   = fetch_wp_posts($wp_url, $wp_user, $wp_pass, $wp_tag_ids, $wp_max_posts);
    $context = build_context($posts);
} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Could not load articles: ' . $e->getMessage()]);
    exit;
}

// ── Call OpenAI ───────────────────────────────────────────────────────
try {
    $reply = call_openai($openai_key, $openai_model, $context, $user_message, $history);
    echo json_encode(['success' => true, 'reply' => $reply]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}


// ═══════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch published posts from WordPress REST API.
 * Uses Basic Auth with an Application Password.
 */
function fetch_wp_posts(string $wp_url, string $username, string $app_password, string $tag_ids, int $max_posts): array {
    if (empty($wp_url)) throw new Exception('WP_URL not configured in .env');
    if (empty($username) || empty($app_password)) throw new Exception('WP_USERNAME / WP_APP_PASSWORD not configured in .env');

    // Build REST API URL
    $params = [
        'per_page' => min($max_posts, 100),
        'status'   => 'publish',
        '_fields'  => 'id,title,content,excerpt,link,tags',
        'orderby'  => 'date',
        'order'    => 'desc',
    ];

    // Filter by tag IDs if configured
    $tag_ids = trim($tag_ids);
    if (!empty($tag_ids)) {
        // Sanitize: keep only digits and commas
        $tag_ids = preg_replace('/[^0-9,]/', '', $tag_ids);
        if (!empty($tag_ids)) {
            $params['tags'] = $tag_ids;
        }
    }

    $endpoint = $wp_url . '/wp-json/wp/v2/posts?' . http_build_query($params);

    // Basic Auth: username + app password (spaces in app password are fine — WP strips them)
    $credentials = base64_encode($username . ':' . $app_password);

    $result = http_get($endpoint, [
        'Authorization: Basic ' . $credentials,
        'Accept: application/json',
    ]);

    if ($result['status'] === 401) throw new Exception('WordPress authentication failed — check WP_USERNAME and WP_APP_PASSWORD in .env');
    if ($result['status'] === 404) throw new Exception('WordPress REST API not found — check WP_URL in .env');
    if ($result['status'] !== 200) throw new Exception('WordPress API error: HTTP ' . $result['status']);

    $posts = json_decode($result['body'], true);
    if (!is_array($posts)) throw new Exception('Invalid response from WordPress API');
    if (empty($posts))     return [];

    // Normalise into {title, content, url}
    return array_map(function ($post) {
        $title   = html_entity_decode(strip_tags($post['title']['rendered'] ?? ''), ENT_QUOTES, 'UTF-8');
        // WP returns HTML content — strip to plain text
        $content = wp_strip_to_text($post['content']['rendered'] ?? '');
        $excerpt = wp_strip_to_text($post['excerpt']['rendered'] ?? '');
        $url     = $post['link'] ?? '';

        return [
            'title'   => $title,
            'content' => !empty($content) ? $content : $excerpt,
            'url'     => $url,
        ];
    }, $posts);
}

/**
 * Strip HTML to plain readable text, similar to WP's wp_strip_all_tags.
 */
function wp_strip_to_text(string $html): string {
    // Convert block-level elements to newlines before stripping
    $html = preg_replace('#<(br|p|h[1-6]|li|div|blockquote)[^>]*>#i', "\n", $html);
    $text = strip_tags($html);
    $text = html_entity_decode($text, ENT_QUOTES, 'UTF-8');
    $text = preg_replace('/[ \t]+/', ' ', $text);
    $text = preg_replace('/\n{3,}/', "\n\n", $text);
    return trim($text);
}

/**
 * Assemble posts into a structured context string for the AI prompt.
 */
function build_context(array $posts): string {
    if (empty($posts)) {
        return 'No travel articles are currently available.';
    }

    $max_chars_per_post = 2000;
    $ctx = "TRAVEL KNOWLEDGE BASE\n=====================\n\n";

    foreach ($posts as $i => $post) {
        $content = substr($post['content'], 0, $max_chars_per_post);
        if (strlen($post['content']) > $max_chars_per_post) {
            $content .= '… [content truncated]';
        }

        $ctx .= '[Article ' . ($i + 1) . ': ' . $post['title'] . "]\n";
        if (!empty($post['url'])) {
            $ctx .= 'URL: ' . $post['url'] . "\n";
        }
        $ctx .= 'Content: ' . $content . "\n\n";
    }

    return $ctx;
}

/**
 * Call OpenAI Chat Completions API.
 */
function call_openai(string $api_key, string $model, string $context, string $user_message, array $history = []): string {
    if (empty($api_key) || $api_key === 'sk-...') {
        throw new Exception('OPENAI_API_KEY not configured in .env');
    }

    $system_prompt = "אתה עוזר תיירות ידידותי של האתר. אתה עונה בעברית, בשפה חמה וטבעית.

כללים:
- ענה אך ורק על סמך המאמרים ב-TRAVEL KNOWLEDGE BASE למטה.
- כשמדובר בשאלה על יעד, אטרקציות, מוצרים או המלצות — השתמש ברשימה ממוספרת:
    1. **שם המקום/הפעילות** — הסבר קצר (1-2 משפטים).
    2. **שם המקום/הפעילות** — הסבר קצר.
    (עד 5 פריטים לכל היותר)
- לברכות, שאלות קצרות או הודעות שיחה — ענה בטבעיות בלי רשימה.
- חובה! בסוף כל תשובה (ללא יוצא מן הכלל) הוסף שורה חדשה עם קישור אחד בפורמט הזה בדיוק: [לפרטים נוספים ולהזמנה](URL)
    * השתמש ב-URL של עמוד ההזמנה אם מצוין במאמר.
    * אחרת השתמש ב-URL של המאמר הרלוונטי ביותר מה-KNOWLEDGE BASE.
    * לעולם אל תסיים תשובה בלי קישור.
- אם המבקר פונה בברכה — ענה בחביבות וספר בקצרה במה אתה יכול לעזור.
- אם אין תשובה במאמרים — אמור זאת בטבעיות והצע לעיין באתר.
- אל תענה על שאלות שאינן קשורות לתיירות.

$context";

    $messages = array_merge(
        [['role' => 'system', 'content' => $system_prompt]],
        $history,
        [['role' => 'user', 'content' => $user_message]]
    );

    $payload = json_encode([
        'model'      => $model,
        'max_tokens' => 1024,
        'messages'   => $messages,
    ]);

    $result = http_post('https://api.openai.com/v1/chat/completions', $payload, [
        'Authorization: Bearer ' . $api_key,
        'Content-Type: application/json',
    ]);

    $data = json_decode($result['body'], true);

    if ($result['status'] !== 200) {
        $msg = $data['error']['message'] ?? ('OpenAI API error ' . $result['status']);
        throw new Exception($msg);
    }

    return $data['choices'][0]['message']['content'] ?? '';
}


// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function load_env(string $path): array {
    $env = [];
    if (!file_exists($path)) return $env;

    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (!str_contains($line, '='))         continue;

        [$key, $val] = explode('=', $line, 2);
        $key = trim($key);
        $val = trim($val);

        // Strip inline comments
        if (($pos = strpos($val, ' #')) !== false) {
            $val = trim(substr($val, 0, $pos));
        }

        // Strip surrounding quotes
        if (strlen($val) >= 2 && $val[0] === '"' && $val[-1] === '"') {
            $val = substr($val, 1, -1);
        } elseif (strlen($val) >= 2 && $val[0] === "'" && $val[-1] === "'") {
            $val = substr($val, 1, -1);
        }

        $env[$key] = $val;
    }

    return $env;
}

function http_get(string $url, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new Exception('cURL error: ' . $err);
    return ['status' => $status, 'body' => $body];
}

function http_post(string $url, string $payload, array $headers): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new Exception('cURL error: ' . $err);
    return ['status' => $status, 'body' => $body];
}
