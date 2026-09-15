import "./styles.css";
import taxonomy from "./taxonomy.json";

// Keep the original database key so upgrading users do not lose their local library.
const DB_NAME = "personal-asset-box";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TAG_GROUPS = taxonomy.groups;
const CONTROLLED_TAGS = TAG_GROUPS.flatMap((group) => group.tags);
const CONTROLLED_TAG_SET = new Set(CONTROLLED_TAGS);
const TAG_GROUP_BY_TAG = new Map(TAG_GROUPS.flatMap((group) => group.tags.map((tag) => [tag, group.label])));

const state = {
  assets: [],
  selectedId: null,
  selectedTags: new Set(),
  pendingOnly: false,
  query: "",
  objectUrls: new Map(),
  recentTags: JSON.parse(localStorage.getItem("musetag-recent-tags") || "[]"),
};

document.querySelector("#app").innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <div class="brand-mark">M</div>
        <div><h1>MuseTag</h1><p>让灵感自动归位</p></div>
      </div>
      <label class="search-wrap">
        <span>⌕</span>
        <input id="search" type="search" aria-label="搜索素材" placeholder="搜索文件名、标签或备注" autocomplete="off" />
      </label>
      <div class="top-actions">
        <span class="ai-mode"><i></i>AI 自动标签</span>
        <button id="backupButton" class="button quiet">导出备份</button>
        <label class="button quiet">恢复备份<input id="restoreInput" type="file" accept="application/json,.json" hidden /></label>
        <label class="button primary">导入图片<input id="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden /></label>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar panel">
        <nav class="library-nav">
          <button class="nav-item active" data-view="all"><span>全部素材</span><b id="allCount">0</b></button>
          <button class="nav-item" data-view="pending"><span>待整理</span><b id="pendingCount">0</b></button>
        </nav>
        <div class="section-heading"><span>按标签筛选</span><button id="clearFilters" class="text-button">清除</button></div>
        <div id="tagFilters" class="tag-filters"></div>
        <p class="storage-note">素材库保存在当前浏览器；AI 分析时，当前图片会发送到你配置的 OpenAI API。请定期备份。</p>
      </aside>

      <section class="library panel">
        <div id="dropzone" class="dropzone" role="button" tabindex="0" aria-label="导入图片">
          <strong>把图片拖到这里，AI 会自动看图</strong>
          <span>推荐 5～8 个规范标签，你只需确认或删除</span>
        </div>
        <div class="library-heading">
          <div><h2 id="resultTitle">全部素材</h2><p id="resultMeta">0 张图片</p></div>
          <div id="activeFilters" class="active-filters"></div>
        </div>
        <div id="assetGrid" class="asset-grid"></div>
        <div id="emptyState" class="empty-state" hidden>
          <div class="empty-icon">▧</div>
          <h3>MuseTag 还是空的</h3>
          <p>拖入图片，AI 会先推荐标签，再由你确认保存。</p>
        </div>
      </section>

      <aside id="detailPanel" class="detail panel">
        <div class="detail-empty"><span>↖</span><p>选择一张素材后，可在这里确认 AI 推荐标签。</p></div>
      </aside>
    </main>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <dialog id="previewDialog" class="preview-dialog"><button id="closePreview" aria-label="关闭">×</button><img id="previewImage" alt="素材大图预览" /></dialog>
  </div>
