/**
 * SPILSA PRO - app.js
 * Frontend Logic Engine: Client-Side SWR Caching, Zero-Delay Reactive UI,
 * PWA Handler, Hardware Scanner, Geolocation GPS Haversine, SheetJS & JSZip.
 */

// ============================================
// 1. STATE GLOBAL & CACHE STORE
// ============================================
let appState = {
  profile: {},
  students: [],
  teachers: [],
  classes: [],
  prestasi: [],
  jenisPelanggaran: [],
  catatanPelanggaran: [],
  konseling: [],
  webCMS: [],
  galeri: [],
  presensiSiswa: [],
  presensiGuru: [],
  pengaturan: {},
  pengajuanIzin: [],
  rekamWajah: [],
  users: []
};

let currentActiveRole = null; // 'admin' | 'guru' | 'siswa' | null
let currentStudentSession = null;
let currentGuruSession = null;
let currentAdminToken = null;
let currentFilter = 'all';
let currentWebSubTab = 'berita';

// Hardware & Scanner
let html5QrScannerSiswa = null;
let html5QrScannerGuru = null;
let videoStreamSiswa = null;
let videoStreamGuru = null;
let videoStreamSelfie = null;
let videoStreamRekam = null;
let studentGeoWatcher = null;
let studentCurrentDistance = null;
let guruGeoWatcher = null;
let guruCurrentDistance = null;
let selectedZipPhotos = [];

// PWA deferred install prompt
let deferredPrompt = null;

// Charts instance
let charts = {};

// Slider State
let currentSlideIndex = 0;
let heroSlides = [];
let sliderInterval = null;

// ============================================
// 2. LIFECYCLE & INISIALISASI APLIKASI
// ============================================
window.addEventListener('DOMContentLoaded', () => {
  initPWAInstallPrompt();
  checkStoredSessions();
  loadDataSWR();
  initQuillEditors();
  initScrollAnimations();
});

function checkStoredSessions() {
  currentActiveRole = localStorage.getItem('spilsa_active_role') || null;
  currentAdminToken = localStorage.getItem('spilsa_admin_token') || null;

  const savedGuru = localStorage.getItem('spilsa_guru_session');
  if (savedGuru) {
    try { currentGuruSession = JSON.parse(savedGuru); } catch(e) { currentGuruSession = null; }
  }

  const savedStudent = localStorage.getItem('spilsa_student_session');
  if (savedStudent) {
    try { currentStudentSession = JSON.parse(savedStudent); } catch(e) { currentStudentSession = null; }
  }

  // Restore Theme Preset
  const savedTheme = localStorage.getItem('spilsa_theme_preset') || 'indigo';
  applyThemePreset(savedTheme, false);

  // Restore Sidebar Collapsed state (Desktop - POIN 3)
  if (localStorage.getItem('spilsa_sidebar_collapsed') === '1') {
    isSidebarCollapsed = true;
    const sidebar = document.getElementById('adminSidebar');
    const icon = document.getElementById('btnCollapseSidebarIcon');
    if (sidebar) sidebar.classList.add('is-collapsed');
    if (icon) icon.className = 'fa-solid fa-angles-right text-xs';
  }

  updateHeaderAuthUI();

  // Restore active view without being forced to login (POIN 13)
  const savedTab = localStorage.getItem('spilsa_active_tab') || 'dashboard';
  const savedSub = localStorage.getItem('spilsa_active_subtab') || 'dashboard';

  if (currentActiveRole === 'admin' && currentAdminToken) {
    switchTab('admin');
    if (savedSub) switchAdminSub(savedSub);
  } else if (currentActiveRole === 'guru' && currentGuruSession) {
    switchTab('guru');
  } else if (currentActiveRole === 'siswa' && currentStudentSession) {
    switchTab('siswa');
  } else {
    switchTab('dashboard');
  }
}

function initPWAInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBanner = document.getElementById('pwaInstallBanner');
    if (installBanner) installBanner.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const installBanner = document.getElementById('pwaInstallBanner');
    if (installBanner) installBanner.classList.add('hidden');
    console.log('SPILSA PWA berhasil diinstal!');
  });
}

function triggerPWAInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('Pengguna menerima instalasi PWA');
      }
      deferredPrompt = null;
    });
  }
}

