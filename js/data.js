/* ===== 問題データ（算数いがい） ===== */
/* choice形式: { q, answer, choices:[...] }  choicesの1つ目が正解でなくてもOK（app側でシャッフル） */

const DATA = {
  g1: {
    // こくご：ひらがな・かん字のよみ・ことば
    kokugo: [
      { q: "「山」の よみは？", answer: "やま", choices: ["やま","かわ","た","うみ"] },
      { q: "「川」の よみは？", answer: "かわ", choices: ["かわ","やま","いし","き"] },
      { q: "「日」の よみは？", answer: "ひ", choices: ["ひ","つき","ほし","そら"] },
      { q: "「月」の よみは？", answer: "つき", choices: ["つき","ひ","みず","き"] },
      { q: "「木」の よみは？", answer: "き", choices: ["き","はな","くさ","ゆき"] },
      { q: "「火」の よみは？", answer: "ひ", choices: ["ひ","みず","かぜ","つち"] },
      { q: "「水」の よみは？", answer: "みず", choices: ["みず","ひ","き","いし"] },
      { q: "「大」の よみは？", answer: "おお", choices: ["おお","ちい","なが","たか"] },
      { q: "「小」の よみは？", answer: "ちい", choices: ["ちい","おお","まる","しか"] },
      { q: "「上」の よみは？", answer: "うえ", choices: ["うえ","した","なか","そと"] },
      { q: "「下」の よみは？", answer: "した", choices: ["した","うえ","みぎ","ひだり"] },
      { q: "「right（みぎ）」を あらわす かん字は？", answer: "右", choices: ["右","左","中","手"] },
      { q: "「ねこ」を カタカナで かくと？", answer: "ネコ", choices: ["ネコ","ネユ","ヌコ","ネヨ"] },
      { q: "「いぬ」を カタカナで かくと？", answer: "イヌ", choices: ["イヌ","イマ","エヌ","イム"] },
      { q: "「あ」の つぎの ひらがなは？", answer: "い", choices: ["い","う","お","か"] },
      { q: "しりとり:「りんご」→ つぎは？", answer: "ごりら", choices: ["ごりら","りす","みかん","ばなな"] },
      { q: "「口」の よみは？", answer: "くち", choices: ["くち","め","みみ","て"] },
      { q: "「目」の よみは？", answer: "め", choices: ["め","くち","はな","あし"] },
      { q: "「手」の よみは？", answer: "て", choices: ["て","あし","かお","ゆび"] },
      { q: "「足」の よみは？", answer: "あし", choices: ["あし","て","くび","かた"] },
      { q: "「年」の よみは？", answer: "ねん", choices: ["ねん","つき","ひ","じ"] },
      { q: "「先生」の よみは？", answer: "せんせい", choices: ["せんせい","がくせい","ともだち","かぞく"] },
      { q: "「学校」の よみは？", answer: "がっこう", choices: ["がっこう","こうえん","びょういん","おてら"] },
      { q: "「花」の よみは？", answer: "はな", choices: ["はな","くさ","き","は"] },
      { q: "「石」の よみは？", answer: "いし", choices: ["いし","すな","つち","みず"] },
      { q: "「白」の よみは？", answer: "しろ", choices: ["しろ","くろ","あか","あお"] },
      { q: "「赤」の よみは？", answer: "あか", choices: ["あか","あお","きいろ","みどり"] },
      { q: "「せ」を カタカナで かくと？", answer: "セ", choices: ["セ","サ","ソ","シ"] },
      { q: "しりとり:「さかな」→ つぎは？", answer: "なす", choices: ["なす","さる","かに","くま"] },
      { q: "「くるま」を カタカナで かくと？", answer: "クルマ", choices: ["クルマ","クレマ","ワルマ","クルテ"] },
      { q: "「森」の よみは？", answer: "もり", choices: ["もり","はやし","やま","の"] },
      { q: "「雨」の よみは？", answer: "あめ", choices: ["あめ","ゆき","かぜ","くも"] },
      { q: "「空」の よみは？", answer: "そら", choices: ["そら","うみ","やま","つち"] },
      { q: "「金」の よみは？", answer: "かね", choices: ["かね","ぎん","てつ","どう"] },
      { q: "「男」の よみは？", answer: "おとこ", choices: ["おとこ","おんな","こども","おとな"] },
      { q: "「女」の よみは？", answer: "おんな", choices: ["おんな","おとこ","こ","はは"] },
    ],
    // えいご：あいさつ・数・いろ・どうぶつ
    english: [
      { q: "「おはよう」を えいごで？", answer: "Good morning", choices: ["Good morning","Good night","Thank you","Goodbye"] },
      { q: "「ありがとう」を えいごで？", answer: "Thank you", choices: ["Thank you","Hello","Sorry","Please"] },
      { q: "「あか」は えいごで？", answer: "red", choices: ["red","blue","green","yellow"] },
      { q: "「あお」は えいごで？", answer: "blue", choices: ["blue","red","black","white"] },
      { q: "「1」は えいごで？", answer: "one", choices: ["one","two","three","ten"] },
      { q: "「3」は えいごで？", answer: "three", choices: ["three","two","five","four"] },
      { q: "「ねこ」は えいごで？", answer: "cat", choices: ["cat","dog","fish","bird"] },
      { q: "「いぬ」は えいごで？", answer: "dog", choices: ["dog","cat","cow","pig"] },
      { q: "「りんご」は えいごで？", answer: "apple", choices: ["apple","banana","orange","grape"] },
      { q: "「Hello」の いみは？", answer: "こんにちは", choices: ["こんにちは","さようなら","ごめんね","おやすみ"] },
      { q: "「きいろ」は えいごで？", answer: "yellow", choices: ["yellow","green","pink","brown"] },
      { q: "「みどり」は えいごで？", answer: "green", choices: ["green","blue","red","black"] },
      { q: "「2」は えいごで？", answer: "two", choices: ["two","one","four","six"] },
      { q: "「5」は えいごで？", answer: "five", choices: ["five","four","nine","seven"] },
      { q: "「Goodbye」の いみは？", answer: "さようなら", choices: ["さようなら","こんにちは","おはよう","ありがとう"] },
      { q: "「とり」は えいごで？", answer: "bird", choices: ["bird","fish","cat","frog"] },
      { q: "「さかな」は えいごで？", answer: "fish", choices: ["fish","bird","dog","bear"] },
      { q: "「バナナ」は えいごで？", answer: "banana", choices: ["banana","apple","melon","lemon"] },
      { q: "「Cat」の いみは？", answer: "ねこ", choices: ["ねこ","いぬ","うさぎ","くま"] },
      { q: "「しろ」は えいごで？", answer: "white", choices: ["white","black","red","blue"] },
      { q: "「くろ」は えいごで？", answer: "black", choices: ["black","white","gray","green"] },
      { q: "「Dog」の いみは？", answer: "いぬ", choices: ["いぬ","ねこ","ぶた","うし"] },
      { q: "「4」は えいごで？", answer: "four", choices: ["four","five","three","eight"] },
      { q: "「10」は えいごで？", answer: "ten", choices: ["ten","two","twelve","nine"] },
    ],
    // せいかつ・クイズ
    other: [
      { q: "にじは いくつの いろ？", answer: "7つ", choices: ["7つ","3つ","5つ","10"] },
      { q: "ちょうちょは 何から うまれる？", answer: "たまご", choices: ["たまご","はっぱ","はな","つち"] },
      { q: "あさがおの たねを まく きせつは？", answer: "はる", choices: ["はる","なつ","あき","ふゆ"] },
      { q: "こおりが とけると 何になる？", answer: "みず", choices: ["みず","ゆき","くも","あめ"] },
      { q: "1しゅうかんは 何日？", answer: "7日", choices: ["7日","5日","10日","3日"] },
      { q: "みつばちが あつめるのは？", answer: "みつ", choices: ["みつ","みず","すな","くさ"] },
      { q: "なつに たくさん なく むしは？", answer: "せみ", choices: ["せみ","こおろぎ","すずむし","とんぼ"] },
      { q: "しんごうの「すすめ」の いろは？", answer: "みどり(あお)", choices: ["みどり(あお)","あか","きいろ","しろ"] },
      { q: "たまごを うむ どうぶつは？", answer: "にわとり", choices: ["にわとり","いぬ","ねこ","うし"] },
      { q: "1年は 何かげつ？", answer: "12かげつ", choices: ["12かげつ","10かげつ","7かげつ","24かげつ"] },
      { q: "おたまじゃくしは 大きくなると？", answer: "かえる", choices: ["かえる","さかな","へび","とり"] },
      { q: "よるに 空で ひかるのは？", answer: "つき・ほし", choices: ["つき・ほし","たいよう","にじ","くも"] },
      { q: "はをみがくのは いつ？", answer: "あさとよる", choices: ["あさとよる","ひるだけ","よるだけ","いつでもよい"] },
      { q: "あさがおの 花は 何いろが おおい？", answer: "むらさき・あお", choices: ["むらさき・あお","くろ","ちゃいろ","はいいろ"] },
      { q: "ひまわりは どっちを むく？", answer: "たいようのほう", choices: ["たいようのほう","つちのなか","きたのほう","みずのほう"] },
      { q: "かたつむりが せなかに もつのは？", answer: "から(いえ)", choices: ["から(いえ)","はね","つの2ほんだけ","しっぽ"] },
    ],
  },

  g5: {
    // 国語：漢字の読み・四字熟語・慣用句・対義語
    kokugo: [
      { q: "「快晴」の読みは？", answer: "かいせい", choices: ["かいせい","かいばれ","こころよい","はれま"] },
      { q: "「往復」の読みは？", answer: "おうふく", choices: ["おうふく","おうもど","ゆきかえり","おうへん"] },
      { q: "「効果」の「効」を使う正しい熟語は？", answer: "効果", choices: ["効果","功績","校庭","交代"] },
      { q: "「暴風」の読みは？", answer: "ぼうふう", choices: ["ぼうふう","あばれかぜ","ばくふう","ぼうかぜ"] },
      { q: "四字熟語「一石二□」の□は？", answer: "鳥", choices: ["鳥","羽","石","矢"] },
      { q: "四字熟語「十人十□」の□は？", answer: "色", choices: ["色","人","様","面"] },
      { q: "四字熟語「絶体絶□」の□は？", answer: "命", choices: ["命","体","対","望"] },
      { q: "「花を持たせる」の意味は？", answer: "手がらをゆずる", choices: ["手がらをゆずる","じゃまをする","急いで帰る","花をかざる"] },
      { q: "「油を売る」の意味は？", answer: "むだ話をしてなまける", choices: ["むだ話をしてなまける","一生けん命はたらく","油をこぼす","料理をする"] },
      { q: "「河口」の読みは？", answer: "かこう", choices: ["かこう","かわぐち","がこう","かくち"] },
      { q: "「規則」の読みは？", answer: "きそく", choices: ["きそく","きぞく","のりのり","ていそく"] },
      { q: "「複数」の対義語は？", answer: "単数", choices: ["単数","少数","多数","分数"] },
      { q: "「増加」の対義語は？", answer: "減少", choices: ["減少","増大","加速","低下"] },
      { q: "「開始」の対義語は？", answer: "終了", choices: ["終了","中止","開放","始発"] },
      { q: "「賛成」の対義語は？", answer: "反対", choices: ["反対","同意","賛同","可決"] },
      { q: "四字熟語「一日千□」の□は？", answer: "秋", choices: ["秋","里","円","金"] },
      { q: "四字熟語「自□自賛」の□は？", answer: "画", choices: ["画","分","作","満"] },
      { q: "「耳を貸す」の意味は？", answer: "話を聞いてあげる", choices: ["話を聞いてあげる","わざと無視する","耳をふさぐ","大声を出す"] },
      { q: "「馬が合う」の意味は？", answer: "気が合う", choices: ["気が合う","けんかする","足がはやい","馬にのる"] },
      { q: "「快い」の読みは？", answer: "こころよい", choices: ["こころよい","かるい","はやい","つよい"] },
      { q: "「険しい」の読みは？", answer: "けわしい", choices: ["けわしい","あやしい","きびしい","くるしい"] },
      { q: "「境界」の読みは？", answer: "きょうかい", choices: ["きょうかい","さかいめ","きょうがい","けいかい"] },
      { q: "「往路」の対義語は？", answer: "復路", choices: ["復路","帰路","進路","通路"] },
      { q: "「原因」の対義語は？", answer: "結果", choices: ["結果","理由","原点","要因"] },
      { q: "「団結」の「団」と同じ読みの漢字は？", answer: "集団の団", choices: ["集団の団","段だんの段","男の男","談話の談"] },
      { q: "四字熟語「以心□心」の□は？", answer: "伝", choices: ["伝","電","点","天"] },
      { q: "「みなもと」を表す漢字は？", answer: "源", choices: ["源","泉","液","流"] },
      { q: "「講堂」の読みは？", answer: "こうどう", choices: ["こうどう","こうとう","きょうどう","こうじょう"] },
    ],
    // 英語：単語・意味・曜日・文
    english: [
      { q: "「social studies」の意味は？", answer: "社会", choices: ["社会","算数","音楽","体育"] },
      { q: "「うれしい」は英語で？", answer: "happy", choices: ["happy","sad","angry","sleepy"] },
      { q: "「月曜日」は英語で？", answer: "Monday", choices: ["Monday","Sunday","Friday","Tuesday"] },
      { q: "「Wednesday」は何曜日？", answer: "水曜日", choices: ["水曜日","木曜日","火曜日","土曜日"] },
      { q: "「学校」は英語で？", answer: "school", choices: ["school","house","park","shop"] },
      { q: "「先生」は英語で？", answer: "teacher", choices: ["teacher","student","doctor","driver"] },
      { q: "「大きい」は英語で？", answer: "big", choices: ["big","small","long","short"] },
      { q: "「What time is it?」の意味は？", answer: "何時ですか？", choices: ["何時ですか？","元気ですか？","名前は？","どこ？"] },
      { q: "「12」は英語で？", answer: "twelve", choices: ["twelve","twenty","eleven","two"] },
      { q: "「triangle」の意味は？", answer: "三角形", choices: ["三角形","円","四角形","直線"] },
      { q: "「science」の意味は？", answer: "理科", choices: ["理科","社会","国語","家庭科"] },
      { q: "「かなしい」は英語で？", answer: "sad", choices: ["sad","happy","fun","kind"] },
      { q: "「金曜日」は英語で？", answer: "Friday", choices: ["Friday","Thursday","Saturday","Monday"] },
      { q: "「Sunday」は何曜日？", answer: "日曜日", choices: ["日曜日","土曜日","月曜日","水曜日"] },
      { q: "「小さい」は英語で？", answer: "small", choices: ["small","big","tall","wide"] },
      { q: "「How are you?」の意味は？", answer: "元気ですか？", choices: ["元気ですか？","何歳ですか？","どこ？","何時？"] },
      { q: "「20」は英語で？", answer: "twenty", choices: ["twenty","twelve","thirty","two"] },
      { q: "「circle」の意味は？", answer: "円", choices: ["円","三角形","四角形","星"] },
      { q: "「library」の意味は？", answer: "図書館", choices: ["図書館","病院","学校","公園"] },
      { q: "「friend」の意味は？", answer: "友だち", choices: ["友だち","家族","先生","医者"] },
      { q: "「water」の意味は？", answer: "水", choices: ["水","火","風","土"] },
      { q: "「My name is Ken.」の意味は？", answer: "私の名前はケンです", choices: ["私の名前はケンです","ケンが好きです","ケンはどこ？","ケンは元気です"] },
      { q: "「うつくしい」は英語で？", answer: "beautiful", choices: ["beautiful","dirty","fast","strong"] },
      { q: "「breakfast」の意味は？", answer: "朝ごはん", choices: ["朝ごはん","昼ごはん","夜ごはん","おやつ"] },
      { q: "「Thursday」は何曜日？", answer: "木曜日", choices: ["木曜日","水曜日","金曜日","火曜日"] },
      { q: "「long」の意味は？", answer: "長い", choices: ["長い","短い","高い","低い"] },
    ],
    // 理科・社会・都道府県
    other: [
      { q: "日本で いちばん高い山は？", answer: "富士山", choices: ["富士山","立山","白山","阿蘇山"] },
      { q: "北海道の県庁所在地は？", answer: "札幌市", choices: ["札幌市","函館市","旭川市","釧路市"] },
      { q: "「金閣寺」がある都道府県は？", answer: "京都府", choices: ["京都府","奈良県","大阪府","滋賀県"] },
      { q: "植物が 光を使って養分をつくることを何という？", answer: "光合成", choices: ["光合成","呼吸","蒸散","発芽"] },
      { q: "水が水じょう気になることを？", answer: "じょう発", choices: ["じょう発","ぎょうこ","ゆうかい","ぎょうけつ"] },
      { q: "太陽・地球・月。月が回っているのは？", answer: "地球", choices: ["地球","太陽","星","雲"] },
      { q: "米づくりが さかんな地方といえば？", answer: "東北地方", choices: ["東北地方","九州地方","四国地方","中国地方"] },
      { q: "方位じしんの N が さすのは？", answer: "北", choices: ["北","南","東","西"] },
      { q: "食べ物を消化する えきを出す いちばん大きい臓器は？", answer: "かん臓", choices: ["かん臓","心臓","はい","じん臓"] },
      { q: "日本一 大きい湖は？", answer: "びわ湖", choices: ["びわ湖","かすみがうら","さろま湖","はまな湖"] },
      { q: "水が こおることを 何という？", answer: "ぎょうこ", choices: ["ぎょうこ","じょう発","ゆうかい","ふっとう"] },
      { q: "けん玉ではなく、日本一 人口が多い都道府県は？", answer: "東京都", choices: ["東京都","大阪府","神奈川県","愛知県"] },
      { q: "みかんの さいばいで 有名な県は？", answer: "和歌山県", choices: ["和歌山県","青森県","山形県","長野県"] },
      { q: "りんごの さいばいで 日本一の県は？", answer: "青森県", choices: ["青森県","和歌山県","静岡県","宮崎県"] },
      { q: "心ぞうの はたらきは？", answer: "血液を送り出す", choices: ["血液を送り出す","食べ物を消化する","空気を すう","にょうを作る"] },
      { q: "台風は どの きせつに 多い？", answer: "夏〜秋", choices: ["夏〜秋","冬","春さきだけ","一年中同じ"] },
      { q: "沖縄県の 県庁所在地は？", answer: "那覇市", choices: ["那覇市","名護市","石垣市","浦添市"] },
      { q: "日本を ながれる いちばん長い川は？", answer: "信濃川", choices: ["信濃川","利根川","石狩川","北上川"] },
      { q: "月の 形が 毎日 少しずつ かわるのを 何という？", answer: "月の満ち欠け", choices: ["月の満ち欠け","日食","月食","流星"] },
      { q: "植物の 葉から 水が出ていくことを？", answer: "蒸散", choices: ["蒸散","光合成","呼吸","発芽"] },
      { q: "自動車の せいさんが さかんな県は？", answer: "愛知県", choices: ["愛知県","北海道","沖縄県","高知県"] },
      { q: "電気を 通すものは どれ？", answer: "鉄のクギ", choices: ["鉄のクギ","木のわりばし","ガラスのコップ","プラスチックのじょうぎ"] },
      { q: "日本で いちばん 面積が 大きい都道府県は？", answer: "北海道", choices: ["北海道","岩手県","福島県","長野県"] },
      { q: "太陽が のぼる方角は？", answer: "東", choices: ["東","西","南","北"] },
    ],
  },
};

