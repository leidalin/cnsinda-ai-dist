<template>
  <div class="dl-admin-layout">
    <!-- 左侧固定侧边栏（复刻参考图） -->
    <aside class="dl-sidebar">
      <!-- 品牌 Logo 区域 -->
      <div class="dl-sidebar-brand">
        <div class="brand-text-wrap">
          <div class="brand-app-name">DL评论助手</div>
          <div class="brand-app-slogan">智能评论 · 轻松管理</div>
        </div>
      </div>

      <!-- 侧边栏导航菜单 -->
      <nav class="dl-sidebar-menu">
        <div
          class="menu-nav-item"
          :class="{ active: activeTab === 'workspace' }"
          @click="activeTab = 'workspace'"
        >
          
          <span class="nav-title-text">评论管理</span>
        </div>

        <div
          class="menu-nav-item"
          :class="{ active: activeTab === 'archives' }"
          @click="activeTab = 'archives'"
        >
          
          <span class="nav-title-text">截图存档</span>
          <span class="nav-count-badge" v-if="archiveSnapshots.length">{{ archiveSnapshots.length }}</span>
        </div>

        <div
          class="menu-nav-item"
          :class="{ active: activeTab === 'settings' }"
          @click="activeTab = 'settings'"
        >
          
          <span class="nav-title-text">系统设置</span>
        </div>
      </nav>
      

      <!-- 侧边栏底部状态指示卡 -->
      <div class="dl-sidebar-footer">
        <div class="footer-status-pill">
          <span class="footer-pulse-dot"></span>
          <span class="footer-status-label">运行正常</span>
        </div>
        <div class="footer-version-label">版本 v2.0.3</div>
      </div>
    </aside>

    <!-- 右侧主内容区域 -->
    <main class="dl-main-viewport">
      <!-- 顶部轻量搜索与状态栏 -->
      <header class="dl-topbar-header">
        <div class="topbar-left-brand-text">
          <span class="topbar-title-bold">评论管理与自动化控制台</span>
        </div>
        <div class="topbar-right-controls">
          <div class="platform-support-tags">
            <span class="plat-capsule">CSDN</span>
            <span class="plat-capsule">知乎</span>
            <span class="plat-capsule">头条</span>
            <span class="plat-capsule">百家号</span>
            <span class="plat-capsule">网易</span>
            <span class="plat-capsule">搜狐</span>
          </div>
          <div class="topbar-avatar-badge" title="当前登录/运行状态">
            <span>👤</span>
          </div>
        </div>
      </header>

      <!-- 视图主体容器 -->
      <div class="dl-content-container">
        <!-- 视窗 1：【评论管理】（完全复刻参考图） -->
        <div v-show="activeTab === 'workspace'" class="workspace-page-content">
          <!-- 页面标题说明 -->
          <div class="page-title-banner">
            <h2 class="page-heading-title">评论管理</h2>
            <p class="page-heading-desc">高效管理您的评论任务，支持多账号、多平台，操作简单，运行稳定。</p>
          </div>

          <!-- 4 个经典大指标卡片（复刻参考图结构与配色） -->
          <!-- 飞书风格微型指标条 (纯白细线，高度仅 38px，轻巧不占屏) -->
          <!-- 经典简约指标卡片行 (纯白底、纯黑字、精致细灰边框) -->
          <div class="gov-metrics-row">
            <div class="gov-metric-card">
              <div class="metric-card-inner">
                <span class="metric-label-text">总监控文章</span>
                <strong class="metric-value-num text-black">{{ records.length }}</strong>
              </div>
            </div>
            <div class="gov-metric-card">
              <div class="metric-card-inner">
                <span class="metric-label-text">已达标</span>
                <strong class="metric-value-num text-black">{{ satisfiedRecordsCount }}</strong>
              </div>
            </div>
            <div class="gov-metric-card">
              <div class="metric-card-inner">
                <span class="metric-label-text">缺评论</span>
                <strong class="metric-value-num text-black">{{ commentCandidates.length }}</strong>
              </div>
            </div>
            <div class="gov-metric-card">
              <div class="metric-card-inner">
                <span class="metric-label-text">缺点赞收藏</span>
                <strong class="metric-value-num text-black">{{ interactionCandidates.length }}</strong>
              </div>
            </div>
            <div class="gov-metric-card">
              <div class="metric-card-inner">
                <span class="metric-label-text">异常告警</span>
                <strong class="metric-value-num text-black" :class="{ 'text-danger': invalidRecordCount > 0 }">{{ invalidRecordCount }}</strong>
              </div>
            </div>
          </div>

          <!-- 主内容数据卡片（完全复刻参考图） -->
          <div class="reference-main-card">
            <!-- 卡片顶栏 -->
            <div class="main-card-top-bar">
              <div class="main-card-title-group">
                <h3 class="card-headline-title">评论列表</h3>
                <span class="card-total-badge">共 {{ filteredSortedRecords.length }} 条</span>
              </div>

              <div class="main-card-actions-group">
                <!-- 核心操作按钮平铺 (不勾选默认操作全部，勾选操作选中) -->
                <button
                  class="gov-action-btn"
                  :class="{ 'btn-active': selectedRecords.length > 0 }"
                  @click="handleBatchLikeCollect"
                  :disabled="supplementRunning || (selectedRecords.length === 0 && interactionCandidates.length === 0)"
                  :title="selectedRecords.length > 0 ? '对已勾选的记录执行点赞收藏' : '默认对全部需要赞藏的记录执行操作'"
                >
                  {{ selectedRecords.length > 0 ? ('点赞收藏 (已选 ' + selectedRecords.length + ')') : ('点赞收藏 (全部 ' + interactionCandidates.length + ')') }}
                </button>

                <button
                  class="gov-action-btn"
                  :class="{ 'btn-active': selectedRecords.length > 0 }"
                  @click="handleBatchComment"
                  :disabled="supplementRunning || (selectedRecords.length === 0 && commentCandidates.length === 0)"
                  :title="selectedRecords.length > 0 ? '对已勾选的记录执行发评' : '默认对全部需要发评的记录执行操作'"
                >
                  {{ selectedRecords.length > 0 ? ('一键评论 (已选 ' + selectedRecords.length + ')') : ('一键评论 (全部 ' + commentCandidates.length + ')') }}
                </button>

                <button
                  class="gov-action-btn"
                  @click="handleBatchOperationCommand('rescan_all')"
                  :disabled="records.length === 0"
                >
                  重新检测全部
                </button>

                <button
                  class="gov-action-btn"
                  @click="handleBatchOperationCommand('export_csv')"
                  :disabled="records.length === 0"
                >
                  导出全部记录 (CSV)
                </button>

                <button
                  class="gov-action-btn"
                  @click="handleBatchOperationCommand('export_warning')"
                  :disabled="warningRecords.length === 0"
                >
                  导出低于警戒线 ({{ warningRecords.length }})
                </button>

                <!-- 在以前刷新位置加入：删除选中 -->
                <button
                  class="gov-action-btn btn-danger-action"
                  @click="handleDeleteSelected"
                  :disabled="selectedRecords.length === 0"
                  :title="selectedRecords.length > 0 ? '删除已选中的 ' + selectedRecords.length + ' 篇文章' : '请先勾选需要删除的文章'"
                >
                  删除选中 ({{ selectedRecords.length }})
                </button>

                <button
                  class="gov-action-btn btn-danger-action"
                  @click="handleBatchOperationCommand('clear_all')"
                  :disabled="records.length === 0"
                >
                  清空全部
                </button>
              </div>
            </div>

            <!-- 常驻极简批量导入输入框 (无需点击开关切换，随时粘贴导入) -->
            <div class="embedded-import-container">
              <div class="embedded-import-inner">
                <el-input
                  v-model="batchUrls"
                  type="textarea"
                  :rows="2"
                  placeholder="请输入文章 URL，每行一个（支持 CSDN、知乎、头条、百家号、网易、搜狐），粘贴后点击右侧「导入并快速检测」"
                  class="embedded-clean-textarea"
                />

                <div class="embedded-import-bottom">
                  <div class="import-status-chips" v-if="batchClassification.valid.length || batchClassification.thirdParty.length || batchClassification.invalid.length">
                    <span class="status-chip chip-valid">✓ 有效 {{ batchClassification.valid.length }}</span>
                    <span v-for="(count, plat) in batchClassification.byPlatform" :key="plat" class="status-chip chip-plat">
                      {{ platName(plat) }} {{ count }}
                    </span>
                    <span v-if="batchClassification.duplicateCount" class="status-chip chip-dup">去重 {{ batchClassification.duplicateCount }}</span>
                    <span v-if="batchClassification.thirdParty.length" class="status-chip chip-third">第三方 {{ batchClassification.thirdParty.length }}</span>
                    <span v-if="batchClassification.invalid.length" class="status-chip chip-invalid">无效 {{ batchClassification.invalid.length }}</span>
                  </div>
                  <div v-else class="import-status-placeholder">
                    <span>支持六大平台 URL 自动去重与识别</span>
                  </div>

                  <div class="embedded-btn-group">
                    <button class="gov-mini-btn" @click="batchUrls = ''" :disabled="!batchUrls.trim()">清空</button>
                    <button class="gov-mini-btn" @click="importUrlsOnly" :disabled="batchClassification.valid.length === 0 && batchClassification.thirdParty.length === 0">
                      仅导入不检测
                    </button>
                    <button class="gov-mini-btn gov-mini-btn-primary" @click="importAndStartDetection" :disabled="batchClassification.valid.length === 0 && batchClassification.thirdParty.length === 0">
                      导入并快速检测
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 任务运行中状态进度条 -->
            <div v-if="supplementRunning || batchRunning || archiveBatchRunning" class="task-active-inline-panel">
              <div class="task-active-inline-header">
                <div class="task-inline-left">
                  <span class="inline-pulse-dot"></span>
                  <strong>{{ activeRunningTitle }}</strong>
                  <span class="inline-plat-badge" v-if="activeRunningPlatform">{{ platName(activeRunningPlatform) }}</span>
                </div>
                <div class="task-inline-right">
                  <span>{{ activeRunningProgressText }}</span>
                  <span v-if="activeRunningElapsed > 0">已耗时 {{ formatDuration(activeRunningElapsed) }}</span>
                  <el-button size="small" type="danger" link @click="stopActiveTask">停止任务</el-button>
                </div>
              </div>
              <div class="task-inline-url" :title="activeRunningUrl">{{ activeRunningUrl || '正在准备任务调度…' }}</div>
              <el-progress :percentage="activeRunningPercent" :stroke-width="4" :show-text="false" />
            </div>

            <!-- 表格筛选工具栏（完全复刻参考图） -->
            <div class="filter-tool-row">
              <div class="filter-search-input-box">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="#94a3b8">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  v-model="recordSearchKeyword"
                  placeholder="请输入关键词、链接或内容..."
                  class="filter-input-native"
                />
              </div>

              <el-select v-model="recordIssueFilter" size="default" class="filter-select-element" style="width:125px;">
                <el-option label="全部状态" value="all" />
                <el-option :label="`缺评论 (${commentCandidates.length})`" value="comment" />
                <el-option :label="`缺互动 (${interactionCandidates.length})`" value="interaction" />
                <el-option :label="`已达标 (${satisfiedRecordsCount})`" value="satisfied" />
              </el-select>

              <el-select v-model="recordPlatformFilter" size="default" class="filter-select-element" style="width:130px;">
                <el-option v-for="option in recordPlatformOptions" :key="option.value" :label="`${option.label} (${option.count})`" :value="option.value" />
              </el-select>

              <el-select v-model="recordSort" size="default" class="filter-select-element" style="width:140px;">
                <el-option label="最新检测时间" value="timeDesc" />
                <el-option label="评论少→多" value="countAsc" />
                <el-option label="评论多→少" value="countDesc" />
              </el-select>

              <div class="filter-threshold-container">
                <span class="threshold-tag-label">警戒线:</span>
                <el-input-number
                  v-model="warningThreshold"
                  :min="0"
                  :max="99"
                  :step="1"
                  size="small"
                  controls-position="right"
                  style="width:75px;"
                  @change="saveWarningThreshold"
                />
              </div>
            </div>

            <!-- 数据表格主体（完全复刻参考图排版） -->
            <el-table
              v-if="filteredSortedRecords.length"
              :data="pagedFilteredSortedRecords"
              :row-class-name="recordRowClassName"
              row-key="url"
              border
              class="feishu-clean-table feishu-bordered-table"
              style="width:100%;"
              @selection-change="handleRecordSelectionChange"
            >
              <el-table-column type="selection" width="45" align="center" />
              <el-table-column type="index" label="序号" width="55" align="center" />

              <el-table-column prop="platform" label="平台" width="95" align="center">
                <template #default="{ row }">
                  <div class="table-platform-chip">
                    <span class="platform-label-text">{{ platName(row.platform) }}</span>
                  </div>
                </template>
              </el-table-column>

              <el-table-column prop="title" label="标题" min-width="260">
                <template #default="{ row }">
                  <div class="table-title-cell-fixed">
                    <a
                      :href="row.url"
                      target="_blank"
                      class="table-article-title-truncated"
                      :class="{ 'title-has-warning': isWarningRecord(row), 'title-is-invalid': isInvalidRecord(row) }"
                      :title="row.title || row.url"
                    >
                      {{ row.title || '（未抓取到标题）' }}
                    </a>
                    <span class="table-article-url-truncated" :title="row.url">{{ row.url }}</span>
                  </div>
                </template>
              </el-table-column>

              <el-table-column label="评论条数" width="105" align="center">
                <template #default="{ row }">
                  <span
                    class="table-comment-num-badge"
                    :class="{
                      'badge-unqualified': isWarningRecord(row) || isInvalidRecord(row),
                      'badge-qualified': !isWarningRecord(row) && !isInvalidRecord(row)
                    }"
                  >
                    {{ isInvalidRecord(row) || isThirdPartyPlatform(row.platform) ? '异常' : (row.commentCount + ' 条') }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column label="点赞 / 收藏" width="145" align="center">
                <template #default="{ row }">
                  <div class="table-interaction-status-group" v-if="supportsInteraction(row.platform)">
                    <span
                      class="status-chip-sub"
                      :class="row.liked ? 'chip-active' : 'chip-inactive'"
                    >{{ row.liked ? '已点赞' : '未点赞' }}</span>
                    <span
                      class="status-chip-sub"
                      :class="row.collected ? 'chip-active' : 'chip-inactive'"
                    >{{ row.collected ? '已收藏' : '未收藏' }}</span>
                  </div>
                  <span v-else class="text-sub-placeholder">不适用</span>
                </template>
              </el-table-column>

              <el-table-column label="检测时间" width="140" align="center">
                <template #default="{ row }">
                  <span class="table-timestamp-text">{{ formatTimeShort(row.checkTime) }}</span>
                </template>
              </el-table-column>

              <el-table-column label="操作" width="230" fixed="right" align="center">
                <template #default="{ row }">
                  <div class="table-actions-row">
                    <button
                      v-if="supportsInteraction(row.platform)"
                      class="row-action-btn btn-like"
                      @click="singleLikeCollect(row)"
                      :disabled="supplementRunning || (row.liked && row.collected)"
                      :title="row.liked && row.collected ? '已完成赞藏' : '单独对此条点赞+收藏'"
                    >{{ row.liked && row.collected ? '已赞藏' : '赞藏' }}</button>

                    <button
                      v-if="!isThirdPartyPlatform(row.platform)"
                      class="row-action-btn btn-comment"
                      @click="singleComment(row)"
                      :disabled="supplementRunning || isInvalidRecord(row)"
                      title="单独发评"
                    >发评</button>

                    <button
                      v-if="!isThirdPartyPlatform(row.platform)"
                      class="row-action-btn btn-check"
                      @click="rescanRecord(row)"
                      :disabled="rescanUrl === row.url"
                      title="重新扫描检测"
                    >{{ rescanUrl === row.url ? '检测中' : '检测' }}</button>

                    <button
                      class="row-action-btn btn-delete"
                      @click="handleRecordCommand('delete', row)"
                      title="删除此记录"
                    >删除</button>
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-else description="暂无监控链接，请点击上方「+ 添加评论」开始使用" :image-size="80" />

            <!-- 表格底部汇总 -->
            <!-- 表格底部汇总与分页 (默认10条一页，支持自由切换) -->
            <div class="table-card-footer-bar">
              <span class="footer-summary-text">共 {{ filteredSortedRecords.length }} 条监控记录</span>
              <el-pagination
                v-if="filteredSortedRecords.length > 0"
                v-model:current-page="recordPage"
                v-model:page-size="recordPageSize"
                :page-sizes="[10, 20, 50, 100]"
                layout="sizes, prev, pager, next, jumper"
                :total="filteredSortedRecords.length"
                size="small"
                background
              ></el-pagination>
            </div>
          </div>

          
          <!-- 实时操作日志流面板 (淡白底色、纯黑字体、滚动清晰) -->
          <div class="reference-main-card live-console-card" style="margin-top:16px;">
            <div class="console-header">
              <div class="console-title-group">
                <span class="console-dot" :class="{ running: supplementRunning || batchRunning || archiveBatchRunning }"></span>
                <strong class="console-title-text">实时操作日志</strong>
                <span class="console-sub">自动记录导入、检测、点赞、评论与截图每一步明细</span>
              </div>
              <div class="console-filters-group">
                <el-radio-group v-model="logFilterLevel" size="small">
                  <el-radio-button label="all">全部 ({{ activeLogs.length }})</el-radio-button>
                  <el-radio-button label="error" v-if="errorLogsCount > 0">失败 ({{ errorLogsCount }})</el-radio-button>
                  <el-radio-button label="warning" v-if="warningLogsCount > 0">警告 ({{ warningLogsCount }})</el-radio-button>
                  <el-radio-button label="success" v-if="successLogsCount > 0">成功 ({{ successLogsCount }})</el-radio-button>
                </el-radio-group>
                <el-input
                  v-model="logSearchText"
                  placeholder="搜索日志..."
                  size="small"
                  clearable
                  style="width: 140px; margin-left: 8px;"
                />
              </div>
              <div class="console-actions">
                <button class="gov-btn-small" @click="clearAllActiveLogs" :disabled="activeLogs.length === 0">清空日志</button>
                <button class="gov-btn-small" @click="copyLogsText" :disabled="activeLogs.length === 0">复制</button>
                <button class="gov-btn-small gov-btn-primary-small" @click="exportLogsAsFile" :disabled="activeLogs.length === 0">
                  导出操作流水 (TXT)
                </button>
              </div>
            </div>

            <div class="console-body" ref="consoleScrollRef" style="margin-top:10px;">
              <div v-if="filteredActiveLogs.length" class="console-log-list">
                <div
                  v-for="log in filteredActiveLogs"
                  :key="log.id"
                  class="console-log-row"
                  :class="`log-${log.level}`"
                >
                  <span class="log-time">{{ log.time }}</span>
                  <span class="log-plat" v-if="log.platform">[{{ platName(log.platform) }}]</span>
                  <span class="log-action">[{{ log.action }}]</span>
                  <el-tag size="small" :type="logTagType(log.level)" class="log-status-tag">{{ logTagLabel(log.level) }}</el-tag>
                  <span class="log-msg">{{ log.message }}</span>
                  <span class="log-detail" v-if="log.detail">{{ log.detail }}</span>
                  <span class="log-detail text-primary-code" v-if="log.diagnostics">{{ log.diagnostics }}</span>
                  <span class="log-url" v-if="log.url" :title="log.url">{{ log.url.split("/").pop() || log.url }}</span>
                </div>
              </div>
              <div v-else class="console-empty">
                <span>{{ activeLogs.length ? "无符合过滤条件的日志条目" : "暂无操作日志。执行导入、检测、点赞、评论或截图时将自动记录。" }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 视窗 2：【任务管理 / 发布历史】 -->
        <div v-show="activeTab === 'history'" class="history-page-content">
          <div class="page-title-banner">
            <h2 class="page-heading-title">任务管理 / 发布历史</h2>
            <p class="page-heading-desc">查看评论历史发布记录与在线复验状态。</p>
          </div>

          <div class="reference-main-card">
            <div class="archive-toolbar-row" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
              <div class="archive-actions-left" style="display:flex; gap:8px;">
                <el-button @click="exportCommentHistory" :disabled="commentHistory.length === 0">导出历史 (CSV)</el-button>
                <el-button type="danger" plain @click="clearCommentHistory" :disabled="commentHistory.length === 0">清空发布历史</el-button>
              </div>
              <div class="archive-stats-right" style="font-size:13px; color:#64748b;">
                <span>共 {{ commentHistory.length }} 条发布记录 (成功 {{ commentHistoryStats.verified }} / 待同步 {{ commentHistoryStats.pending }} / 失败 {{ commentHistoryStats.failed }})</span>
              </div>
            </div>

            <el-table
              v-if="commentHistory.length"
              :data="pagedCommentHistory"
              size="default"
              class="reference-modern-table"
              style="width:100%;"
            >
              <el-table-column type="selection" width="45" align="center" />
              <el-table-column type="index" label="序号" width="55" align="center" />
              <el-table-column label="时间" width="165">
                <template #default="{ row }">
                  <span class="table-timestamp-text">{{ formatTimeShort(row.time) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="平台" width="95" align="center">
                <template #default="{ row }">
                  <div class="table-platform-chip">
                    
                    <span class="platform-label-text">{{ platName(row.platform) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="文章链接" min-width="220">
                <template #default="{ row }">
                  <a :href="row.url" target="_blank" class="table-article-title">{{ row.title || row.url }}</a>
                </template>
              </el-table-column>
              <el-table-column label="发布评论正文" min-width="260" show-overflow-tooltip>
                <template #default="{ row }">{{ row.comment }}</template>
              </el-table-column>
              <el-table-column label="验证状态" width="110" align="center">
                <template #default="{ row }">
                  <span
                    class="table-status-badge"
                    :class="{
                      'status-ok': row.verificationStatus === 'verified',
                      'status-warn': row.verificationStatus === 'pending',
                      'status-err': row.verificationStatus === 'failed'
                    }"
                  >
                    {{ row.verificationStatus === 'verified' ? '发布成功' : row.verificationStatus === 'pending' ? '待同步' : '发布失败' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right" align="center">
                <template #default="{ row }">
                  <div class="table-actions-row">
                    <el-button v-if="row.evidenceId" link type="primary" size="small" @click="openCommentEvidence(row)">查看截图</el-button>
                    <el-button link type="primary" size="small" @click="verifyCommentHistoryItem(row)">在线复验</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <el-pagination
              v-if="commentHistory.length > commentHistoryPageSize"
              v-model:current-page="commentHistoryPage"
              v-model:page-size="commentHistoryPageSize"
              :page-sizes="[10, 20, 50]"
              :total="commentHistory.length"
              layout="total, sizes, prev, pager, next"
              background
              style="margin-top:14px;"
              @size-change="commentHistoryPage = 1"
            ></el-pagination>
            <el-empty v-if="commentHistory.length === 0" description="暂无评论历史记录" :image-size="80" />
          </div>
        </div>

        <!-- 视窗 3：【截图存档】 -->
        <div v-show="activeTab === 'archives'" class="archives-page-content">
          <div class="page-title-banner">
            <h2 class="page-heading-title">截图证据归档中心</h2>
            <p class="page-heading-desc">按平台分类与文章链接分组归档截图快照，支持每链接多图查看、选择导出及一键打包生成规范 ZIP 压缩包。</p>
          </div>

          <div class="reference-main-card">
            <!-- 顶部操作与统计工具条 -->
            <div class="archive-main-toolbar">
              <div class="archive-toolbar-left">
                <el-button
                  type="primary"
                  class="action-btn-gov-primary"
                  @click="startArchiveBatch"
                  :disabled="archiveBatchRunning || archiveSupportedCount === 0"
                >
                  全量抓取截图
                </el-button>

                <el-button
                  v-if="archiveBatchRunning"
                  type="danger"
                  plain
                  @click="stopArchiveBatch"
                >终止抓图</el-button>

                <!-- 一键导出全部 ZIP -->
                <el-button
                  type="primary"
                  plain
                  @click="exportAllArchiveSnapshots"
                  :disabled="archiveSnapshots.length === 0"
                >
                  一键导出全部截图 (ZIP, 共 {{ archiveSnapshots.length }} 张)
                </el-button>

                <!-- 选择导出 ZIP -->
                <el-button
                  type="primary"
                  plain
                  @click="exportSelectedArchiveSnapshots"
                  :disabled="selectedArchiveSnapshotIds.size === 0"
                >
                  导出选中截图 (ZIP, 已选 {{ selectedArchiveSnapshotIds.size }} 张)
                </el-button>

                <!-- 支持链接或标题搜索 -->
                <div class="archive-search-box">
                  <el-input
                    v-model="archiveSearchKeyword"
                    placeholder="搜索文章标题或 URL..."
                    size="small"
                    clearable
                    style="width: 220px;"
                  />
                </div>

                <el-button @click="refreshArchiveCenter" :loading="recordsRefreshing">刷新</el-button>

                <el-button
                  type="danger"
                  link
                  @click="clearAllArchiveEvidence"
                  :disabled="archiveSnapshots.length === 0"
                >清空存档</el-button>
              </div>

              <div class="archive-toolbar-right">
                <el-radio-group v-model="archiveViewMode" size="small">
                  <el-radio-button label="group">按文章分组呈现</el-radio-button>
                  <el-radio-button label="table">平铺列表</el-radio-button>
                </el-radio-group>
              </div>
            </div>

            <!-- 网站/平台分类导航 Tab 栏 -->
            <div class="archive-platform-nav-tabs">
              <div
                class="archive-nav-tab-item"
                :class="{ active: archivePlatformFilter === 'all' }"
                @click="archivePlatformFilter = 'all'"
              >
                <span>全部平台</span>
                <span class="tab-badge">{{ archiveSnapshots.length }}</span>
              </div>
              <div
                v-for="plat in supportedPlatformKeys"
                :key="plat"
                class="archive-nav-tab-item"
                :class="{ active: archivePlatformFilter === plat }"
                @click="archivePlatformFilter = plat"
              >
                <span class="platform-dot-indicator" :class="'dot-' + plat"></span>
                <span>{{ platName(plat) }}</span>
                <span class="tab-badge">{{ archivePlatformCounts[plat] || 0 }}</span>
              </div>
            </div>

            <!-- 模式 1：【按链接/文章分组卡片】 -->
            <div v-if="archiveViewMode === 'group'" class="archive-groups-container">
              <div v-if="filteredArchiveGroupRows.length" class="archive-group-list">
                <div
                  v-for="group in filteredArchiveGroupRows"
                  :key="group.key"
                  class="archive-group-card"
                >
                  <!-- 分组卡片头部 -->
                  <div class="archive-group-header">
                    <div class="group-header-info">
                      <div class="group-plat-badge">
                        <span class="platform-dot-indicator" :class="'dot-' + group.record.platform"></span>
                        <strong>{{ platName(group.record.platform) }}</strong>
                      </div>
                      <a :href="group.record.url" target="_blank" class="group-article-title" :title="group.record.title || group.record.url">
                        {{ group.record.title || group.record.url }}
                      </a>
                      <span class="group-article-url">{{ group.record.url }}</span>
                    </div>

                    <div class="group-header-actions">
                      <!-- 链接截图数量胶囊 -->
                      <span class="group-count-pill">
                        包含 <strong>{{ group.imageSnapshots.length }}</strong> 份截图
                      </span>

                      <!-- 全选该链接所有图片复选框 -->
                      <el-checkbox
                        :model-value="isLinkAllSnapshotsSelected(group)"
                        @change="toggleLinkAllSnapshots(group)"
                        class="group-select-checkbox"
                      >全选本组</el-checkbox>

                      <!-- 单个链接一键导出 -->
                      <el-button
                        size="small"
                        type="primary"
                        plain
                        @click="exportLinkArchiveSnapshots(group)"
                        :disabled="group.imageSnapshots.length === 0"
                      >
                        导出该组 ZIP
                      </el-button>

                      <el-button
                        size="small"
                        @click="captureArchiveForRecord(group.record)"
                        :loading="archiveBatchRunning"
                      >重新抓图</el-button>
                    </div>
                  </div>

                  <!-- 分组卡片图片缩略图相册网格 -->
                  <div v-if="group.imageSnapshots.length" class="archive-gallery-grid">
                    <div
                      v-for="(snapshot, imgIdx) in group.imageSnapshots"
                      :key="snapshot.id"
                      class="archive-photo-card"
                      :class="{ selected: isArchiveSnapshotSelected(snapshot.id) }"
                    >
                      <div class="photo-select-box" @click.stop="toggleArchiveSnapshotSelection(snapshot.id)">
                        <el-checkbox :model-value="isArchiveSnapshotSelected(snapshot.id)" />
                      </div>

                      <div class="photo-img-wrap">
                        <el-image
                          :src="snapshot.imageDataUrl"
                          :preview-src-list="group.imageSnapshots.map(s => s.imageDataUrl || '')"
                          :initial-index="imgIdx"
                          preview-teleported
                          fit="cover"
                          class="photo-real-img"
                        ></el-image>
                      </div>

                      <div class="photo-meta-bar">
                        <div class="photo-meta-time">{{ formatTimeShort(snapshot.createdAt) }}</div>
                        <div class="photo-comment-text" :title="snapshot.comment || '无内容摘要'">
                          {{ snapshot.comment || '（无正文摘要）' }}
                        </div>
                        <div class="photo-card-actions">
                          <el-button link type="primary" size="small" @click="openArchiveSnapshot(snapshot)">大图</el-button>
                          <el-button link type="primary" size="small" @click="exportSingleArchiveSnapshot(snapshot)">下载</el-button>
                          <el-button link type="danger" size="small" @click="deleteArchiveSnapshot(snapshot)">删除</el-button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="archive-group-empty-state">
                    <span>暂无归档截图，点击右上角「重新抓图」进行抓取</span>
                  </div>
                </div>
              </div>
              <el-empty v-else description="暂无符合分类的证据截图" :image-size="80" />
            </div>

            <!-- 模式 2：【平铺列表视图】 -->
            <div v-else class="archive-table-container">
              <el-table
                v-if="filteredArchiveSnapshots.length"
                :data="filteredArchiveSnapshots"
                size="default"
                class="reference-modern-table"
                style="width:100%;"
              >
                <el-table-column width="45" align="center">
                  <template #header>
                    <el-checkbox
                      :model-value="isAllFilteredSnapshotsSelected"
                      @change="toggleAllFilteredSnapshots"
                    />
                  </template>
                  <template #default="{ row }">
                    <el-checkbox
                      :model-value="isArchiveSnapshotSelected(row.id)"
                      @change="toggleArchiveSnapshotSelection(row.id)"
                    />
                  </template>
                </el-table-column>

                <el-table-column label="缩略图" width="90" align="center">
                  <template #default="{ row }">
                    <el-image
                      v-if="row.imageDataUrl"
                      :src="row.imageDataUrl"
                      :preview-src-list="[row.imageDataUrl]"
                      preview-teleported
                      fit="cover"
                      style="width:60px; height:42px; border-radius:3px; border:1px solid #cbd5e1; cursor:zoom-in;"
                    />
                    <span v-else style="color:#94a3b8; font-size:11px;">无图片</span>
                  </template>
                </el-table-column>

                <el-table-column prop="platform" label="平台" width="95" align="center">
                  <template #default="{ row }">
                    <div class="table-platform-chip">
                      <span class="platform-dot-indicator" :class="'dot-' + row.platform"></span>
                      <span class="platform-label-text">{{ platName(row.platform) }}</span>
                    </div>
                  </template>
                </el-table-column>

                <el-table-column label="文章标题 / URL" min-width="240">
                  <template #default="{ row }">
                    <div class="table-title-cell">
                      <a :href="row.url" target="_blank" class="table-article-title">{{ row.title || row.url }}</a>
                      <span class="table-article-url">{{ row.url }}</span>
                    </div>
                  </template>
                </el-table-column>

                <el-table-column prop="comment" label="发布内容摘要" min-width="240" show-overflow-tooltip />

                <el-table-column prop="createdAt" label="截图时间" width="150" align="center">
                  <template #default="{ row }">
                    <span class="table-timestamp-text">{{ formatTimeShort(row.createdAt) }}</span>
                  </template>
                </el-table-column>

                <el-table-column label="操作" width="160" fixed="right" align="center">
                  <template #default="{ row }">
                    <div class="table-actions-row">
                      <el-button link type="primary" size="small" @click="openArchiveSnapshot(row)">大图</el-button>
                      <el-button link type="primary" size="small" @click="exportSingleArchiveSnapshot(row)">导出</el-button>
                      <el-button link type="danger" size="small" @click="deleteArchiveSnapshot(row)">删除</el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-else description="暂无截图快照数据" :image-size="80" />
            </div>

            <!-- 截图存档底部汇总 -->
            <!-- 表格底部汇总与分页 (默认10条一页，支持自由切换) -->
            <div class="table-card-footer-bar">
              <span class="footer-summary-text">共 {{ filteredSortedRecords.length }} 条监控记录</span>
              <el-pagination
                v-if="filteredSortedRecords.length > 0"
                v-model:current-page="recordPage"
                v-model:page-size="recordPageSize"
                :page-sizes="[10, 20, 50, 100]"
                layout="sizes, prev, pager, next, jumper"
                :total="filteredSortedRecords.length"
                size="small"
                background
              ></el-pagination>
            </div>
          </div>
        </div>

        <div v-show="activeTab === 'accounts'" class="accounts-page-content">
          <div class="page-title-banner">
            <h2 class="page-heading-title">账号管理</h2>
            <p class="page-heading-desc">配置各平台账号昵称，用于精准匹配发评、点赞与收藏状态。</p>
          </div>

          <div class="reference-main-card">
            <el-alert
              title="填写各平台账号昵称后，将优先以此昵称确认点赞、收藏及我的评论；留空时自动探测页面登录态。"
              type="info"
              :closable="false"
              style="margin-bottom:16px;"
            />
            <el-form label-position="top">
              <el-row :gutter="20">
                <el-col :span="12">
                  <el-form-item label="CSDN 账号名称"><el-input v-model="usernames.csdn" placeholder="请输入 CSDN 显示名称或账号 ID" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="知乎账号名称"><el-input v-model="usernames.zhihu" placeholder="请输入知乎显示名称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="今日头条账号名称"><el-input v-model="usernames.toutiao" placeholder="请输入今日头条显示名称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="百家号账号名称"><el-input v-model="usernames.baijiahao" placeholder="请输入百家号显示名称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="网易新闻账号名称"><el-input v-model="usernames.netease" placeholder="请输入网易新闻显示名称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="搜狐账号名称"><el-input v-model="usernames.sohu" placeholder="请输入搜狐显示名称" clearable /></el-form-item>
                </el-col>
              </el-row>
              <el-button type="primary" @click="saveAccountSettings" style="margin-top:8px;">保存账号设置</el-button>
            </el-form>
          </div>
        </div>

        <!-- 视窗 5：【系统设置】 -->
        <div v-show="activeTab === 'settings'" class="settings-page-content">
          <div class="page-title-banner">
            <h2 class="page-heading-title">系统设置</h2>
            <p class="page-heading-desc">大模型 AI 评论配置、无 Key 模板库与数据备份恢复。</p>
          </div>

          <!-- 平台账号配置专区（嵌入设置） -->
          <div class="reference-main-card" style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px; color:#0f172a; font-size:15px; font-weight:600;">各平台账号配置</h4>
            <el-alert
              title="填写各平台账号昵称后，将优先以此昵称确认点赞、收藏及我的评论；留空时自动探测页面登录态。"
              type="info"
              :closable="false"
              style="margin-bottom:14px;"
            />
            <el-form label-position="top">
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="CSDN 账号名称"><el-input v-model="usernames.csdn" placeholder="请输入 CSDN 昵称或账号 ID" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="知乎账号名称"><el-input v-model="usernames.zhihu" placeholder="请输入知乎显示昵称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="今日头条账号名称"><el-input v-model="usernames.toutiao" placeholder="请输入今日头条用户昵称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="百家号账号名称"><el-input v-model="usernames.baijiahao" placeholder="请输入百家号作者名称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="网易新闻账号名称"><el-input v-model="usernames.netease" placeholder="请输入网易跟贴昵称" clearable /></el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="搜狐账号名称"><el-input v-model="usernames.sohu" placeholder="请输入搜狐用户昵称" clearable /></el-form-item>
                </el-col>
              </el-row>
              <el-button type="primary" class="action-btn-gov-primary" @click="saveAccountSettings">保存账号配置</el-button>
            </el-form>
          </div>


          <!-- 评论模式与大模型配置 (全新规整重构) -->
          <div class="reference-main-card settings-module-card" style="margin-bottom:16px;">
            <div class="module-card-header">
              <h4 class="module-card-title">评论生成与大模型配置</h4>
              <span class="module-card-subtitle">支持接入本地 AIProxy、主流大模型或使用本地无 Key 评论模板库</span>
            </div>

            <!-- 模式切换横向分栏 -->
            <div class="settings-sub-panel">
              <div class="panel-mode-item">
                <div class="panel-mode-info">
                  <div class="mode-item-title">生成模式</div>
                  <div class="mode-item-desc">选择自动生成评论的来源渠道</div>
                </div>
                <el-radio-group v-model="commentMode" :disabled="supplementRunning" @change="saveCommentPreferences" size="default">
                  <el-radio-button label="ai">AI 评论</el-radio-button>
                  <el-radio-button label="template">无 Key 模板</el-radio-button>
                </el-radio-group>
              </div>

              <div v-if="commentMode === 'template'" class="panel-mode-item panel-divider-top">
                <div class="panel-mode-info">
                  <div class="mode-item-title">模板抽取方式</div>
                  <div class="mode-item-desc">连续多条评论时的抽取规则</div>
                </div>
                <el-radio-group v-model="manualTemplateSelection" :disabled="supplementRunning" @change="saveCommentPreferences" size="default">
                  <el-radio-button label="sequential">按顺序轮流</el-radio-button>
                  <el-radio-button label="random">随机抽取</el-radio-button>
                </el-radio-group>
              </div>
            </div>

            <!-- AI 模式配置表单 (规范对齐、双列排版) -->
            <div v-if="commentMode === 'ai'" class="ai-config-clean-form">
              <el-form label-position="top">
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="大模型服务商">
                      <el-select v-model="aiConfig.provider" style="width:100%;" @change="applyAiProvider" size="default">
                        <el-option v-for="provider in aiProviderOptions" :key="provider.id" :label="provider.label" :value="provider.id" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="模型名称">
                      <el-select
                        v-model="aiConfig.model"
                        filterable
                        allow-create
                        default-first-option
                        style="width:100%;"
                        placeholder="请选择或输入模型名称"
                        size="default"
                      >
                        <el-option v-for="model in availableAiModels" :key="model" :label="model" :value="model" />
                      </el-select>
                    </el-form-item>
                  </el-col>

                  <el-col :span="12" v-if="aiConfig.provider === 'custom'">
                    <el-form-item label="自定义接口地址">
                      <el-input v-model="aiConfig.endpoint" placeholder="例如：https://api.openai.com/v1" @input="handleCustomEndpointInput" size="default" />
                    </el-form-item>
                  </el-col>

                  <el-col :span="12" v-if="!isAiProxyProvider">
                    <el-form-item :label="editingApiKey ? '新 API Key' : 'API Key'">
                      <el-input
                        v-model="aiConfig.apiKey"
                        type="password"
                        :placeholder="aiConfig.hasApiKey ? '请输入新的 API Key' : '请输入 API Key'"
                        @input="handleApiKeyInput"
                        @blur="autoFetchAiModels"
                        size="default"
                      />
                    </el-form-item>
                  </el-col>
                </el-row>

                <!-- AIProxy 本地配置导入专区 (规整淡色嵌入块) -->
                <div v-if="isAiProxyProvider" class="aiproxy-box-clean">
                  <div class="aiproxy-info-col">
                    <div class="aiproxy-title">本机 AIProxy 配置文件</div>
                    <div class="aiproxy-desc">选择本机 <code>.aiproxy_sxd</code> 目录下的 <code>config.json</code>，自动解析内网网关、会话凭据及可用模型</div>
                  </div>
                  <div class="aiproxy-action-col">
                    <button
                      type="button"
                      class="gov-action-btn"
                      :disabled="aiProxyImporting"
                      @click="aiProxyFileInput?.click()"
                    >
                      {{ aiProxyConfigLoaded ? '重新选择 config.json' : '选择 config.json' }}
                    </button>
                    <span class="aiproxy-status-tag" :class="aiProxyConfigLoaded ? 'tag-ready' : 'tag-waiting'">
                      {{ aiProxyConfigLoaded ? '配置已就绪' : '尚未载入配置' }}
                    </span>
                  </div>
                  <input
                    ref="aiProxyFileInput"
                    type="file"
                    accept=".json,application/json"
                    class="hidden-file-input"
                    @change="importAiProxyFile"
                  />
                </div>

                <!-- 底部操作按钮栏 (整齐对齐) -->
                <div class="ai-form-bottom-actions">
                  <div class="bottom-actions-left">
                    <el-checkbox v-if="!isAiProxyProvider" v-model="aiConfig.rememberKey">记住 Key</el-checkbox>
                  </div>
                  <div class="bottom-actions-right">
                    <button
                      type="button"
                      class="gov-action-btn"
                      v-if="aiConfig.apiType === 'chat'"
                      @click="fetchAiModels"
                      :disabled="aiModelsLoading || !clientConnected || !aiConfig.endpoint.trim() || (!aiConfig.hasApiKey && !aiConfig.apiKey.trim())"
                    >
                      {{ aiModelsLoading ? '获取中…' : '获取模型' }}
                    </button>
                    <button
                      type="button"
                      class="gov-action-btn"
                      @click="testAiConfig"
                      :disabled="aiTesting || !clientConnected || (isAiProxyProvider ? !aiProxyConfigLoaded || !aiConfig.model : !aiConfig.hasApiKey && !aiConfig.apiKey.trim())"
                    >
                      {{ aiTesting ? '测试中…' : '测试连接' }}
                    </button>
                    <button
                      type="button"
                      v-if="editingApiKey"
                      class="gov-action-btn"
                      @click="cancelEditApiKey"
                    >
                      取消修改
                    </button>
                    <button
                      type="button"
                      class="gov-action-btn btn-primary-highlight"
                      @click="saveAiConfig"
                      :disabled="aiSaving || !clientConnected || (isAiProxyProvider ? !aiProxyConfigLoaded || !aiConfig.model : editingApiKey && !aiConfig.apiKey.trim())"
                    >
                      {{ aiSaving ? '保存中…' : (editingApiKey ? '保存新 Key' : (aiConfig.hasApiKey ? '保存配置' : '保存并启用')) }}
                    </button>
                  </div>
                </div>

                <el-alert
                  v-if="aiTestMessage"
                  :title="aiTestMessage"
                  :type="aiTestSucceeded ? 'success' : 'error'"
                  :closable="false"
                  show-icon
                  style="margin-top:12px;"
                />
              </el-form>
            </div>

            <!-- 无 Key 模板库区域 (整洁多行框与计数) -->
            <div v-else class="template-config-clean-form">
              <div class="template-header-bar">
                <div class="template-rule-text">每条评论用英文分号 ; 分隔，最多支持 500 条；发表评论时自动轮换或随机取用。</div>
                <span class="template-counter-tag">已解析 {{ manualTemplates.length }} / 500 条</span>
              </div>
              <el-input
                v-model="manualTemplateText"
                type="textarea"
                :rows="4"
                maxlength="100000"
                placeholder="例如：写得很清楚，很有参考价值；这个思路很实用，感谢分享；案例部分讲得很明白"
                class="template-clean-textarea"
                style="margin-top:8px;"
              />
              <div class="template-bottom-actions">
                <button type="button" class="gov-action-btn btn-primary-highlight" @click="saveManualTemplates">
                  保存评论模板
                </button>
              </div>
            </div>
          </div>

          <!-- 配置备份与安全 -->
          <div class="reference-main-card config-backup-card">
            <h4 style="margin:0 0 12px; color:#0f172a; font-size:15px; font-weight:600;">配置加密备份与恢复</h4>
            <p style="margin:0 0 12px; color:#64748b; font-size:13px; line-height:1.6;">可将六大平台账号设置、大模型配置、评论模板和警戒线统一打包加密导出。备份密码至少 8 位，使用 AES-256-GCM 高度加密保护。</p>
            <div style="display:flex;gap:12px;align-items:center;margin-top:12px;max-width:520px;">
              <el-input v-model="backupPassword" type="password" show-password placeholder="请输入至少 8 位备份密码" />
              <el-button type="primary" @click="exportConfigBackup" :loading="configExporting">加密导出</el-button>
              <el-button @click="openConfigImport" :loading="configImporting">导入恢复</el-button>
            </div>
            <input ref="configImportInput" class="hidden-file-input" type="file" accept=".dlconfig,application/json" @change="importConfigBackup" />
          </div>

          <!-- 诊断日志与问题反馈 -->
          <div class="reference-main-card config-backup-card" style="margin-top:16px;">
            <h4 style="margin:0 0 12px; color:#0f172a; font-size:15px; font-weight:600;">诊断日志与问题反馈</h4>
            <p style="margin:0 0 12px; color:#64748b; font-size:13px; line-height:1.6;">
              导入、检测、点赞、收藏、评论、截图、配置变更等每一步操作都会写入运行日志。遇到异常时请点击「导出完整诊断日志」，
              把下载到的 JSON 文件直接发给技术支持，即可定位是哪一步、哪个平台、哪条链接出了问题。
            </p>
            <div class="diag-log-stat-row">
              <span class="diag-log-stat">运行日志 <b>{{ activeLogs.length }}</b> 条（失败 {{ errorLogsCount }} 条）</span>
              <span class="diag-log-stat">后台日志 <b>{{ operationLogs.length + errorLogs.length }}</b> 条</span>
              <span class="diag-log-stat">账号探测日志 <b>{{ accountLogs.length }}</b> 条</span>
              <span class="diag-log-stat">监控链接 <b>{{ records.length }}</b> 条</span>
            </div>
            <div class="diag-log-btn-row">
              <el-button type="primary" @click="exportFullDiagnosticLog" :loading="diagnosticExporting">
                导出完整诊断日志 (JSON)
              </el-button>
              <el-button @click="exportLogsAsFile" :disabled="activeLogs.length === 0">导出操作流水 (TXT)</el-button>
              <el-button @click="copyDiagnosticSummary">复制诊断摘要</el-button>
              <el-button @click="loadClientLogs">刷新后台日志</el-button>
              <el-button type="danger" plain @click="clearAllDiagnosticLogs">清空诊断日志</el-button>
            </div>
            <div v-if="diagnosticExportHint" class="diag-log-hint">{{ diagnosticExportHint }}</div>
          </div>
        </div>
      </div>
    </main>

    <!-- 合规声明弹窗 -->
    <el-dialog
      v-model="legalNoticeVisible"
      title="使用须知与合规声明"
      width="560px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="legal-notice-dialog"
    >
      <div class="legal-notice-content">
        <p>欢迎使用 DL评论助手。首次使用前，请认真阅读并确认以下内容：</p>
        <ul>
          <li>本产品仅用于合法合规的功能测试、学习研究，以及管理本人或已获得明确授权的账号和内容，不得用于商业用途。</li>
          <li>严禁用于刷量、虚假互动、垃圾营销、骚扰他人、绕过平台安全验证、侵犯他人权益或任何违法违规活动。</li>
          <li>使用时应遵守适用的法律法规、平台服务协议及社区规则；自动化操作可能触发平台限制，请合理设置频率并人工复核。</li>
          <li>AI 生成内容仅供参考，发布前应由用户自行检查。因违规操作或不当使用造成的账号、内容及其他风险由使用者承担。</li>
        </ul>
        <el-checkbox v-model="legalNoticeConfirmed">我已阅读并同意遵守以上使用要求</el-checkbox>
      </div>
      <template #footer>
        <el-button type="primary" :disabled="!legalNoticeConfirmed" @click="acceptLegalNotice">同意并开始使用</el-button>
      </template>
    </el-dialog>
  </div>
</template>



<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type {
  Platform,
  DashboardLogEntry,
  BatchResultItem,
  CaptureUrlArchiveResult,
  CommentArchiveRunSummary,
  CommentEvidenceSnapshot,
  CommentPublishHistoryItem,
  CommentRecord,
  ScanResponse,
  SupplementActions,
  SupplementResult,
  VerifyCommentOnlineResult,
} from '@shared/types'
import { COMMENT_ARCHIVE_RUN_HISTORY_KEY, COMMENT_ARCHIVE_RUNS_KEY, PlatformLabel } from '@shared/types'
import { classifyArticleUrls, normalizeArticleUrl, type ArticleUrlClassification } from '@shared/platform'
import {
  ACCOUNT_LOG_KEY,
  DEFAULT_USERNAMES,
  type AccountDetectionLog,
  type PlatformUsernames,
} from '@shared/account'
import {
  clearAllRecords,
  deleteCommentEvidence,
  deleteRecord,
  getAllCommentEvidence,
  getAllRecords,
  getCommentEvidence,
  saveRecord,
} from '@db/index'
import { ElMessage, ElMessageBox } from 'element-plus'

const activeTab = ref('workspace')

// 操作台与交互增强状态
const importPanelCollapsed = ref(false)
const recordIssueFilter = ref<'all' | 'comment' | 'interaction' | 'satisfied'>('all')
const archiveSubTab = ref<'screenshots' | 'history'>('screenshots')
const selectedArchiveSnapshots = ref<CommentEvidenceSnapshot[]>([])
const activeLogs = ref<DashboardLogEntry[]>([])
// 诊断日志导出状态（系统设置页）
const diagnosticExporting = ref(false)
const diagnosticExportHint = ref('')

// 实时操作日志持久化 Key
const DASHBOARD_LOGS_KEY = "dashboard_action_logs"
const logFilterLevel = ref<"all" | "error" | "warning" | "success">("all")
const logSearchText = ref("")

const filteredActiveLogs = computed(() => {
  return activeLogs.value.filter(log => {
    if (logFilterLevel.value === "error" && log.level !== "error") return false
    if (logFilterLevel.value === "warning" && log.level !== "warning") return false
    if (logFilterLevel.value === "success" && log.level !== "success") return false
    if (logSearchText.value.trim()) {
      const q = logSearchText.value.trim().toLowerCase()
      const text = [log.time, log.platform, log.action, log.message, log.detail, log.url].filter(Boolean).join(" ").toLowerCase()
      if (!text.includes(q)) return false
    }
    return true
  })
})

const errorLogsCount = computed(() => activeLogs.value.filter(l => l.level === "error").length)
const warningLogsCount = computed(() => activeLogs.value.filter(l => l.level === "warning").length)
const successLogsCount = computed(() => activeLogs.value.filter(l => l.level === "success").length)

async function loadPersistedLogs() {
  try {
    const data = await chrome.storage.local.get(DASHBOARD_LOGS_KEY)
    if (Array.isArray(data[DASHBOARD_LOGS_KEY])) {
      activeLogs.value = data[DASHBOARD_LOGS_KEY] as DashboardLogEntry[]
    }
  } catch {}
}

let saveLogsTimer: number | undefined
function persistLogs() {
  if (saveLogsTimer) window.clearTimeout(saveLogsTimer)
  saveLogsTimer = window.setTimeout(() => {
    chrome.storage.local.set({ [DASHBOARD_LOGS_KEY]: activeLogs.value.slice(0, 2000) }).catch(() => {})
  }, 500)
}

function pushLog(entry: {
  level: "info" | "success" | "warning" | "error"
  action: string
  message: string
  platform?: Platform
  url?: string
  detail?: string
  diagnostics?: string
}) {
  const item: DashboardLogEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toTimeString().slice(0, 8),
    level: entry.level,
    platform: entry.platform,
    url: entry.url,
    action: entry.action,
    message: entry.message,
    detail: entry.detail,
    diagnostics: entry.diagnostics,
  }
  activeLogs.value.unshift(item)
  if (activeLogs.value.length > 2000) {
    activeLogs.value.pop()
  }
  persistLogs()
}

function clearAllActiveLogs() {
  activeLogs.value = []
  chrome.storage.local.remove(DASHBOARD_LOGS_KEY).catch(() => {})
}

function exportLogsAsFile() {
  if (!activeLogs.value.length) return
  const lines = [
    "# DL评论助手 · 操作流水日志",
    "# 导出时间: " + new Date().toLocaleString(),
    "# 总计条数: " + activeLogs.value.length,
    "--------------------------------------------------------------------------------",
    ...activeLogs.value.map(log => {
      const plat = log.platform ? platName(log.platform) : "系统"
      const status = log.level === "success" ? "成功" : log.level === "error" ? "失败" : log.level === "warning" ? "警告" : "信息"
      return `[${log.time}] [${plat}] [${log.action}] ${status}: ${log.message}${log.detail ? " | " + log.detail : ""}${log.diagnostics ? " | " + log.diagnostics : ""}${log.url ? " | " + log.url : ""}`
    })
  ]
  const blob = new Blob([lines.join(String.fromCharCode(13, 10))], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `DL评论助手操作日志_${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success("操作日志文件已成功导出")
}

function copyLogsText() {
  if (!activeLogs.value.length) return
  const text = activeLogs.value
    .map(log => `[${log.time}] [${log.platform ? platName(log.platform) : '系统'}] [${log.action}] ${log.level.toUpperCase()} - ${log.message}${log.detail ? ' (' + log.detail + ')' : ''}${log.diagnostics ? ' (' + log.diagnostics + ')' : ''}${log.url ? ' <' + log.url + '>' : ''}`)
    .join('\n')
  copyText(text, '操作日志已复制到剪贴板')
}

function logTagType(level: 'info' | 'success' | 'warning' | 'error'): 'info' | 'success' | 'warning' | 'danger' {
  if (level === 'success') return 'success'
  if (level === 'warning') return 'warning'
  if (level === 'error') return 'danger'
  return 'info'
}

function logTagLabel(level: 'info' | 'success' | 'warning' | 'error'): string {
  if (level === 'success') return '成功'
  if (level === 'warning') return '警告/跳过'
  if (level === 'error') return '失败'
  return '信息'
}

// ===== 完整诊断日志（把界面日志、后台日志、账号探测日志、链接记录与配置一次性打包导出） =====

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 读取后台（Service Worker）保存的操作日志与问题日志。 */
async function readBackgroundLogs(): Promise<{ operations: any[]; errors: any[] }> {
  try {
    if (!clientConnected.value) await checkClient(false)
    const [operations, errors] = await Promise.all([
      clientCommand<any>('LIST_LOGS', { channel: 'operation', limit: 2000 }),
      clientCommand<any>('LIST_LOGS', { channel: 'error', limit: 2000 }),
    ])
    return { operations: operations?.logs || [], errors: errors?.logs || [] }
  } catch {
    return { operations: [], errors: [] }
  }
}

/** 采集当前环境、配置与全部日志，组装成一份可离线排障的 JSON。 */
async function collectDiagnosticPayload() {
  const [records, accountData, backgroundLogs, stored] = await Promise.all([
    getAllRecords().catch(() => [] as CommentRecord[]),
    chrome.storage.local.get(ACCOUNT_LOG_KEY).catch(() => ({} as Record<string, unknown>)),
    readBackgroundLogs(),
    chrome.storage.local.get([COMMENT_TEMPLATES_KEY, COMMENT_MODE_KEY, COMMENT_TEMPLATE_SELECTION_KEY]).catch(() => ({} as Record<string, unknown>)),
  ])

  const manifest = chrome.runtime.getManifest()
  const configuredUsernames = { ...usernames.value }
  const accountDetectionLogs = Array.isArray(accountData[ACCOUNT_LOG_KEY])
    ? accountData[ACCOUNT_LOG_KEY] as AccountDetectionLog[]
    : []

  return {
    meta: {
      product: 'DL评论助手',
      extensionVersion: manifest.version,
      manifestVersion: manifest.manifest_version,
      exportedAt: new Date().toISOString(),
      exportedAtLocal: new Date().toLocaleString(),
      description: '本文件包含运行日志、链接检测记录与配置快照，用于问题排查，可直接发给技术支持。',
    },
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen: `${window.screen.width}x${window.screen.height}`,
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dashboardUrl: location.href,
    },
    settings: {
      usernames: configuredUsernames,
      warningThreshold: warningThreshold.value,
      commentMode: commentMode.value,
      templateSelection: manualTemplateSelection.value,
      templateCount: manualTemplates.value.length,
      aiProvider: aiConfig.value.provider,
      aiModel: aiConfig.value.model,
      aiEndpointOrigin: (() => { try { return new URL(aiConfig.value.endpoint).origin } catch { return '' } })(),
      aiKeyConfigured: Boolean(aiConfig.value.hasApiKey),
      storedCommentMode: stored[COMMENT_MODE_KEY] ?? null,
      storedTemplateCount: Array.isArray(stored[COMMENT_TEMPLATES_KEY]) ? (stored[COMMENT_TEMPLATES_KEY] as unknown[]).length : 0,
    },
    // 链接记录是判断“检测到底跑没跑到、为什么是 0 条”的关键证据。
    records: records.map(record => ({
      platform: record.platform,
      url: record.url,
      title: record.title,
      commentCount: record.commentCount,
      username: record.username,
      checkTime: record.checkTime,
      linkStatus: record.linkStatus,
      actionStatus: record.actionStatus,
      lastErrorCode: record.lastErrorCode,
      liked: record.liked,
      collected: record.collected,
    })),
    counts: {
      records: records.length,
      dashboardLogs: activeLogs.value.length,
      dashboardErrors: activeLogs.value.filter(item => item.level === 'error').length,
      backgroundOperationLogs: backgroundLogs.operations.length,
      backgroundErrorLogs: backgroundLogs.errors.length,
      accountLogs: accountDetectionLogs.length,
    },
    dashboardLogs: activeLogs.value,
    backgroundLogs,
    accountLogs: accountDetectionLogs,
  }
}

async function exportFullDiagnosticLog() {
  if (diagnosticExporting.value) return
  diagnosticExporting.value = true
  diagnosticExportHint.value = ''
  try {
    const payload = await collectDiagnosticPayload()
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
    const fileName = `DL评论助手诊断日志_${stamp}.json`
    downloadJson(payload, fileName)
    diagnosticExportHint.value = `已导出：${fileName}（运行日志 ${payload.counts.dashboardLogs} 条 / 后台日志 ${
      payload.counts.backgroundOperationLogs + payload.counts.backgroundErrorLogs} 条 / 账号日志 ${payload.counts.accountLogs} 条 / 链接记录 ${payload.counts.records} 条）`
    pushLog({
      level: 'success',
      action: '导出诊断日志',
      message: `已导出完整诊断日志：${fileName}`,
      detail: `运行日志 ${payload.counts.dashboardLogs} 条，后台日志 ${payload.counts.backgroundOperationLogs + payload.counts.backgroundErrorLogs} 条，链接记录 ${payload.counts.records} 条`,
    })
    ElMessage.success('完整诊断日志已导出，可直接发送给技术支持')
  } catch (error) {
    ElMessage.error(`诊断日志导出失败：${String((error as Error)?.message || error)}`)
  } finally {
    diagnosticExporting.value = false
  }
}

/** 复制一段精简文字摘要，方便直接粘贴到聊天窗口。 */
async function copyDiagnosticSummary() {
  try {
    const payload = await collectDiagnosticPayload()
    const failedRecords = payload.records.filter(record => record.lastErrorCode || record.linkStatus === 'invalid')
    const lines = [
      `DL评论助手 v${payload.meta.extensionVersion} 诊断摘要`,
      `导出时间：${payload.meta.exportedAtLocal}`,
      `链接记录：${payload.counts.records} 条（异常/失效 ${failedRecords.length} 条）`,
      `运行日志：${payload.counts.dashboardLogs} 条（失败 ${payload.counts.dashboardErrors} 条）`,
      `后台日志：${payload.counts.backgroundOperationLogs + payload.counts.backgroundErrorLogs} 条，账号探测日志：${payload.counts.accountLogs} 条`,
      '',
      '最近 15 条日志：',
      ...payload.dashboardLogs.slice(0, 15).map(item =>
        `[${item.time}] [${item.platform ? platName(item.platform) : '系统'}] [${item.action}] ${item.level.toUpperCase()} ${item.message}${item.diagnostics ? ' | ' + item.diagnostics : ''}`),
    ]
    await copyText(lines.join('\n'), '诊断摘要已复制到剪贴板')
  } catch (error) {
    ElMessage.error(`复制诊断摘要失败：${String((error as Error)?.message || error)}`)
  }
}

async function clearAllDiagnosticLogs() {
  try {
    await ElMessageBox.confirm(
      '将清空界面运行日志、后台操作/问题日志和账号探测日志（链接记录与配置不受影响）。建议先导出诊断日志再清空。确定继续吗？',
      '清空诊断日志',
      { type: 'warning' },
    )
  } catch {
    return
  }
  clearAllActiveLogs()
  try {
    await clientCommand('CLEAR_LOGS', { channel: 'all' })
  } catch {}
  operationLogs.value = []
  errorLogs.value = []
  await chrome.storage.local.remove(ACCOUNT_LOG_KEY).catch(() => {})
  accountLogs.value = []
  diagnosticExportHint.value = '诊断日志已清空'
  ElMessage.success('诊断日志已清空')
}

function platformTagType(platform: Platform): 'success' | 'warning' | 'info' | 'danger' | undefined {
  if (platform === 'csdn') return 'danger'
  if (platform === 'zhihu') return undefined
  if (platform === 'toutiao') return 'danger'
  if (platform === 'baijiahao') return 'warning'
  if (platform === 'netease') return 'danger'
  if (platform === 'sohu') return 'warning'
  return 'info'
}

const satisfiedRecordsCount = computed(() => {
  return records.value.filter(r => !isInvalidRecord(r) && !isWarningRecord(r) && !isThirdPartyPlatform(r.platform)).length
})

const screenshotCandidates = computed(() => {
  return records.value.filter(r => !isInvalidRecord(r) && !isThirdPartyPlatform(r.platform) && r.commentCount > 0)
})

const pipelineCandidates = computed(() => {
  return records.value.filter(r => !isInvalidRecord(r) && !isThirdPartyPlatform(r.platform) && (
    isWarningRecord(r) || r.liked !== true || r.collected !== true || r.commentCount > 0
  ))
})

const activeRunningTitle = computed(() => {
  if (supplementRunning.value) return supplementTaskLabel.value || '正在执行后台互动任务'
  if (batchRunning.value) return `批量检测中（第 ${batchCurrentIndex.value} / ${batchTotal.value} 条）`
  if (archiveBatchRunning.value) return `评论截图归档中（第 ${archiveCompleted.value + 1} / ${archiveTotal.value} 条）`
  return '任务执行中'
})

const activeRunningPlatform = computed(() => {
  if (supplementRunning.value) return supplementProgress.value.platform
  if (batchRunning.value) return batchCurrentPlatform.value
  return ''
})

const activeRunningUrl = computed(() => {
  if (supplementRunning.value) return supplementProgress.value.url
  if (batchRunning.value) return batchCurrentUrl.value
  if (archiveBatchRunning.value) return archiveCurrentUrl.value
  return ''
})

const activeRunningProgressText = computed(() => {
  if (supplementRunning.value) {
    return `已完成 ${supplementProgress.value.completed} / ${supplementProgress.value.total || supplementProgress.value.pending || 1} 条`
  }
  if (batchRunning.value) {
    return `已完成 ${batchCompleted.value} / ${batchTotal.value} 条`
  }
  if (archiveBatchRunning.value) {
    return `已完成 ${archiveCompleted.value} / ${archiveTotal.value} 条`
  }
  return ''
})

const activeRunningPercent = computed(() => {
  if (supplementRunning.value) return supplementProgressPercent.value
  if (batchRunning.value && batchTotal.value) return Math.round((batchCompleted.value / batchTotal.value) * 100)
  if (archiveBatchRunning.value && archiveTotal.value) return Math.round((archiveCompleted.value / archiveTotal.value) * 100)
  return 0
})

const activeRunningElapsed = computed(() => {
  if (supplementRunning.value) return supplementStepElapsedSeconds.value
  if (batchRunning.value) return batchElapsedSeconds.value
  return 0
})

function stopActiveTask() {
  if (supplementRunning.value) stopSupplement()
  if (batchRunning.value) stopBatch()
  if (archiveBatchRunning.value) stopArchiveBatch()
  pushLog({ level: 'warning', action: '用户停止', message: '用户手动中止了当前任务' })
}

async function handleOneClickScreenshot() {
  if (!screenshotCandidates.value.length) {
    ElMessage.warning('当前没有需要截图的文章（需评论数大于0）')
    return
  }
  pushLog({
    level: 'info',
    action: '一键截图',
    message: `开始为 ${screenshotCandidates.value.length} 篇有评论文章批量截图存档`,
  })
  const rows = archiveRows.value.filter(r => screenshotCandidates.value.some(c => c.url === r.record.url))
  await runArchiveBatch(rows.length ? rows : archiveRows.value)
}

async function handleOneClickPipeline() {
  if (!pipelineCandidates.value.length) {
    ElMessage.warning('当前没有需要流水线处理的文章')
    return
  }
  pushLog({
    level: 'info',
    action: '全自动流水线',
    message: `启动全自动流水线：对 ${pipelineCandidates.value.length} 篇文章在单标签页中连贯完成点赞、收藏与补评论`,
  })
  await startSupplement(pipelineCandidates.value, {
    comment: true,
    like: true,
    collect: true,
    screenshot: true,
  })
}

async function importUrlsOnly() {
  const classification = batchClassification.value
  if (!classification.valid.length && !classification.thirdParty.length) {
    ElMessage.warning('没有可导入的文章链接')
    return
  }
  const now = new Date().toISOString()
  const existing = await getAllRecords()
  const existingKeys = new Set(existing.map(r => `${r.platform}:${normalizeArticleUrl(r.url, r.platform)}`))
  let count = 0
  for (const item of classification.valid) {
    const key = `${item.platform}:${item.url}`
    if (!existingKeys.has(key)) {
      await saveRecord({
        platform: item.platform,
        url: item.url,
        title: '',
        commentCount: 0,
        checkTime: now,
        username: '',
        linkStatus: 'active',
      })
      existingKeys.add(key)
      count++
    }
  }
  for (const url of classification.thirdParty) {
    const key = `third_party:${normalizeArticleUrl(url, 'third_party')}`
    if (!existingKeys.has(key)) {
      await saveRecord({
        platform: 'third_party',
        url,
        title: '第三方链接（等待开发）',
        commentCount: 0,
        checkTime: now,
        username: '',
        linkStatus: 'active',
      })
      existingKeys.add(key)
      count++
    }
  }
  batchUrls.value = ''
  importPanelCollapsed.value = true
  await loadDashboardData()
  ElMessage.success(`成功导入 ${count} 条新链接`)
  pushLog({
    level: 'success',
    action: '批量导入',
    message: `成功导入 ${count} 条新链接到监控列表`,
  })
}

/**
 * 「导入并快速检测」：先把链接写入监控列表，再立即对同一批链接发起检测。
 * 这里必须先按导入前的分类结果调用 startBatch，因为 importUrlsOnly 会清空输入框，
 * 清空后 batchClassification 会变成空集合，检测就会没有目标。
 */
async function importAndStartDetection() {
  if (batchRunning.value || supplementRunning.value || archiveBatchRunning.value) {
    ElMessage.warning('已有任务正在运行，请先等待完成或点击“停止任务”')
    return
  }
  const classification = batchClassification.value
  if (!classification.valid.length && !classification.thirdParty.length) {
    ElMessage.warning('没有可导入的文章链接')
    return
  }

  await importUrlsOnly()
  importPanelCollapsed.value = true
  await startBatch(classification)
}

function handleArchiveSnapshotSelectionChange(selection: CommentEvidenceSnapshot[]) {
  selectedArchiveSnapshots.value = selection
}

function formatRecordActionSummary(record: CommentRecord): string {
  if (isInvalidRecord(record)) return "链接失效 (404)"

  // 1. 如果有明确的补齐/互动动作执行结果
  if (record.actionStatus === "verified" || record.actionStatus === "satisfied") {
    return `操作达标 (${record.commentCount}条评论 / ${record.liked ? "已赞" : "未赞"} / ${record.collected ? "已藏" : "未藏"})`
  }
  if (record.actionStatus === "partial") {
    return `部分完成 (${record.commentCount}条评论 / ${record.liked ? "已赞" : "未赞"} / ${record.collected ? "已藏" : "未藏"})`
  }
  if (record.actionStatus === "failed") {
    return record.lastErrorCode ? `操作异常: ${record.lastErrorCode}` : "操作未完成"
  }

  // 2. 如果最新检测时间存在且有效
  if (record.checkTime) {
    const likeStr = record.liked === true ? "已赞" : record.liked === false ? "未赞" : "暂未识别"
    const collectStr = record.collected === true ? "已藏" : record.collected === false ? "未藏" : "暂未识别"
    if (record.platform === "netease") {
      return `检测完成 (${record.commentCount}条评论)`
    }
    return `检测完成 (${record.commentCount}条评论 / ${likeStr} / ${collectStr})`
  }

  // 3. 历史错误码作为兜底提示
  if (record.lastErrorCode === "AUTH_REQUIRED") return "当前未检测到登录态"
  if (record.lastErrorCode === "PAGE_INVALID") return "页面链接失效 (404)"
  if (record.lastErrorCode === "RISK_CONTROL_BLOCKED") return "触发平台安全验证"
  if (record.lastErrorCode) return `异常: ${record.lastErrorCode}`

  return "已录入，等待首次检测"
}

const LEGAL_NOTICE_KEY = 'legalNoticeAcceptance'
const LEGAL_NOTICE_VERSION = '2026-07-30'
const legalNoticeVisible = ref(false)
const legalNoticeConfirmed = ref(false)

// 批量检测
const batchUrls = ref('')
const batchRunning = ref(false)
const batchStopping = ref(false)
const batchWasCancelled = ref(false)
const batchTotal = ref(0)
const batchCurrentIndex = ref(0)
const batchCompleted = ref(0)
const batchCurrentUrl = ref('')
const batchCurrentPlatform = ref<Platform | ''>('')
const batchElapsedSeconds = ref(0)
const batchResults = ref<BatchResultItem[]>([])
type PlatformFilter = 'all' | Platform
interface PlatformFilterOption {
  value: PlatformFilter
  label: string
  count: number
}
const batchPlatformFilter = ref<PlatformFilter>('all')
const recordPlatformFilter = ref<PlatformFilter>('all')
const archivePlatformFilter = ref<PlatformFilter>('all')
const manualReviewStates = ref<Record<string, { tabId: number; openedAt: number }>>({})
const manualUpdatingKey = ref('')
const batchRecheckKey = ref('')
let batchTimer: number | undefined
let activeBatchPort: chrome.runtime.Port | null = null

// 唯一链接扫描记录
const records = ref<CommentRecord[]>([])
const rescanUrl = ref('')
const rescanAllRunning = ref(false)
const recordsRefreshing = ref(false)
const clearingRecords = ref(false)
const warningThreshold = ref(3)
const recordSort = ref<'timeDesc' | 'countAsc' | 'countDesc'>('timeDesc')
const commentHistory = ref<CommentPublishHistoryItem[]>([])
const commentHistoryPage = ref(1)
const commentHistoryPageSize = ref(10)
const COMMENT_HISTORY_KEY = 'commentPublishHistory'
const evidenceBusyId = ref('')
let commentHistoryLoadVersion = 0

interface ArchiveRow {
  key: string
  record: CommentRecord
  snapshots: CommentEvidenceSnapshot[]
  imageSnapshots: CommentEvidenceSnapshot[]
  legacySnapshots: CommentEvidenceSnapshot[]
  latest?: CommentEvidenceSnapshot
  run?: CommentArchiveRunSummary
  detectedCount: number
  capturedCount: number
  missingCount: number
  status: 'complete' | 'incomplete' | 'failed' | 'unscanned'
}

interface ArchiveImageBatch {
  key: string
  label: string
  createdAt: string
  snapshots: CommentEvidenceSnapshot[]
}

const archiveSnapshots = ref<CommentEvidenceSnapshot[]>([])
const archiveRuns = ref<Record<string, CommentArchiveRunSummary>>({})
const archiveRunHistory = ref<CommentArchiveRunSummary[]>([])
const archiveSelectedRows = ref<ArchiveRow[]>([])
const archiveBusyKey = ref('')
const archiveBatchRunning = ref(false)
const archiveStopRequested = ref(false)
const archiveCompleted = ref(0)
const archiveTotal = ref(0)
const archiveCurrentUrl = ref('')
const archiveTimelineRow = ref<ArchiveRow | null>(null)
const archiveTimelineVisible = ref(false)
const archiveImportVisible = ref(false)
const archiveImportText = ref('')

// 手动账号设置与异常日志
const usernames = ref<PlatformUsernames>({ ...DEFAULT_USERNAMES })
const accountLogs = ref<AccountDetectionLog[]>([])

// 纯插件 AI、日志与智能补齐
const clientConnected = ref(false)
const clientInfo = ref<Record<string, any>>({})
const clientError = ref('')
type AiProviderId = 'deepseek' | 'openai' | 'qwen' | 'kimi' | 'zhipu' | 'anthropic' | 'gemini' | 'siliconflow' | 'aiproxy_claude' | 'aiproxy_codex' | 'custom'
const aiProviderOptions: Array<{ id: AiProviderId; label: string; apiType: string; endpoint: string; model: string }> = [
  { id: 'deepseek', label: 'DeepSeek', apiType: 'chat', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', apiType: 'chat', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini' },
  { id: 'qwen', label: '通义千问', apiType: 'chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  { id: 'kimi', label: 'Kimi', apiType: 'chat', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { id: 'zhipu', label: '智谱 GLM', apiType: 'chat', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  { id: 'anthropic', label: 'Anthropic Claude', apiType: 'messages', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-5' },
  { id: 'gemini', label: 'Google Gemini', apiType: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', model: 'gemini-2.5-flash' },
  { id: 'siliconflow', label: '硅基流动', apiType: 'chat', endpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'aiproxy_claude', label: 'AIProxy Claude', apiType: 'messages', endpoint: '', model: '' },
  { id: 'aiproxy_codex', label: 'AIProxy Codex', apiType: 'responses', endpoint: '', model: '' },
  { id: 'custom', label: '自定义兼容接口', apiType: 'chat', endpoint: '', model: '' },
]
const aiConfig = ref({
  provider: 'deepseek' as AiProviderId,
  apiType: 'chat',
  endpoint: 'https://api.deepseek.com/chat/completions',
  apiKey: '',
  model: 'deepseek-chat',
  rememberKey: true,
  hasApiKey: false,
})
const aiSaving = ref(false)
const aiTesting = ref(false)
const aiModelsLoading = ref(false)
const availableAiModels = ref<string[]>([])
const aiTestMessage = ref('')
const aiTestSucceeded = ref(false)
const editingApiKey = ref(false)
const aiProxyFileInput = ref<HTMLInputElement | null>(null)
const aiProxyImporting = ref(false)
const aiProxyConfigLoaded = ref(false)
const isAiProxyProvider = computed(() => aiConfig.value.provider === 'aiproxy_claude' || aiConfig.value.provider === 'aiproxy_codex')
const COMMENT_TEMPLATES_KEY = 'manualCommentTemplates'
const DEFAULT_COMMENT_TEMPLATES = [
  '内容梳理得很清楚，重点也比较突出，读完很有收获',
  '这个角度很有启发，很多细节值得继续思考',
  '分析得比较全面，观点和例子结合得很好',
  '文章表达得很清晰，对理解这个问题很有帮助',
  '这篇内容很有参考价值，感谢作者认真整理和分享',
  '其中提到的思路很实用，给了我一些新的启发',
  '观点讲得很明白，尤其是细节部分很值得关注',
  '内容循序渐进，读起来很顺畅，也容易理解',
  '总结得很到位，对相关问题有了更清晰的认识',
  '分享得很用心，里面有不少值得借鉴的内容',
]
const COMMENT_MODE_KEY = 'commentGenerationMode'
const COMMENT_TEMPLATE_SELECTION_KEY = 'manualTemplateSelection'
const commentMode = ref<'ai' | 'template'>('ai')
const manualTemplateSelection = ref<'sequential' | 'random'>('sequential')
const commentModeConfigured = ref(false)
const manualTemplateText = ref('')
const manualTemplates = computed(() => manualTemplateText.value
  .split(';')
  .map(value => value.trim())
  .filter(Boolean)
  .slice(0, 500))
const commentModeReady = computed(() => commentMode.value === 'ai'
  ? clientConnected.value && aiConfig.value.hasApiKey
  : manualTemplates.value.length > 0)
const commentModeDescription = computed(() => {
  if (commentMode.value === 'ai') {
    return commentModeReady.value
      ? '当前使用 AI 评论：将读取文章内容并调用已配置的大模型生成评论。'
      : '当前使用 AI 评论：请先配置并保存 API Key。'
  }
  return manualTemplates.value.length
    ? `当前使用无 Key 模板：已识别 ${manualTemplates.value.length} 条，将${manualTemplateSelection.value === 'random' ? '随机抽取' : '按顺序轮换'}。`
    : '当前使用无 Key 模板：请先使用英文分号 ; 填写并保存至少 1 条评论。'
})
const backupPassword = ref('')
const configExporting = ref(false)
const configImporting = ref(false)
const configImportInput = ref<HTMLInputElement | null>(null)
const supplementRunning = ref(false)
const supplementStopping = ref(false)
const supplementResults = ref<SupplementResult[]>([])
const supplementPage = ref(1)
const supplementPageSize = ref(10)
const commentRound = ref(0)
const supplementProgress = ref<{
  completed: number
  pending: number
  current: number
  total: number
  percent: number
  stagePercent: number
  url: string
  platform: Platform | ''
  status: string
}>({
  completed: 0, pending: 0, current: 0, total: 0, percent: 0, stagePercent: 0,
  url: '', platform: '', status: '',
})
const supplementTaskLabel = ref('')
const supplementCountdownSeconds = ref(0)
const supplementStepElapsedSeconds = ref(0)
const supplementProgressPercent = computed(() => Math.max(0, Math.min(100,
  Number(supplementProgress.value.percent)
  || (supplementProgress.value.total > 0
    ? Math.round((supplementProgress.value.completed / supplementProgress.value.total) * 100)
    : 0),
)))
let supplementStepStartedAt = 0
let supplementCountdownDeadline = 0
let supplementProgressTimer: number | undefined
let activeSupplementPort: chrome.runtime.Port | null = null
const logsLoading = ref(false)
const logTab = ref<'operation' | 'error'>('operation')
const operationLogs = ref<any[]>([])
const errorLogs = ref<any[]>([])
const logDirectory = ref('')
const exportedLogPath = ref('')

function extractUrls(text: string): string[] {
  // 将 Markdown 的 `[显示地址](真实地址)` 拆成独立 URL；后续分类会规范化并去重。
  // 旧规则会把 `](https://...)` 一并吞入前一个 URL，搜狐的精确文章路径因此失效。
  return text.match(/https?:\/\/[^\s,"'<>\[\]()]+/g) || []
}

const batchClassification = computed(() => classifyArticleUrls(extractUrls(batchUrls.value)))

const platformFilterValues: Platform[] = ['csdn', 'zhihu', 'toutiao', 'baijiahao', 'netease', 'sohu', 'third_party']

function platformOptionsFor(items: Array<{ platform: Platform }>): PlatformFilterOption[] {
  return [
    { value: 'all', label: '全部平台', count: items.length },
    ...platformFilterValues.map(platform => ({
      value: platform,
      label: platName(platform),
      count: items.filter(item => item.platform === platform).length,
    })),
  ]
}

const batchPlatformOptions = computed(() => platformOptionsFor(batchResults.value))
const recordPlatformOptions = computed(() => platformOptionsFor(records.value))
const filteredBatchResults = computed(() => batchPlatformFilter.value === 'all'
  ? batchResults.value
  : batchResults.value.filter(item => item.platform === batchPlatformFilter.value))

const recordSearchKeyword = ref('')
const recordPage = ref(1)
const recordPageSize = ref(10)

const pagedFilteredSortedRecords = computed(() => {
  const start = (recordPage.value - 1) * recordPageSize.value
  return filteredSortedRecords.value.slice(start, start + recordPageSize.value)
})

watch([recordSearchKeyword, recordPlatformFilter, recordIssueFilter], () => {
  recordPage.value = 1
})
const selectedRecords = ref<CommentRecord[]>([])

function handleDeleteSelected() {
  if (selectedRecords.value.length === 0) {
    ElMessage.info('请先勾选要删除的记录')
    return
  }
  const targets = [...selectedRecords.value]
  const count = targets.length
  ElMessageBox.confirm(
    '确定要删除选中的 ' + count + ' 篇监控记录吗？',
    '批量删除确认',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    // 逐条删除 IndexedDB 记录，避免只改内存导致刷新后记录又回来。
    for (const record of targets) {
      try {
        await deleteRecord(record.platform, record.url)
      } catch (error) {
        console.error('[DL评论助手] 批量删除记录失败:', record.url, error)
      }
    }
    const keysToDelete = new Set(targets.map(r => `${r.platform}:${normalizeArticleUrl(r.url, r.platform)}`))
    const sameKey = (item: { platform: Platform; url: string }) => (
      keysToDelete.has(`${item.platform}:${normalizeArticleUrl(item.url, item.platform)}`)
    )
    records.value = records.value.filter(item => !sameKey(item))
    batchResults.value = batchResults.value.filter(item => !sameKey(item))
    supplementResults.value = supplementResults.value.filter(item => !sameKey(item))
    await chrome.storage.local.set({ lastSupplementResults: supplementResults.value.slice(-200) })
    selectedRecords.value = []
    pushLog({ level: 'warning', action: '批量删除', message: `已删除选中的 ${count} 条监控记录` })
    auditUserAction('delete-scan-records', { count, urls: targets.map(r => r.url).slice(0, 50) })
    ElMessage.success('已成功删除选中的 ' + count + ' 篇记录')
  }).catch(() => {})
}

function handleRecordSelectionChange(val: CommentRecord[]) {
  selectedRecords.value = val
}

const sortedRecords = computed(() => [...records.value].sort((a, b) => {
  if (recordSort.value !== 'timeDesc' && isInvalidRecord(a) !== isInvalidRecord(b)) {
    return isInvalidRecord(a) ? 1 : -1
  }
  if (recordSort.value === 'countAsc') {
    return a.commentCount - b.commentCount || b.checkTime.localeCompare(a.checkTime)
  }
  if (recordSort.value === 'countDesc') {
    return b.commentCount - a.commentCount || b.checkTime.localeCompare(a.checkTime)
  }
  return b.checkTime.localeCompare(a.checkTime)
}))

const filteredSortedRecords = computed(() => {
  let list = sortedRecords.value
  if (recordPlatformFilter.value !== 'all') {
    list = list.filter(record => record.platform === recordPlatformFilter.value)
  }
  if (recordIssueFilter.value === 'comment') {
    list = list.filter(r => isWarningRecord(r) && !isInvalidRecord(r))
  } else if (recordIssueFilter.value === 'interaction') {
    list = list.filter(r => (!r.liked || !r.collected) && !isInvalidRecord(r) && supportsInteraction(r.platform))
  } else if (recordIssueFilter.value === 'satisfied') {
    list = list.filter(r => !isWarningRecord(r) && !isInvalidRecord(r))
  }
  if (recordSearchKeyword.value.trim()) {
    const kw = recordSearchKeyword.value.trim().toLowerCase()
    list = list.filter(r => (r.title && r.title.toLowerCase().includes(kw)) || (r.url && r.url.toLowerCase().includes(kw)))
  }
  return list
})

const handleBatchOperationCommand = async (command: string) => {
  if (command === 'like_collect') {
    await startSupplement(interactionCandidates.value, { comment: false, like: true, collect: true, screenshot: false })
  } else if (command === 'comment') {
    await startSupplement(commentCandidates.value, { comment: true, like: false, collect: false, screenshot: false })
  } else if (command === 'screenshot') {
    await handleOneClickScreenshot()
  } else if (command === 'rescan_all') {
    await rescanAllRecords('all')
  } else if (command === 'export_csv') {
    handleRecordExportCommand('all')
  } else if (command === 'export_warning') {
    handleRecordExportCommand('warning')
  } else if (command === 'clear_all') {
    await clearAllScanData()
  }
}

const archiveRows = computed<ArchiveRow[]>(() => records.value
  .map((record) => {
    const normalizedUrl = normalizeArticleUrl(record.url, record.platform)
    const key = `${record.platform}:${normalizedUrl}`
    const snapshots = archiveSnapshots.value
      .filter(snapshot => snapshot.platform === record.platform
        && normalizeArticleUrl(snapshot.url, snapshot.platform) === normalizedUrl)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const imageSnapshots = snapshots.filter(snapshot => snapshot.archiveFormat === 'image' && Boolean(snapshot.imageDataUrl))
    const legacySnapshots = snapshots.filter(snapshot => snapshot.archiveFormat !== 'image')
    const latest = imageSnapshots[0] || legacySnapshots[0]
    const run = archiveRuns.value[key]
    const availableIds = new Set(imageSnapshots.map(snapshot => snapshot.id))
    const capturedCount = run
      ? run.evidenceIds.filter(id => availableIds.has(id)).length
      : imageSnapshots.length
    const detectedCount = run?.detectedCommentCount ?? Math.max(0, record.commentCount)
    const missingCount = Math.max(0, detectedCount - capturedCount)
    const status: ArchiveRow['status'] = run
      ? run.status === 'failed' && capturedCount === 0
        ? 'failed'
        : missingCount === 0 && run.failedCount === 0 ? 'complete' : 'incomplete'
      : 'unscanned'
    return {
      key,
      record,
      snapshots,
      imageSnapshots,
      legacySnapshots,
      latest,
      run,
      detectedCount,
      capturedCount,
      missingCount,
      status,
    }
  })
  .sort((a, b) => (b.latest?.createdAt || b.record.checkTime)
    .localeCompare(a.latest?.createdAt || a.record.checkTime)))

const archiveSupportedCount = computed(() => archiveRows.value
  .filter(row => !isThirdPartyPlatform(row.record.platform) && !isInvalidRecord(row.record)).length)
const archivePlatformOptions = computed(() => platformOptionsFor(archiveRows.value.map(row => row.record)))
const filteredArchiveRows = computed(() => archivePlatformFilter.value === 'all'
  ? archiveRows.value
  : archiveRows.value.filter(row => row.record.platform === archivePlatformFilter.value))
const archiveCompleteCount = computed(() => archiveRows.value.filter(row => row.status === 'complete').length)
const archiveVersionCount = computed(() => archiveSnapshots.value.filter(snapshot => snapshot.archiveFormat === 'image').length)
const archiveSelectedWithSnapshot = computed(() => archiveSelectedRows.value.filter(row => row.imageSnapshots.length > 0))

const archiveTimelineBatches = computed<ArchiveImageBatch[]>(() => {
  const snapshots = archiveTimelineRow.value?.imageSnapshots || []
  const row = archiveTimelineRow.value
  if (!row) return []
  const snapshotById = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]))
  const runs = archiveRunHistory.value
    .filter(run => run.platform === row.record.platform
      && normalizeArticleUrl(run.url, run.platform) === normalizeArticleUrl(row.record.url, row.record.platform))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const referencedIds = new Set(runs.flatMap(run => run.evidenceIds))
  const batches: ArchiveImageBatch[] = runs.map((run, index) => ({
    key: run.id,
    label: `第${chineseOrdinal(index + 1)}次检测`,
    createdAt: run.createdAt,
    snapshots: run.evidenceIds
      .map(id => snapshotById.get(id))
      .filter((snapshot): snapshot is CommentEvidenceSnapshot => Boolean(snapshot)),
  }))
  const historical = snapshots.filter(snapshot => !referencedIds.has(snapshot.id))
  if (historical.length) {
    batches.unshift({
      key: 'legacy',
      label: '历史存档',
      createdAt: [...historical].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt || '',
      snapshots: [...historical].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    })
  }
  return batches.filter(batch => batch.snapshots.length > 0).reverse()
})

const warningRecords = computed(() => sortedRecords.value.filter(isWarningRecord))
const commentCandidates = computed(() => warningRecords.value)
const likeCandidates = computed(() => sortedRecords.value.filter(record =>
  !isInvalidRecord(record)
  && supportsInteraction(record.platform)
  && record.liked !== true,
))
const collectCandidates = computed(() => sortedRecords.value.filter(record =>
  !isInvalidRecord(record)
  && supportsInteraction(record.platform)
  && record.collected !== true,
))
const interactionCandidates = computed(() => sortedRecords.value.filter(record =>
  !isInvalidRecord(record)
  && supportsInteraction(record.platform)
  && (record.liked !== true || record.collected !== true),
))
const pagedSupplementResults = computed(() => {
  const start = (supplementPage.value - 1) * supplementPageSize.value
  return supplementResults.value.slice(start, start + supplementPageSize.value)
})
const pagedCommentHistory = computed(() => {
  const start = (commentHistoryPage.value - 1) * commentHistoryPageSize.value
  return commentHistory.value.slice(start, start + commentHistoryPageSize.value)
})
const failedBatchCount = computed(() => batchResults.value.filter(item => !isThirdPartyPlatform(item.platform) && Boolean(item.error)).length)
const invalidRecordCount = computed(() => records.value.filter(isInvalidRecord).length)
const supportedPlatforms: Platform[] = ['csdn', 'zhihu', 'toutiao', 'baijiahao', 'netease', 'sohu']
const commentHistoryStats = computed(() => ({
  verified: commentHistory.value.filter(item => item.verificationStatus === 'verified').length,
  pending: commentHistory.value.filter(item => item.verificationStatus === 'pending').length,
  failed: commentHistory.value.filter(item => item.verificationStatus === 'failed').length,
}))
const commentHistoryPieStyle = computed(() => {
  const total = Math.max(1, commentHistory.value.length)
  const successEnd = commentHistoryStats.value.verified / total * 100
  const pendingEnd = successEnd + commentHistoryStats.value.pending / total * 100
  return {
    background: `conic-gradient(#67c23a 0 ${successEnd}%, #e6a23c ${successEnd}% ${pendingEnd}%, #f56c6c ${pendingEnd}% 100%)`,
  }
})
const commentPlatformStats = computed(() => {
  const counts = new Map<Platform, number>()
  for (const platform of supportedPlatforms) counts.set(platform, 0)
  for (const item of commentHistory.value) {
    if (counts.has(item.platform)) counts.set(item.platform, (counts.get(item.platform) || 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  return supportedPlatforms.map(platform => ({
    platform,
    total: counts.get(platform) || 0,
    percent: Math.round(((counts.get(platform) || 0) / max) * 100),
  }))
})

function isWarningRecord(record: CommentRecord): boolean {
  return !isInvalidRecord(record)
    && !isThirdPartyPlatform(record.platform)
    && warningThreshold.value > 0
    && record.commentCount < warningThreshold.value
}

function isThirdPartyPlatform(platform: Platform): boolean {
  return platform === 'third_party'
}

function isInvalidRecord(record: CommentRecord): boolean {
  return record.linkStatus === 'invalid'
}

function isInvalidResult(result: BatchResultItem): boolean {
  return result.linkStatus === 'invalid'
}

function batchResultKey(result: Pick<BatchResultItem, 'platform' | 'url'>): string {
  return `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}`
}

function interactionTagType(value: boolean | null | undefined, platform?: Platform): 'success' | 'danger' | 'info' {
  if (platform && !supportsInteraction(platform)) return 'info'
  return value === true ? 'success' : value === false ? 'danger' : 'info'
}

function supportsInteraction(platform: Platform): boolean {
  return platform === 'csdn' || platform === 'zhihu' || platform === 'toutiao' || platform === 'baijiahao' || platform === 'sohu'
}

function interactionStatusText(
  value: boolean | null | undefined,
  action: '点赞' | '收藏',
  platform?: Platform,
): string {
  if (platform && isThirdPartyPlatform(platform)) return '等待开发'
  if (platform && !supportsInteraction(platform)) return '平台无此项'
  return value === true ? `已${action}` : value === false ? `未${action}` : '暂未识别'
}

function openUrl(url: string) {
  if (!url) return
  chrome.tabs.create({ url })
}

function supplementResultTagType(result: SupplementResult): 'success' | 'warning' | 'danger' | 'info' {
  if (result.errorCode === 'COMMENT_PENDING_CONFIRMATION') return 'warning'
  if (result.error || result.status === 'failed' || result.status === 'needs_attention') return 'danger'
  if (result.status === 'verified' || result.status === 'satisfied') return 'success'
  if (result.status === 'partial') return 'warning'
  return 'info'
}

function supplementResultText(result: SupplementResult): string {
  const codeReasons: Record<string, string> = {
    UNSUPPORTED_PAGE: '失败：当前链接不是支持的文章页面',
    PAGE_INVALID: '失败：文章已失效或被删除',
    AUTH_REQUIRED: '失败：未登录或无法识别当前账号',
    ACCOUNT_MISMATCH: '失败：当前登录账号与手动设置账号不一致',
    COMMENT_VERIFY_FAILED: '失败：已尝试发布，但重新扫描未发现新增评论',
    COMMENT_PENDING_CONFIRMATION: '已提交：平台评论列表暂未同步，请稍后重新扫描确认',
    RISK_CONTROL_BLOCKED: '已暂停：平台要求验证或提示操作频繁，请手动处理后再继续',
    TAB_TASK_FAILED: '失败：后台文章页加载或通信异常，请手动打开后重试',
  }
  if (result.errorCode && codeReasons[result.errorCode]) return codeReasons[result.errorCode]

  if (result.error) {
    const detail = result.error.toLowerCase()
    if (/401|403|unauthorized|api.?key|密钥|鉴权/.test(detail)) return '失败：大模型密钥或接口鉴权无效，请检查配置'
    if (/429|rate.?limit|too many|限流|请求过于频繁/.test(detail)) return '失败：请求过于频繁，请稍后再试'
    if (/timeout|timed out|超时/.test(detail)) return '失败：页面加载或操作超时，请手动打开后重试'
    if (/extension|service worker|插件/.test(detail)) return '失败：插件服务暂时中断，请重新加载插件后重试'
    if (/selector|element|textarea|editor|button|评论框|发布按钮|未找到|找不到/.test(detail)) return '失败：未找到页面操作控件，平台页面结构可能已变化'
    if (/network|fetch|网络/.test(detail)) return '失败：网络请求异常，请检查网络后重试'
    if (/login|auth|未登录|账号/.test(detail)) return '失败：登录状态或账号校验未通过'
    if (/comment|评论/.test(detail)) return '失败：评论生成、填写或发布未完成，请手动查看'
    return '失败：页面操作未完成，请手动查看链接并检查问题日志'
  }

  if (result.status === 'partial' && result.commentPosted && result.afterCommentCount < result.targetCommentCount) {
    return `本轮已安全发布 1 条，当前 ${result.afterCommentCount}/${result.targetCommentCount}；为降低风控，请稍后继续`
  }
  if (result.status === 'partial') {
    return '本轮操作已完成，仍有状态未确认，请重新检测后继续'
  }

  const statusText: Record<SupplementResult['status'], string> = {
    idle: '等待执行',
    satisfied: '已满足目标，无需操作',
    partial: '本轮操作已完成，仍有状态未确认',
    verified: '已完成，并通过重新扫描验证',
    failed: '失败：操作后未通过重新扫描验证',
    needs_attention: '需要处理：请检查登录账号或手动查看页面',
  }
  return statusText[result.status]
}

function needsBatchRecheck(result: BatchResultItem): boolean {
  return !isThirdPartyPlatform(result.platform) && !isInvalidResult(result) && (
    Boolean(result.error)
    || result.accountStatus !== 'logged_in'
    || (supportsInteraction(result.platform) && typeof result.liked !== 'boolean')
    || (supportsInteraction(result.platform) && typeof result.collected !== 'boolean')
  )
}

async function copyText(value: string, successMessage = '已复制') {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  ElMessage.success(successMessage)
}

function handleBatchLikeCollect() {
  const targets = selectedRecords.value.length > 0
    ? selectedRecords.value.filter(r => supportsInteraction(r.platform) && (!r.liked || !r.collected))
    : interactionCandidates.value
  if (targets.length === 0) {
    ElMessage.info(selectedRecords.value.length > 0 ? '选中的记录已全部完成点赞收藏' : '暂无可点赞收藏的记录')
    return
  }
  pushLog({ level: 'info', action: '一键点赞+收藏', message: `开始为 ${targets.length} 条链接批量补齐点赞与收藏` })
  startSupplement(targets, { comment: false, like: true, collect: true, screenshot: false })
}

function handleBatchComment() {
  const targets = selectedRecords.value.length > 0
    ? selectedRecords.value.filter(r => !isInvalidRecord(r))
    : commentCandidates.value
  if (targets.length === 0) {
    ElMessage.info(selectedRecords.value.length > 0 ? '选中的记录无有效发评目标' : '暂无缺评论记录')
    return
  }
  pushLog({
    level: 'info',
    action: '一键评论',
    message: `开始为 ${targets.length} 条链接补发评论（模式：${commentMode.value === 'ai' ? 'AI 评论' : '无 Key 模板'}）`,
  })
  startSupplement(targets, { comment: true, like: false, collect: false, screenshot: false })
}

function handleBatchPipeline() {
  const targets = selectedRecords.value.length > 0
    ? selectedRecords.value.filter(r => !isInvalidRecord(r))
    : pipelineCandidates.value
  if (targets.length === 0) {
    ElMessage.info(selectedRecords.value.length > 0 ? '选中的记录无有效流水线目标' : '暂无可执行流水线的记录')
    return
  }
  pushLog({ level: 'info', action: '全自动流水线', message: `开始对 ${targets.length} 条链接执行点赞+收藏+评论流水线` })
  startSupplement(targets, { comment: true, like: true, collect: true, screenshot: false })
}

function singleLikeCollect(record: CommentRecord) {
  if (!supportsInteraction(record.platform)) {
    ElMessage.warning('该平台不支持点赞收藏操作')
    return
  }
  startSupplement([record], { comment: false, like: true, collect: true, screenshot: false })
}

function singleComment(record: CommentRecord) {
  startSupplement([record], { comment: true, like: false, collect: false, screenshot: false })
}
async function handleRecordCommand(command: string, record: CommentRecord) {
  if (command === 'comment') startSupplement([record], { comment: true, like: false, collect: false })
  else if (command === 'like' || command === 'collect' || command === 'interaction') startSupplement([record], { comment: false, like: true, collect: true })
  else if (command === 'copy') copyText(record.url, '链接已复制')
  else if (command === 'delete') await removeRecord(record)
}

async function removeRecord(record: CommentRecord) {
  try {
    await ElMessageBox.confirm(
      `只删除“${record.title || record.url}”的扫描记录，不会删除评论历史。`,
      '确认删除此记录？',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  const normalizedUrl = normalizeArticleUrl(record.url, record.platform)
  try {
    await deleteRecord(record.platform, record.url)
    const sameRecord = (item: { platform: Platform; url: string }) => (
      item.platform === record.platform
      && normalizeArticleUrl(item.url, item.platform) === normalizedUrl
    )
    records.value = records.value.filter(item => !sameRecord(item))
    batchResults.value = batchResults.value.filter(item => !sameRecord(item))
    supplementResults.value = supplementResults.value.filter(item => !sameRecord(item))
    await chrome.storage.local.set({ lastSupplementResults: supplementResults.value.slice(-200) })
    ElMessage.success('该条扫描记录已删除')
    auditUserAction('delete-scan-record', { platform: record.platform, url: normalizedUrl })
  } catch (error) {
    ElMessage.error(`删除失败：${String((error as Error)?.message || error)}`)
  }
}

function handleRecordExportCommand(command: string) {
  if (command === 'all') exportRecords()
  else if (command === 'warning') exportWarningRecords()
}

async function clientCommand<T = any>(command: string, payload: unknown = {}): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: 'CLIENT_COMMAND', command, payload })
  if (!response?.success) throw new Error(response?.error || '智能功能执行失败')
  return response.data as T
}

function auditUserAction(action: string, details: Record<string, unknown> = {}) {
  clientCommand('APPEND_LOG', {
    channel: 'operation',
    entry: { stage: 'user-action', action, ...details, message: `用户操作：${action}` },
  }).catch(() => {})
}

async function checkClient(showMessage = true) {
  try {
    clientInfo.value = await clientCommand('HELLO')
    logDirectory.value = String(clientInfo.value.logDir || '')
    clientConnected.value = true
    clientError.value = ''
    const config = await clientCommand<any>('GET_AI_CONFIG')
    const provider = (config.provider || aiProviderOptions.find(item => item.endpoint === config.endpoint)?.id || 'custom') as AiProviderId
    const preset = aiProviderOptions.find(item => item.id === provider)
    aiConfig.value = {
      provider, apiType: config.apiType || preset?.apiType || 'chat', endpoint: config.endpoint || preset?.endpoint || '', apiKey: '',
      model: config.model || preset?.model || '', rememberKey: config.rememberKey !== false,
      hasApiKey: Boolean(config.hasApiKey),
    }
    aiProxyConfigLoaded.value = provider.startsWith('aiproxy_') && Boolean(config.hasApiKey)
    editingApiKey.value = false
    if (showMessage) ElMessage.success('智能功能已就绪')
  } catch (error) {
    clientConnected.value = false
    clientInfo.value = {}
    logDirectory.value = ''
    const detail = String((error as Error)?.message || error)
    clientError.value = detail
    if (showMessage) ElMessage.warning(clientError.value)
  }
}

function applyAiProvider(providerId: AiProviderId) {
  const provider = aiProviderOptions.find(item => item.id === providerId)
  aiTestMessage.value = ''
  if (!provider) return
  aiConfig.value.apiKey = ''
  aiConfig.value.hasApiKey = false
  editingApiKey.value = true
  availableAiModels.value = []
  aiProxyConfigLoaded.value = false
  if (provider.id === 'aiproxy_claude' || provider.id === 'aiproxy_codex') {
    aiConfig.value.apiType = provider.apiType
    aiConfig.value.endpoint = ''
    aiConfig.value.model = ''
    aiConfig.value.rememberKey = false
    editingApiKey.value = false
    return
  }
  if (provider.id === 'custom') {
    aiConfig.value.apiType = 'chat'
    aiConfig.value.endpoint = ''
    aiConfig.value.model = ''
    return
  }
  aiConfig.value.apiType = provider.apiType
  aiConfig.value.endpoint = provider.endpoint
  aiConfig.value.model = provider.model
}

async function importAiProxyFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  aiProxyImporting.value = true
  aiTestMessage.value = ''
  try {
    const result = await clientCommand<{ models: string[]; endpoint: string; apiType: string; hasApiKey: boolean; model?: string }>('IMPORT_AIPROXY_CONFIG', {
      provider: aiConfig.value.provider,
      fileName: file.name,
      content: await file.text(),
    })
    availableAiModels.value = result.models
    aiConfig.value.endpoint = result.endpoint
    aiConfig.value.apiType = result.apiType
    aiConfig.value.hasApiKey = result.hasApiKey
    aiConfig.value.model = result.model || (result.models.length === 1 ? result.models[0] : '')
    aiProxyConfigLoaded.value = true
    aiTestSucceeded.value = true
    aiTestMessage.value = `AIProxy 已加载，共发现 ${result.models.length} 个可用模型${aiConfig.value.model ? `，已选择 ${aiConfig.value.model}` : '，请选择模型'}`
    ElMessage.success(aiTestMessage.value)
  } catch (error) {
    aiProxyConfigLoaded.value = false
    aiTestSucceeded.value = false
    aiTestMessage.value = `AIProxy 配置加载失败：${String((error as Error)?.message || error)}`
    ElMessage.error(aiTestMessage.value)
  } finally {
    input.value = ''
    aiProxyImporting.value = false
  }
}

function handleCustomEndpointInput() {
  availableAiModels.value = []
  aiConfig.value.model = ''
  aiTestMessage.value = ''
}

function handleApiKeyInput() {
  if (aiConfig.value.apiType !== 'chat') return
  availableAiModels.value = []
  aiTestMessage.value = ''
}

async function fetchAiModels() {
  aiModelsLoading.value = true
  aiTestMessage.value = ''
  try {
    const result = await clientCommand<{ models: string[]; endpoint: string; apiType?: string }>('FETCH_AI_MODELS', aiConfig.value)
    availableAiModels.value = result.models
    aiConfig.value.endpoint = result.endpoint
    if (result.apiType) aiConfig.value.apiType = result.apiType
    if (!result.models.includes(aiConfig.value.model)) aiConfig.value.model = result.models.length === 1 ? result.models[0] : ''
    aiTestSucceeded.value = true
    aiTestMessage.value = `已获取 ${result.models.length} 个模型${aiConfig.value.model ? `，已自动选择 ${aiConfig.value.model}` : '，请选择要使用的模型'}`
    ElMessage.success(aiTestMessage.value)
  } catch (error) {
    aiTestSucceeded.value = false
    aiTestMessage.value = `获取模型失败：${String((error as Error)?.message || error)}`
    ElMessage.error(aiTestMessage.value)
  } finally {
    aiModelsLoading.value = false
  }
}

function autoFetchAiModels() {
  if (aiConfig.value.apiType !== 'chat' || aiModelsLoading.value || availableAiModels.value.length) return
  if (!aiConfig.value.endpoint.trim() || (!aiConfig.value.hasApiKey && !aiConfig.value.apiKey.trim())) return
  void fetchAiModels()
}

function cancelEditApiKey() {
  aiConfig.value.apiKey = ''
  editingApiKey.value = false
}

async function saveAiConfig() {
  aiSaving.value = true
  aiTestMessage.value = ''
  try {
    if (aiConfig.value.provider !== 'custom') {
      const preset = aiProviderOptions.find(item => item.id === aiConfig.value.provider)
      if (preset) {
        if (!aiConfig.value.endpoint.trim()) aiConfig.value.endpoint = preset.endpoint
        if (!aiConfig.value.model.trim()) aiConfig.value.model = preset.model
        aiConfig.value.apiType = preset.apiType
      }
    }
    const saved = await clientCommand<any>('SAVE_AI_CONFIG', aiConfig.value)
    aiConfig.value.apiKey = ''
    aiConfig.value.hasApiKey = Boolean(saved.hasApiKey)
    editingApiKey.value = false
    ElMessage.success(aiConfig.value.hasApiKey ? '配置已保存，API Key 状态：已填写' : '大模型配置已保存')
  } catch (error) {
    ElMessage.error(String((error as Error)?.message || error))
  } finally {
    aiSaving.value = false
  }
}

async function testAiConfig() {
  aiTesting.value = true
  aiTestMessage.value = ''
  try {
    const result = await clientCommand<any>('TEST_AI_CONNECTION', aiConfig.value)
    aiConfig.value.apiKey = ''
    aiTestSucceeded.value = true
    aiTestMessage.value = `${result.message}；测试内容：${result.sample}`
    ElMessage.success(result.message)
    await checkClient(false)
  } catch (error) {
    aiTestSucceeded.value = false
    aiTestMessage.value = `AI 连接失败：${String((error as Error)?.message || error)}`
    ElMessage.error(aiTestMessage.value)
  } finally {
    aiTesting.value = false
  }
}

async function loadManualTemplates() {
  const stored = await chrome.storage.local.get(COMMENT_TEMPLATES_KEY)
  const hasSavedTemplates = Object.prototype.hasOwnProperty.call(stored, COMMENT_TEMPLATES_KEY)
  const templates = hasSavedTemplates && Array.isArray(stored[COMMENT_TEMPLATES_KEY])
    ? stored[COMMENT_TEMPLATES_KEY].map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 500)
    : hasSavedTemplates ? [] : DEFAULT_COMMENT_TEMPLATES
  if (!hasSavedTemplates) await chrome.storage.local.set({ [COMMENT_TEMPLATES_KEY]: templates })
  manualTemplateText.value = templates.join(';\n')
}

async function loadCommentPreferences() {
  const stored = await chrome.storage.local.get([COMMENT_MODE_KEY, COMMENT_TEMPLATE_SELECTION_KEY])
  if (stored[COMMENT_MODE_KEY] === 'ai' || stored[COMMENT_MODE_KEY] === 'template') {
    commentMode.value = stored[COMMENT_MODE_KEY]
    commentModeConfigured.value = true
  }
  manualTemplateSelection.value = stored[COMMENT_TEMPLATE_SELECTION_KEY] === 'random' ? 'random' : 'sequential'
}

async function saveCommentPreferences() {
  await chrome.storage.local.set({
    [COMMENT_MODE_KEY]: commentMode.value,
    [COMMENT_TEMPLATE_SELECTION_KEY]: manualTemplateSelection.value,
  })
  commentModeConfigured.value = true
  const modeText = commentMode.value === 'ai'
    ? 'AI 评论'
    : `无 Key 模板（${manualTemplateSelection.value === 'random' ? '随机抽取' : '按顺序'}）`
  ElMessage.success(`评论模式已切换为：${modeText}`)
  pushLog({
    level: "info",
    action: "系统设置",
    message: "评论模式已切换为: " + modeText,
  })
  auditUserAction('save-comment-mode', {
    mode: commentMode.value,
    selection: manualTemplateSelection.value,
  })
}

async function saveManualTemplates() {
  await chrome.storage.local.set({ [COMMENT_TEMPLATES_KEY]: manualTemplates.value })
  manualTemplateText.value = manualTemplates.value.join(';\n')
  ElMessage.success(`已保存 ${manualTemplates.value.length} 条评论模板`)
  auditUserAction('save-comment-templates', { count: manualTemplates.value.length })
}

function validateBackupPassword(): boolean {
  if (backupPassword.value.length >= 8) return true
  ElMessage.warning('备份密码至少需要 8 位')
  return false
}

async function exportConfigBackup() {
  if (!validateBackupPassword() || configExporting.value) return
  configExporting.value = true
  try {
    const result = await clientCommand<any>('EXPORT_CONFIG_BACKUP', {
      password: backupPassword.value,
      extensionSettings: {
        usernames: { ...usernames.value },
        warningThreshold: warningThreshold.value,
        manualCommentTemplates: manualTemplates.value,
        commentGenerationMode: commentMode.value,
        manualTemplateSelection: manualTemplateSelection.value,
      },
    })
    const blob = new Blob([String(result.content || '')], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.fileName || `DL评论助手配置_${new Date().toISOString().slice(0, 10)}.dlconfig`
    anchor.click()
    URL.revokeObjectURL(url)
    pushLog({ level: 'success', action: '配置备份', message: '已加密导出配置备份（账号、大模型、模板与警戒线）' })
    ElMessage.success('配置已加密导出，请妥善保管备份密码')
  } catch (error) {
    pushLog({ level: 'error', action: '配置备份', message: `配置导出失败：${String((error as Error)?.message || error)}` })
    ElMessage.error(`配置导出失败：${String((error as Error)?.message || error)}`)
  } finally {
    configExporting.value = false
  }
}

function openConfigImport() {
  if (!validateBackupPassword() || configImporting.value) return
  configImportInput.value?.click()
}

async function importConfigBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !validateBackupPassword()) return
  configImporting.value = true
  try {
    const result = await clientCommand<any>('IMPORT_CONFIG_BACKUP', {
      password: backupPassword.value,
      content: await file.text(),
    })
    const settings = result.extensionSettings && typeof result.extensionSettings === 'object'
      ? result.extensionSettings as Record<string, any>
      : {}
    if (settings.usernames && typeof settings.usernames === 'object') {
      usernames.value = { ...DEFAULT_USERNAMES, ...settings.usernames }
      await chrome.storage.sync.set({ usernames: usernames.value })
    }
    const importedThreshold = Number(settings.warningThreshold)
    if (Number.isFinite(importedThreshold)) await saveWarningThreshold(importedThreshold)
    if (Array.isArray(settings.manualCommentTemplates)) {
      manualTemplateText.value = settings.manualCommentTemplates.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 500).join(';\n')
      await saveManualTemplates()
    }
    if (settings.commentGenerationMode === 'ai' || settings.commentGenerationMode === 'template') {
      commentMode.value = settings.commentGenerationMode
    }
    if (settings.manualTemplateSelection === 'sequential' || settings.manualTemplateSelection === 'random') {
      manualTemplateSelection.value = settings.manualTemplateSelection
    }
    await chrome.storage.local.set({
      [COMMENT_MODE_KEY]: commentMode.value,
      [COMMENT_TEMPLATE_SELECTION_KEY]: manualTemplateSelection.value,
    })
    commentModeConfigured.value = true
    await checkClient(false)
    pushLog({ level: 'success', action: '配置恢复', message: '已从加密备份恢复账号、大模型配置、模板与警戒线' })
    ElMessage.success('配置已恢复，账号、Key、模板和警戒线已同步')
  } catch (error) {
    pushLog({ level: 'error', action: '配置恢复', message: `配置导入失败：${String((error as Error)?.message || error)}` })
    ElMessage.error(`配置导入失败：${String((error as Error)?.message || error)}`)
  } finally {
    configImporting.value = false
  }
}

function upsertSupplementResult(result: SupplementResult) {
  const key = supplementResultKey(result)
  const index = supplementResults.value.findIndex(item => supplementResultKey(item) === key)
  if (index >= 0) supplementResults.value[index] = { ...supplementResults.value[index], ...result }
  else supplementResults.value.push(result)
  chrome.storage.local.set({ lastSupplementResults: supplementResults.value.slice(-200) }).catch(() => {})
}

function supplementActionText(result: SupplementResult): string {
  if (result.requestedActions?.comment) return '评论'
  if (result.requestedActions?.like) return '点赞'
  if (result.requestedActions?.collect) return '收藏'
  return '互动'
}

function supplementResultKey(result: SupplementResult): string {
  return `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${supplementActionText(result)}`
}

function startNextCommentRound() {
  startSupplement(commentCandidates.value, { comment: true, like: false, collect: false })
}

function stopSupplementProgressTimer() {
  if (supplementProgressTimer != null) {
    window.clearInterval(supplementProgressTimer)
    supplementProgressTimer = undefined
  }
}

function startSupplementProgressTimer(etaSeconds = 0) {
  stopSupplementProgressTimer()
  supplementStepStartedAt = Date.now()
  supplementCountdownDeadline = etaSeconds > 0 ? Date.now() + etaSeconds * 1000 : 0
  supplementStepElapsedSeconds.value = 0
  supplementCountdownSeconds.value = Math.max(0, Math.ceil(etaSeconds))
  supplementProgressTimer = window.setInterval(() => {
    supplementStepElapsedSeconds.value = Math.max(0, Math.floor((Date.now() - supplementStepStartedAt) / 1000))
    supplementCountdownSeconds.value = supplementCountdownDeadline > 0
      ? Math.max(0, Math.ceil((supplementCountdownDeadline - Date.now()) / 1000))
      : 0
  }, 1000)
}

async function startSupplement(
  selected: CommentRecord[],
  actions: SupplementActions = { comment: true, like: true, collect: true },
) {
  if (supplementRunning.value) return
  auditUserAction('supplement-start-attempt', {
    count: selected.length,
    actions,
    commentMode: actions.comment ? commentMode.value : undefined,
  })
  if (!selected.length) {
    ElMessage.warning('当前没有需要处理的链接')
    return
  }
  if (actions.comment && commentMode.value === 'ai' && (!clientConnected.value || !aiConfig.value.hasApiKey)) {
    // Service Worker 重载后页面中的连接状态可能暂时过期。用户点击时主动重读一次，
    // 不能仅凭旧状态把主按钮永久禁用。
    await checkClient(false)
    if (!clientConnected.value || !aiConfig.value.hasApiKey) {
      // activeTab 保持在有效视图，不切换至已废弃的 supplement
      ElMessage.warning(clientConnected.value
        ? '当前选择的是 AI 评论模式，但尚未保存 API Key；也可以切换到“无 Key 模板”后直接补齐'
        : '智能功能状态暂未恢复，请重新加载插件；也可以切换到“无 Key 模板”后直接补齐')
      return
    }
  }
  if (actions.comment && commentMode.value === 'template' && manualTemplates.value.length === 0) {
    // activeTab 保持在有效视图，不切换至已废弃的 supplement
    ElMessage.warning('当前选择的是无 Key 模板模式，请先填写并保存至少 1 条评论')
    return
  }
  if (actions.comment && warningThreshold.value < 1) {
    ElMessage.warning('智能补齐的目标评论数至少为 1')
    return
  }

  supplementRunning.value = true
  const actionLabel = actions.screenshot
    ? '全自动一键流水线'
    : actions.comment
      ? '一键补齐评论'
      : '一键点赞+收藏'
  pushLog({
    level: 'info',
    action: actionLabel,
    message: `启动任务共 ${selected.length} 条文章链接`,
  })
  if (actions.comment) {
    commentRound.value += 1
    chrome.storage.local.set({ manualCommentRound: commentRound.value }).catch(() => {})
  }
  supplementTaskLabel.value = actions.comment
    ? `${commentMode.value === 'ai' ? 'AI 评论' : manualTemplateSelection.value === 'random' ? '模板随机评论' : '模板顺序评论'} · 第 ${commentRound.value} 轮`
    : '批量点赞 + 收藏'
  // activeTab 保持在有效视图，不切换至已废弃的 supplement
  ElMessage.info(`${supplementTaskLabel.value}已启动，共 ${selected.length} 条；页面会逐条显示结果`)
  auditUserAction('supplement-task-click', {
    task: supplementTaskLabel.value,
    count: selected.length,
    ...(actions.comment ? { commentMode: commentMode.value, templateSelection: manualTemplateSelection.value } : {}),
  })
  supplementStopping.value = false
  supplementProgress.value = {
    completed: 0, pending: selected.length, current: selected.length > 0 ? 1 : 0,
    total: selected.length, percent: 0, stagePercent: 0,
    url: '', platform: '', status: '正在准备任务',
  }
  startSupplementProgressTimer(12)
  activeSupplementPort = chrome.runtime.connect({ name: 'supplement-tasks' })
  activeSupplementPort.onMessage.addListener(async (message) => {
    if (message.type === 'SUPPLEMENT_CLIENT_REQUIRED') {
      clientConnected.value = false
      supplementRunning.value = false
      stopSupplementProgressTimer()
      ElMessage.error(message.error || '智能功能暂不可用')
    } else if (message.type === 'SUPPLEMENT_PREPARED') {
      supplementProgress.value.total = Number(message.total) || selected.length
      supplementProgress.value.pending = Number(message.total) || selected.length
    } else if (message.type === 'SUPPLEMENT_PROGRESS') {
      supplementProgress.value = {
        completed: message.completed ?? 0,
        pending: message.pending ?? 0,
        current: message.current ?? Math.min((message.completed ?? 0) + 1, message.total || selected.length),
        total: message.total || selected.length,
        percent: message.percent ?? supplementProgress.value.percent,
        stagePercent: message.stagePercent ?? 0,
        url: message.url || '',
        platform: message.platform || '',
        status: message.status || '',
      }
      startSupplementProgressTimer(Number(message.etaSeconds) || 0)
    } else if (message.type === 'SUPPLEMENT_RISK_PAUSED') {
      supplementProgress.value.status = '检测到平台风控，已停止后续任务'
      stopSupplementProgressTimer()
      ElMessage.warning('检测到验证码、操作频繁或安全验证，后续任务已暂停')
    } else if (message.type === 'SUPPLEMENT_ITEM_COMPLETE') {
      const res = message.result
      if (res) {
        const isSuccess = !res.errorCode && (res.commentPosted || res.likePerformed || res.collectPerformed || res.status === 'verified')
        const actionDesc = supplementActionText(res)
        pushLog({
          level: res.errorCode ? 'error' : isSuccess ? 'success' : 'warning',
          platform: res.platform,
          url: res.url,
          action: actionDesc,
          message: res.error || (isSuccess ? `${actionDesc}成功` : '操作已确认，无新增修改'),
          detail: res.errorCode ? `[${res.errorCode}]` : undefined,
        })
      }
      upsertSupplementResult(message.result)
      supplementProgress.value.completed = message.completed ?? supplementProgress.value.completed
      supplementProgress.value.current = message.current ?? supplementProgress.value.completed
      supplementProgress.value.total = message.total || supplementProgress.value.total
      supplementProgress.value.percent = message.percent ?? supplementProgress.value.percent
      supplementProgress.value.stagePercent = 100
      supplementCountdownSeconds.value = 0
      await loadDashboardData()
    } else if (message.type === 'SUPPLEMENT_COMPLETE' || message.type === 'SUPPLEMENT_CANCELLED') {
      if (message.type === 'SUPPLEMENT_COMPLETE') supplementProgress.value.percent = 100
      supplementRunning.value = false
      supplementStopping.value = false
      supplementProgress.value.pending = 0
      supplementProgress.value.status = message.type === 'SUPPLEMENT_COMPLETE'
        ? `连续补齐已完成：共执行 ${supplementProgress.value.completed} 次操作`
        : '任务已停止，已完成结果已保留'
      stopSupplementProgressTimer()
      if (message.type === 'SUPPLEMENT_COMPLETE') ElMessage.success('连续补齐已结束，所有文章均已处理到目标值或需要人工确认')
      else ElMessage.warning('智能补齐任务已停止，已完成结果已保留')
      activeSupplementPort?.disconnect()
      activeSupplementPort = null
      await Promise.all([loadDashboardData(),
    loadPersistedLogs(), loadCommentHistory()])
    }
  })
  activeSupplementPort.onDisconnect.addListener(() => {
    if (supplementRunning.value && !supplementStopping.value) ElMessage.warning('智能补齐任务连接已中断')
    supplementRunning.value = false
    supplementStopping.value = false
    stopSupplementProgressTimer()
    activeSupplementPort = null
  })
  activeSupplementPort.postMessage({
    type: 'SUPPLEMENT_START',
    items: selected.map(record => ({
      url: record.url, platform: record.platform, targetCommentCount: warningThreshold.value,
      currentCommentCount: record.commentCount,
      actions,
    })),
  })
}

function stopSupplement() {
  if (!activeSupplementPort || !supplementRunning.value) return
  supplementStopping.value = true
  supplementProgress.value.status = '正在安全停止，当前页面操作结束后退出'
  activeSupplementPort.postMessage({ type: 'SUPPLEMENT_CANCEL' })
}

function openManual(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function loadClientLogs() {
  if (!clientConnected.value) return
  logsLoading.value = true
  try {
    const [operations, errors] = await Promise.all([
      clientCommand<any>('LIST_LOGS', { channel: 'operation', limit: 500 }),
      clientCommand<any>('LIST_LOGS', { channel: 'error', limit: 500 }),
    ])
    operationLogs.value = operations.logs || []
    errorLogs.value = errors.logs || []
  } catch (error) {
    ElMessage.error(String((error as Error)?.message || error))
  } finally {
    logsLoading.value = false
  }
}

async function openLogDirectory() {
  ElMessage.info('纯插件模式没有本地日志目录，请使用“导出日志”保存日志文件')
}

async function exportClientLogs() {
  try {
    await clientCommand('APPEND_LOG', {
      channel: 'operation',
      entry: { stage: 'user-action', action: 'export-diagnostic-logs', message: '用户导出诊断日志' },
    })
    const result = await clientCommand<any>('EXPORT_LOGS')
    const blob = new Blob([String(result.content || '')], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.fileName || `DL评论助手日志_${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    exportedLogPath.value = `已下载：${anchor.download}`
    ElMessage.success('插件日志已导出')
  } catch (error) { ElMessage.error(String(error)) }
}

async function clearClientLogs() {
  try {
    await ElMessageBox.confirm('确定清空操作日志和问题日志吗？', '清空日志', { type: 'warning' })
    await clientCommand('CLEAR_LOGS', { channel: 'all' })
    operationLogs.value = []
    errorLogs.value = []
    ElMessage.success('日志已清空')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(String(error))
  }
}

function hasManualReview(result: BatchResultItem): boolean {
  return Boolean(manualReviewStates.value[batchResultKey(result)])
}

async function openManualReview(result: BatchResultItem) {
  try {
    const tab = await chrome.tabs.create({
      url: normalizeArticleUrl(result.url, result.platform),
      active: true,
    })
    if (tab.id == null) throw new Error('无法创建文章标签页')
    const key = batchResultKey(result)
    manualReviewStates.value = {
      ...manualReviewStates.value,
      [key]: { tabId: tab.id, openedAt: Date.now() },
    }
  } catch (error) {
    ElMessage.error(`无法打开文章：${String(error)}`)
  }
}

function withManualTimeout<T>(promise: Promise<T>, timeoutMs = 65000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('等待页面扫描超时')), timeoutMs)
    promise.then(
      value => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      error => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function applyManualScanResult(original: BatchResultItem, result: ScanResponse) {
  const key = batchResultKey(original)
  const index = batchResults.value.findIndex(item => batchResultKey(item) === key)
  if (index < 0) return
  batchResults.value[index] = {
    platform: result.platform,
    url: normalizeArticleUrl(result.url, result.platform),
    title: result.title,
    commentCount: result.commentCount,
    linkStatus: result.linkStatus || 'active',
    username: result.username,
    accountStatus: result.accountStatus,
    liked: result.liked,
    collected: result.collected,
  }
}

function applyManualRecord(original: BatchResultItem, record: CommentRecord) {
  const key = batchResultKey(original)
  const index = batchResults.value.findIndex(item => batchResultKey(item) === key)
  if (index < 0) return
  batchResults.value[index] = {
    platform: record.platform,
    url: normalizeArticleUrl(record.url, record.platform),
    title: record.title,
    commentCount: record.commentCount,
    linkStatus: record.linkStatus || 'active',
    username: record.username,
    liked: record.liked,
    collected: record.collected,
  }
}

async function findFreshManualRecord(result: BatchResultItem): Promise<CommentRecord | null> {
  const state = manualReviewStates.value[batchResultKey(result)]
  if (!state) return null
  const targetKey = batchResultKey(result)
  const allRecords = await getAllRecords()
  return allRecords.find(record =>
    batchResultKey(record) === targetKey
    && new Date(record.checkTime).getTime() >= state.openedAt - 1000,
  ) || null
}

async function updateManualReviewResult(original: BatchResultItem) {
  const key = batchResultKey(original)
  const state = manualReviewStates.value[key]
  if (!state || manualUpdatingKey.value) return
  manualUpdatingKey.value = key

  let scanResult: ScanResponse | null = null
  try {
    const tab = await chrome.tabs.get(state.tabId)
    const currentUrl = tab.url || ''
    if (!currentUrl || batchResultKey({ platform: original.platform, url: currentUrl }) !== key) {
      throw new Error('手动查看标签页已经离开原文章')
    }

    const cached = await withManualTimeout(
      chrome.tabs.sendMessage(state.tabId, { type: 'GET_CURRENT_RESULT' }),
    ) as ScanResponse | null
    if (cached?.type === 'SCAN_RESULT' && batchResultKey(cached) === key) {
      scanResult = cached
    } else {
      const rescanned = await withManualTimeout(
        chrome.tabs.sendMessage(state.tabId, {
          type: 'SCAN_PAGE',
          platform: original.platform,
          url: original.url,
        }),
      ) as ScanResponse | null
      if (rescanned?.type === 'SCAN_RESULT' && batchResultKey(rescanned) === key) {
        scanResult = rescanned
      }
    }
  } catch {
    // 标签页被关闭、仍在加载或消息失败时，下面只接受手动打开之后写入的新记录。
  }

  try {
    if (scanResult) {
      applyManualScanResult(original, scanResult)
      await loadDashboardData()
      if (scanResult.linkStatus === 'invalid') ElMessage.warning('已更新：该链接已失效（404）')
      else ElMessage.success(`已更新：${scanResult.commentCount} 条评论`)
      return
    }

    const freshRecord = await findFreshManualRecord(original)
    if (freshRecord) {
      applyManualRecord(original, freshRecord)
      await loadDashboardData()
      if (freshRecord.linkStatus === 'invalid') ElMessage.warning('已更新：该链接已失效（404）')
      else ElMessage.success(`已更新：${freshRecord.commentCount} 条评论`)
      return
    }

    ElMessage.warning('尚未获得最新结果，请在手动打开的页面等待评论区加载完成后再点击“更新结果”')
  } finally {
    manualUpdatingKey.value = ''
  }
}

async function recheckBatchResult(original: BatchResultItem) {
  if (batchRunning.value || batchRecheckKey.value) return
  const key = batchResultKey(original)
  batchRecheckKey.value = key
  auditUserAction('batch-item-recheck', { platform: original.platform, url: original.url })
  try {
    const [result] = await requestBatchScan([original.url])
    if (!result) throw new Error('未返回检测结果')
    upsertBatchResult(result)
    await loadDashboardData()
    const isErr = Boolean(result.error)
    const isInv = isInvalidResult(result)
    const detail = isErr ? result.error : isInv ? "页面404失效" : ("评论: " + result.commentCount + "条, 点赞: " + (result.liked ? "已赞" : "未赞") + ", 收藏: " + (result.collected ? "已藏" : "未藏"))
    pushLog({
      level: isErr ? "error" : isInv ? "warning" : "success",
      platform: result.platform,
      url: result.url,
      action: "单个重测",
      message: isErr ? ("检测异常: " + result.error) : isInv ? "链接已失效(404)" : ("检测完成: 发现 " + result.commentCount + " 条评论"),
      detail,
      diagnostics: result.diagnostics,
    })
    if (result.error) ElMessage.warning(`重新检测仍未完成：${result.error}`)
    else if (result.accountStatus === 'auth_required') ElMessage.warning('重新检测完成：当前账号未登录')
    else if (result.accountStatus === 'account_mismatch') ElMessage.warning('重新检测完成：登录账号与设置账号不一致')
    else ElMessage.success('重新检测完成，评论、点赞和收藏状态已更新')
  } catch (error) {
    ElMessage.error(`重新检测失败：${String((error as Error)?.message || error)}`)
  } finally {
    batchRecheckKey.value = ''
  }
}

function recordRowClassName({ row }: { row: CommentRecord }): string {
  if (isInvalidRecord(row)) return 'invalid-record-row'
  return isWarningRecord(row) ? 'warning-record-row' : ''
}

function batchRowClassName({ row }: { row: BatchResultItem }): string {
  return isInvalidResult(row) ? 'invalid-record-row' : ''
}

async function loadWarningThreshold() {
  const data = await chrome.storage.sync.get('warningThreshold')
  const value = Number(data.warningThreshold)
  if (Number.isFinite(value) && value >= 0) {
    warningThreshold.value = Math.min(999, Math.floor(value))
  }
}

async function saveWarningThreshold(value: number | undefined) {
  const normalized = Number.isFinite(value)
    ? Math.max(0, Math.min(999, Math.floor(value as number)))
    : 3
  warningThreshold.value = normalized
  await chrome.storage.sync.set({ warningThreshold: normalized })
  auditUserAction('save-warning-threshold', { value: normalized })
  ElMessage.success(normalized === 0 ? '评论数警告已关闭' : `已设置：低于 ${normalized} 条时标红`)
}

async function loadAccountLogs() {
  const data = await chrome.storage.local.get(ACCOUNT_LOG_KEY)
  accountLogs.value = Array.isArray(data[ACCOUNT_LOG_KEY]) ? data[ACCOUNT_LOG_KEY] : []
}

async function loadAccountSettings() {
  const data = await chrome.storage.sync.get('usernames')
  if (data.usernames) usernames.value = { ...DEFAULT_USERNAMES, ...data.usernames }
  await loadAccountLogs()
}

async function saveAccountSettings() {
  const normalized = Object.fromEntries(
    Object.entries(usernames.value).map(([platform, name]) => [platform, name.trim()]),
  ) as unknown as PlatformUsernames
  usernames.value = normalized
  await chrome.storage.sync.set({ usernames: normalized })
  auditUserAction('save-account-settings', { platforms: Object.keys(normalized) })
  ElMessage.success('六个平台账号设置已保存，后续扫描优先使用手动账号')
}

async function clearAccountLogs() {
  await chrome.storage.local.remove(ACCOUNT_LOG_KEY)
  accountLogs.value = []
  auditUserAction('clear-account-logs')
  ElMessage.success('账号检测日志已清空')
}

function platName(p: string): string {
  if (p === 'third_party') return '第三方平台'
  return PlatformLabel[p as Platform] || p
}

interface BatchProgressInfo {
  phase: 'prepared' | 'scanning' | 'completed'
  current: number
  completed: number
  total: number
  url: string
  platform?: Platform
  result?: BatchResultItem
}

function requestBatchScan(
  urls: string[],
  onProgress?: (info: BatchProgressInfo) => void,
  onCancelled?: () => void,
): Promise<BatchResultItem[]> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'batch-scan' })
    if (onCancelled) activeBatchPort = port
    let settled = false
    let completed = 0

    port.onMessage.addListener((msg) => {
      if (msg.type === 'BATCH_PREPARED') {
        onProgress?.({ phase: 'prepared', current: 0, completed: 0, total: msg.total, url: '' })
      } else if (msg.type === 'BATCH_PROGRESS') {
        onProgress?.({
          phase: 'scanning',
          current: msg.current,
          completed,
          total: msg.total,
          url: msg.url,
          platform: msg.platform,
        })
      } else if (msg.type === 'BATCH_ITEM_COMPLETE') {
        completed = Number.isFinite(msg.completed) ? msg.completed : completed + 1
        onProgress?.({
          phase: 'completed',
          current: msg.current,
          completed,
          total: msg.total,
          url: msg.url,
          result: msg.result,
        })
      } else if (msg.type === 'BATCH_COMPLETE') {
        settled = true
        if (activeBatchPort === port) activeBatchPort = null
        resolve(msg.results || [])
        port.disconnect()
      } else if (msg.type === 'BATCH_CANCELLED') {
        settled = true
        if (activeBatchPort === port) activeBatchPort = null
        onCancelled?.()
        resolve(msg.results || [])
        port.disconnect()
      }
    })
    port.onDisconnect.addListener(() => {
      if (activeBatchPort === port) activeBatchPort = null
      if (!settled) reject(new Error(chrome.runtime.lastError?.message || '批量扫描连接已断开'))
    })
    port.postMessage({ type: 'BATCH_SCAN', urls })
  })
}

function stopBatch() {
  if (!batchRunning.value || batchStopping.value) return
  batchStopping.value = true
  batchWasCancelled.value = true
  try {
    activeBatchPort?.postMessage({ type: 'BATCH_CANCEL' })
    ElMessage.info('正在停止检测；已完成的结果会保留')
  } catch {
    activeBatchPort?.disconnect()
  }
}

function upsertBatchResult(result: BatchResultItem) {
  const index = batchResults.value.findIndex(item => item.url === result.url)
  if (index >= 0) batchResults.value[index] = result
  else batchResults.value.push(result)
}

function startBatchTimer() {
  if (batchTimer != null) window.clearInterval(batchTimer)
  const startedAt = Date.now()
  batchElapsedSeconds.value = 0
  batchTimer = window.setInterval(() => {
    batchElapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 1000)
}

function stopBatchTimer() {
  if (batchTimer != null) {
    window.clearInterval(batchTimer)
    batchTimer = undefined
  }
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
}

async function startBatch(prepared: ArticleUrlClassification = batchClassification.value) {
  const thirdPartyResults: BatchResultItem[] = prepared.thirdParty.map(url => ({
    platform: 'third_party',
    url,
    title: (() => { try { return new URL(url).hostname } catch { return '第三方链接' } })(),
    commentCount: 0,
    accountStatus: 'unknown',
    error: '第三方平台（等待开发），未执行扫描',
  }))

  if (thirdPartyResults.length) {
    const checkTime = new Date().toISOString()
    await Promise.all(thirdPartyResults.map(result => saveRecord({
      platform: result.platform,
      url: result.url,
      title: result.title,
      commentCount: 0,
      checkTime,
      username: '',
      linkStatus: 'active',
      actionStatus: 'needs_attention',
      lastErrorCode: 'THIRD_PARTY_UNSUPPORTED',
    })))
  }

  if (prepared.valid.length === 0) {
    batchResults.value = thirdPartyResults
    await loadDashboardData()
    ElMessage.warning(thirdPartyResults.length
      ? `已记录 ${thirdPartyResults.length} 条第三方平台链接，当前版本等待开发，未发起扫描`
      : '没有可扫描的有效文章 URL')
    return
  }
  if (thirdPartyResults.length) {
    ElMessage.info(`${thirdPartyResults.length} 条第三方平台链接已记录汇总，其余链接继续扫描`)
  }

  batchRunning.value = true
  batchStopping.value = false
  batchWasCancelled.value = false
  batchTotal.value = prepared.valid.length
  batchCurrentIndex.value = 0
  batchCompleted.value = 0
  batchCurrentUrl.value = ''
  batchCurrentPlatform.value = ''
  batchResults.value = [...thirdPartyResults]
  manualReviewStates.value = {}
  manualUpdatingKey.value = ''
  startBatchTimer()

  pushLog({
    level: 'info',
    action: '批量检测',
    message: `开始检测 ${prepared.valid.length} 条链接（第三方待开发 ${thirdPartyResults.length} 条）`,
    detail: prepared.valid.map(item => platName(item.platform) + ' ' + item.url).join(' | ').slice(0, 1500),
  })

  try {
    const scannedResults = await requestBatchScan(
      prepared.valid.map(item => item.url),
      (info) => {
        if (info.phase === 'scanning') batchCurrentIndex.value = info.current
        batchCompleted.value = info.completed
        batchTotal.value = info.total
        if (info.phase === 'scanning' && info.url) batchCurrentUrl.value = info.url
        if (info.phase === 'scanning' && info.platform) batchCurrentPlatform.value = info.platform
        if (info.result) {
          upsertBatchResult(info.result)
          const res = info.result
          const isErr = Boolean(res.error)
          const isInv = isInvalidResult(res)
          const plat = res.platform
          const detail = isErr ? res.error : isInv ? "页面404失效" : ("评论: " + res.commentCount + "条, 点赞: " + (res.liked ? "已赞" : "未赞") + ", 收藏: " + (res.collected ? "已藏" : "未藏"))
          pushLog({
            level: isErr ? "error" : isInv ? "warning" : "success",
            platform: plat,
            url: res.url,
            action: "网页检测",
            message: isErr ? ("检测异常: " + res.error) : isInv ? "链接已失效(404)" : ("检测正常: 发现 " + res.commentCount + " 条评论"),
            detail,
            diagnostics: res.diagnostics,
          })
        }
      },
      () => { batchWasCancelled.value = true },
    )
    batchResults.value = [...thirdPartyResults, ...scannedResults]
    const supportedResults = batchResults.value.filter(item => !isThirdPartyPlatform(item.platform))
    const invalidCount = supportedResults.filter(isInvalidResult).length
    const failedCount = supportedResults.filter(item => item.error).length
    const successCount = supportedResults.length - invalidCount - failedCount
    if (batchWasCancelled.value) {
      ElMessage.warning(`检测已停止：保留 ${batchResults.value.length} 条已完成结果，剩余链接未检测`)
    } else {
      ElMessage.success(`扫描完成：正常 ${successCount} 条，已失效 ${invalidCount} 条，失败 ${failedCount} 条，第三方待开发 ${thirdPartyResults.length} 条`)
    }
    await loadDashboardData()
  } catch (error) {
    ElMessage.error(`批量扫描失败：${String(error)}`)
  } finally {
    stopBatchTimer()
    batchRunning.value = false
    batchStopping.value = false
    activeBatchPort = null
  }
}

onBeforeUnmount(() => {
  stopBatchTimer()
  stopSupplementProgressTimer()
  activeBatchPort?.disconnect()
  activeBatchPort = null
  activeSupplementPort?.disconnect()
  activeSupplementPort = null
  chrome.storage.onChanged.removeListener(handleDashboardStorageChange)
})


function formatTimeShort(value: string | undefined): string {
  if (!value) return "未检测"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未检测"
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const timeStr = date.toTimeString().slice(0, 8)
  if (isToday) return "今天 " + timeStr
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return month + "-" + day + " " + timeStr
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function chineseOrdinal(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value < 10) return digits[value]
  if (value < 20) return `十${value === 10 ? '' : digits[value % 10]}`
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ''}`
  return String(value)
}

/**
 * 合并“同一篇文章的不同地址写法”造成的重复记录。
 * 地址归一化规则升级后（例如头条 /item/ 归一为 /article/），历史数据里可能仍留着
 * 一篇文章两条记录：一条是导入时建的空壳（标题、账号、点赞收藏全空），一条是扫描
 * 结果。这里按规范化链接分组，只保留最新一条，并补齐其余记录里的有效字段。
 * saveRecord 自身会删除同一规范化链接的其余记录，所以保存合并结果即可收敛。
 */
async function collapseDuplicateRecords(all: CommentRecord[]): Promise<number> {
  const groups = new Map<string, CommentRecord[]>()
  for (const record of all) {
    const key = `${record.platform}:${normalizeArticleUrl(record.url, record.platform)}`
    const list = groups.get(key)
    if (list) list.push(record)
    else groups.set(key, [record])
  }

  let mergedGroups = 0
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => String(b.checkTime || '').localeCompare(String(a.checkTime || '')))
    const merged: CommentRecord = { ...sorted[0] }
    for (const other of sorted.slice(1)) {
      if (!merged.title) merged.title = other.title || ''
      if (!merged.username) merged.username = other.username || ''
      if (merged.liked == null) merged.liked = other.liked
      if (merged.collected == null) merged.collected = other.collected
      if (merged.totalCommentCount == null) merged.totalCommentCount = other.totalCommentCount
      if (!merged.actionStatus) merged.actionStatus = other.actionStatus
      if (!merged.lastErrorCode) merged.lastErrorCode = other.lastErrorCode
      // 任一条标记失效即视为失效，避免旧记录把失效链接改回正常。
      if (other.linkStatus === 'invalid') merged.linkStatus = 'invalid'
    }
    try {
      await saveRecord(merged)
      mergedGroups++
    } catch (error) {
      console.error('[DL评论助手] 合并重复链接记录失败:', merged.url, error)
    }
  }
  return mergedGroups
}

async function loadDashboardData() {
  const allRecords = await getAllRecords()
  const mergedGroups = await collapseDuplicateRecords(allRecords).catch(() => 0)
  if (mergedGroups > 0) {
    pushLog({
      level: 'warning',
      action: '记录合并',
      message: `发现 ${mergedGroups} 组重复链接（同一篇文章存在两种地址写法），已合并为最新一条记录`,
    })
  }
  const [nextRecords] = await Promise.all([
    mergedGroups > 0 ? getAllRecords() : Promise.resolve(allRecords),
    loadCommentHistory(),
  ])
  records.value = nextRecords
  const recordMap = new Map(nextRecords.map(record => [batchResultKey(record), record]))
  batchResults.value = batchResults.value.map(item => {
    const record = recordMap.get(batchResultKey(item))
    return record ? {
      ...item,
      title: record.title,
      commentCount: record.commentCount,
      linkStatus: record.linkStatus,
      username: record.username,
      liked: record.liked,
      collected: record.collected,
      error: undefined,
    } : item
  })
}

async function refreshRecords() {
  if (recordsRefreshing.value) return
  recordsRefreshing.value = true
  try {
    await loadDashboardData()
    ElMessage.success(`列表已刷新，共 ${records.value.length} 条；如需重新检测网页，请使用“重新扫描全部”`)
    auditUserAction('refresh-scan-record-list', { count: records.value.length })
  } catch (error) {
    ElMessage.error(`刷新列表失败：${String((error as Error)?.message || error)}`)
  } finally {
    recordsRefreshing.value = false
  }
}

async function loadCommentHistory() {
  const loadVersion = ++commentHistoryLoadVersion
  const data = await chrome.storage.local.get(COMMENT_HISTORY_KEY)
  const entries = Array.isArray(data[COMMENT_HISTORY_KEY])
    ? data[COMMENT_HISTORY_KEY] as CommentPublishHistoryItem[]
    : []
  if (loadVersion !== commentHistoryLoadVersion) return
  commentHistory.value = [...entries].sort((a, b) => b.time.localeCompare(a.time))
  const maxPage = Math.max(1, Math.ceil(commentHistory.value.length / commentHistoryPageSize.value))
  commentHistoryPage.value = Math.min(commentHistoryPage.value, maxPage)
}

function commentPresenceText(item: CommentPublishHistoryItem): string {
  if (item.currentPresence === 'present') return '当前：已确认存在'
  if (item.currentPresence === 'suspected_deleted') return '当前：疑似已删除'
  if (item.lastVerifiedAt) return '当前：暂未确认'
  return '当前：尚未核验'
}

function commentHistoryEvidenceLabel(item: CommentPublishHistoryItem): string {
  if (!item.evidenceId) return '无存档'
  const snapshot = archiveSnapshots.value.find(entry => entry.id === item.evidenceId)
  if (snapshot?.archiveFormat === 'image') return '评论截图'
  if (snapshot) return item.evidenceTargetFound ? '旧版完整存档' : '旧版摘要存档'
  return item.evidenceTargetFound ? '评论截图' : '截图未完整'
}

function evidenceFileName(snapshot: CommentEvidenceSnapshot): string {
  const safeTitle = (snapshot.title || platName(snapshot.platform))
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .trim()
    .slice(0, 80) || '评论区存档'
  const stamp = snapshot.createdAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const suffix = (snapshot.commentId || snapshot.sha256.slice(0, 10)).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeTitle}_${stamp}_${suffix}.${snapshot.archiveFormat === 'image' ? 'webp' : 'html'}`
}

async function loadArchiveSnapshots() {
  archiveSnapshots.value = (await getAllCommentEvidence())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function loadArchiveRuns() {
  const stored = await chrome.storage.local.get([COMMENT_ARCHIVE_RUNS_KEY, COMMENT_ARCHIVE_RUN_HISTORY_KEY])
  archiveRuns.value = stored[COMMENT_ARCHIVE_RUNS_KEY] && typeof stored[COMMENT_ARCHIVE_RUNS_KEY] === 'object'
    ? stored[COMMENT_ARCHIVE_RUNS_KEY] as Record<string, CommentArchiveRunSummary>
    : {}
  const history = Array.isArray(stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY])
    ? stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY] as CommentArchiveRunSummary[]
    : []
  const latestRuns = Object.values(archiveRuns.value)
  archiveRunHistory.value = [...new Map([...history, ...latestRuns].map(run => [run.id, run])).values()]
}

function archiveRowSelectable(row: ArchiveRow): boolean {
  return row.imageSnapshots.length > 0
}

function handleArchiveSelectionChange(rows: ArchiveRow[]) {
  archiveSelectedRows.value = rows
}

function archiveSourceText(snapshot: CommentEvidenceSnapshot): string {
  return snapshot.source === 'manual_scan' ? '手动扫描' : '自动评论'
}

function waitForArchiveInterval(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

async function captureArchiveForRecord(
  record: CommentRecord,
  showResult = true,
): Promise<boolean> {
  if (isThirdPartyPlatform(record.platform)) {
    if (showResult) ElMessage.info('第三方链接已汇总记录，当前版本暂不生成快照')
    return false
  }
  if (archiveBusyKey.value) return false
  const key = `${record.platform}:${normalizeArticleUrl(record.url, record.platform)}`
  archiveBusyKey.value = key
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_URL_ARCHIVE',
      platform: record.platform,
      url: record.url,
    }) as CaptureUrlArchiveResult
    if (!response?.success) throw new Error(response?.error || '未生成快照')
    await Promise.all([loadArchiveSnapshots(), loadArchiveRuns(), loadDashboardData()])
    if (showResult) {
      if (response.status === 'complete') {
        ElMessage.success(`截图完整：检测 ${response.detectedCommentCount || 0} 条，新截图 ${response.capturedNewCount || 0} 条，复用 ${response.reusedCount || 0} 条`)
      } else {
        ElMessage.warning(response.error || `截图未完整，仍缺少 ${response.missingCount || 0} 条`)
      }
    }
    auditUserAction('capture-url-archive', {
      platform: record.platform,
      url: normalizeArticleUrl(record.url, record.platform),
      evidenceId: response.evidenceId,
      detectedCommentCount: response.detectedCommentCount,
      capturedCommentCount: response.capturedCommentCount,
      missingCount: response.missingCount,
    })
    return response.status !== 'failed'
  } catch (error) {
    if (showResult) ElMessage.error(`存档失败：${String((error as Error)?.message || error)}`)
    return false
  } finally {
    archiveBusyKey.value = ''
  }
}

async function runArchiveBatch(rows: ArchiveRow[]) {
  if (archiveBatchRunning.value) return
  const targets = rows.filter(row => !isThirdPartyPlatform(row.record.platform) && !isInvalidRecord(row.record))
  if (targets.length === 0) {
    ElMessage.info('没有可生成快照的支持平台链接')
    return
  }
  archiveBatchRunning.value = true
  archiveStopRequested.value = false
  archiveCompleted.value = 0
  archiveTotal.value = targets.length
  let succeeded = 0
  try {
    for (let index = 0; index < targets.length; index++) {
      if (archiveStopRequested.value) break
      const row = targets[index]
      archiveCurrentUrl.value = row.record.url
      if (await captureArchiveForRecord(row.record, false)) succeeded++
      archiveCompleted.value++
      if (index < targets.length - 1 && !archiveStopRequested.value) await waitForArchiveInterval(2500)
    }
    const stopped = archiveStopRequested.value
    const failed = archiveCompleted.value - succeeded
    if (stopped) ElMessage.warning(`已停止：完成 ${archiveCompleted.value} 条，成功 ${succeeded} 条，失败 ${failed} 条`)
    else ElMessage.success(`快照任务完成：成功 ${succeeded} 条，失败 ${failed} 条`)
    auditUserAction('batch-capture-url-archives', {
      total: archiveTotal.value, completed: archiveCompleted.value, succeeded, stopped,
    })
  } finally {
    archiveBatchRunning.value = false
    archiveCurrentUrl.value = ''
    archiveStopRequested.value = false
  }
}

async function startArchiveBatch() {
  await runArchiveBatch(archiveRows.value)
}

function stopArchiveBatch() {
  if (!archiveBatchRunning.value) return
  archiveStopRequested.value = true
  ElMessage.info('将在当前链接完成后停止')
}

async function importAndArchiveUrls() {
  const classification = classifyArticleUrls(extractUrls(archiveImportText.value))
  if (classification.valid.length === 0 && classification.thirdParty.length === 0) {
    ElMessage.warning('没有识别到可记录的 URL')
    return
  }
  const existing = await getAllRecords()
  const existingKeys = new Set(existing.map(record => `${record.platform}:${normalizeArticleUrl(record.url, record.platform)}`))
  const now = new Date().toISOString()
  for (const item of classification.valid) {
    const key = `${item.platform}:${item.url}`
    if (existingKeys.has(key)) continue
    await saveRecord({
      platform: item.platform, url: item.url, title: '', commentCount: 0,
      checkTime: now, username: '', linkStatus: 'active',
    })
    existingKeys.add(key)
  }
  for (const url of classification.thirdParty) {
    const key = `third_party:${normalizeArticleUrl(url, 'third_party')}`
    if (existingKeys.has(key)) continue
    await saveRecord({
      platform: 'third_party', url, title: '第三方链接（等待开发）', commentCount: 0,
      checkTime: now, username: '', linkStatus: 'active',
    })
    existingKeys.add(key)
  }
  archiveImportVisible.value = false
  archiveImportText.value = ''
      await Promise.all([loadDashboardData(), loadCommentHistory()])
  const importedKeys = new Set(classification.valid.map(item => `${item.platform}:${item.url}`))
  const importedRows = archiveRows.value.filter(row => importedKeys.has(row.key))
  if (classification.invalid.length) ElMessage.warning(`有 ${classification.invalid.length} 条不是有效文章链接，已跳过`)
  if (classification.thirdParty.length && classification.valid.length === 0) {
    ElMessage.success(`已记录 ${classification.thirdParty.length} 条第三方链接，等待后续开发`)
    return
  }
  await runArchiveBatch(importedRows)
}

async function refreshArchiveCenter() {
  if (recordsRefreshing.value) return
  recordsRefreshing.value = true
  try {
    await Promise.all([loadDashboardData(), loadArchiveSnapshots(), loadArchiveRuns()])
    ElMessage.success('存档中心已刷新')
  } catch (error) {
    ElMessage.error(`刷新失败：${String((error as Error)?.message || error)}`)
  } finally {
    recordsRefreshing.value = false
  }
}

async function openArchiveSnapshot(snapshot: CommentEvidenceSnapshot) {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/evidence.html?id=${encodeURIComponent(snapshot.id)}`),
  })
  auditUserAction('open-archive-snapshot', { evidenceId: snapshot.id })
}

function downloadArchiveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function exportArchiveSnapshot(snapshot: CommentEvidenceSnapshot) {
  if (snapshot.archiveFormat === 'image' && snapshot.imageDataUrl) {
    const anchor = document.createElement('a')
    anchor.href = snapshot.imageDataUrl
    anchor.download = evidenceFileName(snapshot)
    anchor.click()
  } else if (snapshot.htmlDocument) {
    downloadArchiveBlob(new Blob([snapshot.htmlDocument], { type: 'text/html;charset=utf-8' }), evidenceFileName(snapshot))
  } else {
    ElMessage.error('该存档没有可导出的内容')
    return
  }
  ElMessage.success(snapshot.archiveFormat === 'image' ? '评论截图已导出' : '旧版 HTML 存档已导出')
  auditUserAction('export-archive-snapshot', { evidenceId: snapshot.id })
}

function dataUrlBytes(value: string): Uint8Array {
  const base64 = value.slice(value.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipHeader(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size)
  return { bytes, view: new DataView(bytes.buffer) }
}

function zipBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function createScreenshotZip(snapshots: CommentEvidenceSnapshot[]): Blob {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const snapshot of snapshots) {
    const data = dataUrlBytes(snapshot.imageDataUrl || '')
    const name = encoder.encode(evidenceFileName(snapshot))
    const crc = crc32(data)
    const local = zipHeader(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, 20, true)
    local.view.setUint16(6, 0x0800, true)
    local.view.setUint32(14, crc, true)
    local.view.setUint32(18, data.length, true)
    local.view.setUint32(22, data.length, true)
    local.view.setUint16(26, name.length, true)
    localParts.push(local.bytes, name, data)

    const central = zipHeader(46)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, 20, true)
    central.view.setUint16(6, 20, true)
    central.view.setUint16(8, 0x0800, true)
    central.view.setUint32(16, crc, true)
    central.view.setUint32(20, data.length, true)
    central.view.setUint32(24, data.length, true)
    central.view.setUint16(28, name.length, true)
    central.view.setUint32(42, offset, true)
    centralParts.push(central.bytes, name)
    offset += local.bytes.length + name.length + data.length
  }
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0)
  const end = zipHeader(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(8, snapshots.length, true)
  end.view.setUint16(10, snapshots.length, true)
  end.view.setUint32(12, centralSize, true)
  end.view.setUint32(16, offset, true)
  return new Blob([...localParts, ...centralParts, end.bytes].map(zipBlobPart), { type: 'application/zip' })
}

