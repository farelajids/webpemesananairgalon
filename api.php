<?php
/* =====================================================================
   API Sistem Pemesanan dan Pengiriman Air Galon
   Semua aturan (rule 1-9) dan hak akses (matriks) dijalankan di sini,
   sehingga tetap aman walaupun tampilan (JavaScript) diakali.
   Pemakaian: api.php?aksi=NAMA_AKSI  (data dikirim/diterima dalam JSON)
   ===================================================================== */
require __DIR__ . '/config.php';

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
session_start();
header('Content-Type: application/json; charset=utf-8');

const S_MENUNGGU = 'MENUNGGU DI PROSES';   // rule 6
const S_KIRIM    = 'DALAM PENGIRIMAN';     // rule 7
const S_SELESAI  = 'SELESAI';              // rule 8
const S_BATAL    = 'DIBATALKAN';           // rule 9

/* ---------- Helper ---------- */
function keluar($data, int $kode = 200): void
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function tolak(string $pesan, int $kode = 400): void
{
    try {
        $pdo = db();
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    } catch (Throwable $e) {
        // koneksi belum ada / gagal, abaikan
    }
    keluar(['error' => $pesan], $kode);
}

function masukan(): array
{
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function wajibLogin(array $roles = []): array
{
    $u = $_SESSION['user'] ?? null;
    if (!$u) {
        tolak('Silakan login terlebih dahulu.', 401);
    }
    if ($roles && !in_array($u['role'], $roles, true)) {
        tolak('Anda tidak memiliki hak akses untuk aksi ini.', 403);
    }
    return $u;
}

function cariUser(int $id): ?array
{
    $st = db()->prepare('SELECT id, nama, username, role, telp, alamat FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) {
        return null;
    }
    $u['id'] = (int) $u['id'];
    return $u;
}

function cariPesanan(int $id, bool $kunci = false): array
{
    $st = db()->prepare('SELECT * FROM pesanan WHERE id = ?' . ($kunci ? ' FOR UPDATE' : ''));
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) {
        tolak('Pesanan tidak ditemukan.', 404);
    }
    return $p;
}

/* ---------- Router ---------- */
$aksi = $_GET['aksi'] ?? '';

