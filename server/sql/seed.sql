-- ============================================================
-- Seed data for development (matches the mockup examples)
-- All passwords are: 123456  (bcrypt hash below)
-- ============================================================
USE beit_jan_library;

-- bcrypt hash of "123456" (10 rounds)
SET @pw = '$2b$10$c5..wRwC7lo4kNseAJfwa.8LAf3jvxh8RvXvWPzJjbw98e9WBr2/G';

INSERT INTO users (username, password_hash, role, full_name, phone, email) VALUES
  ('siham',   @pw, 'librarian',  'סיהאם עטילה',   '050-1234567', 'siham@school.il'),
  ('manager', @pw, 'management', 'מנהל בית הספר', '050-7654321', 'manager@school.il'),
  ('daniel',  @pw, 'student',    'דניאל כהן',     '052-7654321', 'daniel@school.il'),
  ('lina',    @pw, 'student',    'לינה עמאר',     '052-1112233', 'lina@school.il'),
  ('rami',    @pw, 'student',    'ראמי נאסר',     '052-4445566', 'rami@school.il');

INSERT INTO students (user_id, student_number, national_id, class_name, parent_email) VALUES
  ((SELECT id FROM users WHERE username='daniel'), '205743891', '205743891', 'יא-3', 'cohen.parents@gmail.com'),
  ((SELECT id FROM users WHERE username='lina'),   '312345678', '312345678', 'יא-1', 'amar.parents@gmail.com'),
  ((SELECT id FROM users WHERE username='rami'),   '315678901', '315678901', 'יא-2', 'naser.parents@gmail.com');

INSERT INTO books (barcode, isbn, title, author, genre, shelf_location, publish_year, status) VALUES
  ('BK-0001', '9789650100011', 'מתמטיקה לבגרות 5 יח"ל', 'פרופ\' כהן', 'study',      'A1-01', 2022, 'available'),
  ('BK-0002', '9789650100028', 'ביולוגיה ט\'',          'ד"ר לוי',    'science',    'B2-03', 2021, 'loaned'),
  ('BK-0031', '9789650100311', 'היסטוריה י"א',          'מירי שרון',  'history',    'C2-08', 2020, 'loaned'),
  ('BK-0047', '9789650100472', 'מחשבים ורשתות - מבוא',  'ד"ר יואל לוי','technology','A3-12', 2023, 'available'),
  ('BK-0055', '9789650100557', 'ספרות עברית',           'נועה ברק',   'literature', 'D1-05', 2019, 'damaged'),
  ('BK-0060', '9789650100601', 'יסודות תכנות Python',   'מירי כהן',   'technology', 'A3-15', 2023, 'loaned'),
  ('BK-0061', '9789650100618', 'מדעי המחשב לבגרות',     'נועה ברק',   'technology', 'A4-02', 2022, 'available'),
  ('BK-0062', '9789650100625', 'רשתות תקשורת מתקדמות',  'פרופ\' בן-דוד','technology','A3-20', 2021, 'reserved');

-- Active loans (matching mockup: Lina overdue, Rami overdue)
INSERT INTO loans (book_id, student_user_id, librarian_id, loaned_at, due_date, status) VALUES
  ((SELECT id FROM books WHERE barcode='BK-0002'),
   (SELECT id FROM users WHERE username='lina'),
   (SELECT id FROM users WHERE username='siham'),
   DATE_SUB(NOW(), INTERVAL 19 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'overdue'),
  ((SELECT id FROM books WHERE barcode='BK-0031'),
   (SELECT id FROM users WHERE username='rami'),
   (SELECT id FROM users WHERE username='siham'),
   DATE_SUB(NOW(), INTERVAL 17 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'overdue'),
  ((SELECT id FROM books WHERE barcode='BK-0060'),
   (SELECT id FROM users WHERE username='daniel'),
   (SELECT id FROM users WHERE username='siham'),
   DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 12 DAY), 'active');

-- Active reservation (matching mockup: BK-0062 reserved)
INSERT INTO reservations (book_id, student_user_id, expires_at) VALUES
  ((SELECT id FROM books WHERE barcode='BK-0062'),
   (SELECT id FROM users WHERE username='daniel'),
   DATE_ADD(NOW(), INTERVAL 48 HOUR));

-- Active debt (Lina blocked)
INSERT INTO debts (student_user_id, loan_id, reason, description) VALUES
  ((SELECT id FROM users WHERE username='lina'),
   (SELECT l.id FROM loans l JOIN users u ON u.id=l.student_user_id WHERE u.username='lina' LIMIT 1),
   'overdue', 'איחור בהחזרת ביולוגיה ט'''); 
