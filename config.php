<?php
// Pengaturan koneksi MySQL (default XAMPP: user root, tanpa password)
date_default_timezone_set('Asia/Jakarta');

const DB_HOST  = 'localhost';
const DB_NAME  = 'galon_db';
const DB_USER  = 'root';
const DB_PASS  = '';
const APP_DEBUG = true;   // ubah ke false jika web sudah dipublikasikan

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );
        $pdo->exec("SET time_zone = '+07:00'");
    }
    return $pdo;
}
