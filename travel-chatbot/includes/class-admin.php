<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot_Admin {

    // ── Menu ──────────────────────────────────────────────────────────────────

    public static function register_menu(): void {
        add_options_page(
            __( 'Travel Chatbot Settings', 'travel-chatbot' ),
            __( 'Travel Chatbot', 'travel-chatbot' ),
            'manage_options',
            'travel-chatbot',
            [ __CLASS__, 'render_settings_page' ]
        );
    }

    // ── Settings API ──────────────────────────────────────────────────────────

    public static function register_settings(): void {

        // ── Section: AI Provider ──────────────────────────────────────────────
        add_settings_section( 'tc_ai', __( 'AI Provider', 'travel-chatbot' ), '__return_false', 'travel-chatbot' );

        self::field( 'travel_chatbot_api_provider', __( 'Provider', 'travel-chatbot' ),     'tc_ai', 'tc_render_provider' );
        self::field( 'travel_chatbot_api_key',      __( 'API Key', 'travel-chatbot' ),       'tc_ai', 'tc_render_api_key' );
        self::field( 'travel_chatbot_model',        __( 'Model', 'travel-chatbot' ),         'tc_ai', 'tc_render_model' );

        // ── Section: Knowledge Base ────────────────────────────────────────────
        add_settings_section( 'tc_kb', __( 'Knowledge Base', 'travel-chatbot' ), '__return_false', 'travel-chatbot' );

        self::field( 'travel_chatbot_tag_ids',   __( 'Post Tags', 'travel-chatbot' ),  'tc_kb', 'tc_render_tags' );
        self::field( 'travel_chatbot_max_posts', __( 'Max Posts', 'travel-chatbot' ),  'tc_kb', 'tc_render_max_posts' );

        // ── Section: Site Identity ────────────────────────────────────────────
        add_settings_section( 'tc_site', __( 'Site Identity', 'travel-chatbot' ), [ __CLASS__, 'render_site_section_desc' ], 'travel-chatbot' );

        self::field( 'travel_chatbot_site_name',   __( 'Site Name', 'travel-chatbot' ),       'tc_site', 'tc_render_site_name' );
        self::field( 'travel_chatbot_destination', __( 'Destination', 'travel-chatbot' ),     'tc_site', 'tc_render_destination' );
        self::field( 'travel_chatbot_iata',        __( 'Airport IATA Code', 'travel-chatbot' ), 'tc_site', 'tc_render_iata' );

        // ── Section: Appearance ───────────────────────────────────────────────
        add_settings_section( 'tc_appearance', __( 'Widget Appearance', 'travel-chatbot' ), '__return_false', 'travel-chatbot' );

        self::field( 'travel_chatbot_widget_title',    __( 'Widget Title', 'travel-chatbot' ),    'tc_appearance', 'tc_render_widget_title' );
        self::field( 'travel_chatbot_subtitle',        __( 'Subtitle', 'travel-chatbot' ),        'tc_appearance', 'tc_render_subtitle' );
        self::field( 'travel_chatbot_welcome_message', __( 'Welcome Message', 'travel-chatbot' ), 'tc_appearance', 'tc_render_welcome' );

        // ── Section: Affiliate & Flights ──────────────────────────────────────
        add_settings_section( 'tc_affiliate', __( 'Flights & Affiliate', 'travel-chatbot' ), [ __CLASS__, 'render_affiliate_section_desc' ], 'travel-chatbot' );

        self::field( 'travel_chatbot_secretflights_key', __( 'SecretFlights API Key', 'travel-chatbot' ), 'tc_affiliate', 'tc_render_sf_key' );
        self::field( 'travel_chatbot_secretflights_url', __( 'SecretFlights Base URL', 'travel-chatbot' ), 'tc_affiliate', 'tc_render_sf_url' );
        self::field( 'travel_chatbot_skyscanner_id',     __( 'Skyscanner Affiliate ID', 'travel-chatbot' ), 'tc_affiliate', 'tc_render_skyscanner' );
        self::field( 'travel_chatbot_booking_id',        __( 'Booking.com Affiliate ID', 'travel-chatbot' ), 'tc_affiliate', 'tc_render_booking' );

        // ── Register all options ───────────────────────────────────────────────
        $string_options = [
            'travel_chatbot_api_provider',
            'travel_chatbot_api_key',
            'travel_chatbot_model',
            'travel_chatbot_widget_title',
            'travel_chatbot_subtitle',
            'travel_chatbot_welcome_message',
            'travel_chatbot_site_name',
            'travel_chatbot_destination',
            'travel_chatbot_iata',
            'travel_chatbot_secretflights_key',
            'travel_chatbot_secretflights_url',
            'travel_chatbot_skyscanner_id',
            'travel_chatbot_booking_id',
        ];

        foreach ( $string_options as $opt ) {
            register_setting( 'travel-chatbot', $opt, [
                'sanitize_callback' => 'sanitize_text_field',
            ] );
        }

        register_setting( 'travel-chatbot', 'travel_chatbot_tag_ids', [
            'sanitize_callback' => fn( $v ) => array_map( 'absint', (array) $v ),
        ] );

        register_setting( 'travel-chatbot', 'travel_chatbot_max_posts', [
            'sanitize_callback' => fn( $v ) => max( 1, min( 200, absint( $v ) ) ),
        ] );
    }

    // ── Helper: register field ────────────────────────────────────────────────

    private static function field( string $id, string $label, string $section, string $callback ): void {
        add_settings_field( $id, $label, [ __CLASS__, $callback ], 'travel-chatbot', $section );
    }

    // ── Section descriptions ──────────────────────────────────────────────────

    public static function render_site_section_desc(): void {
        echo '<p class="description">' . esc_html__( 'Used to personalise quick-reply chips and booking flow. If left empty, the chatbot will try to auto-detect the destination from your posts.', 'travel-chatbot' ) . '</p>';
    }

    public static function render_affiliate_section_desc(): void {
        echo '<p class="description">' . esc_html__( 'API keys and affiliate IDs are never exposed to the browser.', 'travel-chatbot' ) . '</p>';
    }

    // ── Field renderers ───────────────────────────────────────────────────────

    public static function tc_render_provider(): void {
        $v = get_option( 'travel_chatbot_api_provider', 'openai' );
        ?>
        <select name="travel_chatbot_api_provider" id="tc_provider">
            <option value="openai"  <?php selected( $v, 'openai' ); ?>>OpenAI</option>
            <option value="claude"  <?php selected( $v, 'claude' ); ?>>Anthropic (Claude)</option>
        </select>
        <?php
    }

    public static function tc_render_api_key(): void {
        $v = get_option( 'travel_chatbot_api_key', '' );
        echo '<input type="password" name="travel_chatbot_api_key" value="' . esc_attr( $v ) . '" class="regular-text" autocomplete="off">';
        echo '<p class="description">' . esc_html__( 'Never exposed to the browser.', 'travel-chatbot' ) . '</p>';
    }

    public static function tc_render_model(): void {
        $v = get_option( 'travel_chatbot_model', 'gpt-4o' );
        ?>
        <input type="text" name="travel_chatbot_model" value="<?php echo esc_attr( $v ); ?>" class="regular-text"
               placeholder="gpt-4o / claude-sonnet-4-6">
        <p class="description"><?php esc_html_e( 'OpenAI: gpt-4o, gpt-4o-mini — Claude: claude-sonnet-4-6, claude-haiku-4-5-20251001', 'travel-chatbot' ); ?></p>
        <?php
    }

    public static function tc_render_tags(): void {
        $selected = (array) get_option( 'travel_chatbot_tag_ids', [] );
        $tags     = get_tags( [ 'hide_empty' => false, 'orderby' => 'name' ] );

        if ( empty( $tags ) ) {
            echo '<p class="description">' . esc_html__( 'No tags found. Create tags and assign them to your travel posts.', 'travel-chatbot' ) . '</p>';
            return;
        }

        echo '<fieldset style="max-height:200px;overflow-y:auto;border:1px solid #ddd;padding:8px 12px;border-radius:4px">';
        foreach ( $tags as $tag ) {
            $checked = in_array( $tag->term_id, $selected, true ) ? 'checked' : '';
            printf(
                '<label style="display:block;margin-bottom:4px"><input type="checkbox" name="travel_chatbot_tag_ids[]" value="%d" %s> %s <small style="color:#888">(%d)</small></label>',
                $tag->term_id,
                $checked,
                esc_html( $tag->name ),
                $tag->count
            );
        }
        echo '</fieldset>';
        echo '<p class="description">' . esc_html__( 'Only posts with these tags will be included in the AI knowledge base. Leave all unchecked to include all posts.', 'travel-chatbot' ) . '</p>';
    }

    public static function tc_render_max_posts(): void {
        $v = absint( get_option( 'travel_chatbot_max_posts', 50 ) );
        echo '<input type="number" name="travel_chatbot_max_posts" value="' . esc_attr( $v ) . '" min="1" max="200" style="width:80px">';
        echo '<p class="description">' . esc_html__( 'More posts = richer answers but higher AI cost per query.', 'travel-chatbot' ) . '</p>';
    }

    public static function tc_render_site_name(): void {
        $v = get_option( 'travel_chatbot_site_name', get_bloginfo( 'name' ) );
        echo '<input type="text" name="travel_chatbot_site_name" value="' . esc_attr( $v ) . '" class="regular-text">';
    }

    public static function tc_render_destination(): void {
        $v = get_option( 'travel_chatbot_destination', '' );
        echo '<input type="text" name="travel_chatbot_destination" value="' . esc_attr( $v ) . '" class="regular-text" placeholder="' . esc_attr__( 'e.g. Bahrain, Dubai, Paris', 'travel-chatbot' ) . '">';
        echo '<p class="description">' . esc_html__( 'Primary destination shown in quick-reply chips. Auto-detected from posts if left empty.', 'travel-chatbot' ) . '</p>';
    }

    public static function tc_render_iata(): void {
        $v = get_option( 'travel_chatbot_iata', '' );
        echo '<input type="text" name="travel_chatbot_iata" value="' . esc_attr( $v ) . '" style="width:80px;text-transform:uppercase" maxlength="3" placeholder="BAH">';
        echo '<p class="description">' . esc_html__( '3-letter IATA airport code for flight searches.', 'travel-chatbot' ) . '</p>';
    }

    public static function tc_render_widget_title(): void {
        $v = get_option( 'travel_chatbot_widget_title', 'Travel Assistant' );
        echo '<input type="text" name="travel_chatbot_widget_title" value="' . esc_attr( $v ) . '" class="regular-text">';
    }

    public static function tc_render_subtitle(): void {
        $v = get_option( 'travel_chatbot_subtitle', 'Ask me about our travel guides' );
        echo '<input type="text" name="travel_chatbot_subtitle" value="' . esc_attr( $v ) . '" class="regular-text">';
    }

    public static function tc_render_welcome(): void {
        $v = get_option( 'travel_chatbot_welcome_message', "Hi! I'm your travel guide." );
        echo '<textarea name="travel_chatbot_welcome_message" rows="3" class="large-text">' . esc_textarea( $v ) . '</textarea>';
    }

    public static function tc_render_sf_key(): void {
        $v = get_option( 'travel_chatbot_secretflights_key', '' );
        echo '<input type="password" name="travel_chatbot_secretflights_key" value="' . esc_attr( $v ) . '" class="regular-text" autocomplete="off">';
    }

    public static function tc_render_sf_url(): void {
        $v = get_option( 'travel_chatbot_secretflights_url', 'https://api.secretflights.co.il/deals/v2' );
        echo '<input type="url" name="travel_chatbot_secretflights_url" value="' . esc_attr( $v ) . '" class="regular-text">';
    }

    public static function tc_render_skyscanner(): void {
        $v = get_option( 'travel_chatbot_skyscanner_id', '' );
        echo '<input type="text" name="travel_chatbot_skyscanner_id" value="' . esc_attr( $v ) . '" class="regular-text" placeholder="AFF_TRA_xxxxx_00001">';
    }

    public static function tc_render_booking(): void {
        $v = get_option( 'travel_chatbot_booking_id', '' );
        echo '<input type="text" name="travel_chatbot_booking_id" value="' . esc_attr( $v ) . '" class="regular-text" placeholder="2044661">';
    }

    // ── Page render ───────────────────────────────────────────────────────────

    public static function render_settings_page(): void {
        if ( ! current_user_can( 'manage_options' ) ) return;
        require TRAVEL_CHATBOT_PLUGIN_DIR . 'admin/views/settings-page.php';
    }
}
