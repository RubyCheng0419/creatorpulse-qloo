# Teammate A（公式派）回應 B 與 C

日期：2026-10-28。依據：`C:\Users\user1\Claude\creatorpulse-qloo\lib\scoring.ts`、B 與 C 存下的 raw response。
重算腳本（不在 repo 內）：`C:\Users\user1\AppData\Local\Temp\claude\C--Users-user1-Claude-skills-main-pages-bp-assistant\b4c2fd90-841d-4eb3-92b4-253693d1a35d\scratchpad\debate-A\critique.js`。這支腳本會在 7 筆 Match 和 2 筆 Discover 上，分別算出 today、A-orig、A-rev 三種結果。

## 1. 結論

**我撤回「freeze 前改權重」。改為支持 C 的做法：不動公式，只加標示規則；再補三條顯示規則（見 §4）。**

撤回的原因是 B 找到的 fallback 問題直接打掉了我提案的核心論據：我拿來證明 Huggies 不適配的「本行維度」，裡面其實沒有任何一個 lifestyle 實體。

## 2. 逐項檢查 B

| B 的主張 | 對不對 | 數據支不支持 | 對我提案的影響 |
|---|---|---|---|
| 拿掉 F&T 後平均 +8.7，4/10 個 verdict 換檔 | **正確**。拿掉前後是 59.0 → 67.7。換檔的是 Germán 68.6→81.3、Vegetta777 58.5→67.7、Luzu 56.4→62.8、Fernanfloo 53.0→64.7。F&T 有 97/102 個實體低於 0.70，其他維度只有 6/198 | 支持。但只有 1 個品牌，而且是 `not-validated` | 我的 `e_d` 在 Discover 完全不起作用：那裡全部是 proxy，每個維度的 e 都是 0.5。所以我的提案**沒有處理 (a)**，這點我承認 |
| 10 位裡有 6 位的 Lifestyle 只靠 1 個實體（Youtube 或 Twitch），因為它沒有 genre，被預設丟進 lifestyle | **正確**，只有用字要更精確：這兩個不是「沒有 genre」，是它的 genre（`mobile_app` / `website` / `streaming_service`）在 `BRAND_GENRE_DIMENSION` 裡沒有票，於是掉進 `dimensionOf()` 的預設值 `'lifestyle'` | 支持 | **致命**，見下一點 |
| MKBHD 的 Lifestyle 三個實體都是 fallback 進來的，排除後 75→78 | **正確**。三個是 Dbrand（`[]`）、Hagerty（`[]`）、Unbox Therapy（website）。排除後重算是 78.3 | 支持 | 我原本主張「Huggies 本行（lifestyle）只有 5.7，是最強的錯配證據」，但這個 5.7 就是用這三個實體算出來的。**這個論據撤回** |
| freeze 前就把 n<3 不計分、fallback 實體不計分 | **跟 B 自己的主張有矛盾**。這兩條都是計分變更，不只是顯示規則 | 我重算的結果：(1) 已存的 Huggies 從 36.8 變成 **44.5**，verdict 從 no-match 掉到 **low**；(2) C 那次 429 的 Huggies 只套 n<3，就從 35 變成 42.8。(3) live MKBHD 計分的 direct 會從 5 降到 3，因為 Dbrand、Hagerty 不再計分。照 B 自己的 (c)2「direct 少於 5 不給 verdict」，**Apple 的正例控制組就沒有 verdict 了** | 這正好支持 C：任何計分變更都會讓控制組移動 |

## 3. 逐項檢查 C

- **Apple × MKBHD 在 Match 是 75（最強維度 Film 87），在 Discover 是 79（最強維度 Music 87）：正確。** 我重算出來是 75.2 和 79.2。這兩個「最強維度」底下的實體**全部都是 proxy**。
  我的提案只改權重，不會改「最強維度」的判定，所以這個矛盾我的提案修不到。我接受 C 的 P3：同一對可以有兩個分數，但要分成兩個有名字的分數（videos 和 audience），不能放進同一個排名比較。
