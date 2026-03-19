-- ============================================================
-- schema.sql — VisitaRD Database
-- Ejecuta esto en Railway MySQL para crear todas las tablas
-- ============================================================

CREATE DATABASE IF NOT EXISTS visitard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE visitard;

-- ── USUARIOS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120)     NOT NULL,
  email        VARCHAR(180)     NOT NULL UNIQUE,
  password     VARCHAR(255)     NOT NULL,
  phone        VARCHAR(20)      DEFAULT NULL,
  role         ENUM('tourist','agency','driver','admin') NOT NULL DEFAULT 'tourist',
  avatar       VARCHAR(400)     DEFAULT NULL,
  rating       DECIMAL(3,2)     DEFAULT 5.00,
  verified     TINYINT(1)       DEFAULT 0,
  last_login   DATETIME         DEFAULT NULL,
  created_at   DATETIME         DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role  (role)
) ENGINE=InnoDB;

-- ── AGENCIAS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agencies (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL UNIQUE,
  name             VARCHAR(150) NOT NULL,
  ruc              VARCHAR(20)  DEFAULT NULL,
  logo             VARCHAR(400) DEFAULT NULL,
  description      TEXT         DEFAULT NULL,
  rating           DECIMAL(3,2) DEFAULT 5.00,
  verified         TINYINT(1)   DEFAULT 0,
  commission_rate  DECIMAL(4,2) DEFAULT 12.00,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── VIAJES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agency_id        INT UNSIGNED NOT NULL,
  title            VARCHAR(200) NOT NULL,
  description      TEXT         DEFAULT NULL,
  origin           VARCHAR(150) NOT NULL,
  destination      VARCHAR(150) NOT NULL,
  origin_lat       DECIMAL(10,7) DEFAULT NULL,
  origin_lng       DECIMAL(10,7) DEFAULT NULL,
  dest_lat         DECIMAL(10,7) DEFAULT NULL,
  dest_lng         DECIMAL(10,7) DEFAULT NULL,
  departure_at     DATETIME     NOT NULL,
  seats            SMALLINT     NOT NULL DEFAULT 40,
  seats_available  SMALLINT     NOT NULL DEFAULT 40,
  price            DECIMAL(8,2) NOT NULL,
  status           ENUM('scheduled','boarding','in_progress','completed','cancelled')
                   NOT NULL DEFAULT 'scheduled',
  bus_plate        VARCHAR(15)  DEFAULT NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE,
  INDEX idx_departure  (departure_at, status),
  INDEX idx_route      (origin, destination),
  INDEX idx_agency     (agency_id)
) ENGINE=InnoDB;

-- ── RESERVAS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id             INT UNSIGNED NOT NULL,
  user_id             INT UNSIGNED NOT NULL,
  seats               TINYINT      NOT NULL DEFAULT 1,
  total_price         DECIMAL(8,2) NOT NULL,
  status              ENUM('pending','confirmed','cancelled','failed')
                      NOT NULL DEFAULT 'pending',
  payment_intent_id   VARCHAR(100) DEFAULT NULL,
  qr_code             VARCHAR(32)  DEFAULT NULL,
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id)  REFERENCES trips(id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  INDEX idx_user_status  (user_id, status),
  INDEX idx_payment      (payment_intent_id),
  UNIQUE KEY uq_qr       (qr_code)
) ENGINE=InnoDB;

-- ── TRACKING GPS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracking (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_id      INT UNSIGNED NOT NULL UNIQUE,
  driver_id    INT UNSIGNED NOT NULL,
  current_lat  DECIMAL(10,7) NOT NULL,
  current_lng  DECIMAL(10,7) NOT NULL,
  speed        DECIMAL(6,2)  DEFAULT 0,
  heading      DECIMAL(6,2)  DEFAULT 0,
  updated_at   DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id)   REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_trip (trip_id)
) ENGINE=InnoDB;

-- ── RESEÑAS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id   INT UNSIGNED NOT NULL,
  reviewer_id  INT UNSIGNED NOT NULL,
  target_id    INT UNSIGNED NOT NULL,
  target_type  ENUM('agency','driver','place') NOT NULL DEFAULT 'agency',
  rating       TINYINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT         DEFAULT NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id)  REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id)    ON DELETE CASCADE,
  UNIQUE KEY uq_booking_review (booking_id, reviewer_id),
  INDEX idx_target (target_id, target_type)
) ENGINE=InnoDB;

-- ── LUGARES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS places (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(200)  NOT NULL,
  description   TEXT          DEFAULT NULL,
  lat           DECIMAL(10,7) NOT NULL,
  lng           DECIMAL(10,7) NOT NULL,
  category      ENUM('playa','montaña','ciudad','parque','gastronomia','cultural','aventura')
                DEFAULT 'ciudad',
  visits_count  INT UNSIGNED  DEFAULT 0,
  ai_tags       JSON          DEFAULT NULL,
  photos        JSON          DEFAULT NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_location (lat, lng),
  INDEX idx_visits   (visits_count DESC)
) ENGINE=InnoDB;

-- ── NOTIFICACIONES ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(120) NOT NULL,
  body       TEXT         NOT NULL,
  data       JSON         DEFAULT NULL,
  read_at    DATETIME     DEFAULT NULL,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_unread (user_id, read_at)
) ENGINE=InnoDB;

-- ── ADMIN POR DEFECTO ────────────────────────────────────────
-- Password: Admin@VisitaRD2026 (cámbialo inmediatamente)
INSERT IGNORE INTO users (name, email, password, role, verified)
VALUES (
  'Admin VisitaRD',
  'admin@visitard.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4tbQJAGrKi',
  'admin',
  1
);
