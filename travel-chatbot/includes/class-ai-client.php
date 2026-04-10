<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot_AI_Client {

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * @param string $user_message
     * @param string $context       WP posts context block
     * @param array  $history       [{role, content}, …] validated conversation history
     * @param array  $location_hints  Hebrew location keywords for chip instructions
     * @return array{ reply: string, suggestions: array, suggestion_type: string }
     */
    public static function query(
        string $user_message,
        string $context,
        array  $history       = [],
        array  $location_hints = []
    ): array {
        $provider = get_option( 'travel_chatbot_api_provider', 'openai' );

        if ( 'claude' === $provider ) {
            return self::call_claude( $user_message, $context, $history, $location_hints );
        }

        return self::call_openai( $user_message, $context, $history, $location_hints );
    }

    // ── OpenAI ────────────────────────────────────────────────────────────────

    private static function call_openai(
        string $user_message,
        string $context,
        array  $history,
        array  $location_hints
    ): array {
        $api_key = get_option( 'travel_chatbot_api_key', '' );
        $model   = get_option( 'travel_chatbot_model', 'gpt-4o' );

        $system_prompt = self::build_system_prompt( $context, $location_hints );

        $messages = [ [ 'role' => 'system', 'content' => $system_prompt ] ];
        foreach ( $history as $item ) {
            $messages[] = [ 'role' => $item['role'], 'content' => $item['content'] ];
        }
        $messages[] = [ 'role' => 'user', 'content' => $user_message ];

        $response = wp_remote_post( 'https://api.openai.com/v1/chat/completions', [
            'timeout' => 30,
            'headers' => [
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ],
            'body' => wp_json_encode( [
                'model'      => $model,
                'messages'   => $messages,
                'max_tokens' => 500,
                'temperature'=> 0.7,
            ] ),
        ] );

        if ( is_wp_error( $response ) ) {
            return self::error_reply( $response->get_error_message() );
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 || empty( $data['choices'][0]['message']['content'] ) ) {
            $msg = $data['error']['message'] ?? "HTTP $code";
            return self::error_reply( $msg );
        }

        $raw_reply = $data['choices'][0]['message']['content'];

        // Track usage in transient (additive, resets when transient expires)
        self::track_usage(
            $data['usage']['prompt_tokens']     ?? 0,
            $data['usage']['completion_tokens'] ?? 0
        );

        return self::parse_reply( $raw_reply );
    }

    // ── Claude ────────────────────────────────────────────────────────────────

    private static function call_claude(
        string $user_message,
        string $context,
        array  $history,
        array  $location_hints
    ): array {
        $api_key = get_option( 'travel_chatbot_api_key', '' );
        $model   = get_option( 'travel_chatbot_model', 'claude-sonnet-4-6' );

        $system_prompt = self::build_system_prompt( $context, $location_hints );

        $messages = [];
        foreach ( $history as $item ) {
            $messages[] = [ 'role' => $item['role'], 'content' => $item['content'] ];
        }
        $messages[] = [ 'role' => 'user', 'content' => $user_message ];

        $response = wp_remote_post( 'https://api.anthropic.com/v1/messages', [
            'timeout' => 30,
            'headers' => [
                'x-api-key'         => $api_key,
                'anthropic-version' => '2023-06-01',
                'Content-Type'      => 'application/json',
            ],
            'body' => wp_json_encode( [
                'model'      => $model,
                'system'     => $system_prompt,
                'messages'   => $messages,
                'max_tokens' => 500,
            ] ),
        ] );

        if ( is_wp_error( $response ) ) {
            return self::error_reply( $response->get_error_message() );
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 || empty( $data['content'][0]['text'] ) ) {
            $msg = $data['error']['message'] ?? "HTTP $code";
            return self::error_reply( $msg );
        }

        $raw_reply = $data['content'][0]['text'];

        self::track_usage(
            $data['usage']['input_tokens']  ?? 0,
            $data['usage']['output_tokens'] ?? 0
        );

        return self::parse_reply( $raw_reply );
    }

    // ── System prompt ─────────────────────────────────────────────────────────

    private static function build_system_prompt( string $context, array $location_hints ): string {
        $site_name   = get_option( 'travel_chatbot_site_name', get_bloginfo( 'name' ) );
        $destination = get_option( 'travel_chatbot_destination', '' );
        $loc_list    = ! empty( $location_hints ) ? implode( ', ', $location_hints ) : ( $destination ?: 'the knowledge base' );

        return <<<PROMPT
אתה עוזר תיירות של {$site_name}. ענה רק על סמך ה-KNOWLEDGE BASE למטה.

כללים חשובים:
- ענה רק על שאלות שיש להן תשובה ב-KNOWLEDGE BASE. אם אין — אמור בנעימות שאין לך מידע על כך.
- אל תענה על שאלות שאינן קשורות לתיירות.
- אל תערבב נושאים: שאלה על מלון → ענה על מלון בלבד. שאלה על טיסה → ענה על טיסה בלבד.
- אל תמציא מידע שאינו ב-KNOWLEDGE BASE.

שפה: ענה באותה שפה שבה הגולש כותב (עברית אם כותב עברית).

עיצוב:
- לשאלות על יעדים, אטרקציות, המלצות — רשימה ממוספרת (עד 5 פריטים):
  1. **שם** — הסבר קצר (1-2 משפטים).
- לברכות ושיחה — ענה בצורה טבעית ללא רשימה.
- בסוף תשובה המבוססת על מאמרים — הוסף תגית מקורות בשורה נפרדת:
  [SOURCES: https://url1.com | https://url2.com]
  (רק כתובות שמופיעות ב-KNOWLEDGE BASE, אל תמציא)

כפתורי המשך:
- אחרי תשובה על שאלת טיסה — חובה להוסיף: [CHIPS: ✈️ מצא לי טיסה עכשיו]
- אחרי תשובה על שאלת מלון — חובה להוסיף: [CHIPS: 🏨 מצא לי מלון עכשיו]
- אחרי תשובות אחרות — [CHIPS: אפשרות1 | אפשרות2] (אופציונלי, רלוונטי ל{$loc_list} בלבד)

TRAVEL KNOWLEDGE BASE:
{$context}
PROMPT;
    }

    // ── Parse [CHIPS:] tag out of raw reply ───────────────────────────────────

    private static function parse_reply( string $raw ): array {
        $suggestions     = [];
        $suggestion_type = 'chips';
        $source_urls     = [];

        // Extract [CHIPS: a | b | c] first so SOURCES can match at end regardless of order
        if ( preg_match( '/\[CHIPS:\s*([^\]]+)\]/i', $raw, $m ) ) {
            $raw         = str_replace( $m[0], '', $raw );
            $suggestions = array_map( 'trim', explode( '|', $m[1] ) );
            $suggestions = array_filter( $suggestions );
            $suggestions = array_values( $suggestions );
        }

        // Extract [SOURCES: url1 | url2 | ...]
        if ( preg_match( '/\[SOURCES:\s*([^\]]+)\]/i', $raw, $sm ) ) {
            $raw         = str_replace( $sm[0], '', $raw );
            $source_urls = array_values( array_filter(
                array_map( 'trim', explode( '|', $sm[1] ) ),
                fn( $u ) => str_starts_with( $u, 'http' )
            ) );
        }

        return [
            'reply'           => trim( $raw ),
            'suggestions'     => $suggestions,
            'suggestion_type' => $suggestion_type,
            'source_urls'     => $source_urls,
        ];
    }

    // ── Usage tracking ────────────────────────────────────────────────────────

    private static function track_usage( int $prompt, int $completion ): void {
        $stats = get_transient( 'travel_chatbot_usage_stats' ) ?: [
            'requests'          => 0,
            'prompt_tokens'     => 0,
            'completion_tokens' => 0,
        ];

        $stats['requests']          += 1;
        $stats['prompt_tokens']     += $prompt;
        $stats['completion_tokens'] += $completion;

        // Store for 30 days (persistent until reset or plugin deactivation)
        set_transient( 'travel_chatbot_usage_stats', $stats, 30 * DAY_IN_SECONDS );
    }

    // ── Error fallback ────────────────────────────────────────────────────────

    private static function error_reply( string $detail ): array {
        return [
            'reply'           => 'Sorry, I couldn\'t get a response right now. Please try again in a moment.',
            'suggestions'     => [],
            'suggestion_type' => 'chips',
            '_error'          => $detail,
        ];
    }
}
