# 50MHz のクロック(周期 20ns)を Quartus のタイミング解析に教える
create_clock -name clk -period 20.000 [get_ports clk]
