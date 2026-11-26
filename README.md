# StorePilot

在打包机上自托管的 Apple App Store / Google Play 商店资料工具。

## 实现

- Next.js 提供页面和 API，Mantine 提供界面组件；SQLite 保存草稿、配置、任务与商店快照。
- 一个独立 Node Worker 顺序执行持久化任务。无需数据库服务、Docker 或外部队列。
- Better Auth 管理员登录，关闭公开注册；业务接口、素材和日志均需登录。
- 商店与模型密钥使用 AES-256-GCM 加密，主密钥由本机环境提供。
- 素材存于本机文件，Sharp 负责识别图片、格式标准化和大小检查。

## 功能

- 应用、Apple / Google 独立语言草稿、文案编辑、截图上传、排序及移除。
- 草稿自动保存与修订冲突检查，失败后暂停保存并保留页面内容，可导出 JSON。
- Apple / Google 商店凭据与文本 / 图像模型配置、后台连接验证。
- Apple 商店资料同步：应用信息、本地化元数据、按语言和设备分组的截图；支持差异查看与选择导入，保留本地草稿。
- AI 图片生成：提示词 + 可选参考图，直接调用已配置的图像 API。

在草稿编辑页点击「推送到商店」，选择语言和模块后确认。非空字段会更新，非空设备组按草稿顺序替换整组截图。Apple 写入可编辑版本，Google 通过 edit 校验并提交。推送进度与失败详情在任务记录中查看。

## 首次启动

需要 Node.js 24 或 26，以及 npm：

```sh
npm install
npm run setup:local
npm run db:migrate
npm run admin:bootstrap
```

初始随机管理员账号保存在 `data/admin-login.json`（权限 `0600`）。已有管理员时不会覆盖。

开发时分别运行：

```sh
npm run dev
npm run worker
```

打开 http://127.0.0.1:3000/login 。不需要单独启动数据库，也不需要安装 Chromium。

生产运行：

```sh
npm run build
npm run services:start
npm run services:status
# 停止 Web 与 Worker，保留数据
npm run services:stop
```

后台脚本启动两个进程，关闭终端后继续运行，日志位于 `data/logs/web.log` 和 `worker.log`。更新代码时先停止服务，再构建并启动。尚未配置开机启动。

`setup:local` 生成 `.env.local`，包含会话密钥和凭据加密主密钥；已有文件保持原样。SQLite 默认路径为 `data/storepilot.sqlite`，可通过 `DATABASE_PATH` 修改。

## AI 生成图片

1. 在「模型配置」页面，打开图像模型卡片的「管理配置」，填写图像 API 地址、模型 ID、API Key 和超时。
2. 打开应用并选择平台及语言，点击截图区的「AI 生成」。在弹窗的「描述画面」页填写提示词，画面、文字和构图全部写入提示词。
3. 在「截图」区多选已有截图或批量上传，每张选中的截图生成一张结果。在「素材」区可多选上传最多四张共享参考素材，每次调用都携带这些素材。尺寸、质量位于可展开的「高级选项」。
4. 点击「生成 N 张图片」后进入「查看结果」。可关闭弹窗等待，再次打开查看；点击结果进入二级预览，下载或加入商店截图。

无参考图调用 `/images/generations`；有参考图调用 multipart `/images/edits`。提示词原样传递，一次请求一张。服务需兼容 Images API，返回 `data[0].b64_json` 或 HTTPS 公网图片 URL。

不使用本机模板、文字叠加或浏览器渲染。输出保留模型生成尺寸，经 Sharp 转为不透明 sRGB PNG。加入商店截图时按目标设备校验分辨率。请人工核对文字与真实 UI。

同一时间最多保留四批排队/执行中的图片任务，由 Worker 顺序处理。关闭页面不影响执行，重新进入可查看结果。请求 ID 防止相同提交重复入队。模型请求发出前记录状态，响应先保存到本机；Worker 中断后可恢复已有响应，无可靠响应时标记「调用结果未知」，不自动重发付费请求。失败后需要新图时再次点击生成，会创建新的调用。

