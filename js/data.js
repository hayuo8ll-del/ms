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
    ],
    // えいご：あいさつ・数・いろ
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
    ],
  },

  g5: {
    // 国語：漢字の読み・四字熟語・慣用句
    kokugo: [
      { q: "「快晴」の読みは？", answer: "かいせい", choices: ["かいせい","かいばれ","こころよい","はれま"] },
      { q: "「往復」の読みは？", answer: "おうふく", choices: ["おうふく","おうもど","ゆきかえり","おうへん"] },
      { q: "「efficient=効率」の「効」を使う熟語は？", answer: "効果", choices: ["効果","功績","校庭","交代"] },
      { q: "「暴風」の読みは？", answer: "ぼうふう", choices: ["ぼうふう","あばれかぜ","ばくふう","ぼうかぜ"] },
      { q: "四字熟語「一石二□」の□は？", answer: "鳥", choices: ["鳥","羽","石","矢"] },
      { q: "四字熟語「十人十□」の□は？", answer: "色", choices: ["色","人","様","面"] },
      { q: "四字熟語「絶体絶□」の□は？", answer: "命", choices: ["命","体","対","望"] },
      { q: "「花を持たせる」の意味は？", answer: "手がらをゆずる", choices: ["手がらをゆずる","じゃまをする","急いで帰る","花をかざる"] },
      { q: "「油を売る」の意味は？", answer: "むだ話をしてなまける", choices: ["むだ話をしてなまける","一生けん命はたらく","油をこぼす","料理をする"] },
      { q: "「河口」の読みは？", answer: "かこう", choices: ["かこう","かわぐち","がこう","かくち"] },
      { q: "「規則」の読みは？", answer: "きそく", choices: ["きそく","きぞく","のりのり","ていそく"] },
      { q: "「複数」の対義語は？", answer: "単数", choices: ["単数","少数","多数","分数"] },
    ],
    // 英語：単語・意味
    english: [
      { q: "「science=理科」。「social studies」の意味は？", answer: "社会", choices: ["社会","算数","音楽","体育"] },
      { q: "「うれしい」は英語で？", answer: "happy", choices: ["happy","sad","angry","sleepy"] },
      { q: "「月曜日」は英語で？", answer: "Monday", choices: ["Monday","Sunday","Friday","Tuesday"] },
      { q: "「Wednesday」は何曜日？", answer: "水曜日", choices: ["水曜日","木曜日","火曜日","土曜日"] },
      { q: "「学校」は英語で？", answer: "school", choices: ["school","house","park","shop"] },
      { q: "「先生」は英語で？", answer: "teacher", choices: ["teacher","student","doctor","driver"] },
      { q: "「大きい」は英語で？", answer: "big", choices: ["big","small","long","short"] },
      { q: "「What time is it?」の意味は？", answer: "何時ですか？", choices: ["何時ですか？","元気ですか？","名前は？","どこ？"] },
      { q: "「12」は英語で？", answer: "twelve", choices: ["twelve","twenty","eleven","two"] },
      { q: "「figure=図」。「triangle」の意味は？", answer: "三角形", choices: ["三角形","円","四角形","直線"] },
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
