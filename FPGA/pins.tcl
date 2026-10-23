# optical_tx のピン割り当て
# 使い方: プロジェクトを開いた状態で [Tools] → [Tcl Scripts...] からこのファイルを実行
#         (または、プロジェクトを閉じて optical_tx.qsf の末尾にこの行をそのまま貼り付けてもよい)

# クロックとボタン
set_location_assignment PIN_P22  -to clk
set_location_assignment PIN_AB13 -to resetn
set_location_assignment PIN_AB12 -to sw_in

# 拡張ボード D1 : クロックLED
set_location_assignment PIN_AF21 -to {led_clk_out[0]}
set_location_assignment PIN_AJ20 -to {led_clk_out[1]}
set_location_assignment PIN_AG22 -to {led_clk_out[2]}
set_location_assignment PIN_AK20 -to {led_clk_out[3]}

# 拡張ボード D3 : データLED
set_location_assignment PIN_AF18 -to {led_data_out[0]}
set_location_assignment PIN_AJ17 -to {led_data_out[1]}
set_location_assignment PIN_AF19 -to {led_data_out[2]}
set_location_assignment PIN_AJ18 -to {led_data_out[3]}

# 基板の緑LED0〜3 : 速度表示
set_location_assignment PIN_AK3 -to {led_rate[0]}
set_location_assignment PIN_AJ4 -to {led_rate[1]}
set_location_assignment PIN_AJ5 -to {led_rate[2]}
set_location_assignment PIN_AK6 -to {led_rate[3]}