function exportScreenshotSet(snapshots: CommentEvidenceSnapshot[], filename: string) {
  const images = [...new Map(snapshots.filter(snapshot => snapshot.archiveFormat === 'image' && snapshot.imageDataUrl)
    .map(snapshot => [snapshot.id, snapshot])).values()]
  if (images.length === 0) {
    ElMessage.warning('没有可导出的评论截图')
    return
  }
  downloadArchiveBlob(createScreenshotZip(images), filename)
  ElMessage.success(`已将 ${images.length} 张评论截图打包导出`)
}

function exportSelectedArchives() {
  const snapshots = archiveSelectedWithSnapshot.value.flatMap(row => row.imageSnapshots)
  exportScreenshotSet(snapshots, `评论截图汇总_${new Date().toISOString().slice(0, 10)}.zip`)
  auditUserAction('export-selected-archives', { count: snapshots.length })
}

function showArchiveTimeline(row: ArchiveRow) {
  archiveTimelineRow.value = row
  archiveTimelineVisible.value = true
}

async function deleteArchiveSnapshot(snapshot: CommentEvidenceSnapshot) {
  try {
    await ElMessageBox.confirm('删除后无法恢复，其他版本不受影响。', '确认删除这份快照？', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch {
    return
  }
  const timelineKey = archiveTimelineRow.value?.key
  await deleteCommentEvidence(snapshot.id)
  await loadArchiveSnapshots()
  if (timelineKey) archiveTimelineRow.value = archiveRows.value.find(row => row.key === timelineKey) || null
  if (archiveTimelineRow.value && archiveTimelineRow.value.snapshots.length === 0) archiveTimelineVisible.value = false
  ElMessage.success('该快照版本已删除')
  auditUserAction('delete-archive-snapshot', { evidenceId: snapshot.id })
}

function handleArchiveCommand(command: string, row: ArchiveRow) {
  if (command === 'view' && row.latest) openArchiveSnapshot(row.latest)
  else if (command === 'timeline') showArchiveTimeline(row)
  else if (command === 'export') exportScreenshotSet(row.imageSnapshots, `${platName(row.record.platform)}_评论截图_${new Date().toISOString().slice(0, 10)}.zip`)
  else if (command === 'delete' && row.latest) deleteArchiveSnapshot(row.latest)
}

async function openCommentEvidence(item: CommentPublishHistoryItem) {
  if (!item.evidenceId) return
  const snapshot = await getCommentEvidence(item.evidenceId)
  if (!snapshot) {
    ElMessage.error('该评论区存档不存在，可能已经被清理')
    return
  }
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/evidence.html?id=${encodeURIComponent(item.evidenceId)}`),
  })
  auditUserAction('open-comment-evidence', { historyId: item.id, evidenceId: item.evidenceId })
}

async function exportCommentEvidence(item: CommentPublishHistoryItem) {
  if (!item.evidenceId) return
  const snapshot = await getCommentEvidence(item.evidenceId)
  if (!snapshot) {
    ElMessage.error('该评论区存档不存在，无法导出')
    return
  }
  exportArchiveSnapshot(snapshot)
  auditUserAction('export-comment-evidence', { historyId: item.id, evidenceId: item.evidenceId })
}

async function saveCommentHistoryEntries(entries: CommentPublishHistoryItem[]) {
  await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: entries })
  commentHistory.value = [...entries].sort((a, b) => b.time.localeCompare(a.time))
}

async function deleteCommentEvidenceFromHistory(item: CommentPublishHistoryItem) {
  if (!item.evidenceId) return
  const snapshot = await getCommentEvidence(item.evidenceId)
  const keepScreenshot = snapshot?.archiveFormat === 'image'
  try {
    await ElMessageBox.confirm(
      keepScreenshot
        ? '将解除评论历史与这张截图的关联，截图仍保留在存档中心。'
        : '将删除这份旧版 HTML 存档，评论任务记录仍会保留。',
      keepScreenshot ? '确认解除关联？' : '确认删除存档？', {
      confirmButtonText: keepScreenshot ? '解除关联' : '删除存档', cancelButtonText: '取消', type: 'warning',
    })
  } catch {
    return
  }
  if (snapshot && !keepScreenshot) await deleteCommentEvidence(item.evidenceId)
  const next = commentHistory.value.map((entry) => {
    if (entry.id !== item.id) return entry
    const {
      evidenceId: _evidenceId,
      evidenceSha256: _evidenceSha256,
      evidenceCapturedAt: _evidenceCapturedAt,
      evidenceTargetFound: _evidenceTargetFound,
      evidenceError: _evidenceError,
      ...rest
    } = entry
    return rest
  })
  await saveCommentHistoryEntries(next)
  if (!keepScreenshot) await loadArchiveSnapshots()
  ElMessage.success(keepScreenshot ? '已解除关联，截图仍保留在存档中心' : '旧版存档已删除，评论任务记录已保留')
  auditUserAction(keepScreenshot ? 'unlink-comment-evidence' : 'delete-comment-evidence', { historyId: item.id })
}

async function verifyCommentHistoryItem(item: CommentPublishHistoryItem) {
  if (!item.comment || evidenceBusyId.value) return
  evidenceBusyId.value = item.id
  try {
    const snapshot = item.evidenceId ? await getCommentEvidence(item.evidenceId) : undefined
    const response = await chrome.runtime.sendMessage({
      type: 'VERIFY_COMMENT_ONLINE',
      historyId: item.id,
      platform: item.platform,
      url: item.url,
      comment: item.comment,
      archivedAfterCommentCount: snapshot?.afterCommentCount ?? item.lastKnownCommentCount ?? 0,
    }) as VerifyCommentOnlineResult
    const checkedAt = response.checkedAt || new Date().toISOString()
    let evidencePatch: Partial<CommentPublishHistoryItem> = {}
    if (response.success && response.presence === 'present' && !item.evidenceId) {
      try {
        const capture = await chrome.runtime.sendMessage({
          type: 'CAPTURE_URL_ARCHIVE',
          platform: item.platform,
          url: item.url,
          expectedComment: item.comment,
        }) as CaptureUrlArchiveResult
        if (!capture?.success || !capture.evidenceId) {
          throw new Error(capture?.error || '已确认评论存在，但暂未生成截图')
        }
        const snapshot = await getCommentEvidence(capture.evidenceId)
        if (!snapshot) throw new Error('截图保存后暂时无法读取')
        evidencePatch = {
          evidenceId: snapshot.id,
          evidenceSha256: snapshot.sha256,
          evidenceCapturedAt: snapshot.createdAt,
          evidenceTargetFound: snapshot.targetFoundInDom,
          evidenceError: undefined,
        }
        await Promise.all([loadArchiveSnapshots(), loadArchiveRuns()])
      } catch (error) {
        evidencePatch = { evidenceError: String((error as Error)?.message || error) }
      }
    }
    const next = commentHistory.value.map(entry => entry.id === item.id ? {
      ...entry,
      ...evidencePatch,
      verificationStatus: response.presence === 'present' ? 'verified' as const : entry.verificationStatus,
      failureReason: response.presence === 'present' ? undefined : entry.failureReason,
      errorCode: response.presence === 'present' ? undefined : entry.errorCode,
      currentPresence: response.presence,
      lastVerifiedAt: checkedAt,
      lastConfirmedPresentAt: response.presence === 'present' ? checkedAt : entry.lastConfirmedPresentAt,
      firstMissingAt: response.presence === 'suspected_deleted' ? entry.firstMissingAt || checkedAt : entry.firstMissingAt,
      lastKnownCommentCount: response.currentCommentCount ?? entry.lastKnownCommentCount,
    } : entry)
    await saveCommentHistoryEntries(next)
    if (!response.success) ElMessage.error(`在线核验失败：${response.error || response.reason}`)
    else if (response.presence === 'present') {
      ElMessage.success(evidencePatch.evidenceId
        ? '在线核验完成：评论存在，状态与截图已同步'
        : '在线核验完成：评论存在，状态已同步；截图可稍后在存档中心补拍')
    }
    else if (response.presence === 'suspected_deleted') ElMessage.warning(`在线核验完成：${response.reason}`)
    else ElMessage.info(`在线核验完成：${response.reason}`)
    auditUserAction('verify-comment-evidence', {
      historyId: item.id, presence: response.presence, currentCommentCount: response.currentCommentCount,
    })
  } catch (error) {
    ElMessage.error(`在线核验失败：${String((error as Error)?.message || error)}`)
  } finally {
    evidenceBusyId.value = ''
  }
}

function handleEvidenceCommand(command: string, item: CommentPublishHistoryItem) {
  if (command === 'copy') copyText(item.comment, '评论内容已复制')
  else if (command === 'export') exportCommentEvidence(item)
  else if (command === 'delete') deleteCommentEvidenceFromHistory(item)
}

async function loadLastSupplementResults() {
  const stored = await chrome.storage.local.get(['lastSupplementResults', 'manualCommentRound'])
  supplementResults.value = Array.isArray(stored.lastSupplementResults)
    ? stored.lastSupplementResults as SupplementResult[]
    : []
  const maxPage = Math.max(1, Math.ceil(supplementResults.value.length / supplementPageSize.value))
  supplementPage.value = Math.min(supplementPage.value, maxPage)
  commentRound.value = Math.max(0, Number(stored.manualCommentRound) || 0)
}

async function clearSupplementResults() {
  if (supplementRunning.value || supplementResults.value.length === 0) return
  try {
    await ElMessageBox.confirm('只清理智能补齐下方的任务结果，不会删除扫描记录、评论历史或截图。', '确认清理任务结果？', {
      confirmButtonText: '确认清理', cancelButtonText: '取消', type: 'warning',
    })
  } catch {
    return
  }
  await chrome.storage.local.remove('lastSupplementResults')
  supplementResults.value = []
  supplementPage.value = 1
  ElMessage.success('智能补齐任务结果已清理')
  auditUserAction('clear-supplement-results')
}

function handleDashboardStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) {
  if (areaName !== 'local') return
  if (changes[COMMENT_HISTORY_KEY]) loadCommentHistory().catch(() => {})
  if (changes[COMMENT_ARCHIVE_RUNS_KEY]) loadArchiveRuns().catch(() => {})
  if (changes[COMMENT_ARCHIVE_RUN_HISTORY_KEY]) loadArchiveRuns().catch(() => {})
  if (changes[COMMENT_TEMPLATES_KEY]) loadManualTemplates().catch(() => {})
  if (changes[COMMENT_MODE_KEY] || changes[COMMENT_TEMPLATE_SELECTION_KEY]) loadCommentPreferences().catch(() => {})
  if (changes.lastSupplementResults && Array.isArray(changes.lastSupplementResults.newValue)) {
    supplementResults.value = changes.lastSupplementResults.newValue as SupplementResult[]
    supplementPage.value = 1
  } else if (changes.lastSupplementResults && changes.lastSupplementResults.newValue == null) {
    supplementResults.value = []
    supplementPage.value = 1
  }
}

async function clearCommentHistory() {
  try {
    await ElMessageBox.confirm('将清空全部已发布评论历史，此操作不可恢复。', '确认清空评论历史？', {
      confirmButtonText: '确认清空', cancelButtonText: '取消', type: 'warning',
    })
  } catch {
    return
  }
  const evidenceIds = [...new Set(commentHistory.value.map(item => item.evidenceId).filter((id): id is string => Boolean(id)))]
  const evidence = await Promise.all(evidenceIds.map(id => getCommentEvidence(id)))
  await Promise.all([
    chrome.storage.local.remove(COMMENT_HISTORY_KEY),
    ...evidence.filter(snapshot => snapshot
      && snapshot.archiveFormat !== 'image'
      && snapshot.source !== 'manual_scan')
      .map(snapshot => deleteCommentEvidence(snapshot!.id)),
  ])
  commentHistory.value = []
  commentHistoryPage.value = 1
  await loadArchiveSnapshots()
  ElMessage.success('评论历史已清空，存档中心的评论截图已保留')
  auditUserAction('clear-comment-history')
}

async function rescanRecord(record: CommentRecord) {
  if (isThirdPartyPlatform(record.platform)) {
    ElMessage.info('该链接已记录为第三方平台，当前版本等待开发，暂不执行扫描')
    return
  }
  if (rescanUrl.value || rescanAllRunning.value) return
  rescanUrl.value = record.url
  try {
    const results = await requestBatchScan([record.url])
    const result = results[0]
    if (result?.error) {
      ElMessage.error(`重新扫描失败：${result.error}`)
      pushLog({
        level: "error",
        platform: record.platform,
        url: record.url,
        action: "重新检测",
        message: "检测失败: " + result.error,
        diagnostics: result.diagnostics,
      })
    } else if (result && isInvalidResult(result)) {
      ElMessage.warning("该链接已失效（404），记录已标红并归零")
      pushLog({
        level: "warning",
        platform: record.platform,
        url: record.url,
        action: "重新检测",
        message: "链接已失效(404)，评论计数归零",
        diagnostics: result.diagnostics,
      })
    } else {
      // 成功检测后：主动清理过期的历史错误码和动作状态，让“最新动态”与当前最新扫描结果完美保持一致
      await saveRecord({
        ...record,
        // 标题与账号也以本次扫描结果为准：仅导入未检测过的记录标题为空，
        // 重新检测必须把标题补上，否则永远显示空标题。
        title: result?.title || record.title,
        username: result?.username || record.username,
        commentCount: result?.commentCount ?? 0,
        totalCommentCount: result?.totalCommentCount,
        liked: result?.liked,
        collected: result?.collected,
        checkTime: new Date().toISOString(),
        lastErrorCode: undefined,
        actionStatus: undefined,
      })
      ElMessage.success(`已更新：${result?.commentCount ?? 0} 条评论`)
      pushLog({
        level: "success",
        platform: record.platform,
        url: record.url,
        action: "重新检测",
        message: record.platform === 'netease'
          // 网易没有文章级点赞/收藏，不能打印“未赞/未藏”误导用户。
          ? `检测成功: 当前评论 ${result?.commentCount ?? 0} 条`
          : `检测成功: 当前评论 ${result?.commentCount ?? 0} 条，点赞 ${result?.liked ? "已赞" : "未赞"}，收藏 ${result?.collected ? "已藏" : "未藏"}`,
        diagnostics: result?.diagnostics,
      })
    }
    await loadDashboardData()
  } catch (error) {
    ElMessage.error(`重新扫描失败：${String(error)}`)
  } finally {
    rescanUrl.value = ''
  }
}

type RecordRescanScope = 'all' | 'comment' | 'like' | 'collect' | 'interaction'

function recordRescanTargets(scope: RecordRescanScope): CommentRecord[] {
  if (scope === 'comment') return commentCandidates.value
  if (scope === 'like' || scope === 'collect' || scope === 'interaction') return interactionCandidates.value
  return records.value.filter(record => !isThirdPartyPlatform(record.platform))
}

function handleRecordRescanCommand(command: string) {
  if (command === 'comment' || command === 'like' || command === 'collect' || command === 'interaction') {
    void rescanAllRecords(command)
  }
}

async function rescanAllRecords(scope: RecordRescanScope = 'all') {
  if (records.value.length === 0 || rescanAllRunning.value) return
  const scannableRecords = recordRescanTargets(scope)
  if (scannableRecords.length === 0) {
    const emptyMessage = scope === 'comment'
      ? `没有低于 ${warningThreshold.value} 条评论的链接`
      : scope === 'like'
        ? '没有未点赞或点赞状态待确认的链接'
      : scope === 'collect'
          ? '没有未收藏或收藏状态待确认的链接'
        : scope === 'interaction'
          ? '没有未点赞或未收藏的链接'
          : '当前记录全部是第三方平台链接，暂无可重新扫描的链接'
    ElMessage.info(emptyMessage)
    return
  }
  rescanAllRunning.value = true
  try {
    const results = await requestBatchScan(scannableRecords.map(record => record.url))
    const failed = results.filter(item => item.error).length
    const invalid = results.filter(isInvalidResult).length
    const scopeLabel = scope === 'comment'
      ? '评论不足项'
      : scope === 'like'
        ? '点赞不足项'
        : scope === 'collect'
          ? '收藏不足项'
        : scope === 'interaction'
          ? '点赞和收藏不足项'
          : '全部记录'
    ElMessage.success(`${scopeLabel}扫描完成：正常 ${results.length - failed - invalid} 条，已失效 ${invalid} 条，失败 ${failed} 条`)
    pushLog({
      level: failed > 0 ? "warning" : "success",
      action: "重新检测",
      message: scopeLabel + "检测完成: 正常 " + (results.length - failed - invalid) + " 条, 失败 " + failed + " 条, 失效 " + invalid + " 条",
    })
    auditUserAction('rescan-records', { scope, count: scannableRecords.length, failed, invalid })
    await loadDashboardData()
  } catch (error) {
    ElMessage.error(`重新扫描失败：${String(error)}`)
  } finally {
    rescanAllRunning.value = false
  }
}

async function clearPageScanCachesAndBadges() {
  const tabs = await chrome.tabs.query({})
  await Promise.allSettled(tabs.map(async (tab) => {
    if (tab.id == null) return
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {})
    await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_SCAN_CACHE' }).catch(() => {})
  }))
  await chrome.action.setBadgeText({ text: '' }).catch(() => {})
}

async function clearAllScanData() {
  if ((records.value.length === 0 && commentHistory.value.length === 0 && archiveSnapshots.value.length === 0) || clearingRecords.value) return

  try {
    await ElMessageBox.confirm(
      '将永久删除全部扫描记录、评论截图、截图扫描汇总、批量结果、评论历史、扫描日志和页面缓存。账号设置与警告阈值会保留。',
      '确认一键清空？',
      {
        confirmButtonText: '确认清空',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  clearingRecords.value = true
  auditUserAction('clear-all-scan-data-start', { recordCount: records.value.length })
  try {
    await clearAllRecords()
    await chrome.storage.local.remove([
      ACCOUNT_LOG_KEY,
      COMMENT_HISTORY_KEY,
      'consumptionPointState',
      'pendingBatchUrls',
      'pendingBatchAutoStart',
      'lastSupplementResults',
      'manualCommentRound',
      COMMENT_ARCHIVE_RUNS_KEY,
      COMMENT_ARCHIVE_RUN_HISTORY_KEY,
    ])
    await clearPageScanCachesAndBadges()

    records.value = []
    batchResults.value = []
    accountLogs.value = []
    commentHistory.value = []
    supplementResults.value = []
    archiveSnapshots.value = []
    archiveRuns.value = {}
    archiveSelectedRows.value = []
    commentRound.value = 0

    ElMessage.success('扫描记录、评论截图及相关统计已全部清空')
    auditUserAction('clear-all-scan-data-success')
  } catch (error) {
    ElMessage.error(`清空失败：${String(error)}`)
    await loadDashboardData().catch(() => {})
  } finally {
    clearingRecords.value = false
  }
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('导出成功')
}

function exportBatchResults() {
  if (batchResults.value.length === 0) return
  const rows = [['平台', '链接', '标题', '我的评论', '点赞状态', '收藏状态', '账号状态', '检测状态']]
  for (const item of batchResults.value) {
    rows.push([
      platName(item.platform), item.url, item.title || '', isInvalidResult(item) || isThirdPartyPlatform(item.platform) ? '--' : String(item.commentCount),
      interactionStatusText(item.liked, '点赞', item.platform), interactionStatusText(item.collected, '收藏', item.platform),
      item.accountStatus === 'logged_in' ? '已登录' : item.accountStatus === 'auth_required' ? '未登录' : item.accountStatus === 'account_mismatch' ? '账号不一致' : '状态未知',
      isInvalidResult(item) ? '已失效（404）' : isThirdPartyPlatform(item.platform) ? '第三方平台（等待开发）' : item.error || '成功',
    ])
  }
  downloadCsv(rows, `批量扫描结果_${new Date().toISOString().slice(0, 10)}.csv`)
  auditUserAction('export-batch-results', { count: batchResults.value.length })
}

function exportRecords() {
  if (records.value.length === 0) return
  const rows = [['平台', '链接', '标题', '我的评论', '点赞状态', '收藏状态', '链接状态', '用户名', '最后扫描时间']]
  for (const record of sortedRecords.value) {
    rows.push([
      platName(record.platform), record.url, record.title,
      isInvalidRecord(record) || isThirdPartyPlatform(record.platform) ? '--' : String(record.commentCount),
      interactionStatusText(record.liked, '点赞', record.platform),
      interactionStatusText(record.collected, '收藏', record.platform),
      isInvalidRecord(record) ? '已失效（404）' : isThirdPartyPlatform(record.platform) ? '第三方平台（等待开发）' : '正常',
      record.username, formatTime(record.checkTime),
    ])
  }
  downloadCsv(rows, `扫描记录_${new Date().toISOString().slice(0, 10)}.csv`)
  auditUserAction('export-scan-records', { count: records.value.length })
}

function exportWarningRecords() {
  if (warningThreshold.value <= 0) {
    ElMessage.warning('请先设置大于 0 的低评论数阈值')
    return
  }
  if (warningRecords.value.length === 0) {
    ElMessage.warning(`没有低于 ${warningThreshold.value} 条的正常链接`)
    return
  }

  const rows = [['平台', '链接', '标题', '我的评论', '点赞状态', '收藏状态', '警告条件', '用户名', '最后扫描时间']]
  for (const record of warningRecords.value) {
    rows.push([
      platName(record.platform), record.url, record.title, String(record.commentCount),
      interactionStatusText(record.liked, '点赞', record.platform),
      interactionStatusText(record.collected, '收藏', record.platform),
      `低于 ${warningThreshold.value} 条`, record.username, formatTime(record.checkTime),
    ])
  }
  downloadCsv(
    rows,
    `低于${warningThreshold.value}条评论_${new Date().toISOString().slice(0, 10)}.csv`,
  )
  auditUserAction('export-warning-records', { count: warningRecords.value.length, threshold: warningThreshold.value })
}

function exportCommentHistory() {
  if (commentHistory.value.length === 0) return
  const rows = [['时间', '平台', '文章链接', '文章标题', '账号', '评论内容', '验证状态', '评论区存档', '当前状态', '最后在线核验']]
  for (const item of commentHistory.value) {
    rows.push([
      formatTime(item.time), platName(item.platform), item.url, item.title, item.username, item.comment,
      item.verificationStatus === 'verified' ? '成功' : item.verificationStatus === 'failed' ? `失败：${item.failureReason || ''}` : '已提交待平台同步',
      item.evidenceId ? commentHistoryEvidenceLabel(item) : item.evidenceError ? `截图失败：${item.evidenceError}` : '无截图',
      commentPresenceText(item), item.lastVerifiedAt ? formatTime(item.lastVerifiedAt) : '',
    ])
  }
  downloadCsv(rows, `评论历史_${new Date().toISOString().slice(0, 10)}.csv`)
  auditUserAction('export-comment-history', { count: commentHistory.value.length })
}

async function loadLegalNotice() {
  const stored = await chrome.storage.local.get(LEGAL_NOTICE_KEY)
  const acceptance = stored[LEGAL_NOTICE_KEY] as { version?: string } | undefined
  legalNoticeVisible.value = acceptance?.version !== LEGAL_NOTICE_VERSION
}

async function acceptLegalNotice() {
  if (!legalNoticeConfirmed.value) return
  await chrome.storage.local.set({
    [LEGAL_NOTICE_KEY]: {
      version: LEGAL_NOTICE_VERSION,
      acceptedAt: new Date().toISOString(),
    },
  })
  legalNoticeVisible.value = false
  auditUserAction('accept-legal-notice', { version: LEGAL_NOTICE_VERSION })
  ElMessage.success('已确认合规使用须知')
}

onMounted(async () => {
  await loadLegalNotice()
  await loadPersistedLogs()
  chrome.storage.onChanged.addListener(handleDashboardStorageChange)
  await Promise.all([
    loadDashboardData(),
    loadArchiveSnapshots(),
    loadArchiveRuns(),
    loadWarningThreshold(),
    loadAccountSettings(),
    loadCommentHistory(),
    loadLastSupplementResults(),
    loadManualTemplates(),
    loadCommentPreferences(),
    loadAccountLogs(),
    checkClient(false),
  ])

  // 后台操作/问题日志用于系统设置页的诊断日志统计，连接就绪后拉取一次。
  await loadClientLogs()

  if (!commentModeConfigured.value) {
    commentMode.value = aiConfig.value.hasApiKey ? 'ai' : manualTemplates.value.length ? 'template' : 'ai'
    await chrome.storage.local.set({
      [COMMENT_MODE_KEY]: commentMode.value,
      [COMMENT_TEMPLATE_SELECTION_KEY]: manualTemplateSelection.value,
    })
    commentModeConfigured.value = true
  }

  const params = new URLSearchParams(window.location.search)
  const requestedTab = params.get('tab')
  if (requestedTab) {
    if (requestedTab === "archives" || requestedTab === "comment-history") activeTab.value = "archives"
    else if (requestedTab === "settings" || requestedTab === "accounts") activeTab.value = "settings"
    else activeTab.value = "workspace"
  }

  const pending = await chrome.storage.local.get([
    'pendingBatchUrls',
    'pendingBatchAutoStart',
  ])

  if (Array.isArray(pending.pendingBatchUrls)) {
    batchUrls.value = pending.pendingBatchUrls.join('\n')
    activeTab.value = "workspace"
    await chrome.storage.local.remove([
      'pendingBatchUrls',
      'pendingBatchAutoStart',
    ])

    if (pending.pendingBatchAutoStart) {
      await startBatch()
    }
  }
})


// ----------------- 截图归档：网站分类、文章分组与ZIP导出扩展 -----------------
const archiveViewMode = ref<'group' | 'table'>('group');
const selectedArchiveSnapshotIds = ref<Set<string>>(new Set());
const archiveSearchKeyword = ref('');

const supportedPlatformKeys = computed(() => {
  return ['csdn', 'zhihu', 'toutiao', 'baijiahao', 'netease', 'sohu'] as Platform[];
});

const archivePlatformCounts = computed(() => {
  const c: Record<string, number> = {};
  archiveSnapshots.value.forEach(s => {
    c[s.platform] = (c[s.platform] || 0) + 1;
  });
  return c;
});

const filteredArchiveSnapshots = computed(() => {
  return archiveSnapshots.value.filter(s => {
    if (archivePlatformFilter.value !== 'all' && s.platform !== archivePlatformFilter.value) {
      return false;
    }
    if (archiveSearchKeyword.value.trim()) {
      const q = archiveSearchKeyword.value.trim().toLowerCase();
      const matchTitle = (s.title || '').toLowerCase().includes(q);
      const matchUrl = (s.url || '').toLowerCase().includes(q);
      const matchComment = (s.comment || '').toLowerCase().includes(q);
      if (!matchTitle && !matchUrl && !matchComment) return false;
    }
    return true;
  });
});

interface ArchiveGroupRow {
  key: string;
  record: CommentRecord;
  imageSnapshots: CommentEvidenceSnapshot[];
}

const filteredArchiveGroupRows = computed<ArchiveGroupRow[]>(() => {
  const map = new Map<string, ArchiveGroupRow>();

  records.value.forEach(r => {
    if (archivePlatformFilter.value !== 'all' && r.platform !== archivePlatformFilter.value) {
      return;
    }
    if (archiveSearchKeyword.value.trim()) {
      const q = archiveSearchKeyword.value.trim().toLowerCase();
      const matchTitle = (r.title || '').toLowerCase().includes(q);
      const matchUrl = (r.url || '').toLowerCase().includes(q);
      if (!matchTitle && !matchUrl) return;
    }
    const key = normalizeArticleUrl(r.url, r.platform);
    if (!map.has(key)) {
      map.set(key, {
        key,
        record: r,
        imageSnapshots: []
      });
    }
  });

  archiveSnapshots.value.forEach(s => {
    if (archivePlatformFilter.value !== 'all' && s.platform !== archivePlatformFilter.value) {
      return;
    }
    if (archiveSearchKeyword.value.trim()) {
      const q = archiveSearchKeyword.value.trim().toLowerCase();
      const matchTitle = (s.title || '').toLowerCase().includes(q);
      const matchUrl = (s.url || '').toLowerCase().includes(q);
      const matchComment = (s.comment || '').toLowerCase().includes(q);
      if (!matchTitle && !matchUrl && !matchComment) return;
    }
    const key = normalizeArticleUrl(s.url, s.platform);
    if (map.has(key)) {
      map.get(key)!.imageSnapshots.push(s);
    } else {
      map.set(key, {
        key,
        record: {
          url: s.url,
          platform: s.platform,
          title: s.title || s.url,
          commentCount: 0,
          liked: false,
          collected: false,
          checkTime: s.createdAt,
          username: '',
          targetCommentCount: 5
        },
        imageSnapshots: [s]
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.imageSnapshots.length - a.imageSnapshots.length);
});

const isAllFilteredSnapshotsSelected = computed(() => {
  if (filteredArchiveSnapshots.value.length === 0) return false;
  return filteredArchiveSnapshots.value.every(s => selectedArchiveSnapshotIds.value.has(s.id));
});

function isArchiveSnapshotSelected(id: string): boolean {
  return selectedArchiveSnapshotIds.value.has(id);
}

function toggleArchiveSnapshotSelection(id: string) {
  if (selectedArchiveSnapshotIds.value.has(id)) {
    selectedArchiveSnapshotIds.value.delete(id);
  } else {
    selectedArchiveSnapshotIds.value.add(id);
  }
}

function isLinkAllSnapshotsSelected(group: ArchiveGroupRow): boolean {
  if (group.imageSnapshots.length === 0) return false;
  return group.imageSnapshots.every(s => selectedArchiveSnapshotIds.value.has(s.id));
}

function toggleLinkAllSnapshots(group: ArchiveGroupRow) {
  const allSel = isLinkAllSnapshotsSelected(group);
  group.imageSnapshots.forEach(s => {
    if (allSel) {
      selectedArchiveSnapshotIds.value.delete(s.id);
    } else {
      selectedArchiveSnapshotIds.value.add(s.id);
    }
  });
}

function toggleAllFilteredSnapshots() {
  const allSel = isAllFilteredSnapshotsSelected.value;
  filteredArchiveSnapshots.value.forEach(s => {
    if (allSel) {
      selectedArchiveSnapshotIds.value.delete(s.id);
    } else {
      selectedArchiveSnapshotIds.value.add(s.id);
    }
  });
}

function exportSingleArchiveSnapshot(snapshot: CommentEvidenceSnapshot) {
  exportArchiveSnapshot(snapshot);
}

function exportAllArchiveSnapshots() {
  const list = archivePlatformFilter.value === 'all'
    ? archiveSnapshots.value
    : archiveSnapshots.value.filter(s => s.platform === archivePlatformFilter.value);
  exportScreenshotSet(list, `DL评论截图全部归档_${formatDateFilename()}.zip`);
}

function exportSelectedArchiveSnapshots() {
  if (selectedArchiveSnapshotIds.value.size === 0) {
    ElMessage.warning('请先勾选需要导出的截图');
    return;
  }
  const list = archiveSnapshots.value.filter(s => selectedArchiveSnapshotIds.value.has(s.id));
  exportScreenshotSet(list, `DL评论截图_已选${list.length}份_${formatDateFilename()}.zip`);
}

function exportLinkArchiveSnapshots(group: ArchiveGroupRow) {
  if (!group.imageSnapshots.length) {
    ElMessage.warning('该链接暂无截图');
    return;
  }
  const cleanTitle = (group.record.title || '文章').replace(/[\\/:*?"<>|]/g, '_').substring(0, 25);
  exportScreenshotSet(group.imageSnapshots, `${platName(group.record.platform)}_${cleanTitle}_${group.imageSnapshots.length}份截图.zip`);
}

async function clearAllArchiveEvidence() {
  ElMessageBox.confirm('确定清空所有截图证据存档吗？此操作无法恢复！', '清空确认', {
    confirmButtonText: '确定清空',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    for (const snap of archiveSnapshots.value) {
      await deleteCommentEvidence(snap.id);
    }
    archiveSnapshots.value = [];
    selectedArchiveSnapshotIds.value.clear();
    ElMessage.success('截图证据存档已清空');
    pushLog({
      level: 'warning',
      action: '清空截图',
      message: '用户清空了所有截图证据快照'
    });
  });
}

function formatDateFilename(): string {
  const d = new Date();
  const padNum = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${padNum(d.getMonth() + 1)}${padNum(d.getDate())}_${padNum(d.getHours())}${padNum(d.getMinutes())}`;
}

</script>



<style>
/* ============================================================
   DL 评论助手 · 政府公式化简约风格系统
   ============================================================ */

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background-color: #f8fafc;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 1. 全局两栏布局 */
.dl-admin-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background-color: #f8fafc;
  overflow: hidden;
}

/* 2. 左侧固定侧边栏 (端庄稳重、直角微弧 3px) */
.dl-sidebar {
  width: 220px;
  min-width: 220px;
  background-color: #ffffff;
  border-right: 1px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px 12px;
  flex-shrink: 0;
  z-index: 20;
}

.dl-sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 18px 8px;
  border-bottom: 1px solid #e2e8f0;
}