`;

const elements = {
  search: document.querySelector("#search"),
  fileInput: document.querySelector("#fileInput"),
  restoreInput: document.querySelector("#restoreInput"),
  backupButton: document.querySelector("#backupButton"),
  dropzone: document.querySelector("#dropzone"),
  allCount: document.querySelector("#allCount"),
  pendingCount: document.querySelector("#pendingCount"),
  tagFilters: document.querySelector("#tagFilters"),
  clearFilters: document.querySelector("#clearFilters"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  activeFilters: document.querySelector("#activeFilters"),
  assetGrid: document.querySelector("#assetGrid"),
  emptyState: document.querySelector("#emptyState"),
  detailPanel: document.querySelector("#detailPanel"),
  toast: document.querySelector("#toast"),
  previewDialog: document.querySelector("#previewDialog"),
  previewImage: document.querySelector("#previewImage"),
  closePreview: document.querySelector("#closePreview"),
};

let dbPromise;

function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function getAllAssets() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAsset(asset) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(asset);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function saveManyAssets(assets) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    assets.forEach((asset) => store.put(asset));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function removeAsset(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getObjectUrl(asset) {
  if (!state.objectUrls.has(asset.id)) {
    state.objectUrls.set(asset.id, URL.createObjectURL(asset.blob));
  }
  return state.objectUrls.get(asset.id);
}

function revokeObjectUrl(id) {
  const url = state.objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.objectUrls.delete(id);
}

function showToast(message, kind = "success") {
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function normalizeTag(value) {
  return value.trim().replace(/\s+/g, " ");
}

function rememberTags(tags) {
  state.recentTags = [...tags, ...state.recentTags.filter((tag) => !tags.includes(tag))].slice(0, 8);
  localStorage.setItem("musetag-recent-tags", JSON.stringify(state.recentTags));
}

function allTagsWithCounts() {
  const counts = new Map();
  state.assets.forEach((asset) => (asset.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function filteredAssets() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  return state.assets.filter((asset) => {
    if (state.pendingOnly && asset.tags.length > 0) return false;
    if ([...state.selectedTags].some((tag) => !asset.tags.includes(tag))) return false;
    if (!query) return true;
    const haystack = [asset.name, asset.note, asset.sourceUrl, ...asset.tags].join(" ").toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function render() {
  const pendingCount = state.assets.filter((asset) => asset.tags.length === 0).length;
  elements.allCount.textContent = state.assets.length;
  elements.pendingCount.textContent = pendingCount;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === (state.pendingOnly ? "pending" : "all"));
  });

  renderTagFilters();
  renderGrid();
  renderDetail();
}

function renderTagFilters() {
  elements.tagFilters.replaceChildren();
  const tags = allTagsWithCounts();
  if (!tags.length) {
    const hint = document.createElement("p");
    hint.className = "muted-copy";
    hint.textContent = "添加标签后，会在这里出现。";
    elements.tagFilters.append(hint);
  }
  tags.forEach(([tag, count]) => {
    const button = makeButton(tag, `filter-tag${state.selectedTags.has(tag) ? " selected" : ""}`, () => {
      state.selectedTags.has(tag) ? state.selectedTags.delete(tag) : state.selectedTags.add(tag);
      render();
    });
    const badge = document.createElement("span");
    badge.textContent = count;
    button.append(badge);
    elements.tagFilters.append(button);
  });

  elements.activeFilters.replaceChildren();
  [...state.selectedTags].forEach((tag) => {
    elements.activeFilters.append(makeButton(`${tag} ×`, "active-filter", () => {
      state.selectedTags.delete(tag);
      render();
    }));
  });
}

function renderGrid() {
  const assets = filteredAssets().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  elements.resultTitle.textContent = state.pendingOnly ? "待整理" : state.selectedTags.size ? "筛选结果" : "全部素材";
  elements.resultMeta.textContent = `${assets.length} 张图片`;
  elements.assetGrid.replaceChildren();
  elements.emptyState.hidden = assets.length > 0;

  assets.forEach((asset) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `asset-card${asset.id === state.selectedId ? " selected" : ""}`;
    const imageWrap = document.createElement("span");
    imageWrap.className = "thumb-wrap";
    const image = document.createElement("img");
    image.src = getObjectUrl(asset);
    image.alt = asset.name;
    image.loading = "lazy";
    imageWrap.append(image);
    if (asset.aiStatus === "analyzing" || asset.aiStatus === "queued") {
      const pending = document.createElement("span");
      pending.className = "pending-badge analyzing";
      pending.textContent = "AI 分析中";
      imageWrap.append(pending);
    } else if (asset.aiStatus === "ready") {
      const pending = document.createElement("span");
      pending.className = "pending-badge ready";
      pending.textContent = "待确认";
      imageWrap.append(pending);
    } else if (asset.aiStatus === "error") {
      const pending = document.createElement("span");
      pending.className = "pending-badge error";
      pending.textContent = "需重试";
      imageWrap.append(pending);
    } else if (asset.tags.length === 0) {
      const pending = document.createElement("span");
      pending.className = "pending-badge";
      pending.textContent = "待整理";
      imageWrap.append(pending);
    }
    const info = document.createElement("span");
    info.className = "card-info";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const tagLine = document.createElement("span");
    const visibleTags = asset.aiStatus === "ready" ? asset.suggestedTags : asset.tags;
    tagLine.textContent = visibleTags.slice(0, 3).join(" · ") || "还没有标签";
    info.append(name, tagLine);
    card.append(imageWrap, info);
    card.addEventListener("click", () => {
      state.selectedId = asset.id;
      render();
    });
    elements.assetGrid.append(card);
  });
}

function renderDetail() {
  const asset = state.assets.find((item) => item.id === state.selectedId);
  elements.detailPanel.replaceChildren();
  if (!asset) {
    const empty = document.createElement("div");
    empty.className = "detail-empty";
    const icon = document.createElement("span");
    icon.textContent = "↖";
    const copy = document.createElement("p");
    copy.textContent = "选择一张素材后，可在这里确认 AI 推荐标签。";
    empty.append(icon, copy);
    elements.detailPanel.append(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "detail-heading";
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = asset.aiStatus === "ready" ? "等待你的确认" : "素材详情";
  const title = document.createElement("h2");
  title.textContent = asset.name;
  titleBlock.append(eyebrow, title);
  const close = makeButton("×", "icon-button", () => {
    state.selectedId = null;
    render();
  });
  header.append(titleBlock, close);

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "detail-preview";
  const previewImg = document.createElement("img");
  previewImg.src = getObjectUrl(asset);
  previewImg.alt = asset.name;
  const previewHint = document.createElement("span");
  previewHint.textContent = "查看大图";
  preview.append(previewImg, previewHint);
  preview.addEventListener("click", () => openPreview(asset));

  const form = document.createElement("form");
  form.className = "detail-form";
  form.addEventListener("submit", (event) => event.preventDefault());
  const currentTags = [...(asset.aiStatus === "ready" ? asset.suggestedTags : asset.tags)];

  const aiPanel = document.createElement("div");
  aiPanel.className = `ai-status ${asset.aiStatus || "confirmed"}`;
  const aiCopy = document.createElement("div");
  const aiTitle = document.createElement("strong");
  const aiText = document.createElement("span");
  if (asset.aiStatus === "analyzing" || asset.aiStatus === "queued") {
    aiTitle.textContent = "AI 正在匹配规范标签";
    aiText.textContent = "只会从内置标签库中选择 5～8 个词。";
    const spinner = document.createElement("i");
    spinner.className = "spinner";
    aiPanel.append(spinner);
  } else if (asset.aiStatus === "ready") {
    aiTitle.textContent = `AI 推荐了 ${asset.suggestedTags.length} 个标签`;
    aiText.textContent = "删除不合适的；确认前不会写入正式标签。";
  } else if (asset.aiStatus === "error") {
    aiTitle.textContent = "AI 暂时没有完成识别";
    aiText.textContent = asset.aiError || "请检查 API Key 或网络连接。";
    aiPanel.append(makeButton("重新识别", "button compact", () => requestAiTags(asset.id)));
  } else {
    aiTitle.textContent = "标签已确认";
    aiText.textContent = "需要时可从下方规范词库补充或删除。";
  }
  aiCopy.append(aiTitle, aiText);
  aiPanel.prepend(aiCopy);

  const tagsField = document.createElement("div");
  tagsField.className = "field";
  const tagsLabel = document.createElement("label");
  tagsLabel.textContent = asset.aiStatus === "ready" ? "确认 AI 推荐标签" : "规范标签";
  const chips = document.createElement("div");
  chips.className = "editable-tags";
  const quickTitle = document.createElement("span");
  quickTitle.className = "field-help";
  quickTitle.textContent = "需要时从标签库补充；不支持临时造词，避免近义标签越积越乱。";
  const taxonomyPicker = document.createElement("div");
  taxonomyPicker.className = "taxonomy-picker";
  const taxonomyDetails = document.createElement("details");
  taxonomyDetails.className = "optional-panel";
  const taxonomySummary = document.createElement("summary");
  taxonomySummary.textContent = "缺少标签时，从规范词库补充";

  function drawEditableTags() {
    chips.replaceChildren();
    if (!currentTags.length) {
      const hint = document.createElement("span");
      hint.className = "no-tags";
      hint.textContent = "暂未选择标签";
      chips.append(hint);
    }
    currentTags.forEach((tag) => {
      const group = TAG_GROUP_BY_TAG.get(tag);
      const button = makeButton(`${tag} ×`, "tag-chip", () => {
        currentTags.splice(currentTags.indexOf(tag), 1);
        drawEditableTags();
        drawTaxonomy();
      });
      if (group) button.title = group;
      chips.append(button);
    });
  }

  function toggleTag(tag) {
    const clean = normalizeTag(tag);
    if (!CONTROLLED_TAG_SET.has(clean)) return;
    if (currentTags.includes(clean)) currentTags.splice(currentTags.indexOf(clean), 1);
    else if (currentTags.length < 8) currentTags.push(clean);
    else showToast("每张素材最多保留 8 个标签", "error");
    drawEditableTags();
    drawTaxonomy();
  }

  function drawTaxonomy() {
    taxonomyPicker.replaceChildren();
    TAG_GROUPS.forEach((group) => {
      const section = document.createElement("section");
      section.className = "taxonomy-group";
      const heading = document.createElement("h4");
      heading.textContent = group.label;
      const options = document.createElement("div");
      options.className = "quick-tags";
      group.tags.forEach((tag) => {
        options.append(makeButton(tag, `quick-tag${currentTags.includes(tag) ? " chosen" : ""}`, () => toggleTag(tag)));
      });
      section.append(heading, options);
      taxonomyPicker.append(section);
    });
  }

  drawEditableTags();
  drawTaxonomy();
  taxonomyDetails.append(taxonomySummary, quickTitle, taxonomyPicker);
  tagsField.append(tagsLabel, chips, taxonomyDetails);

  const noteField = makeTextField("备注（选填）", "记下为什么收藏它，例如：喜欢靠窗的侧光", asset.note, "textarea");
  const sourceField = makeTextField("来源链接（选填）", "https://", asset.sourceUrl, "input");
  const metadataDetails = document.createElement("details");
  metadataDetails.className = "optional-panel metadata-panel";
  const metadataSummary = document.createElement("summary");
  metadataSummary.textContent = "备注与来源（选填）";
  metadataDetails.append(metadataSummary, noteField.wrapper, sourceField.wrapper);
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const saveButton = makeButton(asset.aiStatus === "ready" ? "确认标签并完成" : "保存修改", "button primary grow", async () => {
    saveButton.disabled = true;
    try {
      const updated = {
        ...asset,
        tags: [...currentTags],
        suggestedTags: [],
        aiStatus: "confirmed",
        aiError: "",
        note: noteField.control.value.trim(),
        sourceUrl: sourceField.control.value.trim(),
        updatedAt: new Date().toISOString(),
      };
      await saveAsset(updated);
      const index = state.assets.findIndex((item) => item.id === asset.id);
      state.assets[index] = updated;
      rememberTags(updated.tags);
      showToast(asset.aiStatus === "ready" ? "标签已确认，整理完成" : "修改已保存");
      render();
    } catch (error) {
      console.error(error);
      showToast("保存失败，请检查浏览器存储空间", "error");
      saveButton.disabled = false;
    }
  });
  const exportButton = makeButton("导出原图", "button quiet", () => downloadBlob(asset.blob, asset.name));
  actions.append(saveButton, exportButton);

  const danger = makeButton("删除库内素材", "danger-button", async () => {
    if (!window.confirm(`确定从 MuseTag 删除“${asset.name}”吗？来源文件不会被删除。`)) return;
    try {
      await removeAsset(asset.id);
      revokeObjectUrl(asset.id);
      state.assets = state.assets.filter((item) => item.id !== asset.id);
      state.selectedId = null;
      showToast("已从 MuseTag 删除");
      render();
    } catch (error) {
      console.error(error);
      showToast("删除失败", "error");
    }
  });

  form.append(aiPanel, tagsField, metadataDetails, actions, danger);
  elements.detailPanel.append(header, preview, form);
}

function makeTextField(labelText, placeholder, value, type) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const control = document.createElement(type);
  control.value = value || "";
  control.placeholder = placeholder;
  if (type === "textarea") control.rows = 3;
  wrapper.append(label, control);
  return { wrapper, control };
}

async function importFiles(fileList) {
  const files = [...fileList];
  const valid = files.filter((file) => ACCEPTED_TYPES.has(file.type));
  const skippedCount = files.length - valid.length;
  if (!valid.length) {
    showToast("请选择 JPG、PNG 或 WebP 图片", "error");
    return;
  }
  const now = new Date().toISOString();
  const imported = valid.map((file, index) => ({
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: new Date(Date.now() + index).toISOString() || now,
    updatedAt: now,
    tags: [],
    suggestedTags: [],
    aiStatus: "queued",
    aiError: "",
    note: "",
    sourceUrl: "",
    blob: file,
  }));
  try {
    await saveManyAssets(imported);
    state.assets.push(...imported);
    state.selectedId = imported[0].id;
    const skippedText = skippedCount ? `，另有 ${skippedCount} 个不支持的文件已跳过` : "";
    showToast(`已导入 ${imported.length} 张图片${skippedText}，AI 正在推荐标签`);
    render();
    void analyzeImportedAssets(imported.map((asset) => asset.id));
  } catch (error) {
    console.error(error);
    showToast("导入失败，请检查浏览器存储空间", "error");
  } finally {
    elements.fileInput.value = "";
  }
}

function openPreview(asset) {
  elements.previewImage.src = getObjectUrl(asset);
  elements.previewImage.alt = asset.name;
  elements.previewDialog.showModal();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function requestAiTags(assetId) {
  const index = state.assets.findIndex((item) => item.id === assetId);
  if (index < 0) return;
  const asset = state.assets[index];
  const analyzing = { ...asset, aiStatus: "analyzing", aiError: "" };
  state.assets[index] = analyzing;
  await saveAsset(analyzing);
  render();

  try {
    const imageDataUrl = await blobToDataUrl(analyzing.blob);
    const response = await fetch("/api/suggest-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl,
        existingTags: allTagsWithCounts().map(([tag]) => tag).filter((tag) => CONTROLLED_TAG_SET.has(tag)),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "AI 标签服务暂时不可用");
    const suggestedTags = [...new Set(payload.tags)].filter((tag) => CONTROLLED_TAG_SET.has(tag)).slice(0, 8);
    if (suggestedTags.length < 5) throw new Error("AI 返回的规范标签不足 5 个，请重试");

    const currentIndex = state.assets.findIndex((item) => item.id === assetId);
    if (currentIndex < 0) return;
    const ready = {
      ...state.assets[currentIndex],
      suggestedTags,
      aiStatus: "ready",
      aiError: "",
      aiModel: payload.model || "",
      updatedAt: new Date().toISOString(),
    };
    await saveAsset(ready);
    state.assets[currentIndex] = ready;
    showToast(`AI 已推荐 ${suggestedTags.length} 个规范标签，请确认`);
    render();
  } catch (error) {
    console.error(error);
    const currentIndex = state.assets.findIndex((item) => item.id === assetId);
    if (currentIndex < 0) return;
    const failed = {
      ...state.assets[currentIndex],
      aiStatus: "error",
      aiError: error.message || "AI 标签服务暂时不可用",
      updatedAt: new Date().toISOString(),
    };
    await saveAsset(failed);
    state.assets[currentIndex] = failed;
    showToast("AI 识别失败，可重试或手动选择规范标签", "error");
    render();
  }
}

async function analyzeImportedAssets(assetIds) {
  for (const assetId of assetIds) {
    await requestAiTags(assetId);
  }
}

async function exportBackup() {
  elements.backupButton.disabled = true;
  elements.backupButton.textContent = "正在备份…";
  try {
    const assets = [];
    for (const asset of state.assets) {
      const { blob, ...metadata } = asset;
      assets.push({ ...metadata, dataUrl: await blobToDataUrl(blob) });
    }
    const backup = {
      format: "personal-asset-box-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      assets,
    };
    const filename = `MuseTag完整备份-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), filename);
    showToast(`完整备份已导出，共 ${assets.length} 张图片`);
  } catch (error) {
    console.error(error);
    showToast("备份导出失败", "error");
  } finally {
    elements.backupButton.disabled = false;
    elements.backupButton.textContent = "导出备份";
  }
}