/* バッジ定義 */
const BADGES = [
  { id: "first",     emoji: "🌱", name: "はじめの一歩", desc: "はじめて クリア" },
  { id: "streak3",   emoji: "🔥", name: "3日れんぞく",  desc: "3日つづけた" },
  { id: "streak7",   emoji: "⭐", name: "7日れんぞく",  desc: "7日つづけた" },
  { id: "perfect",   emoji: "💯", name: "ぜんもん正かい", desc: "10問ぜんぶ正かい" },
  { id: "coins100",  emoji: "🪙", name: "コイン100",   desc: "コイン100まい" },
  { id: "coins500",  emoji: "👑", name: "コイン500",   desc: "コイン500まい" },
  { id: "math50",    emoji: "🧮", name: "さんすう名人", desc: "算数を50問" },
  { id: "allsubj",   emoji: "🌈", name: "ぜん教科",     desc: "4教科ぜんぶ体けん" },
  { id: "review10",  emoji: "🩹", name: "ふくしゅう王", desc: "にがてを10問こくふく" },
  { id: "shopper",   emoji: "🛍️", name: "はじめてのお買いもの", desc: "ショップで こうかん" },
  { id: "writer",    emoji: "✍️", name: "かきとり名人", desc: "20文字れんしゅう" },
];

