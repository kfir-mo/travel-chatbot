<?php
/**
 * Plugin Name:  Travel Chatbot
 * Plugin URI:   https://github.com/your-repo/travel-chatbot
 * Description:  AI-powered floating chat widget that answers travel questions from your posts, with guided booking flow for flights and hotels.
 * Version:      1.0.0
 * Author:       Travel Chatbot
 * License:      GPL-2.0-or-later
 * Text Domain:  travel-chatbot
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'TRAVEL_CHATBOT_VERSION',    '1.0.0' );
define( 'TRAVEL_CHATBOT_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'TRAVEL_CHATBOT_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// ── Autoload includes ─────────────────────────────────────────────────────────
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-travel-chatbot.php';
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-admin.php';
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-ajax-handler.php';
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-ai-client.php';
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-post-fetcher.php';
require_once TRAVEL_CHATBOT_PLUGIN_DIR . 'includes/class-context-builder.php';

// ── Activation / deactivation ─────────────────────────────────────────────────
register_activation_hook( __FILE__, 'travel_chatbot_activate' );

function travel_chatbot_activate() {
    $defaults = [
        'travel_chatbot_api_provider'    => 'openai',
        'travel_chatbot_api_key'         => '',
        'travel_chatbot_model'           => 'gpt-4o',
        'travel_chatbot_tag_ids'         => [],
        'travel_chatbot_max_posts'       => 50,
        'travel_chatbot_widget_title'    => 'Travel Assistant',
        'travel_chatbot_subtitle'        => 'Ask me about our travel guides',
        'travel_chatbot_welcome_message' => "Hi! I'm your travel guide. Ask me anything about our destinations, tips, and travel articles.",
        'travel_chatbot_site_name'       => get_bloginfo( 'name' ),
        'travel_chatbot_destination'     => '',
        'travel_chatbot_iata'            => '',
        'travel_chatbot_skyscanner_id'   => '',
        'travel_chatbot_booking_id'      => '',
        'travel_chatbot_secretflights_key' => '',
        'travel_chatbot_secretflights_url' => 'https://api.secretflights.co.il/deals/v2',
    ];

    foreach ( $defaults as $key => $value ) {
        if ( false === get_option( $key ) ) {
            add_option( $key, $value, '', 'no' );
        }
    }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
add_action( 'plugins_loaded', function () {
    Travel_Chatbot::get_instance();
} );