try {
    switch ($aksi) {

        /* ===== Autentikasi ===== */
        case 'login': {
            $in = masukan();
            $st = db()->prepare('SELECT * FROM users WHERE username = ?');
            $st->execute([trim($in['username'] ?? '')]);
            $u = $st->fetch();
            if (!$u || !password_verify($in['password'] ?? '', $u['password'])) {
                tolak('Username atau password salah.', 401);
            }
            session_regenerate_id(true);
            $_SESSION['user'] = cariUser((int) $u['id']);
            keluar(['user' => $_SESSION['user']]);
        }

        case 'logout': {
            $_SESSION = [];
            session_destroy();
            keluar(['ok' => true]);
        }

        case 'me': {
            keluar(['user' => $_SESSION['user'] ?? null]);
        }

        /* ===== Ambil semua data sesuai hak akses ===== */
        case 'data': {
            $u = wajibLogin();
            $terbaru = cariUser($u['id']);
            if (!$terbaru) {
                $_SESSION = [];
                tolak('Akun tidak ditemukan.', 401);
            }
            $_SESSION['user'] = $terbaru;

            // users: admin melihat lengkap, peran lain hanya id, nama, role
            if ($u['role'] === 'admin') {
                $users = db()->query('SELECT id, nama, username, role, telp, alamat FROM users ORDER BY id')->fetchAll();
            } else {
                $users = db()->query('SELECT id, nama, role FROM users ORDER BY id')->fetchAll();
            }

            $galon = db()->query('SELECT id, nama, harga, stok FROM galon ORDER BY id')->fetchAll();

            $sql = 'SELECT p.*, us.nama AS pelanggan_nama FROM pesanan p JOIN users us ON us.id = p.pelanggan_id';
            $param = [];
            if ($u['role'] === 'pelanggan') {
                $sql .= ' WHERE p.pelanggan_id = ?';
                $param[] = $u['id'];
            } elseif ($u['role'] === 'kurir') {
                $sql .= ' WHERE p.terverifikasi = 1 AND p.status <> ? AND (p.kurir_id IS NULL OR p.kurir_id = ?)';
                $param[] = S_BATAL;
                $param[] = $u['id'];
            }
            $sql .= ' ORDER BY p.id DESC';
            $st = db()->prepare($sql);
            $st->execute($param);
            $pesanan = $st->fetchAll();

            // detail item tiap pesanan
            $items = [];
            if ($pesanan) {
                $ids = array_column($pesanan, 'id');
                $in = implode(',', array_fill(0, count($ids), '?'));
                $st = db()->prepare("SELECT pesanan_id, galon_id, nama, harga, qty FROM detail_pesanan WHERE pesanan_id IN ($in)");
                $st->execute($ids);
                foreach ($st->fetchAll() as $d) {
                    $items[$d['pesanan_id']][] = [
                        'galon_id' => (int) $d['galon_id'],
                        'nama'     => $d['nama'],
                        'harga'    => (int) $d['harga'],
                        'qty'      => (int) $d['qty'],
                    ];
                }
            }
            foreach ($pesanan as &$p) {
                $p['id']              = (int) $p['id'];
                $p['pelanggan_id']    = (int) $p['pelanggan_id'];
                $p['kurir_id']        = $p['kurir_id'] === null ? null : (int) $p['kurir_id'];
                $p['total']           = (int) $p['total'];
                $p['terverifikasi']   = (bool) $p['terverifikasi'];
                $p['tanggal']         = str_replace(' ', 'T', $p['tanggal']);
                $p['tanggal_selesai'] = $p['tanggal_selesai'] === null ? null : str_replace(' ', 'T', $p['tanggal_selesai']);
                $p['items']           = $items[$p['id']] ?? [];
            }
            unset($p);

            keluar(['user' => $terbaru, 'users' => $users, 'galon' => $galon, 'pesanan' => $pesanan]);
        }

        /* ===== Pesanan ===== */
        case 'pesanan_buat': {                                   // Admin, Pelanggan
            $u  = wajibLogin(['admin', 'pelanggan']);
            $in = masukan();

            $pelId = $u['role'] === 'admin' ? (int) ($in['pelanggan_id'] ?? 0) : $u['id'];
            $pel = cariUser($pelId);
            if (!$pel || $pel['role'] !== 'pelanggan') {
                tolak('Pilih pelanggan yang valid.');
            }
            $alamat  = trim($in['alamat'] ?? '');
            $catatan = trim($in['catatan'] ?? '');
            if ($alamat === '') {
                tolak('Alamat pengiriman wajib diisi.');
            }

            // gabungkan item yang sama
            $qtyPerGalon = [];
            foreach (($in['items'] ?? []) as $it) {
                $gid = (int) ($it['galon_id'] ?? 0);
                $qty = (int) ($it['qty'] ?? 0);
                if ($gid > 0 && $qty > 0) {
                    $qtyPerGalon[$gid] = ($qtyPerGalon[$gid] ?? 0) + $qty;
                }
            }
            if (!$qtyPerGalon) {
                tolak('Pilih minimal satu galon.');
            }

            $pdo = db();
            $pdo->beginTransaction();
            $baris = [];
            $total = 0;
            foreach ($qtyPerGalon as $gid => $qty) {
                $st = $pdo->prepare('SELECT * FROM galon WHERE id = ? FOR UPDATE');
                $st->execute([$gid]);
                $g = $st->fetch();
                if (!$g) {
                    tolak('Galon tidak ditemukan.');
                }
                if ((int) $g['stok'] <= 0) {                     // rule 5
                    tolak('Stok "' . $g['nama'] . '" = 0. Pesanan tidak dapat diproses.');
                }
                if ($qty > (int) $g['stok']) {
                    tolak('Stok "' . $g['nama'] . '" hanya ' . $g['stok'] . '. Kurangi jumlah pesanan.');
                }
                $baris[] = ['g' => $g, 'qty' => $qty];           // rule 4
                $total += (int) $g['harga'] * $qty;
            }

            $st = $pdo->prepare('INSERT INTO pesanan (pelanggan_id, alamat, catatan, total, status) VALUES (?, ?, ?, ?, ?)');
            $st->execute([$pelId, $alamat, $catatan, $total, S_MENUNGGU]);   // rule 6
            $pesananId = (int) $pdo->lastInsertId();

            foreach ($baris as $b) {
                $pdo->prepare('INSERT INTO detail_pesanan (pesanan_id, galon_id, nama, harga, qty) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$pesananId, $b['g']['id'], $b['g']['nama'], $b['g']['harga'], $b['qty']]);
                $pdo->prepare('UPDATE galon SET stok = stok - ? WHERE id = ?')
                    ->execute([$b['qty'], $b['g']['id']]);
            }
            $pdo->commit();
            keluar(['ok' => true, 'id' => $pesananId]);
        }

        case 'pesanan_verifikasi': {                             // Admin
            wajibLogin(['admin']);
            $in = masukan();
            $p = cariPesanan((int) ($in['id'] ?? 0));
            if ($p['status'] !== S_MENUNGGU || $p['terverifikasi']) {
                tolak('Pesanan ini tidak dapat diverifikasi.');
            }
            $kurirId = (int) ($in['kurir_id'] ?? 0);
            if ($kurirId > 0) {
                $k = cariUser($kurirId);
                if (!$k || $k['role'] !== 'kurir') {
                    tolak('Kurir tidak valid.');
                }
            }
            db()->prepare('UPDATE pesanan SET terverifikasi = 1, kurir_id = ? WHERE id = ?')
                ->execute([$kurirId > 0 ? $kurirId : null, $p['id']]);
            keluar(['ok' => true]);
        }

        case 'pesanan_batal': {                                  // Admin, Pelanggan (rule 9)
            $u  = wajibLogin(['admin', 'pelanggan']);
            $in = masukan();
            $pdo = db();
            $pdo->beginTransaction();
            $p = cariPesanan((int) ($in['id'] ?? 0), true);
            if ($u['role'] === 'pelanggan' && (int) $p['pelanggan_id'] !== $u['id']) {
                tolak('Ini bukan pesanan Anda.', 403);
            }
            if ($p['status'] !== S_MENUNGGU) {
                tolak('Pesanan yang sudah dikirim tidak dapat dibatalkan.');
            }
            // kembalikan stok
            $st = $pdo->prepare('SELECT galon_id, qty FROM detail_pesanan WHERE pesanan_id = ?');
            $st->execute([$p['id']]);
            foreach ($st->fetchAll() as $d) {
                $pdo->prepare('UPDATE galon SET stok = stok + ? WHERE id = ?')->execute([$d['qty'], $d['galon_id']]);
            }
            $pdo->prepare('UPDATE pesanan SET status = ? WHERE id = ?')->execute([S_BATAL, $p['id']]);
            $pdo->commit();
            keluar(['ok' => true]);
        }

        case 'pesanan_kirim': {                                  // Admin, Kurir (rule 7)
            $u  = wajibLogin(['admin', 'kurir']);
            $in = masukan();
            $p = cariPesanan((int) ($in['id'] ?? 0));
            if ($p['status'] !== S_MENUNGGU || !$p['terverifikasi']) {
                tolak('Hanya pesanan yang sudah diverifikasi dan menunggu diproses yang dapat dikirim.');
            }
            $kurirId = $p['kurir_id'] === null ? null : (int) $p['kurir_id'];
            if ($u['role'] === 'kurir') {
                if ($kurirId !== null && $kurirId !== $u['id']) {
                    tolak('Pesanan ini ditugaskan ke kurir lain.', 403);
                }
                $kurirId = $u['id'];
            }
            db()->prepare('UPDATE pesanan SET status = ?, kurir_id = ? WHERE id = ?')
                ->execute([S_KIRIM, $kurirId, $p['id']]);
            keluar(['ok' => true]);
        }

        case 'pesanan_selesai': {                                // Admin, Kurir (rule 8)
            $u  = wajibLogin(['admin', 'kurir']);
            $in = masukan();
            $p = cariPesanan((int) ($in['id'] ?? 0));
            if ($p['status'] !== S_KIRIM) {
                tolak('Hanya pesanan berstatus DALAM PENGIRIMAN yang dapat diselesaikan.');
            }
            if ($u['role'] === 'kurir' && (int) $p['kurir_id'] !== $u['id']) {
                tolak('Ini bukan pengiriman Anda.', 403);
            }
            db()->prepare('UPDATE pesanan SET status = ?, tanggal_selesai = NOW() WHERE id = ?')
                ->execute([S_SELESAI, $p['id']]);
            keluar(['ok' => true]);
        }

        /* ===== Kelola user & pelanggan (Admin) ===== */
        case 'user_simpan': {
            $u  = wajibLogin(['admin']);
            $in = masukan();
            $id       = (int) ($in['id'] ?? 0);
            $nama     = trim($in['nama'] ?? '');
            $username = trim($in['username'] ?? '');
            $password = (string) ($in['password'] ?? '');
            $role     = $in['role'] ?? 'pelanggan';
            $telp     = trim($in['telp'] ?? '');
            $alamat   = trim($in['alamat'] ?? '');

            if ($nama === '' || $username === '') {
                tolak('Nama dan username wajib diisi.');
            }
            if (!in_array($role, ['admin', 'kurir', 'pelanggan'], true)) {
                tolak('Role tidak valid.');
            }
            $st = db()->prepare('SELECT id FROM users WHERE username = ? AND id <> ?');
            $st->execute([$username, $id]);
            if ($st->fetch()) {
                tolak('Username sudah dipakai.');
            }

            if ($id > 0) {
                if ($id === $u['id'] && $role !== 'admin') {
                    tolak('Anda tidak dapat mengubah role akun sendiri.');
                }
                db()->prepare('UPDATE users SET nama = ?, username = ?, role = ?, telp = ?, alamat = ? WHERE id = ?')
                    ->execute([$nama, $username, $role, $telp, $alamat, $id]);
                if ($password !== '') {
                    db()->prepare('UPDATE users SET password = ? WHERE id = ?')
                        ->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
                }
            } else {
                if ($password === '') {
                    tolak('Password wajib diisi untuk user baru.');
                }
                db()->prepare('INSERT INTO users (nama, username, password, role, telp, alamat) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$nama, $username, password_hash($password, PASSWORD_DEFAULT), $role, $telp, $alamat]);
            }
            keluar(['ok' => true]);
        }

        case 'user_hapus': {
            $u  = wajibLogin(['admin']);
            $in = masukan();
            $id = (int) ($in['id'] ?? 0);
            if ($id === $u['id']) {
                tolak('Akun yang sedang dipakai tidak dapat dihapus.');
            }
            $st = db()->prepare('SELECT COUNT(*) FROM pesanan WHERE pelanggan_id = ? OR kurir_id = ?');
            $st->execute([$id, $id]);
            if ((int) $st->fetchColumn() > 0) {
                tolak('User ini memiliki riwayat pesanan sehingga tidak dapat dihapus.');
            }
            db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            keluar(['ok' => true]);
        }

        /* ===== Data galon (Admin) ===== */
        case 'galon_simpan': {
            wajibLogin(['admin']);
            $in    = masukan();
            $id    = (int) ($in['id'] ?? 0);
            $nama  = trim($in['nama'] ?? '');
            $harga = (int) ($in['harga'] ?? -1);
            $stok  = (int) ($in['stok'] ?? -1);
            if ($nama === '' || $harga < 0 || $stok < 0) {
                tolak('Nama wajib diisi, harga dan stok tidak boleh negatif.');
            }
            if ($id > 0) {
                db()->prepare('UPDATE galon SET nama = ?, harga = ?, stok = ? WHERE id = ?')
                    ->execute([$nama, $harga, $stok, $id]);
            } else {
                db()->prepare('INSERT INTO galon (nama, harga, stok) VALUES (?, ?, ?)')
                    ->execute([$nama, $harga, $stok]);
            }
            keluar(['ok' => true]);
        }

        case 'galon_hapus': {
            wajibLogin(['admin']);
            $in = masukan();
            $id = (int) ($in['id'] ?? 0);
            $st = db()->prepare('SELECT COUNT(*) FROM detail_pesanan WHERE galon_id = ?');
            $st->execute([$id]);
            if ((int) $st->fetchColumn() > 0) {
                tolak('Galon ini sudah pernah dipesan sehingga tidak dapat dihapus. Ubah stoknya menjadi 0 saja.');
            }
            db()->prepare('DELETE FROM galon WHERE id = ?')->execute([$id]);
            keluar(['ok' => true]);
        }

        default:
            tolak('Aksi tidak dikenal.', 404);
    }
} catch (Throwable $e) {
    try {
        $pdo = db();
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    } catch (Throwable $e2) {
        // abaikan
    }
    error_log($e->getMessage());
    keluar(['error' => APP_DEBUG
        ? 'Kesalahan server: ' . $e->getMessage()
        : 'Terjadi kesalahan pada server.'], 500);
}
