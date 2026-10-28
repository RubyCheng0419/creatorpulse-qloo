# C（裁判）：正式 brand-led 評分公式的判定

日期：2026-10-28（台北）。Feature freeze：10/30 晚間（台北）。
執行者：Teammate C（judge）。只用兩個依據：(1) Devpost 評審標準，(2) 通用的排名驗證規則 (a)–(c)。
Live run 打的是本機 production build：`http://localhost:3003`。原始回應和腳本都放在 repo 外面：
`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\`

---

## 0. 結論

1. **兩個控制組都過了，但都不乾淨。** Apple × MKBHD 得 **75**（Medium），Huggies × MKBHD 得 **35**（no-match），差 40 分，方向正確。
   不過這次 Huggies run 的輸入少了一個實體：Qloo 對 `dbrand` 和 `Apple Homeview` 的 `/search` 回了 **429**，所以 Dbrand 沒進來。兩次 run 用的 creator 證據集合因此不一樣（6 個對 5 個已確認實體）。
   App 自己的規則寫的是「profile 不完整的控制組可以拿來標記排名有問題，但不能替排名背書」。照同一個邏輯，這次 Huggies run 不能當作「已驗證的 misfit」引用，要重跑一次乾淨的。
2. **Discover 排名：控制組通過（status `validated`），但 top 3 只有 2 個通過 (a)。**
   - #2 Logan Paul 找不到 YouTube 頻道（`channel: null`），這一列必須標成 unverified。
   - 同一對 Apple × MKBHD，在 Discover 得 **79**（audience-taste basis，最強維度 Music 87），在 Match 得 **75**（videos basis，最強維度 Film 87）。同一對出現兩個分數、兩個「最強維度」，是評審最容易抓到的矛盾。
3. **正式公式不建議在 freeze 前改權重**，原因有兩個：
   - 改權重會讓已記錄的基準（69–75、36–37）和控制組全部作廢。
   - 剩兩天，跑不完一輪新的控制組驗證。

   **要改的是標示規則**：§5 列出的條件，任一條成立就顯示「Unverified — do not use for a decision」。另外要揭露 basis 和 proxy 佔比。

---

## 1. 依據一：Devpost 評審標準（已取得原文）

- 本屆是 **Qloo Agentic Hackathon**（`https://qloo.devpost.com/`，規則頁 `https://qloo.devpost.com/rules`）。
  - 報名／提交期：2026-09-30 至 **2026-10-30 11:45 pm ET**。
  - 評審期：11/2–11/5。
  - 原始頁面存在 scratchpad 的 `dp_agentic_rules.html`。標準摘錄在 `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\devpost_agentic_criteria.txt`。
- 另有一個 `qloo-hackathon.devpost.com`，是 **2025 年 7–8 月的「Qloo LLM Hackathon」**，標準不同（含「Intelligent & Thoughtful use of LLMs」）。那是舊活動，**不適用**，不要拿來寫 Devpost 文案。
- **Stage One（pass/fail）**：作品要符合主題，並合理使用指定的 API。
- **Stage Two：四項等權**（以下為意譯）：
  1. **Technological Implementation**：使用 Qloo 的徹底程度與功力；程式碼是否真的能動、而且不簡單。
  2. **Design**：是完整、連貫的產品體驗，而不只是技術 PoC。
  3. **Potential Impact**：能不能對真實受眾提出具體可信的問題，而且「依展示出來的東西」確實解決了它。
  4. **Quality of the Idea**：對 Qloo 的用法是否有創意、不顯而易見；團隊是否真的懂這個問題領域。
- 跟評分公式直接相關的提交要求：
  - 必須附**可對外使用的 live demo**，主辦方明說要「評審能實際操作的東西」，影片不是必要的。所以**評審會自己輸入品牌和創作者**，不會只點 demo pair。
  - 「What to Build」強調：作品要因為 Qloo 才成立；拿掉 Qloo 還能照樣運作的作品，就是做錯方向。

