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
menu-find-arxiv = 查找 arXiv…
menu-refresh = 刷新 alphaXiv 点赞
menu-clear = 清除 AlphaLikes 数据

cell-loading = 正在从 alphaXiv 读取…
cell-unavailable = 没有找到该条目的 alphaXiv 点赞
cell-pending = 找到可能的 arXiv 匹配，请右键确认
cell-filtered = 已被点赞数范围筛选隐藏
cell-trend = 相比上次快照 {delta} 个赞（当前 {likes}）
cell-high-impact = 位于本领域同年份的前 10%
cell-citations-unavailable = 没有找到该条目的引用数据
cell-quantile-high = 在当前列表中属于高赞
cell-quantile-low = 在当前列表中属于低赞
cell-quantile-mid = 在当前列表中属于中等
cell-quantile-title = {label}——{high} 个赞以上为高，{low} 个赞及以下为低（按当前 {sample} 个条目排名）

# --- 批量操作 ---------------------------------------------------------------

menu-batch-find = 批量查找 arXiv…
menu-export-csv = 导出为 CSV…
menu-export-json = 导出为 JSON…
menu-note = 插入点赞摘要笔记
menu-high-only = 只看高赞

batch-finding = 正在为 {count} 个条目查找 arXiv…
batch-done = 完成。自动匹配 {applied} 个，待确认 {pending} 个，无匹配 {notFound} 个，已有 ID {alreadyKnown} 个。
batch-none-to-do = 所选条目都已经有 arXiv ID 了。
export-writing = 正在整理 {count} 个条目…
export-done = 已导出 {count} 个条目到 {path}
export-failed = 导出失败：{message}
export-empty = 所选条目中没有可导出的内容。
note-done = 已插入 {inserted} 条笔记，跳过 {skipped} 条。
note-failed = 无法插入笔记（{failed} 条失败）。
high-only-on = 只显示 {bound} 个赞以上的条目。
high-only-off = 已关闭「只看高赞」。

progress-error = AlphaLikes 无法完成本次更新：{message}

error-no-selection = 请先选择至少一个条目。
error-single-selection = 该操作只能用于单个条目。

# --- 摘要笔记正文 -----------------------------------------------------------

note-heading = AlphaLikes 摘要
note-likes = alphaXiv 点赞：
note-citations = 引用数：
note-influential = 有影响力引用
note-high-impact = 该成果位于本领域同年份的前 10%。
note-trend-today = 较上次快照
note-trend-window = {days} 天内
note-generated = 由 AlphaLikes 生成于
note-arxiv-link = arXiv:{id}

picker-title = 查找 arXiv
picker-heading = 候选匹配结果
picker-subheading = AlphaLikes 已查询启用的学术 API。请选择正确的 arXiv 记录，或手动输入 ID。
picker-current = 当前匹配
picker-none = 没有候选达到置信度阈值。可以重新搜索，或手动输入 ID。
picker-no-candidates = 这个条目还没有找到任何结果——可以点「重新搜索」，或在下方直接输入 ID。
picker-manual-label = 输入 arXiv ID 或链接
picker-manual-placeholder = 2301.12345 或 https://arxiv.org/abs/2301.12345
picker-apply = 应用
picker-cancel = 取消
picker-search = 重新搜索
picker-clear = 清除 AlphaLikes 数据
picker-searching = 正在搜索…
picker-search-failed = 搜索失败。
picker-invalid = 这不像是有效的 arXiv ID。
picker-item = 条目
picker-confidence-high = 高置信度
picker-confidence-medium = 需要你确认
picker-confidence-low = 低置信度

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
pref-match-confirm = 达到该置信度（%）时提示手动确认
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
pref-appearance-desc = 点赞数在列里的显示方式；颜色由下面的「颜色」一节决定。
pref-appearance-style = 显示样式
pref-style-plain =
    .label = 纯文本
pref-style-badge =
    .label = 浅色标签
pref-style-glass =
    .label = 玻璃胶囊
pref-style-ring =
    .label = 玻璃圆形

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
pref-color-pending = 「请确认匹配」标记颜色
pref-color-hint = 可以使用任意 CSS 颜色：#1a7f37、green、rgb(26 127 55)。分位数模式按当前列表里的点赞数排名，样本太少时自动退回固定阈值。

pref-trend-title = 点赞趋势
pref-trend-desc = 每次刷新会把当天的点赞数记入条目的 Extra 字段，列里就能显示「2979 ↑12」。
pref-trend-show =
    .label = 在列里显示每日变化
pref-trend-hot = 每日增长达到该数值视为「近期热门」
pref-trend-history = 保留最近多少天的快照（写入 Extra，最多 30）

pref-citations-title = 引用数
pref-citations-desc = 引用数据来自 Semantic Scholar 与 OpenAlex。被引次数变化很慢，所以缓存时间比点赞数长。
pref-citations-enabled =
    .label = 显示「引用数」列并查询引用数据
pref-citations-ttl = 缓存多少天后重新读取（0 = 只读一次）
pref-citations-s2-note = Semantic Scholar 未提供 key 时会限流，遇到 429 会跳过并保留下次机会。

pref-note-title = 摘要笔记
pref-note-desc = 右键「插入点赞摘要笔记」会为每个条目新建一条子笔记。
pref-note-citations =
    .label = 包含引用数
pref-note-trend =
    .label = 包含点赞变化
pref-note-arxiv-link =
    .label = 包含 arXiv 链接

pref-refresh-title = 刷新与网络
pref-refresh-desc = 右键任意条目选择「刷新 alphaXiv 点赞」可以重新读取；缓存也可以按时间自动过期。
pref-refresh-ttl = 缓存多少天后重新读取点赞数（0 = 不自动）
pref-refresh-interval = 同一域名请求的最小间隔（毫秒）
pref-refresh-timeout = 请求超时（毫秒）

pref-filter-title = 只看高赞
pref-filter-desc = 把列聚焦在一段点赞区间内；边界为 0 表示不限制。也可以在条目右键菜单里一键切换「只看高赞」。
pref-filter-enabled =
    .label = 启用点赞数范围筛选
pref-filter-min = 最少点赞数
pref-filter-max = 最多点赞数（0 = 不限制）
pref-filter-mode = 超出范围的条目
pref-filter-mode-hide =
    .label = 直接隐藏
pref-filter-mode-dim =
    .label = 保留但变淡

pref-export-title = 导出
pref-export-desc = 右键「导出为 CSV / JSON」会导出所选条目的标题、DOI、arXiv ID、点赞数、引用数与更新时间。
pref-export-sort = 导出排序
pref-export-sort-likes =
    .label = 按点赞数（从高到低）
pref-export-sort-citations =
    .label = 按引用数（从高到低）
pref-export-sort-title =
    .label = 按标题
pref-export-sort-none =
    .label = 按 Zotero 当前顺序
pref-export-hint = CSV 带 UTF-8 BOM，用 Excel 打开中文标题不会乱码。