/* 教科メニュー */
const SUBJECTS = {
  g1: [
    { id: "math",    emoji: "🧮", name: "さんすう", desc: "たしざん・ひきざん・とけい" },
    { id: "kokugo",  emoji: "🈵", name: "こくご",   desc: "ひらがな・かん字" },
    { id: "english", emoji: "🔤", name: "えいご",   desc: "あいさつ・かず・いろ" },
    { id: "other",   emoji: "🔬", name: "クイズ",   desc: "せいかつ・しぜん" },
  ],
  g5: [
    { id: "math",    emoji: "🧮", name: "算数",     desc: "分数・小数・割合・面積" },
    { id: "kokugo",  emoji: "📖", name: "国語",     desc: "漢字・四字熟語・慣用句" },
    { id: "english", emoji: "🔤", name: "英語",     desc: "単語・曜日・意味" },
    { id: "other",   emoji: "🌏", name: "理科・社会", desc: "都道府県・しくみ" },
  ],
};

/* ===== ショップ：アバター＆テーマ（コインでこうかん） ===== */
const SHOP = {
  avatars: [
    { id: "kid",     emoji: "🧒", name: "こども",     price: 0 },
    { id: "cat",     emoji: "🐱", name: "ねこ",       price: 50 },
    { id: "dog",     emoji: "🐶", name: "いぬ",       price: 50 },
    { id: "rabbit",  emoji: "🐰", name: "うさぎ",     price: 80 },
    { id: "bear",    emoji: "🐻", name: "くま",       price: 80 },
    { id: "fox",     emoji: "🦊", name: "きつね",     price: 120 },
    { id: "panda",   emoji: "🐼", name: "パンダ",     price: 120 },
    { id: "penguin", emoji: "🐧", name: "ペンギン",   price: 150 },
    { id: "lion",    emoji: "🦁", name: "ライオン",   price: 200 },
    { id: "unicorn", emoji: "🦄", name: "ユニコーン", price: 300 },
    { id: "dragon",  emoji: "🐉", name: "ドラゴン",   price: 400 },
    { id: "robot",   emoji: "🤖", name: "ロボット",   price: 400 },
  ],
  themes: [
    { id: "orange", name: "サンオレンジ", price: 0,
      vars: { "--bg":"#fff7ec","--bg2":"#ffe9cf","--ink":"#3a2b1a","--ink-soft":"#7a6a55","--orange":"#ff8a3d","--orange-d":"#ef6c1a","--card":"#ffffff" } },
    { id: "ocean", name: "うみブルー", price: 100,
      vars: { "--bg":"#eaf6ff","--bg2":"#cfe9ff","--ink":"#173049","--ink-soft":"#5b7186","--orange":"#3aa0ff","--orange-d":"#1f7fd8","--card":"#ffffff" } },
    { id: "forest", name: "もりグリーン", price: 100,
      vars: { "--bg":"#eefaef","--bg2":"#d3f0d6","--ink":"#1e3a24","--ink-soft":"#5e7a63","--orange":"#34c759","--orange-d":"#24a047","--card":"#ffffff" } },
    { id: "sakura", name: "さくらピンク", price: 150,
      vars: { "--bg":"#fff0f5","--bg2":"#ffd9e6","--ink":"#4a2333","--ink-soft":"#8a6572","--orange":"#ff6fa5","--orange-d":"#e84f89","--card":"#ffffff" } },
    { id: "grape", name: "ぶどうパープル", price: 150,
      vars: { "--bg":"#f4efff","--bg2":"#e2d5ff","--ink":"#2e2246","--ink-soft":"#6d6386","--orange":"#a06bff","--orange-d":"#7f45e0","--card":"#ffffff" } },
    { id: "night", name: "よぞらダーク", price: 250,
      vars: { "--bg":"#1e2233","--bg2":"#141826","--ink":"#f2f4fb","--ink-soft":"#a6adc4","--orange":"#ffb03d","--orange-d":"#e88a12","--card":"#2a2f45" } },
  ],
};

