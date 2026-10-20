<template>
  <main class="popup-shell">
    <div class="brand-mark" aria-hidden="true">DL</div>
    <h1>DL评论助手</h1>
    <p>评论检测、扫描记录和智能补齐均在数据中心完成</p>
    <el-button type="primary" size="large" class="dashboard-button" @click="openDashboard">
      打开数据中心
    </el-button>
  </main>
</template>

<script setup lang="ts">
function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') })
  window.close()
}
</script>

<style scoped>
.popup-shell {
  box-sizing: border-box;
  width: 300px;
  padding: 26px 24px 22px;
  text-align: center;
  background: linear-gradient(160deg, #f7fbff 0%, #ffffff 58%);
  color: #253858;
}
.brand-mark {
  width: 48px;
  height: 48px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: linear-gradient(135deg, #409eff, #2676d9);
  box-shadow: 0 8px 20px rgba(64, 158, 255, .24);
  color: #fff;
  font-size: 22px;
  font-weight: 800;
}
h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
  letter-spacing: .2px;
}
p {
  margin: 9px 0 20px;
  color: #7a869a;
  font-size: 12px;
  line-height: 1.7;
}
.dashboard-button {
  width: 100%;
  height: 42px;
  border-radius: 10px;
  font-weight: 600;
}
</style>
