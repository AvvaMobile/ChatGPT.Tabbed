# ChatGPT Tabs

ChatGPT web uygulaması için **Chrome benzeri sekmeli** bir masaüstü istemcisi (Electron + TypeScript).

- Her sekme ayrı bir `WebContentsView` (kendi renderer süreci, kendi navigation geçmişi, kendi sohbeti).
- Bütün sekmeler **tek bir kalıcı oturumu** (`persist:chatgpt`) paylaşır: bir kez login olursunuz, tüm sekmeler ve sonraki açılışlar oturumu kullanır.
- Genel amaçlı bir tarayıcı değildir: adres çubuğu, yer imi, geçmiş yöneticisi yoktur. ChatGPT dışındaki linkler sistem tarayıcısında açılır.
- OpenAI API client'ı değildir; API key istemez. Mevcut ChatGPT web hesabınızı kullanır.
- Telemetri, analytics, kendi sunucusu, auto-update **yoktur**.

> ChatGPT Tabs bağımsız bir sarmalayıcıdır; OpenAI ile bağlantılı değildir.

---

## İçindekiler

1. [Hızlı başlangıç](#hızlı-başlangıç)
2. [Komutlar](#komutlar)
3. [Paket çıktıları (.app / .dmg)](#paket-çıktıları-app--dmg)
4. [İlk ChatGPT login](#i̇lk-chatgpt-login)
5. [Oturumu temizleme](#oturumu-temizleme)
6. [Klavye kısayolları](#klavye-kısayolları)
7. [Güvenlik modeli](#güvenlik-modeli)
8. [Gizlilik](#gizlilik)
9. [Mimari](#mimari)
10. [Testler](#testler)
11. [Bilinen sınırlamalar](#bilinen-sınırlamalar)
12. [Sorun giderme](#sorun-giderme)

---

## Hızlı başlangıç

Gereksinim: Node.js 20+ (geliştirme Node 24 ile yapıldı). Electron **global kurulmaz**; `devDependency` olarak projeye gelir.

```bash
npm install        # bağımlılıklar + Electron binary
npm run dev        # geliştirme modu (HMR'li arayüz)
```

Production paket:

```bash
npm run package    # typecheck + build + macOS .app ve .dmg
open "release/mac-arm64/ChatGPT Tabs.app"
```

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | electron-vite dev server + Electron, arayüzde hot reload |
| `npm start` | Derlenmiş `out/` klasörünü Electron ile çalıştırır (preview) |
| `npm run build` | Typecheck + production build (`out/main`, `out/preload`, `out/renderer`) |
| `npm run typecheck` | main/preload, renderer ve test kodları için `tsc --noEmit` |
| `npm run lint` | ESLint (typescript-eslint + react-hooks) |
| `npm test` | Unit testler (Vitest) + Electron E2E testleri (Playwright) |
| `npm run test:unit` | Sadece unit testler |
| `npm run test:e2e` | Build + Playwright ile gerçek Electron uygulaması testleri |
| `npm run package` | macOS `.app` + `.dmg` (Apple Silicon'da arm64) |
| `npm run package:win` / `package:linux` | Windows NSIS / Linux AppImage (ilgili OS'ta çalıştırın) |
| `npm run smoke:package` | Paketlenmiş uygulamayı izole profille açıp otomatik smoke test yapar |
| `npm run verify` | lint → typecheck → test → package → smoke:package (hepsi) |

## Paket çıktıları (.app / .dmg)

`npm run package` sonrası:

```
release/
├── mac-arm64/ChatGPT Tabs.app        # doğrudan çalıştırılabilir uygulama
└── ChatGPT Tabs-1.0.0-arm64.dmg      # sürükle-bırak kurulum imajı
```

(Intel Mac'te klasör `mac-x64` / dosya `-x64.dmg` olur.)

**İmzalama:** Apple Developer sertifikası olmadığından uygulama **ad-hoc imzalıdır** (`identity: "-"`). Kendi makinenizde derlediğinizde sorunsuz açılır. `.dmg`'yi başka bir Mac'e taşırsanız Gatekeeper "tanımlanamayan geliştirici" uyarısı verir; Finder'da sağ tık → **Aç** ile bir kez onaylayın. Dağıtım yapılacaksa `electron-builder.yml` içinde `mac.identity` gerçek bir Developer ID ile değiştirilip notarization eklenmelidir.

## İlk ChatGPT login

1. Uygulamayı açın. Otomatik olarak bir ChatGPT sekmesi açılır.
2. Sağ üstteki **⚙ Settings** butonuna (veya `⌘,` / `Ctrl+,`) basın.
3. **Open ChatGPT Login**'e tıklayın. Aynı kalıcı oturumu kullanan ayrı bir giriş penceresi açılır.
4. E-posta/şifre, Google, Microsoft veya Apple ile **normal şekilde, elle** giriş yapın (MFA dahil). Kurumsal SSO akışları da pencere içinde çalışır.
5. Giriş algılandığında pencere kendiliğinden kapanır ve açık sekmeler yenilenir. Pencereyi elle kapatırsanız da sekmeler yenilenir.
6. Settings'te durum **Signed in** olarak görünür.

Alternatif: Herhangi bir sekmedeki ChatGPT **Log in** butonu da aynı oturuma giriş yapar.

Uygulamayı kapatıp açtığınızda, ChatGPT oturum çerezinin süresi dolmadığı sürece tekrar login istenmez. Oturum, uygulama sürümü değişse de korunur çünkü partition adı sabittir (`persist:chatgpt`) ve kullanıcı verisi dizini uygulama adına bağlıdır.

Oturum verisinin diskteki yeri:

| OS | Konum |
| --- | --- |
| macOS | `~/Library/Application Support/ChatGPT Tabs/Partitions/chatgpt/` |
| Windows | `%APPDATA%\ChatGPT Tabs\Partitions\chatgpt\` |
| Linux | `~/.config/ChatGPT Tabs/Partitions/chatgpt/` |

## Oturumu temizleme

Settings → **Clear ChatGPT Session** → onay penceresinde **Clear Session**.

Bu işlem ChatGPT partition'ındaki **tüm çerezleri, cache'i, localStorage/IndexedDB/service worker verilerini ve HTTP auth cache'ini** siler, çerez deposunu diske flush eder, açık login penceresini kapatır ve bütün sekmeleri ChatGPT başlangıç sayfasına döndürür. Sonuç: tüm sekmelerde çıkış yapılmış durum. Sohbetleriniz ChatGPT hesabınızda durur; sadece bu bilgisayardaki yerel veri silinir.

## Klavye kısayolları

| İşlem | macOS | Windows / Linux |
| --- | --- | --- |
| Yeni sekme | `⌘T` | `Ctrl+T` |
| Aktif sekmeyi kapat | `⌘W` | `Ctrl+W` |
| Aktif sekmeyi yenile | `⌘R` | `Ctrl+R` |
| Cache'siz yenile | `⌘⇧R` | `Ctrl+Shift+R` |
| 1.–8. sekmeye geç | `⌘1` … `⌘8` | `Ctrl+1` … `Ctrl+8` |
| Son sekmeye geç | `⌘9` | `Ctrl+9` |
| Sonraki / önceki sekme | `Ctrl+Tab` / `Ctrl+⇧Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Geri / ileri | `⌘[` / `⌘]` | `Alt+←` / `Alt+→` |
| Settings | `⌘,` | `Ctrl+,` |
| Zoom | `⌘+` / `⌘-` / `⌘0` | `Ctrl++` / `Ctrl+-` / `Ctrl+0` |
| Sekme için DevTools | `⌥⌘I` | `Ctrl+Shift+I` |

Kısayollar uygulama menüsünün accelerator'larıdır; odak tab bar'da da olsa ChatGPT sayfasında da olsa çalışır. Sekmeye orta tıklama sekmeyi kapatır. Son sekme kapatılırsa uygulama kapanmaz, yeni temiz bir sekme açılır.

---

## Güvenlik modeli

Temel varsayım: **uzak ChatGPT içeriği güvenilmezdir**, uygulamanın kendi yerel arayüzü (tab bar/settings) güvenilirdir. İkisi arasında net bir güven sınırı vardır.

### Süreç ve izolasyon ayarları

| Bileşen | `sandbox` | `contextIsolation` | `nodeIntegration` | Preload |
| --- | --- | --- | --- | --- |
| ChatGPT sekmeleri (`WebContentsView`) | ✅ true | ✅ true | ❌ false | **yok** |
| Login penceresi | ✅ true | ✅ true | ❌ false | **yok** |
| OAuth popup'ları | ✅ true | ✅ true | ❌ false | **yok** |
| Yerel arayüz (tab bar) | ✅ true | ✅ true | ❌ false | minimal, tipli köprü |

Ek olarak tüm uzak içeriklerde: `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, `nodeIntegrationInSubFrames: false`, `safeDialogs: true`. Global `will-attach-webview` engeli ile hiçbir yerde `<webview>` oluşturulamaz. `enableRemoteModule` / `@electron/remote` kullanılmaz. Bu ayarlar E2E testlerinde gerçek `WebContents` üzerinden doğrulanır (sekme sayfasında `require`, `process` ve köprü nesnesinin **tanımsız** olduğu dahil).

### IPC yüzeyi

- ChatGPT sayfalarının **hiç preload'u yoktur**, dolayısıyla IPC'ye erişemezler.
- Yerel arayüze `contextBridge` ile sadece sabit fonksiyonlar açılır (`createTab`, `closeTab`, `openLogin`, `clearSession` …). Genel amaçlı `invoke`/`send`, dosya sistemi, shell veya komut çalıştırma **yoktur**.
- Main süreçte her handler çağrıyı yapanı doğrular: gönderen, ana pencerenin `webContents`'i **ve** onun main frame'i olmalı **ve** frame URL'si uygulamanın kendi arayüzü olmalı (paketli `file://…/renderer/index.html` veya dev server). Aksi halde çağrı reddedilir.
- Parametreler doğrulanır (ör. sekme id'si yalnızca `^tab-[1-9][0-9]{0,8}$`). Test: `activateTab('../../etc')` reddedilir.

### Navigation politikası (`src/main/security/navigationPolicy.ts`)

Saf (Electron'suz) ve unit-test edilmiş bir fonksiyondur:

| Hedef | Davranış |
| --- | --- |
| `https://chatgpt.com`, alt alan adları, `chat.openai.com` | Uygulama içinde kalır |
| Giriş sağlayıcıları: `auth.openai.com`, `auth0.openai.com`, `accounts.google.com`, `login.microsoftonline.com`, `login.live.com`, `appleid.apple.com`, Cloudflare challenge, `pay.openai.com` / Stripe checkout | Uygulama içinde kalır (login/upgrade akışları bozulmasın) |
| Sayfa zaten bir giriş sağlayıcısındayken herhangi bir `https` hedefi | İzinli (kurumsal SSO: Okta, Entra ID vb.) |
| Diğer `http(s)` ve `mailto:` | `shell.openExternal` ile **sistem tarayıcısında** açılır, uygulama içinde açılmaz |
| `file:`, `javascript:`, `chrome:`, özel şemalar, bozuk URL'ler | **Engellenir** |

- `shell.openExternal`'a yalnızca `http`, `https`, `mailto` geçer; başka şema asla işletim sistemine iletilmez.
- `will-navigate` ve main-frame `will-redirect` ikisi de denetlenir (script ile yapılan `location.href` yönlendirmeleri dahil).
- `window.open` / `target=_blank`: ChatGPT linki → yeni uygulama sekmesi; OAuth → aynı oturumu miras alan sandbox'lı popup; harici link → sistem tarayıcısı; diğerleri → reddedilir.
- Harici bir sayfa için açılmış boş popup, link sistem tarayıcısına verildikten sonra kapatılır.
- iframe'lere (Cloudflare Turnstile, ödeme widget'ları) müdahale edilmez; allowlist bilerek ChatGPT'nin API/CDN isteklerini bloklamaz.

### İzinler

- ChatGPT partition'ında sadece **chatgpt.com kökenine** ve sadece şu izinler verilir: `media` (sesli sohbet için mikrofon/kamera), `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, `notifications`. Diğer tüm izin istekleri ve diğer kökenler reddedilir.
- Yerel arayüzün kullandığı varsayılan oturum **hiçbir izin** alamaz.
- macOS mikrofon/kamera erişimi için `Info.plist` açıklamaları eklidir; sistem izni ilk kullanımda sorulur.

### Kimlik bilgileri ve çerezler

- Uygulama şifre, MFA kodu, token veya çerez değeri **okumaz, saklamaz, loglamaz**. Giriş gerçek web sayfalarına elle yapılır; autofill/password capture yoktur.
- Oturum, Electron'un kendi çerez/depolama mekanizmasında (`persist:chatgpt`) durur. Uygulamanın ayrı bir config dosyası veya veritabanı yoktur.
- "Signed in" durumu için yalnızca oturum çerezinin **var olup olmadığına** bakılır; değer asla okunmaz.
- Loglarda URL'ler `redactUrl` ile sadece `origin + path`'e indirgenir (OAuth `code`, `state`, token gibi query parametreleri ve `user:pass@` kısmı atılır). Production'da debug/info logları kapalıdır; sadece uyarı/hata yazılır.
- Kapanışta çerez deposu diske flush edilir, böylece login yeniden başlatmadan sonra da korunur.

### User-Agent

Electron varsayılan User-Agent'ına `Electron/x.y` ve uygulama adı token'larını ekler; Google gibi sağlayıcılar bu nedenle girişi "güvenli olmayan tarayıcı" diye reddeder. Uygulama bu **iki token'ı çıkarır**, kalan UA gömülü Chromium'un gerçek Chrome UA'sıdır. Başka hiçbir kimlik taklidi yapılmaz, hiçbir güvenlik mekanizması (CAPTCHA, Cloudflare, MFA) atlatılmaya çalışılmaz.

### Paket sertleştirme (Electron Fuses)

`electron-builder.yml` → `electronFuses`:

| Fuse | Değer | Anlamı |
| --- | --- | --- |
| `RunAsNode` | kapalı | `ELECTRON_RUN_AS_NODE` ile uygulama binary'si Node olarak kullanılamaz |
| `EnableNodeOptionsEnvironmentVariable` | kapalı | `NODE_OPTIONS` ile kod enjekte edilemez |
| `EnableNodeCliInspectArguments` | kapalı | `--inspect` ile main sürece debugger bağlanamaz |
| `EnableEmbeddedAsarIntegrityValidation` | açık | `app.asar` değiştirilirse uygulama açılmaz |
| `OnlyLoadAppFromAsar` | açık | Kod sadece bütünlüğü doğrulanan `app.asar`'dan yüklenir |
| `EnableCookieEncryption` | kapalı | Bkz. [sınırlamalar](#bilinen-sınırlamalar) |

Diğer önlemler: tek instance kilidi (aynı profil iki süreç tarafından açılamaz), yerel arayüzde katı CSP (`script-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`), yerel arayüz asla navigate etmez / pencere açmaz (tab bar'a bırakılan dosya arayüzü değiştiremez), OAuth popup'ları da sandbox'lı.

---

## Gizlilik

- Uygulamanın kendi ağ trafiği **yoktur**: telemetri, analytics, crash raporlama, update kontrolü yok.
- Tek ağ trafiği, sekmelerdeki ChatGPT sayfasının ve sizin seçtiğiniz giriş sağlayıcısının kendi trafiğidir.
- Sohbet içeriği hiçbir üçüncü tarafa gönderilmez, uygulama tarafından okunmaz.
- ChatGPT DOM'una hiçbir script enjekte edilmez; sayfa HTML/CSS'ine dokunulmaz.

---

## Mimari

```
src/
├── shared/                   # main/preload/renderer ortak: sabitler, IPC kanal/tip tanımları, doğrulama
├── main/
│   ├── index.ts              # app lifecycle: single-instance, ready, activate (dock), before-quit flush
│   ├── AppController.ts      # pencere + TabManager + LoginWindow + settings durumu; state'i UI'a yayınlar
│   ├── menu.ts               # uygulama menüsü = klavye kısayolları
│   ├── logger.ts             # sadece dev'de ayrıntılı log, hassas veri yok
│   ├── tabs/
│   │   ├── TabManager.ts     # createTab/activateTab/closeTab/reloadTab/getActiveTab/listTabs/updateTabTitle/destroyAllTabs
│   │   ├── tabOrder.ts       # saf yardımcılar (kapanınca hangi sekme, ⌘1-9, Ctrl+Tab)
│   │   └── contextMenu.ts    # native sağ tık menüsü (kopyala/yapıştır, link, resim, yazım denetimi)
│   ├── session/
│   │   ├── chatgptSession.ts # persist:chatgpt: izinler, indirmeler, UA, signed-in kontrolü, temizleme, flush
│   │   └── userAgent.ts
│   ├── auth/LoginWindow.ts   # aynı partition'lı giriş penceresi ve yaşam döngüsü
│   ├── security/
│   │   ├── navigationPolicy.ts   # saf karar fonksiyonları (unit-test'li)
│   │   ├── webContentsPolicy.ts  # politikayı will-navigate/will-redirect/window.open'a bağlar
│   │   └── externalLinks.ts      # güvenli shell.openExternal
│   ├── ipc/registerIpc.ts    # gönderen + parametre doğrulamalı IPC handler'ları
│   └── window/               # ana pencere, layout (view bounds), tema renkleri
├── preload/index.ts          # sadece yerel arayüz için minimal contextBridge API
└── renderer/                 # React arayüz: TabBar, Settings, hata/crash paneli
```

**Sekme yaşam döngüsü.** Her sekme `persist:chatgpt` partition'lı yeni bir `WebContentsView` ile oluşturulur ve `https://chatgpt.com/` açar (aktif sekmenin URL'si kopyalanmaz). Pencereye **yalnızca aktif sekmenin view'i** eklenir; pasif view'ler detach edilir ama **yok edilmez**, böylece sohbet (akan yanıtlar dahil) kaldığı yerden devam eder. Sekme kapanınca view pencereden çıkarılır ve `webContents.close()` ile açıkça yok edilir (WebContentsView bunu garbage collection'da yapmaz). Pencere kapanınca / uygulama çıkarken `destroyAllTabs()` tüm web içeriklerini kapatır. macOS'ta dock ikonuna tıklanınca yeni pencere + temiz sekme açılır.

**Layout.** View konumu tek bir saf fonksiyondan (`computeTabViewBounds`) hesaplanır: tab bar yüksekliği (40 DIP) altındaki tüm alan. `resize`, `maximize`, `restore`, fullscreen olaylarında yeniden hesaplanır. Değerler DIP cinsindendir; Retina/HiDPI dönüşümünü Electron yapar. macOS'ta `hiddenInset` başlık çubuğu kullanılır, traffic light'lar için tab bar solunda boşluk bırakılır (fullscreen'de kaldırılır). Windows/Linux'ta `titleBarOverlay` ile native pencere butonları korunur.

**Settings ve hata ekranları** yerel arayüzde çizilir; bunlar görünürken aktif ChatGPT view'i detach edilir (native view'ler HTML'in üstünde durduğundan overlay yerine bu yaklaşım kullanılır).

**Hata yönetimi.** Main-frame `did-fail-load` (iptal edilen `-3` hariç) → sekme `error` durumuna geçer, "ChatGPT could not be loaded" + **Retry**. `render-process-gone` → "This tab stopped working" + **Reload tab**. Yerel arayüzün renderer'ı çökerse otomatik yeniden yüklenir. Sekme başlıkları polling ile değil `page-title-updated` olayıyla güncellenir.

**İndirmeler.** Electron'un yerel indirme mekanizması korunur: kaydetme penceresi `~/Downloads/<dosya adı>` önerisiyle açılır; macOS'ta tamamlanınca Downloads yığını dock'ta zıplar. Dosya yükleme (native file picker), sürükle-bırak ve kopyala/yapıştır ChatGPT'nin kendi mekanizmalarıyla, müdahalesiz çalışır.

**Teknolojiler.** Electron 44 (`WebContentsView`, BrowserView kullanılmaz), TypeScript 6, electron-vite 5 / Vite 7, React 19, electron-builder 26, Vitest 5, Playwright 1.63, ESLint 10.

---

## Testler

```bash
npm run test:unit    # 21 test: navigation politikası, URL redaksiyonu, UA, layout, sekme sırası, id doğrulama
npm run test:e2e     # 16 test: gerçek Electron uygulaması üzerinde
npm run smoke:package
```

E2E testleri gerçek ChatGPT hesabı veya ağ gerektirmez: her test izole geçici bir profil dizini kullanır (`CHATGPT_TABS_USER_DATA_DIR`), `chatgpt.com` istekleri test içinde yerel bir stub sayfaya yönlendirilir, `shell.openExternal` kaydediciyle değiştirilir. Kapsam:

- açılışta tek sekme + doğru view bounds; her sekme ayrı `WebContents`, hepsi aynı kalıcı `persist:chatgpt` session'ı; sandbox/contextIsolation/nodeIntegration/preload doğrulaması
- yeni sekmenin temiz başlaması, sekmeler arası geçişte navigation durumunun korunması, geri/ileri
- menü kısayolları (yeni/kapat/⌘1-9/Ctrl+Tab) ve accelerator değerleri
- sekme kapatınca `WebContents`'in yok edilmesi, son sekme kapanınca yeni sekme
- reload (buton + menü), settings ekranı, login penceresi (aynı session, giriş algılama, kapanış, sekme yenileme)
- oturum temizleme (çerez + localStorage silinir), harici link/`target=_blank`/script yönlendirmesi → sistem tarayıcısı, `file:` engeli, ChatGPT popup'ı → yeni sekme
- pencere boyutlandırmada bounds, yükleme hatası + Retry, renderer crash + kurtarma, geçersiz IPC reddi
- pencere kapanınca tüm sekme `WebContents`'lerinin temizlenmesi + dock ile yeniden açılış, çerezlerin uygulama yeniden başlatıldığında korunması

`smoke:package` paketlenmiş `.app`'i izole profille başlatır, CDP üzerinden bağlanır ve arayüzün `app.asar`'dan yüklendiğini, gerçek `https://chatgpt.com`'un açıldığını, sekme açma/geçme/kapama ve Settings'i doğrular.

Gerçek ChatGPT hesabıyla login testi otomatikleştirilmemiştir (bilerek); manuel smoke test: uygulamayı açın → Settings → Open ChatGPT Login → giriş yapın → uygulamayı kapatıp açın → hâlâ girişli olmalısınız.

---

## Bilinen sınırlamalar

- **Kod imzası / notarization yok.** Uygulama ad-hoc imzalıdır; başka bir Mac'te ilk açılışta Gatekeeper onayı gerekir.
- **Çerezler diskte şifrelenmeden durur** (`EnableCookieEncryption` kapalı, Electron varsayılanı). Açılması Keychain'e bağlı ve imzasız/ad-hoc imzalı yapılarda her yeni build'de Keychain izin penceresi çıkarır; gerçek bir Developer ID ile imzalanıyorsa açılması önerilir (açıldığında mevcut oturum bir kez sıfırlanır). Profil klasörü yalnızca sizin kullanıcı hesabınızın erişimindedir; FileVault önerilir.
- **Google/Microsoft/Apple girişi** gömülü tarayıcıları zaman zaman yeniden kısıtlayabilir. Böyle bir durumda e-posta + şifre ile ChatGPT girişi veya sekme içindeki "Log in" butonu kullanılabilir.
- **Otomasyon altında** (`navigator.webdriver = true`) ChatGPT çıkış yapılmış kullanıcıyı doğrudan Google girişine yönlendiriyor; bu yüzden E2E testleri stub sayfa kullanır. Normal kullanımda bu olmaz (paket smoke testinde doğrulandı).
- **Pasif sekmeler** Chromium'un arka plan throttling'ine tabidir: akan yanıt devam eder ama ekrana çizimi sekmeye dönünce güncellenir. Her sekme ayrı renderer süreci olduğundan sekme sayısıyla bellek kullanımı artar; güvenlik için en fazla 50 sekme açılabilir.
- **Açık sekmeler yeniden başlatmada geri yüklenmez**; her açılış tek temiz sekmeyle başlar (sohbetler ChatGPT'nin sol menüsünden açılabilir).
- **Auto-update yoktur**; yeni sürüm için yeniden `npm run package`.
- `blob:` URL'leri (ChatGPT'nin "yeni pencerede aç" dediği bazı önizlemeler) sandbox'lı küçük bir pencerede açılır.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Sekmede "ChatGPT could not be loaded" | İnternet bağlantısını kontrol edip **Retry**'a basın |
| "This tab stopped working" | **Reload tab** |
| Login sonrası sekmeler hâlâ çıkış yapılmış görünüyor | `⌘R` ile sekmeyi yenileyin; olmazsa Settings → Clear ChatGPT Session → yeniden giriş |
| Uygulama ikinci kez açılmıyor | Tek instance kilidi: mevcut pencere öne gelir |
| Ayrıntılı log gerekiyor | `CHATGPT_TABS_DEBUG=1 "release/mac-arm64/ChatGPT Tabs.app/Contents/MacOS/ChatGPT Tabs"` (hassas veri loglanmaz) |
| Ayrı/temiz profil denemek | `CHATGPT_TABS_USER_DATA_DIR=/tmp/profil ...` ile başlatın |
