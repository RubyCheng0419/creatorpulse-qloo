# 決議：CreatorPulse 的評分與判讀規則（最新版）

- 最新更新：2026-10-29 晚（台北），對應 commit `83f605b`。
- 原始決議：2026-10-28，正式的 brand-led 評分公式（#4）。之後每一個經使用者同意的決策都併入本文件，並附上 commit。
- 依據：
  - 辯論：`debate/A-proposal.md`（公式派）、`debate/B-sceptic.md`（懷疑派，production live）、`debate/C-judge.md`（裁判，本機控制組＋Devpost 標準）
  - 三份互評：`debate/critique-A.md`、`critique-B.md`、`critique-C.md`
  - team lead 的重算：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-lead\decide.mjs`
- 本文件記錄的規則都已上線。數字以程式為準：`lib/scoring.ts`、`lib/report.ts`、`lib/unverified.ts`、`lib/creator.ts`、`lib/brand.ts`。

---

## 1. 評分公式（2026-10-28 決定，之後沒有改過）

**等權公式，加三條規則**：每個維度最少 3 個實體、修正 `games` 的歸類，以及 Unverified 判定。實作在 `3970fb1`。

| 項目 | 決定 |
|---|---|
| **親和度換算** | affinity 從 [0.5, 1] 線性換算成 [0, 100]。 |
| **維度權重** | **等權**：有計分的維度各佔 1/k（k = 有計分的維度數，最多 5）。不採用品牌本行加權。 |
| **direct 對 proxy 權重** | 影片點名（direct）= **1**；Qloo 擴展和受眾 profile 實體（proxy）= **0.5**。 |
| **每維度最低實體數** | **n ≥ 3 才計入 Fit**。n 是 1 或 2 的維度照樣顯示分數，但標「thin — not scored」，不算進 k。 |
| **歸類修正** | `BRAND_GENRE_DIMENSION` 加入 `games → entertainment`。 |
| **品牌本身不計分** | 影片提到品牌本身時，照樣顯示，但不計分，也不列入擴展的 signal，否則一提到品牌就會自動拿高分。最低 3 個實體的門檻**不把品牌本身算進去**（`bc68a81`）。唯一例外是「產品算作製造商」（第 2 節）。2026-10-29 使用者確認維持這條規則。 |
| **信心（Video Fit，影片為依據）** | D = 有拿到 affinity 的影片點名實體數（不含品牌本身）：<br>- **High**：D ≥ 10，而且 k = 5<br>- **Medium**：D ≥ 5，而且 k ≥ 3<br>- **Low**：其他情況<br>品牌端是 reference brands、描述或風格標籤近似時，再降一級。 |
| **信心（Audience Fit，受眾品味為依據）** | 計分實體 ≥ 20，而且 k ≥ 4 是 **Medium**，其他是 **Low**，不會有 High。 |
| **不給分** | 任一條成立就不給分（insufficient data）：<br>- Video basis 的 D < 3（不含品牌本身）<br>- Audience basis 的計分 profile 實體 < 10<br>- 品牌端可計分實體 < 3（描述的情況改用風格標籤，見第 2 節）<br>- 套用 n ≥ 3 之後 k < 2 |
| **Verdict** | 80 以上 Strong fit、60–79 Moderate、40–59 Weak、未滿 40 No fit。 |
| **Unverified — do not use for a decision** | 照樣顯示數字，但**拿掉 verdict、Summary 的決策固定是 Hold、不給內容建議**，並寫出原因代碼。以單筆結果為單位判定：<br>- **E 證據破損**：任何一個會進入計分的 Qloo 查詢，重試後仍然失敗（429、逾時）<br>- **L 證據太薄**：信心是 Low<br>- **I 身分不明**：影片來自超過 1 個頻道；Discover 的 creator 找不到 YouTube 頻道；Qloo 有同名多筆 person，只靠 tag 挑選<br>- **B 依據替換**：Check a creator 因為影片點名太少，改用受眾品味計分 |

## 2. 證據怎麼來：名稱與實體的規則

LLM 只負責**提議**名稱。名稱要 Qloo `/search` 以完全相同的名稱或別名確認才算數，affinity 只來自 `/v2/insights`，分數只來自固定公式。以下規則都在 LLM 之後執行，都是固定規則：

| 規則 | 內容 | commit |
|---|---|---|
| **產品算作製造商** | 產品名稱的前一或兩個字剛好是某個 Qloo 品牌的完整名稱時，算作那個品牌（例如 Sony FX3 → Sony）。如果製造商就是要評分的品牌，照樣不計分。2026-10-28 使用者同意。 | `e55964c` |
| **重試時拒絕更長的名稱** | LLM 重試時選的候選，如果包含原名稱的所有字、又多了其他字，就不採用。例如「Wahoo」→「Wahoo's Fish Taco」（餐廳）被擋掉。公司字尾和開頭的 The 不算多出來的字。 | `bc68a81` |
| **贊助連結的名稱一律用品牌搜尋** | 名稱跟描述欄同一行網址的網域名稱相同時（ridge.com、dbrand.com、pxmart.com.tw），只在 brand 類型裡搜尋。原因是 LLM 曾經把 Ridge 標成 artist，結果對到同名的 stoner rock 樂團或 2019 年的電影。找不到完全相同的品牌時，固定試「The ＋名稱」（Ridge → The Ridge 錢包品牌），不交給 LLM 重試。 | `c91b01f` |
| **描述不足 3 個實體時只用 tags** | 品牌不在 Qloo、改用描述時，描述確認的實體不到 3 個，就只用風格 tags，不再帶上那 1–2 個實體。原因：CMoney 的網頁提到專欄作者「自由人」，卻對到 Qloo 裡同名的日本搖滾樂團；而且「1 個實體＋tags」計算 places 會逾時兩次（31 秒），讓整個排名全部被標 E，Technology 類型還超過 60 秒上限。 | `0d468e6` |
| **中文頻道與中文品牌名** | 中文名稱由 LLM 補上英文名稱，再由 Qloo 用完全相同的名稱確認；人名不補英文名稱。（lai2570 的 PR #1、#2） | `59477b5`、`73bb9d3` |

## 3. 判讀與顯示規則

**原有的四條顯示規則（2026-10-28），只改報告層，不影響分數：**
1. 一個維度如果**全部**由「靠預設值歸類」的實體組成，分數照算，但不能當最強或最弱維度、不能當決策句的依據，並標「classified by default」。
2. 決策是 Hold 時，不輸出內容建議。
3. 所有畫面上的實體數一律用 D。
4. Discover 排名裡，跟第 1 名差距小於 5 分（`CONTROL_MARGIN`）的 creator 顯示為「1=」，不排先後。

**之後新增的規則：**

| 規則 | 內容 | commit |
|---|---|---|
| **親和度分級改名** | ≥ 0.85「Strong shared taste」、0.70–0.85「Some shared taste」、< 0.70「Conflicting taste」，門檻不變。「Culture Clash」區塊標題保留。 | `ad03ea7` |
| **Summary 的順序** | Decision（含 Fit 和信心度）→ Why（用 Qloo 證據說明，分數低時要分清楚是有衝突還是缺少強的共同品味）→ Familiarity（確切數字，例如「2 / 5 videos mention Apple Inc」）→ Next step → Confidence。 | `6081351` |
| **Prior coverage（熟悉度）** | 只看已經讀到的影片（標題、描述、tags）有沒有提到品牌或它的產品名稱，資料來源是 YouTube，**永遠不計入 Fit Score**。分級是 CreatorPulse 自己的定義：High 是 3 支以上影片提到，或任何一支的標題提到；Medium 是 1–2 支，而且只出現在描述或 tags；None 是都沒提到。產品名稱只算開頭是品牌名稱的；提到不代表推薦；只有描述裡真的出現 sponsored / ad 這些字時才引用原文。 | `6081351` |
| **熟悉度只影響下一步（2x2）** | Verdict 只看 Fit 和信心度，熟悉度不能推翻 verdict，也不能蓋掉真正的衝突。**High fit = Go 或 Conditional；只有 High 分級才算熟悉，Medium 歸到 Low/None 那一邊**（2026-10-29 使用者決定）。<br>- High fit＋熟悉：直接聯絡，引用提到品牌的影片<br>- High fit＋不熟悉：先做品牌介紹或一支測試影片，不要直接簽長約<br>- Low fit＋熟悉：長約 Hold，但可以先做一次小型產品測試<br>- Low fit＋不熟悉：Deprioritise，不要先聯絡<br>Low 信心度或 Unverified 的結果，維持原本的下一步：先補證據。 | `6081351` |
| **資料不足時，只顯示一種原因** | 依照這次執行記下的資料，分成 Failed call、Thin extraction、Qloo no-match、Brand only、Below minimum 五種之一，同一個分類結果同時寫進 Agent Trace 和頁面，並附上抽出的名稱、Qloo 確認的實體、被丟掉的名稱與原因、使用的 LLM。**Failed call 只算最後沒拿到答案的呼叫**：Gemini 失敗後 Groq 成功接手，或 429 重試後成功，都不算（2026-10-29 使用者決定）。 | `ab73c49` |
| **資料不足頁可以直接重跑** | 在同一頁貼頻道網址（讀最新 15 支），或補 2–3 支影片。品牌和原本的影片都會保留，不用重打。 | `28141da` |
| **在同一頁比較** | Check a creator 的結果可以直接比較第二位 creator：目前這筆結果當 A，不重跑，只分析 B。Discover 的詳細頁改成「Back to the ranking」，因為排名本身就是用同一套依據的比較。`/compare` 只保留給 Apple demo。 | `0d468e6` |
| **I（身分不明）要說明試過什麼** | Qloo 不提供 YouTube 連結，所以會把 Instagram、Twitter 的名稱和人名當成 handle 去查。查不到時，訊息會列出試過的 handle（例如 Ms Yeah：@msyeah、@Miss_Xiaoye）。使用者可以在 creator 頁手動連結頻道，連結後解除 I，分數不變。 | `e7eebdd` |

## 4. 基準（guard）與目前的分數

**Guard 從 72–75 改成 68–75**（2026-10-29 使用者同意）。原因是抽到贊助商 Ridge 時，Apple 就是 68，而 Ridge 是正確的證據，不能為了回到 72–75 去擋掉它。

回歸測試改成兩層（`scratchpad\baseline-check.mjs`）：
- **計分層：** 確認的實體相同時，分數必須完全相同。不同就是程式出錯。
- **抽取層：** 記錄用的是哪個 LLM、有沒有抽到 Ridge。這一層的變動屬於已知波動，不算退步。

| 案例 | 分數 | 信心 | 備註 |
|---|---|---|---|
| Apple × MKBHD，demo 快照（`data/demo-snapshot.json`，2026-10-29） | **68** | Medium（D=6，k=5） | Conditional。7 個確認實體，含 The Ridge |
| Apple × MKBHD，正式站 live（2026-10-29，4 次） | **68、69、68、68** | Medium | 4 次都抽到 Ridge，都對到 The Ridge |
| Apple × MKBHD，沒抽到 Ridge 時 | **73** | Medium | Lifestyle 只有 2 個實體，不計入 |
| Apple × MKBHD，記錄區間（頁面上顯示） | **68–75** | — | 2026-10-25 到 10-29 |
| Huggies × MKBHD，demo 快照（`data/demo-snapshot-mismatch.json`，2026-10-29） | **38** | Medium（D=7，k=5） | Hold。跟 Apple 快照用同一組 7 個實體 |
| Huggies × MKBHD，記錄區間 | **36–45** | — | 2026-10-25 到 10-29 |
| Apple × DemolitionRanch（2026-10-28，之後沒有重跑） | 62 | Low | Unverified：E＋L |
| Apple 的 Find creators：MKBHD（2026-10-28，之後沒有重跑） | 78 | Medium | 仍是第 1 名 |

`public/demo-compare.json`：MKBHD 68（新快照）、Linus Tech Tips 76、NikkieTutorials 55（後兩筆是 2026-10-27 的結果）。

## 5. 被駁回的意見，以及原因

**B 的「預設歸類的實體不計分」（加上「拿掉 Food & Travel」）（2026-10-28 駁回）。** 這是三方裡證據最紮實的攻擊。駁回的原因：
- **會讓兩個控制組同時移動：** Apple 75→78，Huggies 37→44，從 no-match 變成 low，削弱唯一的 misfit 控制組。
- **拿掉 Food & Travel 等於看結果調整公式：** 它的實體確實是 Qloo 回傳的 affinity。
- **替代做法：** 用顯示規則 1 處理。

**A 的品牌本行加權和點名乘數（2026-10-28 駁回，A 自行撤回）。** Discover 會整頁沒有分數；本行權重在 Samsung 加分最多的是 Germán，他的 Tech 分數來自大眾 app；對 429 漏掉的實體也更敏感。

**之後駁回的：**
- **品牌本身也計分**（2026-10-29）：一提到品牌就會自動拿高分，而且就算計分，Garmin 單支影片也只有 1 個實體，一樣拿不到分數。維持不計分，改把提到品牌的情況顯示在 Prior coverage。
- **為了穩定分數改計分公式**（2026-10-29，例如調整維度剛好湊滿 3 個實體時的權重）：違反「不改計分公式」。
- **Gemini 和 Groq 各抽一次取聯集**（2026-10-29，暫緩、沒有駁回）：會讓所有基準移動，Gemini 額度也常常用完。凍結後再量測。
- **從贊助網址直接補品牌、不靠 LLM**（2026-10-29，暫緩）：會讓基準移動，也有網域撞名的風險。目前只做了「LLM 已提出的名稱照網域改用品牌搜尋」。

## 6. 尚未解決、必須誠實寫出來的問題

1. **LLM 抽取會波動。** 溫度已經是 0，接近平手的選擇仍然會在不同次呼叫之間改變；Gemini 額度用完時也會改由 Groq 接手。同一組影片可能抽到不同名稱，例如 Ridge 有時列、有時不列，分數就在 68–75 之間移動。計分層本身是穩定的。
2. **預設歸類只在顯示層處理，而且會影響 demo 分數。** Apple 快照的 Lifestyle & Fashion（46）完全由預設歸類的實體組成（Unbox Therapy、Hagerty、The Ridge），照規則算進分數，但不能當決策依據。拿掉它就是 73。這正是第 5 節駁回的 B 意見，賽後要累積至少 3 組乾淨的 misfit 控制組再重新評估。
3. **Discover 的 Food & Travel 一律最弱**（2026-10-29 CMoney 的 Technology 排名：10 位都是）。公式沒有修正，只是不拿它當決策依據。
4. **同一組 Apple × MKBHD 有兩個分數：** Check a creator 是 68–75（Video Fit），Find creators 是 78（Audience Fit）。兩者分開命名，不放在一起比較。
5. **同名誤配沒有通用解法。** Qloo 的 `/search` 不看上下文。目前擋得住的有：多出其他字的重試候選、贊助連結裡的名稱、描述只有少數實體的情況。擋不住的是出現在一般內文、名稱又完全相同的情況（例如曾經發生的 Wahoo、自由人）。
6. **品牌不在 Qloo、只能用描述或 tags 時，信心度上限是 Low，一律 Unverified (L)**，例如 CMoney。要解除，得提供 Qloo 裡有的參考品牌。
7. **MKBHD 的 D=6，接近 Medium 的門檻 5。** 只要少一個實體（例如 429），就會掉到 Low，被標成 Unverified (L)，不會靜默掉級。
8. **Sandra Lee 的身分：** misfit 控制組在 Qloo 有同名多筆 person，會被標成 Unverified (I)，控制組本身還沒換。

## 7. 實作狀態

以上規則都已上線（https://creatorpulse-qloo.vercel.app/）。最近一次驗證是 2026-10-29：
- **正式站：** Apple × MKBHD live 68–69；demo 快照 68 和 38；Joeman 81；Garmin 單支影片是 Brand only，改用頻道是 77（Low）。
- **計分層回歸：** 0。

之後每次修改，照第 4 節的兩層測試重跑。Apple × MKBHD 要落在 68–75，而且確認的實體相同時，分數必須完全相同。
