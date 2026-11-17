'use strict';
/* =====================================================================
   SISTEM PEMESANAN DAN PENGIRIMAN AIR GALON BERBASIS WEB
   ---------------------------------------------------------------------
   Struktur file:
   1. KONSTANTA
   2. LAPISAN DATA  (api() ke PHP + MySQL)
   3. HELPER
   4. AUTENTIKASI
   5. UI DASAR (menu, modal, toast)
   6. HALAMAN-HALAMAN
   7. AKSI (klik tombol)
   8. INISIALISASI
   ===================================================================== */

/* ---------- 1. KONSTANTA ---------- */
const STATUS = {
  MENUNGGU: 'MENUNGGU DI PROSES',   // rule 6
  KIRIM:    'DALAM PENGIRIMAN',     // rule 7
  SELESAI:  'SELESAI',              // rule 8
  BATAL:    'DIBATALKAN'            // rule 9
};
const BADGE = {
  [STATUS.MENUNGGU]: 'b-wait',
  [STATUS.KIRIM]:    'b-ship',
  [STATUS.SELESAI]:  'b-done',
  [STATUS.BATAL]:    'b-cancel'
};
const ROLE_LABEL = { admin: 'Admin', kurir: 'Kurir', pelanggan: 'Pelanggan' };

/* ---------- 2. LAPISAN DATA ----------
   Data diambil dari database MySQL lewat api/api.php (PHP).
   Hasilnya disimpan sementara di memori (DB) agar tampilan cepat dirender;
   setiap ada perubahan, data dimuat ulang dari server. */
const API_URL = 'api/api.php';
let currentUser = null;
const DB = { users: [], galon: [], pesanan: [] };

async function api(aksi, data) {
  const opsi = { credentials: 'same-origin' };
  if (data !== undefined) {
    opsi.method = 'POST';
    opsi.headers = { 'Content-Type': 'application/json' };
    opsi.body = JSON.stringify(data);
  }
  let res;
  try { res = await fetch(`${API_URL}?aksi=${aksi}`, opsi); }
  catch (e) { throw new Error('Tidak dapat terhubung ke server. Pastikan Apache dan MySQL di XAMPP sudah menyala.'); }
  let json;
  try { json = await res.json(); }
  catch (e) { throw new Error('Respons server tidak valid. Buka web lewat http://localhost/galon-web/ (bukan Live Server) dan periksa api/config.php.'); }
  if (!res.ok || json.error) {
    if (res.status === 401 && aksi !== 'login') { currentUser = null; showView(); }
    throw new Error(json.error || 'Terjadi kesalahan.');
  }
  return json;
}

async function muatData() {
  const d = await api('data');
  currentUser = d.user; DB.users = d.users; DB.galon = d.galon; DB.pesanan = d.pesanan;
}
async function perbarui() { await muatData(); render(); }   // muat ulang data lalu gambar ulang

/* ---------- 3. HELPER ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const tgl = iso => iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const kode = id => 'ORD-' + String(id).padStart(4, '0');
const tglLokal = iso => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const badge = s => `<span class="badge ${BADGE[s]}">${s}</span>`;
const namaUser = id => (DB.users.find(u => u.id === id) || {}).nama || '-';

/* ---------- 4. AUTENTIKASI ---------- */
function me() { return currentUser; }
async function login(username, password) {
  const r = await api('login', { username, password });
  currentUser = r.user;
  await muatData();
}
async function logout() {
  try { await api('logout', {}); } catch (e) { /* abaikan */ }
  currentUser = null; page = 'dashboard'; showView();
}

/* ---------- 5. UI DASAR ---------- */
let page = 'dashboard';
const filters = { riwayat: '', pengiriman: '', laporan_dari: '', laporan_sampai: '' };
let modalSubmit = null;