## 2. 依據二：驗證規則

brand-led 的排名或分數，要先滿足下面三點才能呈現，否則一律標「unverified — do not use for a decision」：

- (a) 說明每位創作者實際被評分的是哪個 channel（identity → channel mapping）
- (b) 顯示最強維度背後的證據（實體 + affinity）
- (c) 明顯適配的控制組分數／排名要高，明顯不適配的要低

---

## 3. Live runs（2026-10-28 09:46–09:47 台北，間隔 13 秒）

| Run | 端點 | HTTP | 耗時 | 原始檔 |
|---|---|---|---|---|
| 1 Apple × MKBHD（category Technology, live） | /api/match | 200 | 11.0 s | `...\debate-C\r1_apple_mkbhd.raw` |
| 2 Huggies × MKBHD（category 空字串，同 demo pair 設定, live） | /api/match | 200 | 12.6 s | `...\debate-C\r2_huggies_mkbhd.raw` |
| 3 Discover Apple, any | /api/discover | 200 | 12.9 s | `...\debate-C\r3_discover_apple.raw` |

回應都是純 JSON（不是 stream）。整理後的文字檔：`r1.txt`、`r2.txt`、`r3.txt`、`r3_top3.txt`（同一資料夾）。

### Run 1：Apple × MKBHD → **75**，Medium（confidenceBasis：5 個實體、5 個維度），verdict `medium`

- **(a) identity → channel：通過。**
  - 5 支影片都來自同一個 channelId `UCBJycsmduvYEL83R_U4JriQ`，即 Marques Brownlee（@mkbhd）。`scoreBasis: "videos"`。
  - Qloo person「Marques Brownlee」（`0E6F37E3-…`）也有找到，audienceOverlap 0.848。這個值只顯示，不計分。
- 證據來源：
  - LLM 是 Groq `openai/gpt-oss-120b`，用的是 **2026-10-27T13:11Z 的快取答案**（Gemini quota 用盡）。
  - Qloo 確認的實體：Dbrand、Apple Inc、Tesla、Hagerty、Asus、Dell Inc。Apple Inc 本身是品牌，排除在擴展 signal 之外，所以 5 個直接實體計分。
  - 沒對上、被剔除的：iPhone、iPhone Duo、Ridge、Tesla Roadster、Auto Focus、Googlebook、XPS、Apple Homeview。
- 各維度分數：

  | 維度 | 分數 | n | 組成 |
  |---|---|---|---|
  | Tech | 79 | 7 | 3 direct + 4 proxy |
  | **Film/TV** | **87** | 10 | 全 proxy |
  | Music | 75 | 5 | 全 proxy |
  | Lifestyle | 63 | 3 | 2 direct + 1 proxy |
  | Food & Travel | 72 | 10 | 全 proxy |

- **(b) 最強維度 Film, TV & Entertainment 87 的證據：** Halt and Catch Fire 0.978、Avengers: Endgame 0.947、Captain Marvel 0.941、Humans 0.940、Venom 0.935、Deadpool 2 0.934……
  10 個**全是 proxy**（由 Dbrand/Tesla/Asus/Dell 經 `/v2/insights` 擴展而來，沒有一個是影片裡提到的）。資料有給，報告也老實寫了「related by Qloo rather than named in the videos」。**形式上通過。**
- **(c) obvious fit：通過（相對）。** 75 落在今日基準 69–75 內，比 Huggies 高 40 分。
  但照 app 自己的 verdict 分級，75 只是 `medium`（80 以上才是 high），報告結論是「Conditional」。評審可能會問：「你最理想的例子也只有 Medium？」

### Run 2：Huggies × MKBHD → **35**，Medium（5 個實體、5 個維度），verdict `no-match`