.brand-logo-badge {
  width: 32px;
  height: 32px;
  background-color: #1e3a8a;
  border-radius: 4px;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-text-wrap {
  display: flex;
  flex-direction: column;
}

.brand-app-name {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.3;
}

.brand-app-slogan {
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
}

.dl-sidebar-menu {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 14px;
  flex: 1;
}

.menu-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 3px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  user-select: none;
}

.menu-nav-item:hover {
  background-color: #f1f5f9;
  color: #0f172a;
}

.menu-nav-item.active {
  background-color: #eff6ff;
  color: #1e3a8a;
  font-weight: 600;
  border-left: 3px solid #1e3a8a;
}

.nav-icon-wrap {
  font-size: 14px;
  display: flex;
  align-items: center;
}

.nav-count-badge {
  margin-left: auto;
  background-color: #e2e8f0;
  color: #475569;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
}

.menu-nav-item.active .nav-count-badge {
  background-color: #dbeafe;
  color: #1e3a8a;
}

.dl-sidebar-footer {
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #334155;
  font-weight: 500;
}

.footer-pulse-dot {
  width: 7px;
  height: 7px;
  background-color: #15803d;
  border-radius: 50%;
}

.footer-version-label {
  font-size: 11px;
  color: #64748b;
}

/* 3. 右侧主视窗 */
.dl-main-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: #f8fafc;
}

