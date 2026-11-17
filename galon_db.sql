-- Skema database MySQL untuk Sistem Pemesanan dan Pengiriman Air Galon
-- Nama tabel & kolom sama dengan field yang dipakai di js/app.js dan api/api.php
-- Cara pakai: buka phpMyAdmin > tab Import > pilih file ini > Go

CREATE DATABASE IF NOT EXISTS galon_db CHARACTER SET utf8mb4;
USE galon_db;

CREATE TABLE users (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nama      VARCHAR(100) NOT NULL,
  username  VARCHAR(50)  NOT NULL UNIQUE,
  password  VARCHAR(255) NOT NULL,              -- simpan hasil password_hash(), bukan teks asli
  role      ENUM('admin','kurir','pelanggan') NOT NULL,
  telp      VARCHAR(20),
  alamat    TEXT
);

CREATE TABLE galon (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  nama   VARCHAR(100) NOT NULL,
  harga  INT NOT NULL CHECK (harga >= 0),
  stok   INT NOT NULL DEFAULT 0 CHECK (stok >= 0)
);

CREATE TABLE pesanan (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tanggal          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pelanggan_id     INT NOT NULL,
  kurir_id         INT NULL,
  alamat           TEXT NOT NULL,
  catatan          VARCHAR(255),
  total            INT NOT NULL,
  status           ENUM('MENUNGGU DI PROSES','DALAM PENGIRIMAN','SELESAI','DIBATALKAN')
                   NOT NULL DEFAULT 'MENUNGGU DI PROSES',
  terverifikasi    TINYINT(1) NOT NULL DEFAULT 0,
  tanggal_selesai  DATETIME NULL,
  FOREIGN KEY (pelanggan_id) REFERENCES users(id),
  FOREIGN KEY (kurir_id)     REFERENCES users(id)
);

-- "items" pada pesanan di JavaScript = tabel detail_pesanan
CREATE TABLE detail_pesanan (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  pesanan_id  INT NOT NULL,
  galon_id    INT NOT NULL,
  nama        VARCHAR(100) NOT NULL,            -- salinan nama saat dipesan
  harga       INT NOT NULL,                     -- salinan harga saat dipesan
  qty         INT NOT NULL CHECK (qty > 0),
  FOREIGN KEY (pesanan_id) REFERENCES pesanan(id) ON DELETE CASCADE,
  FOREIGN KEY (galon_id)   REFERENCES galon(id)
);

-- Data awal (akun contoh, galon, pesanan) diisi lewat api/install.php
-- supaya password tersimpan dalam bentuk hash (password_hash) yang aman.