- **(a)：通過**，同一個 channel。但 Qloo person 的 audienceOverlap 只有 0.545。
- **輸入集合和 Run 1 不同：** `dbrand`、`Apple Homeview` 的 `/search` 回 **429**。warnings 有寫出來：「2 keyword lookups failed in Qloo … 429」。
  - 確認實體只剩 Apple Inc、Tesla、Hagerty、Asus、Dell Inc。
  - Groq 的 retry decision 把「Ridge」對成「The Ridge」，後來被 `/entities` re-check 剔除（這個機制正確）。
  - 這一步 trace 寫成「Verify the **Gemini** retry」，但實際做 retry decision 的是 Groq，是標示錯誤。
- 各維度分數：

  | 維度 | 分數 | n | 備註 |
  |---|---|---|---|
  | Tech | 18 | 8 | 全部 < 0.70，含 Tesla 0.528、Apple Inc 0.651 |
  | **Film/TV** | **72** | 10 | 全 proxy |
  | Music | 46 | 5 | |
  | Lifestyle | 4 | 2 | Hagerty 0.414、Unbox Therapy 0.553 |
  | Food & Travel | 35 | 10 | |

- **(b) 最強維度 Film 72 的證據：** You, Me and the Apocalypse 0.889、Deadpool 2 0.879、Captain Marvel 0.871、Humans 0.869……全是 proxy。
- **(c) obvious misfit：數字上通過。** 35，低於紀錄區間 36–37 一分。差異可能來自 Dbrand 缺失，但沒有乾淨的對照 run，**無法歸因**。
  依 app 自己「partial 不背書」的邏輯，**這次 run 不能當作已驗證的 misfit 引用**。
- **評審會抓的點：** 結論是「Hold」，但報告第一條建議是「Build content around “You, Me and the Apocalypse”」，第二條是「Build content around “Deadpool 2”」（給 Huggies 的建議）。

### Run 3：Discover Apple / Any YouTuber

- 回應 `liveRun: false`（呼叫時沒帶 live）。品牌查詢走快取，大部分 profile 和計分的 `/v2/insights` 是即時呼叫。整個流程沒有任何 LLM 步驟。
- 排名：

  | 名次 | 創作者 | 分數 |
  |---|---|---|
  | 1 | Marques Brownlee | 79 |
  | 2 | Logan Paul | 69 |
  | 3 | Dakotaz | 68 |
  | 4 | TheGrefg | 67 |
  | 5 | DjMaRiiO | 67 |
  | 6 | DrLupo | 66 |
  | 7 | byViruZz | 66 |
  | 8 | SypherPK | 66 |
  | 9 | Ninja | 65 |
  | 10 | AnEsonGib | 65 |

- `validation.status = "validated"`：
  - Fit 控制組 Marques Brownlee 79，排第 1。
  - Misfit 控制組 Sandra Lee 50，比第 1 名低 29 分。CONTROL_MARGIN 是 5。她不在排名池內（rank null）。
- 10 位創作者的最弱維度都是 Food & Travel。拿掉這個維度後，top 3 變成 MKBHD、Logan Paul、SypherPK（app 已主動揭露）。
- **候選人全是 Qloo person**（`urn:tag:genre:person:youtuber`），不是 channel。**計分對象是「這個人的受眾品味」**（以 person 為 signal 打 `/v2/insights`，每人 30 個實體，**全部是 proxy、0 個 direct**）。YouTube channel 只用於顯示和後續 deep dive，不參與計分。

Top 3 的 (a)/(b)：