.dl-topbar-header {
  height: 50px;
  min-height: 50px;
  background-color: #ffffff;
  border-bottom: 1px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-sizing: border-box;
}

.topbar-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 4px 10px;
  width: 320px;
}

.topbar-native-input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 12.5px;
  color: #1e293b;
  width: 100%;
}

.topbar-native-input::placeholder {
  color: #94a3b8;
}

.topbar-right-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.platform-support-tags {
  display: flex;
  gap: 6px;
}

.plat-capsule {
  font-size: 11px;
  background-color: #f1f5f9;
  color: #475569;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid #e2e8f0;
  font-weight: 500;
}

.topbar-avatar-badge {
  width: 28px;
  height: 28px;
  background-color: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
}

/* 视窗滚动容器 */
.dl-content-container {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
  box-sizing: border-box;
}

.page-title-banner {
  margin-bottom: 14px;
}

.page-heading-title {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.page-heading-desc {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 0 0;
}

/* 4. 经典大指标卡片（端庄简约白底、直角微弧 3px、细实心灰色边框） */
.metric-cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.metric-box-card {
  background-color: #ffffff;
  border-radius: 3px;
  padding: 12px 16px;
  border: 1px solid #cbd5e1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: none;
}

.metric-box-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.metric-icon-circle {
  width: 36px;
  height: 36px;
  border-radius: 3px;
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.circle-blue svg, .circle-green svg, .circle-amber svg, .circle-purple svg {
  fill: #1e3a8a !important;
}

.metric-info-col {
  display: flex;
  flex-direction: column;
}

.metric-title-text {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.metric-number-text {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  margin: 2px 0;
}

.metric-sub-trend {
  font-size: 11px;
  color: #64748b;
}

.metric-box-aside {
  font-size: 14px;
  opacity: 0.4;
}

/* 5. 主内容卡片容器（政务白底、规范 1px 细线边框、直角微弧 3px） */
.reference-main-card {
  background-color: #ffffff;
  border-radius: 3px;
  border: 1px solid #cbd5e1;
  padding: 16px 18px;
  margin-bottom: 16px;
}

.main-card-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.main-card-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-headline-title {
  font-size: 14.5px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.card-total-badge {
  font-size: 12px;
  background-color: #f1f5f9;
  color: #475569;
  padding: 1px 7px;
  border-radius: 3px;
  border: 1px solid #cbd5e1;
  font-weight: 500;
}

.main-card-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 按钮风格：政务深蓝、直角微弧 3px、克制内敛 */
.action-btn-hero-primary, .action-btn-gov-primary {
  background-color: #1e3a8a !important;
  border-color: #1e3a8a !important;
  color: #ffffff !important;
  font-weight: 500 !important;
  border-radius: 3px !important;
}

.action-btn-hero-primary:hover, .action-btn-gov-primary:hover {
  background-color: #172554 !important;
  border-color: #172554 !important;
}

.plus-symbol {
  font-weight: 700;
  margin-right: 4px;
}

.action-btn-neutral, .action-btn-gov-neutral {
  border-color: #cbd5e1 !important;
  color: #334155 !important;
  border-radius: 3px !important;
  background-color: #ffffff !important;
}

.dropdown-arrow {
  font-size: 10px;
  margin-left: 3px;
}

/* 6. 内嵌导入面板 */
.embedded-import-container {
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 12px;
  margin-bottom: 14px;
}

.embedded-clean-textarea :deep(.el-textarea__inner) {
  background-color: #ffffff;
  border-color: #cbd5e1;
  font-size: 12.5px;
  border-radius: 3px;
}

.embedded-import-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.import-status-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.status-chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid #e2e8f0;
  font-weight: 500;
}

.chip-valid { background-color: #f0fdf4; color: #166534; border-color: #bbf7d0; }
.chip-plat { background-color: #f8fafc; color: #1e3a8a; border-color: #cbd5e1; }
.chip-dup { background-color: #fefce8; color: #854d0e; border-color: #fef08a; }
.chip-third { background-color: #f1f5f9; color: #475569; border-color: #cbd5e1; }
.chip-invalid { background-color: #fef2f2; color: #991b1b; border-color: #fecaca; }

.import-status-placeholder {
  font-size: 12px;
  color: #64748b;
}

.embedded-btn-group {
  display: flex;
  gap: 8px;
}

/* 7. 运行状态通知条 */
.task-active-inline-panel {
  background-color: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 3px;
  padding: 10px 14px;
  margin-bottom: 14px;
}

.task-active-inline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
}

.task-inline-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #166534;
}

.inline-pulse-dot {
  width: 7px;
  height: 7px;
  background-color: #15803d;
  border-radius: 50%;
}

.inline-plat-badge {
  background-color: #dcfce7;
  color: #15803d;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
}

.task-inline-right {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #15803d;
}

.task-inline-url {
  font-size: 12px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 6px 0;
}

/* 8. 单行多维筛选工具栏 */
.filter-tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px solid #f1f5f9;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 14px;
}

.filter-search-input-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 4px 8px;
  flex: 1;
}

.filter-input-native {
  border: none;
  background: transparent;
  outline: none;
  font-size: 12.5px;
  color: #1e293b;
  width: 100%;
}

.filter-threshold-container {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 2px 6px;
  border-radius: 3px;
}

.threshold-tag-label {
  font-size: 12px;
  color: #475569;
}

/* 9. 现代规范数据表格（横线分割、无纵向硬框、紧凑端正） */
.reference-modern-table :deep(th.el-table__cell) {
  background-color: #f8fafc;
  color: #475569;
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid #cbd5e1;
  padding: 8px 0;
}

.reference-modern-table :deep(td.el-table__cell) {
  border-bottom: 1px solid #f1f5f9;
  padding: 10px 0;
  font-size: 12.5px;
}

.table-title-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.table-article-title {
  color: #1e293b;
  font-weight: 500;
  text-decoration: none;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-article-title:hover {
  color: #1e3a8a;
  text-decoration: underline;
}

.title-has-warning {
  color: #854d0e;
}

.title-is-invalid {
  color: #991b1b;
}

.table-article-url {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-platform-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.platform-dot-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

/* 平台颜色低饱和相近简约色 */
.dot-csdn { background-color: #c2410c; }
.dot-zhihu { background-color: #0369a1; }
.dot-toutiao { background-color: #be123c; }
.dot-baijiahao { background-color: #1d4ed8; }
.dot-netease { background-color: #b91c1c; }
.dot-sohu { background-color: #b45309; }
.dot-third_party, .dot-other { background-color: #64748b; }

.platform-label-text {
  font-size: 12px;
  color: #334155;
}

.table-status-badge {
  display: inline-block;
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: 3px;
  font-weight: 500;
  border: 1px solid transparent;
}

.status-ok { background-color: #f0fdf4; color: #166534; border-color: #bbf7d0; }
.status-warn { background-color: #fefce8; color: #854d0e; border-color: #fef08a; }
.status-err { background-color: #fef2f2; color: #991b1b; border-color: #fecaca; }

.table-account-text {
  font-size: 12px;
  color: #475569;
}

.table-timestamp-text {
  font-size: 12px;
  color: #64748b;
}

.table-actions-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.table-card-footer-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  margin-top: 6px;
  border-top: 1px solid #f1f5f9;
}

.footer-left-info {
  display: flex;
  align-items: center;
}

.footer-summary-text {
  font-size: 12.5px;
  color: #64748b;
}

/* 10. 实时操作流水日志面板（Slate 极简深色终端） */
.live-console-card {
  background-color: #ffffff;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.console-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.console-dot {
  width: 7px;
  height: 7px;
  background-color: #64748b;
  border-radius: 50%;
}

.console-dot.running {
  background-color: #15803d;
}

.console-sub {
  font-size: 12px;
  color: #64748b;
  margin-left: 6px;
}

.console-filters-group {
  display: flex;
  align-items: center;
}

.console-body {
  background-color: #0f172a;
  border-radius: 3px;
  padding: 10px;
  max-height: 220px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.console-log-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.console-log-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.5;
}

.log-time {
  color: #64748b;
  min-width: 60px;
}

.log-tag {
  padding: 0 4px;
  border-radius: 2px;
  font-size: 10px;
}

.tag-success { background-color: #064e3b; color: #6ee7b7; }
.tag-warning { background-color: #713f12; color: #fde047; }
.tag-danger { background-color: #7f1d1d; color: #fca5a5; }
.tag-info { background-color: #1e293b; color: #94a3b8; }

.log-platform {
  color: #38bdf8;
  font-weight: 500;
}

.log-action {
  color: #e2e8f0;
  font-weight: 500;
}

.log-msg {
  color: #94a3b8;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-detail {
  color: #64748b;
  font-size: 11px;
}

.console-empty {
  color: #475569;
  text-align: center;
  padding: 16px 0;
  font-size: 12px;
}

/* 11. 截图证据归档中心样式（网站分类 + 链接分组多图 + ZIP导出） */
.archive-main-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.archive-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.archive-platform-nav-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #cbd5e1;
  padding-bottom: 8px;
  margin-bottom: 14px;
  overflow-x: auto;
}

.archive-nav-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 3px;
  font-size: 12.5px;
  color: #475569;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}

.archive-nav-tab-item:hover {
  background-color: #f1f5f9;
  color: #0f172a;
}

.archive-nav-tab-item.active {
  background-color: #eff6ff;
  border-color: #1e3a8a;
  color: #1e3a8a;
  font-weight: 600;
}

.tab-badge {
  background-color: #e2e8f0;
  color: #475569;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 8px;
}

.archive-nav-tab-item.active .tab-badge {
  background-color: #dbeafe;
  color: #1e3a8a;
}

/* 分组模式卡片列表 */
.archive-group-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.archive-group-card {
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background-color: #ffffff;
  padding: 12px 14px;
}

.archive-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 10px;
}

.group-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow: hidden;
}

.group-plat-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11.5px;
}

.group-article-title {
  color: #0f172a;
  font-weight: 600;
  font-size: 13.5px;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.group-article-title:hover {
  color: #1e3a8a;
  text-decoration: underline;
}

.group-article-url {
  font-size: 11.5px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.group-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-count-pill {
  font-size: 11.5px;
  color: #475569;
  background-color: #f1f5f9;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
}

.group-count-pill strong {
  color: #1e3a8a;
}

/* 相册网格 */
.archive-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.archive-photo-card {
  position: relative;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  overflow: hidden;
  background-color: #f8fafc;
  display: flex;
  flex-direction: column;
}

.archive-photo-card:hover {
  border-color: #1e3a8a;
}

.archive-photo-card.selected {
  border-color: #1e3a8a;
  box-shadow: 0 0 0 1px #1e3a8a;
}

.photo-select-box {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 5;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 2px;
  padding: 1px 3px;
}

.photo-img-wrap {
  width: 100%;
  height: 100px;
  background-color: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-real-img {
  width: 100%;
  height: 100%;
  cursor: zoom-in;
}

.photo-meta-bar {
  padding: 6px 8px;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.photo-meta-time {
  font-size: 11px;
  color: #64748b;
}

.photo-comment-text {
  font-size: 11.5px;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.photo-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  border-top: 1px solid #f1f5f9;
  padding-top: 3px;
}

.archive-group-empty-state {
  padding: 16px;
  text-align: center;
  color: #64748b;
  font-size: 12.5px;
  background-color: #f8fafc;
  border-radius: 3px;
}

/* 12. 弹窗与设置 */
.detail-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13.5px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
}

.detail-label {
  width: 105px;
  color: #475569;
  font-weight: 500;
}

.detail-value {
  flex: 1;
  color: #0f172a;
  word-break: break-all;
}

.aiproxy-config-box {
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 12px 14px;
  margin-top: 8px;
  margin-bottom: 10px;
}

.aiproxy-desc-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12.5px;
  color: #334155;
}

.aiproxy-desc-block code {
  background-color: #e2e8f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}
</style>

/* ==============================================================
   飞书极简清爽风格规范 (Feishu Clean & Modern Design)
   基底淡灰白 #f7f8fa，卡片纯白 #ffffff，描边 #dee0e3 / #e5e6eb
   彻底告别沉重深蓝与杂乱大色块
============================================================== */

:root {
  --feishu-bg: #f7f8fa;
  --feishu-card-bg: #ffffff;
  --feishu-border: #dee0e3;
  --feishu-border-light: #e5e6eb;
  --feishu-text-primary: #1f2329;
  --feishu-text-secondary: #646a73;
  --feishu-text-muted: #8f959e;
  --feishu-blue: #3370ff;
  --feishu-blue-hover: #2860f0;
  --feishu-blue-light: #f0f4ff;
  --feishu-blue-border: #bbd3fb;
  --feishu-green: #00b42a;
  --feishu-green-light: #e8ffea;
  --feishu-amber: #ff7d00;
  --feishu-amber-light: #fff7e8;
  --feishu-red: #f53f3f;
  --feishu-red-light: #ffece8;
}

.dl-admin-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background-color: var(--feishu-bg) !important;
  color: var(--feishu-text-primary);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* 侧边栏：飞书纯白侧边栏、无厚重色 */
.dl-sidebar {
  width: 220px;
  min-width: 220px;
  background-color: var(--feishu-card-bg) !important;
  border-right: 1px solid var(--feishu-border-light) !important;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px 10px;
  flex-shrink: 0;
  z-index: 20;
}

.dl-sidebar-brand {
  padding: 4px 8px 12px 8px;
  border-bottom: 1px solid var(--feishu-border-light);
}

.brand-app-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--feishu-text-primary);
  letter-spacing: 0.3px;
}

.brand-app-slogan {
  font-size: 11px;
  color: var(--feishu-text-muted);
  margin-top: 2px;
}

.dl-sidebar-menu {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 10px;
  flex-shrink: 0;
}

.menu-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--feishu-text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.menu-nav-item:hover {
  background-color: #f2f3f5;
  color: var(--feishu-text-primary);
}

.menu-nav-item.active {
  background-color: var(--feishu-blue-light) !important;
  color: var(--feishu-blue) !important;
  font-weight: 600;
}

/* 左侧内嵌微型日志窗口 */
.sidebar-mini-log-card {
  margin-top: 10px;
  flex: 1;
  min-height: 120px;
  max-height: 280px;
  background-color: #f7f8fa !important;
  border: 1px solid #e5e6eb !important;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background-color: #f7f8fa !important;
  border-bottom: 1px solid #e5e6eb !important;
}

.sidebar-log-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: #1f2329 !important;
}

.sidebar-log-body {
  flex: 1;
  padding: 6px;
  overflow-y: auto;
  background-color: #ffffff !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
}

.sidebar-log-item {
  font-size: 11px !important;
  line-height: 1.4 !important;
  color: #1f2329 !important;
  word-break: break-all;
}

.sidebar-log-time {
  color: #646a73 !important;
  margin-right: 4px;
}

.sidebar-log-action {
  color: #1f2329 !important;
  margin-right: 3px;
  font-weight: 500;
}

.sidebar-log-msg {
  color: #1f2329 !important;
}

.sidebar-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background-color: #f7f8fa;
  border-bottom: 1px solid var(--feishu-border-light);
}

.sidebar-log-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--feishu-text-secondary);
}

.sidebar-pulse-dot {
  width: 6px;
  height: 6px;
  background-color: #10b981;
  border-radius: 50%;
}

.sidebar-pulse-dot.running {
  animation: pulse-dot 1.2s infinite;
}

.sidebar-log-actions {
  display: flex;
  gap: 6px;
}

.mini-text-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--feishu-text-muted);
  cursor: pointer;
  padding: 1px 3px;
}

.mini-text-btn:hover:not(:disabled) {
  color: var(--feishu-blue);
}

.mini-text-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-log-body {
  flex: 1;
  padding: 6px;
  overflow-y: auto;
  font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}

.sidebar-log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-log-item {
  font-size: 10.5px;
  line-height: 1.35;
  color: #4e5969;
  word-break: break-all;
}

.sidebar-log-item.log-error {
  color: var(--feishu-red);
}

.sidebar-log-item.log-warning {
  color: var(--feishu-amber);
}

.sidebar-log-time {
  color: var(--feishu-text-muted);
  margin-right: 4px;
}

.sidebar-log-action {
  color: var(--feishu-blue);
  margin-right: 3px;
  font-weight: 500;
}

.sidebar-log-empty {
  font-size: 11px;
  color: var(--feishu-text-muted);
  text-align: center;
  padding: 20px 0;
}

.dl-sidebar-footer {
  padding-top: 10px;
  border-top: 1px solid var(--feishu-border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--feishu-text-muted);
}

.footer-pulse-dot {
  width: 6px;
  height: 6px;
  background-color: #10b981;
  border-radius: 50%;
  display: inline-block;
  margin-right: 4px;
}

/* 飞书风格微型指标栏 (Slim Header) */
.feishu-slim-stats-bar {
  display: flex;
  align-items: center;
  background-color: var(--feishu-card-bg);
  border: 1px solid var(--feishu-border-light);
  border-radius: 4px;
  padding: 8px 16px;
  margin-bottom: 12px;
  gap: 16px;
}

.slim-stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.slim-stat-label {
  color: var(--feishu-text-secondary);
}

.slim-stat-val {
  font-size: 13.5px;
  color: var(--feishu-text-primary);
}

.slim-stat-divider {
  width: 1px;
  height: 14px;
  background-color: var(--feishu-border-light);
}

.text-feishu-green { color: var(--feishu-green) !important; }
.text-feishu-amber { color: var(--feishu-amber) !important; }
.text-feishu-red { color: var(--feishu-red) !important; }
.text-feishu-gray { color: var(--feishu-text-muted) !important; }

/* 飞书主卡片容器 */
.reference-main-card {
  background-color: var(--feishu-card-bg) !important;
  border: 1px solid var(--feishu-border-light) !important;
  border-radius: 4px !important;
  padding: 14px 16px !important;
  box-shadow: none !important;
}

/* 按钮全套飞书纯净无图标规范 */
.feishu-btn-primary {
  background-color: var(--feishu-blue) !important;
  border-color: var(--feishu-blue) !important;
  color: #ffffff !important;
  border-radius: 4px !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  padding: 7px 14px !important;
}

.feishu-btn-primary:hover {
  background-color: var(--feishu-blue-hover) !important;
  border-color: var(--feishu-blue-hover) !important;
}

.feishu-btn-default {
  background-color: #ffffff !important;
  border-color: var(--feishu-border) !important;
  color: var(--feishu-text-primary) !important;
  border-radius: 4px !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  padding: 7px 12px !important;
}

.feishu-btn-default:hover:not(:disabled) {
  background-color: #f7f8fa !important;
  border-color: #c9cdd4 !important;
}

.btn-selected-active {
  background-color: var(--feishu-blue-light) !important;
  border-color: var(--feishu-blue-border) !important;
  color: var(--feishu-blue) !important;
  font-weight: 500 !important;
}

/* 飞书风格表格 */
.feishu-clean-table :deep(.el-table__header-wrapper th) {
  background-color: #f7f8fa !important;
  color: var(--feishu-text-secondary) !important;
  font-weight: 500 !important;
  font-size: 12.5px !important;
  border-bottom: 1px solid var(--feishu-border-light) !important;
  padding: 8px 0 !important;
}

.feishu-clean-table :deep(.el-table__body-wrapper td) {
  padding: 9px 0 !important;
  border-bottom: 1px solid #f2f3f5 !important;
  color: var(--feishu-text-primary) !important;
}

.table-interaction-status-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.status-chip-sub {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--feishu-border-light);
  background-color: #f7f8fa;
  color: var(--feishu-text-secondary);
}

.status-chip-sub.chip-active {
  background-color: var(--feishu-green-light);
  color: var(--feishu-green);
  border-color: #aff0b5;
  font-weight: 500;
}

.status-chip-sub.chip-inactive {
  background-color: #f7f8fa;
  color: var(--feishu-text-muted);
}

.table-card-footer-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  margin-top: 8px;
  border-top: 1px solid var(--feishu-border-light);
}

.footer-summary-text {
  font-size: 12px;
  color: var(--feishu-text-muted);
}

/* 未完成行稍淡红高亮，字统一深黑 */
.unfinished-record-row td {
  background-color: #fff5f5 !important;
}

.invalid-record-row td {
  background-color: #fef0f0 !important;
}

.feishu-clean-table :deep(.el-table__body-wrapper td) {
  color: #1f2329 !important;
}

.table-article-title {
  color: #1f2329 !important;
  font-weight: 500;
  text-decoration: none;
}

.table-article-title:hover {
  color: #3370ff !important;
  text-decoration: underline;
}

.table-article-url {
  color: #646a73 !important;
}

.table-platform-chip .platform-label-text {
  color: #1f2329 !important;
}

.table-timestamp-text {
  color: #1f2329 !important;
}

.table-actions-row .el-button--link {
  font-size: 13px !important;
  padding: 0 4px !important;
}
<style scoped>

/* -------------------------------------------------------------
 * 2026-10-09 最新升级：实体按钮规范、经典指标卡片与淡白底纯黑字日志
 * ------------------------------------------------------------- */

/* 1. 经典指标卡片矩阵 (规整纯白底、纯黑醒目数字、浅灰线) */
.gov-metrics-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

.gov-metric-card {
  background-color: #ffffff;
  border: 1px solid #dee0e3;
  border-radius: 4px;
  padding: 12px 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.metric-card-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label-text {
  font-size: 12.5px;
  color: #646a73;
  font-weight: 400;
}

.metric-value-num {
  font-size: 20px;
  font-weight: 600;
  color: #1f2329 !important;
  line-height: 1.2;
}

.metric-value-num.text-black {
  color: #1f2329 !important;
}

.metric-value-num.text-danger {
  color: #d03050 !important;
}

/* 2. 顶部主操作按钮实体化规范 (纯白底/蓝底、精致边框、纯黑醒目文字) */
.feishu-btn-primary {
  background-color: #3370ff !important;
  border: 1px solid #3370ff !important;
  color: #ffffff !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  border-radius: 4px !important;
  padding: 8px 16px !important;
  box-shadow: 0 1px 2px rgba(51, 112, 255, 0.2) !important;
}

.feishu-btn-primary:hover {
  background-color: #2860f0 !important;
  border-color: #2860f0 !important;
}

.feishu-btn-default {
  background-color: #ffffff !important;
  border: 1px solid #c9cdd4 !important;
  color: #1f2329 !important; /* 强制纯黑色文字 */
  font-size: 13px !important;
  font-weight: 500 !important;
  border-radius: 4px !important;
  padding: 8px 14px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) !important;
}

.feishu-btn-default:hover:not(:disabled) {
  background-color: #f2f3f5 !important;
  border-color: #86909c !important;
  color: #000000 !important;
}

.feishu-btn-default:disabled {
  background-color: #f7f8fa !important;
  border-color: #e5e6eb !important;
  color: #8f959e !important;
  cursor: not-allowed !important;
}

.btn-selected-active {
  background-color: #e8f3ff !important;
  border-color: #3370ff !important;
  color: #3370ff !important;
  font-weight: 600 !important;
}

/* 3. 表格内操作列实体小按钮 (告别单薄文字链接) */
.table-actions-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  outline: none;
}

.row-action-btn.btn-like {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329;
}
.row-action-btn.btn-like:hover:not(:disabled) {
  background-color: #e8f3ff;
  border-color: #3370ff;
  color: #3370ff;
}

.row-action-btn.btn-comment {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329;
}
.row-action-btn.btn-comment:hover:not(:disabled) {
  background-color: #e8ffea;
  border-color: #00b42a;
  color: #00b42a;
}

.row-action-btn.btn-check {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329;
}
.row-action-btn.btn-check:hover:not(:disabled) {
  background-color: #f2f3f5;
  border-color: #4e5969;
  color: #000000;
}

.row-action-btn.btn-delete {
  background-color: #ffffff;
  border: 1px solid #fecaca;
  color: #d03050;
}
.row-action-btn.btn-delete:hover:not(:disabled) {
  background-color: #ffece8;
  border-color: #f53f3f;
  color: #f53f3f;
}

.row-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background-color: #f7f8fa !important;
  border-color: #e5e6eb !important;
  color: #8f959e !important;
}

/* 4. 表格主体纯黑文字加深 */
.feishu-clean-table {
  color: #1f2329 !important;
}

.feishu-clean-table :deep(.el-table__body-wrapper td) {
  color: #1f2329 !important;
  font-size: 13px !important;
}

.table-article-title {
  color: #1f2329 !important;
  font-weight: 500 !important;
  text-decoration: none;
}

.table-article-title:hover {
  color: #3370ff !important;
  text-decoration: underline;
}

.table-platform-chip .platform-label-text {
  color: #1f2329 !important;
  font-weight: 500;
}

.table-timestamp-text {
  color: #1f2329 !important;
  font-size: 12px;
}

.status-chip-sub.chip-active {
  background-color: #e8f3ff !important;
  border-color: #3370ff !important;
  color: #1f2329 !important;
  font-weight: 500;
}

.status-chip-sub.chip-inactive {
  background-color: #fff7e8 !important;
  border-color: #ff7d00 !important;
  color: #1f2329 !important;
}

/* 5. 位于底部的实时操作日志 (淡白底色、纯黑字体、高对比度) */
.live-console-card {
  background-color: #ffffff !important;
  border: 1px solid #dee0e3 !important;
  border-radius: 4px !important;
  padding: 16px !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.console-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.console-title-text {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}

.console-dot {
  width: 8px;
  height: 8px;
  background-color: #8f959e;
  border-radius: 50%;
  display: inline-block;
}

.console-dot.running {
  background-color: #00b42a;
  animation: pulse-dot 1.2s infinite;
}

.console-sub {
  font-size: 12px;
  color: #646a73;
}

.console-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gov-btn-small {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
}

.gov-btn-small:hover:not(:disabled) {
  background-color: #f2f3f5;
  border-color: #86909c;
}

.gov-btn-primary-small {
  background-color: #3370ff;
  border-color: #3370ff;
  color: #ffffff;
}

.gov-btn-primary-small:hover:not(:disabled) {
  background-color: #2860f0;
  border-color: #2860f0;
}

.console-body {
  background-color: #f7f8fa; /* 优雅淡白底色，与整体协调 */
  border: 1px solid #dee0e3;
  border-radius: 4px;
  padding: 12px;
  max-height: 240px;
  overflow-y: auto;
  font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}

.console-log-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.console-log-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #1f2329; /* 滚动的字体彻底纯黑 */
}

.console-log-row.log-error .log-msg {
  color: #d03050;
  font-weight: 500;
}

.console-log-row.log-warning .log-msg {
  color: #b45309;
}

.console-log-row .log-time {
  color: #646a73;
  font-size: 11px;
  min-width: 65px;
}

.console-log-row .log-plat {
  color: #3370ff;
  font-weight: 500;
}

.console-log-row .log-action {
  color: #1f2329;
  font-weight: 600;
}

.console-log-row .log-msg {
  color: #1f2329; /* 纯黑内容 */
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.console-log-row .log-url {
  color: #646a73;
  font-size: 11px;
}

</style>

<style scoped>

/* 顶栏居左标题 */
.topbar-left-brand-text {
  display: flex;
  align-items: center;
}
.topbar-title-bold {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}

/* 主操作按钮统一实体化规范 (纯白底、纯黑粗体字、浅灰实线边框) */
.gov-action-btn {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329 !important;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.gov-action-btn:hover:not(:disabled) {
  background-color: #f2f3f5;
  border-color: #86909c;
  color: #000000 !important;
}

.gov-action-btn:disabled {
  background-color: #f7f8fa !important;
  border-color: #e5e6eb !important;
  color: #8f959e !important;
  cursor: not-allowed;
  opacity: 0.6;
}

.gov-action-btn.btn-active {
  background-color: #e8f3ff !important;
  border-color: #3370ff !important;
  color: #3370ff !important;
  font-weight: 600 !important;
}

.gov-action-btn.btn-danger-action {
  border-color: #fecaca;
  color: #d03050 !important;
}

.gov-action-btn.btn-danger-action:hover:not(:disabled) {
  background-color: #ffece8;
  border-color: #f53f3f;
  color: #f53f3f !important;
}

/* 常驻批量导入底部按钮 */
.gov-mini-btn {
  background-color: #ffffff;
  border: 1px solid #c9cdd4;
  color: #1f2329;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
}

.gov-mini-btn:hover:not(:disabled) {
  background-color: #f2f3f5;
  border-color: #86909c;
}

.gov-mini-btn-primary {
  background-color: #3370ff !important;
  border-color: #3370ff !important;
  color: #ffffff !important;
}

.gov-mini-btn-primary:hover:not(:disabled) {
  background-color: #2860f0 !important;
  border-color: #2860f0 !important;
}

.gov-mini-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 截图证据归档中心样式与色彩全面统一 */
.archive-main-toolbar .el-button {
  background-color: #ffffff !important;
  border: 1px solid #c9cdd4 !important;
  color: #1f2329 !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  border-radius: 4px !important;
}

.archive-main-toolbar .el-button:hover:not(:disabled) {
  background-color: #f2f3f5 !important;
  border-color: #86909c !important;
}

.archive-main-toolbar .el-button--primary {
  background-color: #3370ff !important;
  border-color: #3370ff !important;
  color: #ffffff !important;
}

.archive-main-toolbar .el-button--primary:hover:not(:disabled) {
  background-color: #2860f0 !important;
  border-color: #2860f0 !important;
}

.archive-nav-tab-item {
  color: #1f2329 !important;
  border: 1px solid #dee0e3 !important;
  background-color: #ffffff !important;
  border-radius: 4px !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
}

.archive-nav-tab-item.active {
  background-color: #e8f3ff !important;
  border-color: #3370ff !important;
  color: #3370ff !important;
  font-weight: 600 !important;
}

.archive-group-card {
  border: 1px solid #dee0e3 !important;
  border-radius: 4px !important;
  background-color: #ffffff !important;
}

.group-article-title {
  color: #1f2329 !important;
  font-weight: 600 !important;
}

.archive-shot-card {
  border: 1px solid #dee0e3 !important;
  border-radius: 4px !important;
  background-color: #ffffff !important;
}

.shot-account-badge {
  color: #1f2329 !important;
  background-color: #f2f3f5 !important;
}

</style>

<style scoped>

/* 评论条数：不符合条件淡红背景、深红文字；符合条件轻淡纯净 */
.table-comment-num-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
}

.table-comment-num-badge.badge-qualified {
  background-color: #f7f8fa;
  border: 1px solid #e5e6eb;
  color: #1f2329;
}

.table-comment-num-badge.badge-unqualified {
  background-color: #fff1f0 !important; /* 优雅淡红色 */
  border: 1px solid #ffccc7 !important;
  color: #cf1322 !important; /* 醒目不刺眼的警示红 */
  font-weight: 600 !important;
}

/* 整行未达标置顶行的淡红高亮样式保持柔和 */
:deep(.el-table .row-unfinished-warning) {
  background-color: #fff9f9 !important;
}

</style>

<style scoped>

/* 表格轻质浅灰纵向与横向分割线 (淡色标准网格) */
.feishu-bordered-table {
  border: 1px solid #dee0e3 !important;
  border-radius: 4px;
}

.feishu-bordered-table :deep(th.el-table__cell) {
  border-right: 1px solid #e5e6eb !important;
  border-bottom: 1px solid #dee0e3 !important;
  background-color: #f7f8fa !important;
  color: #1f2329 !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  padding: 8px 0 !important;
}

.feishu-bordered-table :deep(td.el-table__cell) {
  border-right: 1px solid #f2f3f5 !important; /* 淡色纵向竖线 */
  border-bottom: 1px solid #f2f3f5 !important;
  padding: 8px 0 !important;
}

.feishu-bordered-table :deep(th.el-table__cell:last-child),
.feishu-bordered-table :deep(td.el-table__cell:last-child) {
  border-right: none !important;
}

/* 标题统一自动截断、规整对齐 */
.table-title-cell-fixed {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  overflow: hidden;
}

.table-article-title-truncated {
  display: block;
  width: 100%;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis; /* 超长自动缩略为 ... 保持整齐 */
  color: #1f2329 !important;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  line-height: 1.4;
}

.table-article-title-truncated:hover {
  color: #3370ff !important;
  text-decoration: underline;
}

.table-article-url-truncated {
  display: block;
  width: 100%;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: #8f959e;
}

</style>

<style scoped>

/* 系统设置页面整体极简规范 */
.settings-page-content .reference-main-card {
  border: 1px solid #dee0e3 !important;
  border-radius: 4px !important;
  background-color: #ffffff !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03) !important;
  margin-bottom: 16px !important;
}

.settings-page-content .card-headline-title {
  color: #1f2329 !important;
  font-size: 14.5px !important;
  font-weight: 600 !important;
}

.settings-page-content .card-headline-title svg,
.settings-page-content .card-headline-title span.emoji {
  display: none !important; /* 彻底去除多余花哨图标 */
}

.settings-page-content .el-form-item__label {
  color: #1f2329 !important;
  font-weight: 500 !important;
  font-size: 13px !important;
}

.settings-page-content .el-button--primary {
  background-color: #3370ff !important;
  border-color: #3370ff !important;
  color: #ffffff !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  border-radius: 4px !important;
  padding: 8px 16px !important;
}

.settings-page-content .el-button--primary:hover:not(:disabled) {
  background-color: #2860f0 !important;
  border-color: #2860f0 !important;
}

.settings-page-content .el-button:not(.el-button--primary) {
  background-color: #ffffff !important;
  border: 1px solid #c9cdd4 !important;
  color: #1f2329 !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  border-radius: 4px !important;
}

.settings-page-content .el-button:not(.el-button--primary):hover:not(:disabled) {
  background-color: #f2f3f5 !important;
  border-color: #86909c !important;
}

.settings-page-content .config-section-title {
  color: #1f2329 !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  border-left: 3px solid #3370ff !important;
  padding-left: 8px !important;
  margin: 12px 0 !important;
}

.settings-page-content .el-alert {
  border: 1px solid #dee0e3 !important;
  background-color: #f7f8fa !important;
  border-radius: 4px !important;
  color: #1f2329 !important;
}

.settings-page-content .el-alert__title {
  color: #1f2329 !important;
  font-weight: 500 !important;
}

</style>

<style scoped>

/* -------------------------------------------------------------
 * 评论生成与大模型配置 规范极简重构样式
 * ------------------------------------------------------------- */
.settings-module-card {
  padding: 18px 20px !important;
}

.module-card-header {
  margin-bottom: 14px;
}

.module-card-title {
  margin: 0 0 4px 0;
  color: #1f2329;
  font-size: 15px;
  font-weight: 600;
}

.module-card-subtitle {
  font-size: 12.5px;
  color: #646a73;
}

.settings-sub-panel {
  background-color: #f7f8fa;
  border: 1px solid #dee0e3;
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.panel-mode-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.panel-divider-top {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #dee0e3;
}

.panel-mode-info .mode-item-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
}

.panel-mode-info .mode-item-desc {
  font-size: 12px;
  color: #8f959e;
  margin-top: 2px;
}

/* AIProxy 专区 */
.aiproxy-box-clean {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #f7f8fa;
  border: 1px solid #dee0e3;
  border-radius: 4px;
  padding: 12px 16px;
  margin: 6px 0 14px 0;
  gap: 16px;
}

.aiproxy-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
}

.aiproxy-desc {
  font-size: 12px;
  color: #646a73;
  margin-top: 3px;
}

.aiproxy-action-col {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}

.aiproxy-status-tag {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
  font-weight: 500;
}

.aiproxy-status-tag.tag-ready {
  background-color: #e8ffea;
  color: #00b42a;
  border: 1px solid #b7eb8f;
}

.aiproxy-status-tag.tag-waiting {
  background-color: #fff7e8;
  color: #ff7d00;
  border: 1px solid #ffd591;
}

/* 底部按钮栏 */
.ai-form-bottom-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid #f2f3f5;
  margin-top: 8px;
}

.bottom-actions-right {
  display: flex;
  gap: 8px;
}

.btn-primary-highlight {
  background-color: #3370ff !important;
  border-color: #3370ff !important;
  color: #ffffff !important;
  font-weight: 500 !important;
}

.btn-primary-highlight:hover:not(:disabled) {
  background-color: #2860f0 !important;
  border-color: #2860f0 !important;
}

/* 无 Key 模板区 */
.template-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.template-rule-text {
  font-size: 12.5px;
  color: #646a73;
}

.template-counter-tag {
  font-size: 12px;
  color: #1f2329;
  font-weight: 500;
  background-color: #f7f8fa;
  border: 1px solid #dee0e3;
  padding: 2px 8px;
  border-radius: 3px;
}

.template-bottom-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

/* 诊断日志与问题反馈卡片（系统设置） */
.diag-log-stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.diag-log-stat {
  font-size: 12px;
  color: #475569;
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 4px 10px;
}

.diag-log-stat b {
  color: #1e3a8a;
  font-weight: 600;
}

.diag-log-btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.diag-log-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #166534;
  background-color: #f0fdf4;
  border: 1px solid #dcfce7;
  border-radius: 3px;
  padding: 6px 10px;
  word-break: break-all;
}

</style>
