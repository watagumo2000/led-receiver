-- ============================================================
-- optical_par2 : LED光通信 送信回路(10個並列版・機能追加)
--
--  optical_par に次の2つを追加したもの。
--   (1) PB2 で送るメッセージを4種類から切り替える
--   (2) PB3 でカラーモード(赤と緑を別々のビットに使う)を切り替える
--
--  ■ 通常モード(optical_par と同じ。今の受信ページで読める)
--    D1       : クロック(オレンジ)。シンボルの真ん中で点灯/消灯が切り替わる
--    D2〜D9   : 1バイト(D2が最上位ビット7)。点灯はオレンジ
--    D10      : パリティ(D2〜D10の点灯数が偶数になるように点ける)
--
--  ■ カラーモード(1シンボルで2バイト送る)
--    D1       : クロック(オレンジ)
--    D2〜D9 赤: 1バイト目   D2〜D9 緑: 2バイト目
--    D10    赤: 1バイト目のパリティ   D10 緑: 2バイト目のパリティ
--    → 赤だけ点灯・緑だけ点灯・両方(オレンジ)・消灯 の4通りで、LED1個が2ビットを運ぶ
--
--  ■ フレーム(どちらのモードも)
--    [同期] [文字数] [文字1] ... [文字N] [チェックサム]
--    同期        : D2〜D10を全部オレンジで点灯(点灯数9個=奇数なので、データと区別できる)
--    チェックサム: 文字数 XOR 文字1 XOR ... XOR 文字N
--    カラーモードでは、同期の次から2バイトずつ送る(バイト数が奇数なら最後に 00 を足す)
--    メッセージやモードの切り替えは、送信中のフレームが終わってから反映する(途中で混ざらない)
--
--  ■ ボタン
--    PB0 : 速度を切り替え (2 → 5 → 8 → 10 シンボル/秒 → 2 ...)
--    PB1 : リセット(5シンボル/秒・メッセージ0・通常モードに戻る)
--    PB2 : メッセージを切り替え (0 → 1 → 2 → 3 → 0 ...)
--    PB3 : 短く押す → 通常モード / カラーモード を切り替え(離したときに切り替わる)
--          1秒長押し → LEDの明るさを切り替え 100% → 25% → 6% → 1.6% → 100% ...
--          (カメラでLEDの中心が白飛びして色が分からなくなるのを防ぐため)
--
--  ■ 明るさ(PWM)
--    50MHzで回る8ビットのカウンタ(1周 約5.1µs = 約195kHz)と比べ、点ける時間の割合を変える。
--    カメラが1コマを撮る時間(1/1000秒でも)の中に何百回も入るので、映像ではちらつかず暗く写る。
--
--  ■ 基板の緑LED(点灯=1 として2進数で表示)
--    LED1 LED0 : 速度  00=2, 01=5, 10=8, 11=10 シンボル/秒
--    LED3 LED2 : メッセージ番号 0〜3
-- ============================================================
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity optical_par2 is
  generic (
    -- 送るメッセージ(ASCIIの英数字・記号、それぞれ最大64文字)
    MSG0 : string := "HELLO! THIS TEXT CAME FROM THE FPGA BY LIGHT.";
    MSG1 : string := "WELCOME TO MY PRESENTATION!";
    MSG2 : string := "QUIZ: HOW MANY LEDS ARE BLINKING? ANSWER: 10";
    MSG3 : string := "THANK YOU! ANY QUESTIONS?");

  port (
    clk      : in  std_logic;                       -- 50MHz
    resetn   : in  std_logic;                       -- PB1(押すと'0')
    sw_rate  : in  std_logic;                       -- PB0(押すと'0')
    sw_msg   : in  std_logic;                       -- PB2(押すと'0')
    sw_mode  : in  std_logic;                       -- PB3(押すと'0')
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
    led_stat : out std_logic_vector(3 downto 0));   -- 基板の緑LED0〜3

end optical_par2;

