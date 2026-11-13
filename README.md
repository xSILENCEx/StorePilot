# StorePilot

在打包机上自托管的 Apple App Store / Google Play 商店资料工作台。产品方向见 [开发说明](./DEVELOPMENT.md)。

## 本次交付范围

按本次确认，完成本机基础与服务端基础，商店和 AI 凭据稍后配置。

- 应用创建与设置、Apple / Google 独立语言草稿、文案编辑、截图上传与排序。
- Better Auth 管理员登录，关闭公开注册；业务接口、素材与任务日志均需登录，响应禁止公共缓存。
- PostgreSQL + Drizzle 草稿持久化；修订号阻止旧窗口覆盖新资料。保存失败暂停编辑并保留当前页面数据，可导出 JSON 备份。
- 本机素材存储，PNG/JPEG 内容识别、20 MB / 4000 万像素限制、SHA-256 去重。
- Graphile Worker 独立进程；冻结任务输入、按应用及平台串行、轮询状态、步骤日志、自动重试与失败后手动重试。当前真实任务是字段长度和素材可读性校验。
- 旧版 localStorage 草稿可通过页面顶部入口导入；原数据保留。JSON 导出仅包含草稿及素材引用，不是完整备份。

已提供商店与模型配置页面及凭据加密保存。已接通连接验证；尚未实现官方语言目录、设备截图合规校验、Google 远端拉取、冲突处理、差异推送及回读、元数据翻译、自动模板规划、多语言批量翻译、公网入口和开机启动。推送保持禁用。后台校验成功不等同于商店校验通过。

## Apple 商店只读闭环（第一步）

应用详情的 Apple Tab 新增「Apple 商店文案」：

1. 在连接设置填好 Apple 凭据、应用平台与**明确的目标版本号**。
2. 点击「拉取远端文案」。Worker 仅执行 GET：核对应用身份，分别读取应用级名称/副标题及目标版本描述/关键词，支持分页。
3. 若存在多个应用资料版本，任务会列出 ID 与状态；在「应用资料 ID」中填写要读取的 ID 再拉取，不自动猜测。
4. 展开语言查看草稿与远端差异（有同目标的上次快照时也显示上次远端）。点击「导入缺少的语言」走现有草稿自动保存流程；已有语言即使为空也不会覆盖，截图保持原样。

每次成功拉取原子保存当前及上次快照；失败保留原快照和草稿。连接配置改变后旧快照标为过期，需重新拉取后才能导入。应用级和版本级语言不完整时显示提示。此阶段仅覆盖四个文案字段，不读取远端截图，不处理冲突选择、不写入 Apple，不根据状态推断可编辑权限。

升级执行 `npm run db:migrate` 并重启 Worker。自动化验证：`npx tsx scripts/verify-apple-sync.ts`，创建后删除隔离测试数据库，用模拟 Apple 响应和真实 Worker 检查鉴权、队列、失败保留与配置竞态，不调用真实 Apple 服务。已用模拟数据通过浏览器差异展开与导入交互验证，真实 Apple 应用仍需只读验收。

