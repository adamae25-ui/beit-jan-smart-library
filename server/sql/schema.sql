-- ============================================================
-- Beit Jan Smart Library - Database Schema (MySQL 8+)
-- Based on the systems analysis document (20262P48)
-- ============================================================

CREATE DATABASE IF NOT EXISTS beit_jan_library
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE beit_jan_library;

-- ------------------------------------------------------------
-- Users: librarian / student / management (מדרג הרשאות)
-- ------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('librarian','student','management') NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  phone         VARCHAR(30),
  email         VARCHAR(120),
  status        ENUM('active','blocked','inactive') NOT NULL DEFAULT 'active',
  last_login_at DATETIME,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Students: extra data for role='student' (זיהוי + זכאות)
-- ------------------------------------------------------------
CREATE TABLE students (
  user_id        INT UNSIGNED PRIMARY KEY,
  student_number VARCHAR(20) NOT NULL UNIQUE,
  national_id    VARCHAR(12) NOT NULL UNIQUE,
  class_name     VARCHAR(20) NOT NULL,           -- e.g. 'יא-3'
  parent_email   VARCHAR(120),
  max_loans      TINYINT UNSIGNED NOT NULL DEFAULT 3,
  CONSTRAINT fk_students_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Books: each row is a physical copy with its own barcode
-- (matches the mockup: barcode BK-0001 identifies one copy)
-- ------------------------------------------------------------
CREATE TABLE books (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  barcode        VARCHAR(20)  NOT NULL UNIQUE,   -- BK-0001
  isbn           VARCHAR(20),
  title          VARCHAR(200) NOT NULL,
  author         VARCHAR(120),
  genre          ENUM('study','science','literature','history','technology','other')
                 NOT NULL DEFAULT 'other',
  shelf_location VARCHAR(12)  NOT NULL,          -- A3-12
  publish_year   SMALLINT,
  status         ENUM('available','loaned','reserved','damaged','removed')
                 NOT NULL DEFAULT 'available',
  notes          VARCHAR(400),
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_books_title  (title),
  INDEX idx_books_author (author),
  INDEX idx_books_genre  (genre),
  INDEX idx_books_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Loans: השאלות (active + history in one table)
-- ------------------------------------------------------------
CREATE TABLE loans (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  book_id          INT UNSIGNED NOT NULL,
  student_user_id  INT UNSIGNED NOT NULL,
  librarian_id     INT UNSIGNED NOT NULL,        -- who processed it
  loaned_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date         DATE     NOT NULL,            -- 1.7.1.7 auto-calculated
  returned_at      DATETIME,                     -- NULL = active loan
  return_condition ENUM('ok','partially_torn','badly_damaged','missing_pages'),
  return_notes     VARCHAR(400),
  overdue_days     SMALLINT UNSIGNED NOT NULL DEFAULT 0,  -- set on return (1.7.2.2)
  status           ENUM('active','returned','overdue') NOT NULL DEFAULT 'active',
  CONSTRAINT fk_loans_book      FOREIGN KEY (book_id)         REFERENCES books(id),
  CONSTRAINT fk_loans_student   FOREIGN KEY (student_user_id) REFERENCES users(id),
  CONSTRAINT fk_loans_librarian FOREIGN KEY (librarian_id)    REFERENCES users(id),
  INDEX idx_loans_student (student_user_id),
  INDEX idx_loans_status  (status),
  INDEX idx_loans_due     (due_date)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Reservations: שריון עם תפוגת 48 שעות וביטול אוטומטי (1.7.1.4)
-- ------------------------------------------------------------
CREATE TABLE reservations (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  book_id         INT UNSIGNED NOT NULL,
  student_user_id INT UNSIGNED NOT NULL,
  reserved_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME NOT NULL,             -- reserved_at + 48h (configurable)
  status          ENUM('active','fulfilled','expired','cancelled') NOT NULL DEFAULT 'active',
  CONSTRAINT fk_res_book    FOREIGN KEY (book_id)         REFERENCES books(id),
  CONSTRAINT fk_res_student FOREIGN KEY (student_user_id) REFERENCES users(id),
  INDEX idx_res_status  (status),
  INDEX idx_res_expires (expires_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Debts: חובות (איחורים / נזק). No monetary fine per spec,
-- but a debt record blocks new loans until settled (1.7.1.1)
-- ------------------------------------------------------------
CREATE TABLE debts (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_user_id INT UNSIGNED NOT NULL,
  loan_id         INT UNSIGNED,
  reason          ENUM('overdue','damage','lost') NOT NULL,
  description     VARCHAR(400),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at      DATETIME,                      -- NULL = active debt
  settled_by      INT UNSIGNED,                  -- librarian who cleared it
  settle_note     VARCHAR(400),                  -- required justification
  CONSTRAINT fk_debts_student FOREIGN KEY (student_user_id) REFERENCES users(id),
  CONSTRAINT fk_debts_loan    FOREIGN KEY (loan_id)         REFERENCES loans(id),
  INDEX idx_debts_student (student_user_id),
  INDEX idx_debts_active  (settled_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Notifications: log of SMS/WhatsApp/Email sent (1.7.1.8, 1.7.2.5)
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  channel      ENUM('whatsapp','sms','email') NOT NULL,
  template     VARCHAR(60) NOT NULL,             -- loan_confirm / return_confirm / reminder / overdue
  payload      JSON,
  sent_at      DATETIME,
  status       ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  error_detail VARCHAR(400),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_notif_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Settings: key/value system configuration (הגדרות מערכת)
-- ------------------------------------------------------------
CREATE TABLE settings (
  setting_key   VARCHAR(60) PRIMARY KEY,
  setting_value VARCHAR(200) NOT NULL,
  description   VARCHAR(200),
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO settings (setting_key, setting_value, description) VALUES
  ('max_loans_per_student', '3',  'מספר ספרים מקסימלי לתלמיד'),
  ('reservation_hours',     '48', 'שעות שריון עד ביטול אוטומטי'),
  ('loan_days_study',       '14', 'ימי השאלה - ספרי לימוד'),
  ('loan_days_science',     '14', 'ימי השאלה - ספרי מדע'),
  ('loan_days_literature',  '21', 'ימי השאלה - ספרות'),
  ('loan_days_history',     '14', 'ימי השאלה - היסטוריה'),
  ('loan_days_technology',  '14', 'ימי השאלה - טכנולוגיה'),
  ('loan_days_other',       '14', 'ימי השאלה - אחר'),
  ('reminder_days_before',  '2',  'ימים לפני החזרה לשליחת תזכורת'),
  ('default_channel',       'whatsapp', 'ערוץ התראות ברירת מחדל');
