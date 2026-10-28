# 決議：正式的 brand-led 評分公式（#4）

日期：2026-10-28（台北）。由 team lead 撰寫，依據：
- `debate/A-proposal.md`（公式派）、`debate/B-sceptic.md`（懷疑派，production live）、`debate/C-judge.md`（裁判，本機控制組＋Devpost 標準）
- 三份互評：`debate/critique-A.md`、`critique-B.md`、`critique-C.md`
- team lead 自己的重算：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-lead\decide.mjs`

本文件只做決定，**不改 `lib/scoring.ts`**。實作是另一個任務，要先經過使用者同意。

---

## 1. 決定的公式（只選一個）

**今天的公式維持不變，加三條規則**：每個維度最少 3 個實體、修正 `games` 的歸類，以及 Unverified 判定。

| 項目 | 決定 |
|---|---|
| **維度權重** | **等權**：有計分的維度各佔 1/k（k = 有計分的維度數，最多 5）。不採用品牌本行加權。 |
| **direct 對 profile 權重** | 影片點名（direct）= **1**；Qloo 擴展和受眾 profile 實體（proxy）= **0.5**。**不改**。 |
| **每維度最低實體數** | **n ≥ 3 才計入 Fit**。n 是 1 或 2 的維度照樣顯示分數，但標「thin — not scored」，不算進 k。 |
| **歸類修正** | `BRAND_GENRE_DIMENSION` 加入 `games → entertainment`。`urn:entity:videogame` 本來就歸 entertainment，只是 brand 的 `brand:games` 漏了，被預設值丟進 Lifestyle。 |
| **信心（Video Fit，影片為依據）** | D = 有拿到 affinity 的影片點名實體數（不含品牌本身），k 同上：<br>- **High**：D ≥ 10，而且 k = 5<br>- **Medium**：D ≥ 5，而且 k ≥ 3<br>- **Low**：其他情況<br>品牌端如果是 reference brands、描述或風格標籤近似，再降一級（沿用現行規則）。 |
| **信心（Audience Fit，受眾品味為依據）** | 沿用 `lib/audience.ts` 現行規則，k 改成套用 n ≥ 3 之後的值：<br>- **Medium**：計分實體 ≥ 20，而且 k ≥ 4<br>- **Low**：其他情況<br>不會有 High。 |
| **不給分** | 任一條成立就不給分（insufficient data）：<br>- Video basis 的 D < 3（現行 `MIN_DIRECT_ENTITIES`）<br>- Audience basis 的計分 profile 實體 < 10（現行 `MIN_PROFILE_ENTITIES`）<br>- 品牌端可計分實體 < 3<br>- 套用 n ≥ 3 之後 k < 2：只剩一個維度，不是跨領域的契合度 |
| **Unverified — do not use for a decision** | 照樣顯示數字，但**拿掉 verdict 標籤、Summary 的決策固定是 Hold、不給內容建議**，並寫出原因代碼。判定**以單筆結果為單位，不以品牌為單位**：<br>- **E 證據破損**：任何一個會進入計分的 Qloo 查詢，重試後仍然失敗（429、逾時）<br>- **L 證據太薄**：信心是 Low<br>- **I 身分不明**：影片來自超過 1 個 channel；Discover 的列沒有 channel mapping（例如 Logan Paul）；Qloo 有同名多筆 person，而且只靠 tag 挑選（例如 Sandra Lee）<br>- **B 依據替換**：Check a creator 頁因為影片點名太少，改用受眾品味補位（例如 Nikkie） |

另外有四條**顯示規則**，只改報告層，不影響分數：
1. 一個維度如果**全部**由「沒有 genre 投票、靠預設值歸進 Lifestyle」的實體組成，分數照算，但**不能當最強或最弱維度、不能當決策句的依據**，並標「classified by default」。
2. verdict 是 no-match，或決策是 Hold 時，**不輸出「Build content around…」這類內容建議**（Low 的情況已在 1f58d63 處理）。
3. 所有畫面上的實體數一律用 D。不要再一邊寫「5 entities named」、一邊寫「only 3 were scored」。
4. Discover 排名中，第 1、2 名分差小於現行的 `CONTROL_MARGIN`（5 分）時，前幾名顯示為同一級，不排先後。

## 2. 決定公式下的分數（用存好的實體 affinity 重算）

| 案例（資料來源） | 今天 | 決定的公式 | 信心 | 標示 |
|---|---|---|---|---|
| Apple × MKBHD，snapshot（`data/demo-snapshot.json`） | 74 | **74** | Medium（D=9，k=5） | — |
| Apple × MKBHD，production live（B run1a） | 75 | **75** | Medium（D=5，k=5） | — |
| Apple × MKBHD，本機 live（C r1） | 75 | **75** | Medium（D=5，k=5） | — |
| Huggies × MKBHD，snapshot（`data/demo-snapshot-mismatch.json`） | 37 | **37** | Medium（D=6） | — |
| Huggies × MKBHD，本機乾淨重跑（C r4，10:55） | 37 | **37** | Medium（D=6） | — |
| Huggies × MKBHD，遇到 429 的那次（C r2） | 35 | **43**（Lifestyle 只剩 n=2，不計分） | Medium | **Unverified：E**，不給 verdict |
| Apple × DemolitionRanch，production（B run3） | 61 | **62**（World Of Warships 改歸 entertainment，Lifestyle 只剩 n=2） | Low（D=4） | **Unverified：E＋L** |

- **Guard：** Apple × MKBHD 落在 74–75，**仍在 72–75 內**。Huggies 乾淨的時候維持 37，控制組沒有移動。
- **demo 檔案：** `data/demo-snapshot*.json` 和 `public/demo-compare.json` 的分數都不用重產。所有 demo 維度的 n 都 ≥ 3，Apple 和 Huggies 的實體也沒有 `brand:games`。
- **會改變的顯示：** Apple × MKBHD 的 Lifestyle 63 全部來自預設歸類（Dbrand、Hagerty、Unbox Therapy）。依顯示規則 1，決策句會從「leave Lifestyle & Fashion out」改成依最弱的非預設維度 Food & Travel（live 是 72，snapshot 是 68）。
- **Discover：** 依 C 和 B 的重算，Apple 排名的 MKBHD 79→78，仍然第 1，領先 11 分。Samsung 的 Germán 領先從 6 分縮到 0.5 分（B），依顯示規則 4，前兩名同級。

## 3. 被駁回的最強反對意見，以及原因

**B 的「預設歸類的實體不計分」（加上「拿掉 Food & Travel」）。** 這是三方裡證據最紮實的攻擊：MKBHD 的 Lifestyle 三個實體全部是預設歸類，Samsung 有 6/10 的 Lifestyle 只靠 YouTube 或 Twitch 撐著。駁回的原因：
- **會讓兩個控制組同時移動：** Apple 75→78，超出 guard；Huggies 37→44，從 no-match 變成 low（C、A 重算）。我們唯一的 misfit 控制組會被削弱，又沒有第二組乾淨的 misfit 可以替代。
- **拿掉 Food & Travel，等於看結果調整公式：** 它的實體確實是 Qloo 回的 affinity（Discover 102 個裡有 97 個低於 0.70）。「因為大家在這裡都低，所以不算它」不是證據規則。
- **代替做法：** 用顯示規則 1 處理，數字不動，但這些維度不能拿來下決策。

**同時駁回的：A 的品牌本行加權（0.30／0.175）和點名乘數。** A 已經自行撤回。三個原因：
- 用 A 的規則（D<3 不給分），Discover 會整頁沒有分數（B、C）。
- 本行權重在 Samsung 加分最多的是 Germán，他的 Tech 來自 WhatsApp、Google Maps 這類大眾 app（B）。
- 對 429 漏掉的實體更敏感：同一組 Huggies，有沒有 429 的差距從 1.5 分放大到 3.3 分（C）。

## 4. 沒有解決、必須誠實寫出來的問題

1. **Food & Travel 在 Discover 一律最弱：** Apple 10/10、Samsung 10/10。這個公式沒有修正，只是不拿它當決策依據。評審點開實體，看到的是時區、在地診所。
2. **同一組 Apple × MKBHD 有兩個分數：** Check a creator 75（Video Fit，最強 Film 87），Find creators 79（Audience Fit，最強 Music 87）。決定是兩者分開命名、不放在一起比較，但數字本身仍然不同。
3. **MKBHD 的 live D=5 剛好在 Medium 門檻上：** 只要一次 429 少一個實體就會掉到 Low（B）。在新規則下，這種情況會被標成 Unverified E，不會靜默掉級，但 demo 當下仍有風險。
4. **預設歸類只在顯示層處理：** 分數裡仍然有手機包膜、古董車保險這類實體。賽後要先累積至少 3 組乾淨的 misfit 控制組，才能評估「預設歸類實體不計分」（A 的 v2 條件）。
5. **Sandra Lee 的身分：** misfit 控制組的 Qloo person 有同名多筆。新規則會把它標成 Unverified I，但控制組本身還沒換。

## 5. 建議：什麼時候實作

**建議在 10/30 freeze 前實作。** 理由：
- Apple 和 Huggies 兩個控制組的分數不變，guard 也維持住。
- demo 檔案不用重產，Devpost 只要在 `DEVPOST_DRAFT.md` 第 74 行補一句（「a dimension with fewer than 3 entities is shown, not scored」）。

會改到的檔案：
- `lib/scoring.ts`：n ≥ 3、`games` 對照、信心的 k。
- `lib/audience.ts`：信心的 k。
- `lib/report.ts` 和結果頁、Discover、Compare 的顯示規則與 Unverified 原因代碼。
- `README.md` 的評分段落。

實作後必須重跑 Apple × MKBHD，確認落在 72–75；Huggies × MKBHD 要確認乾淨的時候維持 37。

這個建議要使用者同意後才動手，本文件不改任何程式。
