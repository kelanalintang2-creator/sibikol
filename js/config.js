/**
 * SPILSA PRO - config.js
 * Konfigurasi URL Google Apps Script Web App (REST API Endpoint)
 * 
 * PANDUAN:
 * Ganti URL di bawah dengan URL Deployment Web App Google Apps Script Anda
 * yang berakhiran '/exec'.
 */

const CONFIG = {
  // Masukkan URL Deployment Google Apps Script Anda di sini:
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwERhhukZKzNV66l8ON-hS7ktc_7MGxAa0s-YPkb6d9g92V5_Al0QUdoOyGvjiw9nm4/exec',

  // Nama & Metadata Aplikasi
  APP_NAME: 'SD NEGERI PILANGREJO 1',
  APP_SUBTITLE: 'Kec. Karangawen, Kab. Demak, Jawa Tengah',
  VERSION: '2.5.0-PRO',

  // Durasi kedaluwarsa cache lokal (SWR TTL) dalam milidetik (misal: 5 menit)
  CACHE_TTL_MS: 5 * 60 * 1000
};