| # | Qloo 實體（person） | 被對到的 channel | (a) | 最強維度與證據（實體, Apple 受眾 affinity） | (b) |
|---|---|---|---|---|---|
| 1 | Marques Brownlee `0E6F37E3-…`（"American technology reviewer…"） | @mkbhd，UCBJycsmduvYEL83R_U4JriQ，21.4M | 通過 | **Music 87**（n=5）：Marshmello 0.964、The Chainsmokers 0.940、Alan Walker 0.940、ILLENIUM 0.919、Vicetone 0.899（全 proxy） | 通過 |
| 2 | Logan Paul `6BE44646-…`（"American YouTuber and Internet personality"） | **無**。只試了 @loganpaul 和 @LoganPaul，都找不到；trace 寫「no deep dive, the Qloo score stands」 | **不通過** → 此列應標 unverified | **Music 83**（n=5）：Post Malone 0.949、DaBaby 0.922、XXXTENTACION 0.913、YNW Melly 0.900、Trippie Redd 0.899 | 通過 |
| 3 | Dakotaz `F9E7CF58-…`（"American Twitch streamer and YouTuber"） | @dakotaz（title「dakotaz」，2.66M） | 通過 | **Film/TV 82**（n=10）：Captain Marvel 0.941、Spider-Man: Far from Home 0.933、Spider-Verse 0.920、Andor 0.918、Rise of Skywalker 0.916…… | 通過 |

(c)：

- **Fit 控制組通過**（排第 1）。
- **Misfit 控制組數字上通過**（50，低 29 分），但有兩個保留：
  - (1) Sandra Lee 控制組**沒有 channel mapping**。Qloo 有多個同名 person（trace：「Sandra Lee (creator), Sandra Lee, Sandra Lee-Vercoe」），程式只靠 creator tag 挑其中一個。
    她的受眾品味同時出現 Neutrogena、Clinique（像皮膚科醫師）和 Julie & Julia、The Hundred-Foot Journey（像料理）。光從輸出**無法確認**是哪一位 Sandra Lee。
  - (2) 她不在排名池內，所以只證明了「分數低」，沒證明「排名低」。

**Run 3 判定：** 排名整體可以呈現，因為控制組通過。但第 2 列 Logan Paul 依 (a) 必須標 unverified。Misfit 控制組的身分應該補上 mapping 才算完整。

---

## 4. 評審（照 Devpost 四項標準）會挑的毛病，依嚴重度排序

1. **同一對、兩個分數、兩個「最強維度」**（Design、Potential Impact）。
   - Match 頁 Apple × MKBHD 75：最強 Film 87，基於影片。
   - Find creators 頁 79：最強 Music 87，基於受眾品味。
   - 如果沒有把 basis 並排講清楚，評審會認為分數不穩定。repo 在 Match 頁和 Compare 表已有 basis 文字，Discover 這邊必須同樣明確，而且兩種 basis **不能放進同一個排名比較**。
2. **Misfit pair 產出內容建議，主流大片對誰都高分**（Quality of the Idea、Potential Impact）。
   - Huggies × MKBHD 判 Hold，卻建議「Build content around Deadpool 2」。
   - Captain Marvel 同時出現在三個結果的證據裡：Apple×MKBHD 0.941、Apple×Dakotaz 0.941、Huggies×MKBHD 0.871。
   - 原因是 proxy 是 `/v2/insights` 每個類型取前 5、popularity ≥ 0.5 的熱門實體，對受眾廣的品牌天然偏高。懂品牌行銷的評審一眼就會看到。
3. **Match 分數有 60% 來自「影片裡沒提到任何實體」的維度**（Technological Implementation）。
   - 兩次 match run 的 Film、Music、Food & Travel 三個維度都是 100% proxy。每個維度等權 20%，所以 Fit Score 有 3/5 來自 proxy-only 維度。
   - 以實體權重計算，5 個 direct × 1 對 30 個 proxy × 0.5，proxy 佔 15/20 = 75%。
   - DEVPOST_DRAFT 寫「影片中提到的實體算全權、擴展算半權」，字面上沒錯，但會讓人誤以為分數主要由 direct 決定。
4. **Discover 的 confidence 跟 Match 意義不同**（Technological Implementation）。
   - Match 的 `confidenceBasis.entities` 是 direct 實體數（5 → Medium）。
   - Discover 的是 proxy 數（30 → Medium，0 個 direct）。
   - 同一個欄位名、同一個等級，代表的證據強度不一樣。