architecture rtl of optical_par2 is

  -- ----------------------------------------------------------
  -- 4つのメッセージのフレーム中身(文字数・文字・チェックサム)を
  -- 1つの表(ROM)に続けて並べる。FRAME_LEN(k) が k 番目の長さ、FRAME_TOP(k) が先頭の位置
  -- ----------------------------------------------------------
  type byte_array is array (natural range <>) of std_logic_vector(7 downto 0);
  type int_array  is array (0 to 3) of integer;

  constant FRAME_LEN : int_array := (MSG0'length + 2, MSG1'length + 2,
                                     MSG2'length + 2, MSG3'length + 2);
  constant FRAME_TOP : int_array := (0,
                                     FRAME_LEN(0),
                                     FRAME_LEN(0) + FRAME_LEN(1),
                                     FRAME_LEN(0) + FRAME_LEN(1) + FRAME_LEN(2));
  constant ROM_LEN   : integer   := FRAME_LEN(0) + FRAME_LEN(1) + FRAME_LEN(2) + FRAME_LEN(3);

  -- 表 r の top 番目から、文字列 s のフレーム中身を書き込む
  function put_frame (r : byte_array; top : integer; s : string) return byte_array is
    variable w   : byte_array(r'range) := r;
    variable sum : std_logic_vector(7 downto 0);
  begin
    w(top) := std_logic_vector(to_unsigned(s'length, 8));                  -- 文字数
    sum    := w(top);
    for i in 0 to s'length - 1 loop
      w(top + 1 + i) := std_logic_vector(to_unsigned(character'pos(s(s'low + i)), 8));
      sum            := sum xor w(top + 1 + i);
    end loop;
    w(top + s'length + 1) := sum;                                          -- チェックサム
    return w;
  end function;

  function make_rom (s0, s1, s2, s3 : string) return byte_array is
    variable r : byte_array(0 to ROM_LEN - 1) := (others => (others => '0'));
  begin
    r := put_frame(r, FRAME_TOP(0), s0);
    r := put_frame(r, FRAME_TOP(1), s1);
    r := put_frame(r, FRAME_TOP(2), s2);
    r := put_frame(r, FRAME_TOP(3), s3);
    return r;
  end function;

  constant ROM : byte_array(0 to ROM_LEN - 1) := make_rom(MSG0, MSG1, MSG2, MSG3);

  -- メッセージ m の i 番目のバイト(範囲外は 00 = カラーモードの穴埋め)
  function get_byte (m : integer; i : integer) return std_logic_vector is
  begin
    if i < FRAME_LEN(m) then
      return ROM(FRAME_TOP(m) + i);
    else
      return x"00";
    end if;
  end function;

  -- 1フレームのシンボル数(同期を含む)
  function sym_count (m : integer; color : std_logic) return integer is
  begin
    if color = '1' then
      return (FRAME_LEN(m) + 1) / 2 + 1;     -- 2バイトずつ
    else
      return FRAME_LEN(m) + 1;               -- 1バイトずつ
    end if;
  end function;

  -- 1バイトにパリティを付けて9ビットにする(点灯数が偶数になる)
  function to_symbol (b : std_logic_vector(7 downto 0)) return std_logic_vector is
    variable p : std_logic := '0';
  begin
    for i in 0 to 7 loop
      p := p xor b(i);
    end loop;
    return b & p;
  end function;

  constant SYNC : std_logic_vector(8 downto 0) := (others => '1');

  -- ----------------------------------------------------------
  -- 拡張ボードの2色LED(実機で確認済み)
  --   [0]=H,[1]=L で赤 / [2]=H,[3]=L で緑 / 両方でオレンジ
  -- ----------------------------------------------------------
  --   pwm が '0' の間は消す(明るさの調整)
  function led (r : std_logic; g : std_logic; pwm : std_logic) return std_logic_vector is
  begin
    return '0' & (g and pwm) & '0' & (r and pwm);
  end function;

  -- 明るさ:256のうち何カウント点けるか(100%, 25%, 6.25%, 1.6%)
  type duty_array is array (0 to 3) of integer;
  constant DUTY : duty_array := (256, 64, 16, 4);

  -- ----------------------------------------------------------
  -- 速度設定:半シンボルぶんのクロック数(50MHz / (2 × シンボル/秒))
  -- ----------------------------------------------------------
  constant HALF_SYM : int_array := (12_500_000,   --  2 シンボル/秒
                                     5_000_000,   --  5 シンボル/秒
                                     3_125_000,   --  8 シンボル/秒
                                     2_500_000);  -- 10 シンボル/秒

  signal rate_sel  : integer range 0 to 3 := 1;
  signal msg_next  : integer range 0 to 3 := 0;    -- ボタンで選んだメッセージ
  signal mode_next : std_logic := '0';             -- ボタンで選んだモード('1'=カラー)
  signal msg_cur   : integer range 0 to 3 := 0;    -- 送信中のメッセージ
  signal mode_cur  : std_logic := '0';             -- 送信中のモード

  signal bright_sel : integer range 0 to 3 := 0;   -- 明るさ(0=100%)
  signal pwm_cnt    : unsigned(7 downto 0) := (others => '0');
  signal pwm_on     : std_logic := '1';
  signal hold_cnt   : integer range 0 to 255 := 0; -- PB3を押し続けている時間(約5.2ms単位)
  signal long_done  : std_logic := '0';            -- 今回の押下で長押しの動作をしたか

  -- チャタリング除去(約5.2msごとにボタンを読む)
  signal deb_counter : unsigned(17 downto 0) := (others => '0');
  signal sw_node     : std_logic_vector(2 downto 0) := (others => '1');  -- (2)=PB3 (1)=PB2 (0)=PB0
  signal sw_prev     : std_logic_vector(2 downto 0) := (others => '1');

  -- 送信用
  signal tick_cnt : integer range 0 to 12_500_000 := 0;
  signal phase    : std_logic := '0';                 -- '0':前半 '1':後半
  signal sym_idx  : integer range 0 to 127 := 0;      -- 0が同期シンボル
  signal sym_r    : std_logic_vector(8 downto 0) := SYNC;   -- 赤で出す9ビット
  signal sym_g    : std_logic_vector(8 downto 0) := SYNC;   -- 緑で出す9ビット
  signal clk_bit  : std_logic := '0';

begin

  -- ----------------------------------------------------------
  -- ボタン入力:チャタリング除去 + 押した瞬間の検出(3つまとめて)
  -- ----------------------------------------------------------
  process (clk, resetn)
  begin
    if resetn = '0' then
      deb_counter <= (others => '0');
      sw_node     <= (others => '1');
      sw_prev     <= (others => '1');
      rate_sel    <= 1;
      msg_next    <= 0;
      mode_next   <= '0';
      bright_sel  <= 0;
      hold_cnt    <= 0;
      long_done   <= '0';
    elsif clk'event and clk = '1' then
      deb_counter <= deb_counter + 1;
      if deb_counter = 0 then
        sw_node <= sw_mode & sw_msg & sw_rate;

        -- PB3の長押し:押している間、約5.2msごとに数える。約1秒(190回)で明るさを切り替える
        if sw_node(2) = '0' then
          if hold_cnt < 255 then
            hold_cnt <= hold_cnt + 1;
          end if;
          if hold_cnt = 190 then
            if bright_sel = 3 then
              bright_sel <= 0;
            else
              bright_sel <= bright_sel + 1;
            end if;
            long_done <= '1';
          end if;
        end if;
      end if;

      sw_prev <= sw_node;

      if sw_prev(0) = '1' and sw_node(0) = '0' then      -- PB0:速度
        if rate_sel = 3 then
          rate_sel <= 0;
        else
          rate_sel <= rate_sel + 1;
        end if;
      end if;

      if sw_prev(1) = '1' and sw_node(1) = '0' then      -- PB2:メッセージ
        if msg_next = 3 then
          msg_next <= 0;
        else
          msg_next <= msg_next + 1;
        end if;
      end if;

      if sw_prev(2) = '0' and sw_node(2) = '1' then      -- PB3を離した瞬間
        if long_done = '0' then                          -- 短く押しただけならモード切り替え
          mode_next <= not mode_next;
        end if;
        long_done <= '0';
        hold_cnt  <= 0;
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- 送信本体
  --   phase '0'→'1' : クロックLEDを反転(シンボルの真ん中)
  --   phase '1'→'0' : 次のシンボルを出す(シンボルの始まり)
  --   フレームの先頭(同期)に戻るときだけ、選ばれたメッセージとモードに切り替える
  -- ----------------------------------------------------------
  process (clk, resetn)
    variable next_idx : integer range 0 to 127;
    variable m        : integer range 0 to 3;
    variable c        : std_logic;
    variable k        : integer range 0 to 255;
  begin
    if resetn = '0' then
      tick_cnt <= 0;
      phase    <= '0';
      sym_idx  <= 0;
      sym_r    <= SYNC;
      sym_g    <= SYNC;
      clk_bit  <= '0';
      msg_cur  <= 0;
      mode_cur <= '0';
    elsif clk'event and clk = '1' then
      if tick_cnt >= HALF_SYM(rate_sel) - 1 then
        tick_cnt <= 0;

        if phase = '0' then
          clk_bit <= not clk_bit;
          phase   <= '1';
        else
          phase <= '0';

          if sym_idx >= sym_count(msg_cur, mode_cur) - 1 then
            next_idx := 0;
          else
            next_idx := sym_idx + 1;
          end if;
          sym_idx <= next_idx;

          if next_idx = 0 then
            -- フレームの先頭:ここで切り替えを反映し、同期シンボルを出す
            msg_cur  <= msg_next;
            mode_cur <= mode_next;
            sym_r    <= SYNC;
            sym_g    <= SYNC;
          else
            m := msg_cur;
            c := mode_cur;
            if c = '1' then
              k     := 2 * (next_idx - 1);              -- 2バイトずつ
              sym_r <= to_symbol(get_byte(m, k));
              sym_g <= to_symbol(get_byte(m, k + 1));
            else
              k     := next_idx - 1;                    -- 1バイトずつ(赤も緑も同じ)
              sym_r <= to_symbol(get_byte(m, k));
              sym_g <= to_symbol(get_byte(m, k));
            end if;
          end if;
        end if;

      else
        tick_cnt <= tick_cnt + 1;
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- 明るさ(PWM):カウンタが DUTY より小さい間だけ点ける
  -- ----------------------------------------------------------
  process (clk, resetn)
  begin
    if resetn = '0' then
      pwm_cnt <= (others => '0');
      pwm_on  <= '1';
    elsif clk'event and clk = '1' then
      pwm_cnt <= pwm_cnt + 1;
      if to_integer(pwm_cnt) < DUTY(bright_sel) then
        pwm_on <= '1';
      else
        pwm_on <= '0';
      end if;
    end if;
  end process;

  -- ----------------------------------------------------------
  -- LED出力
  -- ----------------------------------------------------------
  led_d1  <= led(clk_bit, clk_bit, pwm_on);       -- クロックはいつもオレンジ
  led_d2  <= led(sym_r(8), sym_g(8), pwm_on);
  led_d3  <= led(sym_r(7), sym_g(7), pwm_on);
  led_d4  <= led(sym_r(6), sym_g(6), pwm_on);
  led_d5  <= led(sym_r(5), sym_g(5), pwm_on);
  led_d6  <= led(sym_r(4), sym_g(4), pwm_on);
  led_d7  <= led(sym_r(3), sym_g(3), pwm_on);
  led_d8  <= led(sym_r(2), sym_g(2), pwm_on);
  led_d9  <= led(sym_r(1), sym_g(1), pwm_on);
  led_d10 <= led(sym_r(0), sym_g(0), pwm_on);

  -- 基板の緑LEDは'0'で点灯なので、反転して出す
  led_stat <= not (std_logic_vector(to_unsigned(msg_next, 2)) &
                   std_logic_vector(to_unsigned(rate_sel, 2)));

end rtl;