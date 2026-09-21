# AlphaLikes 简体中文文案。
#
# 这个文件同时供两处使用：
#   1. 主窗口里的列标题、右键菜单、单元格提示（由 src/modules/l10n.ts 读取）。
#   2. 设置面板 addon/content/preferences.xhtml（由 Zotero 的 Fluent 直接渲染）。
#
# 构建时 zotero-plugin-scaffold 会给每条消息 ID 加上 `alphalikes-` 前缀，
# 并把文件重命名为 alphalikes-addon.ftl，因此面板里的 data-l10n-id 写的是
# 不带前缀的 ID。

column-label = alphaXiv 点赞
column-citations-label = 引用数
menu-refresh = 刷新 alphaXiv 点赞
menu-refresh-citations = 刷新引用数
menu-open-scholar = 打开 Google Scholar 验证页
menu-reset-google = 重置谷歌会话（清除 Google Cookie 后重试）

cell-loading = 正在从 alphaXiv 读取…
cell-unavailable = 没有找到该条目的 alphaXiv 点赞
cell-filtered = 已被点赞数范围筛选隐藏
cell-trend = 相比上次快照 {delta} 个赞（当前 {likes}）
cell-high-impact = 位于本领域同年份的前 10%
cell-citations-unavailable = 没有找到该条目的引用数据
cell-unavailable-reason = 读取失败：{reason} 稍后会自动重试
cell-citations-unavailable-reason = 读取失败：{reason} 稍后会自动重试
failure-http-403 = 请求被站点拒绝（HTTP 403）
failure-http-429 = 请求过于频繁（HTTP 429）
failure-http-4xx = 请求被拒绝（HTTP 4xx）
failure-http-5xx = 对方服务器错误（HTTP 5xx）
failure-network = 请求没有到达站点（网络、DNS、代理或超时）
failure-empty = 对方返回了空响应
failure-no-count = 页面能打开，但里面没有那个数字
cell-cleared = 本插件写在这个条目里的记录已被清除；右键 →「刷新 alphaXiv 点赞」或「刷新引用数」可以重新读取
cell-quantile-high = 在当前列表中属于高赞
cell-quantile-low = 在当前列表中属于低赞
cell-quantile-mid = 在当前列表中属于中等
cell-quantile-title = {label}——{high} 个赞以上为高，{low} 个赞及以下为低（按当前 {sample} 个条目排名）

# --- 批量操作 ---------------------------------------------------------------

cell-split-prefix = 赞
cell-split-prefix-citations = 引
cell-citation-source = 来源：{source}
cell-scholar-blocked = Google Scholar 要求人机验证，约 {minutes} 分钟后会自动重试；右键 →「打开 Google Scholar 验证页」可以自己先完成验证
cell-scholar-rate-limited = Google Scholar 对当前网络地址限流（HTTP 429），约 {minutes} 分钟后会自动重试。这类限制按地址生效，不是插件被针对
# --- 刷新结果提示 -----------------------------------------------------------

notify-refresh-likes-title = AlphaLikes · 点赞
notify-refresh-citations-title = AlphaLikes · 引用数
refresh-likes-updated = 已重新读取 {updated} 条点赞数
refresh-citations-updated = 已重新读取 {updated} 条引用数
refresh-failed = {failed} 条未能读取（保留原值）
refresh-skipped = {skipped} 条缺少 DOI / arXiv ID，无法查询
refresh-nothing = 没有可刷新的条目。
refresh-joining = ；

# --- 批量操作 ---------------------------------------------------------------

progress-error = AlphaLikes 无法完成本次更新：{message}

notify-scholar-title = AlphaLikes · Google Scholar
# --- 清除本插件写入的记录 ---------------------------------------------------
#
# 只删这个插件自己写进 Extra 的行（alphaxiv_*），条目里原来的其他内容原样
# 保留。清除过的条目在手动刷新之前不会再被自动写入，所以提示里说明了这一点。

menu-clear = 清除本插件写入的 Extra 记录
notify-clear-title = AlphaLikes · 清除
clear-done = 已清除 {count} 个条目中本插件写入的 Extra 记录，其余内容原样保留；这些条目在刷新点赞或引用之前不会再被自动写入。
clear-none = 选中的条目里没有本插件写入的 Extra 记录，其余内容原样保留；这些条目在刷新点赞或引用之前不会再被自动写入。
reset-google-done = 已清除 {cookies} 个 Google Cookie，正在重新读取引用数。