/* Matriks hak akses (sesuai tabel MATRIKS di dokumen tugas) */
const MENUS = [
  { id: 'dashboard',  label: 'Dashboard',        roles: ['admin', 'kurir', 'pelanggan'], render: pgDashboard },
  { id: 'pelanggan',  label: 'Data Pelanggan',   roles: ['admin'],                       render: u => pgUsers(u, 'pelanggan') },
  { id: 'galon',      label: 'Data Galon',       roles: ['admin'],                       render: pgGalon },
  { id: 'pemesanan',  label: 'Pemesanan Galon',  roles: ['admin', 'pelanggan'],          render: pgPemesanan },
  { id: 'pengiriman', label: 'Data Pengiriman',  roles: ['admin', 'kurir'],              render: pgPengiriman },
  { id: 'riwayat',    label: 'Riwayat Pesanan',  roles: ['admin', 'pelanggan'],          render: pgRiwayat },
  { id: 'laporan',    label: 'Laporan',          roles: ['admin'],                       render: pgLaporan },
  { id: 'user',       label: 'Kelola User',      roles: ['admin'],                       render: u => pgUsers(u, 'semua') }
];

function showView() {
  const u = me();
  $('#loginView').hidden = !!u;
  $('#appView').hidden = !u;
  if (u) {
    $('#userName').textContent = u.nama;
    $('#userRole').textContent = ROLE_LABEL[u.role];
    render();
  }
}

function render() {
  const u = me();
  const allowed = MENUS.filter(m => m.roles.includes(u.role));
  const menu = allowed.find(m => m.id === page) || allowed[0];   // rule 1-3: batasi akses
  page = menu.id;
  $('#nav').innerHTML = allowed.map(m =>
    `<button data-nav="${m.id}" class="${m.id === page ? 'active' : ''}">${m.label}</button>`).join('');
  $('#pageTitle').textContent = menu.label;
  $('#content').innerHTML = menu.render(u);
  window.scrollTo(0, 0);
}

function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (type === 'err' ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

function openModal(title, html, onSubmit) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  modalSubmit = onSubmit || null;
  $('#modal').hidden = false;
  const first = $('#modalBody input, #modalBody select, #modalBody textarea');
  if (first) first.focus();
}
function closeModal() { $('#modal').hidden = true; modalSubmit = null; }

