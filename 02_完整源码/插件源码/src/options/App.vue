<template>
  <div class="options-container">
    <div class="options-card">
      <div class="options-header">
        <div class="brand-avatar">DL</div>
        <div>
          <h1 class="options-title">DL评论助手 · 账号设置</h1>
          <p class="options-subtitle">设置各平台显示账号名称（自动检测失败或需要手动优先时使用）</p>
        </div>
      </div>

      <el-alert
        title="设置提示：手动填写的账号名称优先级最高。若页面自动提取失效或多账号切换，系统将优先采用此处配置。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      />

      <el-form label-position="top" class="options-form">
        <div class="platform-grid">
          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag csdn">CSDN</span>
              <span>CSDN 用户名 / 账号 ID</span>
            </div>
            <el-input v-model="usernames.csdn" placeholder="请输入 CSDN 显示名称或用户 ID" clearable />
          </div>

          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag zhihu">知乎</span>
              <span>知乎账号名称</span>
            </div>
            <el-input v-model="usernames.zhihu" placeholder="请输入知乎显示昵称" clearable />
          </div>

          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag toutiao">头条</span>
              <span>今日头条账号名称</span>
            </div>
            <el-input v-model="usernames.toutiao" placeholder="请输入今日头条作者/用户昵称" clearable />
          </div>

          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag baijiahao">百家号</span>
              <span>百家号账号名称</span>
            </div>
            <el-input v-model="usernames.baijiahao" placeholder="请输入百家号作者名称" clearable />
          </div>

          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag netease">网易</span>
              <span>网易新闻跟贴昵称</span>
            </div>
            <el-input v-model="usernames.netease" placeholder="请输入网易跟贴显示昵称" clearable />
          </div>

          <div class="platform-item">
            <div class="platform-label">
              <span class="platform-tag sohu">搜狐</span>
              <span>搜狐账号名称</span>
            </div>
            <el-input v-model="usernames.sohu" placeholder="请输入搜狐显示昵称" clearable />
          </div>
        </div>

        <div class="options-actions">
          <el-button type="primary" size="large" :loading="saving" @click="save" class="save-btn">
            保存设置
          </el-button>
          <el-button size="large" @click="openDashboard">
            前往数据中心
          </el-button>
        </div>
      </el-form>

      <transition name="el-fade-in">
        <div v-if="saved" style="margin-top: 16px;">
          <el-alert title="设置已成功保存并同步到插件！" type="success" show-icon :closable="true" @close="saved = false" />
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const usernames = ref({
  csdn: '',
  zhihu: '',
  toutiao: '',
  baijiahao: '',
  netease: '',
  sohu: '',
})
const saved = ref(false)
const saving = ref(false)

async function load() {
  const data = await chrome.storage.sync.get('usernames')
  if (data.usernames) {
    usernames.value = { ...usernames.value, ...data.usernames }
  }
}

async function save() {
  saving.value = true
  try {
    const normalized = Object.fromEntries(
      Object.entries(usernames.value).map(([k, v]) => [k, (v || '').trim()]),
    )
    usernames.value = normalized as typeof usernames.value
    await chrome.storage.sync.set({ usernames: normalized })
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } finally {
    saving.value = false
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') })
}

onMounted(load)
</script>

<style>
body {
  margin: 0;
  background: linear-gradient(135deg, #f4f7fb 0%, #e9edf3 100%);
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
  color: #2c3e50;
}
.options-container {
  max-width: 680px;
  margin: 40px auto;
  padding: 0 20px 40px;
}
.options-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 28px 32px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03);
  border: 1px solid #eef2f7;
}
.options-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f3f7;
}
.brand-avatar {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: linear-gradient(135deg, #409eff, #1976d2);
  color: #ffffff;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 20px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
  flex-shrink: 0;
}
.options-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #1a2a3a;
}
.options-subtitle {
  margin: 4px 0 0;
  color: #7f8c9d;
  font-size: 13px;
  line-height: 1.5;
}
.platform-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 20px;
  margin-bottom: 24px;
}
@media (max-width: 600px) {
  .platform-grid {
    grid-template-columns: 1fr;
  }
}
.platform-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.platform-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #4a5568;
}
.platform-tag {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #909399;
}
.platform-tag.csdn { background: #fc5531; }
.platform-tag.zhihu { background: #0084ff; }
.platform-tag.toutiao { background: #f04142; }
.platform-tag.baijiahao { background: #2932e1; }
.platform-tag.netease { background: #e02424; }
.platform-tag.sohu { background: #e3a008; }

.options-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #f0f3f7;
}
.save-btn {
  min-width: 140px;
}
</style>
