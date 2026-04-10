<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot_Context_Builder {

    // Max characters of content per post (keeps token count predictable)
    const CONTENT_LIMIT = 800;

    // Max total context characters sent to AI
    const TOTAL_LIMIT = 60_000;

    public static function build( array $posts ): string {
        if ( empty( $posts ) ) {
            return '';
        }

        $blocks = [];
        $total  = 0;

        foreach ( $posts as $i => $post ) {
            $title   = trim( $post['title'] ?? '' );
            $url     = trim( $post['url']   ?? '' );
            $content = trim( $post['content'] ?? $post['excerpt'] ?? '' );

            // Normalise whitespace
            $content = preg_replace( '/\s+/u', ' ', $content );
            $content = mb_substr( $content, 0, self::CONTENT_LIMIT );

            $block = sprintf(
                "[Article %d: %s]\nURL: %s\nContent: %s",
                $i + 1,
                $title,
                $url,
                $content
            );

            $len = mb_strlen( $block );
            if ( $total + $len > self::TOTAL_LIMIT ) {
                break;
            }

            $blocks[] = $block;
            $total   += $len;
        }

        return implode( "\n\n", $blocks );
    }

    // ── Extract location hints from post titles ───────────────────────────────
    // Returns unique Hebrew words that appear frequently in titles (potential destinations).

    public static function extract_location_hints( array $posts ): array {
        $stopwords = [
            'מדריך', 'טיול', 'טיסה', 'לטוס', 'מלון', 'אטרקציות', 'מסעדות', 'קניות',
            'אוכל', 'תרבות', 'מה', 'לראות', 'לעשות', 'לאן', 'איך', 'מתי', 'כמה',
            'הכי', 'שוות', 'שווה', 'ויזה', 'כניסה', 'עצות', 'טיפים', 'סיור', 'חוויה',
            'חופשה', 'חוף', 'ים', 'שמש', 'קיץ', 'חורף', 'חגים', 'פסח', 'סוכות',
        ];

        $freq = [];
        foreach ( $posts as $post ) {
            preg_match_all( '/[\x{05D0}-\x{05EA}]{3,}/u', $post['title'] ?? '', $m );
            foreach ( $m[0] as $word ) {
                if ( in_array( $word, $stopwords, true ) ) continue;
                $freq[ $word ] = ( $freq[ $word ] ?? 0 ) + 1;
            }
        }

        $threshold = max( 2, count( $posts ) * 0.15 );
        $hints     = array_keys( array_filter( $freq, fn( $c ) => $c >= $threshold ) );

        usort( $hints, fn( $a, $b ) => $freq[ $b ] <=> $freq[ $a ] );

        return array_slice( $hints, 0, 8 );
    }
}