5. **等權維度不看 n**：n=1 的維度也佔 20%。
   - Discover top 3 的 Lifestyle 都只有 1 個實體：Unbox Therapy / Youtube / Twitch。
   - Huggies 的 Lifestyle 4 分只來自 2 個實體。
6. **評審輸入自己的品牌時，幾乎都會是「Not validated for this brand」**（Potential Impact：「依展示出來的東西」）。
   - 控制組只有 Apple、Huggies、Le Labo 三個品牌，而且限 Any YouTuber。
   - 目前這個狀態的文案是「Treat this ranking as indicative」，**fit verdict 照樣顯示**。依 §2 規則，沒有控制組就該標「Unverified — do not use for a decision」。
   - 單筆 Match 頁**完全沒有驗證標示**（`components/match`、`app/match/[id]` 都沒有 validation 相關字樣）。
7. **「Run live」並非全部 live。** Run 1、2 帶了 `live: true`，LLM 抽取用的仍是 10/27 的快取答案（trace 有誠實寫 cached）。
   README 和 DEVPOST_DRAFT 寫「Run live bypasses every cache」。若部署版行為一樣，文案就和實際不符；若這只是本機固定快取的設定，則部署版不受影響，**需要確認**。
8. **Qloo 429 讓輸入集合在兩次 run 之間不一樣。** 公式本身是確定的（同樣的 Qloo 資料一定得到同樣分數，`lib/scoring.ts` 屬實），但「同樣的輸入」沒有保證。
9. **把平手當名次排**：第 4–10 名分數在 65–67 之間，差 0–2 分，卻排出 7 個名次。

---

## 5. 正式公式必須具備的性質（裁判判定）

| 性質 | 現況 | 判定 / freeze 前要做的 |
|---|---|---|
| **P1 只用 Qloo 數字**：分數只來自 Qloo 確認的實體（`/search` + `/entities` 複查）和 `/v2/insights` 給品牌 signal 的 affinity；LLM 不碰分數 | 符合（trace：「Report template filled… (no LLM)」、「Equal-weight mean」） | 保持。這是 Stage One 和「Technological Implementation」的核心賣點 |
| **P2 確定性**：同一組 (entity IDs, affinities) 一定得到同一個分數；**輸入集合也要可重現** | 公式確定；輸入受 429 和 LLM retry 影響 | 公式不改。只要有任何 creator 端查詢失敗（429 或逾時），結果就不可宣稱已驗證（見 §6 U3） |
| **P3 Basis 明示且分開**：`videos` 和 `audience` 是兩個不同的量 | Match 有標；Discover 是 audience，但同一對兩頁分數不同 | 每個分數旁都標 basis；不同 basis 不放進同一排名或同一比較 |
| **P4 證據組成揭露** | Proxy 佔 75% 權重、60% 維度，沒有揭露 | freeze 前**只揭露、不改權重**，例如「Fit Score 的 3/5 維度只有 Qloo 關聯實體，影片沒直接提到」 |
| **P5 證據不足就拒絕評分** | 已有：direct 少於 3 就不給分；Discover profile 不足就不給分 | 保持。另外：n<3 的維度不能當報告的「最強維度」或建議來源（只影響報告文字，不改分數） |
| **P6 控制組必須通過，margin 要大於已知的重跑波動** | CONTROL_MARGIN = 5；Match 路徑紀錄的重跑區間是 69–75（6 分） | Match basis 的 margin 5 **小於**它自己的重跑波動，所以不能拿 Match basis 套用 5 分 margin。Discover 據 DEVPOST_DRAFT，兩次 live 排名相同，但本次只跑一次，**無法獨立確認** |
| **P7 Verdict 和建議一致** | Hold 或 no-match 時仍給「Build content around …」 | 報告規則：verdict 是 no-match 或 Hold 時，不輸出內容建議（只改模板） |

