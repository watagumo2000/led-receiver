-- ============================================================
-- optical_tx : LED光通信 送信回路(動作確認用の最小構成)
--
--  拡張ボードの2個のLEDを使ってデータを送る。
--    D1 : クロックLED  … 1ビットごとに点灯/消灯が切り替わる
--    D3 : データLED    … 点灯='1'、消灯='0'
--  データLEDは「ビットの始まり」で変化し、クロックLEDは
--  「ビットの真ん中」で切り替わる。受信側はクロックLEDが
--  切り替わった瞬間のデータLEDを読めば、送信速度を知らなくても
--  1ビットずつ取り出せる。
--
--  送るフレーム(先頭から順に、各バイトは上位ビットから送る)
--    [0x7E] [文字数] [文字1] ... [文字N] [チェックサム]
--    チェックサム = 文字数 XOR 文字1 XOR ... XOR 文字N
--  同じフレームを繰り返し送り続ける。
--
--  ボタン
--    PB0 : 送信速度を切り替え (5 → 10 → 15 → 20 bps → 5 ...)
--    PB1 : リセット(押している間リセット、5bpsに戻る)
--  基板の緑LED0〜3 : 現在の速度を表示(LED0=5bps ... LED3=20bps)
-- ============================================================
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity optical_tx is
  generic (
    -- 送信する文字列(ASCIIの英数字・記号。'~' は使わないこと)
    MSG : string := "HI FPGA");

  port (
    clk          : in  std_logic;                      -- 50MHz
    resetn       : in  std_logic;                      -- PB1(押すと'0')
    sw_in        : in  std_logic;                      -- PB0(押すと'0')
    led_clk_out  : out std_logic_vector(3 downto 0);   -- 拡張ボード D1
    led_data_out : out std_logic_vector(3 downto 0);   -- 拡張ボード D3
    led_rate     : out std_logic_vector(3 downto 0));  -- 基板の緑LED0〜3

end optical_tx;

