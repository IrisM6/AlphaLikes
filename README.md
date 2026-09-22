# AlphaLikes

**给 Zotero 加一列 alphaXiv 点赞数，再加一列引用数。**

[![Zotero 7–10](https://img.shields.io/badge/Zotero-7%E2%80%9310-cc2936?style=flat-square&logo=zotero)](https://www.zotero.org/)
[![Release](https://img.shields.io/github/v/release/IrisM6/AlphaLikes?style=flat-square)](https://github.com/IrisM6/AlphaLikes/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)

装了就能用：不用填 API key，不用注册，也不用手动绑定论文。列表里滚到哪读到哪，数字写回条目的 `Extra` 字段，重装或换电脑也不会丢。

![AlphaLikes column in Zotero](docs/images/alphalikes-column.svg)

## 安装

1. 在 [最新版本](https://github.com/IrisM6/AlphaLikes/releases/latest) 里下载 `.xpi` 文件（文件名带版本号）。
2. Zotero → **工具 → 插件** → 齿轮 → **从文件安装插件…**。
3. 选下载好的 `.xpi`，按提示重启 Zotero。

支持 Zotero 7 / 8 / 9 / 10，之后的新版本也能直接装。

## 使用

**显示列**：在条目列表的列头上右键 → 勾选 **alphaXiv 点赞**（需要引用数就再勾 **引用数**）。点击列头即可按数值排序。

**右键菜单**（选中条目后可用）：

| 菜单项                               | 作用                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| 刷新点赞数                           | 重新读取所选条目的点赞数                               |
| 刷新引用数                           | 重新读取所选条目的引用数                               |
| 在浏览器中打开 Google Scholar 搜索页 | 用这篇论文的标题在你的浏览器里打开检索页，方便自己核对 |
| 重置谷歌会话                         | 清掉 Zotero 这边的 Google Cookie 后重试引用数          |
| 清除本插件写入的 Extra 记录          | 只删本插件写的行，条目里其它内容不动                   |

点赞数和引用数**各读各的**，互不影响，刷新只作用在选中的条目上，读一条就显示一条。读取过程中单元格显示 `…`，完成后弹一条结果提示。

**外观**：设置里有 11 种样式（玻璃胶囊、莫兰迪低饱和、双色拼接……）、颜色面板、范围筛选。两列可以共用一套外观，也可以让引用数单独设置。

**趋势**：每次刷新会记下当天数字，列里就能显示 `2979 ↑12` 这样的变化。

## 引用数

来源可选 **Google Scholar**（默认）、**OpenAlex**、**Semantic Scholar**。勾一个就只显示那一个；勾多个时显示最大的数字，悬停可以看到来源。

Google Scholar 没有公开 API，插件读的是搜索结果页上的 `Cited by` 数字，所以它可能会限流（HTTP 429）或要求人机验证。遇到这种情况插件会暂停、自动重试（10 分钟起，最长 2 小时），不会用别的来源顶替；想继续工作可以同时勾上 OpenAlex 或 Semantic Scholar。**在浏览器里打开检索页不会解除插件这边的限制**——浏览器和 Zotero 是两套会话，那个入口只是给你自己核对数字用的。

## 数据与隐私

- 点赞数、引用数、arXiv ID、每日快照都写在条目的 `Extra` 字段里（`alphaxiv_*` 行），可以随文献库同步。
- 联网请求只发往 alphaXiv、arXiv、OpenAlex、Semantic Scholar、Crossref、Google Scholar 这些学术站点，不发送你的文献库或个人信息。
- 只有「清除本插件写入的 Extra 记录」会删数据，删除范围仅限本插件自己写的那几行。

## 读不出来时

- **某一列一直空白或显示 `…`**：设置 → AlphaLikes → **诊断读取**，它会把请求地址、状态码等信息复制到剪贴板，方便排查。
- **Google Scholar 被拦住**：等它自动重试，或右键 → **重置谷歌会话**；同时勾上 OpenAlex / Semantic Scholar 可以先照常使用。
- **想重新开始**：右键 → **清除本插件写入的 Extra 记录**，相关条目会回到未读取状态，下次刷新重新写入。

## 开发

```bash
npm install
npm run lint:check   # 代码风格与静态检查
npm run test         # 在真实 Zotero 中运行测试
npm run build        # 产物在 .scaffold/build/
npm run release      # 打 tag 并发布
```

## 许可

AGPL-3.0。基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建；点赞数据来自 [alphaXiv](https://www.alphaxiv.org/)。
