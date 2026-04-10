<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot_Post_Fetcher {

    // ── Fetch posts for AI context ─────────────────────────────────────────────

    public static function fetch_posts(): array {
        $tag_ids   = array_map( 'absint', (array) get_option( 'travel_chatbot_tag_ids', [] ) );
        $max_posts = max( 1, min( 200, absint( get_option( 'travel_chatbot_max_posts', 50 ) ) ) );

        $args = [
            'post_type'      => 'post',
            'post_status'    => 'publish',
            'posts_per_page' => $max_posts,
            'no_found_rows'  => true,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ];

        if ( ! empty( $tag_ids ) ) {
            $args['tag__in'] = $tag_ids;
        }

        $query = new WP_Query( $args );
        $posts = [];

        foreach ( $query->posts as $post ) {
            $posts[] = [
                'title'   => get_the_title( $post ),
                'content' => wp_strip_all_tags( get_post_field( 'post_content', $post ) ),
                'excerpt' => get_the_excerpt( $post ),
                'url'     => get_permalink( $post ),
            ];
        }

        wp_reset_postdata();
        return $posts;
    }

    // ── Auto-detect primary destination ───────────────────────────────────────
    // Scans post titles for Hebrew location names by frequency.

    public static function detect_primary_destination(): string {
        $cached = get_transient( 'tc_auto_destination' );
        if ( false !== $cached ) {
            return $cached;
        }

        $posts = self::fetch_posts();
        $destination = self::extract_top_location( $posts );

        set_transient( 'tc_auto_destination', $destination, 30 * MINUTE_IN_SECONDS );
        return $destination;
    }

    private static function extract_top_location( array $posts ): string {
        // Stopwords that appear in titles but are NOT destinations
        $stopwords = [
            'מדריך', 'טיול', 'טיסה', 'לטוס', 'מלון', 'אטרקציות', 'מסעדות', 'קניות',
            'אוכל', 'תרבות', 'מה', 'לראות', 'לעשות', 'לאן', 'איך', 'מתי', 'כמה',
            'הכי', 'שוות', 'שווה', 'ויזה', 'כניסה', 'עצות', 'טיפים', 'סיור', 'חוויה',
            'חופשה', 'חוף', 'ים', 'שמש', 'קיץ', 'חורף', 'חגים', 'פסח', 'סוכות',
            'תל', 'אביב', // avoid Tel Aviv from Israeli travel blogs
        ];

        $freq = [];

        foreach ( $posts as $post ) {
            // Tokenise Hebrew words (2+ chars) from title
            preg_match_all( '/[\x{05D0}-\x{05EA}]{2,}/u', $post['title'], $m );
            foreach ( $m[0] as $word ) {
                if ( mb_strlen( $word ) < 3 ) continue;
                if ( in_array( $word, $stopwords, true ) ) continue;
                $freq[ $word ] = ( $freq[ $word ] ?? 0 ) + 1;
            }
        }

        // Filter: must appear in ≥ 20% of posts
        $threshold = max( 2, count( $posts ) * 0.2 );
        $candidates = array_filter( $freq, fn( $c ) => $c >= $threshold );

        if ( empty( $candidates ) ) {
            return '';
        }

        arsort( $candidates );
        return (string) array_key_first( $candidates );
    }
}
