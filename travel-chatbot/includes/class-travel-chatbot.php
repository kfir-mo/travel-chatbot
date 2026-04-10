<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class Travel_Chatbot {

    private static ?Travel_Chatbot $instance = null;

    public static function get_instance(): Travel_Chatbot {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Admin
        if ( is_admin() ) {
            add_action( 'admin_menu', [ Travel_Chatbot_Admin::class, 'register_menu' ] );
            add_action( 'admin_init', [ Travel_Chatbot_Admin::class, 'register_settings' ] );
        }

        // Frontend
        add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        add_action( 'wp_footer',          [ $this, 'render_widget_scaffold' ], 100 );

        // AJAX — both logged-in and guest
        add_action( 'wp_ajax_travel_chatbot_query',        [ Travel_Chatbot_Ajax::class, 'handle' ] );
        add_action( 'wp_ajax_nopriv_travel_chatbot_query', [ Travel_Chatbot_Ajax::class, 'handle' ] );

        // Config endpoint (lightweight, no nonce needed — public data only)
        add_action( 'wp_ajax_travel_chatbot_config',        [ $this, 'handle_config' ] );
        add_action( 'wp_ajax_nopriv_travel_chatbot_config', [ $this, 'handle_config' ] );
    }

    // ── Frontend assets ───────────────────────────────────────────────────────

    public function enqueue_assets(): void {
        wp_enqueue_style(
            'travel-chatbot-widget',
            TRAVEL_CHATBOT_PLUGIN_URL . 'public/css/chat-widget.css',
            [],
            TRAVEL_CHATBOT_VERSION
        );

        wp_enqueue_script(
            'travel-chatbot-widget',
            TRAVEL_CHATBOT_PLUGIN_URL . 'public/js/chat-widget.js',
            [],
            TRAVEL_CHATBOT_VERSION,
            true  // footer
        );

        // Pass runtime config to JS (no secrets)
        wp_localize_script( 'travel-chatbot-widget', 'TravelChatbotConfig', [
            'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
            'nonce'          => wp_create_nonce( 'travel_chatbot_nonce' ),
            'title'          => esc_html( get_option( 'travel_chatbot_widget_title', 'Travel Assistant' ) ),
            'subtitle'       => esc_html( get_option( 'travel_chatbot_subtitle', 'Ask me about our travel guides' ) ),
            'welcomeMessage' => esc_html( get_option( 'travel_chatbot_welcome_message', "Hi! I'm your travel guide." ) ),
            'quickReplies'   => [],  // populated via /config AJAX before widget mounts
        ] );
    }

    // ── Widget scaffold (minimal HTML) ────────────────────────────────────────

    public function render_widget_scaffold(): void {
        // The JS creates all DOM dynamically; we just need a container for WAI-ARIA
        echo '<div id="tc-root" aria-live="polite"></div>' . "\n";
    }

    // ── Public config endpoint ────────────────────────────────────────────────

    public function handle_config(): void {
        $destination = get_option( 'travel_chatbot_destination', '' );

        // Auto-detect if not set
        if ( empty( $destination ) ) {
            $destination = Travel_Chatbot_Post_Fetcher::detect_primary_destination();
        }

        $iata      = get_option( 'travel_chatbot_iata', '' );
        $site_name = get_option( 'travel_chatbot_site_name', get_bloginfo( 'name' ) );

        $quick_replies = [];
        if ( $destination ) {
            $quick_replies = [
                [ 'label' => '✈️ ' . sprintf( __( 'Flight to %s', 'travel-chatbot' ), $destination ),
                  'message' => sprintf( __( 'I\'m looking for a flight to %s', 'travel-chatbot' ), $destination ) ],
                [ 'label' => '🏨 ' . sprintf( __( 'Hotel in %s', 'travel-chatbot' ), $destination ),
                  'message' => sprintf( __( 'I\'m looking for a hotel in %s', 'travel-chatbot' ), $destination ) ],
                [ 'label' => '📍 ' . __( 'Attractions', 'travel-chatbot' ),
                  'message' => sprintf( __( 'What\'s recommended to see in %s?', 'travel-chatbot' ), $destination ) ],
            ];
        } else {
            $quick_replies = [
                [ 'label' => '✈️ ' . __( 'Find a Flight', 'travel-chatbot' ),
                  'message' => __( 'I\'m looking for a flight', 'travel-chatbot' ) ],
                [ 'label' => '🏨 ' . __( 'Find a Hotel', 'travel-chatbot' ),
                  'message' => __( 'I\'m looking for a hotel', 'travel-chatbot' ) ],
                [ 'label' => '📍 ' . __( 'Attractions', 'travel-chatbot' ),
                  'message' => __( 'What attractions do you recommend?', 'travel-chatbot' ) ],
            ];
        }

        wp_send_json( [
            'siteName'    => $site_name,
            'destination' => $destination,
            'iata'        => $iata,
            'quickReplies' => $quick_replies,
        ] );
    }
}