async function restoreBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "personal-asset-box-backup" || backup.version !== 1 || !Array.isArray(backup.assets)) {
      throw new Error("Invalid backup format");
    }
    if (!window.confirm(`将从备份合并 ${backup.assets.length} 张图片；相同 ID 的素材会被备份内容覆盖。继续吗？`)) return;
    const restored = [];
    for (const item of backup.assets) {
      if (!item.id || typeof item.name !== "string" || !Array.isArray(item.tags) || typeof item.dataUrl !== "string") {
        throw new Error("Invalid asset entry");
      }
      const response = await fetch(item.dataUrl);
      const blob = await response.blob();
      if (!ACCEPTED_TYPES.has(blob.type)) throw new Error("Unsupported image type");
      const { dataUrl, ...metadata } = item;
      restored.push({ ...metadata, blob, type: blob.type, size: blob.size });
    }
    await saveManyAssets(restored);
    await refreshAssets();
    showToast(`已恢复 ${restored.length} 张图片及其标签和备注`);
  } catch (error) {
    console.error(error);
    showToast("恢复失败：这不是有效的素材盒备份", "error");
  } finally {
    elements.restoreInput.value = "";
  }
}

async function refreshAssets() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls.clear();
  state.assets = (await getAllAssets()).map((asset) => ({
    ...asset,
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    suggestedTags: Array.isArray(asset.suggestedTags) ? asset.suggestedTags : [],
    aiStatus: asset.aiStatus || "confirmed",
    aiError: asset.aiError || "",
  }));
  if (state.selectedId && !state.assets.some((asset) => asset.id === state.selectedId)) state.selectedId = null;
  render();
}

