const DATA_URL = "data/projects.json";
const COMMENTS_REPO = "lzq1206/AIWeb";
const STORAGE_KEY = "aiweb-vibe-radar-v1";

const fallbackProjects = [
  {
    id: "fallback-aiweb-demo",
    repo: "AIWeb/demo",
    name: "等待今日信号",
    description: "数据正在从 GitHub 同步。下一次自动更新会把新的 AI 小功能带到这里。",
    url: "https://github.com/lzq1206/AIWeb",
    stars: 0,
    forks: 0,
    language: "HTML",
    topics: ["AI", "Vibe Coding"],
    category: "Vibe Coding",
    tags: ["AI", "Vibe Coding"],
    thumbnail: "",
    coverHeight: 220,
    coverColor: "#214b4c",
    score: 0,
    createdAt: new Date().toISOString(),
    pushedAt: new Date().toISOString(),
    likes: 0,
  },
];

const state = {
  projects: [],
  activeTag: "全部",
  sort: "hot",
  search: "",
  favoritesOnly: false,
  user: loadUserState(),
};

const els = {
  grid: document.querySelector("#project-grid"),
  empty: document.querySelector("#empty-state"),
  resultCount: document.querySelector("#result-count"),
  projectCount: document.querySelector("#project-count"),
  starCount: document.querySelector("#star-count"),
  lastUpdated: document.querySelector("#last-updated"),
  favoriteCount: document.querySelector("#favorite-count"),
  search: document.querySelector("#search-input"),
  toast: document.querySelector("#toast"),
  dialog: document.querySelector("#comments-dialog"),
  commentsTitle: document.querySelector("#comments-title"),
  commentsCaption: document.querySelector("#comments-caption"),
  utterancesHost: document.querySelector("#utterances-host"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  updateFavoriteCount();

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    const payload = await response.json();
    state.projects = Array.isArray(payload.items) ? payload.items : fallbackProjects;
    updateOverview(payload);
  } catch (error) {
    state.projects = fallbackProjects;
    updateOverview({ generatedAt: null, items: state.projects });
  }

  render();
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sort = button.dataset.sort;
      state.favoritesOnly = state.sort === "saved";
      document.querySelectorAll("[data-sort]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTag = button.dataset.tag;
      document.querySelectorAll("[data-tag]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.querySelector("#nav-favorites").addEventListener("click", () => {
    state.favoritesOnly = true;
    state.sort = "saved";
    document.querySelectorAll("[data-sort]").forEach((item) => item.classList.toggle("active", item.dataset.sort === "saved"));
    document.querySelector("#feed").scrollIntoView({ behavior: "smooth", block: "start" });
    render();
  });

  document.querySelector("#clear-filters").addEventListener("click", clearFilters);
  document.querySelector("#close-comments").addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("close", () => { els.utterancesHost.replaceChildren(); });

  els.grid.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const project = state.projects.find((item) => item.id === actionButton.dataset.id);
    if (!project) return;

    if (actionButton.dataset.action === "like") toggleLike(project);
    if (actionButton.dataset.action === "favorite") toggleFavorite(project);
    if (actionButton.dataset.action === "comment") openComments(project);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== els.search && !els.dialog.open) {
      event.preventDefault();
      els.search.focus();
    }
  });
}

function render() {
  const projects = filteredProjects();
  els.grid.innerHTML = projects.map(projectCard).join("");
  els.empty.hidden = projects.length !== 0;
  els.resultCount.textContent = `${projects.length} / ${state.projects.length} 个项目`;
}

function filteredProjects() {
  const filtered = state.projects.filter((project) => {
    const haystack = [project.name, project.repo, project.description, project.category, ...(project.tags || []), ...(project.topics || [])].join(" ").toLowerCase();
    const matchesSearch = !state.search || haystack.includes(state.search);
    const matchesTag = state.activeTag === "全部" || project.category === state.activeTag || (project.tags || []).includes(state.activeTag);
    const matchesFavorite = !state.favoritesOnly || Boolean(state.user.favorites[project.id]);
    return matchesSearch && matchesTag && matchesFavorite;
  });

  return filtered.sort((a, b) => {
    if (state.sort === "new") return new Date(b.pushedAt || b.createdAt) - new Date(a.pushedAt || a.createdAt);
    if (state.sort === "saved") return Number(Boolean(state.user.favorites[b.id])) - Number(Boolean(state.user.favorites[a.id])) || Number(b.score || 0) - Number(a.score || 0);
    return Number(b.score || 0) - Number(a.score || 0) || Number(b.stars || 0) - Number(a.stars || 0);
  });
}

