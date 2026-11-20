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
  presensiGuru: []
};

let currentStudentSession = null;
let currentAdminToken = null;
let currentFilter = 'all';
let currentWebSubTab = 'berita';

// Hardware & Scanner
let html5QrScannerSiswa = null;
let html5QrScannerGuru = null;
let videoStreamSiswa = null;
let videoStreamGuru = null;
let videoStreamSelfie = null;
let studentGeoWatcher = null;
let studentCurrentDistance = null;
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
});

function checkStoredSessions() {
  currentAdminToken = localStorage.getItem('spilsa_admin_token') || null;
  if (currentAdminToken) {
    const lockIcon = document.getElementById('adminIconLock');
    if (lockIcon) lockIcon.className = "fa-solid fa-lock-open text-emerald-300";
  }

  const savedStudent = localStorage.getItem('spilsa_student_session');
  if (savedStudent) {
    try {
      currentStudentSession = JSON.parse(savedStudent);
    } catch(e) {
      currentStudentSession = null;
    }
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
  populateDropdowns();
  renderCharts();
  handleSearch();

  if (currentStudentSession) {
    renderStudentPortalView();
  }
}

// ============================================
// 4. ROUTER TABS & SUBNAV
// ============================================
function switchTab(tab) {
  stopAllCameraStreams();
  const tabDash = document.getElementById('tab-dashboard');
  const tabAdm = document.getElementById('tab-admin');
  const tabSis = document.getElementById('tab-siswa');
  const navDash = document.getElementById('nav-dashboard');
  const navAdm = document.getElementById('nav-admin');
  const navSis = document.getElementById('nav-siswa');

  tabDash.classList.add('hidden');
  tabAdm.classList.add('hidden');
  if (tabSis) tabSis.classList.add('hidden');

  navDash.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white hover:bg-indigo-800 transition flex items-center gap-2";
  navAdm.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white hover:bg-indigo-800 transition flex items-center gap-2";
  if (navSis) navSis.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white hover:bg-indigo-800 transition flex items-center gap-2";

  if (tab === 'dashboard') {
    tabDash.classList.remove('hidden');
    navDash.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-indigo-700 shadow transition flex items-center gap-2";
    renderPublicPortal();
  } else if (tab === 'siswa') {
    if (tabSis) tabSis.classList.remove('hidden');
    if (navSis) navSis.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-indigo-700 shadow transition flex items-center gap-2";
    renderStudentPortalView();
  } else {
    if (!currentAdminToken) {
      openLoginModal();
      return;
    }
    tabAdm.classList.remove('hidden');
    navAdm.className = "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-indigo-700 shadow transition flex items-center gap-2";
  }
}

function switchAdminSub(sub) {
  stopAllCameraStreams();
  const allSubmenus = ['dashboard', 'presensi-siswa', 'presensi-guru', 'web', 'siswa', 'guru', 'kelas', 'prestasi', 'konseling', 'catatan', 'jenis', 'wa', 'migrasi', 'password'];
  
  allSubmenus.forEach(s => {
    const el = document.getElementById('admin-sub-' + s);
    if (el) el.classList.add('hidden');
    const btn = document.getElementById('subnav-' + s);
    if (btn) btn.className = "px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition flex items-center gap-2 shrink-0";
  });

  const activeEl = document.getElementById('admin-sub-' + sub);
  if (activeEl) activeEl.classList.remove('hidden');
  const activeBtn = document.getElementById('subnav-' + sub);
  if (activeBtn) activeBtn.className = "px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white transition flex items-center gap-2 shrink-0";

  if (sub === 'presensi-siswa') renderPresensiSiswaTable();
  else if (sub === 'presensi-guru') renderPresensiGuruTable();
  else if (sub === 'wa') loadWAStatusAdmin();
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
// 5. AUTENTIKASI ADMIN & SISWA
// ============================================
function handleAdminMenuClick() {
  if (currentAdminToken) {
    switchTab('admin');
  } else {
    openLoginModal();
  }
}

function openLoginModal() {
  document.getElementById('adminPasswordInput').value = '';
  document.getElementById('loginErrorMsg').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginModal').classList.add('flex');
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('flex');
  document.getElementById('loginModal').classList.add('hidden');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const pass = document.getElementById('adminPasswordInput').value;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.innerText = 'Memeriksa...';
  btn.disabled = true;

  const res = await apiPost('auth.adminLogin', { password: pass });
  btn.innerText = 'Masuk Administrator';
  btn.disabled = false;

  if (res.success && res.token) {
    currentAdminToken = res.token;
    localStorage.setItem('spilsa_admin_token', res.token);
    document.getElementById('adminIconLock').className = "fa-solid fa-lock-open text-emerald-300";
    closeLoginModal();
    switchTab('admin');
  } else {
    const errEl = document.getElementById('loginErrorMsg');
    errEl.innerText = res.message || 'Login gagal';
    errEl.classList.remove('hidden');
  }
}

function adminLogout() {
  currentAdminToken = null;
  localStorage.removeItem('spilsa_admin_token');
  document.getElementById('adminIconLock').className = "fa-solid fa-lock";
  switchTab('dashboard');
  alert('Sesi Administrator telah diakhiri.');
}

async function handlePasswordUpdate(e) {
  e.preventDefault();
  const oldPass = document.getElementById('oldPassword').value;
  const newPass = document.getElementById('newPassword').value;
  const confirmPass = document.getElementById('confirmPassword').value;
  const errorMsg = document.getElementById('passwordErrorMsg');

  if (newPass !== confirmPass) {
    errorMsg.innerText = 'Konfirmasi password baru tidak cocok!';
    errorMsg.classList.remove('hidden');
    return;
  }
  errorMsg.classList.add('hidden');

  const btn = document.getElementById('btnUpdatePassword');
  btn.innerText = 'Menyimpan...'; btn.disabled = true;

  const res = await apiPost('auth.updatePassword', { oldPassword: oldPass, newPassword: newPass }, currentAdminToken);
  btn.innerText = 'Simpan Password Baru'; btn.disabled = false;

  if (res.success && res.token) {
    currentAdminToken = res.token;
    localStorage.setItem('spilsa_admin_token', res.token);
    alert(res.message);
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } else {
    errorMsg.innerText = res.message || 'Gagal mengubah password';
    errorMsg.classList.remove('hidden');
  }
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
  ['absen', 'kehadiran', 'prestasi', 'pelanggaran'].forEach(t => {
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

  const payload = {
    tanggal: tglStr,
    jam: jamStr,
    nisn: currentStudentSession.nisn,
    nama: currentStudentSession.nama,
    kelas: currentStudentSession.rombel,
    status: 'Hadir',
    metode: 'Wajah Mandiri',
    keterangan: `Absen Mandiri GPS: ${studentCurrentDistance || 0}m`,
    fotoWajahBase64: dataUrl
  };

  const res = await apiPost('presensi.recordSiswa', payload);
  btn.innerHTML = '<i class="fa-solid fa-camera"></i> Ambil Foto Wajah & Absen Sekarang';
  btn.disabled = false;

  if (res.success) {
    playBeepSound();
    alert(`Presensi Wajah Berhasil!\n\nNama: ${currentStudentSession.nama}\nTanggal: ${tglStr}\nJam: ${jamStr}\nStatus: Hadir`);
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

  let hadir = 0, sakitIzin = 0, alpa = 0;
  myLogs.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Sakit' || p.status === 'Izin') sakitIzin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = myLogs.length;
  const persen = total > 0 ? Math.round((hadir / total) * 100) : 0;

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
    if (p.status === 'Sakit') badge = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Izin') badge = 'bg-blue-50 text-blue-700 border-blue-200';
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

function initPresensiSiswaWajahCamera() {
  const video = document.getElementById('videoPresensiSiswa');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(stream => {
        videoStreamSiswa = stream;
        video.srcObject = stream;
      })
      .catch(err => {
        alert('Tidak dapat mengakses webcam: ' + err.message);
      });
  }
}

async function capturePresensiSiswaWajah() {
  const nisn = document.getElementById('selectSiswaWajah').value;
  if (!nisn) { alert('Silakan pilih siswa terlebih dahulu.'); return; }
  const siswa = appState.students.find(s => s.nisn.toString() === nisn);
  if (!siswa) return;

  const video = document.getElementById('videoPresensiSiswa');
  const canvas = document.getElementById('canvasPresensiSiswa');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 400, 300);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

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
    metode: 'Scan Wajah',
    keterangan: 'Presensi Kamera Wajah Sekolah',
    fotoWajahBase64: dataUrl
  };

  playBeepSound();
  showPresensiSiswaAlert(`Menyimpan presensi wajah ${siswa.nama}...`, 'info');
  const res = await apiPost('presensi.recordSiswa', payload);
  if (res.success) {
    showPresensiSiswaAlert(`Presensi Wajah Berhasil: ${siswa.nama} Hadir!`, 'success');
    loadDataSWR(true);
  } else {
    showPresensiSiswaAlert('Gagal: ' + res.message, 'error');
  }
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

  let hadir = 0, sakit = 0, izin = 0, alpa = 0;
  filtered.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Sakit') sakit++;
    else if (p.status === 'Izin') izin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = filtered.length;
  const persen = total > 0 ? Math.round((hadir / total) * 100) : 0;

  if (document.getElementById('kpiSiswaPersen')) document.getElementById('kpiSiswaPersen').innerText = persen + '%';
  if (document.getElementById('kpiSiswaHadir')) document.getElementById('kpiSiswaHadir').innerText = hadir;
  if (document.getElementById('kpiSiswaSakit')) document.getElementById('kpiSiswaSakit').innerText = sakit;
  if (document.getElementById('kpiSiswaIzin')) document.getElementById('kpiSiswaIzin').innerText = izin;
  if (document.getElementById('kpiSiswaAlpa')) document.getElementById('kpiSiswaAlpa').innerText = alpa;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">Belum ada catatan presensi siswa sesuai filter.</td></tr>`;
    return;
  }

  filtered.forEach((p, idx) => {
    let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (p.status === 'Sakit') badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Izin') badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
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
          <button onclick="deletePresensiSiswa(${p.rowId})" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition"><i class="fa-solid fa-trash"></i></button>
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
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(stream => {
        videoStreamGuru = stream;
        video.srcObject = stream;
      })
      .catch(err => {
        alert('Tidak dapat mengakses webcam: ' + err.message);
      });
  }
}

async function capturePresensiGuruWajah() {
  const idKey = document.getElementById('selectGuruWajah').value;
  if (!idKey) { alert('Silakan pilih guru terlebih dahulu.'); return; }
  const guru = appState.teachers.find(t => (t.nip && t.nip.toString() === idKey) || t.namaGuru === idKey);
  if (!guru) return;

  const video = document.getElementById('videoPresensiGuru');
  const canvas = document.getElementById('canvasPresensiGuru');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 400, 300);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

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
    metode: 'Scan Wajah',
    keterangan: 'Presensi Kamera Wajah Guru',
    fotoWajahBase64: dataUrl
  };

  playBeepSound();
  showPresensiGuruAlert(`Menyimpan presensi guru ${guru.namaGuru}...`, 'info');
  const res = await apiPost('presensi.recordGuru', payload);
  if (res.success) {
    showPresensiGuruAlert(`Presensi Berhasil: ${guru.namaGuru} Hadir!`, 'success');
    loadDataSWR(true);
  } else {
    showPresensiGuruAlert('Gagal: ' + res.message, 'error');
  }
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

  let hadir = 0, sakit = 0, izin = 0, alpa = 0;
  filtered.forEach(p => {
    if (p.status === 'Hadir') hadir++;
    else if (p.status === 'Sakit') sakit++;
    else if (p.status === 'Izin') izin++;
    else if (p.status === 'Alpa') alpa++;
  });
  const total = filtered.length;
  const persen = total > 0 ? Math.round((hadir / total) * 100) : 0;

  if (document.getElementById('kpiGuruPersen')) document.getElementById('kpiGuruPersen').innerText = persen + '%';
  if (document.getElementById('kpiGuruHadir')) document.getElementById('kpiGuruHadir').innerText = hadir;
  if (document.getElementById('kpiGuruSakit')) document.getElementById('kpiGuruSakit').innerText = sakit;
  if (document.getElementById('kpiGuruIzin')) document.getElementById('kpiGuruIzin').innerText = izin;
  if (document.getElementById('kpiGuruAlpa')) document.getElementById('kpiGuruAlpa').innerText = alpa;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">Belum ada catatan presensi guru.</td></tr>`;
    return;
  }

  filtered.forEach((p, idx) => {
    let badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
    if (p.status === 'Sakit') badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    else if (p.status === 'Izin') badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
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
          <button onclick="deletePresensiGuru(${p.rowId})" class="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition"><i class="fa-solid fa-trash"></i></button>
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

function printRenderedCards() {
  const container = document.getElementById('idCardPreviewContainer');
  const printGrid = document.getElementById('printCardsGrid');
  printGrid.innerHTML = container.innerHTML;
  setTimeout(() => {
    window.print();
  }, 300);
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
// 12. EXCEL TEMPLATE GENERATORS (SheetJS)
// ============================================
function downloadStudentTemplate() {
  const headers = [
    ["Nama", "NISN", "NIPD", "Jenis Kelamin", "Tempat Lahir", "Tanggal Lahir", "NIK", "Agama", "Rombel", "Alamat", "Nomor HP", "Nama Ayah", "Nama Ibu", "Sekolah Asal", "Anak Ke", "Jumlah Saudara"]
  ];
  const sample = [
    ["Ahmad Fauzi", "0081234567", "1001", "L", "Demak", "2015-05-12", "3321010000000001", "Islam", "Kelas 1", "Ds. Pilangrejo RT 01 RW 01", "081234567890", "Budi Santoso", "Siti Aminah", "TK Pertiwi", "1", "2"]
  ];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Siswa");
  XLSX.writeFile(wb, "Template_Import_Siswa.xlsx");
}

function downloadTeacherTemplate() {
  const headers = [
    ["NIP", "Nama Guru", "Tempat Lahir", "Tanggal Lahir", "NIK", "Jabatan", "Nomor HP", "Email", "Alamat Rumah", "Jumlah Anak", "TMT CPNS", "TMT PNS", "NUPTK", "Pendidikan Terakhir"]
  ];
  const sample = [
    ["198501012010011001", "Budi Santoso, S.Pd.", "Demak", "1985-01-01", "3321010000000002", "Guru Kelas", "081234567891", "guru@sekolah.sch.id", "Demak", "2", "2010-01-01", "2011-01-01", "1234567890123456", "S1 PGSD"]
  ];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Guru");
  XLSX.writeFile(wb, "Template_Import_Guru.xlsx");
}

function downloadPrestasiTemplate() {
  const headers = [
    ["Tanggal", "Nama Siswa", "Kelas", "Jenis Prestasi", "Nama Lomba", "Juara", "Tingkat", "Penyelenggara"]
  ];
  const sample = [
    ["2026-02-15", "Ahmad Fauzi", "Kelas 4", "Akademik", "Olimpiade Sains Matematika", "Juara 1", "Kabupaten/Kota", "Dinas Pendidikan"]
  ];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Prestasi");
  XLSX.writeFile(wb, "Template_Import_Prestasi.xlsx");
}

function downloadCatatanTemplate() {
  const headers = [
    ["Tanggal", "Nama Siswa", "Kelas", "NIPD", "NISN", "Kategori Pelanggaran", "Jenis Pelanggaran", "Poin Pelanggaran", "Tindak Lanjut", "Guru Pendamping", "Keterangan"]
  ];
  const sample = [
    ["2026-02-20", "Ahmad Fauzi", "Kelas 4", "1001", "0081234567", "Ringan", "Terlambat Masuk Sekolah", "5", "Teguran lisan & pembinaan", "Budi Santoso, S.Pd.", "Selesai"]
  ];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Catatan Pelanggaran");
  XLSX.writeFile(wb, "Template_Import_Pelanggaran.xlsx");
}

function downloadKonselingTemplate() {
  const headers = [
    ["Tanggal", "Nama Siswa", "Kelas", "NIPD", "NISN", "Permasalahan", "Jenis Layanan", "Rencana Tindak Lanjut", "Keterangan", "Guru Pendamping"]
  ];
  const sample = [
    ["2026-02-22", "Ahmad Fauzi", "Kelas 4", "1001", "0081234567", "Kesulitan fokus saat belajar", "Belajar", "Konseling individual", "Proses", "Budi Santoso, S.Pd."]
  ];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Konseling");
  XLSX.writeFile(wb, "Template_Import_Konseling.xlsx");
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
  appState.teachers.forEach((t, idx) => {
    const foto = t.fotoUrl || 'https://cdn-icons-png.flaticon.com/512/3135/3135768.png';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50">
        <td class="p-3">${idx + 1}</td>
        <td class="p-3"><img src="${foto}" class="w-10 h-10 rounded-full object-cover border" alt="Foto"></td>
        <td class="p-3 font-bold">${t.namaGuru}</td>
        <td class="p-3 text-xs text-slate-500">${t.nip || '-'}</td>
        <td class="p-3">${t.jabatan || '-'}</td>
        <td class="p-3 text-center">
          <span class="text-xs text-emerald-600 font-semibold"><i class="fa-solid fa-check"></i> Terhubung Data Guru</span>
        </td>
      </tr>
    `;
  });
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