notify-scholar-blocked = Google Scholar 要求人机验证，引用数暂时无法读取。约 {minutes} 分钟后会自动重试；也可以右键 →「打开 Google Scholar 验证页」先自己完成验证。
notify-scholar-paused = Google Scholar 连续多次要求人机验证，已停止自动重试（继续重试只会让它的判定更差）。请右键 →「打开 Google Scholar 验证页」自己完成一次，或「重置谷歌会话」后再试。
notify-scholar-rate-limited = Google Scholar 对 Zotero 的这次读取限流（429），引用数暂时无法读取。约 {minutes} 分钟后会自动重试。如果一直失败，用右键 →「重置谷歌会话」清掉 Zotero 这边的 Google Cookie 再试一次——那等同于换一个从没来过的浏览器。

error-no-selection = 请先选择至少一个条目。
error-single-selection = 该操作只能用于单个条目。

# --- 摘要笔记正文 -----------------------------------------------------------

# ===========================================================================
# 设置面板
#
# 控件（复选框、单选、菜单项）用 .label，文本段落用消息值，与 Zotero 自带面板
# 的写法一致。
# ===========================================================================

pref-pane-intro = 自动读取每篇文献在 alphaXiv 上的点赞数与引用数，并把结果写入条目的 Extra 字段。

pref-match-title = arXiv 匹配
pref-match-desc = AlphaLikes 会从链接、DOI 或 Extra 字段里读取 arXiv 记录；条目里没有时，可以通过学术 API 自动查找。
pref-match-auto =
    .label = 为没有 arXiv ID 的条目自动查找
pref-match-auto-accept = 达到该置信度（%）时自动采用

pref-match-title-results = 每次标题搜索返回的结果数
pref-match-use-arxiv =
    .label = 通过标题搜索 arXiv API
pref-match-use-s2 =
    .label = 使用 Semantic Scholar（DOI 与标题）
pref-match-use-openalex =
    .label = 使用 OpenAlex（DOI 与标题）
pref-match-use-crossref =
    .label = 使用 Crossref（DOI 元数据）
pref-match-use-unpaywall =
    .label = 使用 Unpaywall（需要填写联系邮箱）
pref-match-contact = OpenAlex / Unpaywall 联系邮箱

pref-appearance-title = 外观
pref-appearance-desc = 点赞数与引用数在列里的显示方式。其中四种只改变形状与质感，颜色取自「颜色」一节；其余七种自带一套配色，高赞/低赞会切换它们各自的深浅版本。
pref-appearance-style = 显示样式
pref-style-plain =
    .label = 纯文本
pref-style-badge =
    .label = 玻璃胶囊
pref-style-ring =
    .label = 玻璃圆形
pref-style-bookmark =
    .label = 侧边强调块
pref-style-morandi =
    .label = 莫兰迪低饱和
pref-style-academic =
    .label = 学术严谨
pref-style-fresh =
    .label = 淡雅清新
pref-style-playful =
    .label = 活泼明快
pref-style-outline =
    .label = 细边框描边
pref-style-split =
    .label = 双色拼接
pref-style-dot =
    .label = 数字角标

pref-color-title = 颜色
pref-color-enabled =
    .label = 为点赞数着色
pref-color-mode = 着色依据
pref-color-mode-threshold =
    .label = 固定阈值
pref-color-mode-quantile =
    .label = 按当前列表排名（分位数）
pref-color-quantile-low = 低赞分位（%）
pref-color-quantile-high = 高赞分位（%）
pref-color-high-threshold = 高赞阈值
pref-color-low-threshold = 低赞阈值
pref-color-high = 颜色
pref-color-low = 颜色
pref-color-mid = 中间区间颜色（留空则使用主题色）

pref-trend-title = 点赞趋势
pref-trend-desc = 每次刷新会把当天的点赞数记入条目的 Extra 字段，列里就能显示「2979 ↑12」。
pref-trend-show =
    .label = 在列里显示每日变化
pref-trend-hot = 每日增长达到该数值视为「近期热门」
pref-trend-history = 保留最近多少天的快照（写入 Extra，最多 30）

pref-citations-title = 引用数
pref-citations-desc = 引用数据来自 Google Scholar、OpenAlex 与 Semantic Scholar。被引次数变化很慢，所以缓存时间比点赞数长。
pref-citations-enabled =
    .label = 显示「引用数」列并查询引用数据