删除生成记录不会删除已加入草稿的图片文件。商店截图按平台、语言和设备分组独立保存和排序。旧草稿截图显示在「待分组」。Apple 同步时读取设备目录，离线使用[公开截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)；Google 分组依据 [Play Console 截图要求](https://support.google.com/googleplay/android-developer/answer/9866151)。截图列表支持排序和移除；上传素材支持静态 PNG/JPEG，最多 20 MB / 4000 万像素。当前不做素材物理回收。

商店截图和 Google Play 图片资源按实际像素及 EXIF 方向校验。符合要求的尺寸直接保留。需要转换时，仅当原图两边均足够大、居中裁剪最多损失该方向的 0.5% 时，才等比缩小或裁去少量边缘。无法适配时会提示原始尺寸和目标要求。Google Play 图标为 512 × 512 px，宣传图为 1024 × 500 px。AI 参考素材可保留原尺寸。

## 连接与商店读取

- Apple（按应用）：Issuer ID、Key ID、数字应用 ID、Bundle ID、平台及目标版本，上传或粘贴 `.p8` 私钥。目标版本可留空：优先读取已上架版本，没有已上架版本时读取最新版本；填写时严格读取指定版本。
- Google（按应用）：包名与服务账号 JSON。
- 文本 / 图像模型（工作空间级）：OpenAI 兼容 Base URL、模型 ID、API Key、超时。远程地址使用 HTTPS，本机模型可使用 HTTP。

首次保存必须提供凭据；之后密钥留空保留原值。GET 和草稿导出均不返回凭据。修改或清除配置会使旧验证失效，旧任务不会覆盖新配置的验证结果。

连接验证范围：Apple 读取应用并核对 Bundle ID；Google 默认只获取 OAuth 令牌；模型只读取 `/models`。它们不证明截图上传、推送或模型生成一定成功。

Google「验证应用权限」需在页面确认后执行：创建临时 edit、读取本地化列表、删除该 edit，不 commit。创建 edit 可能影响同账号已有 edit，请避开其他编辑任务。进程中断时不会自动重做该验证，需先检查远端 edit 状态。

所有商店和模型请求由打包机 Worker 发出。若本机出站需要代理，可设置 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY` / `HTTP_PROXY`，并将本机地址加入 `NO_PROXY`。

## Apple 商店资料同步

在应用详情点击「商店资料」，再点击「同步商店资料」。此操作只读取 App Store，不修改或发布远端内容。连接中的目标版本可留空；自动选择优先已上架版本，否则为最新版本，并匹配该版本对应的应用资料。

- 本地化元数据：名称、副标题、描述、关键词、推广文本、版本更新说明、支持 / 营销 / 隐私政策 / 隐私选择网址。
- 应用信息：主要语言、SKU、版本、平台、版权、发布方式、分类与年龄分级（以 API 返回内容为准）。
- 商店截图：保存到本机，按语言、设备类别及商店展示顺序查看，支持预览、下载和按组加入本地截图。

新增语言可批量补充元数据；更新已有语言需点击「导入当前语言」并确认，保留其已有截图。导入截图只追加已选设备组，不移除原图。

优先读取 Apple App Asset Library placements；对尚未提供新关系的资料使用现有截图集合接口。下载图片不携带 API 凭据，素材通过本机鉴权接口读取。同一截图后续同步复用本地文件；截图下载失败时保留上次成功的完整快照。

## Google Play 商店资料同步

在 Google Play 平台打开「商店资料」并点击「同步商店资料」。系统读取主商店详情中各语言的名称、简短描述、完整描述和宣传视频网址，并保存手机、7 英寸平板和 10 英寸平板 的截图。可查看差异、导入文案或按设备组追加截图，现有内部备注和截图会保留。同步通过临时 edit 读取并在读取结束后删除该 edit，请避开同一服务账号对该应用的其他编辑任务。

## 验证

```sh
npm run verify
# 仅运行隔离的 SQLite / 登录 / 图片 / Worker / Apple 工作流验证
npm run verify:images
```

测试使用临时 SQLite、临时素材和模拟外部 API，不读取用户资料，不调用付费模型。覆盖登录与来源校验、草稿冲突、素材鉴权、生成去重、图像编辑、调用结果未知、响应恢复、独立 Worker 进程及 Apple 快照保存。

Web 与 Worker 启动后，也可运行 `npx tsx scripts/verify-local.ts` 检查实际 HTTP 登录、保存、上传和任务执行。

## 数据与备份

先执行 `npm run services:stop`，再备份 `data/` 和 `.env.local`。开发模式需手动停止 Web 和 Worker。SQLite 的 `-wal` / `-shm` 文件若存在应一起备份；不要只复制运行中的主数据库文件。恢复时数据库、素材、图像响应与加密主密钥需配套。

JSON 导出仅包含草稿及素材引用，不是完整备份。`data/` 和本机环境文件不会提交到 Git。本版不提供旧 PostgreSQL 数据迁移。

## 目录

- `app/`：页面与鉴权 API。
- `components/`：Mantine 主题与工作空间布局、截图列表、AI 生成弹窗、Apple 商店资料和任务抽屉。
- `lib/`：SQLite、数据模型、配置、商店与模型调用、任务执行。
- `db/schema.sql`：全新安装的业务表定义；登录表由 Better Auth 初始化。
- `scripts/`：初始化、管理员、Worker 和后台进程管理。
- `tests/`：输入边界、API 适配器及隔离工作流测试。

### 翻译图片的可选超分辨率

在打包机将 [waifu2x-ncnn-vulkan 20250915](https://github.com/nihui/waifu2x-ncnn-vulkan/releases/tag/20250915) 的 macOS 发布包解压至项目的 `data/tools/`。默认目录为 `data/tools/waifu2x-ncnn-vulkan-20250915-macos/`，保留可执行文件和同级的 `models-cunet/`。其他安装位置通过 Worker 环境变量 `STOREPILOT_WAIFU2X_DIR` 指定。该 macOS ZIP 的 SHA-256 为 `a5b58b239eb3aa030db5464f6759637fe412d8c07891a4346ea57f708b514d42`。

批量生成或翻译图片时，先在任务记录中确认首张样图。记录显示模型、目标尺寸、请求画布和实际返回尺寸。GPT Image 2 系列按目标比例请求允许的最高分辨率。返回图片按目标比例居中裁剪，缩小时使用 Lanczos，放大时使用最近邻复制像素，最后保存为目标尺寸的 PNG。