architecture rtl of optical_tx is

  -- ----------------------------------------------------------
  -- 送信フレームをコンパイル時に組み立てる
  -- ----------------------------------------------------------
  type byte_array is array (natural range <>) of std_logic_vector(7 downto 0);

  function make_frame (s : string) return byte_array is
    variable f   : byte_array(0 to s'length + 2);
    variable sum : std_logic_vector(7 downto 0);
  begin
    f(0) := x"7E";                                        -- 先頭の目印
    f(1) := std_logic_vector(to_unsigned(s'length, 8));   -- 文字数
    sum  := f(1);
    for i in 0 to s'length - 1 loop
      f(i + 2) := std_logic_vector(to_unsigned(character'pos(s(s'low + i)), 8));
      sum      := sum xor f(i + 2);
    end loop;
    f(s'length + 2) := sum;                               -- チェックサム
    return f;
  end function;

  constant FRAME     : byte_array := make_frame(MSG);
  constant FRAME_LEN : integer    := MSG'length + 3;

  -- ----------------------------------------------------------
  -- 拡張ボードの2色LED(sample08と同じ4本ピン方式)
  --   [0]=H,[1]=L で赤が点灯 / [2]=H,[3]=L で緑が点灯(実機で確認済み)
  --   赤と緑を両方点けたオレンジが一番明るく、カメラで読みやすい
  -- ----------------------------------------------------------
  constant LED_ON  : std_logic_vector(3 downto 0) := "0101";  -- オレンジ
  constant LED_OFF : std_logic_vector(3 downto 0) := "0000";  -- 消灯

  -- ----------------------------------------------------------
  -- 速度設定:半ビットぶんのクロック数(50MHz / (2 × bps))
  -- ----------------------------------------------------------
  type int_array is array (0 to 3) of integer;
  constant HALF_BIT : int_array := (5_000_000,   --  5 bps
                                    2_500_000,   -- 10 bps
                                    1_666_667,   -- 15 bps
                                    1_250_000);  -- 20 bps

  signal rate_sel : integer range 0 to 3 := 0;

  -- チャタリング除去(約5.2msごとにボタンを読む)
  signal deb_counter : unsigned(17 downto 0) := (others => '0');
  signal sw_node     : std_logic := '1';
  signal sw_prev     : std_logic := '1';

  -- 送信用
  signal tick_cnt : integer range 0 to 5_000_000 := 0;
  signal phase    : std_logic := '0';   -- '0':ビット前半 '1':ビット後半
  signal byte_idx : integer range 0 to FRAME_LEN - 1 := 0;
  signal bit_idx  : integer range 0 to 7 := 7;      -- 今のバイトの残りビット数-1
  signal sreg     : std_logic_vector(7 downto 0) := FRAME(0);  -- 送信中のバイト
  signal clk_bit  : std_logic := '0';

begin

  -- ----------------------------------------------------------
  -- ボタン入力:チャタリング除去 + 押した瞬間の検出
  --   前期サンプルは分周したクロックで読んでいたが、ここでは
  --   50MHzのクロック1本のまま「読むタイミング」だけを間引く
  --   (クロックイネーブル方式)。
  -- ----------------------------------------------------------
  process (clk, resetn)
  begin
    if resetn = '0' then
      deb_counter <= (others => '0');
      sw_node     <= '1';
      sw_prev     <= '1';
      rate_sel    <= 0;
    elsif clk'event and clk = '1' then
      deb_counter <= deb_counter + 1;
      if deb_counter = 0 then           -- 約5.2msに1回だけ読む
        sw_node <= sw_in;
      end if;

      sw_prev <= sw_node;
      if sw_prev = '1' and sw_node = '0' then   -- 押された瞬間
        if rate_sel = 3 then
          rate_sel <= 0;
        else
          rate_sel <= rate_sel + 1;
        end if;
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- 送信本体
  --   半ビットごとに phase が切り替わる。
  --   phase '0'→'1' : クロックLEDを反転(ビットの真ん中)
  --   phase '1'→'0' : 次のビットをデータLEDに出す(ビットの始まり)
  --   送信中のバイトはシフトレジスタ sreg に入れ、最上位ビット
  --   sreg(7) をデータLEDに出す。1ビット送るごとに左へずらす。
  -- ----------------------------------------------------------
  process (clk, resetn)
    variable next_byte : integer range 0 to FRAME_LEN - 1;
  begin
    if resetn = '0' then
      tick_cnt <= 0;
      phase    <= '0';
      byte_idx <= 0;
      bit_idx  <= 7;
      sreg     <= FRAME(0);
      clk_bit  <= '0';
    elsif clk'event and clk = '1' then
      if tick_cnt >= HALF_BIT(rate_sel) - 1 then
        tick_cnt <= 0;

        if phase = '0' then
          clk_bit <= not clk_bit;
          phase   <= '1';
        else
          phase <= '0';
          if bit_idx = 0 then
            -- 次のバイトへ(最後のバイトの次はフレームの先頭へ)
            if byte_idx = FRAME_LEN - 1 then
              next_byte := 0;
            else
              next_byte := byte_idx + 1;
            end if;
            byte_idx <= next_byte;
            bit_idx  <= 7;
            sreg     <= FRAME(next_byte);
          else
            bit_idx  <= bit_idx - 1;
            sreg     <= sreg(6 downto 0) & '0';   -- 左へ1ビットずらす
          end if;
        end if;

      else
        tick_cnt <= tick_cnt + 1;
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- LED出力
  -- ----------------------------------------------------------
  led_clk_out  <= LED_ON when clk_bit  = '1' else LED_OFF;
  led_data_out <= LED_ON when sreg(7) = '1' else LED_OFF;

  -- 基板の緑LEDは'0'で点灯。選んでいる速度の1個だけを点ける
  with rate_sel select
    led_rate <= "1110" when 0,
                "1101" when 1,
                "1011" when 2,
                "0111" when others;

end rtl;
