# Teammate B（懷疑派）：brand-led 評分公式辯論

日期：2026-10-28（台北）。Feature freeze：10/30 晚上（台北）。
我的立場：現行公式在 MKBHD 這類強例子上看起來沒問題，**但它不會告訴你自己什麼時候不可靠**。我的論點只根據下面這 4 次 production 實測，以及我從 API 回傳的 entity 依 `lib/scoring.ts` 規則重算的結果（重算值與 API 的 dimension 分數逐一相符，Fit 只差四捨五入）。

原始回應與腳本（不在 repo 內）：
`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-B\`
- `run1-apple-mkbhd-a.raw.txt`, `run1-apple-mkbhd-b.raw.txt`, `run2-samsung-discover.raw.txt`, `run3-apple-demolitionranch.raw.txt`（每個檔各配一個 `.meta.json`，記錄 request body、HTTP status、時間）
- `call.mjs`（呼叫 API）、`summ-match.mjs`、`summ-disc.mjs`、`analyze-disc.mjs`、`analyze-disc2.mjs`、`analyze-match.mjs`、`recompute.mjs`、`affstats.mjs`（拆解與重算）

四次 call 都回 HTTP 200，Content-Type 都是 `application/json`，沒有 streaming。

---

## 1. 實測結果

### Run 1：Apple × MKBHD（5 支影片，`live:true`），跑 2 次

| | Run 1a | Run 1b |
|---|---|---|
| 開始時間（UTC / 台北） | 01:46:11Z / 09:46:11 | 01:47:04Z / 09:47:04 |
| `liveRun` / trace 中 cached 的筆數 | true / 0 | true / 0 |
| Fit | **75** | **75** |
| Confidence | Medium（basis：5 entities、5 dimensions） | 同左 |
| Tech & Innovation | 79（n=7：3 direct + 4 proxy） | 79（n=7） |
| Film, TV & Entertainment | 87（n=10：全部 proxy） | 87（n=10） |
| Music | 75（n=5：全部 proxy） | 75（n=5） |
| Lifestyle & Fashion | **63**（n=3：Dbrand d、Hagerty d、Unbox Therapy p） | **63**（n=3） |
| Food & Travel | 72（n=10：全部 proxy） | 72（n=10） |

- 兩次跑出來的 spread = **0**：每個 dimension、每個 entity 的 affinity 都一樣。
- 使用者記得的「Lifestyle & Fashion 53」**這次沒有重現**，兩次都是 63。我沒辦法說明 53 是怎麼來的，所以後面不拿它當論據。
- 兩次都出現同一件事：Gemini 額度用完（trace：Gemini “request quota is used up”），改由 Groq 抽名字。LLM 提了 13 個名字，Qloo 確認 6 個（含 Apple Inc 本身），計分的 named entity 有 5 個。

### Run 2：Samsung 的 Find creators（`creatorCategory:"any"`）

開始 01:46:27Z（台北 09:46:27）；`liveRun:false`，但 trace 93 筆裡 cached 為 **0**；有 12 筆以上是 `429 → 200 (retried)`。validation：`not-validated`（這個品牌沒有對照組）。

| # | Creator | Fit | Conf | Tech | Film/TV | Music | Lifestyle | Food & Travel | 最強 | 最弱 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Germán Garmendia | **69** | Medium | **89** (n4) | 79 (n10) | 69 (n5) | 88 (**n1：Youtube**) | **18** (n10) | Tech 89 | F&T 18 |
| 2 | El Rubius | 63 | Medium | 71 (n3) | 80 (n11) | 66 (n5) | 63 (**n1：Twitch**) | 36 (n10) | Film/TV 80 | F&T 36 |
| 3 | byViruZz | 63 | Medium | — (n0) | 81 (n12) | 66 (n5) | 74 (n3) | 32 (n10) | Film/TV 81 | F&T 32 |
| 4 | DjMaRiiO | 61 | Medium | 71 (n3) | 78 (n11) | 66 (n5) | 63 (**n1：Twitch**) | 29 (n10) | Film/TV 78 | F&T 29 |
| 5 | Mangel | 60 | Medium | 71 (n3) | 69 (n11) | 66 (n5) | 63 (**n1：Twitch**) | 31 (n10) | Tech 71 | F&T 31 |
| 6 | Josh Peck | 60 | Medium | 63 (n3) | 56 (n10) | 70 (n5) | 88 (**n1：Youtube**) | 25 (n11) | Lifestyle 88 | F&T 25 |
| 7 | Vegetta777 | 59 | Medium | 62 (n5) | 73 (n10) | 68 (n5) | — (n0) | 31 (n10) | Film/TV 73 | F&T 31 |
| 8 | Luzu | 56 | Medium | 71 (n3) | 55 (n11) | 62 (n5) | 63 (**n1：Twitch**) | 31 (n10) | Tech 71 | F&T 31 |
| 9 | Fernanfloo | 53 | Medium | 51 (n5) | 77 (n10) | 66 (n5) | — (n0) | 18 (n10) | Film/TV 77 | F&T 18 |
| 10 | Simon Minter | 46 | Medium | — (n0) | 58 (n12) | 57 (n5) | 38 (n2) | 30 (n11) | Film/TV 58 | F&T 30 |

每位 creator 的 confidenceBasis 都是 30 entities；有 5 位跨 5 個 dimensions，3 位只跨 4 個。

跟使用者記得的數字對照：
- 「Germán #1 68、Tech 88、F&T 17」：**不完全重現**。實測是 #1 **69**、Tech **89**、F&T **18**，三個數字都差 1。
- 「10 位 creator 的最弱 dimension 都是 F&T，分數 17–34」：「10/10 最弱都是 F&T」**有重現**；但實測區間是 **18–36**，不是 17–34。

### Run 3：Apple × @DemolitionRanch（沒有 `live`）

開始 01:46:45Z（台北 09:46:45）；`liveRun:false`；trace 66 筆裡 20 筆 cached。

| | |
|---|---|
| Fit | **61**（重算值 60.8，verdict = medium） |
| Confidence | **Low**（basis：**4** entities、5 dimensions） |
| creator.entities（Qloo 確認） | 4 個：SimpliSafe、Ford Motor Company、World Of Warships、Amazon |
| Tech & Innovation | 66（n=6：3 direct + 3 proxy） |
| Film, TV & Entertainment | 81（n=10：全部 proxy） |
| Music | 53（n=5：全部 proxy） |
| Lifestyle & Fashion | 50（n=3：World Of Warships d、Ebay p、Dollar Shave Club p） |
| Food & Travel | 54（n=10：全部 proxy） |
| warnings | `1 keyword lookups failed in Qloo (PDS Debt): Qloo returned 429` |

跟早上那次 production 結果對照：Fit 61 與 Low **有重現**；「5 個確認 entity，但 confidence 說只算了 3 個 named entity」**沒有重現**，這次確認 4 個、basis 也是 4，兩者一致。這次有一個名字（PDS Debt）因為 429 沒查到，Gemini 也一樣額度用完、改用 Groq。已知有一個會讓兩個數字對不上的原因：`creator.entities` 會把品牌本身也列進去（MKBHD 列了 6 個含 Apple Inc，basis 是 5），但這只能解釋差 1，解釋不了早上 5 對 3 的差距。早上那次沒有存 raw，我沒辦法驗證。

賽先生科學工廠 × Dr Julie（59 分）沒有留下輸入，所以**沒有重跑，也不引用**。

---

## 2. 攻擊

### (a) 五個 dimension 等權重平均，會不會把每個分數都往下拉？

**Discover 會，而且是系統性的；Match 則不一定。**

- Samsung discover 裡 F&T 的 102 個 entity，有 **97 個**的 affinity 低於 0.70（clash 那一級）；其他四個 dimension 合計 198 個 entity，只有 **6 個**低於 0.70。F&T 的 affinity 平均是 0.639，其他 dimension 是 0.83–0.85。
  換句話說，「clash」這個標籤在 Find creators 的 F&T 上幾乎每個都會亮，它量到的是 F&T 這個類型本身的分布，不是這位 creator 跟品牌合不合。
- F&T 裡實際放的是什麼：creator 觀眾所在地的在地地點，例如 Valladolid、Zaragoza、Viña del Mar，以及 `Europe/Madrid`（這是一個時區）、一家 CDMX 的墮胎診所、警用裝備行、電子菸店、Movistar Plus、MARCA，另外還有 Oreo、G Fuel 這兩個 brand。這比較接近**觀眾的地理位置**，而不是「飲食與旅遊品味」，但它還是吃掉 20% 權重。
- 量化（把 F&T 拿掉、其他四個 dimension 等權）：10 位 creator 的 Fit **平均 +8.7**（59.0 → 67.7），範圍 +5.3（Simon Minter）到 **+12.7**（Germán）。
  - **verdict 檔位變了 4/10**：Germán 69 → 81（medium → **high**）；Vegetta777 59 → 68、Luzu 56 → 63、Fernanfloo 53 → 65（三位都從 low → **medium**）。
  - 排名：#2/#3 對調（El Rubius ↔ byViruZz）、Josh Peck 從 6 升到 5、Mangel 從 5 掉到 7、Fernanfloo 跟 Luzu 互換 8/9。README 寫的 `top3Without` 也記錄了 #2/#3 這次對調。
- Match 裡 F&T 不是最弱：MKBHD 是 72，Demolition 是 54；兩次 match 的最弱 dimension 其實都是 **Lifestyle**（63、50）。所以「F&T 普遍偏弱」是 **Discover 的 profile 結構造成的**，不是所有流程共有的現象。
- 反方向的偏差也存在：Film/TV 在每一次 run 都偏高（MKBHD 87、Demolition 81，Samsung 10 位裡有 6 位最強的是它）。原因是幾乎每個人都會分到同一批漫威片（Venom、Avengers: Endgame、Deadpool 2、Captain Marvel 在 MKBHD 和 6 位西語／美國 creator 身上反覆出現）。一個區分不出 creator 的 dimension 也吃 20%。

**結論**：等權平均本身不是唯一的問題。真正的問題是**全部 dimension 共用同一個 calibration floor（0.5）**，但各類型 affinity 的分布差很多。F&T 只要偏移 ~0.2，就會在**絕對檔位**上（60/80 的 verdict 門檻）把分數整批往下拉，而 verdict 正是使用者實際拿來看的東西。排名受的影響比較小，因為大家一起被拉低。

### (b) 只靠 1–2 個 entity 算出來的 dimension，配得上 20% 權重嗎？

**配不上，而且實測裡這些 dimension 常常根本不是那個 dimension。**

- Samsung：10 位裡有 **7 位**至少有一個 dimension 的 n ≤ 2，各自都佔 20–25% 權重。其中 6 位的 Lifestyle & Fashion **只有一個 entity，而且是平台**：Youtube（0.938 → 88）或 Twitch（0.816 → 63）。這兩個 brand 的 genre 只有 `mobile_app` / `website` / `streaming_service`，沒有任何 genre 投票，所以掉進 `dimensionOf()` 的**預設值 `'lifestyle'`**。Simon Minter 的 Pro:direct Soccer（`brand:retail`）也是同樣情況。
  - Germán 的 #1 有一部分就是來自「Samsung 的觀眾喜歡 YouTube」。把 n < 3 的 dimension 排除後，Germán **63.8** 對 El Rubius **63.3**，領先從 6 分縮到 **0.5 分**。Josh Peck 從 #6 掉到 #8（60 → 53.5）。
- MKBHD 的 Lifestyle & Fashion（n=3）**三個 entity 全部是預設值掉進來的**：Dbrand（genres = []）、Hagerty（genres = []）、Unbox Therapy（只有 `brand:website`）。裡面沒有任何 fashion 或 lifestyle 的證據，卻佔 20%。單一 entity 的影響：拿掉 Hagerty，Lifestyle 63 → **75**；拿掉 Dbrand，63 → 58。把這三個「未分類」排除後，Fit 75 → **78**。
- Demolition 的 Lifestyle：World Of Warships 的 genre 是 `brand:games`，對照表只有 `gaming`，所以它也掉到 Lifestyle；Ebay（retail/website）也是。真正屬於 lifestyle 的只有 Dollar Shave Club 一個。光拿掉 World Of Warships，Fit 就從 61 變 **63.6**。
- 「用 itemCount 加權」不能直接解決：我照 itemCount 加權重算 Samsung，#1 變成 El Rubius，Germán 掉到 #3，因為 n=10、而且系統性偏低的 F&T 被放大了。**用 n 加權會把 (a) 變得更嚴重**；n < 3 不計分則不會。

### (c) 什麼時候應該顯示「Unverified — do not use for a decision」，不給分數？

只用目前 response 裡已有的欄位就能判斷（`trace`、`warnings`、`confidenceBasis`、dimension 的 `itemCount`、entity 的 `genres`），不需要新的 endpoint：

1. **證據不完整**：在 creator 或 score 階段，只要有任何一個 Qloo query 最後還是失敗（`429 → 429 (gave up)`、timeout），而且失敗的是會進入計分的名字或 type，就標 Unverified，並提示重跑。→ Demolition 這次因為 PDS Debt 的 429 會被標。現行做法只放一行 warning，Fit 61 照樣顯示，verdict 照樣是 medium。
2. **Named evidence 太少**：計分的 direct entities 少於 5（也就是 Confidence 為 Low）時，**不給 verdict 字樣**（high/medium/low），只顯示數字並加上 unverified 標記。→ Demolition（4 個）。
3. **卡在門檻邊緣**：Fit 落在 verdict 門檻（40/60/80）±2 以內，而且 Confidence 不是 High，就不給 verdict。→ Demolition 60.8 離 60 只差 0.8；拿掉任一個 named entity，Fit 會在 60.4 到 63.6 之間移動。
4. **排名第一不穩**：拿掉任何一個 n < 3 的 dimension，或任何一個「未分類」entity，#1 跟 #2 的差距就掉到 validation margin（5）以下的話，這次排名就標 Unverified。→ Samsung 只要拿掉 Youtube，差距就變 0.5。
5. **太多權重靠薄弱或錯置的證據**：如果有 ≥ 40% 的 Fit 權重（5 個 dimension 中的 2 個）是 n < 3，或是由「沒有任何 genre 投票、靠預設值歸類」的 entity 組成，就標 Unverified。

如果只套用條件 1–5，**MKBHD 仍然有分數（Fit 75，排除未分類後是 78）**，Demolition 和 Samsung 的排名則都會被標 Unverified。這是我要的結果：demo 的正例照常成立，可疑的結果不會被拿去做決策。

---

## 3. freeze 前成本最低的修正（我會投票支持）

1. **n < 3 的 dimension 不計入 Fit**（顯示出來，但標「證據不足、未計分」），剩下的 dimension 等權重新分配。這個邏輯在 `dimensions.filter(d => d.score !== null)` 已經有了，只要多加一個條件。
2. **沒有 genre 投票的 brand 不要預設成 Lifestyle**，改放進「Unclassified：shown, not scored」。另外把 `games` 補進對照表（→ entertainment）。
3. **上面的 (c) 1–4 都做成顯示規則**，不動計分的數學。

我**不**支持在 freeze 前做 per-dimension 的 calibration（例如每個 type 各自設 floor）：只有一個品牌的 discover 資料可用，任何新的 floor 都是用 n=1 個品牌調出來的。

## 4. 我論點的弱點（先自己講清楚）

- 每個 case 只有 1–2 次 run，Samsung 只跑 1 次。兩次 MKBHD 完全一樣，代表在同一個時間窗內是決定性的，但不代表跨天也穩定（使用者記得的 53 和「差 1」都顯示有某種漂移，我沒抓到它的成因）。
- 「F&T 量到的是地理位置」是我依 entity 名稱下的判斷，不是 Qloo 提供的標記。在地點對品牌來說也可能真的有意義（例如 Samsung 的觀眾不在智利）。我主張的只是：它不該跟 taste dimension 用同一把尺、拿同樣的 20%。
- 上面所有的「拿掉 X 後的 Fit」都是我從 response 裡的 entity 依 `lib/scoring.ts` 重算的，**不是 API 實際回傳的分數**。