/* ---------- 6. HALAMAN ---------- */
function statCard(label, value) { return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`; }

function tabelPesanan(list, kolom, aksiFn) {
  if (!list.length) return '<p class="empty">Belum ada pesanan.</p>';
  const head = { kode: 'Kode', tgl: 'Tanggal', pel: 'Pelanggan', item: 'Pesanan', total: 'Total', status: 'Status', kurir: 'Kurir', ver: 'Verifikasi', aksi: 'Aksi' };
  const cell = (o, k) => ({
    kode: `<strong>${kode(o.id)}</strong>`,
    tgl: tgl(o.tanggal),
    pel: esc(o.pelanggan_nama),
    item: o.items.map(i => `${i.qty}x ${esc(i.nama)}`).join('<br>'),
    total: rupiah(o.total),
    status: badge(o.status),
    kurir: o.kurir_id ? esc(namaUser(o.kurir_id)) : '-',
    ver: o.terverifikasi ? 'Sudah' : 'Belum',
    aksi: `<div class="act">${aksiFn(o)}</div>`
  })[k];
  return `<div class="table-wrap"><table>
    <thead><tr>${kolom.map(k => `<th>${head[k]}</th>`).join('')}</tr></thead>
    <tbody>${list.map(o => `<tr>${kolom.map(k => `<td>${cell(o, k)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function opsiStatus(sel) {
  return `<select data-filter="${sel.key}" aria-label="Filter status">
    <option value="">Semua status</option>
    ${Object.values(STATUS).map(s => `<option ${filters[sel.key] === s ? 'selected' : ''}>${s}</option>`).join('')}
  </select>`;
}

/* ----- Dashboard ----- */
function pgDashboard(u) {
  const P = DB.pesanan;
  const urut = l => [...l].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  const hitung = (l, s) => l.filter(o => o.status === s).length;

  if (u.role === 'admin') {
    const stokRendah = DB.galon.filter(g => g.stok <= 5);
    return `
      <div class="stats">
        ${statCard('Total pesanan', P.length)}
        ${statCard('Menunggu diproses', hitung(P, STATUS.MENUNGGU))}
        ${statCard('Dalam pengiriman', hitung(P, STATUS.KIRIM))}
        ${statCard('Selesai', hitung(P, STATUS.SELESAI))}
        ${statCard('Pelanggan', DB.users.filter(x => x.role === 'pelanggan').length)}
      </div>
      <div class="panel"><div class="panel-head"><h2>Perlu perhatian</h2></div>
        ${P.filter(o => !o.terverifikasi && o.status === STATUS.MENUNGGU).length
          ? `<p>Ada <strong>${P.filter(o => !o.terverifikasi && o.status === STATUS.MENUNGGU).length}</strong> pesanan baru yang belum diverifikasi. Buka menu Riwayat Pesanan.</p>` : '<p>Semua pesanan baru sudah diverifikasi.</p>'}
        ${stokRendah.length ? `<p style="margin-top:8px">Stok menipis: ${stokRendah.map(g => `<strong>${esc(g.nama)}</strong> (${g.stok})`).join(', ')}</p>` : ''}
      </div>
      <div class="panel"><div class="panel-head"><h2>Pesanan terbaru</h2></div>
        ${tabelPesanan(urut(P).slice(0, 5), ['kode', 'pel', 'item', 'total', 'status'], () => '')}
      </div>`;
  }

  if (u.role === 'kurir') {
    const milik = P.filter(o => o.terverifikasi && (o.kurir_id === u.id || !o.kurir_id) && o.status === STATUS.MENUNGGU);
    const jalan = P.filter(o => o.kurir_id === u.id && o.status === STATUS.KIRIM);
    const selesai = P.filter(o => o.kurir_id === u.id && o.status === STATUS.SELESAI);
    return `
      <div class="stats">
        ${statCard('Siap diambil', milik.length)}
        ${statCard('Sedang saya antar', jalan.length)}
        ${statCard('Selesai saya antar', selesai.length)}
      </div>
      <div class="panel"><div class="panel-head"><h2>Pengiriman yang sedang berjalan</h2>
        <button class="btn btn-primary" data-nav="pengiriman">Buka Data Pengiriman</button></div>
        ${tabelPesanan(jalan, ['kode', 'pel', 'item', 'status'], () => '')}
      </div>`;
  }

  const saya = P.filter(o => o.pelanggan_id === u.id);
  return `
    <div class="stats">
      ${statCard('Pesanan aktif', saya.filter(o => [STATUS.MENUNGGU, STATUS.KIRIM].includes(o.status)).length)}
      ${statCard('Pesanan selesai', hitung(saya, STATUS.SELESAI))}
      ${statCard('Total belanja', rupiah(saya.filter(o => o.status === STATUS.SELESAI).reduce((s, o) => s + o.total, 0)))}
    </div>
    <div class="panel"><div class="panel-head"><h2>Pesanan terbaru saya</h2>
      <button class="btn btn-primary" data-nav="pemesanan">Pesan galon</button></div>
      ${tabelPesanan(urut(saya).slice(0, 5), ['kode', 'tgl', 'item', 'total', 'status'], () => '')}
    </div>`;
}

/* ----- Data Pelanggan (admin) & Kelola User (admin) ----- */
function pgUsers(u, scope) {
  const list = DB.users.filter(x => scope === 'semua' || x.role === 'pelanggan');
  const judul = scope === 'semua' ? 'Daftar pengguna' : 'Daftar pelanggan';
  const rows = list.map(x => `<tr>
      <td>${esc(x.nama)}</td><td>${esc(x.username)}</td>
      ${scope === 'semua' ? `<td>${ROLE_LABEL[x.role]}</td>` : ''}
      <td>${esc(x.telp)}</td><td>${esc(x.alamat)}</td>
      <td><div class="act">
        <button class="btn btn-sm" data-act="user-edit" data-scope="${scope}" data-id="${x.id}">Ubah</button>
        <button class="btn btn-sm btn-danger" data-act="user-del" data-id="${x.id}">Hapus</button>
      </div></td></tr>`).join('');
  return `<div class="panel">
    <div class="panel-head"><h2>${judul}</h2>
      <button class="btn btn-primary" data-act="user-add" data-scope="${scope}">Tambah ${scope === 'semua' ? 'user' : 'pelanggan'}</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nama</th><th>Username</th>${scope === 'semua' ? '<th>Role</th>' : ''}<th>Telepon</th><th>Alamat</th><th>Aksi</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">Belum ada data.</td></tr>`}</tbody>
    </table></div></div>`;
}

function formUser(scope, x) {
  const edit = !!x;
  x = x || { nama: '', username: '', role: 'pelanggan', telp: '', alamat: '' };
  return `<form>
    <label>Nama lengkap<input name="nama" required value="${esc(x.nama)}"></label>
    <div class="form-row">
      <label>Username<input name="username" required value="${esc(x.username)}"></label>
      <label>Password<input name="password" type="password" ${edit ? '' : 'required'} placeholder="${edit ? 'Kosongkan jika tidak diubah' : ''}"></label>
    </div>
    ${scope === 'semua' ? `<label>Role<select name="role">
      ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${x.role === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select></label>` : ''}
    <label>No. telepon<input name="telp" value="${esc(x.telp)}"></label>
    <label>Alamat<textarea name="alamat">${esc(x.alamat)}</textarea></label>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="modal-close">Batal</button>
    <button class="btn btn-primary">Simpan</button></div>
  </form>`;
}

/* ----- Data Galon (admin) ----- */
function pgGalon() {
  const rows = DB.galon.map(g => `<tr>
    <td>${esc(g.nama)}</td><td>${rupiah(g.harga)}</td>
    <td>${g.stok} ${g.stok <= 0 ? '<span class="badge b-low">Habis</span>' : g.stok <= 5 ? '<span class="badge b-wait">Menipis</span>' : ''}</td>
    <td><div class="act">
      <button class="btn btn-sm" data-act="galon-edit" data-id="${g.id}">Ubah</button>
      <button class="btn btn-sm btn-danger" data-act="galon-del" data-id="${g.id}">Hapus</button>
    </div></td></tr>`).join('');
  return `<div class="panel">
    <div class="panel-head"><h2>Daftar galon dan stok</h2>
      <button class="btn btn-primary" data-act="galon-add">Tambah galon</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nama produk</th><th>Harga</th><th>Stok</th><th>Aksi</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="empty">Belum ada data galon.</td></tr>'}</tbody>
    </table></div></div>`;
}

function formGalon(g) {
  g = g || { nama: '', harga: '', stok: '' };
  return `<form>
    <label>Nama produk<input name="nama" required value="${esc(g.nama)}"></label>
    <div class="form-row">
      <label>Harga (Rp)<input name="harga" type="number" min="0" required value="${esc(g.harga)}"></label>
      <label>Stok<input name="stok" type="number" min="0" required value="${esc(g.stok)}"></label>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="modal-close">Batal</button>
    <button class="btn btn-primary">Simpan</button></div>
  </form>`;
}

/* ----- Pemesanan Galon (admin, pelanggan) ----- */
function pgPemesanan(u) {
  const galon = DB.galon;
  const pelanggan = DB.users.filter(x => x.role === 'pelanggan');
  const daftar = galon.map(g => `
    <div class="galon-item ${g.stok <= 0 ? 'habis' : ''}">
      <div><h3>${esc(g.nama)}</h3><small>${rupiah(g.harga)} per galon, ${g.stok > 0 ? 'stok ' + g.stok : 'stok habis'}</small></div>
      ${g.stok > 0
        ? `<input class="qty" type="number" min="0" max="${g.stok}" value="0" data-qty="${g.id}" aria-label="Jumlah ${esc(g.nama)}">`
        : '<span class="badge b-low">Habis</span>'}
    </div>`).join('') || '<p class="empty">Belum ada galon yang dijual.</p>';

  return `<form id="orderForm" class="order-layout">
    <div><div class="galon-list">${daftar}</div></div>
    <aside class="summary">
      <h2>Data pengiriman</h2>
      ${u.role === 'admin' ? `<label>Pelanggan<select id="selPel" name="pelanggan_id" required>
        <option value="">Pilih pelanggan</option>
        ${pelanggan.map(p => `<option value="${p.id}" data-alamat="${esc(p.alamat)}">${esc(p.nama)}</option>`).join('')}
      </select></label>` : `<p style="margin-bottom:14px"><strong>${esc(u.nama)}</strong><br><small>${esc(u.telp)}</small></p>`}
      <label>Alamat pengiriman<textarea name="alamat" id="alamatOrder" required>${u.role === 'pelanggan' ? esc(u.alamat) : ''}</textarea></label>
      <label>Catatan (opsional)<input name="catatan" placeholder="Contoh: titip di satpam"></label>
      <div class="total-line"><span>Total</span><span id="totalOrder">Rp 0</span></div>
      <button class="btn btn-primary btn-block">Buat pesanan</button>
    </aside>
  </form>`;
}

function hitungTotalForm() {
  let total = 0;
  const galon = DB.galon;
  $$('[data-qty]').forEach(inp => {
    const g = galon.find(x => x.id === Number(inp.dataset.qty));
    total += g ? g.harga * (parseInt(inp.value) || 0) : 0;
  });
  $('#totalOrder').textContent = rupiah(total);
}

async function buatPesanan() {
  const form = $('#orderForm');
  const items = [];
  for (const inp of $$('[data-qty]', form)) {
    const qty = parseInt(inp.value) || 0;
    if (qty <= 0) continue;
    const g = DB.galon.find(x => x.id === Number(inp.dataset.qty));
    if (g.stok <= 0)  return toast(`Stok "${g.nama}" = 0. Pesanan tidak dapat diproses.`, 'err');      // rule 5
    if (qty > g.stok) return toast(`Stok "${g.nama}" hanya ${g.stok}. Kurangi jumlah pesanan.`, 'err');
    items.push({ galon_id: g.id, qty });                                                                 // rule 4
  }
  if (!items.length) return toast('Pilih minimal satu galon (jumlah lebih dari 0).', 'err');

  const fd = new FormData(form);
  if (me().role === 'admin' && !fd.get('pelanggan_id')) return toast('Pilih pelanggan terlebih dahulu.', 'err');

  // server yang memeriksa ulang stok, menghitung total, dan mengurangi stok
  await api('pesanan_buat', {
    pelanggan_id: Number(fd.get('pelanggan_id')) || null,
    alamat: fd.get('alamat').trim(),
    catatan: fd.get('catatan').trim(),
    items
  });
  toast('Pesanan berhasil dibuat. Status: ' + STATUS.MENUNGGU);   // rule 6
  page = 'riwayat';
  await perbarui();
}

/* ----- Riwayat Pesanan (admin, pelanggan) ----- */
function pgRiwayat(u) {
  let list = DB.pesanan.filter(o => u.role === 'admin' || o.pelanggan_id === u.id);
  if (filters.riwayat) list = list.filter(o => o.status === filters.riwayat);
  list.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  const kolom = u.role === 'admin'
    ? ['kode', 'tgl', 'pel', 'item', 'total', 'status', 'ver', 'aksi']
    : ['kode', 'tgl', 'item', 'total', 'status', 'aksi'];

  const aksi = o => {
    let h = `<button class="btn btn-sm" data-act="detail" data-id="${o.id}">Detail</button>`;
    if (u.role === 'admin' && o.status === STATUS.MENUNGGU && !o.terverifikasi)
      h += `<button class="btn btn-sm btn-ok" data-act="verifikasi" data-id="${o.id}">Verifikasi</button>`;
    if (o.status === STATUS.MENUNGGU)                                                                   // rule 9
      h += `<button class="btn btn-sm btn-danger" data-act="batal" data-id="${o.id}">Batalkan</button>`;
    return h;
  };

  return `<div class="panel">
    <div class="panel-head"><h2>${u.role === 'admin' ? 'Semua pesanan' : 'Riwayat pesanan saya'}</h2>
      <div class="tools">${opsiStatus({ key: 'riwayat' })}</div></div>
    ${tabelPesanan(list, kolom, aksi)}
  </div>`;
}

/* ----- Data Pengiriman + Update status (admin, kurir) ----- */
function pgPengiriman(u) {
  let list = DB.pesanan.filter(o =>
    o.terverifikasi && o.status !== STATUS.BATAL &&
    (u.role === 'admin' || !o.kurir_id || o.kurir_id === u.id));
  if (filters.pengiriman) list = list.filter(o => o.status === filters.pengiriman);
  list.sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  const aksi = o => {
    let h = `<button class="btn btn-sm" data-act="detail" data-id="${o.id}">Detail</button>`;
    if (o.status === STATUS.MENUNGGU)
      h += `<button class="btn btn-sm btn-primary" data-act="kirim" data-id="${o.id}">Terima dan kirim</button>`;   // rule 7
    if (o.status === STATUS.KIRIM)
      h += `<button class="btn btn-sm btn-ok" data-act="selesai" data-id="${o.id}">Tandai selesai</button>`;         // rule 8
    return h;
  };

  return `<div class="panel">
    <div class="panel-head"><h2>Daftar pengiriman</h2>
      <div class="tools">${opsiStatus({ key: 'pengiriman' })}</div></div>
    <p style="color:var(--muted);font-size:14px;margin-bottom:12px">Hanya pesanan yang sudah diverifikasi admin yang tampil di sini.</p>
    ${tabelPesanan(list, ['kode', 'tgl', 'pel', 'item', 'status', 'kurir', 'aksi'], aksi)}
  </div>`;
}

/* ----- Laporan (admin) ----- */
function pgLaporan() {
  let list = DB.pesanan.filter(o => {
    const t = tglLokal(o.tanggal);
    return (!filters.laporan_dari || t >= filters.laporan_dari) && (!filters.laporan_sampai || t <= filters.laporan_sampai);
  }).sort((a, b) => b.tanggal.localeCompare(a.tanggal));

  const selesai = list.filter(o => o.status === STATUS.SELESAI);
  const terjual = selesai.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0);

  return `
    <div class="panel">
      <div class="panel-head"><h2>Laporan pesanan</h2>
        <div class="tools">
          <input type="date" data-filter="laporan_dari" value="${filters.laporan_dari}" aria-label="Dari tanggal">
          <span>sampai</span>
          <input type="date" data-filter="laporan_sampai" value="${filters.laporan_sampai}" aria-label="Sampai tanggal">
          <button class="btn btn-primary" data-act="cetak">Cetak</button>
        </div></div>
      <div class="stats" style="margin-bottom:0">
        ${statCard('Jumlah pesanan', list.length)}
        ${statCard('Selesai', selesai.length)}
        ${statCard('Dibatalkan', list.filter(o => o.status === STATUS.BATAL).length)}
        ${statCard('Galon terjual', terjual)}
        ${statCard('Pendapatan', rupiah(selesai.reduce((s, o) => s + o.total, 0)))}
      </div>
    </div>
    <div class="panel">${tabelPesanan(list, ['kode', 'tgl', 'pel', 'item', 'total', 'status', 'kurir'], () => '')}</div>`;
}

/* ---------- 7. AKSI ---------- */
function detailPesanan(o) {
  return `<dl class="kv">
      <dt>Kode</dt><dd>${kode(o.id)}</dd>
      <dt>Tanggal</dt><dd>${tgl(o.tanggal)}</dd>
      <dt>Pelanggan</dt><dd>${esc(o.pelanggan_nama)}</dd>
      <dt>Alamat</dt><dd>${esc(o.alamat)}</dd>
      <dt>Catatan</dt><dd>${esc(o.catatan) || '-'}</dd>
      <dt>Status</dt><dd>${badge(o.status)}</dd>
      <dt>Verifikasi</dt><dd>${o.terverifikasi ? 'Sudah diverifikasi admin' : 'Belum diverifikasi'}</dd>
      <dt>Kurir</dt><dd>${o.kurir_id ? esc(namaUser(o.kurir_id)) : '-'}</dd>
      <dt>Selesai</dt><dd>${tgl(o.tanggal_selesai)}</dd>
    </dl>
    <ul class="detail-list">${o.items.map(i => `<li><span>${i.qty}x ${esc(i.nama)}</span><span>${rupiah(i.qty * i.harga)}</span></li>`).join('')}</ul>
    <div class="total-line"><span>Total</span><span>${rupiah(o.total)}</span></div>
    <div class="modal-actions"><button class="btn btn-primary" data-act="modal-close">Tutup</button></div>`;
}

function jalankan(fn) {   // jalankan aksi, tampilkan pesan error dari server bila ada
  try { Promise.resolve(fn()).catch(e => toast(e.message, 'err')); }
  catch (e) { toast(e.message, 'err'); }
}

const ACT = {
  'modal-close': () => closeModal(),
  cetak: () => window.print(),

  detail: id => {
    const o = DB.pesanan.find(x => x.id === Number(id));
    openModal('Detail pesanan', detailPesanan(o));
  },

  verifikasi: id => {
    const kurir = DB.users.filter(x => x.role === 'kurir');
    openModal('Verifikasi pesanan ' + kode(id), `<form>
      <p style="margin-bottom:14px">Setelah diverifikasi, pesanan muncul di daftar pengiriman kurir.</p>
      <label>Tugaskan ke kurir (opsional)<select name="kurir_id">
        <option value="">Biarkan kurir yang mengambil</option>
        ${kurir.map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('')}
      </select></label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="modal-close">Batal</button>
      <button class="btn btn-primary">Verifikasi</button></div></form>`,
      async fd => {
        await api('pesanan_verifikasi', { id: Number(id), kurir_id: Number(fd.get('kurir_id')) || null });
        closeModal(); toast('Pesanan diverifikasi.'); await perbarui();
      });
  },

  batal: async id => {                                                                 // rule 9
    if (!confirm('Batalkan pesanan ' + kode(id) + '?')) return;
    await api('pesanan_batal', { id: Number(id) });
    toast('Pesanan dibatalkan. Stok dikembalikan.'); await perbarui();
  },

  kirim: async id => {                                                                 // rule 7
    await api('pesanan_kirim', { id: Number(id) });
    toast('Status: ' + STATUS.KIRIM); await perbarui();
  },

  selesai: async id => {                                                               // rule 8
    await api('pesanan_selesai', { id: Number(id) });
    toast('Pesanan selesai. Riwayat tersimpan.'); await perbarui();
  },

  /* --- user & pelanggan --- */
  'user-add': (id, b) => {
    const scope = b.dataset.scope;
    openModal(scope === 'semua' ? 'Tambah user' : 'Tambah pelanggan', formUser(scope), fd => simpanUser(fd, scope, 0));
  },
  'user-edit': (id, b) => {
    const scope = b.dataset.scope;
    const x = DB.users.find(u => u.id === Number(id));
    openModal('Ubah data', formUser(scope, x), fd => simpanUser(fd, scope, x.id));
  },
  'user-del': async id => {
    const x = DB.users.find(u => u.id === Number(id));
    if (x.id === me().id) return toast('Akun yang sedang dipakai tidak dapat dihapus.', 'err');
    if (!confirm('Hapus ' + x.nama + '?')) return;
    await api('user_hapus', { id: x.id });
    toast('Data dihapus.'); await perbarui();
  },

  /* --- galon --- */
  'galon-add': () => openModal('Tambah galon', formGalon(), fd => simpanGalon(fd, 0)),
  'galon-edit': id => {
    const g = DB.galon.find(x => x.id === Number(id));
    openModal('Ubah galon', formGalon(g), fd => simpanGalon(fd, g.id));
  },
  'galon-del': async id => {
    const g = DB.galon.find(x => x.id === Number(id));
    if (!confirm('Hapus ' + g.nama + '?')) return;
    await api('galon_hapus', { id: g.id });
    toast('Data galon dihapus.'); await perbarui();
  }
};

async function simpanUser(fd, scope, id) {
  await api('user_simpan', {
    id,
    nama: fd.get('nama').trim(),
    username: fd.get('username').trim(),
    password: fd.get('password'),
    role: scope === 'semua' ? fd.get('role') : 'pelanggan',
    telp: fd.get('telp').trim(),
    alamat: fd.get('alamat').trim()
  });
  closeModal(); toast('Data tersimpan.'); await perbarui();
}

async function simpanGalon(fd, id) {
  await api('galon_simpan', {
    id,
    nama: fd.get('nama').trim(),
    harga: Number(fd.get('harga')),
    stok: Number(fd.get('stok'))
  });
  closeModal(); toast('Data galon tersimpan.'); await perbarui();
}

/* ---------- 8. INISIALISASI ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  let sibuk = false;   // cegah klik ganda saat menunggu server

  // login
  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault();
    jalankan(async () => {
      try {
        await login($('#loginUser').value.trim(), $('#loginPass').value);
        $('#loginError').textContent = '';
        $('#loginForm').reset();
        showView();
      } catch (err) {
        $('#loginError').textContent = err.message;
      }
    });
  });
  $('#btnLogout').addEventListener('click', () => jalankan(logout));

  // navigasi + aksi tombol (event delegation)
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { page = nav.dataset.nav; render(); return; }
    const act = e.target.closest('[data-act]');
    if (act && ACT[act.dataset.act]) jalankan(() => ACT[act.dataset.act](act.dataset.id, act));
    if (e.target === $('#modal')) closeModal();
  });
  $('#modalClose').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // submit form di modal
  $('#modalBody').addEventListener('submit', e => {
    e.preventDefault();
    if (!modalSubmit || sibuk) return;
    const fd = new FormData(e.target);
    sibuk = true;
    jalankan(async () => { try { await modalSubmit(fd); } finally { sibuk = false; } });
  });

  // form pemesanan
  $('#content').addEventListener('submit', e => {
    if (e.target.id !== 'orderForm') return;
    e.preventDefault();
    if (sibuk) return;
    sibuk = true;
    jalankan(async () => { try { await buatPesanan(); } finally { sibuk = false; } });
  });
  $('#content').addEventListener('input', e => {
    if (e.target.matches('[data-qty]')) hitungTotalForm();
  });
  $('#content').addEventListener('change', e => {
    if (e.target.id === 'selPel') {
      const opt = e.target.selectedOptions[0];
      $('#alamatOrder').value = opt ? opt.dataset.alamat || '' : '';
    }
    if (e.target.dataset.filter) {
      filters[e.target.dataset.filter] = e.target.value;
      render();
    }
  });

  // cek sesi login yang masih aktif
  try {
    const r = await api('me');
    if (r.user) await muatData();
  } catch (err) {
    toast(err.message, 'err');
  }
  showView();
});
