-- ============================================================
-- optical_par : LED光通信 送信回路(10個並列版)
--
--  拡張ボードのLED 10個を使い、クロック1回で1バイトを送る。
--    D1       : クロックLED … 1シンボルごとに点灯/消灯が切り替わる
--    D2〜D9   : データLED  … 1バイトの各ビット(D2が最上位ビット7、D9が最下位ビット0)
--    D10      : パリティLED … D2〜D10の点灯数が偶数になるように点ける
--
--  データLEDは「シンボルの始まり」で一斉に変わり、クロックLEDは
--  「シンボルの真ん中」で切り替わる。受信側はクロックが切り替わった
--  瞬間のD2〜D10を読めば、9ビットを一度に取り出せる。
--
--  送るフレーム(1シンボルずつ順に)
--    [同期] [文字数] [文字1] ... [文字N] [チェックサム]
--    同期        : D2〜D10を全部点灯。点灯数が9個(奇数)なので、
--                  普通のデータ(必ず偶数)とは絶対に区別できる。
--    チェックサム: 文字数 XOR 文字1 XOR ... XOR 文字N
--  同じフレームを繰り返し送り続ける。
--
--  ボタン
--    PB0 : 速度を切り替え (2 → 5 → 8 → 10 シンボル/秒 → 2 ...)
--    PB1 : リセット(5シンボル/秒に戻る)
--  基板の緑LED0〜3 : 現在の速度(LED0=2, LED1=5, LED2=8, LED3=10)
-- ============================================================
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity optical_par is
  generic (
    -- 送信する文字列(ASCIIの英数字・記号、最大64文字)
    MSG : string := "HELLO! THIS TEXT CAME FROM THE FPGA BY LIGHT.");

  port (
    clk      : in  std_logic;                       -- 50MHz
    resetn   : in  std_logic;                       -- PB1(押すと'0')
    sw_in    : in  std_logic;                       -- PB0(押すと'0')
    led_d1   : out std_logic_vector(3 downto 0);    -- クロック
    led_d2   : out std_logic_vector(3 downto 0);    -- ビット7
    led_d3   : out std_logic_vector(3 downto 0);    -- ビット6
    led_d4   : out std_logic_vector(3 downto 0);    -- ビット5
    led_d5   : out std_logic_vector(3 downto 0);    -- ビット4
    led_d6   : out std_logic_vector(3 downto 0);    -- ビット3
    led_d7   : out std_logic_vector(3 downto 0);    -- ビット2
    led_d8   : out std_logic_vector(3 downto 0);    -- ビット1
    led_d9   : out std_logic_vector(3 downto 0);    -- ビット0
    led_d10  : out std_logic_vector(3 downto 0);    -- パリティ
    led_rate : out std_logic_vector(3 downto 0));   -- 基板の緑LED0〜3

end optical_par;

