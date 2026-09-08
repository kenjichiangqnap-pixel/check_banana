# BTC 策略儀表板

把 `binance_check/check.py` 目前實際在跑的「方案B」策略（唐奇安20突破 + EMA200 趨勢過濾 + ADX>20，ATR 停損/吊燈移動停損），
搬成一個純前端網頁。開啟網頁時會直接向 Binance 公開 API 取得 BTCUSDT 4H K線，在瀏覽器端算完整段模擬回測，
顯示「目前該不該持倉、進場價、目前停損價在哪」，方便你手動去交易所下單、調整停損。

**沒有後端、沒有資料庫、不需要也不會用到你的 Binance API Key/Secret**（只用 Binance 完全公開的市場資料端點）。

## 本機測試

直接用瀏覽器打開 `index.html` 即可（或用任一靜態伺服器，例如 `npx serve .`）。
預設密碼是 `changeme123`，**部署前一定要改掉**，方法見下方「更換密碼」。

## 更換密碼

1. 打開瀏覽器開發者工具 Console。
2. 貼上並執行（把 `你的新密碼` 換成自己的）：
   ```js
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('你的新密碼'))
     .then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')))
   ```
3. 把印出的一串英數字，貼到 [app.js](app.js) 最上面的 `PASSWORD_HASH`。

這只是避免連結外流被隨意瀏覽的簡單防護（純前端 hash 比對），不是銀行等級的安全機制，
請不要拿來保護真正敏感的資料（例如 API Key）。

## 部署到 GitHub Pages（私有 repo + 只有你知道連結）

1. 在 GitHub 建一個新 repo，設成 **Private**（例如 `btc-strategy-dashboard`）。
2. 在這個資料夾內初始化 git 並推上去：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <你的 repo git 網址>
   git push -u origin main
   ```
3. 到 repo 的 **Settings → Pages**，Source 選 `main` branch、`/ (root)`，儲存。
4. 等一兩分鐘，會產生一個網址，格式類似 `https://<你的帳號>.github.io/btc-strategy-dashboard/`。

**注意**：GitHub Pages 產生的網址，即使來源 repo 是 Private，網址本身「知道連結的人都能打開」
（免費方案沒有登入驗證），這也是為什麼上面加了密碼那一層。不要把這個連結分享出去或貼在公開的地方。

## 重要提醒

- 這個網頁完全不會幫你下單，只會告訴你「模擬帳戶目前應該持有什麼倉位、進場價、目前停損在哪」，
  實際進出場、調整停損都要你自己手動去 Binance 操作。
- 顯示的最新一根K棒有可能還沒收線（尚在走），策略邏輯本身也是這樣即時判讀（跟 `check.py` 直接對 API 跑時的行為一致）。
- 回測績效統計只是基於過去約 250 天（4H × 1500 根）的公開歷史資料做的模擬，不代表未來績效，僅供個人參考。
- **絕對不要**把 `binance_check/config.ini`（裡面有真實 API Key/Secret）放進這個 repo 或任何會推上 GitHub 的專案。
