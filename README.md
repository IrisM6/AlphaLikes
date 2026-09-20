# AlphaLikes

**Zotero 的 alphaXiv 点赞列**

[![Zotero 7–9](https://img.shields.io/badge/Zotero-7%E2%80%939-cc2936?style=flat-square&logo=zotero)](https://www.zotero.org/)
[![Release](https://img.shields.io/github/v/release/IrisM6/AlphaLikes?style=flat-square)](https://github.com/IrisM6/AlphaLikes/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/IrisM6/AlphaLikes/ci.yml?style=flat-square)](https://github.com/IrisM6/AlphaLikes/actions/workflows/ci.yml)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square)](https://github.com/windingwind/zotero-plugin-template)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)

AlphaLikes 是一个可排序的 Zotero 条目列表列。它从条目的 `URL`、`DOI` 或 `Extra` 字段识别 arXiv ID，从 [alphaXiv](https://www.alphaxiv.org/) 页面读取点赞数，并把成功结果持久化到 Zotero 条目中。

从 v1.1.0 起，**没有 arXiv ID 的条目也能自动匹配**：插件会通过 DOI 和标题查询多个免费学术 API，对候选结果打分，高置信度的自动采用，中等置信度的交给你右键确认。

> AlphaLikes is a Zotero 7–9 plugin that adds a sortable **alphaXiv Likes** column for arXiv papers, with automatic arXiv-ID matching, colour coding and like-count filtering.

## 功能

- 在 Zotero 条目列表中注册 **alphaXiv Likes** 列，可点击列头按数值排序；
- 识别现代及旧式 arXiv ID，例如：
  - `https://arxiv.org/abs/2301.12345`
  - `https://arxiv.org/pdf/hep-th/9901001.pdf`
  - `Extra` 中的 `arXiv: 2301.12345`
  - `DOI: 10.48550/arXiv.2301.12345`（无需联网即可解析）
- **非 arXiv 条目自动匹配**：通过 DOI、标题、作者、年份查询 Semantic Scholar、OpenAlex、Crossref 和 arXiv API，用相似度打分后决定“自动采用 / 待确认 / 未找到”；
- **手动确认与修正**：右键 → **查找 arXiv…**，在对话框中查看候选结果、重新搜索，或手动输入 ID；
- **刷新**：右键 → **刷新 alphaXiv 点赞**，忽略缓存重新抓取；也可设置缓存过期天数自动刷新；
- **颜色标记**：高赞绿色、低赞灰色、中间色可留空跟随主题；阈值与颜色都可自定义；
- **点赞数范围筛选**：输入最小/最大点赞数，区间外的条目可以隐藏或变暗；
- 异步、串行抓取，同一主机两次请求间隔至少 1.5 秒（arXiv API 为 3 秒）；
- 断网、非 2xx 响应或页面结构变化时显示 `N/A`，不会中断 Zotero；
- 设置界面集成在 Zotero 的 **编辑 → 设置 → AlphaLikes** 中。

## 非 arXiv 条目如何找到 arXiv 地址

插件用学术 API 反查 arXiv ID，优先级从高到低：

| 步骤 | 数据源                                                                      | 说明                                                            |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1    | DOI 前缀                                                                    | `10.48550/arXiv.*` 直接解析，零网络请求                         |
| 2    | [Semantic Scholar](https://api.semanticscholar.org/)                        | `paper/DOI:<doi>` 的 `externalIds.ArXiv` 最准确                 |
| 3    | [OpenAlex](https://api.openalex.org/)                                       | 从 work 的 `locations[]` 里找 `arxiv.org/abs` 或 `/pdf` 链接    |
| 4    | [Unpaywall](https://unpaywall.org/)                                         | 需在设置中填写联系邮箱，默认关闭                                |
| 5    | [Crossref](https://api.crossref.org/)                                       | 拿不到 arXiv ID，但能提供权威标题/作者/年份，用于下面的标题检索 |
| 6    | [arXiv API](https://info.arxiv.org/help/api/) + Semantic Scholar + OpenAlex | 用标题检索，`ti:"…"` 无结果时回退到 `all:"…"`                   |

**相似度评分**（`src/modules/similarity.ts`）：

- 标题相似度 = `0.6 × 归一化编辑距离 + 0.4 × 词元 Jaccard`；标题被完全包含且长度比 ≥ 0.8 时记为 0.96（用于期刊版带副标题的情况）；
- 作者匹配：任一位作者姓氏一致即通过，`Vaswani, Ashish` 与 `Ashish Vaswani` 视为同一人；
- 年份：相差 ≤ 1 年即通过。

**综合置信度**：

```
score = (0.7 × 标题相似度 + 0.2 × 作者匹配 + 0.1 × 年份匹配) / 实际可用的权重之和
```

权重会按“双方都提供了的信号”重新归一化——条目本身没有作者或年份时不会被扣分。由 DOI 直接确认的候选视为权威结果，直接记为 1.0。

| 置信度 | 默认区间  | 行为                                |
| ------ | --------- | ----------------------------------- |
| 高     | ≥ 0.9     | 自动采用，写入 `Extra` 并抓取点赞数 |
| 中     | 0.7 – 0.9 | 单元格显示 `?`，右键确认后才采用    |
| 低     | < 0.7     | 不采用，显示 `N/A`                  |

阈值可在设置中调整。结果会按 DOI 或归一化标题缓存 24 小时，未命中的缓存 10 分钟。

## 界面

![AlphaLikes column in Zotero](docs/images/alphalikes-column.svg)

_界面示意图；主题、列宽和实际点赞数会因 Zotero 环境及 alphaXiv 数据而不同。_

## 安装

### 从 GitHub Release 安装

1. 下载最新的 [`alphalikes.xpi`](https://github.com/IrisM6/AlphaLikes/releases/latest/download/alphalikes.xpi)。
2. 在 Zotero 中打开 **工具 → 插件**。
3. 点击齿轮菜单，选择 **Install Plugin From File… / 从文件安装插件…**。
4. 选择下载的 `.xpi`，按提示重启 Zotero。

插件 ID：`alphalikes@iris`。支持 Zotero 7、8 和 9。

## 使用

### 显示列

1. 在 Zotero 条目列表的列头上右键。
2. 勾选 **alphaXiv Likes**（若该列尚未显示）。
3. 滚动到 arXiv 条目时，单元格先显示 `…`，随后显示点赞数。
4. 点击列头可以升序或降序排列。

### 右键菜单

| 菜单项                   | 作用                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| **查找 arXiv…**          | 对选中的单个条目查询候选 arXiv 记录，弹出对话框让你挑选、重新搜索或手动输入 ID |
| **刷新 alphaXiv 点赞**   | 忽略缓存与失败冷却，重新抓取所选条目的点赞数；没有 ID 的条目会重新尝试匹配     |
| **清除 AlphaLikes 数据** | 从 `Extra` 中删除 AlphaLikes 写入的所有行                                      |

对话框中的 **移除 AlphaLikes 数据** 与 **应用** 会立即生效；点 **取消** 不做任何修改。

### 设置

**编辑 → 设置 → AlphaLikes** 提供四组选项：

- **arXiv matching**：是否自动匹配、自动采用/待确认的置信度阈值、每次标题检索的结果数、启用哪些数据源、联系邮箱（OpenAlex 与 Unpaywall 的 polite pool 使用）；
- **Refreshing**：缓存过期天数（0 = 不自动刷新）、同一主机的请求间隔、请求超时；
- **Colours**：是否着色、高/低阈值、高/中/低三档颜色，以及 `?` 待确认标记的颜色。任何 CSS 颜色都可以写：`#1a7f37`、`green`、`rgb(26 127 55)`；
- **Like-count range filter**：启用筛选、最小/最大点赞数（0 表示该侧无边界），以及区间外条目是**隐藏**还是**变暗**。

## Extra 字段格式

识别成功并抓取到数值后，条目的 `Extra` 将包含：

```text
arXiv: 2301.12345
alphaxiv_arxiv_id: 2301.12345
alphaxiv_likes: 2979
alphaxiv_likes_updated: 2026-09-20T08:04:11.412Z
```

- `alphaxiv_arxiv_id` 是匹配或手动确认的结果，优先级高于 `URL` 字段——你手动选定过的记录不会被覆盖；
- `alphaxiv_likes_updated` 用于缓存过期判断（设置里的“缓存过期天数”为 0 时不参与）；
- 已有的 `Extra` 内容会保留，AlphaLikes 只新增或更新自己的行。

缓存保存在 Zotero 数据库中，因此会随 `Extra` 字段参与 Zotero 同步。

## 实现说明

alphaXiv 页面由 arXiv ID 构造：

```text
https://arxiv.org/abs/2301.12345
    ↓
https://www.alphaxiv.org/abs/2301.12345
```

插件通过 `Zotero.HTTP.request` 下载 HTML，并使用以下 DOM 选择器读取点赞文本：

```css
button[aria-label="Like this paper"] span.inline-block
```

（另外内置两级更宽松的回退选择器，以应对 alphaXiv 改版。）

Zotero 的条目树 `dataProvider` 是同步 API，因此网络工作不会阻塞它：`dataProvider` 立即返回缓存值或加载状态，异步队列完成后再使条目树失效并重绘。这提供了异步加载体验，同时避免在单元格渲染期间阻塞界面。

所有请求经由一个串行队列，并按主机限速：arXiv API 至少 3 秒一次，其余主机默认 1.5 秒一次。只在条目看起来像论文时才触发匹配（条目类型属于期刊文章/会议论文/preprint 等，标题至少 20 个字符，且至少有 DOI 或日期），因此不会对书籍、网页等条目发起网络请求。

## 已知限制

- alphaXiv 没有在本插件中承诺稳定的公开点赞 API；其 HTML 或选择器变化时会暂时显示 `N/A`。
- 未登录状态下 alphaXiv 返回的内容可能受地区、网络策略或反爬措施影响。
- Semantic Scholar 在没有 API key 时经常返回 HTTP 429；插件会静默跳过并依赖其余数据源。
- 自动匹配只在“高置信度”时写入结果，但相似度判断不可能完美。如果发现匹配错误，右键 → **查找 arXiv…** 可以手动改正，或 **清除 AlphaLikes 数据** 复位。
- 对于确实是非 arXiv 的论文，匹配失败后会显示 `N/A`。若不想看到这些标记，可在设置中关闭自动匹配，非 arXiv 条目将保持空白。
- `Extra` 被修改后，Zotero 会把条目标记为已修改，这是持久化和同步缓存所必需的行为。
- 设置面板中的界面文字目前为英文；列名、右键菜单和匹配对话框已支持中文（`addon/locale/zh-CN`）。

## 隐私与网络请求

AlphaLikes 只发起 GET 请求，且只发送论文的元数据（DOI、标题）。请求目标：

- `https://www.alphaxiv.org/abs/<arXiv ID>` — 读取点赞数；
- `https://export.arxiv.org/api/query` — 标题检索；
- `https://api.semanticscholar.org/graph/v1/` — DOI / 标题检索；
- `https://api.openalex.org/works` — DOI / 标题检索；
- `https://api.crossref.org/works/` — DOI 元数据；
- `https://api.unpaywall.org/v2/` — 仅在填写联系邮箱并启用时。

它不会上传标题以外的笔记、附件、库标识或账号信息。项目与 alphaXiv、arXiv 和 Zotero 官方均无隶属关系。

## 开发

项目基于 [`zotero-plugin-template`](https://github.com/windingwind/zotero-plugin-template)，使用 Node.js、npm 和 TypeScript。

```bash
npm install
cp .env.example .env
# 在 .env 中设置 Zotero 可执行文件和开发 profile
npm start
```

质量检查和构建：

```bash
npm run lint:check
npm run test
npm run build
```

生产构建位于 `.scaffold/build/`，其中包含 `alphalikes.xpi` 和更新清单。发布使用模板流程：

```bash
npm run release
```

## 项目结构

```text
addon/manifest.json              Zotero 清单
addon/bootstrap.js               插件生命周期入口
addon/prefs.js                   默认设置项（构建时自动加前缀）
addon/content/preferences.xhtml  设置面板
addon/content/arxiv-picker.xhtml 手动确认对话框
addon/content/arxiv-picker.js    对话框逻辑（独立 chrome 脚本，不参与打包）
src/hooks.ts                     启动时注册列、菜单、设置面板
src/modules/column.ts            列注册与单元格渲染（颜色、筛选）
src/modules/service.ts           状态机、缓存、刷新、自动匹配编排
src/modules/resolver.ts          多数据源查询与候选排序
src/modules/similarity.ts        标题/作者/年份相似度评分
src/modules/arxiv-id.ts          arXiv ID 解析与 Extra 字段读写
src/modules/likes.ts             alphaXiv 页面解析与排序值编码
src/modules/http.ts              串行限速请求器
src/modules/prefs.ts             带默认值与钳制的设置读取
src/modules/menu.ts              右键菜单
src/modules/l10n.ts              界面文案
test/                            Zotero 集成测试与纯逻辑测试
zotero-plugin.config.ts          构建与发布配置
```

## License

[GNU Affero General Public License v3.0 or later](LICENSE).