**不建議 freeze 前做的事：** 改 DIRECT/PROXY 權重、改 AFFINITY_FLOOR、改維度等權。任何一項都會讓已記錄基準（69–75、36–37）、三組控制組和 DEVPOST_DRAFT 的數字全部失效，而剩下的時間跑不完一輪新的控制組驗證。

---

## 6. 必須顯示「Unverified — do not use for a decision」的精確條件

任一條成立就要顯示這個標示，並且**不顯示 fit verdict**（沿用 CandidateCard 對 `unverified` 的現有行為）。

**單筆分數（/api/match）：**
- **U1 身分**：影片來自超過 1 個 channelId，或解析不到 channel；`audience` basis 時，Qloo person 有同名多筆，而且只靠 tag 挑選、沒有 channel 對照。
- **U2 證據**：最強維度沒有列出實體與 affinity（違反 (b)）。
- **U3 缺資料**：`warnings` 含任何 Qloo 查詢失敗（例如 Run 2 的 429），或任何 `/v2/insights` 計分類型失敗。這是 missing data，不是 mismatch，所以不能背書。
- **U4 無控制組**：這個品牌在**同一 basis、同一公式版本**下，沒有跑過並通過 fit/misfit 控制組。目前只有 Apple、Huggies、Le Labo 有控制組，所以評審自己輸入的其他品牌**一律**屬於這一條。
- **U5 證據薄**：confidence 為 Low。direct 少於 3 本來就不給分，維持。

**排名（/api/discover）：**
- **R1** `validation.status = unverified`（控制組失敗）：現有行為正確。
- **R2** `validation.status = not-validated`（沒有控制組，或控制組 profile 不完整）：目前標「Not validated… indicative」而且保留 verdict。**依規則必須改成 Unverified — do not use for a decision。**
- **R3 單列**：`channel: null`（例如今天的 Logan Paul #2），或 profile 有 failedTypes → 該列標 unverified。
- **R4 控制組身分**：控制組本身沒有 identity → channel mapping，或有同名多筆（例如今天的 Sandra Lee）→ 這個控制組不能替排名背書，排名降為 R2。
- **R5 名次**：相鄰名次的分差小於 CONTROL_MARGIN 時顯示為同一級（tie），不排先後。這一條不屬於 unverified，但不能宣稱誰贏。

---

## 7. 最該先回答的三個問題（質疑）

1. **（最優先）正式的 brand-led 分數到底是哪個 basis？** `videos`（Match 75）還是 `audience`（Discover 79）？兩者最強維度不同（Film 和 Music）。這題沒定，「正式公式」的辯論就沒有對象。我的判定是：兩者都可以保留，但必須是兩個有名字的分數，各自有自己的控制組和 margin，不能共用一個 Fit Score 名稱卻互相比較。
2. **「沒有控制組」是否等於「unverified」？** 規則寫的是 otherwise → unverified，所以答案是「是」。代價是評審輸入的大多數品牌都會看到紅色標示。我的判定是：照規則做。評審看到誠實的 unverified 加上原因，比看到「indicative」但照樣顯示 verdict 更可信（Design、Potential Impact）。
3. **今天的 misfit 控制組乾淨嗎？** 不乾淨：Run 2 有 429，Sandra Lee 身分不明。在 freeze 前至少要：(i) 無 429 地重跑一次 Huggies × MKBHD；(ii) 給 Sandra Lee 補上 channel mapping，或換一個身分唯一的 misfit。這兩件不需要改公式。

---

## 附：檔案

- 本文件：`C:\Users\user1\Claude\creatorpulse-qloo\debate\C-judge.md`
- 原始回應：
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\r1_apple_mkbhd.raw`
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\r2_huggies_mkbhd.raw`
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\r3_discover_apple.raw`
- 腳本：
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\run.sh`
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\det.py`
  - `C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\disc.py`
- Devpost 標準摘錄：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-C\devpost_agentic_criteria.txt`