// ============================================
// 3. REST API FETCH ENGINE (ANTI-CORS & SWR)
// ============================================
async function apiGet(action, params = {}) {
  try {
    const url = new URL(CONFIG.GAS_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
    const res = await fetch(url.toString());
    const json = await res.json();
    return json;
  } catch (err) {
    console.warn('API GET Error:', err);
    return { success: false, message: err.message };
  }
}

async function apiPost(action, data = {}, token = null, extra = {}) {
  try {
    const payload = {
      action: action,
      token: token || currentAdminToken,
      data: data,
      ...extra
    };

    // ATURAN KRUSIAL ANTI-CORS: Gunakan text/plain
    const res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    return json;
  } catch (err) {
    console.error('API POST Error:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Pola SWR (Stale-While-Revalidate):
 * Baca cache lokal seketika (0 ms delay), lalu perbarui data dari server di background.
 */
async function loadDataSWR(forceRefresh = false) {
  const cachedBoot = localStorage.getItem('spilsa_cached_boot');
  const cachedTime = parseInt(localStorage.getItem('spilsa_cached_time') || '0', 10);
  const now = Date.now();

  if (cachedBoot && !forceRefresh) {
    try {
      const parsed = JSON.parse(cachedBoot);
      applyPayloadToState(parsed);
      renderAllViews();
    } catch(e) {}
  }

  // Jika cache kadaluarsa (> TTL) atau dipaksa refresh, ambil dari server
  if (forceRefresh || (now - cachedTime > CONFIG.CACHE_TTL_MS) || !cachedBoot) {
    showSyncIndicator(true);
    const res = await apiGet('getBootData');
    showSyncIndicator(false);

    if (res && res.success && res.data) {
      localStorage.setItem('spilsa_cached_boot', JSON.stringify(res.data));
      localStorage.setItem('spilsa_cached_time', String(now));
      applyPayloadToState(res.data);
      renderAllViews();
    }
  }
}

function applyPayloadToState(data) {
  if (!data) return;
  appState.profile = data.profile || appState.profile;
  appState.students = data.students || appState.students;
  appState.teachers = data.teachers || appState.teachers;
  appState.classes = data.classes || appState.classes;
  appState.prestasi = data.prestasi || appState.prestasi;
  appState.jenisPelanggaran = data.jenisPelanggaran || appState.jenisPelanggaran;
  appState.catatanPelanggaran = data.catatanPelanggaran || appState.catatanPelanggaran;
  appState.konseling = data.konseling || appState.konseling;
  appState.webCMS = data.webCMS || appState.webCMS;
  appState.galeri = data.galeri || appState.galeri;
  appState.presensiSiswa = data.presensiSiswa || appState.presensiSiswa;
  appState.presensiGuru = data.presensiGuru || appState.presensiGuru;
  appState.pengaturan = data.pengaturan || appState.pengaturan;
  appState.pengajuanIzin = data.pengajuanIzin || appState.pengajuanIzin;
  appState.rekamWajah = data.rekamWajah || appState.rekamWajah;
  appState.users = data.users || appState.users;
}

function showSyncIndicator(isLoading) {
  const dot = document.getElementById('syncIndicatorDot');
  if (dot) {
    dot.className = isLoading 
      ? "w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" 
      : "w-2.5 h-2.5 rounded-full bg-emerald-400";
  }
}

function renderAllViews() {
  updateSchoolProfileUI();
  renderPublicPortal();
  renderAdminTable();
  renderTeacherTable();
  renderClassTable();
  renderPrestasiTable();
  renderJenisTable();
  renderCatatanTable();
  renderKonselingTable();
  renderPresensiSiswaTable();
  renderPresensiGuruTable();
  renderApprovalIzinTable();
  renderUsersTable();
  loadPengaturanForm();
  populateDropdowns();
  renderCharts();
  handleSearch();
  initScrollAnimations();

  if (currentStudentSession) {
    renderStudentPortalView();
  }
  if (currentGuruSession) {
    renderGuruDashboard();
  }
}

// ============================================
// 4. ROUTER TABS & SUBNAV
// ============================================
function switchTab(tab) {
  stopAllCameraStreams();
  stopGuruCameraAndGeo();

  const tabDash = document.getElementById('tab-dashboard');
  const tabAdm = document.getElementById('tab-admin');
  const tabSis = document.getElementById('tab-siswa');
  const tabGur = document.getElementById('tab-guru');
  const navDash = document.getElementById('nav-dashboard');

  if (tabDash) tabDash.classList.add('hidden');
  if (tabAdm) tabAdm.classList.add('hidden');
  if (tabSis) tabSis.classList.add('hidden');
  if (tabGur) tabGur.classList.add('hidden');

  if (navDash) navDash.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white hover:bg-white/10 transition flex items-center gap-2";

  localStorage.setItem('spilsa_active_tab', tab);

  if (tab === 'dashboard') {
    if (tabDash) tabDash.classList.remove('hidden');
    if (navDash) navDash.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-indigo-700 shadow transition flex items-center gap-2";
    renderPublicPortal();
  } else if (tab === 'guru') {
    if (!currentGuruSession) {
      openLoginModal('guru');
      return;
    }
    if (tabGur) tabGur.classList.remove('hidden');
    renderGuruDashboard();
  } else if (tab === 'siswa') {
    if (!currentStudentSession) {
      openLoginModal('siswa');
      return;
    }
    if (tabSis) tabSis.classList.remove('hidden');
    renderStudentPortalView();
  } else if (tab === 'admin') {
    if (!currentAdminToken) {
      openLoginModal('admin');
      return;
    }
    if (tabAdm) tabAdm.classList.remove('hidden');
    const savedSub = localStorage.getItem('spilsa_active_subtab') || 'dashboard';
    switchAdminSub(savedSub);
  }
}

// ============================================
// 4. ROUTER TABS & SIDEBAR (POIN 3, 4, 5, 10)
// ============================================
let isSidebarCollapsed = false;

function toggleAdminSidebarCollapse() {
  const sidebar = document.getElementById('adminSidebar');
  const icon = document.getElementById('btnCollapseSidebarIcon');
  if (!sidebar) return;

  isSidebarCollapsed = !isSidebarCollapsed;
  if (isSidebarCollapsed) {
    sidebar.classList.add('is-collapsed');
    if (icon) icon.className = 'fa-solid fa-angles-right text-xs';
  } else {
    sidebar.classList.remove('is-collapsed');
    if (icon) icon.className = 'fa-solid fa-angles-left text-xs';
  }
  localStorage.setItem('spilsa_sidebar_collapsed', isSidebarCollapsed ? '1' : '0');
}

function toggleMobileSidebar(forceState) {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('adminSidebarBackdrop');
  if (!sidebar) return;

  const isOpen = !sidebar.classList.contains('-translate-x-full');
  const newState = (forceState !== undefined) ? forceState : !isOpen;

  if (newState) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function toggleSidebarGroup(groupName) {
  const sub = document.getElementById(`group-${groupName}-sub`);
  const arrow = document.getElementById(`group-${groupName}-arrow`);
  if (!sub) return;

  const isHidden = sub.classList.contains('hidden');
  if (isHidden) {
    sub.classList.remove('hidden');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  } else {
    sub.classList.add('hidden');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  }
}

function switchAdminSub(sub) {
  stopAllCameraStreams();
  toggleMobileSidebar(false); // Tutup drawer mobile secara otomatis

  const allSubmenus = [
    'dashboard', 'presensi-siswa', 'presensi-guru', 'approval-izin', 
    'web', 'siswa', 'guru', 'kelas', 'prestasi', 'konseling', 
    'catatan', 'jenis', 'users', 'pengaturan', 'wa', 'migrasi'
  ];
  
  allSubmenus.forEach(s => {
    const el = document.getElementById('admin-sub-' + s);
    if (el) el.classList.add('hidden');
    const btn = document.getElementById('subnav-' + s);
    if (btn) {
      btn.classList.remove('bg-indigo-600', 'text-white', 'shadow');
      btn.classList.add('text-slate-300');
    }
  });

  // Otomatis buka group accordion induk jika item berada di dalam submenu (POIN 4)
  if (['siswa', 'guru', 'kelas'].includes(sub)) {
    const subGrp = document.getElementById('group-master-sub');
    const arr = document.getElementById('group-master-arrow');
    if (subGrp) subGrp.classList.remove('hidden');
    if (arr) arr.style.transform = 'rotate(180deg)';
  } else if (['presensi-siswa', 'presensi-guru', 'approval-izin'].includes(sub)) {
    const subGrp = document.getElementById('group-presensi-sub');
    const arr = document.getElementById('group-presensi-arrow');
    if (subGrp) subGrp.classList.remove('hidden');
    if (arr) arr.style.transform = 'rotate(180deg)';
  } else if (['catatan', 'jenis'].includes(sub)) {
    const subGrp = document.getElementById('group-pelanggaran-sub');
    const arr = document.getElementById('group-pelanggaran-arrow');
    if (subGrp) subGrp.classList.remove('hidden');
    if (arr) arr.style.transform = 'rotate(180deg)';
  }

  const activeEl = document.getElementById('admin-sub-' + sub);
  if (activeEl) activeEl.classList.remove('hidden');
  const activeBtn = document.getElementById('subnav-' + sub);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-300');
    activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow');
  }

  localStorage.setItem('spilsa_active_subtab', sub);

  if (sub === 'presensi-siswa') renderPresensiSiswaTable();
  else if (sub === 'presensi-guru') renderPresensiGuruTable();
  else if (sub === 'approval-izin') renderApprovalIzinTable();
  else if (sub === 'users') renderUsersTable();
  else if (sub === 'pengaturan') loadPengaturanForm();
  else if (sub === 'wa') loadWAStatusAdmin();
  else if (sub === 'web') renderStaffTable();
}

function switchWebSub(sub) {
  currentWebSubTab = sub;
  ['berita', 'pengumuman', 'agenda', 'galeri', 'dataweb', 'staff'].forEach(s => {
    const btn = document.getElementById('subweb-' + s);
    if (btn) btn.className = (s === sub) ? "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white shadow" : "px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200";
  });

  document.getElementById('web-sub-cms').classList.add('hidden');
  document.getElementById('web-sub-galeri').classList.add('hidden');
  document.getElementById('web-sub-dataweb').classList.add('hidden');
  document.getElementById('web-sub-staff').classList.add('hidden');

  if (sub === 'berita' || sub === 'pengumuman' || sub === 'agenda') {
    document.getElementById('web-sub-cms').classList.remove('hidden');
    const titles = { 'berita': 'Daftar Berita', 'pengumuman': 'Daftar Pengumuman', 'agenda': 'Daftar Agenda Kegiatan' };
    document.getElementById('cmsSectionTitle').innerText = titles[sub];
    renderWebCMSTable();
  } else if (sub === 'galeri') {
    document.getElementById('web-sub-galeri').classList.remove('hidden');
    renderGaleriTable();
  } else if (sub === 'dataweb') {
    document.getElementById('web-sub-dataweb').classList.remove('hidden');
    loadSchoolProfileForm();
  } else if (sub === 'staff') {
    document.getElementById('web-sub-staff').classList.remove('hidden');
    renderStaffTable();
  }
}

// ============================================
// 5. AUTENTIKASI MULTI-USER (POIN 11 & 13)
// ============================================
function openLoginModal(defaultRole = 'admin') {
  setLoginRole(defaultRole);
  const modal = document.getElementById('modalUnifiedLogin');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeLoginModal() {
  const modal = document.getElementById('modalUnifiedLogin');
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

function setLoginRole(role) {
  const roleInput = document.getElementById('loginRole');
  if (roleInput) roleInput.value = role;

  ['admin', 'guru', 'siswa'].forEach(r => {
    const btn = document.getElementById(`loginRoleBtn-${r}`);
    if (btn) {
      if (r === role) {
        btn.className = "py-2 rounded-xl transition bg-indigo-600 text-white shadow-sm flex items-center justify-center gap-1.5";
      } else {
        btn.className = "py-2 rounded-xl transition text-slate-600 hover:text-slate-800 flex items-center justify-center gap-1.5";
      }
    }
  });

  const label = document.getElementById('loginUsernameLabel');
  const icon = document.getElementById('loginUsernameIcon');
  const tip = document.getElementById('loginTipText');
  const input = document.getElementById('loginUsername');

  if (role === 'admin') {
    if (label) label.innerText = 'Username / ID Admin';
    if (icon) icon.className = 'fa-solid fa-user-shield';
    if (input) input.placeholder = 'admin';
    if (tip) tip.innerHTML = '<i class="fa-solid fa-circle-info mr-1 text-indigo-500"></i> Masukkan username dan kata sandi Administrator.';
  } else if (role === 'guru') {
    if (label) label.innerText = 'NIP / Nama Guru';
    if (icon) icon.className = 'fa-solid fa-chalkboard-user';
    if (input) input.placeholder = 'Masukkan NIP atau nama guru...';
    if (tip) tip.innerHTML = '<i class="fa-solid fa-circle-info mr-1 text-teal-600"></i> Untuk Guru, gunakan NIP sebagai Username dan Password default.';
  } else if (role === 'siswa') {
    if (label) label.innerText = 'NISN Siswa';
    if (icon) icon.className = 'fa-solid fa-graduation-cap';
    if (input) input.placeholder = 'Masukkan NISN siswa (10 digit)...';
    if (tip) tip.innerHTML = '<i class="fa-solid fa-circle-info mr-1 text-purple-600"></i> Untuk Siswa, gunakan 10 digit NISN sebagai Username dan Password default.';
  }
}

function togglePasswordVisibility(inputId, iconId) {
  const inp = document.getElementById(inputId);
  const ico = document.getElementById(iconId);
  if (!inp || !ico) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    ico.className = 'fa-solid fa-eye-slash text-xs';
  } else {
    inp.type = 'password';
    ico.className = 'fa-solid fa-eye text-xs';
  }
}

async function handleUnifiedLogin(e) {
  e.preventDefault();
  const role = document.getElementById('loginRole').value;
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const btn = document.getElementById('btnSubmitUnifiedLogin');

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memverifikasi...';
  btn.disabled = true;

  const res = await apiPost('auth.unifiedLogin', { username, password, role });
  btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Masuk Sekarang';
  btn.disabled = false;

  if (res.success) {
    closeLoginModal();
    currentActiveRole = role;
    localStorage.setItem('spilsa_active_role', role);

    if (role === 'admin') {
      currentAdminToken = res.token || 'spilsa-token-admin';
      localStorage.setItem('spilsa_admin_token', currentAdminToken);
      updateHeaderAuthUI();
      switchTab('admin');
    } else if (role === 'guru') {
      currentGuruSession = res.user;
      localStorage.setItem('spilsa_guru_session', JSON.stringify(res.user));
      updateHeaderAuthUI();
      switchTab('guru');
      renderGuruDashboard();
    } else if (role === 'siswa') {
      currentStudentSession = res.user;
      localStorage.setItem('spilsa_student_session', JSON.stringify(res.user));
      updateHeaderAuthUI();
      switchTab('siswa');
      renderStudentPortalView();
    }
  } else {
    alert('Login Gagal: ' + res.message);
  }
}

function updateHeaderAuthUI() {
  const badge = document.getElementById('navUserBadge');
  const loginBtn = document.getElementById('nav-login-btn') || document.getElementById('btnNavLogin');
  const userText = document.getElementById('navUserDisplayName') || document.getElementById('navUserBadgeText');

  if (currentActiveRole === 'admin' && currentAdminToken) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (userText) userText.innerText = "Admin Portal";
  } else if (currentActiveRole === 'guru' && currentGuruSession) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (userText) userText.innerText = currentGuruSession.namaGuru || currentGuruSession.nama || "Dewan Guru";
  } else if (currentActiveRole === 'siswa' && currentStudentSession) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (badge) badge.classList.remove('hidden');
    if (userText) userText.innerText = currentStudentSession.nama || "Siswa";
  } else {
    if (badge) badge.classList.add('hidden');
    if (loginBtn) loginBtn.classList.remove('hidden');
  }
}

function goToUserDashboard() {
  if (currentActiveRole === 'admin') switchTab('admin');
  else if (currentActiveRole === 'guru') switchTab('guru');
  else if (currentActiveRole === 'siswa') switchTab('siswa');
  else switchTab('dashboard');
}

function handleUserBadgeClick() {
  goToUserDashboard();
}

function logoutAll() {
  if (confirm('Keluar dari sesi akun Anda?')) {
    currentActiveRole = null;
    currentAdminToken = null;
    currentGuruSession = null;
    currentStudentSession = null;
    localStorage.removeItem('spilsa_active_role');
    localStorage.removeItem('spilsa_admin_token');
    localStorage.removeItem('spilsa_guru_session');
    localStorage.removeItem('spilsa_student_session');
    localStorage.removeItem('spilsa_active_tab');
    localStorage.removeItem('spilsa_active_subtab');
    updateHeaderAuthUI();
    switchTab('dashboard');
  }
}

// ============================================
// THEME GRADIENT & ANIMASI SCROLL (POIN 9 & 14)
// ============================================
const THEME_PRESETS = {
  emerald: {
    header: 'bg-gradient-to-r from-emerald-800 via-teal-900 to-slate-900',
    sidebar: 'bg-gradient-to-b from-slate-900 via-emerald-950 to-slate-950',
    footer: 'bg-slate-900',
    accent: 'emerald'
  },
  indigo: {
    header: 'bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900',
    sidebar: 'bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-950',
    footer: 'bg-slate-900',
    accent: 'indigo'
  },
  purple: {
    header: 'bg-gradient-to-r from-purple-900 via-fuchsia-950 to-slate-900',
    sidebar: 'bg-gradient-to-b from-slate-900 via-purple-950 to-slate-950',
    footer: 'bg-slate-900',
    accent: 'purple'
  },
  amber: {
    header: 'bg-gradient-to-r from-amber-800 via-orange-900 to-slate-900',
    sidebar: 'bg-gradient-to-b from-slate-900 via-amber-950 to-slate-950',
    footer: 'bg-slate-900',
    accent: 'amber'
  },
  midnight: {
    header: 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950',
    sidebar: 'bg-gradient-to-b from-slate-950 via-slate-900 to-black',
    footer: 'bg-black',
    accent: 'slate'
  }
};

function applyThemePreset(presetKey, save = true) {
  const preset = THEME_PRESETS[presetKey] || THEME_PRESETS.indigo;
  const header = document.querySelector('header');
  const sidebar = document.getElementById('adminSidebar');
  const footer = document.querySelector('footer');

  if (header) {
    header.className = `text-white shadow-xl sticky top-0 z-40 transition-colors duration-500 ${preset.header}`;
  }
  if (sidebar) {
    sidebar.className = `w-full lg:w-64 shrink-0 rounded-3xl shadow-xl overflow-hidden text-white p-4 space-y-4 border border-white/10 sticky top-20 transition-colors duration-500 ${preset.sidebar}`;
  }
  if (footer) {
    footer.className = `text-white mt-12 py-8 border-t border-slate-800 transition-colors duration-500 ${preset.footer}`;
  }
  if (save) {
    localStorage.setItem('spilsa_theme_preset', presetKey);
  }
  const select = document.getElementById('settingThemePreset');
  if (select) select.value = presetKey;
}

function initScrollAnimations() {
  const animatedElements = document.querySelectorAll('.reveal-on-scroll, .reveal-left, .reveal-right, .reveal-zoom');
  if (!animatedElements.length) return;
  if (!('IntersectionObserver' in window)) {
    animatedElements.forEach(el => el.classList.add('is-revealed'));
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -40px 0px'
  });
  animatedElements.forEach(el => observer.observe(el));
}

// ============================================
// 6. PORTAL SISWA MANDIRI & ABSEN GEOLOCATION
// ============================================
async function handleStudentLogin(e) {
  e.preventDefault();
  const nisn = document.getElementById('loginNisn').value.trim();
  const tglLahir = document.getElementById('loginTglLahir').value;
  const alertEl = document.getElementById('studentLoginAlert');
  const btn = document.getElementById('btnStudentLoginSubmit');

  alertEl.classList.add('hidden');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa data...';
  btn.disabled = true;

  const res = await apiPost('auth.studentLogin', { nisn: nisn, tanggalLahir: tglLahir });
  btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Masuk ke Portal Siswa';
  btn.disabled = false;

  if (res.success && res.student) {
    currentStudentSession = res.student;
    localStorage.setItem('spilsa_student_session', JSON.stringify(res.student));
    renderStudentPortalView();
  } else {
    alertEl.innerText = res.message || 'NISN atau Tanggal Lahir tidak cocok.';
    alertEl.classList.remove('hidden');
  }
}

function studentLogout() {
  stopAllCameraStreams();
  if (studentGeoWatcher) {
    navigator.geolocation.clearWatch(studentGeoWatcher);
    studentGeoWatcher = null;
  }
  currentStudentSession = null;
  localStorage.removeItem('spilsa_student_session');
  renderStudentPortalView();
}

function renderStudentPortalView() {
  const loginBox = document.getElementById('studentLoginContainer');
  const dashBox = document.getElementById('studentDashboardContainer');

  if (!currentStudentSession) {
    loginBox.classList.remove('hidden');
    dashBox.classList.add('hidden');
    stopAllCameraStreams();
  } else {
    loginBox.classList.add('hidden');
    dashBox.classList.remove('hidden');

    document.getElementById('portalStudentNama').innerText = currentStudentSession.nama;
    document.getElementById('portalStudentNisn').innerText = currentStudentSession.nisn;
    document.getElementById('portalStudentNipd').innerText = currentStudentSession.nipd || '-';
    document.getElementById('portalStudentRombel').innerText = currentStudentSession.rombel || 'Kelas ?';
    document.getElementById('portalStudentTtl').innerText = `${currentStudentSession.tempatLahir}, ${currentStudentSession.tanggalLahir}`;
    if (currentStudentSession.fotoUrl) {
      document.getElementById('portalStudentAvatar').src = currentStudentSession.fotoUrl;
    }
    switchStudentPortalTab('absen');
  }
}

function switchStudentPortalTab(tab) {
  ['absen', 'kehadiran', 'izin', 'prestasi', 'pelanggaran'].forEach(t => {
    const el = document.getElementById('studentPortal-' + t);
    const btn = document.getElementById('studentTabBtn-' + t);
    if (el) el.classList.add('hidden');
    if (btn) btn.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition flex items-center gap-2 shrink-0";
  });

  const activeEl = document.getElementById('studentPortal-' + tab);
  const activeBtn = document.getElementById('studentTabBtn-' + tab);
  if (activeEl) activeEl.classList.remove('hidden');
  if (activeBtn) activeBtn.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 text-white transition flex items-center gap-2 shrink-0";

  if (tab === 'absen') {
    initStudentSelfieCamera();
    startStudentGeoWatcher();
  } else {
    stopAllCameraStreams();
    if (studentGeoWatcher) {
      navigator.geolocation.clearWatch(studentGeoWatcher);
      studentGeoWatcher = null;
    }
    if (tab === 'kehadiran') renderStudentMyPresensi();
    else if (tab === 'izin') renderStudentMyIzin();
    else if (tab === 'prestasi') renderStudentMyPrestasi();
    else if (tab === 'pelanggaran') renderStudentMyPelanggaran();
  }
}

function initStudentSelfieCamera() {
  const video = document.getElementById('studentSelfieVideo');
  const spinner = document.getElementById('cameraLoadingSpinner');
  if (spinner) spinner.classList.remove('hidden');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(stream => {
        if (spinner) spinner.classList.add('hidden');
        videoStreamSelfie = stream;
        video.srcObject = stream;
      })
      .catch(err => {
        if (spinner) spinner.classList.add('hidden');
        alert('Tidak dapat mengaktifkan webcam selfie: ' + err.message);
      });
  }
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radius bumi meter
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

function startStudentGeoWatcher() {
  const badge = document.getElementById('geoStatusBadge');
  const text = document.getElementById('geoDistanceText');
  const btn = document.getElementById('btnSubmitSelfPresensi');
  const tip = document.getElementById('selfPresensiTip');

  if (!navigator.geolocation) {
    if (badge) { badge.className = "bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold"; badge.innerText = "GPS Tidak Didukung"; }
    if (text) text.innerText = "Perangkat Anda tidak mendukung fitur lokasi GPS.";
    if (btn) btn.disabled = true;
    return;
  }

  const schoolLat = parseFloat(appState.profile.latitude || -6.892000);
  const schoolLng = parseFloat(appState.profile.longitude || 110.612000);
  const maxRadius = parseInt(appState.profile.radiusPresensi || 150, 10);

  studentGeoWatcher = navigator.geolocation.watchPosition(
    pos => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;
      const dist = calculateHaversineDistance(userLat, userLng, schoolLat, schoolLng);
      studentCurrentDistance = dist;

      if (dist <= maxRadius) {
        if (badge) { badge.className = "bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold"; badge.innerText = "Dalam Lingkungan Sekolah"; }
        if (text) text.innerHTML = `Jarak Anda: <b>${dist} meter</b> dari titik sekolah (Maks. ${maxRadius} meter). Presensi diizinkan!`;
        if (btn) btn.disabled = false;
        if (tip) tip.innerText = "Posisikan wajah Anda dan klik tombol di atas untuk absen.";
      } else {
        if (badge) { badge.className = "bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold"; badge.innerText = "Di Luar Radius Sekolah"; }
        if (text) text.innerHTML = `Jarak Anda: <b class="text-rose-600">${dist} meter</b> dari sekolah (Maks. ${maxRadius} meter).`;
        if (btn) btn.disabled = true;
        if (tip) tip.innerText = "Presensi wajah mandiri hanya dapat dilakukan saat Anda sudah tiba di lingkungan sekolah.";
      }
    },
    err => {
      if (badge) { badge.className = "bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold"; badge.innerText = "Izin Lokasi Ditolak"; }
      if (text) text.innerText = "Izinkan akses lokasi (GPS) pada browser Anda untuk validasi presensi.";
      if (btn) btn.disabled = true;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

async function submitStudentSelfPresensi() {
  if (!currentStudentSession) return;
  const video = document.getElementById('studentSelfieVideo');
  const canvas = document.getElementById('studentSelfieCanvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 400, 300);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

  const btn = document.getElementById('btnSubmitSelfPresensi');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses Presensi...';
  btn.disabled = true;

  const now = new Date();
  const tglStr = now.toISOString().split('T')[0];
  const jamStr = now.toTimeString().split(' ')[0].substring(0, 5);

  const batasTerlambat = appState.pengaturan?.toleransiTerlambat || '07:15';
  let status = 'Hadir';
  if (jamStr > batasTerlambat) {
    status = 'Terlambat';
  }

  const payload = {
    tanggal: tglStr,
    jam: jamStr,
    nisn: currentStudentSession.nisn,
    nama: currentStudentSession.nama,
    kelas: currentStudentSession.rombel,
    status: status,
    metode: 'Wajah Mandiri',
    keterangan: `Absen Mandiri GPS: ${studentCurrentDistance || 0}m (${status})`,
    fotoWajahBase64: dataUrl
  };

  const res = await apiPost('presensi.recordSiswa', payload);
  btn.innerHTML = '<i class="fa-solid fa-camera"></i> Ambil Foto Wajah & Absen Sekarang';
  btn.disabled = false;

  if (res.success) {
    playBeepSound();
    alert(`Presensi Wajah Berhasil!\n\nNama: ${currentStudentSession.nama}\nTanggal: ${tglStr}\nJam: ${jamStr}\nStatus: ${status}`);
    loadDataSWR(true);
    switchStudentPortalTab('kehadiran');
  } else {
    alert('Gagal merekam presensi: ' + res.message);
  }
}

function renderStudentMyPresensi() {
  if (!currentStudentSession) return;
  const tbody = document.getElementById('myPresensiTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const myLogs = appState.presensiSiswa.filter(p => p.nisn.toString() === currentStudentSession.nisn.toString());

  let hadir = 0, terlambat = 0, pulangCepat = 0, sakitIzin = 0, alpa = 0;
  myLogs.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Terlambat') terlambat++;
    else if (p.status === 'Pulang Cepat') pulangCepat++;
    else if (p.status === 'Sakit' || p.status === 'Izin') sakitIzin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = myLogs.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;

  if (document.getElementById('myStudentPersen')) document.getElementById('myStudentPersen').innerText = persen + '%';
  if (document.getElementById('myStudentHadir')) document.getElementById('myStudentHadir').innerText = hadir;
  if (document.getElementById('myStudentSakitIzin')) document.getElementById('myStudentSakitIzin').innerText = sakitIzin;
  if (document.getElementById('myStudentAlpa')) document.getElementById('myStudentAlpa').innerText = alpa;

  if (myLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Belum ada riwayat presensi tercatat untuk Anda.</td></tr>`;
    return;
  }

  myLogs.forEach((p, idx) => {
    let badge = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (p.status === 'Terlambat') badge = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Pulang Cepat') badge = 'bg-orange-50 text-orange-700 border-orange-200';
    else if (p.status === 'Sakit') badge = 'bg-blue-50 text-blue-700 border-blue-200';
    else if (p.status === 'Izin') badge = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    else if (p.status === 'Alpa') badge = 'bg-rose-50 text-rose-700 border-rose-200';

    const fotoWajah = p.fotoWajahUrl 
      ? `<img src="${p.fotoWajahUrl}" class="w-8 h-8 rounded-full object-cover border mx-auto cursor-pointer" onclick="window.open('${p.fotoWajahUrl}', '_blank')" alt="Foto">`
      : `-`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3 font-semibold">${p.tanggal} <span class="text-slate-400 text-[10px]">(${p.jam || '-'})</span></td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">${p.metode || 'Manual'}</span></td>
        <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge}">${p.status}</span></td>
        <td class="p-3 text-center">${fotoWajah}</td>
        <td class="p-3 text-slate-500">${p.keterangan || '-'}</td>
      </tr>
    `;
  });
}

function renderStudentMyIzin() {
  if (!currentStudentSession) return;
  const tbody = document.getElementById('studentIzinHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const myIzin = (appState.pengajuanIzin || []).filter(i => i.role === 'Siswa' && i.targetId.toString() === currentStudentSession.nisn.toString());

  if (myIzin.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-400">Belum ada pengajuan izin dari Anda.</td></tr>`;
    return;
  }

  myIzin.forEach(i => {
    let badge = "bg-amber-100 text-amber-800";
    if (i.status === 'Disetujui') badge = "bg-emerald-100 text-emerald-800 font-bold";
    else if (i.status === 'Ditolak') badge = "bg-rose-100 text-rose-800 font-bold";

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5">${i.tanggalMulai} s.d ${i.tanggalSelesai}</td>
        <td class="p-2.5 font-semibold text-slate-700">${i.jenisIzin}</td>
        <td class="p-2.5 text-slate-500">${i.alasan}</td>
        <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] ${badge}">${i.status}</span></td>
      </tr>
    `;
  });
}

function renderStudentMyPrestasi() {
  if (!currentStudentSession) return;
  const container = document.getElementById('myPrestasiContainer');
  if (!container) return;
  container.innerHTML = '';

  const myPres = appState.prestasi.filter(p => p.namaSiswa.toLowerCase() === currentStudentSession.nama.toLowerCase());
  if (document.getElementById('myPrestasiCount')) document.getElementById('myPrestasiCount').innerText = `${myPres.length} Prestasi`;

  if (myPres.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-2xl border">Belum ada catatan prestasi. Teruslah bersemangat belajar!</div>`;
    return;
  }

  myPres.forEach(p => {
    container.innerHTML += `
      <div class="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm space-y-2">
        <div class="flex justify-between items-start">
          <span class="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">${p.juara}</span>
          <span class="text-[10px] text-slate-400 font-semibold">${p.tanggal}</span>
        </div>
        <h4 class="font-extrabold text-slate-800 text-sm">${p.namaLomba}</h4>
        <div class="text-xs text-slate-500 space-y-0.5">
          <div>Kategori: <b>${p.jenisPrestasi}</b></div>
          <div>Tingkat: <b>${p.tingkat}</b></div>
          <div>Penyelenggara: <b>${p.penyelenggara || '-'}</b></div>
        </div>
      </div>
    `;
  });
}

function renderStudentMyPelanggaran() {
  if (!currentStudentSession) return;
  const tbody = document.getElementById('myPelanggaranTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const myPel = appState.catatanPelanggaran.filter(c => c.nisn.toString() === currentStudentSession.nisn.toString());
  let totalPoin = 0;
  myPel.forEach(c => totalPoin += parseInt(c.poinPelanggaran || 0));
  if (document.getElementById('myTotalPoin')) document.getElementById('myTotalPoin').innerText = `${totalPoin} Poin`;

  if (myPel.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-emerald-600 font-semibold">Hebat! Anda tidak memiliki catatan pelanggaran tata tertib.</td></tr>`;
    return;
  }

  myPel.forEach((c, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">${c.tanggal}</td>
        <td class="p-3 font-semibold text-slate-800">${c.jenisPelanggaran}</td>
        <td class="p-3"><span class="bg-rose-50 text-rose-600 px-2 py-0.5 rounded text-[10px] font-bold">${c.kategoriPelanggaran}</span></td>
        <td class="p-3 font-bold text-rose-600">+${c.poinPelanggaran}</td>
        <td class="p-3">${c.tindakLanjut || '-'}</td>
        <td class="p-3">${c.guruPendamping || '-'}</td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold">${c.keterangan || '-'}</span></td>
      </tr>
    `;
  });
}

function previewMyStudentCard() {
  if (!currentStudentSession) return;
  previewSingleStudentCard(currentStudentSession);
}

// ============================================
// 7. PRESENSI SISWA & GURU (SCANNER & CRUD)
// ============================================
function togglePresensiSiswaInputMode(mode) {
  const container = document.getElementById('presensiSiswaScannerContainer');
  const bcodeView = document.getElementById('presensiSiswaBarcodeView');
  const wajahView = document.getElementById('presensiSiswaWajahView');
  const title = document.getElementById('presensiSiswaScannerTitle');

  container.classList.remove('hidden');
  stopAllCameraStreams();

  if (mode === 'barcode') {
    bcodeView.classList.remove('hidden');
    wajahView.classList.add('hidden');
    title.innerHTML = '<i class="fa-solid fa-qrcode text-pink-600"></i> Kamera Scanner Barcode Siswa';
    initPresensiSiswaBarcodeScanner();
  } else if (mode === 'wajah') {
    wajahView.classList.remove('hidden');
    bcodeView.classList.add('hidden');
    title.innerHTML = '<i class="fa-solid fa-camera text-indigo-600"></i> Kamera Presensi Wajah Siswa';
    initPresensiSiswaWajahCamera();
  }
}

function closePresensiSiswaScanner() {
  document.getElementById('presensiSiswaScannerContainer').classList.add('hidden');
  stopAllCameraStreams();
}

function initPresensiSiswaBarcodeScanner() {
  if (html5QrScannerSiswa) {
    try { html5QrScannerSiswa.clear(); } catch(e){}
  }
  html5QrScannerSiswa = new Html5QrcodeScanner("readerSiswaBarcode", { fps: 10, qrbox: { width: 250, height: 250 } });
  html5QrScannerSiswa.render(async (decodedText) => {
    playBeepSound();
    let nisn = decodedText.trim();
    if (nisn.startsWith('SISWA:')) nisn = nisn.replace('SISWA:', '').trim();

    const siswa = appState.students.find(s => s.nisn.toString() === nisn);
    if (!siswa) {
      showPresensiSiswaAlert(`NISN (${nisn}) tidak terdaftar dalam master data.`, 'error');
      return;
    }

    const now = new Date();
    const tglStr = now.toISOString().split('T')[0];
    const jamStr = now.toTimeString().split(' ')[0].substring(0, 5);

    const payload = {
      tanggal: tglStr,
      jam: jamStr,
      nisn: siswa.nisn,
      nama: siswa.nama,
      kelas: siswa.rombel,
      status: 'Hadir',
      metode: 'Scan Barcode',
      keterangan: 'Presensi Scanner Kartu Pelajar',
      fotoWajahBase64: null
    };

    showPresensiSiswaAlert(`Mencatat kehadiran ${siswa.nama}...`, 'info');
    const res = await apiPost('presensi.recordSiswa', payload);
    if (res.success) {
      showPresensiSiswaAlert(`Berhasil: ${siswa.nama} (${siswa.rombel}) Hadir pk. ${jamStr}`, 'success');
      loadDataSWR(true);
    } else {
      showPresensiSiswaAlert('Gagal: ' + res.message, 'error');
    }
  });
}

// ============================================
// MODUL AUTO FACE ATTENDANCE (POIN 6)
// ============================================
let autoFaceScanInterval = null;
let lastDetectedFaceKey = null;
let lastDetectedFaceTime = 0;
let isProcessingFaceAttendance = false;

function extractFaceVector_(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const vector = [];
  const totalPixels = Math.floor(data.length / 4);
  const step = Math.max(1, Math.floor(totalPixels / 64));
  for (let i = 0; i < 64; i++) {
    const idx = (i * step) * 4;
    const r = data[idx] || 0;
    const g = data[idx + 1] || 0;
    const b = data[idx + 2] || 0;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    vector.push(lum);
  }
  return vector;
}

function compareFaceVectors_(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 999999;
  const len = Math.min(vecA.length, vecB.length);
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const diff = (vecA[i] || 0) - (vecB[i] || 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / len);
}

function startAutoFaceAttendance(role) {
  stopAutoFaceAttendance();
  const alertEl = (role === 'siswa') 
    ? document.getElementById('presensiSiswaScanAlert') 
    : document.getElementById('presensiGuruScanAlert');

  if (alertEl) {
    alertEl.className = "p-3 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 block transition border border-indigo-200 text-center";
    alertEl.innerHTML = `<i class="fa-solid fa-camera mr-1.5 animate-pulse text-indigo-600"></i> Mode Scan Wajah Otomatis Aktif. Posisikan wajah Anda pada lingkaran kamera...`;
  }

  autoFaceScanInterval = setInterval(() => {
    scanLiveFaceFrame(role);
  }, 750);
}

function stopAutoFaceAttendance() {
  if (autoFaceScanInterval) {
    clearInterval(autoFaceScanInterval);
    autoFaceScanInterval = null;
  }
  isProcessingFaceAttendance = false;
}

async function scanLiveFaceFrame(role) {
  if (isProcessingFaceAttendance) return;
  const isSiswa = (role === 'siswa');
  const video = isSiswa ? document.getElementById('videoPresensiSiswa') : document.getElementById('videoPresensiGuru');
  const canvas = isSiswa ? document.getElementById('canvasPresensiSiswa') : document.getElementById('canvasPresensiGuru');

  if (!video || !canvas || video.readyState < 2) return;

  const width = 240;
  const height = 180;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  const targetRoleStr = isSiswa ? 'Siswa' : 'Guru';
  const registeredFaces = (appState.rekamWajah || []).filter(r => r.role === targetRoleStr && r.descriptor);

  if (registeredFaces.length === 0) {
    const alertEl = isSiswa ? document.getElementById('presensiSiswaScanAlert') : document.getElementById('presensiGuruScanAlert');
    if (alertEl) {
      alertEl.className = "p-3 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 block border border-amber-200 text-center";
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5"></i> Belum ada data Rekam Wajah ${targetRoleStr} yang terdaftar. Rekam wajah terlebih dahulu di menu admin.`;
    }
    return;
  }

  const liveVector = extractFaceVector_(ctx, width, height);

  let bestMatch = null;
  let minDistance = 999999;

  for (const reg of registeredFaces) {
    try {
      const regVector = reg.descriptor.split(',').map(Number);
      const dist = compareFaceVectors_(liveVector, regVector);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = reg;
      }
    } catch(e){}
  }

  const MATCH_THRESHOLD = 45;

  if (bestMatch && minDistance <= MATCH_THRESHOLD) {
    const now = Date.now();
    const candidateId = bestMatch.targetId.toString();

    if (lastDetectedFaceKey === candidateId && (now - lastDetectedFaceTime) < 6000) {
      return;
    }

    isProcessingFaceAttendance = true;
    lastDetectedFaceKey = candidateId;
    lastDetectedFaceTime = now;

    playBeepSound();

    const nowDate = new Date();
    const tglStr = nowDate.toISOString().split('T')[0];
    const jamStr = nowDate.toTimeString().split(' ')[0].substring(0, 5);
    const batasTerlambat = appState.pengaturan?.toleransiTerlambat || '07:15';
    const statusKehadiran = (jamStr > batasTerlambat) ? 'Terlambat' : 'Hadir';

    const alertEl = isSiswa ? document.getElementById('presensiSiswaScanAlert') : document.getElementById('presensiGuruScanAlert');
    if (alertEl) {
      alertEl.className = "p-3 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 block border border-emerald-300 text-center shadow";
      alertEl.innerHTML = `✅ <b>Wajah Terdeteksi:</b> ${bestMatch.targetName} (${statusKehadiran} pk. ${jamStr}) - Menyimpan presensi...`;
    }

    const fotoWajahData = canvas.toDataURL('image/jpeg', 0.6);

    try {
      if (isSiswa) {
        const student = (appState.students || []).find(s => s.nisn.toString() === candidateId) || {
          nisn: candidateId,
          nama: bestMatch.targetName,
          rombel: 'Siswa'
        };

        const payload = {
          tanggal: tglStr,
          jam: jamStr,
          nisn: student.nisn,
          nama: student.nama,
          kelas: student.rombel,
          status: statusKehadiran,
          metode: 'Scan Wajah Otomatis',
          keterangan: `Presensi Kamera Wajah Otomatis (${statusKehadiran})`,
          fotoWajahBase64: fotoWajahData
        };

        const res = await apiPost('presensi.recordSiswa', payload);
        if (alertEl) {
          alertEl.innerHTML = `🎉 <b>Berhasil:</b> ${student.nama} (${student.rombel}) tercatat <b>${statusKehadiran}</b> pk. ${jamStr}!`;
        }
      } else {
        const teacher = (appState.teachers || []).find(t => (t.nip && t.nip.toString() === candidateId) || t.namaGuru === candidateId) || {
          nip: candidateId,
          namaGuru: bestMatch.targetName,
          jabatan: 'Dewan Guru'
        };

        const payload = {
          tanggal: tglStr,
          jam: jamStr,
          nip: teacher.nip || '-',
          namaGuru: teacher.namaGuru,
          jabatan: teacher.jabatan || 'Dewan Guru',
          status: statusKehadiran,
          metode: 'Scan Wajah Otomatis',
          keterangan: `Presensi Kamera Wajah Otomatis (${statusKehadiran})`,
          fotoWajahBase64: fotoWajahData
        };

        const res = await apiPost('presensi.recordGuru', payload);
        if (alertEl) {
          alertEl.innerHTML = `🎉 <b>Berhasil:</b> ${teacher.namaGuru} tercatat <b>${statusKehadiran}</b> pk. ${jamStr}!`;
        }
      }

      loadDataSWR(true);
    } catch(err) {
      console.warn('Gagal mencatat presensi wajah otomatis:', err);
    } finally {
      setTimeout(() => {
        isProcessingFaceAttendance = false;
        if (alertEl) {
          alertEl.className = "p-3 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 block transition border border-indigo-200 text-center";
          alertEl.innerHTML = `<i class="fa-solid fa-camera mr-1.5 animate-pulse text-indigo-600"></i> Mode Scan Wajah Otomatis Aktif. Posisikan wajah berikutnya...`;
        }
      }, 2500);
    }
  }
}

function initPresensiSiswaWajahCamera() {
  const video = document.getElementById('videoPresensiSiswa');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then(stream => {
        videoStreamSiswa = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          startAutoFaceAttendance('siswa');
        };
      })
      .catch(err => {
        alert('Tidak dapat mengakses webcam: ' + err.message);
      });
  }
}

async function capturePresensiSiswaWajah() {
  scanLiveFaceFrame('siswa');
}

function showPresensiSiswaAlert(msg, type) {
  const el = document.getElementById('presensiSiswaScanAlert');
  if (!el) return;
  el.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-rose-50', 'text-rose-700', 'bg-blue-50', 'text-blue-700');
  if (type === 'success') el.classList.add('bg-emerald-50', 'text-emerald-700');
  else if (type === 'error') el.classList.add('bg-rose-50', 'text-rose-700');
  else el.classList.add('bg-blue-50', 'text-blue-700');
  el.innerText = msg;
}

function renderPresensiSiswaTable() {
  const tbody = document.getElementById('presensiSiswaTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterBulan = document.getElementById('filterPresensiSiswaBulan')?.value || '';
  const filterTgl = document.getElementById('filterPresensiSiswaTanggal')?.value || '';
  const filterKelas = document.getElementById('filterPresensiSiswaKelas')?.value || '';
  const filterStatus = document.getElementById('filterPresensiSiswaStatus')?.value || '';

  const filtered = appState.presensiSiswa.filter(p => {
    if (filterBulan && (!p.tanggal || !p.tanggal.startsWith(filterBulan))) return false;
    if (filterTgl && p.tanggal !== filterTgl) return false;
    if (filterKelas && p.kelas !== filterKelas) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  let hadir = 0, terlambat = 0, pulangCepat = 0, sakit = 0, izin = 0, alpa = 0;
  filtered.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Terlambat') terlambat++;
    else if (p.status === 'Pulang Cepat') pulangCepat++;
    else if (p.status === 'Sakit') sakit++;
    else if (p.status === 'Izin') izin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = filtered.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;

  if (document.getElementById('kpiSiswaPersen')) document.getElementById('kpiSiswaPersen').innerText = persen + '%';
  if (document.getElementById('kpiSiswaHadir')) document.getElementById('kpiSiswaHadir').innerText = hadir;
  if (document.getElementById('kpiSiswaTerlambat')) document.getElementById('kpiSiswaTerlambat').innerText = terlambat;
  if (document.getElementById('kpiSiswaPulangCepat')) document.getElementById('kpiSiswaPulangCepat').innerText = pulangCepat;
  if (document.getElementById('kpiSiswaSakit')) document.getElementById('kpiSiswaSakit').innerText = sakit;
  if (document.getElementById('kpiSiswaIzin')) document.getElementById('kpiSiswaIzin').innerText = izin;
  if (document.getElementById('kpiSiswaAlpa')) document.getElementById('kpiSiswaAlpa').innerText = alpa;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">Belum ada catatan presensi siswa sesuai filter.</td></tr>`;
    return;
  }

  filtered.forEach((p, idx) => {
    let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (p.status === 'Terlambat') badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Pulang Cepat') badgeColor = 'bg-orange-50 text-orange-700 border-orange-200';
    else if (p.status === 'Sakit') badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
    else if (p.status === 'Izin') badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    else if (p.status === 'Alpa') badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';

    const fotoWajahHtml = p.fotoWajahUrl 
      ? `<img src="${p.fotoWajahUrl}" onclick="window.open('${p.fotoWajahUrl}', '_blank')" class="w-9 h-9 rounded-full object-cover border mx-auto cursor-pointer shadow hover:scale-110 transition" alt="Foto">`
      : `<span class="text-slate-300">-</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 text-center"><input type="checkbox" class="presensi-siswa-checkbox" value="${p.rowId}"></td>
        <td class="p-3 font-semibold text-slate-500">${idx + 1}</td>
        <td class="p-3">
          <div class="font-bold text-slate-800">${p.tanggal}</div>
          <div class="text-[11px] text-slate-400"><i class="fa-regular fa-clock"></i> ${p.jam || '-'}</div>
        </td>
        <td class="p-3">
          <div class="font-bold text-slate-800">${p.nama}</div>
          <div class="text-[11px] text-slate-400">NISN: ${p.nisn} | ${p.kelas}</div>
        </td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold">${p.metode || 'Manual'}</span></td>
        <td class="p-3"><span class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${badgeColor}">${p.status}</span></td>
        <td class="p-3 text-center">${fotoWajahHtml}</td>
        <td class="p-3 text-slate-600 text-xs">${p.keterangan || '-'}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="openEditPresensiModal('siswa', ${p.rowId})" class="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition" title="Koreksi Presensi"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deletePresensiSiswa(${p.rowId})" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition" title="Hapus Presensi"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function openManualPresensiSiswaModal() {
  document.getElementById('manualSiswaRowId').value = '';
  const now = new Date();
  document.getElementById('manualSiswaTanggal').value = now.toISOString().split('T')[0];
  document.getElementById('manualSiswaJam').value = now.toTimeString().split(' ')[0].substring(0, 5);
  document.getElementById('manualSiswaStatus').value = 'Hadir';
  document.getElementById('manualSiswaKeterangan').value = '';
  document.getElementById('manualPresensiSiswaModal').classList.remove('hidden');
  document.getElementById('manualPresensiSiswaModal').classList.add('flex');
}

function closeManualPresensiSiswaModal() {
  document.getElementById('manualPresensiSiswaModal').classList.remove('flex');
  document.getElementById('manualPresensiSiswaModal').classList.add('hidden');
}

async function handleManualPresensiSiswaSubmit(e) {
  e.preventDefault();
  const nisn = document.getElementById('manualSiswaSelect').value;
  const siswa = appState.students.find(s => s.nisn.toString() === nisn);
  if (!siswa) { alert('Pilih siswa yang valid.'); return; }

  const payload = {
    tanggal: document.getElementById('manualSiswaTanggal').value,
    jam: document.getElementById('manualSiswaJam').value,
    nisn: siswa.nisn,
    nama: siswa.nama,
    kelas: siswa.rombel,
    status: document.getElementById('manualSiswaStatus').value,
    metode: 'Manual',
    keterangan: document.getElementById('manualSiswaKeterangan').value,
    fotoWajahBase64: null
  };

  const res = await apiPost('presensi.recordSiswa', payload);
  alert(res.message);
  if (res.success) {
    closeManualPresensiSiswaModal();
    loadDataSWR(true);
  }
}

async function deletePresensiSiswa(rowId) {
  if (confirm('Hapus data presensi siswa ini?')) {
    const res = await apiPost('presensi.deleteSiswa', { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function toggleSelectAllPresensiSiswa(master) {
  document.querySelectorAll('.presensi-siswa-checkbox').forEach(cb => cb.checked = master.checked);
}

async function deleteSelectedPresensiSiswa() {
  const selected = document.querySelectorAll('.presensi-siswa-checkbox:checked');
  if (selected.length === 0) { alert('Pilih minimal satu data presensi siswa.'); return; }
  if (confirm(`Hapus ${selected.length} data presensi siswa terpilih?`)) {
    const rowIds = Array.from(selected).map(cb => parseInt(cb.value));
    const res = await apiPost('presensi.deleteMultipleSiswa', { rowIds: rowIds });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// Logika Presensi Guru
function togglePresensiGuruInputMode(mode) {
  const container = document.getElementById('presensiGuruScannerContainer');
  const bcodeView = document.getElementById('presensiGuruBarcodeView');
  const wajahView = document.getElementById('presensiGuruWajahView');
  const title = document.getElementById('presensiGuruScannerTitle');

  container.classList.remove('hidden');
  stopAllCameraStreams();

  if (mode === 'barcode') {
    bcodeView.classList.remove('hidden');
    wajahView.classList.add('hidden');
    title.innerHTML = '<i class="fa-solid fa-qrcode text-teal-600"></i> Kamera Scanner Barcode ID Card Guru';
    initPresensiGuruBarcodeScanner();
  } else if (mode === 'wajah') {
    wajahView.classList.remove('hidden');
    bcodeView.classList.add('hidden');
    title.innerHTML = '<i class="fa-solid fa-camera text-emerald-600"></i> Kamera Presensi Wajah Guru';
    initPresensiGuruWajahCamera();
  }
}

function closePresensiGuruScanner() {
  document.getElementById('presensiGuruScannerContainer').classList.add('hidden');
  stopAllCameraStreams();
}

function initPresensiGuruBarcodeScanner() {
  if (html5QrScannerGuru) {
    try { html5QrScannerGuru.clear(); } catch(e){}
  }
  html5QrScannerGuru = new Html5QrcodeScanner("readerGuruBarcode", { fps: 10, qrbox: { width: 250, height: 250 } });
  html5QrScannerGuru.render(async (decodedText) => {
    playBeepSound();
    let nipOrId = decodedText.trim();
    if (nipOrId.startsWith('GURU:')) nipOrId = nipOrId.replace('GURU:', '').trim();

    const guru = appState.teachers.find(t => (t.nip && t.nip.toString() === nipOrId) || t.namaGuru.toLowerCase() === nipOrId.toLowerCase());
    if (!guru) {
      showPresensiGuruAlert(`Identitas Guru (${nipOrId}) tidak ditemukan.`, 'error');
      return;
    }

    const now = new Date();
    const tglStr = now.toISOString().split('T')[0];
    const jamStr = now.toTimeString().split(' ')[0].substring(0, 5);

    const payload = {
      tanggal: tglStr,
      jam: jamStr,
      nip: guru.nip || '-',
      namaGuru: guru.namaGuru,
      jabatan: guru.jabatan,
      status: 'Hadir',
      metode: 'Scan Barcode',
      keterangan: 'Presensi Scanner ID Card Guru',
      fotoWajahBase64: null
    };

    showPresensiGuruAlert(`Mencatat kehadiran ${guru.namaGuru}...`, 'info');
    const res = await apiPost('presensi.recordGuru', payload);
    if (res.success) {
      showPresensiGuruAlert(`Berhasil: ${guru.namaGuru} Hadir pk. ${jamStr}`, 'success');
      loadDataSWR(true);
    } else {
      showPresensiGuruAlert('Gagal: ' + res.message, 'error');
    }
  });
}

function initPresensiGuruWajahCamera() {
  const video = document.getElementById('videoPresensiGuru');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then(stream => {
        videoStreamGuru = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          startAutoFaceAttendance('guru');
        };
      })
      .catch(err => {
        alert('Tidak dapat mengakses webcam: ' + err.message);
      });
  }
}

async function capturePresensiGuruWajah() {
  scanLiveFaceFrame('guru');
}

function showPresensiGuruAlert(msg, type) {
  const el = document.getElementById('presensiGuruScanAlert');
  if (!el) return;
  el.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-rose-50', 'text-rose-700', 'bg-blue-50', 'text-blue-700');
  if (type === 'success') el.classList.add('bg-emerald-50', 'text-emerald-700');
  else if (type === 'error') el.classList.add('bg-rose-50', 'text-rose-700');
  else el.classList.add('bg-blue-50', 'text-blue-700');
  el.innerText = msg;
}

function renderPresensiGuruTable() {
  const tbody = document.getElementById('presensiGuruTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterBulan = document.getElementById('filterPresensiGuruBulan')?.value || '';
  const filterTgl = document.getElementById('filterPresensiGuruTanggal')?.value || '';
  const filterStatus = document.getElementById('filterPresensiGuruStatus')?.value || '';

  const filtered = appState.presensiGuru.filter(p => {
    if (filterBulan && (!p.tanggal || !p.tanggal.startsWith(filterBulan))) return false;
    if (filterTgl && p.tanggal !== filterTgl) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  let hadir = 0, terlambat = 0, pulangCepat = 0, sakit = 0, izin = 0, alpa = 0;
  filtered.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Terlambat') terlambat++;
    else if (p.status === 'Pulang Cepat') pulangCepat++;
    else if (p.status === 'Sakit') sakit++;
    else if (p.status === 'Izin') izin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = filtered.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;

  if (document.getElementById('kpiGuruPersen')) document.getElementById('kpiGuruPersen').innerText = persen + '%';
  if (document.getElementById('kpiGuruHadir')) document.getElementById('kpiGuruHadir').innerText = hadir;
  if (document.getElementById('kpiGuruTerlambat')) document.getElementById('kpiGuruTerlambat').innerText = terlambat;
  if (document.getElementById('kpiGuruPulangCepat')) document.getElementById('kpiGuruPulangCepat').innerText = pulangCepat;
  if (document.getElementById('kpiGuruSakit')) document.getElementById('kpiGuruSakit').innerText = sakit;
  if (document.getElementById('kpiGuruIzin')) document.getElementById('kpiGuruIzin').innerText = izin;
  if (document.getElementById('kpiGuruAlpa')) document.getElementById('kpiGuruAlpa').innerText = alpa;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">Belum ada catatan presensi guru.</td></tr>`;
    return;
  }

  filtered.forEach((p, idx) => {
    let badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
    if (p.status === 'Terlambat') badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Pulang Cepat') badgeColor = 'bg-orange-50 text-orange-700 border-orange-200';
    else if (p.status === 'Sakit') badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
    else if (p.status === 'Izin') badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    else if (p.status === 'Alpa') badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';

    const fotoWajahHtml = p.fotoWajahUrl 
      ? `<img src="${p.fotoWajahUrl}" onclick="window.open('${p.fotoWajahUrl}', '_blank')" class="w-9 h-9 rounded-full object-cover border mx-auto cursor-pointer shadow hover:scale-110 transition" alt="Foto">`
      : `<span class="text-slate-300">-</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 text-center"><input type="checkbox" class="presensi-guru-checkbox" value="${p.rowId}"></td>
        <td class="p-3 font-semibold text-slate-500">${idx + 1}</td>
        <td class="p-3">
          <div class="font-bold text-slate-800">${p.tanggal}</div>
          <div class="text-[11px] text-slate-400"><i class="fa-regular fa-clock"></i> ${p.jam || '-'}</div>
        </td>
        <td class="p-3">
          <div class="font-bold text-slate-800">${p.namaGuru}</div>
          <div class="text-[11px] text-slate-400">NIP: ${p.nip || '-'}</div>
        </td>
        <td class="p-3 text-slate-600">${p.jabatan || '-'}</td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold">${p.metode || 'Manual'}</span></td>
        <td class="p-3"><span class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${badgeColor}">${p.status}</span></td>
        <td class="p-3 text-center">${fotoWajahHtml}</td>
        <td class="p-3 text-slate-600 text-xs">${p.keterangan || '-'}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="openEditPresensiModal('guru', ${p.rowId})" class="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition" title="Koreksi Presensi"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deletePresensiGuru(${p.rowId})" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition" title="Hapus Presensi"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function openManualPresensiGuruModal() {
  document.getElementById('manualGuruRowId').value = '';
  const now = new Date();
  document.getElementById('manualGuruTanggal').value = now.toISOString().split('T')[0];
  document.getElementById('manualGuruJam').value = now.toTimeString().split(' ')[0].substring(0, 5);
  document.getElementById('manualGuruStatus').value = 'Hadir';
  document.getElementById('manualGuruKeterangan').value = '';
  document.getElementById('manualPresensiGuruModal').classList.remove('hidden');
  document.getElementById('manualPresensiGuruModal').classList.add('flex');
}

function closeManualPresensiGuruModal() {
  document.getElementById('manualPresensiGuruModal').classList.remove('flex');
  document.getElementById('manualPresensiGuruModal').classList.add('hidden');
}

async function handleManualPresensiGuruSubmit(e) {
  e.preventDefault();
  const idKey = document.getElementById('manualGuruSelect').value;
  const guru = appState.teachers.find(t => (t.nip && t.nip.toString() === idKey) || t.namaGuru === idKey);
  if (!guru) { alert('Pilih guru yang valid.'); return; }

  const payload = {
    tanggal: document.getElementById('manualGuruTanggal').value,
    jam: document.getElementById('manualGuruJam').value,
    nip: guru.nip || '-',
    namaGuru: guru.namaGuru,
    jabatan: guru.jabatan,
    status: document.getElementById('manualGuruStatus').value,
    metode: 'Manual',
    keterangan: document.getElementById('manualGuruKeterangan').value,
    fotoWajahBase64: null
  };

  const res = await apiPost('presensi.recordGuru', payload);
  alert(res.message);
  if (res.success) {
    closeManualPresensiGuruModal();
    loadDataSWR(true);
  }
}

async function deletePresensiGuru(rowId) {
  if (confirm('Hapus log presensi guru ini?')) {
    const res = await apiPost('presensi.deleteGuru', { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function toggleSelectAllPresensiGuru(master) {
  document.querySelectorAll('.presensi-guru-checkbox').forEach(cb => cb.checked = master.checked);
}

async function deleteSelectedPresensiGuru() {
  const selected = document.querySelectorAll('.presensi-guru-checkbox:checked');
  if (selected.length === 0) { alert('Pilih minimal satu data presensi guru.'); return; }
  if (confirm(`Hapus ${selected.length} data presensi guru terpilih?`)) {
    const rowIds = Array.from(selected).map(cb => parseInt(cb.value));
    const res = await apiPost('presensi.deleteMultipleGuru', { rowIds: rowIds });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// ============================================
// 8. CETAK KARTU DIGITAL (PELAJAR & GURU)
// ============================================
function generateCardMarkup(type, data) {
  const isStudent = (type === 'siswa');
  const logoSekolah = appState.profile.logoUrl || 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png';
  const namaSekolah = appState.profile.namaSekolah || CONFIG.APP_NAME;
  
  const fotoAvatar = data.fotoUrl || (isStudent 
    ? 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' 
    : 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png');
  
  const cardTitle = isStudent ? 'KARTU PELAJAR' : 'KARTU IDENTITAS GURU';
  const namaUtama = isStudent ? data.nama : data.namaGuru;
  const subtitle1 = isStudent ? `NISN: ${data.nisn}` : `NIP: ${data.nip || '-'}`;
  const subtitle2 = isStudent ? (data.rombel || 'Siswa') : (data.jabatan || 'Dewan Guru');
  const qrValue = isStudent ? `SISWA:${data.nisn}` : `GURU:${data.nip || data.namaGuru}`;
  const footerHint = isStudent ? 'Scan untuk absensi siswa' : 'Scan untuk absensi dewan guru';

  const cardClass = isStudent ? 'id-card' : 'id-card id-card-teacher';
  const qrElementId = `qr-${type}-${data.rowId || Math.random().toString(36).substring(7)}`;

  const html = `
    <div class="id-card-wrapper">
      <div class="${cardClass}">
        <div class="id-card-wave"></div>
        
        <!-- Header Kartu -->
        <div class="relative z-10 flex items-center gap-2 border-b border-white/20 pb-2">
          <img src="${logoSekolah}" class="w-8 h-8 object-contain bg-white rounded-lg p-1 shadow shrink-0" alt="Logo">
          <div class="overflow-hidden">
            <span class="text-[9px] uppercase tracking-wider font-extrabold text-pink-300 block leading-tight">${cardTitle}</span>
            <span class="text-[11px] font-black tracking-wide text-white block truncate leading-tight">${namaSekolah}</span>
          </div>
        </div>

        <!-- Avatar & Profil -->
        <div class="relative z-10 text-center my-auto space-y-2">
          <img src="${fotoAvatar}" class="id-card-avatar" alt="Foto">
          <div>
            <h4 class="text-sm font-extrabold text-white tracking-wide leading-tight line-clamp-1">${namaUtama}</h4>
            <div class="flex items-center justify-center gap-2 mt-1">
              <span class="text-[10px] bg-white/20 text-white font-semibold px-2 py-0.5 rounded-full">${subtitle1}</span>
              <span class="text-[10px] bg-pink-500/40 text-pink-200 border border-pink-400/50 font-bold px-2 py-0.5 rounded-full">${subtitle2}</span>
            </div>
          </div>

          <!-- Rounded QR Code Box -->
          <div class="pt-1">
            <div class="id-card-qr-box">
              <div id="${qrElementId}"></div>
            </div>
          </div>
        </div>

        <!-- Footer Kartu -->
        <div class="relative z-10 text-center border-t border-white/20 pt-1.5 space-y-0.5">
          <p class="text-[9px] font-bold text-pink-200 tracking-wide">${footerHint}</p>
          <p class="text-[8px] text-slate-300 font-medium">Kec. Karangawen, Kab. Demak, Jawa Tengah</p>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const qrEl = document.getElementById(qrElementId);
    if (qrEl) {
      qrEl.innerHTML = '';
      new QRCode(qrEl, {
        text: qrValue,
        width: 82,
        height: 82,
        colorDark: "#1e0b36",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }, 50);

  return html;
}

function previewSingleStudentCard(siswa) {
  document.getElementById('idCardModalTitle').innerText = 'Cetak Kartu Pelajar Digital';
  document.getElementById('idCardBulkControls').classList.add('hidden');
  const container = document.getElementById('idCardPreviewContainer');
  container.innerHTML = generateCardMarkup('siswa', siswa);
  document.getElementById('idCardModal').classList.remove('hidden');
  document.getElementById('idCardModal').classList.add('flex');
}

function openBulkStudentCardModal() {
  document.getElementById('idCardModalTitle').innerText = 'Cetak Kartu Pelajar Massal';
  document.getElementById('idCardBulkControls').classList.remove('hidden');
  renderBulkStudentCardsPreview();
  document.getElementById('idCardModal').classList.remove('hidden');
  document.getElementById('idCardModal').classList.add('flex');
}

function renderBulkStudentCardsPreview() {
  const selectedClass = document.getElementById('bulkCardClassFilter')?.value || '';
  const filtered = appState.students.filter(s => !selectedClass || s.rombel === selectedClass);
  
  if (document.getElementById('bulkCardCountBadge')) {
    document.getElementById('bulkCardCountBadge').innerText = `${filtered.length} Siswa`;
  }
  const container = document.getElementById('idCardPreviewContainer');
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 py-8">Tidak ada data siswa untuk rombel ini.</p>`;
    return;
  }

  filtered.forEach(s => {
    container.innerHTML += generateCardMarkup('siswa', s);
  });
}

function previewSingleTeacherCard(guru) {
  document.getElementById('idCardModalTitle').innerText = 'Cetak Kartu Identitas Guru';
  document.getElementById('idCardBulkControls').classList.add('hidden');
  const container = document.getElementById('idCardPreviewContainer');
  container.innerHTML = generateCardMarkup('guru', guru);
  document.getElementById('idCardModal').classList.remove('hidden');
  document.getElementById('idCardModal').classList.add('flex');
}

function openBulkTeacherCardModal() {
  document.getElementById('idCardModalTitle').innerText = 'Cetak Kartu Identitas Guru Massal';
  document.getElementById('idCardBulkControls').classList.add('hidden');
  const container = document.getElementById('idCardPreviewContainer');
  container.innerHTML = '';

  appState.teachers.forEach(t => {
    container.innerHTML += generateCardMarkup('guru', t);
  });

  document.getElementById('idCardModal').classList.remove('hidden');
  document.getElementById('idCardModal').classList.add('flex');
}

function closeIdCardModal() {
  document.getElementById('idCardModal').classList.remove('flex');
  document.getElementById('idCardModal').classList.add('hidden');
}

function previewMyTeacherCard() {
  if (!currentGuruSession) return;
  previewSingleTeacherCard(currentGuruSession);
}

function previewMyStudentCard() {
  if (!currentStudentSession) return;
  previewSingleStudentCard(currentStudentSession);
}

function printRenderedCards() {
  const container = document.getElementById('idCardPreviewContainer');
  const printGrid = document.getElementById('printCardsGrid');
  const printSection = document.getElementById('printSection');

  if (!container || !printGrid || !printSection) return;

  // Bersihkan grid cetak dan clone element
  printGrid.innerHTML = '';
  const cards = container.querySelectorAll('.id-card-wrapper');
  
  if (cards.length === 0) {
    alert('Tidak ada kartu yang siap dicetak.');
    return;
  }

  cards.forEach(card => {
    const clone = card.cloneNode(true);
    // Konversi semua canvas QRCode asli ke image pada elemen clone agar tidak blank saat print
    const origCanvases = card.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');

    origCanvases.forEach((origCanvas, idx) => {
      try {
        const dataUrl = origCanvas.toDataURL('image/png');
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.width = '82px';
        img.style.height = '82px';
        img.style.display = 'block';
        img.style.margin = '0 auto';
        if (cloneCanvases[idx] && cloneCanvases[idx].parentNode) {
          cloneCanvases[idx].parentNode.replaceChild(img, cloneCanvases[idx]);
        }
      } catch (e) {
        console.warn('Canvas to Image error during print preparation:', e);
      }
    });

    printGrid.appendChild(clone);
  });

  // Tampilkan printSection dan sembunyikan modal agar tidak konflik layout
  printSection.classList.remove('hidden');
  printSection.style.display = 'block';

  setTimeout(() => {
    window.print();
    // Kembalikan status display setelah jendela cetak ditutup
    setTimeout(() => {
      printSection.classList.add('hidden');
      printSection.style.display = 'none';
    }, 600);
  }, 350);
}

// ============================================
// 9. UPLOAD FOTO SISWA MASAL MELALUI .ZIP
// ============================================
function openZipUploadModal() {
  selectedZipPhotos = [];
  document.getElementById('zipFileInput').value = '';
  document.getElementById('zipSelectedInfo').classList.add('hidden');
  document.getElementById('zipMatchReport').classList.add('hidden');
  document.getElementById('zipProgressBarContainer').classList.add('hidden');
  document.getElementById('btnStartZipUpload').disabled = true;
  document.getElementById('zipUploadModal').classList.remove('hidden');
  document.getElementById('zipUploadModal').classList.add('flex');
}

function closeZipUploadModal() {
  document.getElementById('zipUploadModal').classList.remove('flex');
  document.getElementById('zipUploadModal').classList.add('hidden');
}

async function handleZipFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const infoBox = document.getElementById('zipSelectedInfo');
  const reportBox = document.getElementById('zipMatchReport');
  const btnStart = document.getElementById('btnStartZipUpload');
  const statusText = document.getElementById('zipStatusText');

  infoBox.classList.remove('hidden');
  document.getElementById('zipFileName').innerText = file.name;
  document.getElementById('zipFileSize').innerText = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
  statusText.innerText = 'Membaca dan mengekstrak berkas ZIP di peramban...';

  try {
    const zip = await JSZip.loadAsync(file);
    selectedZipPhotos = [];
    let totalFiles = 0;
    let matchedCount = 0;
    let reportHtml = '';

    const imageExtensions = ['.jpg', '.jpeg', '.png'];
    const fileNames = Object.keys(zip.files);

    for (const filename of fileNames) {
      const zipEntry = zip.files[filename];
      if (zipEntry.dir) continue;

      const lowerName = filename.toLowerCase();
      const isImage = imageExtensions.some(ext => lowerName.endsWith(ext));
      if (!isImage) continue;

      totalFiles++;
      const baseName = filename.split('/').pop().split('\\').pop();
      const cleanNisn = baseName.replace(/\.[^/.]+$/, '').trim();

      const matchedStudent = appState.students.find(s => s.nisn.toString().trim() === cleanNisn);
      if (matchedStudent) {
        matchedCount++;
        selectedZipPhotos.push({
          nisn: cleanNisn,
          entry: zipEntry,
          nama: matchedStudent.nama,
          rombel: matchedStudent.rombel
        });
        reportHtml += `<div class="text-emerald-700 flex items-center justify-between"><span><i class="fa-solid fa-circle-check"></i> NISN ${cleanNisn}: <b>${matchedStudent.nama}</b></span><span class="text-slate-400">${matchedStudent.rombel}</span></div>`;
      } else {
        reportHtml += `<div class="text-slate-400"><span><i class="fa-regular fa-circle-xmark"></i> ${baseName}: Tidak cocok dengan NISN siswa aktif.</span></div>`;
      }
    }

    reportBox.innerHTML = reportHtml || '<div class="text-rose-500">Tidak ada gambar yang cocok di dalam zip.</div>';
    reportBox.classList.remove('hidden');

    if (matchedCount > 0) {
      statusText.innerText = `Selesai memindai: ${matchedCount} dari ${totalFiles} foto cocok dengan siswa di database.`;
      btnStart.disabled = false;
    } else {
      statusText.innerText = `Dari ${totalFiles} foto, tidak ada yang cocok dengan NISN siswa aktif.`;
      btnStart.disabled = true;
    }
  } catch (err) {
    alert('Gagal membaca file ZIP: ' + err.message);
    statusText.innerText = 'Gagal memproses file ZIP.';
  }
}

async function startZipUploadProcess() {
  if (selectedZipPhotos.length === 0) return;

  const btn = document.getElementById('btnStartZipUpload');
  const progressContainer = document.getElementById('zipProgressBarContainer');
  const progressBar = document.getElementById('zipProgressBar');
  const statusText = document.getElementById('zipStatusText');

  btn.disabled = true;
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '10%';
  statusText.innerText = 'Mengonversi gambar base64...';

  const photoPayload = [];
  const total = selectedZipPhotos.length;

  for (let i = 0; i < total; i++) {
    const item = selectedZipPhotos[i];
    const base64Data = await item.entry.async("base64");
    const ext = item.entry.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    photoPayload.push({
      nisn: item.nisn,
      base64: `data:${ext};base64,${base64Data}`
    });
    progressBar.style.width = Math.round(((i + 1) / total) * 50) + '%';
  }

  statusText.innerText = `Mengunggah ${photoPayload.length} foto ke Google Drive...`;
  progressBar.style.width = '70%';

  const res = await apiPost('siswa.batchUploadPhotos', { photoList: photoPayload });
  progressBar.style.width = '100%';
  statusText.innerText = res.message;
  alert(res.message);

  if (res.success) {
    closeZipUploadModal();
    loadDataSWR(true);
  } else {
    btn.disabled = false;
  }
}

// ============================================
// 10. WHATSAPP GATEWAY & CRM PENGATURAN
// ============================================
async function loadWAStatusAdmin() {
  const res = await apiPost('wa.cekStatus');
  if (res.success) {
    const inputToken = document.getElementById('waFonnteTokenInput');
    const toggleWa = document.getElementById('waToggleAktif');
    if (inputToken) inputToken.placeholder = res.tokenTersamar ? `Token saat ini: ${res.tokenTersamar}` : 'Masukkan Token Fonnte';
    if (toggleWa) toggleWa.checked = res.waAktif;
  }
}

async function handleSaveWASettings(e) {
  e.preventDefault();
  const token = document.getElementById('waFonnteTokenInput').value.trim();
  const aktif = document.getElementById('waToggleAktif').checked;
  const res = await apiPost('wa.updateToken', { tokenFonnte: token, waAktif: aktif });
  alert(res.message);
}

async function handleTestSendWA() {
  const noHp = prompt('Masukkan nomor HP penerima WhatsApp (format 08... atau 62...):');
  if (!noHp) return;
  const res = await apiPost('wa.testSend', { noHp: noHp, nama: 'Bapak/Ibu Uji Coba' });
  alert(res.queued ? 'Pesan uji coba berhasil dimasukkan ke antrean! Akan dikirim dalam 1 menit.' : ('Gagal: ' + res.reason));
}

async function triggerManualProsesAntrian() {
  const btn = document.getElementById('btnProsesAntrian');
  if (btn) { btn.innerText = 'Mengirim...'; btn.disabled = true; }
  const res = await apiPost('wa.prosesAntrian');
  if (btn) { btn.innerText = 'Proses Antrean Sekarang'; btn.disabled = false; }
  alert(`Siklus pengiriman selesai. Diproses: ${res.count || 0} pesan.`);
}

// ============================================
// 11. MIGRASI DATABASE (gas-migrasi-database)
// ============================================
async function handleDryRunMigrasi() {
  const urlOrId = document.getElementById('migrasiSourceUrl').value.trim();
  if (!urlOrId) { alert('Masukkan URL atau ID spreadsheet lama'); return; }

  const reportBox = document.getElementById('migrasiReportBox');
  reportBox.classList.remove('hidden');
  reportBox.innerHTML = '<div class="text-indigo-600 font-bold py-4 text-center"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Melakukan simulasi pemindaian database lama...</div>';

  const res = await apiPost('migrasi.scan', { sourceIdOrUrl: urlOrId });
  if (res.success && res.report) {
    let html = `<div class="p-4 bg-slate-50 rounded-xl space-y-2 border">`;
    html += `<div class="font-extrabold text-slate-800 text-sm">Hasil Simulasi: ${res.report.sourceTitle}</div>`;
    Object.keys(res.report.sheets).forEach(shName => {
      const s = res.report.sheets[shName];
      html += `<div class="flex justify-between items-center text-xs border-b py-1"><span>Sheet <b>${shName}</b>:</span><span class="text-emerald-600">+${s.inserted} baru</span>, <span class="text-amber-600">${s.updated} update</span>, <span class="text-slate-400">${s.skipped} lewati</span></div>`;
    });
    html += `<p class="text-[11px] text-slate-500 pt-2">Simulasi aman 100%, data spreadsheet lama tidak disentuh.</p></div>`;
    reportBox.innerHTML = html;
    document.getElementById('btnEksekusiMigrasiReal').disabled = false;
  } else {
    reportBox.innerHTML = `<div class="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">${res.message}</div>`;
  }
}

async function handleEksekusiMigrasiNyata() {
  const urlOrId = document.getElementById('migrasiSourceUrl').value.trim();
  if (!confirm('Yakin ingin menyinkronkan data lama ke spreadsheet baru sekarang? Data baru yang ada tidak akan terhapus.')) return;

  const reportBox = document.getElementById('migrasiReportBox');
  reportBox.innerHTML = '<div class="text-emerald-600 font-bold py-4 text-center"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Mengeksekusi migrasi & sinkronisasi batch...</div>';

  const res = await apiPost('migrasi.execute', { sourceIdOrUrl: urlOrId });
  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
    reportBox.innerHTML += `<div class="text-emerald-700 font-bold text-xs mt-2">✅ Sinkronisasi delta selesai sukses!</div>`;
  }
}

// ============================================
// 12. EXCEL TEMPLATE GENERATORS (POIN 1 - 100% RELIABLE DUAL ENGINE)
// ============================================
function escapeXmlData_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function triggerBrowserDownloadFile_(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e){}
  }, 1200);
}

function downloadExcelFileHelper(filename, sheetName, headers, sampleRow) {
  // Engine 1: Gunakan SheetJS jika terpasang & berfungsi
  if (typeof XLSX !== 'undefined' && XLSX.utils && XLSX.write) {
    try {
      const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const finalXlsxName = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
      triggerBrowserDownloadFile_(blob, finalXlsxName);
      return;
    } catch (err) {
      console.warn('SheetJS gagal, beralih otomatis ke Native Excel Spreadsheet XML:', err);
    }
  }

  // Engine 2: Native Excel Spreadsheet XML (Zero Dependency - 100% Berhasil & Buka Langsung di Excel/WPS/Sheets)
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escapeXmlData_(sheetName)}">
  <Table>
   <Row>`;
  headers.forEach(h => {
    xml += `<Cell><Data ss:Type="String">${escapeXmlData_(h)}</Data></Cell>`;
  });
  xml += `</Row><Row>`;
  sampleRow.forEach(c => {
    xml += `<Cell><Data ss:Type="String">${escapeXmlData_(c)}</Data></Cell>`;
  });
  xml += `</Row>
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const finalXlsName = filename.replace(/\.xlsx$/i, '') + '.xls';
  triggerBrowserDownloadFile_(blob, finalXlsName);
}

function downloadStudentTemplate() {
  const headers = ["Nama", "NISN", "NIPD", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "NIK", "Agama", "Rombel", "Alamat", "Nomor HP", "Nama Ayah", "Nama Ibu", "Sekolah Asal", "Anak Ke", "Jumlah Saudara"];
  const sample = ["Ahmad Fauzi", "0081234567", "1001", "L", "Demak", "2015-05-12", "3321010000000001", "Islam", "Kelas 1", "Ds. Pilangrejo RT 01 RW 01", "081234567890", "Budi Santoso", "Siti Aminah", "TK Pertiwi", "1", "2"];
  downloadExcelFileHelper("Template_Import_Siswa.xlsx", "Data Siswa", headers, sample);
}

function downloadTeacherTemplate() {
  const headers = ["NIP", "Nama Guru", "Tempat Lahir", "Tanggal Lahir", "NIK", "Jabatan", "Nomor HP", "Email", "Alamat Rumah", "Jumlah Anak", "TMT CPNS", "TMT PNS", "NUPTK", "Pendidikan Terakhir"];
  const sample = ["198501012010011001", "Budi Santoso, S.Pd.", "Demak", "1985-01-01", "3321010000000002", "Guru Kelas", "081234567891", "guru@sekolah.sch.id", "Demak", "2", "2010-01-01", "2011-01-01", "1234567890123456", "S1 PGSD"];
  downloadExcelFileHelper("Template_Import_Guru.xlsx", "Data Guru", headers, sample);
}

function downloadPrestasiTemplate() {
  const headers = ["Tanggal", "Nama Siswa", "Kelas", "Jenis Prestasi", "Nama Lomba", "Juara", "Tingkat", "Penyelenggara"];
  const sample = ["2026-02-15", "Ahmad Fauzi", "Kelas 4", "Akademik", "Olimpiade Sains Matematika", "Juara 1", "Kabupaten/Kota", "Dinas Pendidikan"];
  downloadExcelFileHelper("Template_Import_Prestasi.xlsx", "Data Prestasi", headers, sample);
}

function downloadCatatanTemplate() {
  const headers = ["Tanggal", "Nama Siswa", "Kelas", "NIPD", "NISN", "Kategori Pelanggaran", "Jenis Pelanggaran", "Poin Pelanggaran", "Tindak Lanjut", "Guru Pendamping", "Keterangan"];
  const sample = ["2026-02-20", "Ahmad Fauzi", "Kelas 4", "1001", "0081234567", "Ringan", "Terlambat Masuk Sekolah", "5", "Teguran lisan & pembinaan", "Budi Santoso, S.Pd.", "Selesai"];
  downloadExcelFileHelper("Template_Import_Pelanggaran.xlsx", "Catatan Pelanggaran", headers, sample);
}

function downloadKonselingTemplate() {
  const headers = ["Tanggal", "Nama Siswa", "Kelas", "NIPD", "NISN", "Permasalahan", "Jenis Layanan", "Rencana Tindak Lanjut", "Keterangan", "Guru Pendamping"];
  const sample = ["2026-02-22", "Ahmad Fauzi", "Kelas 4", "1001", "0081234567", "Kesulitan fokus saat belajar", "Belajar", "Konseling individual", "Proses", "Budi Santoso, S.Pd."];
  downloadExcelFileHelper("Template_Import_Konseling.xlsx", "Data Konseling", headers, sample);
}

function downloadPelanggaranTemplate() {
  downloadCatatanTemplate();
}

// ============================================
// MODUL EKSPOR DOKUMEN: EXCEL, WORD & PDF (POIN 3)
// ============================================
function exportData(entity, format) {
  let title = 'Laporan Data';
  let dataList = [];
  let headers = [];
  let keys = [];

  if (entity === 'siswa') {
    title = 'Daftar Data Siswa SDN Pilangrejo 1';
    dataList = appState.students;
    headers = ['No', 'Nama Siswa', 'NISN', 'NIPD', 'JK', 'Kelas', 'TTL', 'Alamat', 'No HP', 'Nama Ayah', 'Nama Ibu'];
    keys = ['nama', 'nisn', 'nipd', 'jenisKelamin', 'rombel', 'ttl', 'alamat', 'nomerHp', 'namaAyah', 'namaIbu'];
  } else if (entity === 'guru') {
    title = 'Daftar Tenaga Pendidik & Kependidikan';
    dataList = appState.teachers;
    headers = ['No', 'Nama Guru', 'NIP', 'Jabatan', 'No HP', 'Email', 'Pendidikan'];
    keys = ['namaGuru', 'nip', 'jabatan', 'noHp', 'email', 'pendidikan'];
  } else if (entity === 'prestasi') {
    title = 'Daftar Rekap Prestasi Siswa';
    dataList = appState.prestasi;
    headers = ['No', 'Tanggal', 'Nama Siswa', 'Kelas', 'Lomba', 'Juara', 'Tingkat', 'Penyelenggara'];
    keys = ['tanggal', 'namaSiswa', 'kelas', 'namaLomba', 'juara', 'tingkat', 'penyelenggara'];
  } else if (entity === 'pelanggaran') {
    title = 'Daftar Catatan Pelanggaran & Poin Siswa';
    dataList = appState.catatanPelanggaran;
    headers = ['No', 'Tanggal', 'Nama Siswa', 'Kelas', 'Pelanggaran', 'Poin', 'Tindak Lanjut', 'Guru', 'Status'];
    keys = ['tanggal', 'namaSiswa', 'kelas', 'jenisPelanggaran', 'poin', 'tindakLanjut', 'guruPendamping', 'keterangan'];
  } else if (entity === 'konseling') {
    title = 'Daftar Layanan Bimbingan & Konseling';
    dataList = appState.konseling;
    headers = ['No', 'Tanggal', 'Nama Siswa', 'Kelas', 'Permasalahan', 'Layanan', 'Rencana Tindak', 'Guru', 'Status'];
    keys = ['tanggal', 'namaSiswa', 'kelas', 'permasalahan', 'jenisLayanan', 'rencanaTindakLanjut', 'guruPendamping', 'keterangan'];
  }

  if (dataList.length === 0) {
    alert('Tidak ada data yang dapat diekspor!');
    return;
  }

  if (format === 'excel') {
    const aoa = [
      [appState.profile.namaSekolah || 'SD NEGERI PILANGREJO 1'],
      [title],
      [`Dicetak pada: ${new Date().toLocaleDateString('id-ID')}`],
      [],
      headers
    ];
    dataList.forEach((item, idx) => {
      const row = [idx + 1];
      keys.forEach(k => {
        if (k === 'ttl') row.push(`${item.tempatLahir || ''}, ${item.tanggalLahir || ''}`);
        else row.push(item[k] || '-');
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entity.toUpperCase());
    XLSX.writeFile(wb, `${entity}_${Date.now()}.xlsx`);
  } else if (format === 'word' || format === 'pdf') {
    const rows = dataList.map((item, idx) => {
      const row = [idx + 1];
      keys.forEach(k => {
        if (k === 'ttl') row.push(`${item.tempatLahir || ''}, ${item.tanggalLahir || ''}`);
        else row.push(item[k] || '-');
      });
      return row;
    });
    exportDataCustomTable(title, headers, rows, format, entity);
  }
}

function exportDataCustomTable(title, headers, rows, format, filename) {
  let tableHtml = `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:10px;">
    <tr style="background:#047857;color:#ffffff;font-weight:bold;text-align:center;">`;
  headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
  tableHtml += `</tr>`;
  rows.forEach((r, idx) => {
    tableHtml += `<tr style="${idx % 2 === 1 ? 'background:#f8fafc;' : ''}">`;
    r.forEach((cell, cIdx) => {
      const align = (cIdx === 0) ? 'text-align:center;' : 'text-align:left;';
      tableHtml += `<td style="${align}">${cell}</td>`;
    });
    tableHtml += `</tr>`;
  });
  tableHtml += `</table>`;

  if (format === 'word') {
    const docContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${title}</title>
      <style>
        body { font-family: 'Times New Roman', serif; font-size: 11pt; margin: 15mm; }
        .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 6px; margin-bottom: 14px; }
        .kop h2 { margin: 0; font-size: 13pt; font-weight: bold; }
        .kop h3 { margin: 2px 0; font-size: 11pt; }
        .kop p { margin: 0; font-size: 9pt; color: #444; }
        .title { text-align: center; font-weight: bold; font-size: 12pt; margin: 12px 0 8px 0; text-transform: uppercase; }
        .ttd { margin-top: 25px; float: right; width: 230px; text-align: center; font-size: 10pt; }
      </style>
      </head>
      <body>
        <div class="kop">
          <h2>PEMERINTAH KABUPATEN DEMAK</h2>
          <h2>DINAS PENDIDIKAN DAN KEBUDAYAAN</h2>
          <h3>${(appState.profile.namaSekolah || 'SD NEGERI PILANGREJO 1').toUpperCase()}</h3>
          <p>${appState.profile.alamat || 'Kec. Karangawen, Kab. Demak, Jawa Tengah'}</p>
        </div>
        <div class="title">${title}</div>
        <p style="font-size:9pt;color:#555;">Dicetak pada: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        ${tableHtml}
        <div class="ttd">
          <p>Pilangrejo, ${new Date().toLocaleDateString('id-ID')}</p>
          <p>Kepala Sekolah,</p>
          <br><br><br>
          <p style="font-weight:bold;text-decoration:underline;">${appState.profile.namaKepsek || 'Kepala Sekolah'}</p>
          <p>NIP. -</p>
        </div>
      </body>
      </html>
    `;
    const blob = new Blob(['\ufeff' + docContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${Date.now()}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else if (format === 'pdf') {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
      <head>
        <title>${title}</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          body { font-family: sans-serif; margin: 0; color: #1e293b; }
          .kop { text-align: center; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10px; }
          .kop h2 { margin: 0; font-size: 13pt; }
          .kop p { margin: 2px 0 0 0; font-size: 8pt; color: #475569; }
          .title { text-align: center; font-weight: bold; font-size: 11pt; margin: 8px 0; }
          .ttd-box { margin-top: 20px; float: right; width: 200px; text-align: center; font-size: 9pt; }
        </style>
      </head>
      <body>
        <div class="kop">
          <h2>${(appState.profile.namaSekolah || 'SD NEGERI PILANGREJO 1').toUpperCase()}</h2>
          <p>${appState.profile.alamat || 'Kec. Karangawen, Kab. Demak, Jawa Tengah'}</p>
        </div>
        <div class="title">${title}</div>
        ${tableHtml}
        <div class="ttd-box">
          <p>Pilangrejo, ${new Date().toLocaleDateString('id-ID')}</p>
          <p>Mengetahui,<br>Kepala Sekolah</p>
          <br><br><br>
          <p style="font-weight:bold;text-decoration:underline;">${appState.profile.namaKepsek || 'Kepala Sekolah'}</p>
        </div>
        <script>
          setTimeout(() => { window.print(); }, 400);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
}

function printPelanggaranReport(format) { exportData('pelanggaran', format); }
function printKonselingReport(format) { exportData('konseling', format); }

function exportPresensiSiswa(format) {
  const filterBulan = document.getElementById('filterPresensiSiswaBulan')?.value || '';
  const filterTgl = document.getElementById('filterPresensiSiswaTanggal')?.value || '';
  const filterKelas = document.getElementById('filterPresensiSiswaKelas')?.value || '';
  const filterStatus = document.getElementById('filterPresensiSiswaStatus')?.value || '';

  const filtered = appState.presensiSiswa.filter(p => {
    if (filterBulan && (!p.tanggal || !p.tanggal.startsWith(filterBulan))) return false;
    if (filterTgl && p.tanggal !== filterTgl) return false;
    if (filterKelas && p.kelas !== filterKelas) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  const headers = ['No', 'Tanggal', 'Jam', 'Nama Siswa', 'NISN', 'Kelas', 'Metode', 'Status', 'Keterangan'];
  const title = `Laporan Rekap Presensi Siswa ${filterBulan ? 'Bulan ' + filterBulan : ''} ${filterKelas ? 'Kelas ' + filterKelas : ''}`;

  if (format === 'excel') {
    const aoa = [
      [appState.profile.namaSekolah || 'SD NEGERI PILANGREJO 1'],
      [title],
      [`Dicetak pada: ${new Date().toLocaleDateString('id-ID')}`],
      [],
      headers
    ];
    filtered.forEach((p, idx) => {
      aoa.push([idx + 1, p.tanggal, p.jam || '-', p.nama, p.nisn, p.kelas, p.metode || 'Manual', p.status, p.keterangan || '-']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Presensi_Siswa");
    XLSX.writeFile(wb, `Presensi_Siswa_${Date.now()}.xlsx`);
  } else {
    exportDataCustomTable(title, headers, filtered.map((p, idx) => [
      idx + 1, p.tanggal, p.jam || '-', p.nama, p.nisn, p.kelas, p.metode || 'Manual', p.status, p.keterangan || '-'
    ]), format, 'Presensi_Siswa');
  }
}

function exportPresensiGuru(format) {
  const filterBulan = document.getElementById('filterPresensiGuruBulan')?.value || '';
  const filterTgl = document.getElementById('filterPresensiGuruTanggal')?.value || '';
  const filterStatus = document.getElementById('filterPresensiGuruStatus')?.value || '';

  const filtered = appState.presensiGuru.filter(p => {
    if (filterBulan && (!p.tanggal || !p.tanggal.startsWith(filterBulan))) return false;
    if (filterTgl && p.tanggal !== filterTgl) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  const headers = ['No', 'Tanggal', 'Jam', 'Nama Guru', 'NIP', 'Jabatan', 'Metode', 'Status', 'Keterangan'];
  const title = `Laporan Rekap Presensi Dewan Guru & Staf ${filterBulan ? 'Bulan ' + filterBulan : ''}`;

  if (format === 'excel') {
    const aoa = [
      [appState.profile.namaSekolah || 'SD NEGERI PILANGREJO 1'],
      [title],
      [`Dicetak pada: ${new Date().toLocaleDateString('id-ID')}`],
      [],
      headers
    ];
    filtered.forEach((p, idx) => {
      aoa.push([idx + 1, p.tanggal, p.jam || '-', p.namaGuru, p.nip, p.jabatan || '-', p.metode || 'Manual', p.status, p.keterangan || '-']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Presensi_Guru");
    XLSX.writeFile(wb, `Presensi_Guru_${Date.now()}.xlsx`);
  } else {
    exportDataCustomTable(title, headers, filtered.map((p, idx) => [
      idx + 1, p.tanggal, p.jam || '-', p.namaGuru, p.nip, p.jabatan || '-', p.metode || 'Manual', p.status, p.keterangan || '-'
    ]), format, 'Presensi_Guru');
  }
}

// ============================================
// 13. UTILITY SOUND & STREAM CLEANUP
// ============================================
function playBeepSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
}

function stopAllCameraStreams() {
  stopAutoFaceAttendance();
  if (html5QrScannerSiswa) {
    try { html5QrScannerSiswa.clear(); } catch(e){}
    html5QrScannerSiswa = null;
  }
  if (html5QrScannerGuru) {
    try { html5QrScannerGuru.clear(); } catch(e){}
    html5QrScannerGuru = null;
  }
  if (videoStreamSiswa) {
    videoStreamSiswa.getTracks().forEach(track => track.stop());
    videoStreamSiswa = null;
  }
  if (videoStreamGuru) {
    videoStreamGuru.getTracks().forEach(track => track.stop());
    videoStreamGuru = null;
  }
  if (videoStreamSelfie) {
    videoStreamSelfie.getTracks().forEach(track => track.stop());
    videoStreamSelfie = null;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => reject(new Error("Gagal kompresi gambar"));
      img.src = e.target.result;
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const today = new Date();
  const birthDate = new Date(birthDateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return isNaN(age) ? null : age;
}

// ============================================
// 14. RENDERING KOMPONEN UI & DROPDOWNS
// ============================================
function updateSchoolProfileUI() {
  const p = appState.profile;
  if (!p || !p.namaSekolah) return;
  if (document.getElementById('headerNamaSekolah')) document.getElementById('headerNamaSekolah').innerText = p.namaSekolah;
  if (document.getElementById('headerLogo')) document.getElementById('headerLogo').src = p.logoUrl;
  if (document.getElementById('portalFotoKepsek')) document.getElementById('portalFotoKepsek').src = p.fotoKepsekUrl;
  if (document.getElementById('portalNamaKepsek')) document.getElementById('portalNamaKepsek').innerText = p.namaKepsek;
  if (document.getElementById('portalNamaSekolahSubtitle')) document.getElementById('portalNamaSekolahSubtitle').innerText = p.namaSekolah;
  if (document.getElementById('portalSambutan')) document.getElementById('portalSambutan').innerHTML = p.sambutan || '';
  if (document.getElementById('portalVisi')) document.getElementById('portalVisi').innerHTML = p.visi || '';
  if (document.getElementById('portalMisi')) document.getElementById('portalMisi').innerHTML = p.misi || '';
  if (document.getElementById('portalMapsIframe')) document.getElementById('portalMapsIframe').src = p.mapsEmbed;
  if (document.getElementById('portalAlamat')) document.getElementById('portalAlamat').innerText = p.alamat;
  if (document.getElementById('portalTelepon')) document.getElementById('portalTelepon').innerText = p.telepon;
  if (document.getElementById('portalEmail')) document.getElementById('portalEmail').innerText = p.email;
  if (document.getElementById('portalFb')) document.getElementById('portalFb').href = p.facebook || '#';
  if (document.getElementById('portalIg')) document.getElementById('portalIg').href = p.instagram || '#';
  if (document.getElementById('portalYt')) document.getElementById('portalYt').href = p.youtube || '#';
  if (document.getElementById('footerTitle')) document.getElementById('footerTitle').innerHTML = `&copy; 2026 ${p.namaSekolah}. All Rights Reserved.`;
}

function loadSchoolProfileForm() {
  const p = appState.profile;
  document.getElementById('profNamaSekolah').value = p.namaSekolah || '';
  document.getElementById('profLogoUrl').value = p.logoUrl || '';
  document.getElementById('profNamaKepsek').value = p.namaKepsek || '';
  document.getElementById('profFotoKepsekUrl').value = p.fotoKepsekUrl || '';
  if (window.quillSambutan) window.quillSambutan.root.innerHTML = p.sambutan || '';
  if (window.quillVisi) window.quillVisi.root.innerHTML = p.visi || '';
  if (window.quillMisi) window.quillMisi.root.innerHTML = p.misi || '';
  document.getElementById('profMapsEmbed').value = p.mapsEmbed || '';
  document.getElementById('profLatitude').value = p.latitude || '-6.892000';
  document.getElementById('profLongitude').value = p.longitude || '110.612000';
  document.getElementById('profRadiusPresensi').value = p.radiusPresensi || 150;
  document.getElementById('profAlamat').value = p.alamat || '';
  document.getElementById('profTelepon').value = p.telepon || '';
  document.getElementById('profEmail').value = p.email || '';
  document.getElementById('profFb').value = p.facebook || '';
  document.getElementById('profIg').value = p.instagram || '';
  document.getElementById('profYt').value = p.youtube || '';
}

async function handleSchoolProfileSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveWebData');
  btn.innerText = 'Menyimpan...'; btn.disabled = true;

  const logoFile = document.getElementById('profLogoFile').files[0];
  const kepsekFile = document.getElementById('profFotoKepsekFile').files[0];
  let logoBase64 = null, kepsekBase64 = null;
  if (logoFile) logoBase64 = await fileToBase64(logoFile);
  if (kepsekFile) kepsekBase64 = await fileToBase64(kepsekFile);

  let mapsInput = document.getElementById('profMapsEmbed').value;
  if (mapsInput.includes('<iframe') && mapsInput.includes('src=')) {
    const match = mapsInput.match(/src="([^"]+)"/);
    if (match && match[1]) mapsInput = match[1];
  }

  const payload = {
    namaSekolah: document.getElementById('profNamaSekolah').value,
    logoUrl: document.getElementById('profLogoUrl').value,
    logoBase64: logoBase64,
    namaKepsek: document.getElementById('profNamaKepsek').value,
    fotoKepsekUrl: document.getElementById('profFotoKepsekUrl').value,
    fotoKepsekBase64: kepsekBase64,
    sambutan: window.quillSambutan ? window.quillSambutan.root.innerHTML : '',
    visi: window.quillVisi ? window.quillVisi.root.innerHTML : '',
    misi: window.quillMisi ? window.quillMisi.root.innerHTML : '',
    mapsEmbed: mapsInput,
    latitude: document.getElementById('profLatitude').value || '-6.892000',
    longitude: document.getElementById('profLongitude').value || '110.612000',
    radiusPresensi: document.getElementById('profRadiusPresensi').value || 150,
    alamat: document.getElementById('profAlamat').value,
    telepon: document.getElementById('profTelepon').value,
    email: document.getElementById('profEmail').value,
    facebook: document.getElementById('profFb').value,
    instagram: document.getElementById('profIg').value,
    youtube: document.getElementById('profYt').value
  };

  const res = await apiPost('web.saveProfile', payload);
  btn.innerText = 'Simpan Pengaturan Web'; btn.disabled = false;
  alert(res.message);
  if (res.success) loadDataSWR(true);
}

function populateDropdowns() {
  const selectSiswaWajah = document.getElementById('selectSiswaWajah');
  const selectSiswaManual = document.getElementById('manualSiswaSelect');
  if (selectSiswaWajah) {
    selectSiswaWajah.innerHTML = '<option value="">-- Pilih Nama / NISN Siswa --</option>';
    appState.students.forEach(s => { selectSiswaWajah.innerHTML += `<option value="${s.nisn}">${s.nama} (${s.rombel || 'No Class'}) - ${s.nisn}</option>`; });
  }
  if (selectSiswaManual) {
    selectSiswaManual.innerHTML = '<option value="">-- Pilih Siswa --</option>';
    appState.students.forEach(s => { selectSiswaManual.innerHTML += `<option value="${s.nisn}">${s.nama} (${s.rombel || 'No Class'}) - ${s.nisn}</option>`; });
  }

  const selectGuruWajah = document.getElementById('selectGuruWajah');
  const selectGuruManual = document.getElementById('manualGuruSelect');
  const selectWali = document.getElementById('inputWaliKelas');
  const selectCatatanGuru = document.getElementById('catatanGuruSelect');
  const selectKonselingGuru = document.getElementById('konselingGuruSelect');

  if (selectGuruWajah) selectGuruWajah.innerHTML = '<option value="">-- Pilih Guru --</option>';
  if (selectGuruManual) selectGuruManual.innerHTML = '<option value="">-- Pilih Guru --</option>';
  if (selectWali) selectWali.innerHTML = '<option value="">Pilih Wali Kelas</option>';
  if (selectCatatanGuru) selectCatatanGuru.innerHTML = '<option value="">-- Pilih Guru --</option>';
  if (selectKonselingGuru) selectKonselingGuru.innerHTML = '<option value="">-- Pilih Guru Pendamping --</option>';

  appState.teachers.forEach(t => {
    const val = t.nip || t.namaGuru;
    if (selectGuruWajah) selectGuruWajah.innerHTML += `<option value="${val}">${t.namaGuru} (${t.jabatan || 'Guru'})</option>`;
    if (selectGuruManual) selectGuruManual.innerHTML += `<option value="${val}">${t.namaGuru} (${t.jabatan || 'Guru'})</option>`;
    if (selectWali) selectWali.innerHTML += `<option value="${t.namaGuru}">${t.namaGuru}</option>`;
    if (selectCatatanGuru) selectCatatanGuru.innerHTML += `<option value="${t.namaGuru}">${t.namaGuru}</option>`;
    if (selectKonselingGuru) selectKonselingGuru.innerHTML += `<option value="${t.namaGuru}">${t.namaGuru}</option>`;
  });

  const selectRombel = document.getElementById('rombel');
  const selectFilterCatatanKelas = document.getElementById('filterCatatanKelas');
  const selectFilterPresensiKelas = document.getElementById('filterPresensiSiswaKelas');
  const selectBulkCard = document.getElementById('bulkCardClassFilter');

  if (selectRombel) selectRombel.innerHTML = '<option value="">Pilih Kelas</option>';
  if (selectFilterCatatanKelas) selectFilterCatatanKelas.innerHTML = '<option value="">Semua Kelas</option>';
  if (selectFilterPresensiKelas) selectFilterPresensiKelas.innerHTML = '<option value="">Semua Kelas</option>';
  if (selectBulkCard) selectBulkCard.innerHTML = '<option value="">Semua Siswa</option>';

  appState.classes.forEach(c => {
    if (selectRombel) selectRombel.innerHTML += `<option value="${c.namaKelas}">${c.namaKelas}</option>`;
    if (selectFilterCatatanKelas) selectFilterCatatanKelas.innerHTML += `<option value="${c.namaKelas}">${c.namaKelas}</option>`;
    if (selectFilterPresensiKelas) selectFilterPresensiKelas.innerHTML += `<option value="${c.namaKelas}">${c.namaKelas}</option>`;
    if (selectBulkCard) selectBulkCard.innerHTML += `<option value="${c.namaKelas}">${c.namaKelas}</option>`;
  });

  const selectJenis = document.getElementById('catatanJenisSelect');
  if (selectJenis) {
    selectJenis.innerHTML = '<option value="">-- Pilih Jenis --</option>';
    appState.jenisPelanggaran.forEach(j => {
      selectJenis.innerHTML += `<option value="${j.jenisPelanggaran}" data-kategori="${j.kategoriPelanggaran}" data-poin="${j.pointPelanggaran}">${j.jenisPelanggaran} (${j.kategoriPelanggaran} - ${j.pointPelanggaran} Poin)</option>`;
    });
  }
}

// Quill Editors Init
function initQuillEditors() {
  if (typeof Quill === 'undefined') return;
  const toolbarOptions = [
    [{ 'align': [] }],
    ['bold', 'italic', 'underline'],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
    ['clean']
  ];
  if (document.getElementById('profSambutanEditor')) window.quillSambutan = new Quill('#profSambutanEditor', { theme: 'snow', modules: { toolbar: toolbarOptions }});
  if (document.getElementById('profVisiEditor')) window.quillVisi = new Quill('#profVisiEditor', { theme: 'snow', modules: { toolbar: toolbarOptions }});
  if (document.getElementById('profMisiEditor')) window.quillMisi = new Quill('#profMisiEditor', { theme: 'snow', modules: { toolbar: toolbarOptions }});
  if (document.getElementById('webCMSKontenEditor')) window.quillWebCMS = new Quill('#webCMSKontenEditor', { theme: 'snow', modules: { toolbar: toolbarOptions }});
}

// Rendering CRUD Tables
function renderAdminTable() {
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const kw = (document.getElementById('searchAdminSiswa')?.value || '').toLowerCase();
  const filtered = appState.students.filter(s => s.nama.toLowerCase().includes(kw) || s.nisn.toString().includes(kw) || s.rombel.toLowerCase().includes(kw));
  if (document.getElementById('statTotalSiswa')) document.getElementById('statTotalSiswa').innerText = appState.students.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">Tidak ada data siswa.</td></tr>`;
    return;
  }

  filtered.forEach((s, idx) => {
    const fotoSrc = s.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-center"><input type="checkbox" class="student-checkbox" value="${s.rowId}"></td>
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <img src="${fotoSrc}" class="w-8 h-8 rounded-full object-cover border border-indigo-200 shrink-0" alt="Foto">
            <div>
              <div class="font-bold text-slate-800">${s.nama}</div>
              <div class="text-xs text-slate-400">NISN: ${s.nisn}</div>
            </div>
          </div>
        </td>
        <td class="p-3">${s.jenisKelamin}</td>
        <td class="p-3"><span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-xs font-semibold">${s.rombel}</span></td>
        <td class="p-3 text-xs">${s.tempatLahir}, ${s.tanggalLahir}</td>
        <td class="p-3 text-xs">${s.namaAyah || '-'}<br><span class="text-slate-400">Ibu: ${s.namaIbu || '-'}</span></td>
        <td class="p-3 text-center">
          <div class="flex justify-center gap-1.5">
            <button onclick='previewSingleStudentCard(${JSON.stringify(s)})' title="Cetak Kartu Pelajar" class="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition"><i class="fa-solid fa-id-card"></i></button>
            <button onclick='editStudent(${JSON.stringify(s)})' title="Edit Siswa" class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition"><i class="fa-solid fa-pen"></i></button>
            <button onclick='deleteStudent(${s.rowId})' title="Hapus Siswa" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function toggleSelectAllStudents(master) {
  document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = master.checked);
}

async function deleteSelectedStudents() {
  const selected = document.querySelectorAll('.student-checkbox:checked');
  if (selected.length === 0) { alert('Pilih minimal satu siswa.'); return; }
  if (confirm(`Hapus ${selected.length} data siswa terpilih?`)) {
    const rowIds = Array.from(selected).map(cb => parseInt(cb.value));
    const res = await apiPost('siswa.deleteMultiple', { rowIds: rowIds });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function openStudentModal() {
  document.getElementById('studentForm').reset();
  document.getElementById('studentRowId').value = '';
  document.getElementById('studentModalTitle').innerText = 'Tambah Data Siswa';
  document.getElementById('studentModal').classList.remove('hidden');
  document.getElementById('studentModal').classList.add('flex');
}

function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('flex');
  document.getElementById('studentModal').classList.add('hidden');
}

function editStudent(s) {
  document.getElementById('studentRowId').value = s.rowId;
  document.getElementById('nama').value = s.nama;
  document.getElementById('nisn').value = s.nisn;
  document.getElementById('nipd').value = s.nipd;
  document.getElementById('jenisKelamin').value = s.jenisKelamin;
  document.getElementById('tempatLahir').value = s.tempatLahir;
  document.getElementById('tanggalLahir').value = s.tanggalLahir;
  document.getElementById('nik').value = s.nik;
  document.getElementById('agama').value = s.agama;
  document.getElementById('rombel').value = s.rombel;
  document.getElementById('alamat').value = s.alamat;
  document.getElementById('nomerHp').value = s.nomerHp;
  document.getElementById('namaAyah').value = s.namaAyah;
  document.getElementById('namaIbu').value = s.namaIbu;
  document.getElementById('sekolahAsal').value = s.sekolahAsal;
  document.getElementById('anakKe').value = s.anakKe;
  document.getElementById('jmlSaudara').value = s.jmlSaudara;
  document.getElementById('studentModalTitle').innerText = 'Edit Data Siswa';
  document.getElementById('studentModal').classList.remove('hidden');
  document.getElementById('studentModal').classList.add('flex');
}

async function handleStudentFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('studentRowId').value;
  const data = {
    nama: document.getElementById('nama').value,
    nisn: document.getElementById('nisn').value,
    nipd: document.getElementById('nipd').value,
    jenisKelamin: document.getElementById('jenisKelamin').value,
    tempatLahir: document.getElementById('tempatLahir').value,
    tanggalLahir: document.getElementById('tanggalLahir').value,
    nik: document.getElementById('nik').value,
    agama: document.getElementById('agama').value,
    rombel: document.getElementById('rombel').value,
    alamat: document.getElementById('alamat').value,
    nomerHp: document.getElementById('nomerHp').value,
    namaAyah: document.getElementById('namaAyah').value,
    namaIbu: document.getElementById('namaIbu').value,
    sekolahAsal: document.getElementById('sekolahAsal').value,
    anakKe: document.getElementById('anakKe').value,
    jmlSaudara: document.getElementById('jmlSaudara').value
  };

  const res = await apiPost('siswa.save', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeStudentModal();
    loadDataSWR(true);
  }
}

async function deleteStudent(rowId) {
  if (confirm('Hapus siswa ini?')) {
    const res = await apiPost('siswa.delete', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function handleStudentExcelImport() {
  const fileInput = document.getElementById('excelStudentFile');
  const file = fileInput.files[0];
  if (!file) return;

  const btn = document.getElementById('btnUploadStudent');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
  btn.disabled = true;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, {type: 'array'});
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(firstSheet, {header: 1, defval: ""});
    json.shift();

    const res = await apiPost('siswa.importExcel', { rows: json }, currentAdminToken);
    alert(res.message);
    fileInput.value = '';
    btn.classList.add('hidden');
    btn.disabled = false;
    if (res.success) loadDataSWR(true);
  };
  reader.readAsArrayBuffer(file);
}

// Teacher Table Logic
function renderTeacherTable() {
  const tbody = document.getElementById('teacherTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const kw = (document.getElementById('searchAdminGuru')?.value || '').toLowerCase();
  const filtered = appState.teachers.filter(t => t.namaGuru.toLowerCase().includes(kw) || (t.nip && t.nip.toLowerCase().includes(kw)));
  if (document.getElementById('statTotalGuru')) document.getElementById('statTotalGuru').innerText = appState.teachers.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">Tidak ada data guru.</td></tr>`;
    return;
  }

  filtered.forEach((t, idx) => {
    const fotoSrc = t.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-center"><input type="checkbox" class="teacher-checkbox" value="${t.rowId}"></td>
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <img src="${fotoSrc}" class="w-8 h-8 rounded-full object-cover border border-teal-200 shrink-0" alt="Foto">
            <div>
              <div class="font-bold">${t.namaGuru}</div>
              <div class="text-xs text-slate-400">NIP: ${t.nip || '-'}</div>
            </div>
          </div>
        </td>
        <td class="p-3">${t.jabatan || '-'}</td>
        <td class="p-3 text-xs">${t.noHp || '-'}<br><span class="text-slate-400">${t.email || '-'}</span></td>
        <td class="p-3">${t.pendidikanTerakhir || '-'}</td>
        <td class="p-3 text-center">
          <div class="flex justify-center gap-1.5">
            <button onclick='previewSingleTeacherCard(${JSON.stringify(t)})' title="Cetak Kartu Guru" class="p-2 bg-teal-50 text-teal-600 rounded-lg hover:bg-teal-100 transition"><i class="fa-solid fa-id-card"></i></button>
            <button onclick='editTeacher(${JSON.stringify(t)})' title="Edit Guru" class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition"><i class="fa-solid fa-pen"></i></button>
            <button onclick='deleteTeacher(${t.rowId})' title="Hapus Guru" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function openTeacherModal() {
  document.getElementById('teacherForm').reset();
  document.getElementById('teacherRowId').value = '';
  document.getElementById('teacherModalTitle').innerText = 'Tambah Data Guru';
  document.getElementById('teacherModal').classList.remove('hidden');
  document.getElementById('teacherModal').classList.add('flex');
}

function closeTeacherModal() {
  document.getElementById('teacherModal').classList.remove('flex');
  document.getElementById('teacherModal').classList.add('hidden');
}

function editTeacher(t) {
  document.getElementById('teacherRowId').value = t.rowId;
  document.getElementById('teacherNip').value = t.nip;
  document.getElementById('teacherNama').value = t.namaGuru;
  document.getElementById('teacherTempatLahir').value = t.tempatLahir;
  document.getElementById('teacherTanggalLahir').value = t.tanggalLahir;
  document.getElementById('teacherNik').value = t.nik;
  document.getElementById('teacherJabatan').value = t.jabatan;
  document.getElementById('teacherNoHp').value = t.noHp;
  document.getElementById('teacherEmail').value = t.email;
  document.getElementById('teacherAlamat').value = t.alamatRumah;
  document.getElementById('teacherJumlahAnak').value = t.jumlahAnak;
  document.getElementById('teacherTmtCpns').value = t.tmtCpns;
  document.getElementById('teacherTmtPns').value = t.tmtPns;
  document.getElementById('teacherNuptk').value = t.nuptk;
  document.getElementById('teacherPendidikan').value = t.pendidikanTerakhir;
  document.getElementById('teacherModalTitle').innerText = 'Edit Data Guru';
  document.getElementById('teacherModal').classList.remove('hidden');
  document.getElementById('teacherModal').classList.add('flex');
}

async function handleTeacherFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('teacherRowId').value;
  const data = {
    nip: document.getElementById('teacherNip').value,
    namaGuru: document.getElementById('teacherNama').value,
    tempatLahir: document.getElementById('teacherTempatLahir').value,
    tanggalLahir: document.getElementById('teacherTanggalLahir').value,
    nik: document.getElementById('teacherNik').value,
    jabatan: document.getElementById('teacherJabatan').value,
    noHp: document.getElementById('teacherNoHp').value,
    email: document.getElementById('teacherEmail').value,
    alamatRumah: document.getElementById('teacherAlamat').value,
    jumlahAnak: document.getElementById('teacherJumlahAnak').value,
    tmtCpns: document.getElementById('teacherTmtCpns').value,
    tmtPns: document.getElementById('teacherTmtPns').value,
    nuptk: document.getElementById('teacherNuptk').value,
    pendidikanTerakhir: document.getElementById('teacherPendidikan').value
  };

  const res = await apiPost('guru.save', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeTeacherModal();
    loadDataSWR(true);
  }
}

async function deleteTeacher(rowId) {
  if (confirm('Hapus guru ini?')) {
    const res = await apiPost('guru.delete', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function handleTeacherExcelImport() {
  const fileInput = document.getElementById('excelTeacherFile');
  const file = fileInput.files[0];
  if (!file) return;

  const btn = document.getElementById('btnUploadTeacher');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
  btn.disabled = true;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const data = new Uint8Array(e.target.result);
    const json = XLSX.utils.sheet_to_json(XLSX.read(data, {type: 'array'}).Sheets[XLSX.read(data, {type: 'array'}).SheetNames[0]], {header: 1, defval: ""});
    json.shift();

    const res = await apiPost('guru.importExcel', { rows: json }, currentAdminToken);
    alert(res.message);
    fileInput.value = '';
    btn.classList.add('hidden');
    btn.disabled = false;
    if (res.success) loadDataSWR(true);
  };
  reader.readAsArrayBuffer(file);
}

// Class Table Logic
function renderClassTable() {
  const tbody = document.getElementById('classTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (appState.classes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">Belum ada kelas.</td></tr>`;
    return;
  }
  appState.classes.forEach((c, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3 font-bold text-indigo-600">${c.namaKelas}</td>
        <td class="p-3 text-center"><span class="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-semibold">${c.jumlahSiswa} Siswa</span></td>
        <td class="p-3">${c.waliKelas || '-'}</td>
        <td class="p-3 text-center">
          <button onclick='deleteClass(${c.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openClassModal() {
  document.getElementById('classForm').reset();
  document.getElementById('classRowId').value = '';
  document.getElementById('classModal').classList.remove('hidden');
  document.getElementById('classModal').classList.add('flex');
}
function closeClassModal() {
  document.getElementById('classModal').classList.remove('flex');
  document.getElementById('classModal').classList.add('hidden');
}

async function handleClassFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('classRowId').value;
  const data = {
    namaKelas: document.getElementById('inputNamaKelas').value,
    waliKelas: document.getElementById('inputWaliKelas').value
  };
  const res = await apiPost('kelas.save', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeClassModal();
    loadDataSWR(true);
  }
}

async function deleteClass(rowId) {
  if (confirm('Hapus kelas ini?')) {
    const res = await apiPost('kelas.delete', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// Prestasi Table Logic
function renderPrestasiTable() {
  const tbody = document.getElementById('prestasiTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const filterJuara = document.getElementById('filterPrestasiJuara')?.value || '';
  const filterWilayah = document.getElementById('filterPrestasiWilayah')?.value || '';

  const filtered = appState.prestasi.filter(p => {
    if (filterJuara && p.juara !== filterJuara) return false;
    if (filterWilayah && p.tingkat !== filterWilayah) return false;
    return true;
  });

  if (document.getElementById('statTotalPrestasi')) document.getElementById('statTotalPrestasi').innerText = appState.prestasi.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">Tidak ada data prestasi sesuai filter.</td></tr>`;
    return;
  }

  filtered.forEach((p, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-center"><input type="checkbox" class="prestasi-checkbox" value="${p.rowId}"></td>
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">${p.tanggal}</td>
        <td class="p-3"><div class="font-bold">${p.namaSiswa}</div><span class="text-slate-400">${p.kelas}</span></td>
        <td class="p-3"><span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-xs font-semibold">${p.jenisPrestasi}</span><br><span class="font-semibold">${p.namaLomba}</span></td>
        <td class="p-3 font-bold text-emerald-600">${p.juara}<br><span class="text-xs text-slate-500 font-normal">Tingkat: ${p.tingkat}</span></td>
        <td class="p-3 text-xs text-slate-500">${p.penyelenggara || '-'}</td>
        <td class="p-3 text-center">
          <button onclick='deletePrestasi(${p.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openPrestasiModal() {
  document.getElementById('prestasiForm').reset();
  document.getElementById('prestasiRowId').value = '';
  document.getElementById('prestasiModal').classList.remove('hidden');
  document.getElementById('prestasiModal').classList.add('flex');
}
function closePrestasiModal() {
  document.getElementById('prestasiModal').classList.remove('flex');
  document.getElementById('prestasiModal').classList.add('hidden');
}

async function handlePrestasiFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('prestasiRowId').value;
  const data = {
    tanggal: document.getElementById('inputPrestasiTanggal').value,
    namaSiswa: document.getElementById('inputPrestasiNamaSiswa').value,
    kelas: document.getElementById('inputPrestasiKelas').value,
    jenisPrestasi: document.getElementById('inputPrestasiJenis').value,
    namaLomba: document.getElementById('inputPrestasiLomba').value,
    juara: document.getElementById('inputPrestasiJuara').value,
    tingkat: document.getElementById('inputPrestasiTingkat').value,
    penyelenggara: document.getElementById('inputPrestasiPenyelenggara').value
  };

  const res = await apiPost('prestasi.save', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closePrestasiModal();
    loadDataSWR(true);
  }
}

async function deletePrestasi(rowId) {
  if (confirm('Hapus data prestasi ini?')) {
    const res = await apiPost('prestasi.delete', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// Jenis & Catatan Pelanggaran
function renderJenisTable() {
  const tbody = document.getElementById('jenisTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  appState.jenisPelanggaran.forEach((j, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3 font-semibold">${j.jenisPelanggaran}</td>
        <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded text-xs">${j.kategoriPelanggaran}</span></td>
        <td class="p-3 font-bold text-rose-600">${j.pointPelanggaran} Poin</td>
        <td class="p-3 text-center">
          <button onclick='deleteJenis(${j.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openJenisModal() {
  document.getElementById('jenisForm').reset();
  document.getElementById('jenisRowId').value = '';
  document.getElementById('jenisModal').classList.remove('hidden');
  document.getElementById('jenisModal').classList.add('flex');
}
function closeJenisModal() {
  document.getElementById('jenisModal').classList.remove('flex');
  document.getElementById('jenisModal').classList.add('hidden');
}

async function handleJenisFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('jenisRowId').value;
  const data = {
    jenisPelanggaran: document.getElementById('inputJenisNama').value,
    kategoriPelanggaran: document.getElementById('inputJenisKategori').value,
    pointPelanggaran: document.getElementById('inputJenisPoin').value
  };
  const res = await apiPost('pelanggaran.saveJenis', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeJenisModal();
    loadDataSWR(true);
  }
}

async function deleteJenis(rowId) {
  if (confirm('Hapus jenis pelanggaran ini?')) {
    const res = await apiPost('pelanggaran.deleteJenis', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function renderCatatanTable() {
  const tbody = document.getElementById('catatanTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fk = document.getElementById('filterCatatanKelas')?.value || '';
  const fkat = document.getElementById('filterCatatanJenis')?.value || '';

  const filtered = appState.catatanPelanggaran.filter(c => {
    if (fk && c.kelas !== fk) return false;
    if (fkat && c.kategoriPelanggaran !== fkat) return false;
    return true;
  });

  filtered.forEach((c, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-center"><input type="checkbox" class="catatan-checkbox" value="${c.rowId}"></td>
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">${c.tanggal}</td>
        <td class="p-3"><div class="font-bold">${c.namaSiswa}</div><span class="text-slate-400">${c.kelas}</span></td>
        <td class="p-3 font-semibold">${c.jenisPelanggaran}</td>
        <td class="p-3"><span class="bg-rose-50 text-rose-600 px-2 py-0.5 rounded text-xs font-bold">${c.kategoriPelanggaran}</span></td>
        <td class="p-3 font-bold text-rose-600">+${c.poinPelanggaran}</td>
        <td class="p-3">${c.tindakLanjut}</td>
        <td class="p-3">${c.guruPendamping}</td>
        <td class="p-3">${c.keterangan}</td>
        <td class="p-3 text-center">
          <button onclick='deleteCatatanPelanggaran(${c.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openCatatanModal() {
  document.getElementById('catatanForm').reset();
  document.getElementById('catatanRowId').value = '';
  document.getElementById('catatanSiswaSearchInput').value = '';
  document.getElementById('catatanModal').classList.remove('hidden');
  document.getElementById('catatanModal').classList.add('flex');
}
function closeCatatanModal() {
  document.getElementById('catatanModal').classList.remove('flex');
  document.getElementById('catatanModal').classList.add('hidden');
}

function onCatatanJenisSelect() {
  const sel = document.getElementById('catatanJenisSelect');
  const opt = sel.options[sel.selectedIndex];
  if (opt) {
    document.getElementById('catatanKategori').value = opt.getAttribute('data-kategori') || '';
    document.getElementById('catatanPoin').value = opt.getAttribute('data-poin') || '';
  }
}

function filterCatatanStudentList() {
  const kw = document.getElementById('catatanSiswaSearchInput').value.toLowerCase().trim();
  const box = document.getElementById('catatanStudentSuggestions');
  if (!box) return;
  box.innerHTML = '';
  if (!kw) { box.classList.add('hidden'); return; }
  const matched = appState.students.filter(s => s.nama.toLowerCase().includes(kw) || s.nisn.toString().includes(kw));
  if (matched.length === 0) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  matched.forEach(s => {
    const div = document.createElement('div');
    div.className = "p-2 hover:bg-slate-100 cursor-pointer text-xs border-b";
    div.innerHTML = `<strong>${s.nama}</strong> (${s.rombel}) - NISN: ${s.nisn}`;
    div.onclick = function() {
      document.getElementById('catatanSiswaSearchInput').value = s.nama + ' (' + s.rombel + ')';
      document.getElementById('catatanNamaSiswa').value = s.nama;
      document.getElementById('catatanKelas').value = s.rombel;
      document.getElementById('catatanNisn').value = s.nisn;
      document.getElementById('catatanNipd').value = s.nipd;
      box.classList.add('hidden');
    };
    box.appendChild(div);
  });
}

async function handleCatatanFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('catatanRowId').value;
  const data = {
    tanggal: document.getElementById('catatanTanggal').value,
    namaSiswa: document.getElementById('catatanNamaSiswa').value,
    kelas: document.getElementById('catatanKelas').value,
    nipd: document.getElementById('catatanNipd').value,
    nisn: document.getElementById('catatanNisn').value,
    kategoriPelanggaran: document.getElementById('catatanKategori').value,
    jenisPelanggaran: document.getElementById('catatanJenisSelect').value,
    poinPelanggaran: document.getElementById('catatanPoin').value,
    tindakLanjut: document.getElementById('catatanTindak').value,
    guruPendamping: document.getElementById('catatanGuruSelect').value,
    keterangan: document.getElementById('catatanKeterangan').value
  };

  const res = await apiPost('pelanggaran.saveCatatan', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeCatatanModal();
    loadDataSWR(true);
  }
}

async function deleteCatatanPelanggaran(rowId) {
  if (confirm('Hapus catatan pelanggaran ini?')) {
    const res = await apiPost('pelanggaran.deleteCatatan', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// Konseling Table Logic
function renderKonselingTable() {
  const tbody = document.getElementById('konselingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  appState.konseling.forEach((c, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-center"><input type="checkbox" class="konseling-checkbox" value="${c.rowId}"></td>
        <td class="p-3">${idx + 1}</td>
        <td class="p-3">${c.tanggal}</td>
        <td class="p-3"><div class="font-bold">${c.namaSiswa}</div><span class="text-slate-400">${c.kelas}</span></td>
        <td class="p-3">${c.permasalahan}</td>
        <td class="p-3"><span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">${c.jenisLayanan}</span></td>
        <td class="p-3">${c.tindakLanjut}</td>
        <td class="p-3">${c.guruPendamping}</td>
        <td class="p-3">${c.keterangan}</td>
        <td class="p-3 text-center">
          <button onclick='deleteKonseling(${c.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openKonselingModal() {
  document.getElementById('konselingForm').reset();
  document.getElementById('konselingRowId').value = '';
  document.getElementById('konselingSiswaSearchInput').value = '';
  document.getElementById('konselingModal').classList.remove('hidden');
  document.getElementById('konselingModal').classList.add('flex');
}
function closeKonselingModal() {
  document.getElementById('konselingModal').classList.remove('flex');
  document.getElementById('konselingModal').classList.add('hidden');
}

function filterKonselingStudentList() {
  const kw = document.getElementById('konselingSiswaSearchInput').value.toLowerCase().trim();
  const box = document.getElementById('konselingStudentSuggestions');
  if (!box) return;
  box.innerHTML = '';
  if (!kw) { box.classList.add('hidden'); return; }
  const matched = appState.students.filter(s => s.nama.toLowerCase().includes(kw) || s.nisn.toString().includes(kw));
  if (matched.length === 0) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  matched.forEach(s => {
    const div = document.createElement('div');
    div.className = "p-2 hover:bg-slate-100 cursor-pointer text-xs border-b";
    div.innerHTML = `<strong>${s.nama}</strong> (${s.rombel}) - NISN: ${s.nisn}`;
    div.onclick = function() {
      document.getElementById('konselingSiswaSearchInput').value = s.nama + ' (' + s.rombel + ')';
      document.getElementById('konselingNamaSiswa').value = s.nama;
      document.getElementById('konselingKelas').value = s.rombel;
      document.getElementById('konselingNisn').value = s.nisn;
      document.getElementById('konselingNipd').value = s.nipd;
      box.classList.add('hidden');
    };
    box.appendChild(div);
  });
}

async function handleKonselingFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('konselingRowId').value;
  const file = document.getElementById('konselingBuktiFile').files[0];
  let buktiBase64 = null;
  if (file) buktiBase64 = await fileToBase64(file);

  const data = {
    tanggal: document.getElementById('konselingTanggal').value,
    namaSiswa: document.getElementById('konselingNamaSiswa').value,
    kelas: document.getElementById('konselingKelas').value,
    nipd: document.getElementById('konselingNipd').value,
    nisn: document.getElementById('konselingNisn').value,
    permasalahan: document.getElementById('konselingPermasalahan').value,
    jenisLayanan: document.getElementById('konselingJenis').value,
    tindakLanjut: document.getElementById('konselingTindak').value,
    keterangan: document.getElementById('konselingKeterangan').value,
    guruPendamping: document.getElementById('konselingGuruSelect').value,
    buktiBase64: buktiBase64
  };

  const res = await apiPost('konseling.save', data, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeKonselingModal();
    loadDataSWR(true);
  }
}

async function deleteKonseling(rowId) {
  if (confirm('Hapus riwayat konseling ini?')) {
    const res = await apiPost('konseling.delete', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

// Web CMS & Galeri
function renderWebCMSTable() {
  const tbody = document.getElementById('webCMSTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const filtered = appState.webCMS.filter(c => c.tipe === currentWebSubTab);
  filtered.forEach((c, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3"><img src="${c.fotoUrl || 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=200'}" class="w-16 h-10 object-cover rounded-lg shadow-sm" alt="Thumbnail"></td>
        <td class="p-3 font-bold text-slate-800">${c.judul}</td>
        <td class="p-3 text-xs text-slate-500">${c.tanggal}</td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">${c.kategori || c.tipe}</span></td>
        <td class="p-3 text-center">
          <button onclick='deleteCMS(${c.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openWebCMSModal() {
  document.getElementById('webCMSForm').reset();
  document.getElementById('webCMSRowId').value = '';
  if (window.quillWebCMS) window.quillWebCMS.root.innerHTML = '';
  document.getElementById('webCMSModal').classList.remove('hidden');
  document.getElementById('webCMSModal').classList.add('flex');
}
function closeWebCMSModal() {
  document.getElementById('webCMSModal').classList.remove('flex');
  document.getElementById('webCMSModal').classList.add('hidden');
}

async function handleWebCMSFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('webCMSRowId').value;
  const file = document.getElementById('webCMSFotoFile').files[0];
  let fotoBase64 = null;
  if (file) fotoBase64 = await fileToBase64(file);

  const payload = {
    tipe: currentWebSubTab,
    judul: document.getElementById('webCMSJudul').value,
    tanggal: document.getElementById('webCMSTanggal').value,
    kategori: document.getElementById('webCMSKategori').value,
    isi: window.quillWebCMS ? window.quillWebCMS.root.innerHTML : '',
    fotoBase64: fotoBase64
  };

  const res = await apiPost('web.saveCMS', payload, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeWebCMSModal();
    loadDataSWR(true);
  }
}

async function deleteCMS(rowId) {
  if (confirm('Hapus konten ini?')) {
    const res = await apiPost('web.deleteCMS', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function renderGaleriTable() {
  const tbody = document.getElementById('galeriTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  appState.galeri.forEach((g, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3"><img src="${g.urlFoto}" class="w-16 h-10 object-cover rounded-lg shadow-sm" alt="Foto"></td>
        <td class="p-3 font-bold text-slate-800">${g.judul}</td>
        <td class="p-3"><span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-xs">${g.kategori}</span></td>
        <td class="p-3 text-center">
          <button onclick='deleteGaleri(${g.rowId})' class="p-2 bg-rose-50 text-rose-600 rounded-lg"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
}

function openGaleriModal() {
  document.getElementById('galeriForm').reset();
  document.getElementById('galeriRowId').value = '';
  document.getElementById('galeriModal').classList.remove('hidden');
  document.getElementById('galeriModal').classList.add('flex');
}
function closeGaleriModal() {
  document.getElementById('galeriModal').classList.remove('flex');
  document.getElementById('galeriModal').classList.add('hidden');
}

async function handleGaleriFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('galeriRowId').value;
  const file = document.getElementById('galeriFotoFile').files[0];
  let fotoBase64 = null;
  if (file) fotoBase64 = await fileToBase64(file);

  const payload = {
    judul: document.getElementById('galeriJudul').value,
    kategori: document.getElementById('galeriKategori').value,
    fotoBase64: fotoBase64
  };

  const res = await apiPost('web.saveGaleri', payload, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  alert(res.message);
  if (res.success) {
    closeGaleriModal();
    loadDataSWR(true);
  }
}

async function deleteGaleri(rowId) {
  if (confirm('Hapus foto dari galeri?')) {
    const res = await apiPost('web.deleteGaleri', {}, currentAdminToken, { rowId: rowId });
    alert(res.message);
    if (res.success) loadDataSWR(true);
  }
}

function renderStaffTable() {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!appState.teachers || appState.teachers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Belum ada data guru/staf di sistem.</td></tr>`;
    return;
  }

  appState.teachers.forEach((t, idx) => {
    const foto = t.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 text-slate-500 font-semibold">${idx + 1}</td>
        <td class="p-3"><img src="${foto}" class="w-10 h-10 rounded-full object-cover border shadow-sm" alt="Foto"></td>
        <td class="p-3 font-bold text-slate-800">${t.namaGuru}</td>
        <td class="p-3 text-xs text-slate-500 font-mono">${t.nip || '-'}</td>
        <td class="p-3 text-slate-700 font-medium">${t.jabatan || '-'}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openStaffModal(${t.rowId})" class="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs" title="Edit Profil Pendidik"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deleteStaff(${t.rowId})" class="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs" title="Hapus Profil Pendidik"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function populateStaffGuruDropdown() {
  const sel = document.getElementById('staffSelectGuru');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Pilih Guru dari Database --</option>';
  (appState.teachers || []).forEach(g => {
    sel.innerHTML += `<option value="${g.rowId}">${g.namaGuru} (NIP: ${g.nip || '-'})</option>`;
  });
}

function openStaffModal(rowId = null) {
  populateStaffGuruDropdown();
  document.getElementById('staffRowId').value = rowId || '';
  const form = document.querySelector('#modalStaffWeb form');
  if (form) form.reset();

  const preview = document.getElementById('staffFotoPreview');
  if (rowId) {
    const t = (appState.teachers || []).find(x => x.rowId == rowId);
    if (t) {
      document.getElementById('staffModalTitle').innerText = 'Edit Profil Pendidik';
      document.getElementById('staffInputNama').value = t.namaGuru || '';
      document.getElementById('staffInputNip').value = t.nip || '';
      document.getElementById('staffInputJabatan').value = t.jabatan || '';
      document.getElementById('staffInputFotoUrl').value = t.fotoUrl || '';
      if (preview) preview.src = t.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
      document.getElementById('staffSelectGuru').value = t.rowId;
    }
  } else {
    document.getElementById('staffModalTitle').innerText = 'Tambah Profil Pendidik';
    if (preview) preview.src = 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
  }

  const modal = document.getElementById('modalStaffWeb');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeStaffModal() {
  const modal = document.getElementById('modalStaffWeb');
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

function onStaffGuruSelectChange() {
  const sel = document.getElementById('staffSelectGuru');
  if (!sel) return;
  const val = sel.value;
  if (!val) return;
  const t = (appState.teachers || []).find(x => x.rowId == val);
  if (t) {
    document.getElementById('staffInputNama').value = t.namaGuru || '';
    document.getElementById('staffInputNip').value = t.nip || '';
    document.getElementById('staffInputJabatan').value = t.jabatan || 'Dewan Guru';
    document.getElementById('staffInputFotoUrl').value = t.fotoUrl || '';
    const preview = document.getElementById('staffFotoPreview');
    if (preview) preview.src = t.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
  }
}

function previewStaffLocalPhoto(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById('staffFotoPreview');
      if (preview) preview.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function handleStaffFormSubmit(e) {
  e.preventDefault();
  const rowId = document.getElementById('staffRowId').value;
  const file = document.getElementById('staffInputFotoFile')?.files[0];
  let fotoBase64 = null;
  if (file) {
    fotoBase64 = await fileToBase64(file);
  }

  const payload = {
    namaGuru: document.getElementById('staffInputNama').value.trim(),
    nip: document.getElementById('staffInputNip').value.trim(),
    jabatan: document.getElementById('staffInputJabatan').value.trim(),
    fotoUrl: document.getElementById('staffInputFotoUrl').value.trim(),
    fotoBase64: fotoBase64
  };

  const btn = document.getElementById('btnSaveStaff');
  if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; btn.disabled = true; }

  const res = await apiPost('web.saveStaff', payload, currentAdminToken, { rowId: rowId ? parseInt(rowId) : null });
  if (btn) { btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Profil Pendidik'; btn.disabled = false; }

  alert(res.message);
  if (res.success) {
    closeStaffModal();
    loadDataSWR(true);
  }
}

async function deleteStaff(rowId) {
  if (!confirm('Hapus guru ini dari daftar profil pendidik?')) return;
  const res = await apiPost('web.deleteStaff', {}, currentAdminToken, { rowId: parseInt(rowId) });
  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

// Charts & Search
function renderCharts() {
  const rombelCount = {};
  let countL = 0, countP = 0;
  appState.students.forEach(s => {
    const r = s.rombel || 'Lainnya';
    rombelCount[r] = (rombelCount[r] || 0) + 1;
    if (s.jenisKelamin === 'L') countL++; else if (s.jenisKelamin === 'P') countP++;
  });

  if (charts.rombel) charts.rombel.destroy();
  const elR = document.getElementById('chartRombel');
  if (elR && typeof Chart !== 'undefined') {
    charts.rombel = new Chart(elR, {
      type: 'bar',
      data: { labels: Object.keys(rombelCount), datasets: [{ data: Object.values(rombelCount), backgroundColor: '#6366f1', borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  if (charts.gender) charts.gender.destroy();
  const elG = document.getElementById('chartGender');
  if (elG && typeof Chart !== 'undefined') {
    charts.gender = new Chart(elG, {
      type: 'doughnut',
      data: { labels: ['Laki-laki', 'Perempuan'], datasets: [{ data: [countL, countP], backgroundColor: ['#3b82f6', '#ec4899'] }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

function setFilterType(type) {
  currentFilter = type;
  ['all', 'nama', 'nisn', 'usia', 'alamat'].forEach(t => {
    const btn = document.getElementById('filter-' + t);
    if (btn) {
      btn.className = (t === type)
        ? "px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-indigo-600 shadow transition"
        : "px-3.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-700/50 text-white hover:bg-white hover:text-indigo-600 transition";
    }
  });
  handleSearch();
}

function handleSearch() {
  const keyword = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const container = document.getElementById('searchResultContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!keyword) return;

  const filtered = appState.students.filter(s => {
    const computedAge = calculateAge(s.tanggalLahir);
    const finalAge = computedAge !== null ? computedAge : s.usiaTahun;
    const nama = (s.nama || '').toLowerCase();
    const nisn = (s.nisn || '').toString().toLowerCase();
    const usia = (finalAge || '').toString().toLowerCase();
    const alamat = (s.alamat || '').toLowerCase();
    if (currentFilter === 'nama') return nama.includes(keyword);
    if (currentFilter === 'nisn') return nisn.includes(keyword);
    if (currentFilter === 'usia') return usia.includes(keyword);
    if (currentFilter === 'alamat') return alamat.includes(keyword);
    return nama.includes(keyword) || nisn.includes(keyword) || usia.includes(keyword) || alamat.includes(keyword);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-6 text-slate-500 text-xs bg-white rounded-xl border">Data siswa tidak ditemukan.</div>`;
    return;
  }

  filtered.forEach(s => {
    const computedAge = calculateAge(s.tanggalLahir);
    const displayAge = computedAge !== null ? computedAge : (s.usiaTahun || '?');
    container.innerHTML += `
      <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between space-y-3">
        <div>
          <div class="flex justify-between items-start">
            <span class="bg-indigo-50 text-indigo-600 text-xs font-bold px-2.5 py-1 rounded-full">${s.rombel || 'Tanpa Kelas'}</span>
            <span class="text-xs text-slate-400 font-semibold">NISN: ${s.nisn}</span>
          </div>
          <h3 class="text-base font-bold text-slate-800 mt-2">${s.nama}</h3>
          <p class="text-xs text-slate-500">NIPD: ${s.nipd || '-'}</p>
        </div>
        <div class="text-xs space-y-1 pt-2 border-t border-slate-100 text-slate-600">
          <div><i class="fa-solid fa-cake-candles w-4 text-indigo-500"></i> ${s.tempatLahir}, ${s.tanggalLahir || '-'} (${displayAge} Th)</div>
          <div><i class="fa-solid fa-venus-mars w-4 text-indigo-500"></i> ${s.jenisKelamin === 'L' ? 'Laki-laki' : 'Perempuan'}</div>
          <div><i class="fa-solid fa-map-location-dot w-4 text-indigo-500"></i> ${s.alamat || '-'}</div>
        </div>
      </div>
    `;
  });
}

function renderPublicPortal() {
  const beritaContainer = document.getElementById('publicBeritaList');
  if (beritaContainer) {
    beritaContainer.innerHTML = '';
    const beritaItems = appState.webCMS.filter(c => c.tipe === 'berita').slice(0, 3);
    beritaItems.forEach(b => {
      beritaContainer.innerHTML += `
        <div class="bg-white rounded-2xl overflow-hidden border shadow-sm hover:shadow-md transition cursor-pointer" onclick='openPublicDetailModal(${JSON.stringify(b)})'>
          <img src="${b.fotoUrl || 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600'}" class="w-full h-44 object-cover" alt="Berita">
          <div class="p-5 space-y-2">
            <span class="text-[10px] bg-indigo-50 text-indigo-600 font-bold px-2 py-0.5 rounded-full">${b.kategori || 'Berita'}</span>
            <h4 class="font-bold text-slate-800 text-sm line-clamp-2">${b.judul}</h4>
            <p class="text-xs text-slate-400">${b.tanggal}</p>
          </div>
        </div>
      `;
    });
  }

  const galeriContainer = document.getElementById('publicGaleriSlider');
  if (galeriContainer) {
    galeriContainer.innerHTML = '';
    appState.galeri.forEach(g => {
      galeriContainer.innerHTML += `
        <div class="flex-shrink-0 w-64 rounded-2xl overflow-hidden shadow-sm border border-slate-100 bg-white">
          <img src="${g.urlFoto}" class="w-full h-40 object-cover" alt="${g.judul}">
          <div class="p-3">
            <h5 class="text-xs font-bold text-slate-800 line-clamp-1">${g.judul}</h5>
            <span class="text-[10px] text-indigo-600 font-medium">${g.kategori}</span>
          </div>
        </div>
      `;
    });
  }
}

function openPublicDetailModal(item) {
  document.getElementById('beritaModalTitle').innerText = item.judul;
  document.getElementById('beritaModalTanggal').innerText = item.tanggal;
  document.getElementById('beritaModalKategori').innerText = item.kategori || item.tipe;
  document.getElementById('beritaModalImg').src = item.fotoUrl || 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600';
  document.getElementById('beritaModalKonten').innerHTML = item.isi || '';
  document.getElementById('beritaDetailModal').classList.remove('hidden');
  document.getElementById('beritaDetailModal').classList.add('flex');
}

function closeBeritaModal() {
  document.getElementById('beritaDetailModal').classList.remove('flex');
  document.getElementById('beritaDetailModal').classList.add('hidden');
}

// ============================================
// 12. WHATSAPP GATEWAY & CRM FONNTE
// ============================================
async function loadWAStatusAdmin() {
  if (!currentAdminToken) return;
  const res = await apiPost('wa.cekStatus', {}, currentAdminToken);
  if (res && res.success) {
    const inputToken = document.getElementById('inputFonnteToken');
    if (inputToken && res.tokenTersamar) {
      inputToken.placeholder = res.tokenTersamar;
    }
    const badge = document.getElementById('waDeviceBadge');
    if (badge) {
      badge.className = res.waAktif 
        ? "bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full"
        : "bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full";
      badge.innerText = res.waAktif ? "Gateway Aktif" : "Gateway Nonaktif";
    }
  }

  // Populate rombel options di form blast
  const blastSelect = document.getElementById('blastWaKelasFilter');
  if (blastSelect && appState.classes) {
    blastSelect.innerHTML = '<option value="">Semua Rombel</option>';
    appState.classes.forEach(c => {
      blastSelect.innerHTML += `<option value="${c.namaKelas}">${c.namaKelas}</option>`;
    });
  }
}

function toggleTokenVisibility() {
  const input = document.getElementById('inputFonnteToken');
  const icon = document.getElementById('iconEyeToken');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

async function simpanTokenFonnte(e) {
  e.preventDefault();
  const tokenVal = document.getElementById('inputFonnteToken').value.trim();
  if (!tokenVal) {
    alert('Silakan masukkan token Fonnte!');
    return;
  }
  const btn = document.getElementById('btnSaveTokenFonnte');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  btn.disabled = true;

  const res = await apiPost('wa.updateToken', { tokenFonnte: tokenVal, waAktif: true }, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Token ke Server';
  btn.disabled = false;

  alert(res.message || 'Token berhasil disimpan di Script Properties server!');
  if (res.success) {
    document.getElementById('inputFonnteToken').value = '';
    loadWAStatusAdmin();
  }
}

async function cekStatusFonnte() {
  const btn = document.getElementById('btnCekFonnte');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa...';
  btn.disabled = true;

  const res = await apiPost('wa.cekStatus', {}, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-signal"></i> Cek Koneksi Fonnte';
  btn.disabled = false;

  if (res.success) {
    document.getElementById('waDeviceName').innerText = "Gateway Siap Terhubung";
    document.getElementById('waDeviceDesc').innerText = "Token tersimpan aman di Google Apps Script.";
    document.getElementById('waSenderNumber').innerText = "Terverifikasi Fonnte";
    document.getElementById('waQuotaInfo').innerText = res.tokenTersamar ? "Token Aktif (" + res.tokenTersamar + ")" : "Token Belum Diisi";
    document.getElementById('waDeviceBadge').className = "bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full";
    document.getElementById('waDeviceBadge').innerText = "Terhubung";
    alert('WhatsApp Gateway Siap!\nStatus: Terhubung dengan Server Apps Script');
  } else {
    alert('Pengecekan gagal: ' + (res.message || 'Periksa token Fonnte Anda'));
  }
}

async function handleTestSendWA(e) {
  e.preventDefault();
  const noHp = document.getElementById('testWaTarget').value.trim();
  const pesan = document.getElementById('testWaMessage').value.trim();
  const btn = document.getElementById('btnSubmitTestWA');

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
  btn.disabled = true;

  const res = await apiPost('wa.testSend', {
    noHp: noHp,
    nama: 'Pengguna Uji Coba',
    judul: 'Uji Coba SPILSA PRO',
    isi: pesan
  }, currentAdminToken);

  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Pesan Uji Coba';
  btn.disabled = false;

  if (res.success) {
    alert('Pesan berhasil diantrikan ke AntrianNotif!\n\nBackground Trigger (setiap 1 menit) akan mengirimkan pesan otomatis melalui Fonnte.');
    document.getElementById('testWaMessage').value = '';
  } else {
    alert('Gagal mengantrikan pesan: ' + res.message);
  }
}

async function handleBlastWAPengumuman(e) {
  e.preventDefault();
  const group = document.getElementById('blastWaTargetGroup').value;
  const filterKelas = document.getElementById('blastWaKelasFilter').value;
  const pesan = document.getElementById('blastWaContent').value.trim();
  const btn = document.getElementById('btnSubmitBlastWA');

  let targets = [];
  if (group === 'guru') {
    targets = appState.teachers.map(g => ({ nama: g.namaGuru, noHp: g.noHp || '' })).filter(t => t.noHp);
  } else {
    targets = appState.students
      .filter(s => !filterKelas || s.rombel === filterKelas)
      .map(s => ({ nama: 'Wali dari ' + s.nama, noHp: s.nomerHp || '' }))
      .filter(t => t.noHp);
  }

  if (targets.length === 0) {
    alert('Tidak ditemukan target dengan nomor HP / WhatsApp yang valid!');
    return;
  }

  if (!confirm(`Kirim pesan blast ini ke ${targets.length} nomor penerima?`)) return;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengantrikan...';
  btn.disabled = true;

  let successCount = 0;
  for (const t of targets) {
    const res = await apiPost('wa.testSend', {
      noHp: t.noHp,
      nama: t.nama,
      judul: 'Pengumuman Resmi Sekolah',
      isi: pesan
    }, currentAdminToken);
    if (res.success) successCount++;
  }

  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Antrikan Blast WhatsApp';
  btn.disabled = false;

  alert(`Berhasil mengantrikan ${successCount} dari ${targets.length} pesan pengumuman!\nPesan akan dikirim otomatis oleh background worker secara bertahap.`);
  document.getElementById('blastWaContent').value = '';
}

// ============================================
// 13. MODUL MIGRASI DATABASE SPREADSHEET
// ============================================
let lastMigrationScanResult = null;

async function handleDryRunMigrasi() {
  const sourceId = document.getElementById('inputSourceSpreadsheetId').value.trim();
  if (!sourceId) {
    alert('Silakan masukkan ID atau URL Spreadsheet Sumber!');
    return;
  }

  const btn = document.getElementById('btnDryRunMigrasi');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memindai...';
  btn.disabled = true;

  const res = await apiPost('migrasi.scan', { sourceIdOrUrl: sourceId }, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> 1. Pindai Database (Dry Run)';
  btn.disabled = false;

  if (!res.success) {
    alert('Pemindaian gagal: ' + res.message);
    return;
  }

  lastMigrationScanResult = res;
  const reportCard = document.getElementById('migrationReportCard');
  reportCard.classList.remove('hidden');

  const tbody = document.getElementById('migrationSummaryTableBody');
  tbody.innerHTML = '';

  const plans = res.plans || {};
  Object.keys(plans).forEach(sheetName => {
    const p = plans[sheetName];
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 font-bold">${sheetName}</td>
        <td class="p-3">${p.sourceRowCount || 0} baris</td>
        <td class="p-3 font-mono text-[11px] text-indigo-600">${p.keyHeader || '-'}</td>
        <td class="p-3 font-bold text-emerald-600">+${p.insertCount || 0}</td>
        <td class="p-3 font-bold text-amber-600">~${p.updateCount || 0}</td>
        <td class="p-3"><span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">Siap Dimigrasi</span></td>
      </tr>
    `;
  });

  const term = document.getElementById('migrationLogTerminal');
  term.innerHTML = `
    <div class="text-emerald-400 font-bold">[PEMINDAIAN DATABASE SELESAI] (${res.sourceTitle || sourceId})</div>
    <div class="text-slate-400">Total baris data yang ditemukan di database lama siap dipindahkan secara idempoten.</div>
    <div class="text-indigo-300">Silakan klik "2. Eksekusi Migrasi Idempoten" untuk menerapkan pemindahan data ke Spreadsheet SPILSA PRO.</div>
  `;

  document.getElementById('btnExecuteMigrasi').disabled = false;
}

async function handleExecuteMigrasi() {
  const sourceId = document.getElementById('inputSourceSpreadsheetId').value.trim();
  if (!confirm('Apakah Anda yakin ingin mengeksekusi migrasi data sekarang?\n\nOperasi ini aman dan idempoten (data lama tidak akan terhapus, data di spreadsheet baru akan di-upsert berdasarkan kunci unik).')) return;

  const btn = document.getElementById('btnExecuteMigrasi');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengeksekusi Migrasi...';
  btn.disabled = true;

  const res = await apiPost('migrasi.execute', { sourceIdOrUrl: sourceId }, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-bolt"></i> 2. Eksekusi Migrasi Idempoten';
  btn.disabled = false;

  if (res.success) {
    alert('Migrasi Database Berhasil!\n\nSeluruh data berhasil disinkronkan ke Spreadsheet SPILSA PRO.');
    const term = document.getElementById('migrationLogTerminal');
    term.innerHTML += `<div class="text-emerald-400 font-bold mt-2">[SUKSES] Seluruh data berhasil dimigrasi tanpa duplikasi (${res.totalUpserted || 0} baris diproses).</div>`;
    loadDataSWR(true);
  } else {
    alert('Migrasi gagal: ' + res.message);
  }
}

// ============================================
// 14. PEREKAMAN WAJAH SISWA & GURU (POIN 4)
// ============================================
function openRekamWajahModal(role = 'Siswa') {
  const roleInput = document.getElementById('rekamWajahTargetRole');
  if (roleInput) roleInput.value = role;

  const title = document.getElementById('rekamWajahTitle');
  if (title) title.innerHTML = `<i class="fa-solid fa-face-smile text-indigo-600"></i> Perekaman Data Wajah ${role}`;

  const label = document.getElementById('rekamWajahSelectLabel');
  if (label) label.innerText = `Pilih ${role} yang Akan Direkam:`;

  const select = document.getElementById('rekamWajahTargetSelect');
  if (select) {
    select.innerHTML = `<option value="">-- Pilih ${role} --</option>`;
    if (role === 'Siswa') {
      appState.students.forEach(s => {
        select.innerHTML += `<option value="${s.nisn}" data-name="${s.nama}">${s.nama} (${s.rombel} - NISN: ${s.nisn})</option>`;
      });
    } else {
      appState.teachers.forEach(g => {
        select.innerHTML += `<option value="${g.nip || g.namaGuru}" data-name="${g.namaGuru}">${g.namaGuru} (NIP: ${g.nip || '-'})</option>`;
      });
    }
  }

  const existingBox = document.getElementById('rekamStatusExisting');
  if (existingBox) existingBox.classList.add('hidden');

  const modal = document.getElementById('modalRekamWajah');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  startRekamWajahCamera();
}

function closeRekamWajahModal() {
  if (videoStreamRekam) {
    videoStreamRekam.getTracks().forEach(t => t.stop());
    videoStreamRekam = null;
  }
  const modal = document.getElementById('modalRekamWajah');
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

function startRekamWajahCamera() {
  const video = document.getElementById('rekamWajahVideo');
  const spinner = document.getElementById('cameraLoadingRekam');
  if (spinner) spinner.classList.remove('hidden');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then(stream => {
        if (spinner) spinner.classList.add('hidden');
        videoStreamRekam = stream;
        if (video) video.srcObject = stream;
      })
      .catch(err => {
        if (spinner) spinner.classList.add('hidden');
        alert('Tidak dapat mengaktifkan kamera perekaman wajah: ' + err.message);
      });
  }
}

function onSelectRekamWajahTarget() {
  const select = document.getElementById('rekamWajahTargetSelect');
  if (!select) return;
  const targetId = select.value;
  const role = document.getElementById('rekamWajahTargetRole')?.value || 'Siswa';
  const existingBox = document.getElementById('rekamStatusExisting');
  const existingThumb = document.getElementById('rekamExistingThumb');

  if (!targetId || !appState.rekamWajah || !existingBox) {
    if (existingBox) existingBox.classList.add('hidden');
    return;
  }

  const found = appState.rekamWajah.find(r => r.role === role && r.targetId.toString() === targetId.toString());
  if (found) {
    existingBox.classList.remove('hidden');
    if (existingThumb) existingThumb.src = found.fotoWajahUrl || '';
  } else {
    existingBox.classList.add('hidden');
  }
}

async function captureAndSaveRekamWajah() {
  const role = document.getElementById('rekamWajahTargetRole')?.value || 'Siswa';
  const select = document.getElementById('rekamWajahTargetSelect');
  if (!select) return;
  const targetId = select.value;
  const targetName = select.options[select.selectedIndex]?.getAttribute('data-name');

  if (!targetId || !targetName) {
    alert(`Silakan pilih ${role} terlebih dahulu!`);
    return;
  }

  const video = document.getElementById('rekamWajahVideo');
  const canvas = document.getElementById('rekamWajahCanvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 400, 300);
  const base64Data = canvas.toDataURL('image/jpeg', 0.7);

  // Generate visual descriptor vector yang kompatibel dengan scanner otomatis
  const descriptorArr = extractFaceVector_(ctx, 400, 300);
  const descriptorStr = descriptorArr.join(',');

  const btn = document.getElementById('btnCaptureRekamWajah');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan Rekaman...';
  btn.disabled = true;

  const res = await apiPost('face.register', {
    role,
    targetId,
    targetName,
    fotoWajah: base64Data,
    descriptor: descriptorStr
  });

  btn.innerHTML = '<i class="fa-solid fa-camera"></i> Ambil & Simpan Rekaman Wajah';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    closeRekamWajahModal();
    loadDataSWR(true);
  }
}

// ============================================
// 15. KOREKSI / EDIT PRESENSI (POIN 6)
// ============================================
function openEditPresensiModal(type, rowId) {
  document.getElementById('editPresensiType').value = type;
  document.getElementById('editPresensiRowId').value = rowId;

  let record = null;
  if (type === 'siswa') {
    record = appState.presensiSiswa.find(p => p.rowId == rowId);
    if (record) {
      document.getElementById('editPresensiModalTitle').innerText = 'Koreksi Presensi Siswa';
      document.getElementById('editPresensiNamaText').innerText = record.nama;
      document.getElementById('editPresensiIdText').innerText = `NISN: ${record.nisn} | Kelas: ${record.kelas}`;
    }
  } else {
    record = appState.presensiGuru.find(p => p.rowId == rowId);
    if (record) {
      document.getElementById('editPresensiModalTitle').innerText = 'Koreksi Presensi Guru';
      document.getElementById('editPresensiNamaText').innerText = record.namaGuru;
      document.getElementById('editPresensiIdText').innerText = `NIP: ${record.nip || '-'} | Jabatan: ${record.jabatan || '-'}`;
    }
  }

  if (!record) {
    alert('Data presensi tidak ditemukan.');
    return;
  }

  document.getElementById('editPresensiTanggal').value = record.tanggal || '';
  document.getElementById('editPresensiJam').value = record.jam || '';
  document.getElementById('editPresensiStatus').value = record.status || 'Hadir';
  document.getElementById('editPresensiKeterangan').value = record.keterangan || '';

  const modal = document.getElementById('modalEditPresensi');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeEditPresensiModal() {
  const modal = document.getElementById('modalEditPresensi');
  modal.classList.remove('flex');
  modal.classList.add('hidden');
}

async function handleEditPresensiSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('editPresensiType').value;
  const rowId = document.getElementById('editPresensiRowId').value;
  const tanggal = document.getElementById('editPresensiTanggal').value;
  const jam = document.getElementById('editPresensiJam').value;
  const status = document.getElementById('editPresensiStatus').value;
  const keterangan = document.getElementById('editPresensiKeterangan').value;

  const btn = document.getElementById('btnSubmitEditPresensi');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  btn.disabled = true;

  const action = (type === 'siswa') ? 'presensi.updateSiswa' : 'presensi.updateGuru';
  const res = await apiPost(action, { tanggal, jam, status, keterangan }, currentAdminToken, { rowId: parseInt(rowId) });

  btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan Koreksi';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    closeEditPresensiModal();
    loadDataSWR(true);
  }
}

// ============================================
// 16. PORTAL GURU & WALI KELAS (POIN 7)
// ============================================
function renderGuruDashboard() {
  if (!currentGuruSession) return;
  const g = currentGuruSession;
  const namaEl = document.getElementById('portalGuruNama');
  if (namaEl) namaEl.innerText = g.namaGuru || g.nama || 'Bapak/Ibu Guru';
  const nipEl = document.getElementById('portalGuruNip');
  if (nipEl) nipEl.innerText = g.nip || '-';
  const pendEl = document.getElementById('portalGuruPendidikan');
  if (pendEl) pendEl.innerText = g.pendidikan || '-';
  const jabEl = document.getElementById('portalGuruJabatan');
  if (jabEl) jabEl.innerText = g.jabatan || 'Dewan Guru';
  const avatarEl = document.getElementById('portalGuruAvatar');
  if (g.fotoUrl && avatarEl) avatarEl.src = g.fotoUrl;

  // Cek apakah guru ini menjadi Wali Kelas
  const myClass = appState.classes.find(c => c.waliKelas && (c.waliKelas === g.namaGuru || c.waliKelas === g.nama));
  const waliBadge = document.getElementById('portalGuruWaliBadge');
  const waliKet = document.getElementById('portalGuruWaliKet');
  const waliTabBtn = document.getElementById('guruTabBtn-walikelas');

  if (myClass) {
    if (waliBadge) waliBadge.classList.remove('hidden');
    if (waliKet) {
      waliKet.classList.remove('hidden');
      const waliName = document.getElementById('portalGuruWaliKelasNama');
      if (waliName) waliName.innerText = myClass.namaKelas;
    }
    if (waliTabBtn) waliTabBtn.classList.remove('hidden');
  } else {
    if (waliBadge) waliBadge.classList.add('hidden');
    if (waliKet) waliKet.classList.add('hidden');
    if (waliTabBtn) waliTabBtn.classList.add('hidden');
  }

  renderMyGuruPresensiHistory();
  renderMyGuruIzinHistory();
}

function switchGuruPortalTab(tab) {
  ['absen', 'kehadiran', 'izin', 'walikelas'].forEach(t => {
    const el = document.getElementById(`guruPortal-${t}`);
    if (el) el.classList.add('hidden');
    const btn = document.getElementById(`guruTabBtn-${t}`);
    if (btn) {
      if (t === tab) {
        btn.className = (t === 'walikelas') 
          ? "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-amber-600 text-white shadow transition flex items-center gap-2 shrink-0"
          : "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-teal-600 text-white shadow transition flex items-center gap-2 shrink-0";
      } else {
        btn.className = (t === 'walikelas')
          ? "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition flex items-center gap-2 shrink-0"
          : "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition flex items-center gap-2 shrink-0";
      }
    }
  });

  const activeEl = document.getElementById(`guruPortal-${tab}`);
  if (activeEl) activeEl.classList.remove('hidden');

  if (tab === 'absen') {
    startGuruSelfieCamera();
    startGuruGeoValidation();
  } else {
    stopGuruCameraAndGeo();
  }

  if (tab === 'kehadiran') renderMyGuruPresensiHistory();
  if (tab === 'izin') renderMyGuruIzinHistory();
  if (tab === 'walikelas') renderWaliKelasStudentsTable();
}

function startGuruSelfieCamera() {
  const video = document.getElementById('guruSelfieVideo');
  const spinner = document.getElementById('cameraLoadingSpinnerGuru');
  if (spinner) spinner.classList.remove('hidden');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then(stream => {
        if (spinner) spinner.classList.add('hidden');
        videoStreamSelfie = stream;
        if (video) video.srcObject = stream;
      })
      .catch(err => {
        if (spinner) spinner.classList.add('hidden');
        console.warn('Webcam Guru Error:', err);
      });
  }
}

function startGuruGeoValidation() {
  if (!navigator.geolocation) {
    const text = document.getElementById('guruGeoDistanceText');
    if (text) text.innerText = 'Perangkat Anda tidak mendukung geolokasi GPS.';
    return;
  }
  const schoolLat = parseFloat(appState.profile.latitude || '-6.892000');
  const schoolLng = parseFloat(appState.profile.longitude || '110.612000');
  const maxRadius = parseFloat(appState.profile.radiusPresensi || 150);

  guruGeoWatcher = navigator.geolocation.watchPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const dist = calculateHaversineDistance(lat, lng, schoolLat, schoolLng);
    guruCurrentDistance = Math.round(dist);

    const badge = document.getElementById('guruGeoStatusBadge');
    const text = document.getElementById('guruGeoDistanceText');
    const btn = document.getElementById('btnSubmitGuruSelfPresensi');
    const tip = document.getElementById('guruSelfPresensiTip');

    if (dist <= maxRadius) {
      if (badge) {
        badge.className = "bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-[10px] font-bold";
        badge.innerText = `Dalam Radius (${guruCurrentDistance} m)`;
      }
      if (text) text.innerText = `Posisi Anda berada di lingkungan sekolah (jarak ${guruCurrentDistance} m dari titik pusat, maks toleransi ${maxRadius} m).`;
      if (btn) btn.disabled = false;
      if (tip) tip.innerText = '✅ Lokasi valid. Silakan tekan tombol untuk presensi wajah.';
    } else {
      if (badge) {
        badge.className = "bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full text-[10px] font-bold";
        badge.innerText = `Di Luar Radius (${guruCurrentDistance} m)`;
      }
      if (text) text.innerText = `Jarak Anda ${guruCurrentDistance} m dari sekolah (maksimal ${maxRadius} m). Anda harus berada di area sekolah untuk presensi.`;
      if (btn) btn.disabled = true;
      if (tip) tip.innerText = '❌ Di luar area sekolah. Tombol dinonaktifkan.';
    }
  }, err => {
    const text = document.getElementById('guruGeoDistanceText');
    if (text) text.innerText = 'Gagal membaca titik GPS: Pastikan izin lokasi browser aktif.';
  }, { enableHighAccuracy: true, maximumAge: 10000 });
}

function stopGuruCameraAndGeo() {
  if (videoStreamSelfie) {
    videoStreamSelfie.getTracks().forEach(t => t.stop());
    videoStreamSelfie = null;
  }
  if (guruGeoWatcher) {
    navigator.geolocation.clearWatch(guruGeoWatcher);
    guruGeoWatcher = null;
  }
}

async function submitGuruSelfPresensi() {
  if (!currentGuruSession) return;
  const g = currentGuruSession;
  const video = document.getElementById('guruSelfieVideo');
  const canvas = document.getElementById('guruSelfieCanvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 400, 300);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

  const now = new Date();
  const tglStr = now.toISOString().split('T')[0];
  const jamStr = now.toTimeString().split(' ')[0].substring(0, 5);

  const batasTerlambat = appState.pengaturan?.toleransiTerlambat || '07:15';
  let status = 'Hadir';
  if (jamStr > batasTerlambat) {
    status = 'Terlambat';
  }

  const payload = {
    tanggal: tglStr,
    jam: jamStr,
    nip: g.nip || '-',
    namaGuru: g.namaGuru || g.nama,
    jabatan: g.jabatan || 'Dewan Guru',
    status: status,
    metode: 'Wajah Mandiri (GPS)',
    keterangan: `Presensi Mandiri Guru (Jarak ${guruCurrentDistance || 0}m, Status: ${status})`,
    fotoWajahBase64: dataUrl
  };

  playBeepSound();
  const btn = document.getElementById('btnSubmitGuruSelfPresensi');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  btn.disabled = true;

  const res = await apiPost('presensi.recordGuru', payload);
  btn.innerHTML = '<i class="fa-solid fa-camera"></i> Ambil Foto Wajah & Absen Sekarang';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
    switchGuruPortalTab('kehadiran');
  }
}

function renderMyGuruPresensiHistory() {
  if (!currentGuruSession) return;
  const g = currentGuruSession;
  const tbody = document.getElementById('myGuruPresensiTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const myLogs = appState.presensiGuru.filter(p => {
    return (g.nip && p.nip && p.nip.toString() === g.nip.toString()) || (p.namaGuru && p.namaGuru === (g.namaGuru || g.nama));
  });

  let hadir = 0, terlambat = 0, pulangCepat = 0, sakitIzin = 0, alpa = 0;
  myLogs.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Terlambat') terlambat++;
    else if (p.status === 'Pulang Cepat') pulangCepat++;
    else if (p.status === 'Sakit' || p.status === 'Izin') sakitIzin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = myLogs.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;

  if (document.getElementById('myGuruPersen')) document.getElementById('myGuruPersen').innerText = persen + '%';
  if (document.getElementById('myGuruHadir')) document.getElementById('myGuruHadir').innerText = hadir;
  if (document.getElementById('myGuruTerlambat')) document.getElementById('myGuruTerlambat').innerText = terlambat;
  if (document.getElementById('myGuruPulangCepat')) document.getElementById('myGuruPulangCepat').innerText = pulangCepat;
  if (document.getElementById('myGuruSakitIzin')) document.getElementById('myGuruSakitIzin').innerText = sakitIzin;
  if (document.getElementById('myGuruAlpa')) document.getElementById('myGuruAlpa').innerText = alpa;

  if (myLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400">Belum ada riwayat presensi guru tercatat.</td></tr>`;
    return;
  }

  myLogs.forEach(p => {
    let badge = 'bg-teal-50 text-teal-700 border-teal-200';
    if (p.status === 'Terlambat') badge = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Pulang Cepat') badge = 'bg-orange-50 text-orange-700 border-orange-200';
    else if (p.status === 'Sakit') badge = 'bg-blue-50 text-blue-700 border-blue-200';
    else if (p.status === 'Izin') badge = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    else if (p.status === 'Alpa') badge = 'bg-rose-50 text-rose-700 border-rose-200';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 font-semibold">${p.tanggal} <span class="text-slate-400 text-[10px]">(${p.jam || '-'})</span></td>
        <td class="p-3"><span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px]">${p.metode || 'Manual'}</span></td>
        <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge}">${p.status}</span></td>
        <td class="p-3 text-slate-500">${p.keterangan || '-'}</td>
      </tr>
    `;
  });
}

function renderMyGuruIzinHistory() {
  if (!currentGuruSession) return;
  const g = currentGuruSession;
  const tbody = document.getElementById('guruIzinHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const myIzin = (appState.pengajuanIzin || []).filter(i => {
    return i.role === 'Guru' && ((g.nip && i.targetId && i.targetId.toString() === g.nip.toString()) || i.nama === (g.namaGuru || g.nama));
  });

  if (myIzin.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-400">Belum ada pengajuan izin guru.</td></tr>`;
    return;
  }

  myIzin.forEach(i => {
    let badge = "bg-amber-100 text-amber-800";
    if (i.status === 'Disetujui') badge = "bg-emerald-100 text-emerald-800 font-bold";
    else if (i.status === 'Ditolak') badge = "bg-rose-100 text-rose-800 font-bold";

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5">${i.tanggalMulai} s.d ${i.tanggalSelesai}</td>
        <td class="p-2.5 font-semibold text-slate-700">${i.jenisIzin}</td>
        <td class="p-2.5 text-slate-500">${i.alasan}</td>
        <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] ${badge}">${i.status}</span></td>
      </tr>
    `;
  });
}

function renderWaliKelasStudentsTable() {
  if (!currentGuruSession) return;
  const g = currentGuruSession;
  const myClass = appState.classes.find(c => c.waliKelas && (c.waliKelas === g.namaGuru || c.waliKelas === g.nama));
  if (!myClass) return;

  const tglInput = document.getElementById('filterWaliKelasTanggal');
  if (tglInput && !tglInput.value) {
    tglInput.value = new Date().toISOString().split('T')[0];
  }
  const targetTgl = tglInput?.value || new Date().toISOString().split('T')[0];

  const bannerTitle = document.getElementById('waliKelasBannerTitle');
  if (bannerTitle) bannerTitle.innerText = `Rekapitulasi Kehadiran Siswa ${myClass.namaKelas}`;
  const tableTitle = document.getElementById('waliTableTitle');
  if (tableTitle) tableTitle.innerText = `Daftar Siswa ${myClass.namaKelas} & Status Tanggal ${targetTgl}`;

  const classStudents = appState.students.filter(s => s.rombel === myClass.namaKelas);
  const totalBadge = document.getElementById('waliTotalSiswaBadge');
  if (totalBadge) totalBadge.innerText = `${classStudents.length} Siswa`;

  const tbody = document.getElementById('waliKelasStudentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let hadir = 0, terlambat = 0, pulangCepat = 0, sakitIzin = 0, alpa = 0;

  classStudents.forEach((s, idx) => {
    const att = appState.presensiSiswa.find(p => p.nisn.toString() === s.nisn.toString() && p.tanggal === targetTgl);
    let status = att ? att.status : 'Belum Presensi';
    let jam = att ? (att.jam || '-') : '-';
    let ket = att ? (att.keterangan || '-') : '-';

    let badgeClass = "bg-slate-100 text-slate-500";
    if (status === 'Hadir') { badgeClass = "bg-emerald-100 text-emerald-800 font-bold"; hadir++; }
    else if (status === 'Terlambat') { badgeClass = "bg-amber-100 text-amber-800 font-bold"; terlambat++; }
    else if (status === 'Pulang Cepat') { badgeClass = "bg-orange-100 text-orange-800 font-bold"; pulangCepat++; }
    else if (status === 'Sakit' || status === 'Izin') { badgeClass = "bg-blue-100 text-blue-800 font-bold"; sakitIzin++; }
    else if (status === 'Alpa') { badgeClass = "bg-rose-100 text-rose-800 font-bold"; alpa++; }

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500 font-semibold">${idx + 1}</td>
        <td class="p-3 font-bold text-slate-800">${s.nama}</td>
        <td class="p-3 font-mono text-slate-600">${s.nisn}</td>
        <td class="p-3">${s.jenisKelamin || '-'}</td>
        <td class="p-3 text-center"><span class="px-2.5 py-0.5 rounded-full text-[11px] ${badgeClass}">${status}</span></td>
        <td class="p-3 font-mono">${jam}</td>
        <td class="p-3 text-slate-600">${ket}</td>
      </tr>
    `;
  });

  const total = classStudents.length;
  const persen = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;
  if (document.getElementById('waliKpiPersen')) document.getElementById('waliKpiPersen').innerText = persen + '%';
  if (document.getElementById('waliKpiHadir')) document.getElementById('waliKpiHadir').innerText = hadir;
  if (document.getElementById('waliKpiTerlambat')) document.getElementById('waliKpiTerlambat').innerText = terlambat;
  if (document.getElementById('waliKpiPulangCepat')) document.getElementById('waliKpiPulangCepat').innerText = pulangCepat;
  if (document.getElementById('waliKpiSakitIzin')) document.getElementById('waliKpiSakitIzin').innerText = sakitIzin;
  if (document.getElementById('waliKpiAlpa')) document.getElementById('waliKpiAlpa').innerText = alpa;
}

// ============================================
// 17. PENGAJUAN & APPROVAL IZIN (POIN 8)
// ============================================
async function handleStudentIzinSubmit(e) {
  e.preventDefault();
  if (!currentStudentSession) return;
  const s = currentStudentSession;

  const tglMulai = document.getElementById('studentIzinTglMulai').value;
  const tglSelesai = document.getElementById('studentIzinTglSelesai').value;
  const jenis = document.getElementById('studentIzinJenis').value;
  const alasan = document.getElementById('studentIzinAlasan').value;
  const file = document.getElementById('studentIzinBuktiFile').files[0];

  let buktiBase64 = null;
  if (file) buktiBase64 = await fileToBase64(file);

  const btn = document.getElementById('btnSubmitStudentIzin');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
  btn.disabled = true;

  const res = await apiPost('izin.ajukan', {
    role: 'Siswa',
    targetId: s.nisn,
    nama: s.nama,
    kelas: s.rombel || '',
    tanggalMulai: tglMulai,
    tanggalSelesai: tglSelesai,
    jenisIzin: jenis,
    alasan: alasan,
    buktiBase64: buktiBase64
  });

  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Formulir Izin';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    e.target.reset();
    loadDataSWR(true);
  }
}

async function handleGuruIzinSubmit(e) {
  e.preventDefault();
  if (!currentGuruSession) return;
  const g = currentGuruSession;

  const tglMulai = document.getElementById('guruIzinTglMulai').value;
  const tglSelesai = document.getElementById('guruIzinTglSelesai').value;
  const jenis = document.getElementById('guruIzinJenis').value;
  const alasan = document.getElementById('guruIzinAlasan').value;
  const file = document.getElementById('guruIzinBuktiFile').files[0];

  let buktiBase64 = null;
  if (file) buktiBase64 = await fileToBase64(file);

  const btn = document.getElementById('btnSubmitGuruIzin');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';
  btn.disabled = true;

  const res = await apiPost('izin.ajukan', {
    role: 'Guru',
    targetId: g.nip || g.namaGuru || g.nama,
    nama: g.namaGuru || g.nama,
    kelas: g.jabatan || 'Dewan Guru',
    tanggalMulai: tglMulai,
    tanggalSelesai: tglSelesai,
    jenisIzin: jenis,
    alasan: alasan,
    buktiBase64: buktiBase64
  });

  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Pengajuan Izin Guru';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    e.target.reset();
    loadDataSWR(true);
  }
}

function renderApprovalIzinTable() {
  const tbody = document.getElementById('approvalIzinTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterRole = document.getElementById('filterIzinRole')?.value || '';
  const filterStatus = document.getElementById('filterIzinStatus')?.value || '';

  const list = (appState.pengajuanIzin || []).filter(item => {
    if (filterRole && item.role !== filterRole) return false;
    if (filterStatus && item.status !== filterStatus) return false;
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">Belum ada pengajuan izin yang masuk.</td></tr>`;
    return;
  }

  list.forEach((item, idx) => {
    let statusBadge = "bg-amber-100 text-amber-800";
    if (item.status === 'Disetujui') statusBadge = "bg-emerald-100 text-emerald-800 font-bold";
    else if (item.status === 'Ditolak') statusBadge = "bg-rose-100 text-rose-800 font-bold";

    let aksiHtml = `<span class="text-xs text-slate-400">${item.status}</span>`;
    if (item.status === 'Menunggu') {
      aksiHtml = `
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="handleApproveIzin('${item.izinId}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1" title="Setujui Izin">
            <i class="fa-solid fa-check"></i> Setujui
          </button>
          <button onclick="handleRejectIzin('${item.izinId}')" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1" title="Tolak Izin">
            <i class="fa-solid fa-xmark"></i> Tolak
          </button>
        </div>
      `;
    }

    const lampiranHtml = item.buktiUrl 
      ? `<a href="${item.buktiUrl}" target="_blank" class="text-indigo-600 font-bold hover:underline flex items-center justify-center gap-1"><i class="fa-solid fa-paperclip"></i> Lihat</a>`
      : `<span class="text-slate-300">-</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3 text-slate-500 font-semibold">${idx + 1}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${item.role === 'Guru' ? 'bg-teal-100 text-teal-800' : 'bg-purple-100 text-purple-800'}">${item.role}</span></td>
        <td class="p-3 font-bold text-slate-800">${item.nama}<div class="text-[11px] text-slate-400 font-normal">${item.kelas || '-'}</div></td>
        <td class="p-3 font-semibold text-slate-700">${item.jenisIzin}</td>
        <td class="p-3 text-xs">${item.tanggalMulai} s.d ${item.tanggalSelesai}</td>
        <td class="p-3 text-xs text-slate-600">${item.alasan}</td>
        <td class="p-3 text-center">${lampiranHtml}</td>
        <td class="p-3 text-center"><span class="px-2.5 py-0.5 rounded-full text-[11px] ${statusBadge}">${item.status}</span></td>
        <td class="p-3 text-center">${aksiHtml}</td>
      </tr>
    `;
  });
}

async function handleApproveIzin(izinId) {
  if (!confirm('Setujui permohonan izin ini?\n\nSistem akan otomatis mencatat kehadiran Izin/Sakit pada Laporan Presensi sesuai rentang tanggal yang diajukan.')) return;
  const res = await apiPost('izin.approve', { izinId }, currentAdminToken);
  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

async function handleRejectIzin(izinId) {
  const alasan = prompt('Masukkan alasan penolakan izin:');
  if (alasan === null) return;
  const res = await apiPost('izin.reject', { izinId, alasanTolak: alasan || 'Tidak disetujui' }, currentAdminToken);
  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

// ============================================
// 18. PENGATURAN SISTEM & NAIK KELAS (POIN 9)
// ============================================
function loadPengaturanForm() {
  const s = appState.pengaturan || {};
  if (document.getElementById('settingTahunAjaran')) document.getElementById('settingTahunAjaran').value = s.tahunAjaran || '2025/2026';
  if (document.getElementById('settingSemester')) document.getElementById('settingSemester').value = s.semester || 'Genap';
  if (document.getElementById('settingJamMasuk')) document.getElementById('settingJamMasuk').value = s.jamMasuk || '07:00';
  if (document.getElementById('settingJamPulang')) document.getElementById('settingJamPulang').value = s.jamPulang || '13:00';
  if (document.getElementById('settingToleransiTerlambat')) document.getElementById('settingToleransiTerlambat').value = s.toleransiTerlambat || '07:15';
  if (document.getElementById('settingToleransiPulangCepat')) document.getElementById('settingToleransiPulangCepat').value = s.toleransiPulangCepat || '12:45';

  const savedTheme = localStorage.getItem('spilsa_theme_preset') || 'indigo';
  if (document.getElementById('settingThemePreset')) document.getElementById('settingThemePreset').value = savedTheme;
}

async function handleSavePengaturan(e) {
  e.preventDefault();
  const settings = {
    tahunAjaran: document.getElementById('settingTahunAjaran').value.trim(),
    semester: document.getElementById('settingSemester').value,
    jamMasuk: document.getElementById('settingJamMasuk').value,
    jamPulang: document.getElementById('settingJamPulang').value,
    toleransiTerlambat: document.getElementById('settingToleransiTerlambat').value,
    toleransiPulangCepat: document.getElementById('settingToleransiPulangCepat').value
  };

  const btn = document.getElementById('btnSavePengaturan');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  btn.disabled = true;

  const res = await apiPost('pengaturan.save', settings, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan Pengaturan Sistem';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

async function handleProsesNaikKelas() {
  const thn = document.getElementById('settingTahunAjaran')?.value || 'Tahun Ajaran Baru';
  const confirmation = confirm(`PERINGATAN NAIK KELAS MASSAL:\n\nApakah Anda yakin ingin memproses kenaikan kelas untuk ${thn}?\n\nAturan Otomatis:\n- Siswa Kelas 6 akan berstatus Lulus / Alumni\n- Siswa Kelas 5 naik ke Kelas 6\n- Siswa Kelas 4 naik ke Kelas 5\n- Siswa Kelas 3 naik ke Kelas 4\n- Siswa Kelas 2 naik ke Kelas 3\n- Siswa Kelas 1 naik ke Kelas 2\n\nLanjutkan proses ini?`);
  if (!confirmation) return;

  const btn = document.getElementById('btnProsesNaikKelas');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses Kenaikan Kelas...';
  btn.disabled = true;

  const res = await apiPost('pengaturan.naikKelas', {}, currentAdminToken);
  btn.innerHTML = '<i class="fa-solid fa-arrow-trend-up"></i> Eksekusi Kenaikan Kelas';
  btn.disabled = false;

  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

// ============================================
// 19. USER MANAGEMENT (POIN 12)
// ============================================
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterRole = (document.getElementById('filterUserRole')?.value || '').toLowerCase();
  const search = (document.getElementById('searchUserInput')?.value || '').toLowerCase().trim();

  const list = (appState.users || []).filter(u => {
    const uRole = (u.role || '').toLowerCase();
    if (filterRole && uRole !== filterRole) return false;
    const nama = (u.namaLengkap || u.nama || '').toLowerCase();
    const username = (u.username || '').toLowerCase();
    const identitas = (u.identitas || u.refId || '').toLowerCase();
    if (search && !nama.includes(search) && !username.includes(search) && !identitas.includes(search)) return false;
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">Belum ada akun pengguna di sistem.</td></tr>`;
    return;
  }

  list.forEach((u, idx) => {
    let roleBadge = "bg-indigo-100 text-indigo-800";
    const rLower = (u.role || '').toLowerCase();
    if (rLower === 'guru') roleBadge = "bg-teal-100 text-teal-800";
    else if (rLower === 'siswa') roleBadge = "bg-purple-100 text-purple-800";

    const lastLoginDisplay = (u.terakhirLogin && u.terakhirLogin !== '-') 
      ? u.terakhirLogin.replace('T', ' ').substring(0, 16) 
      : '-';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 text-slate-500 font-semibold">${idx + 1}</td>
        <td class="p-3 font-mono font-bold text-indigo-600">${u.username || '-'}</td>
        <td class="p-3 font-bold text-slate-800">${u.namaLengkap || u.nama || '-'}</td>
        <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${roleBadge}">${u.role}</span></td>
        <td class="p-3 font-mono text-xs text-slate-600">${u.identitas || u.refId || '-'}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${u.status === 'Aktif' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">${u.status || 'Aktif'}</span></td>
        <td class="p-3 text-xs text-slate-600 font-mono">${lastLoginDisplay}</td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openResetPasswordModal('${u.userId}')" class="p-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs" title="Reset Password Pengguna"><i class="fa-solid fa-key"></i></button>
            <button onclick="openUserModal('${u.userId}')" class="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs" title="Edit Akun"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="handleDeleteUser('${u.userId}')" class="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs" title="Hapus Akun"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function openUserModal(userId = null) {
  document.getElementById('userFormId').value = userId || '';
  if (userId) {
    const u = (appState.users || []).find(x => x.userId === userId);
    if (u) {
      document.getElementById('userModalTitle').innerText = 'Edit Akun Pengguna';
      document.getElementById('userFormRole').value = u.role;
      document.getElementById('userFormNama').value = u.namaLengkap || u.nama || '';
      document.getElementById('userFormUsername').value = u.username || '';
      document.getElementById('userFormPassword').value = '';
      document.getElementById('userPasswordHint').classList.remove('hidden');
      document.getElementById('userFormRefId').value = u.identitas || u.refId || '';
      document.getElementById('userFormStatus').value = u.status || 'Aktif';
    }
  } else {
    document.getElementById('userModalTitle').innerText = 'Tambah Akun Pengguna';
    document.getElementById('userFormRole').value = 'Admin';
    document.getElementById('userFormNama').value = '';
    document.getElementById('userFormUsername').value = '';
    document.getElementById('userFormPassword').value = '';
    document.getElementById('userPasswordHint').classList.add('hidden');
    document.getElementById('userFormRefId').value = '';
    document.getElementById('userFormStatus').value = 'Aktif';
  }
  document.getElementById('modalUserForm').classList.remove('hidden');
  document.getElementById('modalUserForm').classList.add('flex');
}

function closeUserModal() {
  document.getElementById('modalUserForm').classList.remove('flex');
  document.getElementById('modalUserForm').classList.add('hidden');
}

function onUserRoleChange() {
  const role = document.getElementById('userFormRole').value;
  const refInput = document.getElementById('userFormRefId');
  if (refInput) {
    if (role === 'Guru') refInput.placeholder = 'Masukkan NIP Guru...';
    else if (role === 'Siswa') refInput.placeholder = 'Masukkan NISN Siswa...';
    else refInput.placeholder = 'NIP/NISN (Opsional)...';
  }
}

async function handleUserFormSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('userFormId').value;
  const payload = {
    role: document.getElementById('userFormRole').value,
    nama: document.getElementById('userFormNama').value.trim(),
    username: document.getElementById('userFormUsername').value.trim(),
    password: document.getElementById('userFormPassword').value.trim(),
    refId: document.getElementById('userFormRefId').value.trim(),
    status: document.getElementById('userFormStatus').value
  };

  const res = await apiPost('user.save', payload, currentAdminToken, { userId: userId || null });
  alert(res.message);
  if (res.success) {
    closeUserModal();
    loadDataSWR(true);
  }
}

function openResetPasswordModal(userId) {
  const u = (appState.users || []).find(x => x.userId === userId);
  if (!u) return;
  document.getElementById('resetUserId').value = userId;
  document.getElementById('resetUserNama').innerText = u.namaLengkap || u.nama || u.username;
  document.getElementById('resetUserRole').innerText = `Role: ${u.role} | Username: ${u.username}`;
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('modalResetPasswordUser').classList.remove('hidden');
  document.getElementById('modalResetPasswordUser').classList.add('flex');
}

function closeResetPasswordModal() {
  document.getElementById('modalResetPasswordUser').classList.remove('flex');
  document.getElementById('modalResetPasswordUser').classList.add('hidden');
}

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('resetUserId').value;
  const newPassword = document.getElementById('resetNewPassword').value.trim();

  const res = await apiPost('user.resetPassword', { newPassword }, currentAdminToken, { userId });
  alert(res.message);
  if (res.success) {
    closeResetPasswordModal();
    loadDataSWR(true);
  }
}

async function handleDeleteUser(userId) {
  if (!confirm('Hapus akun pengguna ini? Pengguna tidak akan dapat login lagi.')) return;
  const res = await apiPost('user.delete', {}, currentAdminToken, { userId });
  alert(res.message);
  if (res.success) {
    loadDataSWR(true);
  }
}