pref-citations-ttl = 缓存多少天后重新读取（0 = 只读一次）
pref-citations-scholar-note = Google Scholar 没有公开 API，插件读取的是搜索结果页上的「Cited by」数字。Google 要求人机验证或限流时，插件先自己处理：暂停读取，并按 10 分钟、20 分钟、40 分钟……（最长 2 小时）自动重试，前两次不打扰你；连续第三次仍被拦住才弹一条提示，说明还要等多久、以及如何自己完成验证。任何情况下都不会用别的来源顶替这个数字。
pref-citations-source = 引用数来源
pref-citations-source-scholar =
    .label = Google Scholar（默认）
pref-citations-source-openalex =
    .label = OpenAlex
pref-citations-source-s2 =
    .label = Semantic Scholar
pref-citations-source-note = 数字只来自勾选的来源，不会用没勾的来源顶替。选一个时，有就是有、没有就是「暂无」；选多个时全部读取，显示其中最大的那个（悬停可以看到数字来自谁）。三个来源的口径并不一致——Google Scholar 收录预印本、学位论文与书籍，和 OpenAlex 的数字可能差一倍，所以默认只勾 Google Scholar。
pref-citations-s2-note = Semantic Scholar 未提供 key 时会限流，遇到 429 会跳过并保留下次机会。
# 读取诊断：面板上的按钮真的去请求一次，结果复制到剪贴板。
pref-diagnose = 诊断读取
pref-diagnose-note = 读取不出来时点这里：它会用当前设置真的请求一次 alphaXiv 与 Google Scholar，并把请求地址、状态码、页面开头和代理设置复制到剪贴板。
pref-diagnose-running = 正在请求…
pref-diagnose-copied = 诊断信息已复制到剪贴板，直接粘贴发给我即可。
pref-diagnose-failed = 诊断没能完成；请到「帮助 → 调试输出日志」里找 [AlphaLikes] 开头的行。

pref-refresh-title = 刷新与网络
pref-refresh-desc = 右键任意条目可以分别选择「刷新 alphaXiv 点赞」或「刷新引用数」（列里先显示「…」，完成后弹一条结果提示）；此外缓存也可以按时间自动过期。 Google Scholar 每次读之间至少间隔 5 秒，并且每次会话会先像浏览器一样打开一次 scholar.google.com（用来带上 Google 自己的 cookie）。
pref-refresh-ttl = 缓存多少天后重新读取点赞数（0 = 不自动）
pref-refresh-interval = 同一域名请求的最小间隔（毫秒）
pref-refresh-timeout = 请求超时（毫秒）

pref-filter-title = 点赞数范围筛选
pref-filter-desc = 把列聚焦在一段点赞区间内；边界为 0 表示不限制。范围之外的条目仍然显示，只是整格变淡，数字本身不受影响。
pref-filter-enabled =
    .label = 启用点赞数范围筛选
pref-filter-min = 最少点赞数
pref-filter-max = 最多点赞数（0 = 不限制）

pref-color-picker = 每个颜色框左边是当前颜色的预览；点一下展开取色面板（明度/饱和度色域 + 色相条），点或拖那个圆圈即可取色，也可以直接手输 CSS 颜色。
pref-citation-appearance-title = 引用数外观
pref-citation-appearance-desc = 引用数和点赞数往往差着数量级，同一套阈值常常不好用。勾选「引用数跟随点赞」时两列外观完全一致，只在外观/颜色/范围筛选里设置一次即可；取消勾选后，下面这一组只作用于「引用数」列（样式、着色依据、阈值与颜色都可单独设置）。
pref-color-quantile-note = 低于低分位的算低、高于高分位的算高；样本太少或所有数字相同的时候自动退回固定阈值。
pref-color-reset = 恢复这个样式的默认颜色
pref-color-reset-note = 改过颜色后可以随时点这里回到当前样式的配色。
pref-citation-color-mode = 着色依据
pref-citation-color-mode-note = 阈值在下面设置；分位数与「颜色」一节共用低/高百分位，按引用数在当前列表里的排名着色。
pref-citation-color-reset = 恢复引用样式的默认颜色

pref-citation-appearance-linked =
    .label = 引用数跟随点赞的外观设置
pref-citation-appearance-style = 引用数显示样式
pref-citation-color-enabled =
    .label = 为引用数着色
pref-citation-color-high-threshold = 高引阈值
pref-citation-color-low-threshold = 低引阈值
pref-citation-color-mid = 中间区间颜色（留空则使用主题色）
pref-citation-filter-enabled =
    .label = 启用引用数范围筛选
pref-citation-filter-min = 最少引用数
pref-citation-filter-max = 最多引用数（0 = 不限制）
pref-citation-filter-note = 与点赞数的范围筛选一样：范围之外的条目仍然显示，只是整格变淡。
pref-citations-sources = 引用数来源（可以多选；多选时显示其中最大的数字）
