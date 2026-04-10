<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot_Ajax {

    // Rate limit: max requests per hour per IP
    const RATE_LIMIT = 30;

    // AI response cache TTL (seconds)
    const AI_CACHE_TTL = 3600;

    // ── Entry point ───────────────────────────────────────────────────────────

    public static function handle(): void {
        // 1. Verify nonce
        if ( ! check_ajax_referer( 'travel_chatbot_nonce', 'nonce', false ) ) {
            wp_send_json_error( [ 'message' => 'Invalid nonce' ], 403 );
        }

        // 2. Rate limit
        if ( ! self::check_rate_limit() ) {
            wp_send_json_error( [ 'message' => 'Too many requests. Please wait a moment.' ], 429 );
        }

        // 3. Validate input
        $user_message = sanitize_text_field( wp_unslash( $_POST['message'] ?? '' ) );
        if ( empty( $user_message ) ) {
            wp_send_json_error( [ 'message' => 'Empty message' ], 400 );
        }
        $user_message = mb_substr( $user_message, 0, 500 );

        // 4. Validate history
        $raw_history = $_POST['history'] ?? '[]';
        if ( is_string( $raw_history ) ) {
            $raw_history = json_decode( stripslashes( $raw_history ), true );
        }
        $history = self::validate_history( is_array( $raw_history ) ? $raw_history : [] );

        // 5. Fetch posts (WP transient cache)
        $posts         = self::get_cached_posts();
        $context       = Travel_Chatbot_Context_Builder::build( $posts );
        $location_hints = Travel_Chatbot_Context_Builder::extract_location_hints( $posts );

        // 6. Resolve site destination
        $site_dest = get_option( 'travel_chatbot_destination', '' );
        $site_iata = get_option( 'travel_chatbot_iata', '' );
        if ( empty( $site_dest ) ) {
            $site_dest = Travel_Chatbot_Post_Fetcher::detect_primary_destination();
        }

        // 7. Booking flow state machine (zero AI tokens for collection steps)
        $full_history = array_merge( $history, [ [ 'role' => 'user', 'content' => $user_message ] ] );
        $collected    = self::parse_collected_data( $full_history );

        if ( empty( $collected['destination'] ) && $site_dest ) {
            $collected['destination'] = $site_dest;
            $collected['iata']        = $site_iata;
        }

        $step = self::detect_flow_step( $user_message, $history );

        if ( 'content' !== $step ) {
            $flow_response = self::build_flow_response( $step, $collected, $location_hints );
            if ( $flow_response ) {
                wp_send_json_success( $flow_response );
            }
        }

        // 8. AI response cache
        $cache_key    = 'tc_ai_' . md5( $user_message . '::' . count( $history ) );
        $cached_reply = get_transient( $cache_key );
        if ( false !== $cached_reply ) {
            wp_send_json_success( $cached_reply );
        }

        // 9. Call AI
        $result = Travel_Chatbot_AI_Client::query( $user_message, $context, $history, $location_hints );

        // Resolve source URLs to { title, url } pairs
        $source_urls = $result['source_urls'] ?? [];
        $sources     = [];
        foreach ( $source_urls as $url ) {
            foreach ( $posts as $post ) {
                if ( rtrim( $post['url'], '/' ) === rtrim( $url, '/' ) ) {
                    $sources[] = [ 'title' => $post['title'], 'url' => $url ];
                    break;
                }
            }
            if ( count( $sources ) >= 5 ) break;
        }
        $result['sources'] = $sources;
        unset( $result['source_urls'] );

        // Cache only successful replies
        if ( empty( $result['_error'] ) ) {
            set_transient( $cache_key, $result, self::AI_CACHE_TTL );
        }

        wp_send_json_success( $result );
    }

    // ── Booking flow: detect step ─────────────────────────────────────────────

    private static function detect_flow_step( string $message, array $history ): string {
        $msg = $message;

        // "When to fly / best time / holiday deals" → auto-search next holiday (before isQuestion guard)
        if ( preg_match( '/מתי.*(לטוס|הזמן|כדאי|טוב)|הזמן.*(טוב|כדאי).*לטוס|(דיל|דילים).*(חג|פסח|סוכות|חנוכה|קיץ)|(חג|פסח|סוכות|חנוכה|קיץ).*(דיל|טיסה)|טיסות.*לחג/u', $msg ) ) {
            return 'flow_timing_auto';
        }

        // Informational questions (starting with מה/כמה/מתי/יש/האם/etc.) → skip flow, go to AI
        $is_question = (bool) preg_match( '/^(מה|כמה|מתי|יש|האם|למה|איפה|איזה)/u', trim( $msg ) );
        if ( ! $is_question && preg_match( '/טיסה|דיל|לטוס|flight|deal/iu', $msg ) ) {
            return 'flight_start';
        }
        if ( ! $is_question && preg_match( '/מלון|לינה|hotel|accommodation/iu', $msg ) ) {
            return 'hotel_start';
        }
        if ( ! $is_question && preg_match( '/אטרקצי|לראות|לעשות|attraction|things to do/iu', $msg ) ) {
            return 'attraction_start';
        }
        if ( preg_match( '/\d+\s*(מבוגר|adults?)/iu', $msg ) ) {
            return 'flow_travelers_answer';
        }
        // Month / date answer — fires whenever a month keyword is sent (dates now asked first)
        if ( preg_match( '/חודש הבא|בקיץ|בחורף|בפסח|בסוכות|בחגים|בחנוכה|גמיש|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|January|February|March|April|May|June|July|August|September|October|November|December/iu', $msg ) ) {
            return 'flow_dates_answer';
        }

        return 'content';
    }

    // ── Next upcoming holiday helper ──────────────────────────────────────────

    private static function get_next_holiday(): string {
        $m = (int) date( 'n' ); // 1-based month
        if ( $m <= 3 )  return 'בפסח';
        if ( $m <= 5 )  return 'בקיץ';
        if ( $m <= 8 )  return 'בסוכות';
        if ( $m <= 10 ) return 'בחנוכה';
        return 'בפסח'; // next year
    }

    // ── Booking flow: parse collected data ────────────────────────────────────

    private static function parse_collected_data( array $history ): array {
        $collected = [
            'destination' => '',
            'iata'        => '',
            'adults'      => 0,
            'children'    => 0,
            'month'       => '',
        ];

        // IATA lookup table
        $dest_to_iata = [
            'בחריין' => 'BAH', 'דובאי' => 'DXB', 'אבו דאבי' => 'AUH',
            'לונדון' => 'LHR', 'פריז'  => 'CDG', 'ברלין'    => 'BER',
            'רומא'   => 'FCO', 'ברצלונה' => 'BCN', 'אמסטרדם' => 'AMS',
            'פראג'   => 'PRG', 'וינה'  => 'VIE', 'ניו יורק'  => 'JFK',
            'בנגקוק' => 'BKK', 'טוקיו' => 'NRT', 'מאלדיביים' => 'MLE',
        ];

        $last_n = array_slice( $history, -10 );

        foreach ( $last_n as $item ) {
            $c = $item['content'];

            // Destination from user messages like "טיסה לבחריין" or "אני רוצה לטוס לדובאי"
            if ( 'user' === $item['role'] ) {
                if ( preg_match( '/(?:ל|אל)\s*([\x{05D0}-\x{05EA}\s]{2,10})/u', $c, $m ) ) {
                    $dest = trim( $m[1] );
                    if ( mb_strlen( $dest ) >= 3 && empty( $collected['destination'] ) ) {
                        $collected['destination'] = $dest;
                        $collected['iata']        = $dest_to_iata[ $dest ] ?? '';
                    }
                }
            }

            // Adults from "2 מבוגרים" or "3 adults"
            if ( preg_match( '/(\d+)\s*(?:מבוגר|adults?)/iu', $c, $m ) ) {
                $collected['adults'] = (int) $m[1];
            }

            // Children from "1 ילד" or "ללא ילדים"
            if ( preg_match( '/(\d+)\s*(?:ילד|children?)/iu', $c, $m ) ) {
                $collected['children'] = (int) $m[1];
            } elseif ( preg_match( '/ללא ילד|no children|0 ילד/iu', $c ) ) {
                $collected['children'] = 0;
            }

            // Month
            if ( preg_match( '/(חודש הבא|בקיץ|בחורף|בפסח|בסוכות|בחנוכה|גמיש|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/iu', $c, $m ) ) {
                $collected['month'] = $m[1];
            }
        }

        return $collected;
    }

    // ── Booking flow: build pre-made response ─────────────────────────────────

    private static function build_flow_response( string $step, array $c, array $location_hints ): ?array {
        $dest       = $c['destination'];
        $iata       = $c['iata'];
        $adults     = $c['adults'];
        $children   = $c['children'];
        $month      = $c['month'];

        switch ( $step ) {

            case 'flight_start':
                $dest_str = $dest ? "ל{$dest} " : '';
                return [
                    'reply'           => "בשמחה! מתי תרצו לטוס {$dest_str}? 📅",
                    'suggestions'     => [ 'חודש הבא', 'בקיץ', 'בפסח', 'בחגים', 'בחנוכה', 'גמיש' ],
                    'suggestion_type' => 'chips',
                ];

            case 'hotel_start':
                if ( $month && $adults ) {
                    $dest_str = $dest ?: 'היעד';
                    $booking_id = get_option( 'travel_chatbot_booking_id', '' );
                    $url = $booking_id
                        ? "https://www.booking.com/searchresults.html?ss=" . urlencode( $dest_str ) . "&aid={$booking_id}"
                        : "https://www.booking.com/searchresults.html?ss=" . urlencode( $dest_str );
                    return [
                        'reply'           => "מחפש מלונות ב{$dest_str} לחודש {$month} 🏨\n[לחיפוש מלונות בBooking.com]({$url})",
                        'suggestions'     => [ '✈️ חפש גם טיסה', '📍 מה לראות שם?' ],
                        'suggestion_type' => 'chips',
                    ];
                }
                return [
                    'reply'           => 'כדי לחפש מלון נצטרך קודם לדעת את התאריכים 😊\nרוצה שנחפש טיסה קודם?',
                    'suggestions'     => [ '✈️ כן, חפש טיסה', '🔍 חפש מלון בלבד' ],
                    'suggestion_type' => 'chips',
                ];

            case 'attraction_start':
                $dest_str = $dest ?: 'היעד';
                return [
                    'reply'           => "מה סוג האטרקציות שמעניינות אותך ב{$dest_str}? 🗺️",
                    'suggestions'     => [ '🤿 אקסטרים', '👨‍👩‍👧 משפחתי', '🏛️ תרבות', '🍽️ אוכל', '🌿 טבע', '🎉 לילה' ],
                    'suggestion_type' => 'chips',
                ];

            case 'flow_travelers_answer':
                // Deals already shown above — just acknowledge the passenger count
                $pax_str  = $adults . ' ' . ( $adults === 1 ? 'נוסע' : 'נוסעים' );
                $dest_str = $dest ?: 'היעד';
                return [
                    'reply'           => "מצוין! 🎉 הנה ההצעות שמצאנו ל{$pax_str}.\nלחץ על ״למצוא את ההצעה״ לפרטים נוספים.",
                    'suggestions'     => [ "🏨 חפש גם מלון", "📍 מה לראות ב{$dest_str}" ],
                    'suggestion_type' => 'chips',
                ];

            case 'flow_timing_auto': {
                $holiday = self::get_next_holiday();
                $result  = self::fetch_flight_deals( $dest, $iata, 1, 0, $holiday );
                $result['reply']          = "מצאתי את הדילים הכי טובים **{$holiday}** ✈️\n\n" . $result['reply'];
                $result['reply']         .= "\n\n_מחירים לנוסע 1 — כמה נוסעים יטוסו?_";
                $result['suggestions']    = [];
                $result['suggestion_type'] = 'traveler_picker';
                return $result;
            }

            case 'flow_dates_answer':
                $result = self::fetch_flight_deals( $dest, $iata, 1, 0, $month );
                if ( $adults === 0 ) {
                    // No travelers yet — append picker
                    $result['reply']          .= "\n\n_מחירים לנוסע 1 — כמה נוסעים יטוסו?_";
                    $result['suggestions']     = [];
                    $result['suggestion_type'] = 'traveler_picker';
                }
                return $result;
        }

        return null;
    }

    // ── SecretFlights API call ────────────────────────────────────────────────

    private static function fetch_flight_deals(
        string $dest, string $iata, int $adults, int $children, string $month
    ): array {
        $api_key  = get_option( 'travel_chatbot_secretflights_key', '' );
        $base_url = get_option( 'travel_chatbot_secretflights_url', 'https://api.secretflights.co.il/deals/v2' );
        $sky_id   = get_option( 'travel_chatbot_skyscanner_id', '' );

        $dest_str = $dest ?: 'היעד';

        if ( empty( $api_key ) || empty( $iata ) ) {
            // No API key or no IATA — show Skyscanner fallback link
            $sky_url = $sky_id
                ? "https://www.skyscanner.co.il/flights/tlv/{$iata}/?affiliateId={$sky_id}"
                : "https://www.skyscanner.co.il/flights/tlv/{$iata}/";
            return [
                'reply'           => "מחפש דילים ל{$dest_str} לתקופת {$month} ✈️\n[חיפוש טיסות בSkyscanner]({$sky_url})",
                'suggestions'     => [ "🏨 מלון ב{$dest_str}", "📍 מה לראות ב{$dest_str}" ],
                'suggestion_type' => 'chips',
            ];
        }

        $url      = rtrim( $base_url, '/' ) . "/{$iata}";
        $response = wp_remote_get( add_query_arg( [ 'apikey' => $api_key ], $url ), [
            'timeout' => 10,
            'headers' => [ 'Accept' => 'application/json' ],
        ] );

        if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) {
            $sky_url = "https://www.skyscanner.co.il/flights/tlv/{$iata}/";
            return [
                'reply'           => "לא מצאתי דילים כרגע, אבל תמיד אפשר לחפש ב-Skyscanner 🔍\n[חיפוש טיסות ל{$dest_str}]({$sky_url})",
                'suggestions'     => [ "🏨 מלון ב{$dest_str}", "📍 מה לראות ב{$dest_str}" ],
                'suggestion_type' => 'chips',
            ];
        }

        $raw   = json_decode( wp_remote_retrieve_body( $response ), true );
        // API may wrap in { deals: [...] } or { data: [...] }
        if ( isset( $raw['deals'] ) ) $raw = $raw['deals'];
        elseif ( isset( $raw['data'] ) ) $raw = $raw['data'];
        $raw = is_array( $raw ) ? array_slice( $raw, 0, 4 ) : [];

        if ( empty( $raw ) ) {
            $sky_url = "https://www.skyscanner.co.il/flights/tlv/{$iata}/";
            return [
                'reply'           => "לא נמצאו דילים פעילים ל{$dest_str} כרגע.\n[חפש טיסות בSkyscanner]({$sky_url})",
                'suggestions'     => [ "🏨 מלון ב{$dest_str}", "📍 מה לראות ב{$dest_str}" ],
                'suggestion_type' => 'chips',
            ];
        }

        $sf_key = get_option( 'travel_chatbot_secretflights_key', '' );
        $deals  = [];
        foreach ( $raw as $deal ) {
            $price    = (float) ( $deal['price'] ?? $deal['min_price'] ?? $deal['total_price'] ?? 0 );
            $out_date = $deal['outbound_date'] ?? $deal['departure_date'] ?? $deal['date_from'] ?? '';
            $ret_date = $deal['inbound_date']  ?? $deal['return_date']   ?? $deal['date_to']   ?? '';
            $deal_key = $deal['deal_key'] ?? $deal['key'] ?? '';
            $airline  = $deal['airline_name'] ?? $deal['airline'] ?? $deal['carrier'] ?? '';

            if ( $deal_key && $sf_key ) {
                $sf_url = add_query_arg( [
                    'origin'       => 'TLV',
                    'destination'  => $iata,
                    'cabinclass'   => 'economy',
                    'out_date'     => $out_date,
                    'in_date'      => $ret_date,
                    'price'        => (int) $price,
                    'deal_key'     => $deal_key,
                    'deal_airline' => $airline,
                    'direct'       => $deal['direct'] ? 'true' : 'false',
                    'associateid'  => $sf_key,
                ], 'https://fly.secretflights.co.il/redirect' );
            } else {
                $sf_url = $sky_id
                    ? "https://www.skyscanner.co.il/transport/flights/tlv/" . strtolower( $iata ) . "/?affiliateId={$sky_id}"
                    : "https://www.skyscanner.co.il/transport/flights/tlv/" . strtolower( $iata ) . "/";
            }

            $deals[] = [
                'city'    => $deal['destination_city'] ?? $deal['dest_name'] ?? $deal['destination_name'] ?? $dest_str,
                'iata'    => $iata,
                'price'   => (int) $price,
                'outDate' => $out_date,
                'retDate' => $ret_date,
                'direct'  => ! empty( $deal['direct'] ) || ! empty( $deal['non_stop'] ),
                'url'     => $sf_url,
            ];
        }

        return [
            'reply'           => "מצאתי " . count( $deals ) . " דילים על טיסות ל{$dest_str} ✈️",
            'deals'           => $deals,
            'suggestions'     => [ "🏨 חפש גם מלון", "📍 מה לראות ב{$dest_str}" ],
            'suggestion_type' => 'flight_cards',
        ];
    }

    // ── WP transient post cache ───────────────────────────────────────────────

    private static function get_cached_posts(): array {
        $cached = get_transient( 'travel_chatbot_posts_cache' );
        if ( false !== $cached ) {
            return $cached;
        }
        $posts = Travel_Chatbot_Post_Fetcher::fetch_posts();
        set_transient( 'travel_chatbot_posts_cache', $posts, 30 * MINUTE_IN_SECONDS );
        return $posts;
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────

    private static function check_rate_limit(): bool {
        $ip  = md5( $_SERVER['REMOTE_ADDR'] ?? 'unknown' );
        $key = 'tc_rl_' . $ip;
        $count = (int) get_transient( $key );

        if ( $count >= self::RATE_LIMIT ) {
            return false;
        }

        set_transient( $key, $count + 1, HOUR_IN_SECONDS );
        return true;
    }

    // ── History validation ────────────────────────────────────────────────────

    private static function validate_history( array $raw ): array {
        $valid = [];
        foreach ( array_slice( $raw, -6 ) as $item ) {
            if ( ! is_array( $item ) ) continue;
            $role    = $item['role']    ?? '';
            $content = $item['content'] ?? '';
            if ( ! in_array( $role, [ 'user', 'assistant' ], true ) ) continue;
            if ( ! is_string( $content ) ) continue;
            $valid[] = [
                'role'    => $role,
                'content' => mb_substr( sanitize_textarea_field( wp_unslash( $content ) ), 0, 500 ),
            ];
        }
        return $valid;
    }
}