function projectCard(project) {
  const liked = Boolean(state.user.liked[project.id]);
  const saved = Boolean(state.user.favorites[project.id]);
  const tags = (project.tags || project.topics || []).slice(0, 3);
  const coverHeight = Math.max(150, Math.min(280, Number(project.coverHeight) || 194));
  const safeThumbnail = safeUrl(project.thumbnail);
  const safeUrlValue = safeUrl(project.url) || "https://github.com/";
  const likeCount = Math.max(0, Number(project.likes || 0) + Number(state.user.likeDeltas[project.id] || 0));
  const score = Math.round(Number(project.score || 0));
  const fallbackLabel = escapeHtml(project.category || "AI Build");
  const thumbnail = safeThumbnail
    ? `<img src="${escapeAttribute(safeThumbnail)}" alt="${escapeAttribute(project.name)} 预览图" loading="lazy" onerror="this.hidden=true; this.nextElementSibling.hidden=false" /><div class="cover-fallback" hidden style="--cover-bg:${escapeAttribute(project.coverColor || "#214b4c")}"><strong>${escapeHtml(project.name)}</strong><span>${fallbackLabel}</span></div>`
    : `<div class="cover-fallback" style="background:${escapeAttribute(project.coverColor || "#214b4c")}"><strong>${escapeHtml(project.name)}</strong><span>${fallbackLabel}</span></div>`;

  return `
    <article class="project-card" style="--cover-height:${coverHeight}px;--cover-bg:${escapeAttribute(project.coverColor || "#172b39")}">
      <a class="project-cover" href="${escapeAttribute(safeUrlValue)}" target="_blank" rel="noreferrer" aria-label="打开 ${escapeAttribute(project.name)} 的 GitHub 仓库">
        ${thumbnail}
        <span class="cover-overlay"><span class="signal-badge">${escapeHtml(project.category || "AI Build")}</span><span class="score-mark">✦ ${score > 0 ? score : "NEW"}</span></span>
      </a>
      <div class="card-body">
        <div class="card-title-row"><h3 class="card-title"><a href="${escapeAttribute(safeUrlValue)}" target="_blank" rel="noreferrer">${escapeHtml(project.name)}</a></h3></div>
        <p class="repo-name">${escapeHtml(project.repo || "GitHub project")}</p>
        <p class="card-description">${escapeHtml(project.description || "这个项目还没有提供简介。")}</p>
        <div class="card-tags">${tags.map((tag) => `<span class="card-tag">#${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="card-meta">
          <div class="meta-left"><span><i class="language-dot"></i>${escapeHtml(project.language || "多语言")}</span><span>★ ${formatNumber(project.stars)}</span></div>
          <div class="meta-right"><span>${formatRelative(project.pushedAt || project.createdAt)}</span></div>
        </div>
        <div class="card-actions">
          <button class="action-button ${liked ? "is-liked" : ""}" type="button" data-action="like" data-id="${escapeAttribute(project.id)}" aria-pressed="${liked}"><span class="action-icon">${liked ? "♥" : "♡"}</span><span>${likeCount || "赞"}</span></button>
          <button class="action-button ${saved ? "is-saved" : ""}" type="button" data-action="favorite" data-id="${escapeAttribute(project.id)}" aria-pressed="${saved}"><span class="action-icon">${saved ? "★" : "☆"}</span><span>${saved ? "已收藏" : "收藏"}</span></button>
          <button class="action-button comment-button" type="button" data-action="comment" data-id="${escapeAttribute(project.id)}"><span class="action-icon">◌</span><span>评论</span></button>
        </div>
      </div>
    </article>`;
}

function toggleLike(project) {
  const wasLiked = Boolean(state.user.liked[project.id]);
  state.user.liked[project.id] = !wasLiked;
  state.user.likeDeltas[project.id] = Number(state.user.likeDeltas[project.id] || 0) + (wasLiked ? -1 : 1);
  saveUserState();
  render();
  showToast(wasLiked ? "已取消点赞" : "已点赞，这个偏好只保存在当前设备");
}

function toggleFavorite(project) {
  const saved = Boolean(state.user.favorites[project.id]);
  state.user.favorites[project.id] = !saved;
  saveUserState();
  updateFavoriteCount();
  render();
  showToast(saved ? "已移出收藏" : "已加入收藏");
}

function openComments(project) {
  els.commentsTitle.textContent = `${project.name} · 项目讨论`;
  els.commentsCaption.textContent = "评论会通过 GitHub Issues 保存，登录 GitHub 后即可参与。";
  els.utterancesHost.replaceChildren();
  const script = document.createElement("script");
  script.src = "https://utteranc.es/client.js";
  script.async = true;
  script.crossOrigin = "anonymous";
  script.setAttribute("repo", COMMENTS_REPO);
  script.setAttribute("issue-term", `vibecode:${project.id}`);
  script.setAttribute("theme", "github-dark");
  els.utterancesHost.appendChild(script);
  els.dialog.showModal();
}

function updateOverview(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  els.projectCount.textContent = formatNumber(items.length);
  els.starCount.textContent = formatNumber(items.reduce((total, item) => total + Number(item.stars || 0), 0));
  els.lastUpdated.textContent = payload.generatedAt ? formatDate(payload.generatedAt) : "刚刚";
}

function updateFavoriteCount() {
  els.favoriteCount.textContent = Object.values(state.user.favorites).filter(Boolean).length;
}

function clearFilters() {
  state.activeTag = "全部";
  state.sort = "hot";
  state.search = "";
  state.favoritesOnly = false;
  els.search.value = "";
  document.querySelectorAll("[data-tag]").forEach((item) => item.classList.toggle("active", item.dataset.tag === "全部"));
  document.querySelectorAll("[data-sort]").forEach((item) => item.classList.toggle("active", item.dataset.sort === "hot"));
  render();
}

function loadUserState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { liked: raw.liked || {}, likeDeltas: raw.likeDeltas || {}, favorites: raw.favorites || {} };
  } catch (_) {
    return { liked: {}, likeDeltas: {}, favorites: {} };
  }
}

function saveUserState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user)); } catch (_) { /* Private browsing can disable storage. */ }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}m`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(number);
}

function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return "今天";
  if (days < 30) return `${days}天前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }

