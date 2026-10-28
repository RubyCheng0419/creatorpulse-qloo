# C（裁判）對 A、B 的評析

日期：2026-10-28（台北）。依據：Devpost 四項標準＋排名驗證規則 (a) channel mapping、(b) 最強維度有證據、(c) 明顯適配高／明顯不適配低，否則標「unverified — do not use for a decision」。
新增資料（repo 外）：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\`
- `r4_huggies_mkbhd_clean.raw`（Huggies × MKBHD 乾淨重跑，10:55 台北，沒有 429）
- `aform.py`（用今天的 live 資料套 A 的公式）
- `bfix.py`（套 B 的修正）

## 0. 新的乾淨控制組

- Huggies × MKBHD 乾淨重跑：**37**，no-match，6 個實體（Dbrand 有回來），warnings 為空。各維度：Tech 22、Film 73、Music 43、Lifestyle 6（n=3）、F&T 40，**跟 demo-snapshot 完全一致**。
- 我早上那次 35 確定是 429 少了 Dbrand 造成的。
- 現行公式兩個控制組都通過：Apple 75 對 Huggies 37。

## 1. A（公式派）

| 檢查 | 結果 |
|---|---|
| 控制組 | 用今天 live 的 Apple 重算 **74.78 → 75**（A 用 snapshot 算的是 73），兩者都在 72–75 guard 內。Huggies 乾淨重跑 25.9 → **26**。**通過。** |
| 一句話講得清楚嗎 | 勉強可以：「品牌本行維度佔 30%、其他各 17.5%；完全沒有被影片點名的維度權重減半；實體少於 3 個的維度按比例縮小。」但每一對的權重都不一樣，UI 上的「w=0.2」就失去意義。評審必須接受三個乘數，外加一個看不到的輸入：品牌 genre 多數決。 |
| 確定性 | 函式本身還是確定的，但**會放大輸入變異**。同一對 Huggies，有沒有 429 的差距：現行公式差 1.5 分（35.0 對 36.6），A 的公式差 **3.3 分**（29.2 對 25.9）。 |
| 致命處 | Huggies 的本行維度（Lifestyle）裡只有 **Hagerty（古董車保險）、Dbrand（手機包膜）、Unbox Therapy**，三個都是「沒有 genre 投票、預設掉進 lifestyle」的實體（`bfix.py` 確認 genres 是 `[]` 或只有 `brand:website`）。A 等於把 Huggies 40.7% 的分數，押在「尿布品牌的受眾不喜歡古董車保險」。這正好是 B 的攻擊 (b)，A 把它放大了。<br>如果再修掉這個歸類錯誤，Huggies 的本行維度就消失，照 A 自己的規則（H_n<3）會變成 Low／Unverified，**唯一的 misfit 控制組就不能背書了**。 |
| Discover | A 的規則「D<3 不給分（含 audience-only 路徑）」照字面套用，Find creators 每位候選人都是 D=0，**整頁沒有分數**。如果把 Discover 豁免，本行加權只讓 Discover 分數動 ≤1.5 分（MKBHD 79.7、#3 Dakotaz 和 DjMaRiiO 對調），等於沒買到什麼，還多出第二套公式。 |
| 循環論證 | 0.30 是 A 自己承認「讓 Apple 留在 guard 內」挑出來的；驗收用的又是同一組資料。 |
| freeze 前的成本 | 要改：<br>- `scoring.ts` 和 `confidenceLevel` 的簽名<br>- audience 路徑<br>- UI 的權重顯示<br>- 重產 `data/demo-snapshot.json`（74→73）、`data/demo-snapshot-mismatch.json`（37→26）、`public/demo-compare.json`（Nikkie 那欄改成不給分）<br>- 改 `DEVPOST_DRAFT.md` 第 74 行和 README<br>- 三個品牌的控制組全部重跑<br>Gemini 額度已經用完、Qloo 會回 429，剩 2 天。**成本高，換來的是評審看不出來的差異。** |

**A 正確、應該採納的部分：**
- Nikkie 只有 1 個 direct 卻顯示 55 分，同一筆的 warning 又寫「below the scoring minimum of 3」，這個矛盾就在 `demo-compare.json` 裡，評審看得到。
- proxy 權重改成 0.4 或 0.33，分數只動不到 0.5 分，所以不值得改。
- 品牌端可計分實體少於 3 時不給分。

## 2. B（懷疑派）

| 攻擊 | 成立嗎 | 評審看得到嗎 |
|---|---|---|
| (a) F&T 把分數往下拉 | **只在 Discover 成立。** 我的 Apple Discover 也是 10 位裡 10 位最弱的都是 F&T；Match 裡 F&T 不是最弱。B 不在 freeze 前調 calibration，我同意。 | 中。每一列的「最弱維度」都寫 F&T。如果評審點開實體，看到的是時區、在地診所之類，很難看。 |
| (b) Lifestyle 只靠 1 個平台實體，或靠預設歸類 | **成立**，我的資料也證實：Discover top 3 的 Lifestyle 都是 n=1；MKBHD 的 Lifestyle 三個實體都是預設歸類。 | **最高。** 旗艦 demo Apple × MKBHD 報告的第一句就是「Conditional: go ahead if the brief leaves Lifestyle & Fashion out」，背後的證據是手機包膜和古董車保險。 |
| (c) 429 漏掉實體 | **成立**：乾淨重跑 37，有 429 的那次 35。 | 中。評審同時上線時容易碰到 429，現在只多一行 warning，verdict 照樣顯示。 |

B 的修正，我量出來的代價：
- **修正 1（n<3 的維度不計分）**：所有 demo snapshot 的維度 n 都 ≥3，所以 **74、37、76、55 都不變**。Discover 的 MKBHD 79→78，仍然第 1，領先第 2 名 11 分。**成本近乎零。**
  但要注意：有 429 的那次 Huggies，Lifestyle 只剩 n=2，被排除後分數變 **43（low）**。也就是說，429 會讓 verdict 跳檔，所以這條修正必須搭配 U3（見 §4）。
- **修正 2（沒有 genre 投票的實體不計分）**：Apple 75→78，Huggies 37→**44**，從 no-match 變成 low。B 沒有算 Huggies 這一筆。這會讓 snapshot 失效，而且削弱 misfit 控制組。**freeze 前只做顯示層的版本。**

## 3. 依評審影響排序

1. 旗艦 demo 的決策句建立在預設歸類的 Lifestyle 上（B-b）。
2. Discover 的 n=1 平台實體當上「最強維度」；F&T 每一列都是最弱（B-a、B-b）。
3. Compare 表裡的 Nikkie：warning 寫證據不足，卻照樣給 55 分（A）。
4. 429 讓輸入集合不一樣，verdict 照樣顯示（B-c）。
5. 公式透明度：A 的方案會讓這一項變差，現行公式目前不是問題。

## 4. 我的判定（freeze 前要做的）

| 項目 | 決定 |
|---|---|
| 維度權重 | **維持等權**：已計分的維度各 1/k。不採用本行加權。 |
| 直接 vs 擴展／profile | direct = 1、expansion proxy = 0.5、profile proxy = 0.5，**不改**。videos 和 audience 兩種 basis 分別取名（「Video Fit」和「Audience Fit」），不可放在一起排名或比較。 |
| 每維度最低實體數 | **n ≥ 3 才計分**。n 是 1 或 2 時照樣顯示，但標「thin — not scored」。<br>完全由預設歸類實體組成的維度照樣計分，但**不得當最強／最弱維度，也不得當決策句或建議的來源**（只改報告層）。<br>另外把 `games` 加進對照表，對應到 entertainment。 |
| 信心（Video Fit） | 先算 D（direct 實體數，不含品牌本身）和計分維度數：<br>- **High**：D ≥ 10，而且 5 個維度都有計分<br>- **Medium**：D ≥ 5，而且至少 3 個維度有計分<br>- **Low**：其他情況（D ≥ 3）<br>品牌端是 reference brand 時降一級。 |
| 信心（Audience Fit） | 不會有 High：<br>- **Medium**：profile 實體 ≥ 25，而且至少 4 個維度有計分<br>- **Low**：其他情況 |
| 不給分 | 任一條成立就不給分：<br>- Video basis 的 D < 3<br>- 計分維度少於 2 個<br>- 品牌端可計分實體少於 3 個<br>- Discover 現有的 profile 不足規則（維持） |
| Unverified（顯示數字，但不給 verdict、不給內容建議） | 任一條成立就標 Unverified：<br>- **U1** 身分：影片跨 channel，或沒有 channel mapping（例如 Logan Paul）<br>- **U3** 任何 Qloo 查詢最後失敗（429 或逾時）<br>- **U4** 這個品牌在同一 basis、同一公式版本下，沒有通過控制組<br>- **Low** 信心<br>- Match 頁裡改用 audience basis 補位的結果（Nikkie）<br>- 分數在 40、60、80 的 ±2 內，而且信心不是 High<br>- Discover 的 R2（`not-validated`）、R4（控制組身分不唯一，例如 Sandra Lee）<br>- 相鄰名次分差小於 5 時顯示為同級，不排先後 |
| 一律 | verdict 是 no-match 或 Hold 時，不輸出「Build content around…」這類內容建議。 |

**為什麼這樣定：**
- 控制組維持 75 對 37（乾淨），demo 的數字不用動。
- 要改的文案只有一句：`DEVPOST_DRAFT.md` 第 74 行加上「fewer than 3 entities: shown, not scored」。
- 評審最先會看到的兩個破綻（第 1、2 名）都只靠報告層和 n≥3 就能解決。
