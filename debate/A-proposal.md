# Teammate A（公式派）提案：Evidence-weighted, brand-led Fit Score

撰寫日：2026-10-28｜依據：`C:\Users\user1\Claude\creatorpulse-qloo\lib\scoring.ts`、Qloo docs、三個已存真實結果（`C:\Users\user1\Claude\creatorpulse-qloo\data\demo-snapshot.json`、`C:\Users\user1\Claude\creatorpulse-qloo\data\demo-snapshot-mismatch.json`、`C:\Users\user1\Claude\creatorpulse-qloo\public\demo-compare.json`）。
重算腳本（不在 repo 內）：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-A\compute.js`（主表）、`...\debate-A\sens2.js`（敏感度）、`...\debate-A\pairs.js`（同實體 Apple vs Huggies 比對）。

---

## 0. 一句話

**維持 0–100、affinity 線性 rescale 與 direct 1 / proxy 0.5 不動；改的是「維度權重」：品牌本行維度 0.30、其餘 0.175，且一個維度的權重乘上「影片裡點名證據」係數（全靠 Qloo 擴展的維度只算一半）與「樣本厚度」係數（n<3 等比縮小，不是一刀切）。** 信心改成有明確公式的三級，Low 一律標「unverified — do not use for a decision」，創作者端直接點名實體 <3 一律不給分數（含 audience-only 路徑）。

---

## 1. 今天的公式（`lib/scoring.ts` 原樣描述）

| 項目 | 今天的規則 |
|---|---|
| 實體來源 | `ScoredEntity`：`side='direct'`（影片點名、經 Qloo /search 確認）或 `'proxy'`（Qloo 擴展），`brandAffinity` = 以品牌為 signal 的 Qloo affinity |
| 維度歸類 | `dimensionOf()`：先看 entity type（artist/album→music；movie/tv_show/podcast/videogame/book/person→entertainment；destination/place→food_travel）；brand 用 genre tag 頂層多數決（electronics/software/…→tech；health_and_beauty/fashion/home→lifestyle…），沒票→lifestyle |
| Rescale | `points(a) = clamp(0,100, (a − 0.5) / 0.5 × 100)`（`AFFINITY_FLOOR = 0.5`）|
| 實體權重 | `DIRECT_WEIGHT = 1`、`PROXY_WEIGHT = 0.5` |
| 維度分數 | 該維度實體 `points` 的加權平均，**先 `Math.round`**；沒實體 → `null`（排除，不當 0）|
| 維度權重 | **等權**：有資料的 k 個維度各 `1/k`（5 個都有 → 0.2）。n=3 的維度跟 n=11 的維度一樣重 |
| Fit Score | 已四捨五入的維度分數平均，再 `Math.round`（雙重四捨五入）|
| Divergence | 不另扣分（註解：低 affinity 已拉低平均，避免重複計算）|
| 三層標籤 | ≥0.85 intersection；0.70–0.85 weakLink；<0.70 divergence（只用於顯示）|
| Verdict | ≥80 high；≥60 medium；≥40 low；<40 no-match |
| 信心 | `entities` = `side==='direct'` 的數量；High：≥10 且 5 維都有資料；Medium：≥5；其他 Low。品牌端是 reference brand 時 `lowerConfidence()` 降一級 |
| 最低門檻 | `MIN_DIRECT_ENTITIES = 3` 宣告在此檔，但 `computeCompatibility()` 本身**不檢查**（由呼叫端執行；trace 有「Evidence threshold」規則步驟）。**沒有任何每維度最低數量** |

---

## 2. 我的提案

### 2.1 維度權重（brand-led）

- **品牌本行維度（home dimension）base = 0.30，其餘四個各 0.175**（總和 1）。
  home 由既有的 `dimensionOf(brand.entity)` 決定（Apple → tech；Huggies 的 genre `brand:health_and_beauty` → lifestyle）。品牌 genre 沒有任何一票能對應時（`dimensionOf` 會掉到 lifestyle 預設），**改用等權 0.2**，不讓預設值偷偷變成「本行」。
- **點名證據係數** `e_d = 0.5 + 0.5 × min(1, D_d / 2)`，`D_d` = 該維度 direct 實體數：
  0 個（純 Qloo 擴展）→ 0.5；1 個 → 0.75；≥2 個 → 1.0。
- **厚度係數** `t_d = min(1, n_d / 3)`，`n_d` = 該維度已計分實體總數（direct + proxy）。
- 有效權重 `w_d = base_d × e_d × t_d`，再對有資料的維度正規化：`Fit = Σ w_d·S_d / Σ w_d`，`S_d` 不先四捨五入，**只在最後 round 一次**。

→ 回答第 1 題：是的，少實體的維度會被降權（`t_d`），而且是連續縮小，不是 n<3 就整個丟掉（理由見 §4 敏感度：一刀切會產生 ±14 分的懸崖）。

### 2.2 Direct vs expansion/profile 實體權重

- **direct = 1.0；expansion proxy = 0.5；profile proxy（以創作者自己的 Qloo person 實體為 signal 拿到的 audience 實體）= 0.5**——維度內加權平均維持今天的數字。
- 折扣真正放在**維度層**（`e_d`），不是實體層。原因：在已存資料裡，proxy 權重從 0.5 改 0.4 或 0.33，Apple × MKBHD 只從 72.9 動到 72.7/72.5，Huggies 25.9 → 25.8（腳本變體結果）——因為 proxy 只在「direct 與 proxy 混在同一維度」時才跟 direct 競爭，而純 proxy 維度不論 proxy 權重多少，維度內平均都一樣。真正讓 proxy 主導總分的是「三個全靠 proxy 的維度在今天各占 20%」。
- profile proxy 另有一條硬規則（§2.5）：只靠 profile 的結果**不產生 Fit Score**。

### 2.3 信心公式（明確輸入與門檻）

輸入：
- `D` = 創作者端 direct 實體數（/search exact 或 alias 確認、且有 /v2/insights affinity；品牌本身被點名時不算）
- `C` = 證據覆蓋率 = `Σ base_d × e_d × t_d`（未正規化，範圍 0–1）
- `H_D`、`H_n` = 品牌本行維度的 direct 數與實體總數

| 等級 | 條件 |
|---|---|
| High | `D ≥ 10` 且 `C ≥ 0.75` 且 `H_D ≥ 2` |
| Medium | `D ≥ 5` 且 `C ≥ 0.50` 且 `H_n ≥ 3` |
| Low | 其餘（且 `D ≥ 3`）|
| 品牌端為 reference brand | 沿用 `lowerConfidence()` 降一級 |

`C ≥ 0.75` 的白話：本行維度有 ≥2 個點名 +「至少還有兩個其他維度也有點名」，或等價的組合；只有本行 + 一個其他維度有點名時 C = 0.7375，最多 Medium。

### 2.4 每維度最低實體數

- **n ≥ 3 才算「滿權重」**；n = 1、2 照算分但權重乘 1/3、2/3，UI 在該維度標「thin」。n = 0 → `null`，排除（不當 0，與今天相同）。
- 本行維度 `H_n < 3` → 信心不能高於 Low（即一律 unverified）。理由：品牌最在意的那一欄證據太薄，總分不該拿來做決定。

### 2.5 何時不給分 / 何時標 unverified

**不給分（`fitScore = null`, verdict `insufficient-data`）：**
1. 創作者端 `D < 3`（ground rule；品牌本身不計入）。
2. 品牌端可計分實體 < 3（品牌 signal 的 /v2/insights 結果不足）。
3. 有資料的維度 < 2。
4. **audience-only 路徑（如 Nikkie）也算 1.**：只有 1 個 direct（Sephora），分數完全由 Qloo person profile 撐起 → 不顯示 Fit Score 數字；可以顯示 profile 的維度明細，標題寫「Qloo audience profile — unverified, do not use for a decision」，不出 verdict 字樣。

**顯示數字但標「unverified — do not use for a decision」（灰字、不出 high/medium/low verdict 字樣）：**
- 信心 = Low（`D` 3–4、或 `C < 0.5`、或本行維度 `H_n < 3`、或 reference brand 把 Medium 降成 Low）。

### 2.6 為什麼這樣設計（論證）

1. **direct 實體的區辨力明顯且一致，純 proxy 維度不一致。** 同一批 MKBHD 實體在 Apple 與 Huggies 兩個 signal 下的 affinity 差（`pairs.js`）：
   - direct（Tesla、Asus、Dell、Dbrand、Hagerty，n=5）：平均掉 **0.30–0.31**。
   - proxy entertainment（Halt and Catch Fire、Captain Marvel、Venom…，n=7）：平均只掉 **0.072**——Huggies 的受眾對 Deadpool 2 的 affinity 0.879，幾乎跟 Apple 的 0.934 一樣。
   - proxy food_travel（Munnar、Kochi…，n=5）：掉 0.281，跟 direct 相近。
   所以 proxy 不是「沒用」，而是**有時有區辨力、有時只是在量熱門度**；今天讓三個純 proxy 維度各占 20%，就是讓 Huggies 的 entertainment 73 把 Huggies 總分撐到 37。半權是對「不確定是否在量真實契合」的保守處理，不是丟棄。
2. **Brand-led 的定義要落到權重上。** 品牌買的是「這個受眾在我這一行有沒有共鳴」；Huggies × MKBHD 的本行（lifestyle）是 5.7，這是全表最強的錯配證據，今天卻跟 music 43 同權。
3. **Qloo 官方對 affinity 的定義是 0 到 1 的關聯強度**，「+1 being a perfect match and 0 meaning no correlation」（docs.qloo.com/reference/affinity-score）；同頁也說分數的意義依使用情境而定，並建議把分數與實際相關性（real-world relevance）結合來看。「創作者在影片中真的點名」就是我們手上最直接的 real-world relevance，所以以它決定維度能吃多少權重。docs **沒有**說 affinity 能否跨不同 signal 比較——見 Known weaknesses。
4. **只動一個函式、不新增 Qloo 呼叫。** 所需資料（`side`、`dimension`、品牌 genre）`computeCompatibility()` 呼叫端都已經有；沒有新 endpoint、新參數或新實體。

---

## 3. 重算結果

### 3.1 今天的公式：重算 vs 已存 fitScore

| 配對 | 已存 fitScore | 我重算 | 一致？| 已存信心 / basis | 用 scoring.ts 規則推得的信心 |
|---|---|---|---|---|---|
| Apple × MKBHD（demo-snapshot）| 74 | 74 | ✅ | Medium / 9 entities, 5 dims | Medium ✅ |
| Huggies × MKBHD（demo-snapshot-mismatch）| 37 | 37 (36.8) | ✅ | Medium / 6, 5 | Medium ✅ |
| Apple × MKBHD（demo-compare）| 74 | 74 | ✅（實體與 affinity 與 demo-snapshot 完全相同）| Medium / 9, 5 | Medium ✅ |
| Apple × Linus Tech Tips | 76 | 76 (75.8) | ✅ | Medium / 7, 5 | Medium ✅ |
| Apple × NikkieTutorials | 55 | 55 (55.25) | ✅ 分數一致 | Medium / **30**, 4 | **不一致**：scoring.ts 的 `confidenceLevel` 只數 `side==='direct'`，此配對 direct = 0 → 應為 Low |

Nikkie 的落差原因：該筆 `scoreBasis = "audience"`，trace 最後一步寫明「30 Qloo entities scored at weight 0.5, same formula; confidence at most Medium」——也就是呼叫端把 30 個 profile 實體當成 confidence 的 entities 輸入，不是 scoring.ts 的 direct 計數。分數公式本身可重現，信心則是呼叫端另一套規則（我沒讀呼叫端程式，依任務限制只依 trace 文字判斷）。此外，該筆 warnings 有「Qloo matched only 1 taste entities, below the scoring minimum of 3」，卻仍出了 55 分——正是 §2.5 第 4 點要關掉的情況。

### 3.2 各維度明細（S = 維度分數；today 為四捨五入後整數；proposal 為未四捨五入；w = 正規化後權重）

**Apple × MKBHD**（home = tech；demo-snapshot 與 demo-compare 兩筆相同）

| 維度 | n (direct) | today S | today w | prop S | base × e × t | prop w |
|---|---|---|---|---|---|---|
| tech | 11 (7) | 75 | 0.20 | 74.6 | 0.30 × 1 × 1 | 0.407 |
| entertainment | 10 (0) | 87 | 0.20 | 86.7 | 0.175 × 0.5 × 1 | 0.119 |
| music | 5 (0) | 77 | 0.20 | 77.5 | 0.175 × 0.5 × 1 | 0.119 |
| lifestyle | 3 (2) | 63 | 0.20 | 63.1 | 0.175 × 1 × 1 | 0.237 |
| food_travel | 10 (0) | 68 | 0.20 | 68.4 | 0.175 × 0.5 × 1 | 0.119 |
| **Fit** | | **74** | | **73 (72.91)** | C = 0.7375 | 信心 Medium（D=9）|

**Huggies × MKBHD**（home = lifestyle）

| 維度 | n (direct) | today S | today w | prop S | base × e × t | prop w |
|---|---|---|---|---|---|---|
| tech | 8 (4) | 22 | 0.20 | 21.5 | 0.175 × 1 × 1 | 0.237 |
| entertainment | 10 (0) | 73 | 0.20 | 72.7 | 0.175 × 0.5 × 1 | 0.119 |
| music | 5 (0) | 43 | 0.20 | 43.2 | 0.175 × 0.5 × 1 | 0.119 |
| lifestyle | 3 (2) | 6 | 0.20 | 5.7 | 0.30 × 1 × 1 | 0.407 |
| food_travel | 10 (0) | 40 | 0.20 | 39.7 | 0.175 × 0.5 × 1 | 0.119 |
| **Fit** | | **37** (no-match) | | **26 (25.88)** (no-match) | C = 0.7375 | 信心 Medium（D=6）|

**Apple × Linus Tech Tips**（home = tech）

| 維度 | n (direct) | today S | today w | prop S | base × e × t | prop w |
|---|---|---|---|---|---|---|
| tech | 9 (5) | 77 | 0.20 | 77.1 | 0.30 × 1 × 1 | 0.407 |
| entertainment | 10 (0) | 86 | 0.20 | 86.0 | 0.175 × 0.5 × 1 | 0.119 |
| music | 5 (0) | 78 | 0.20 | 77.7 | 0.175 × 0.5 × 1 | 0.119 |
| lifestyle | 3 (2) | 63 | 0.20 | 62.5 | 0.175 × 1 × 1 | 0.237 |
| food_travel | 10 (0) | 75 | 0.20 | 74.9 | 0.175 × 0.5 × 1 | 0.119 |
| **Fit** | | **76** | | **75 (74.51)** | C = 0.7375 | 信心 Medium（D=7）|

**Apple × NikkieTutorials**（home = tech；audience basis，全部為 profile proxy）

| 維度 | n (direct) | today S | today w | prop S | base × e × t | prop w |
|---|---|---|---|---|---|---|
| tech | 0 | — | 0 | — | 0 | 0 |
| entertainment | 10 (0) | 59 | 0.25 | 58.9 | 0.175 × 0.5 × 1 | 0.25 |
| music | 5 (0) | 83 | 0.25 | 82.6 | 0.175 × 0.5 × 1 | 0.25 |
| lifestyle | 5 (0) | 50 | 0.25 | 49.6 | 0.175 × 0.5 × 1 | 0.25 |
| food_travel | 10 (0) | 29 | 0.25 | 28.9 | 0.175 × 0.5 × 1 | 0.25 |
| **Fit** | | **55** (low) | | **不給分**（算出來會是 55，僅供對照）| C = 0.35 | D = 1 (Sephora，未進維度) → insufficient-data；本行 tech n = 0 |

### 3.3 Guard 檢查

- **Apple × MKBHD：73，在 72–75 guard 內** ✅（proxy 權重改 0.4/0.33 時 73/72，home 權重 0.25/0.35 時都是 73，仍在範圍內）。
- **Huggies × MKBHD：26，明確低**（no-match，比今天的 37 低 11 分；與 Apple 的差距從 37 分拉大到 47 分）✅。
- Linus 75、MKBHD 73：兩個科技 YouTuber 的排序不變（Linus 略高），差距 2 分。
- Nikkie：不給分（今天是 55「low」）。

### 3.4 敏感度（`sens2.js`）

| 配對 | proposal | 拿掉任一個 direct 實體後的範圍：today | proposal | 若改成 n<3 一刀切排除 |
|---|---|---|---|---|
| Apple × MKBHD | 72.9 | 73–76 | 72–76 | 拿掉 lifestyle 一個實體 → 76 |
| Huggies × MKBHD | 25.9 | 36–38 | 25–32 | 拿掉 lifestyle 一個實體 → 40（本行維度直接消失）|
| Apple × Linus | 74.5 | 75–78 | 74–78 | — |

一刀切版本（早期試算）會讓 Huggies 從 26 跳到 40，所以我改用連續的 `t_d`。

---

## 4. Known weaknesses（自己提案的弱點，誠實列出）

1. **對單一 direct 實體比較敏感。** 拿掉任一個 direct 實體，Huggies 在今天的公式只動 36–38，在我的提案動 25–32；這是「把權重集中在有點名證據的維度」的代價。實際上 LLM 抽取就有這種變異：同一組 MKBHD 影片，Apple 那次確認 10 個實體、Huggies 那次只確認 6 個（少了 X、Instagram、Facebook、Google）。公式擋不了輸入變異，我的公式還會放大它一點。
2. **本行維度靠 genre 多數決，可能歸錯。** Huggies 只有一個 genre（health_and_beauty）→ lifestyle，對尿布品牌來說可以接受但不精準；沒有可對應 genre 的品牌我退回等權，但多 genre 的品牌（例如同時有 fashion 與 electronics 的品牌）多數決的結果可能違反直覺。0.30 這個數字本身沒有外部依據，是讓 Apple guard 不動、又讓本行有感的取值（0.25–0.35 結果都一樣，見 §3.3）。
3. **「proxy 區辨力較低」的證據只有 7 個 entertainment 配對。** food_travel 的 proxy 掉幅（0.28）跟 direct 一樣大；music 兩次跑的藝人不同，無法配對。半權是保守的避險，不是被資料證明的最佳值。
4. **跨品牌比較的前提沒有文件支持。** 我用「Huggies 比 Apple 低」證明區辨力，但 Qloo docs 沒有說不同 signal 下的 affinity 可以直接比；Huggies 的受眾可能整體 affinity 分佈就不同。
5. **High 很難拿到。** `C ≥ 0.75` 需要本行以外至少還有兩個維度有點名；科技 YouTuber 通常只點名品牌（tech、lifestyle），所以三個 demo 都停在 Medium。這是刻意的，但評審可能問「那什麼時候會是 High？」——我沒有已存的真實例子可以展示。
6. **改變 Nikkie demo。** audience-only 不給分，demo-compare 第三欄會從 55 變成「不給分 + unverified 明細」。如果 demo 敘事依賴「三個創作者都有分數可比」，這是 UI/文案成本，不是公式成本。
7. **品牌被點名時的處理沒有改。** Apple 被 MKBHD 點名時從 direct 排除（避免自我比對），但 Huggies 那次 Apple Inc 以 direct 計入 tech（affinity 0.651）——這是合理的，只是要確認呼叫端排除規則只排除「品牌本身」。
8. **時程風險。** 10/30 晚上 freeze，改動是 `computeCompatibility()` + `confidenceLevel()` 簽名（多傳 home dimension 與覆蓋率）+ audience 路徑不出分數；約 30 行，但 audience 路徑與 UI 文案要一起改，需要預留驗證時間。

### 給辯論的一個質疑（與提案本身分開）

**72–75 的 Apple × MKBHD guard 是用今天的公式定出來的，用它來驗收新公式有循環論證的風險**：任何新公式只要被調成「Apple × MKBHD 剛好落在 72–75」就會通過，但這不代表它更對。比較該先回答的是：我們要用哪幾組「已知應該低 / 應該高」的配對來驗收？目前只有 Huggies × MKBHD 一組負例，樣本太少，三個提案都可能過擬合到這兩筆資料。
