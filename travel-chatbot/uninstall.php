<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) exit;

// ── Delete all plugin options ─────────────────────────────────────────────────
$options = [
    'travel_chatbot_api_provider',
    'travel_chatbot_api_key',
    'travel_chatbot_model',
    'travel_chatbot_tag_ids',
    'travel_chatbot_max_posts',
    'travel_chatbot_widget_title',
    'travel_chatbot_subtitle',
    'travel_chatbot_welcome_message',
    'travel_chatbot_site_name',
    'travel_chatbot_destination',
    'travel_chatbot_iata',
    'travel_chatbot_skyscanner_id',
    'travel_chatbot_booking_id',
    'travel_chatbot_secretflights_key',
    'travel_chatbot_secretflights_url',
];

foreach ( $options as $opt ) {
    delete_option( $opt );
}

// ── Delete transients ─────────────────────────────────────────────────────────
delete_transient( 'travel_chatbot_usage_stats' );
delete_transient( 'travel_chatbot_posts_cache' );
delete_transient( 'tc_auto_destination' );

// Clean up any AI cache transients (prefixed tc_ai_)
global $wpdb;
$wpdb->query(
    "DELETE FROM {$wpdb->options}
     WHERE option_name LIKE '_transient_tc_ai_%'
        OR option_name LIKE '_transient_timeout_tc_ai_%'
        OR option_name LIKE '_transient_tc_rl_%'
        OR option_name LIKE '_transient_timeout_tc_rl_%'"
);