- **我原本 §2.5-4 有漏洞：** 那條寫「audience-only 不給分」，但 Discover 每位候選人都是 0 個 direct。照字面套用，Find creators 整頁都不會有分數。所以我把這條的範圍縮到 Match 頁。
- **429 造成輸入不完整：同意 U3。** 另外補一點：C 的 r2 少了 Dbrand，但影響分數的不只 429。live 的 MKBHD 只有 5 個 direct（Groq），已存的 demo 有 9 個。兩者分數一樣是 74/75，是剛好而已，不代表輸入穩定。我自己的弱點 1（我的提案對單一 direct 實體比較敏感）在這種情況下會被放大。
- **Proxy 占 75%：** C 是把所有實體的權重加總後算比例。照公式實際的權重算，live run 是 72%，已存的 demo 是 68%。結論不變。
- **「改權重會讓基準作廢」：理由一半成立。** 已存的 response 可以離線、確定地重算（`critique.js` 就是這樣做的），所以基準本身不會「作廢」。真正跑不完的是**乾淨的 live 控制組**，因為有 429，Gemini 的額度也用完了。只看這一點，就足以支持 C 的建議。

## 4. 修正後的提案

**freeze 前（只改顯示，不改公式）：**

1. 採用 C 的 U1–U5、R1–R5。B 的 (c)1 跟 U3 是同一條，併入 U3。
2. 如果某個維度裡的實體全部是 fallback（沒有任何 genre 投票），這個維度就標「unclassified — placed in Lifestyle by default」。這個維度不能當報告裡的「最強維度」，也不能用來產生建議。這條是把 C 的 P5 再延伸。
3. 在 Match 頁，0 個 direct 的維度如果被列為「最強維度」，一律加註「Qloo-related, not named in videos」。
4. 在 Match 的 audience 路徑（例如 Nikkie），照樣顯示分數，但把它命名為「Audience-taste score」並標 Unverified，不出 verdict。這是我原本 §2.5-4 的縮小版，demo-compare 不必改版面。

**freeze 後（v2，要先有 ≥3 組乾淨的 misfit 控制組才能上）：** 用 A-rev。A-rev 跟原提案的差別只有兩點：fallback 實體不計分，`games` 對到 entertainment。

| 配對 | today | A-orig | A-rev |
|---|---|---|---|
| Apple × MKBHD（已存 / live） | 74 / 75 | 73 / 75 | **76 / 78** |
| Huggies × MKBHD（已存 / C 的 429 run） | 37 / 35 | 26 / 29 | **40 / 38** |
| Apple × Linus | 76 | 75 | 78 |
| Apple × Demolition | 61 | 62 | 64 |

A-rev 把已存的 Huggies 放在 **39.7**，四捨五入剛好是 40，也就是 low 的門檻。live MKBHD 的 D 只剩 3，信心是 Low。這些數字本身就說明 A-rev 還不能上線。

## 5. 我仍然堅持的部分

- **`t_d` 連續縮小，比 n<3 一刀切好。** B 自己也證明了：照 itemCount 加權會放大 F&T。我的 `t_d` 在 n=3 就封頂，不會放大 n=10 的 F&T。
- **v2 要把維度權重跟「點名證據」綁在一起。** live run 有 72% 的分數來自影片裡沒提到的實體，A-orig 能把這個比例降到 57%。
- **另外要確認 confidence 的定義：** 呼叫端把 30 個 profile 實體當成 entities 計數。這個問題 C 也點出來了（第 4 項）。

## 6. 質疑（與上面分開）

1. **（最該先回答）B 的 fix 1、fix 2 跟 C 的「不改公式」不能同時採納。** 要選其中一邊，因為 fix 2 會讓 Apple 控制組失去 verdict，也會讓 Huggies 掉出 no-match。
2. **misfit 控制組實際上只有一組，而且 C 那次 run 不乾淨（有 429）。** 不管選哪個公式，都只是在跟 Huggies 一個點做擬合。
3. **C 的 U4 會讓評審自己輸入的品牌全部顯示 Unverified。** 這是誠實的做法，但 demo 時要先準備好一句說明：為什麼大多數品牌都是 unverified、這對使用者代表什麼。