/* ===== かきとり（手書きなぞり練習）用の文字セット ===== */
const _chars = (s) => s.split("").map((c) => ({ c, yomi: c }));
// 「漢字(よみ)」形式の文字列 → [{c,yomi}]
const _kanji = (s) => s.trim().split(/\s+/).map((t) => {
  const m = t.match(/^(.)[（(](.+)[）)]$/);
  return m ? { c: m[1], yomi: m[2] } : { c: t[0], yomi: t[0] };
});

const WRITING_SETS = {
  g1: [
    { id: "hira", emoji: "あ", name: "ひらがな",
      chars: _chars("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん") },
    { id: "kata", emoji: "ア", name: "カタカナ",
      chars: _chars("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン") },
    { id: "kanji", emoji: "一", name: "かん字（1年）",
      chars: _kanji(`一(いち) 右(みぎ) 雨(あめ) 円(えん) 王(おう) 音(おと) 下(した) 火(ひ) 花(はな) 貝(かい)
        学(がく) 気(き) 九(きゅう) 休(やすむ) 玉(たま) 金(かね) 空(そら) 月(つき) 犬(いぬ) 見(みる)
        五(ご) 口(くち) 校(こう) 左(ひだり) 三(さん) 山(やま) 子(こ) 四(し) 糸(いと) 字(じ)
        耳(みみ) 七(しち) 車(くるま) 手(て) 十(じゅう) 出(でる) 女(おんな) 小(ちいさい) 上(うえ) 森(もり)
        人(ひと) 水(みず) 正(ただしい) 生(いきる) 青(あお) 夕(ゆう) 石(いし) 赤(あか) 千(せん) 川(かわ)
        先(さき) 早(はやい) 草(くさ) 足(あし) 村(むら) 大(おおきい) 男(おとこ) 竹(たけ) 中(なか) 虫(むし)
        町(まち) 天(てん) 田(た) 土(つち) 二(に) 日(ひ) 入(はいる) 年(とし) 白(しろ) 八(はち)
        百(ひゃく) 文(ぶん) 木(き) 本(ほん) 名(なまえ) 目(め) 立(たつ) 力(ちから) 林(はやし) 六(ろく)`) },
  ],
  g5: [
    { id: "kanji_a", emoji: "漢", name: "漢字（5年）その1",
      chars: _kanji(`賀(ガ) 快(こころよい) 慣(なれる) 眼(まなこ) 基(もと) 寄(よる) 規(キ) 技(わざ)
        逆(ぎゃく) 久(ひさしい) 旧(キュウ) 居(いる) 許(ゆるす) 境(さかい) 均(キン) 禁(キン)
        句(ク) 群(むれ) 経(へる) 潔(いさぎよい)`) },
    { id: "kanji_b", emoji: "字", name: "漢字（5年）その2",
      chars: _kanji(`件(ケン) 券(ケン) 険(けわしい) 検(ケン) 限(かぎる) 現(あらわれる) 減(へる) 故(ゆえ)
        個(コ) 護(ゴ) 効(きく) 厚(あつい) 耕(たがやす) 鉱(コウ) 構(かまえる) 興(おこる)
        講(コウ) 混(まじる) 査(サ) 際(きわ)`) },
  ],
};
