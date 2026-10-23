# optical_par のピン割り当て(前期資料 図9 より)
# 使い方: プロジェクトを開いた状態で [View] → [Utility Windows] → [Tcl Console] を開き、
#         source c:/intelFPGA_lite/D3/optical_par/pins_par.tcl  のように実行する

set_location_assignment PIN_P22  -to clk
set_location_assignment PIN_AB13 -to resetn
set_location_assignment PIN_AB12 -to sw_in

# D1 : クロック
set_location_assignment PIN_AF21 -to {led_d1[0]}
set_location_assignment PIN_AJ20 -to {led_d1[1]}
set_location_assignment PIN_AG22 -to {led_d1[2]}
set_location_assignment PIN_AK20 -to {led_d1[3]}

# D2 : ビット7
set_location_assignment PIN_AF20 -to {led_d2[0]}
set_location_assignment PIN_AJ19 -to {led_d2[1]}
set_location_assignment PIN_AG21 -to {led_d2[2]}
set_location_assignment PIN_AK18 -to {led_d2[3]}

# D3 : ビット6
set_location_assignment PIN_AF18 -to {led_d3[0]}
set_location_assignment PIN_AJ17 -to {led_d3[1]}
set_location_assignment PIN_AF19 -to {led_d3[2]}
set_location_assignment PIN_AJ18 -to {led_d3[3]}

# D4 : ビット5
set_location_assignment PIN_AG18 -to {led_d4[0]}
set_location_assignment PIN_AG24 -to {led_d4[1]}
set_location_assignment PIN_AG19 -to {led_d4[2]}
set_location_assignment PIN_AH25 -to {led_d4[3]}

# D5 : ビット4
set_location_assignment PIN_AK16 -to {led_d5[0]}
set_location_assignment PIN_AH19 -to {led_d5[1]}
set_location_assignment PIN_AK17 -to {led_d5[2]}
set_location_assignment PIN_AH20 -to {led_d5[3]}

# D6 : ビット3
set_location_assignment PIN_AF16 -to {led_d6[0]}
set_location_assignment PIN_AG17 -to {led_d6[1]}
set_location_assignment PIN_AG16 -to {led_d6[2]}
set_location_assignment PIN_AH17 -to {led_d6[3]}

# D7 : ビット2
set_location_assignment PIN_AE16 -to {led_d7[0]}
set_location_assignment PIN_AJ15 -to {led_d7[1]}
set_location_assignment PIN_AF15 -to {led_d7[2]}
set_location_assignment PIN_AK15 -to {led_d7[3]}

# D8 : ビット1
set_location_assignment PIN_AD17 -to {led_d8[0]}
set_location_assignment PIN_AH14 -to {led_d8[1]}
set_location_assignment PIN_AE17 -to {led_d8[2]}
set_location_assignment PIN_AH15 -to {led_d8[3]}

# D9 : ビット0
set_location_assignment PIN_AD18 -to {led_d9[0]}
set_location_assignment PIN_AE15 -to {led_d9[1]}
set_location_assignment PIN_AE18 -to {led_d9[2]}
set_location_assignment PIN_AF14 -to {led_d9[3]}

# D10 : パリティ
set_location_assignment PIN_Y15 -to {led_d10[0]}
set_location_assignment PIN_AG23 -to {led_d10[1]}
set_location_assignment PIN_AA15 -to {led_d10[2]}
set_location_assignment PIN_AH22 -to {led_d10[3]}

# 基板の緑LED0〜3 : 速度表示
set_location_assignment PIN_AK3 -to {led_rate[0]}
set_location_assignment PIN_AJ4 -to {led_rate[1]}
set_location_assignment PIN_AJ5 -to {led_rate[2]}
set_location_assignment PIN_AK6 -to {led_rate[3]}
