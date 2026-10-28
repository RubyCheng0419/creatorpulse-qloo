# Teammate B（懷疑派）對 A、C 的批判

日期：2026-10-28（台北）。沒有新的 API call，用的都是已存的回應：
- 我的 4 次 production run：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-B\`
- C 的 Apple discover：`...\scratchpad\debate-C\r3_discover_apple.raw`

我把 A 的 `proposal()` 原樣複製進 `...\debate-B\applyA.mjs`，敏感度在 `...\debate-B\applyA-sens.mjs`。下面標「A」的數字都是我依 A 規則重算的，**不是 API 實際回傳的分數**。

---

## 1. A 的公式套到 live 資料上

| 結果 | 今天 | A | A 的處置 |
|---|---|---|---|
| Apple × MKBHD（1a、1b 相同） | 75 | 74.8 | Medium（D=5） |
| Apple × DemolitionRanch | 61（60.8） | 61.9 | Low：灰字 unverified |
| Samsung discover 10 位 | 46–69 | 46.6–69.0（僅供對照） | **10/10 不給分**（D=0） |

**(1) 0.30 本行權重會灌水嗎？Match 不明顯，Discover 灌的對象也不是科技創作者。**
- 先把 A 的公式改成 base 等權（e、t 照 A 的規則），跟 A 原版比，本行權重帶來的差異是：MKBHD +0.8、Demolition +0.9。
- Samsung 上加最多的是 Germán，+3.2。但他的 Tech 89 來自 WhatsApp 0.953、Google Maps 0.949、Facebook 0.944、Google 0.927：這些是大眾 app，Germán 也不是科技創作者。
- Germán 對 #2 的領先：今天 6 分，A 是 4.6 分，其中 2.2 分來自本行權重（base 等權時只領先 2.4）。結果是 A 把「Youtube 撐起來的領先」換成了「WhatsApp 撐起來的領先」。

**(2)「沒有點名實體 ×0.5」不公平嗎？在 Discover 是空轉，在 Match 會把權重集中到少數實體上。**
- Discover 每個維度都是純 proxy，e 一律是 0.5，正規化後互相抵銷，對分數沒有影響。真正讓 Discover 出局的是硬門檻（見 (3)）。
- 以 channel 為輸入的 Demolition：Tech 加 Lifestyle 吃掉 **62%** 權重，背後只有 4 個 direct。其中 Lifestyle 唯一的 direct 是 World Of Warships（`brand:games` 沒有對到，掉進預設值）。
- 每次拿掉一個 direct 實體，Fit 的範圍：今天是 60.4–63.6，A 擴大成 **60.9–65.5**。

**(3) 「direct < 3 → 不給分」：Samsung 整份排名 10/10 消失。**
- Discover 一律是 audience basis，0 個 direct，所以任何品牌都不會有分數。C 那份已經通過驗證的 Apple 排名（MKBHD #1、79 分）也會整頁空白。A 的文件完全沒有提到 Discover。
- 另一個問題：A 的 guard 用的是 snapshot，D=9；今天 live 只有 **D=5**，剛好卡在 Medium 的門檻。5 個 direct 拿掉任何一個，D 都會變 4，信心掉成 Low、標 unverified（5/5 都是）。換句話說，只要一次 429，demo 主例就會變 unverified。

**(4) Food & Travel 的拖累：沒解決。**
- Samsung 在 A 下，F&T 正規化後的權重是 0.198–0.273（今天是 0.20–0.25）。原因是 Lifestyle 很薄、被 t 縮小後，空出來的權重又流回了 F&T。
- 平均 Fit 只從 59.0 變 59.3；verdict 檔位只動了 1 位，而且是往下（Josh Peck medium → low）。對照組：直接拿掉 F&T，平均 +8.7，4 位升檔。
- A 只在 Match 把 F&T 降到 0.119，但 Match 的最弱維度本來就不是 F&T（MKBHD 72、Demolition 54）。

**(5) Lifestyle 預設值：只修好一半。**
- Discover：Lifestyle 只有一個平台實體（n=1）的那幾位，Lifestyle 權重從 0.20 降到 0.066，有效。不過同樣在 A 的權重下把 n<3 的 Lifestyle 整個拿掉，Germán 仍然領先 3.2 分（67.7 對 64.5）。
- Match 反而放大了：MKBHD 的 Lifestyle 3 個實體**全部**是被預設值歸進去的（Dbrand、Hagerty 沒有 genre，Unbox Therapy 只有 website）。其中 2 個是 direct，所以 e=1，權重從 0.20 **升到 0.237**。光拿掉 Hagerty，A 就從 74.8 變 **77.9**。
- A 只處理了「品牌本行」的預設值，實體掉進 Lifestyle 預設值和 `games` 沒有對照，這兩件都沒碰。

## 2. C：只改標示夠不夠

**(1) 我實測的 13 筆結果，在 C 的條件下有幾筆是 Unverified：寬鬆算 11/13，嚴格算 13/13。**
- Samsung 10/10：R2（not-validated）。El Rubius 另外還中 R3（`channel: null`）。
- Demolition：中 U3（PDS Debt `429 → 429 gave up`）和 U5（Low）。
- MKBHD 1a、1b：U1–U3、U5 都通過。U4 要看怎麼算：C 自己寫了 Huggies 控制組因為 429「不能背書」，而且 Match 的 margin 5 小於重跑波動 6（P6）。照 C 自己的邏輯，Apple 在 videos basis 目前沒有乾淨的控制組，所以嚴格來說 U4 也成立。
- 評審自己輸入的品牌：因為 U4／R2，**100%** Unverified。

我自己的條件 1–5 也只留下 MKBHD，所以我反對的不是「標得太多」。我反對的是：U4／R2 判斷的是**品牌**，不是**這一筆結果**。結果就是 Demolition（429、D=4、離門檻 0.8 分）和一筆證據完整的結果，掛的是同一個紅標，標示本身不再提供任何資訊。至少要拆成兩種原因碼：「沒有控制組」和「證據破損」。

**(2) F&T 拖累和 Lifestyle 預設值，剛好留在 demo 畫面上。**
C 的 Apple discover 是 validated，照 C 的規則不會掛標。但用 C 自己的 raw 資料算：
- 10/10 的最弱維度是 F&T。
- 8/10 至少有一個維度 n<3。
- **6/10 的 Lifestyle 只有一個被預設值歸進去的平台**：Unbox Therapy、Youtube，以及 4 次 Twitch。

結果只有 Logan Paul 一位會被 R3 標出來，其他 **9/10 照常以「已驗證」的樣子顯示**，兩個缺陷都在。Match 的主例 MKBHD，Lifestyle 63 也是 3/3 預設值，同樣沒有任何標示。

**(3) R5 的平手規則可能替假象背書。**
- Samsung 相鄰名次的分差依序是 6、0、2、1、0、1、3、3、7。照 R5，Germán 會單獨站在第一級。
- 但他這 6 分的領先主要來自 Youtube：把 n<3 的維度拿掉，只剩 0.5 分。
- R5 只看分差，不看領先是靠什麼證據撐起來的。（Apple discover 裡 MKBHD 領先 10 分，拿掉 n<3 後是 78.3 對 66.8，仍然成立，沒有問題。）

**(4) 我自己這邊的代價，也要講清楚。** 我提的第 2 項修正（預設值掉進來的實體不計分）會讓 MKBHD 從 75 變 78，超出 C 的 69–75 基準，C 說「改了就會讓基準作廢」在這裡成立。如果不想動基準，退一步的做法是：分數照算，但這些實體**不能**被當成最強／最弱維度，也不能拿來產生內容建議。這只改顯示，不改數字，跟 C 的 P5 是同一個方向。

## 3. 最該先回答的三題

1. **（最優先）Find creators 還要不要出分數？** 照 A 的規則，Discover 整頁不給分；照 C 的規則，它會照常顯示，而且不掛標。兩個方案在這一點上直接衝突，不先定這題，其他討論都沒有對象。
2. **Unverified 要以品牌為單位，還是以結果為單位？** 我建議拆原因碼，否則評審每次輸入看到的都是同一個紅標。
3. **MKBHD 的 live D=5 剛好在門檻上。** 在 freeze 前要先無 429 地重跑 2 次，確認 D 穩定 ≥ 5，再談要不要改權重。
