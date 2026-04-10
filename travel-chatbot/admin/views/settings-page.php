<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>
<div class="wrap">
  <h1><?php esc_html_e( 'Travel Chatbot Settings', 'travel-chatbot' ); ?></h1>

  <?php settings_errors( 'travel-chatbot' ); ?>

  <form method="post" action="options.php">
    <?php settings_fields( 'travel-chatbot' ); ?>

    <!-- ── AI Provider ─────────────────────────────────────────────────── -->
    <h2 class="title"><?php esc_html_e( 'AI Provider', 'travel-chatbot' ); ?></h2>
    <table class="form-table" role="presentation">
      <?php do_settings_fields( 'travel-chatbot', 'tc_ai' ); ?>
    </table>

    <!-- ── Knowledge Base ─────────────────────────────────────────────── -->
    <h2 class="title"><?php esc_html_e( 'Knowledge Base', 'travel-chatbot' ); ?></h2>
    <table class="form-table" role="presentation">
      <?php do_settings_fields( 'travel-chatbot', 'tc_kb' ); ?>
    </table>

    <!-- ── Site Identity ──────────────────────────────────────────────── -->
    <h2 class="title"><?php esc_html_e( 'Site Identity', 'travel-chatbot' ); ?></h2>
    <?php do_settings_sections_desc( 'travel-chatbot', 'tc_site' ); ?>
    <table class="form-table" role="presentation">
      <?php do_settings_fields( 'travel-chatbot', 'tc_site' ); ?>
    </table>

    <!-- ── Widget Appearance ───────────────────────────────────────────── -->
    <h2 class="title"><?php esc_html_e( 'Widget Appearance', 'travel-chatbot' ); ?></h2>
    <table class="form-table" role="presentation">
      <?php do_settings_fields( 'travel-chatbot', 'tc_appearance' ); ?>
    </table>

    <!-- ── Flights & Affiliate ─────────────────────────────────────────── -->
    <h2 class="title"><?php esc_html_e( 'Flights &amp; Affiliate', 'travel-chatbot' ); ?></h2>
    <p class="description" style="margin-bottom:12px"><?php esc_html_e( 'API keys and affiliate IDs are stored securely and never exposed to the browser.', 'travel-chatbot' ); ?></p>
    <table class="form-table" role="presentation">
      <?php do_settings_fields( 'travel-chatbot', 'tc_affiliate' ); ?>
    </table>

    <?php submit_button(); ?>
  </form>

  <!-- ── Usage summary ────────────────────────────────────────────────── -->
  <hr>
  <h2><?php esc_html_e( 'Usage', 'travel-chatbot' ); ?></h2>
  <p class="description"><?php esc_html_e( 'Token usage is tracked in memory per server process. Restart resets the counters.', 'travel-chatbot' ); ?></p>
  <table class="widefat striped" style="max-width:480px">
    <thead>
      <tr>
        <th><?php esc_html_e( 'Metric', 'travel-chatbot' ); ?></th>
        <th><?php esc_html_e( 'Value', 'travel-chatbot' ); ?></th>
      </tr>
    </thead>
    <tbody>
      <?php
      $stats = get_transient( 'travel_chatbot_usage_stats' );
      if ( ! $stats ) {
          $stats = [ 'requests' => 0, 'prompt_tokens' => 0, 'completion_tokens' => 0 ];
      }
      $total = $stats['prompt_tokens'] + $stats['completion_tokens'];
      // gpt-4o pricing approx: $2.50/1M input, $10/1M output
      $cost  = ( $stats['prompt_tokens'] / 1_000_000 * 2.50 ) + ( $stats['completion_tokens'] / 1_000_000 * 10 );
      ?>
      <tr><td><?php esc_html_e( 'AI Requests', 'travel-chatbot' ); ?></td><td><?php echo esc_html( number_format( $stats['requests'] ) ); ?></td></tr>
      <tr><td><?php esc_html_e( 'Input Tokens', 'travel-chatbot' ); ?></td><td><?php echo esc_html( number_format( $stats['prompt_tokens'] ) ); ?></td></tr>
      <tr><td><?php esc_html_e( 'Output Tokens', 'travel-chatbot' ); ?></td><td><?php echo esc_html( number_format( $stats['completion_tokens'] ) ); ?></td></tr>
      <tr><td><?php esc_html_e( 'Total Tokens', 'travel-chatbot' ); ?></td><td><?php echo esc_html( number_format( $total ) ); ?></td></tr>
      <tr><td><?php esc_html_e( 'Est. Cost (USD)', 'travel-chatbot' ); ?></td><td>$<?php echo esc_html( number_format( $cost, 4 ) ); ?></td></tr>
    </tbody>
  </table>
</div>

<?php
// Helper: renders a section description without do_settings_sections() calling the fields too
function do_settings_sections_desc( string $page, string $section_id ): void {
    global $wp_settings_sections;
    if ( isset( $wp_settings_sections[ $page ][ $section_id ]['callback'] ) ) {
        call_user_func( $wp_settings_sections[ $page ][ $section_id ]['callback'],
            $wp_settings_sections[ $page ][ $section_id ] );
    }
}
?>