elements.fileInput.addEventListener("change", () => importFiles(elements.fileInput.files));
elements.restoreInput.addEventListener("change", () => {
  const [file] = elements.restoreInput.files;
  if (file) restoreBackup(file);
});
elements.backupButton.addEventListener("click", exportBackup);
elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderGrid();
});
elements.clearFilters.addEventListener("click", () => {
  state.selectedTags.clear();
  state.pendingOnly = false;
  render();
});
document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => {
  state.pendingOnly = item.dataset.view === "pending";
  render();
}));

["dragenter", "dragover"].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragging");
}));
elements.dropzone.addEventListener("drop", (event) => importFiles(event.dataTransfer.files));
elements.dropzone.addEventListener("click", () => elements.fileInput.click());
elements.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});
elements.closePreview.addEventListener("click", () => elements.previewDialog.close());
elements.previewDialog.addEventListener("click", (event) => {
  if (event.target === elements.previewDialog) elements.previewDialog.close();
});

window.addEventListener("beforeunload", () => state.objectUrls.forEach((url) => URL.revokeObjectURL(url)));

try {
  await refreshAssets();
  if (navigator.storage?.persist) await navigator.storage.persist();
  const unfinished = state.assets.filter((asset) => asset.aiStatus === "queued" || asset.aiStatus === "analyzing").map((asset) => asset.id);
  if (unfinished.length) void analyzeImportedAssets(unfinished);
} catch (error) {
  console.error(error);
  showToast("无法打开本地素材库", "error");
}