字段依据：[应用级本地化](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfolocalizations-_id_)、[版本级本地化](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations)、[按平台及版本定位](https://developer.apple.com/documentation/appstoreconnectapi/uploading-app-previews)。

## 手动配置商店与模型

登录后打开 http://127.0.0.1:3000/settings ，或从工作台点击「连接与模型配置」。

- Apple（按应用）：Issuer ID、Key ID、数字 Apple 应用 ID、Bundle ID、应用平台、可选目标版本，上传 `.p8` 或粘贴私钥。
- Google（按应用）：包名，上传或粘贴 Google 服务账号 JSON。
- 文本 / 图像模型（工作空间级，分别保存）：OpenAI 兼容 API Base URL、模型 ID、API Key、超时秒数、并发上限。本机模型地址支持 HTTP；远程地址需 HTTPS。

首次保存必须提供凭据；之后密钥栏留空保留原值，填写或上传新内容则替换。密钥使用独立主密钥和 AES-256-GCM 加密入库，并绑定应用/平台；GET 只返回是否已保存，不返回明文或密文。草稿导出不包含凭据。支持清除配置与修订冲突检测。

旧安装需先执行 `npm run config:key` 和 `npm run db:migrate`，然后重启 Web / Worker。本机本次已完成主密钥生成和迁移。主密钥位于 `.env.local` 的 `STOREPILOT_MASTER_KEY`；备份必须包含它，不能随意重新生成或替换。

保存只做结构校验和加密存储。保存后点击卡片上的「验证连接」；任务由本机 Worker 执行，每 2 秒轮询，关闭页面后仍可继续，重新进入可查看结果与步骤。

- Apple：使用 ES256 JWT 读取数字应用 ID，核对 Bundle ID。通过仅说明鉴权和应用读取正常，不代表写权限、截图上传或目标版本状态已验证。
- Google「验证鉴权」：只获取服务账号 OAuth 令牌，成功显示「部分验证通过」，不创建 edit，尚未检查包名及应用权限。
- Google「验证应用权限」：需先在页面确认临时 edit 的影响，然后创建 edit、读取本地化列表并删除本次 edit，不调用 commit。Google [官方文档](https://developers.google.com/resources/api-libraries/documentation/androidpublisher/v3/python/latest/androidpublisher_v3.edits.html)说明，新 edit 可能使该账号已有的 edit 失效；请避开其他正在进行的 API 编辑任务。清理失败会明确报告。
- 文本 / 图像模型：携带已保存密钥访问 `/models`，检查模型 ID。未找到时为部分通过；不调用文本或图片生成接口，不能证明生成能力或余额充足。

每次修改或清除配置都会使旧验证失效；执行中的旧任务也不能把结果写回新配置。失败会显示步骤、HTTP 状态或网络原因，修正后可重新验证。长期排队时检查 `npm run worker`。图像生成已在应用详情的 AI 截图工作室接通；Apple 文案只读拉取已接入；其余同步、推送和元数据翻译仍待后续开发。

如本机出站需要代理，可在启动 Worker 的终端设置 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY` / `HTTP_PROXY`，并设置 `NO_PROXY=127.0.0.1,localhost,::1` 后运行 `npm run worker`；所有验证请求仍由本机 Worker 发出。不要把密钥放入代理或 API URL。

验证逻辑测试：`npm test`；持久化 Worker 验证：`npx tsx scripts/verify-connection-worker.ts`。后者使用模拟远端响应和独立测试行，不调用真实服务，不读取或改写用户已填写的配置。

配置集成验证可运行 `npx tsx scripts/verify-configs.ts`：使用临时应用及测试凭据，检查四类配置、鉴权、加密、不回显、密钥保留与清除、修订冲突。已有工作空间模型配置会保留并跳过写入测试，不调用真实外部服务。

## AI 生成图片与截图工作室

进入应用详情，选择平台和语言，在元数据上方使用「AI 截图工作室」：

1. 选择设备尺寸；每个平台、语言和设备都有独立的生成配置、候选与已采用截图。
2. 上传或选择真实 App 截图、美术参考图，填写主标题、副文案、提示词，调整固定模板、颜色、输出格式及模型请求尺寸 / 质量。
3. 保存配置，或直接点击生成（会先保存）。已保存配置在 PostgreSQL；未保存输入会留在当前浏览器暂存，切换设备或语言后可恢复，旧修订不会覆盖另一窗口的新配置。
4. 后台生成后在候选区预览。点击「追加采用」或「替换整组」后才会改变已采用截图；支持排序、移除、恢复上次结果（包括恢复为空）、下载原尺寸文件。
5. 也可以上传成品截图：校验当前设备尺寸、PNG/JPEG、不含透明通道及 8 MB 上限，再进入候选区供采用。

三种方式：

| 方式                 | 行为                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI 背景 + 真实截图   | 图像模型生成背景，真实 App 截图留在本机，由共享 React 模板叠加文字与截图。美术参考图如已选择，会通过图像编辑接口发送给模型。                                                      |
| AI 整图 / 参考图改图 | 无参考图时使用 `/images/generations`；选择参考图时使用 multipart `/images/edits`。选择的真实截图与美术图会发送到已配置服务，结果明确标注为 AI 整图 / 改图，需人工核对 UI 与文字。 |
| 仅固定模板渲染       | 不调用模型，在本机使用 Chromium 渲染；真实截图和文案不发送到模型服务。                                                                                                            |

接口沿用设置页面的模型 ID、API 地址、密钥与超时，不替换用户模型。协议参考 [OpenAI Images 生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)及[编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)，第三方服务需兼容相同接口。支持 `data[0].b64_json` 或 HTTPS 公网图片 URL；下载不携带模型密钥，限制大小并阻止内网地址、重定向泄露。模型响应先持久化，最终输出经 Sharp 转为 sRGB、不透明 PNG/JPEG，复检目标尺寸和 8 MB 上限，另存缩略图。过长模板文案会报错，不静默输出被截断的文字。

每次点击生成仅请求一张，每组最多同时排队四张；任务由独立 Worker 执行，轮询刷新，关页后继续。图像任务按模型并发上限分队列，实际并发还受 Worker 的总并发（当前 2）限制。真实截图与模板渲染预检先于付费背景请求。

- 已有 AI 原图可点击「用当前配置重渲染」修改文案、模板或输出格式，不再次调用模型。
- 处理失败后使用「仅重试已保存结果处理」，复用已有原图 / 模型响应。返回的临时下载 URL 若已过期，可能需要用户明确发起新生成。
- 请求已发送但没有可靠响应时显示「调用结果未知」，不会自动再次请求；「按此配置重新生成」明确创建新的模型调用，可能再次计费。请求 ID 防止重复入队，调用记录和响应检查点用于重启恢复。
- 生成期间改变模型配置会使尚未调用模型的旧任务失败；已有响应仍可继续处理，不需要原密钥。
- 隐藏候选可恢复；已采用及用于上次恢复的候选不能隐藏。当前保留共享素材，不做危险的物理文件回收。

设备预设是已实现的固定尺寸子集，并非完整商店规格目录。Apple 尺寸参考[官方截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)，Google 参考[官方预览素材说明](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)。这里的校验不代表商店完整审核 / 合规预检通过，推送仍禁用。

安装后需准备后台渲染运行时：`npx playwright install chromium`。本机已安装在 `~/Library/Caches/ms-playwright/`，包括测试版 Chromium、Headless Shell 和 Playwright 附带的 FFmpeg，不替换日常浏览器。原有未分类截图继续保留在工作室下方，可作为参考素材使用。

开发验证：`npm run verify:images`。测试自动创建并删除独立 PostgreSQL 测试库和临时素材目录，用模拟模型响应、真实 Graphile Worker 与 Chromium 验证生成 / 编辑、候选采用与恢复、幂等、原图复用及防重复付费；不会读取或修改用户资料 / 模型配置，不调用真实付费模型。需要数据库账号具备创建测试库的权限。示例输出保留在 `data/verification/image-studio-template.png`。

尚未实现元数据翻译、自动 AI 模板规划或跨语言自动翻译；模板文字可以手动按语言编辑后渲染。

## 首次启动

需要 Node.js 24 和 npm。本机数据库通过 `embedded-postgres` 启动真实 PostgreSQL，不要求 Docker；数据库与业务进程仍然独立运行。

```sh
npm install
npm run setup:local
npm run db:local
```

保持数据库终端运行，另开终端执行：

```sh
npm run db:migrate
npm run admin:bootstrap
npx playwright install chromium
npm run dev
```

再开一个终端运行 Worker：

```sh
npm run worker
```

打开 http://127.0.0.1:3000/login 。初始随机管理员邮箱及密码在 `data/admin-login.json`，文件权限为 `0600`；请本机查看。已存在管理员时，bootstrap 不会覆盖账号。也可临时设置 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 后运行 `npm run admin:create` 创建其他管理员，密码至少 12 字符。

`setup:local` 创建随机数据库密码及会话密钥，保存在仅本机用户可读的 `.env.local`；已有文件时不会覆盖。`data/` 和环境文件已从 Git 排除。请不要将管理员明文密码长期放入环境文件。

## 后续启动与生产运行

日常使用推荐独立后台服务，不依赖终端或工具会话的输出管道：

```sh
# 首次安装或修改代码后，先构建；构建时请先停止后台 Web
npm run build
npm run services:start
npm run services:status
# 停止本脚本启动的服务（资料保留）
npm run services:stop
```

`services:start` 使用生产模式，重复执行不会重复创建已管理的进程。若本机数据库尚未启动，会自动启动 `db:local`；数据库已由其他终端启动时只复用，不接管或停止该进程。外部数据库必须预先可连接。首次安装仍需按上文执行初始化、迁移和创建管理员。

Web、Worker 和必要时启动的数据库各自独立运行，关闭启动终端后继续运行；日志写入 `data/logs/web.log`、`worker.log`、`database.log`，进程记录位于 `data/services.json`。Web 只监听 `127.0.0.1:3000`。如提示 3000 端口被非本脚本管理的进程占用，先停止之前手动运行的 `npm run dev` / `npm start`，再运行启动命令。

开发时仍可分别在终端运行 `npm run db:local`、`npm run dev`、`npm run worker`。不要同时启动开发 Web 与后台生产 Web。修改代码后需先停止后台 Web，重新构建，再启动，才能使用新的生产构建。

本机数据库监听 `127.0.0.1:55432`，数据在 `data/postgres`，图片在 `data/assets`，队列存于同一 PostgreSQL。更换外部 PostgreSQL 时更新 `DATABASE_URL` 并执行迁移；更换访问地址时同步更新 `BETTER_AUTH_URL`。这些命令不会安装开机启动项；系统重启后需再次执行 `services:start`。

如果端口存在但页面一直超时，查看 `data/logs/web.log`。曾出现旧开发进程输出管道断开导致 `write EPIPE` 和请求无响应；后台模式把输出固定到文件，避免依赖已结束的工具会话。运行 `services:stop` 后再 `services:start` 可重启托管进程。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm audit
```

数据库、Web 和 Worker 启动后，可运行本机集成验证：

```sh
npx tsx scripts/verify-local.ts
```

该脚本读取初始管理员文件，检查登录与关闭注册、接口鉴权、来源校验、草稿保存、旧修订冲突、图片去重和鉴权、Worker 执行与日志。它创建测试应用后删除该测试应用；测试素材和任务记录保留，便于检查。

验证重启恢复（本机开发环境执行）：先停止 Worker，运行 `npx tsx scripts/verify-restart.ts prepare`，正常停止并重启数据库、重启 Worker，再运行 `npx tsx scripts/verify-restart.ts check`。该验证确认草稿修订及内容不变、停机期间入队的任务能恢复执行。

本次已通过类型检查、单元测试、生产构建、API 集成与数据库/Worker 重启验证。浏览器自动化通道不可用，页面视觉和交互仍需人工验收。

## 数据与备份

本机阶段如需完整冷备份，先依次停止 Web、Worker、数据库，备份 `data/postgres`、`data/assets`、`data/image-responses` 和 `.env.local`，恢复时保持配套。不要直接复制运行中的 PostgreSQL 数据目录。恢复 PostgreSQL 数据目录需要相同 PostgreSQL 主版本及兼容的平台；跨版本/机器迁移应使用 PostgreSQL 官方备份工具。

`data/admin-login.json` 是初始登录信息，并非数据库恢复必需项；如保留，请和数据库、环境密钥一样安全存放。公网访问、自动备份、恢复演练及开机启动仍属于后续部署阶段。

## 目录

- `app/`：工作台、登录与鉴权 API。
- `lib/`：数据模型、Drizzle 表定义、登录、素材、任务实现、保存状态。
- `db/`：基础表、凭据配置、连接验证、截图组、候选、调用记录与恢复历史的迁移；登录与队列使用各自官方迁移。
- `scripts/`：本机初始化、数据库、管理员、迁移、Worker 与验证入口。
- `tests/`：输入边界与平台字段校验测试。