architecture rtl of optical_par is

  -- ----------------------------------------------------------
  -- フレームの中身(文字数・文字・チェックサム)をコンパイル時に作る
  -- ----------------------------------------------------------
  type byte_array is array (natural range <>) of std_logic_vector(7 downto 0);

  function make_body (s : string) return byte_array is
    variable f   : byte_array(0 to s'length + 1);
    variable sum : std_logic_vector(7 downto 0);
  begin
    f(0) := std_logic_vector(to_unsigned(s'length, 8));   -- 文字数
    sum  := f(0);
    for i in 0 to s'length - 1 loop
      f(i + 1) := std_logic_vector(to_unsigned(character'pos(s(s'low + i)), 8));
      sum      := sum xor f(i + 1);
    end loop;
    f(s'length + 1) := sum;                               -- チェックサム
    return f;
  end function;

  constant FRAME_BODY : byte_array := make_body(MSG);
  constant NSYM : integer    := MSG'length + 3;           -- 同期 + 文字数 + 文字 + チェックサム

  constant SYNC : std_logic_vector(8 downto 0) := (others => '1');

  -- 1バイトにパリティを付けて9ビットのシンボルにする(点灯数が偶数になる)
  function to_symbol (b : std_logic_vector(7 downto 0)) return std_logic_vector is
    variable p : std_logic := '0';
  begin
    for i in 0 to 7 loop
      p := p xor b(i);
    end loop;
    return b & p;
  end function;

  -- 送るシンボルを全部、表(ROM)にしておく。0番目が同期シンボル
  type sym_array is array (natural range <>) of std_logic_vector(8 downto 0);

  function make_symbols (b : byte_array) return sym_array is
    variable s : sym_array(0 to b'length);
  begin
    s(0) := SYNC;
    for i in 0 to b'length - 1 loop
      s(i + 1) := to_symbol(b(b'low + i));
    end loop;
    return s;
  end function;

  constant SYMS : sym_array := make_symbols(FRAME_BODY);

  -- ----------------------------------------------------------
  -- 拡張ボードの2色LED(実機で確認済み)
  --   [0]=H,[1]=L で赤 / [2]=H,[3]=L で緑 / "0101" で両方点灯(オレンジ)
  -- ----------------------------------------------------------
  constant LED_ON  : std_logic_vector(3 downto 0) := "0101";
  constant LED_OFF : std_logic_vector(3 downto 0) := "0000";

  function led (b : std_logic) return std_logic_vector is
  begin
    if b = '1' then
      return LED_ON;
    else
      return LED_OFF;
    end if;
  end function;

  -- ----------------------------------------------------------
  -- 速度設定:半シンボルぶんのクロック数(50MHz / (2 × シンボル/秒))
  -- ----------------------------------------------------------
  type int_array is array (0 to 3) of integer;
  constant HALF_SYM : int_array := (12_500_000,   --  2 シンボル/秒
                                     5_000_000,   --  5 シンボル/秒
                                     3_125_000,   --  8 シンボル/秒
                                     2_500_000);  -- 10 シンボル/秒

  signal rate_sel : integer range 0 to 3 := 1;

  -- チャタリング除去(約5.2msごとにボタンを読む)
  signal deb_counter : unsigned(17 downto 0) := (others => '0');
  signal sw_node     : std_logic := '1';
  signal sw_prev     : std_logic := '1';

  -- 送信用
  signal tick_cnt : integer range 0 to 12_500_000 := 0;
  signal phase    : std_logic := '0';                  -- '0':前半 '1':後半
  signal sym_idx  : integer range 0 to NSYM - 1 := 0;  -- 0が同期シンボル
  signal sym      : std_logic_vector(8 downto 0) := SYNC;
  signal clk_bit  : std_logic := '0';

begin

  -- ----------------------------------------------------------
  -- ボタン入力:チャタリング除去 + 押した瞬間の検出(optical_txと同じ)
  -- ----------------------------------------------------------
  process (clk, resetn)
  begin
    if resetn = '0' then
      deb_counter <= (others => '0');
      sw_node     <= '1';
      sw_prev     <= '1';
      rate_sel    <= 1;
    elsif clk'event and clk = '1' then
      deb_counter <= deb_counter + 1;
      if deb_counter = 0 then
        sw_node <= sw_in;
      end if;

      sw_prev <= sw_node;
      if sw_prev = '1' and sw_node = '0' then
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
  --   phase '0'→'1' : クロックLEDを反転(シンボルの真ん中)
  --   phase '1'→'0' : 次のシンボルをD2〜D10に出す(シンボルの始まり)
  -- ----------------------------------------------------------
  process (clk, resetn)
    variable next_idx : integer range 0 to NSYM - 1;
  begin
    if resetn = '0' then
      tick_cnt <= 0;
      phase    <= '0';
      sym_idx  <= 0;
      sym      <= SYNC;
      clk_bit  <= '0';
    elsif clk'event and clk = '1' then
      if tick_cnt >= HALF_SYM(rate_sel) - 1 then
        tick_cnt <= 0;

        if phase = '0' then
          clk_bit <= not clk_bit;
          phase   <= '1';
        else
          phase <= '0';
          if sym_idx = NSYM - 1 then
            next_idx := 0;
          else
            next_idx := sym_idx + 1;
          end if;
          sym_idx <= next_idx;
          sym     <= SYMS(next_idx);
        end if;

      else
        tick_cnt <= tick_cnt + 1;
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- LED出力
  -- ----------------------------------------------------------
  led_d1  <= led(clk_bit);
  led_d2  <= led(sym(8));
  led_d3  <= led(sym(7));
  led_d4  <= led(sym(6));
  led_d5  <= led(sym(5));
  led_d6  <= led(sym(4));
  led_d7  <= led(sym(3));
  led_d8  <= led(sym(2));
  led_d9  <= led(sym(1));
  led_d10 <= led(sym(0));

  with rate_sel select
    led_rate <= "1110" when 0,
                "1101" when 1,
                "1011" when 2,
                "0111" when others;

end rtl;
