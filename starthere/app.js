const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

let db;

(async () => {
  try {
    // Connect and set up database and schema
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      multipleStatements: true
    });

    await conn.query(`
      DROP DATABASE IF EXISTS DogWalkService;
      CREATE DATABASE DogWalkService;
      USE DogWalkService;

      CREATE TABLE Users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('owner', 'walker') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE Dogs (
        dog_id INT AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        name VARCHAR(50) NOT NULL,
        size ENUM('small','medium','large') NOT NULL,
        FOREIGN KEY(owner_id) REFERENCES Users(user_id)
      );

      CREATE TABLE WalkRequests (
        request_id INT AUTO_INCREMENT PRIMARY KEY,
        dog_id INT NOT NULL,
        requested_time DATETIME NOT NULL,
        duration_minutes INT NOT NULL,
        location VARCHAR(255) NOT NULL,
        status ENUM('open','accepted','completed','cancelled') DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(dog_id) REFERENCES Dogs(dog_id)
      );

      CREATE TABLE WalkApplications (
        application_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        walker_id INT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status ENUM('pending','accepted','rejected') DEFAULT 'pending',
        FOREIGN KEY(request_id) REFERENCES WalkRequests(request_id),
        FOREIGN KEY(walker_id) REFERENCES Users(user_id),
        CONSTRAINT unique_application UNIQUE(request_id, walker_id)
      );

      CREATE TABLE WalkRatings (
        rating_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        walker_id INT NOT NULL,
        owner_id INT NOT NULL,
        rating INT CHECK (rating BETWEEN 1 AND 5),
        comments TEXT,
        rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(request_id) REFERENCES WalkRequests(request_id),
        FOREIGN KEY(walker_id) REFERENCES Users(user_id),
        FOREIGN KEY(owner_id) REFERENCES Users(user_id),
        CONSTRAINT unique_rating_per_walk UNIQUE(request_id)
      );
    `);
    conn.end();

    // Connect to use database
    db = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'DogWalkService'
    });

    // Insert test data
    await db.execute(`
      INSERT IGNORE INTO Users (username, email, password_hash, role) VALUES
        ('alice123','alice@example.com','hashed123','owner'),
        ('bobwalker','bob@example.com','hashed456','walker'),
        ('carol123','carol@example.com','hashed789','owner'),
        ('blarewalker','blarer@example.com','hashed351','walker'),
        ('serenaowner','serena@example.com','hashed642','owner');
    `);

    await db.execute(`
      INSERT IGNORE INTO Dogs (owner_id, name, size) VALUES
        ((SELECT user_id FROM Users WHERE username='alice123'),'Max','medium'),
        ((SELECT user_id FROM Users WHERE username='carol123'),'Bella','small'),
        ((SELECT user_id FROM Users WHERE username='serenaowner'),'Rocky','large'),
        ((SELECT user_id FROM Users WHERE username='blare123'),'Luna','small'),
        ((SELECT user_id FROM Users WHERE username='cal123'),'Milo','medium');
    `);

    await db.execute(`
      INSERT IGNORE INTO WalkRequests (dog_id, requested_time, duration_minutes, location, status) VALUES
        ((SELECT dog_id FROM Dogs WHERE name='Max'),'2025-06-10 08:00:00',30,'Parklands','open'),
        ((SELECT dog_id FROM Dogs WHERE name='Bella'),'2025-06-10 09:30:00',45,'Beachside Ave','accepted'),
        ((SELECT dog_id FROM Dogs WHERE name='Rocky'),'2025-06-11 10:00:00',60,'City Park','completed'),
        ((SELECT dog_id FROM Dogs WHERE name='Coco'),'2025-06-12 07:30:00',20,'Hilltop Trail','open'),
        ((SELECT dog_id FROM Dogs WHERE name='Milo'),'2025-06-13 14:00:00',40,'River Walk','cancelled');
    `);

    await db.execute(`
      INSERT IGNORE INTO WalkApplications (request_id, walker_id, status) VALUES
        ((SELECT request_id FROM WalkRequests WHERE location='Beachside Ave'),
         (SELECT user_id FROM Users WHERE username='bobwalker'),'accepted');
    `);

    await db.execute(`
      INSERT IGNORE INTO WalkRatings (request_id, walker_id, owner_id, rating, comments) VALUES
        ((SELECT request_id FROM WalkRequests WHERE location='Beachside Ave'),
         (SELECT user_id FROM Users WHERE username='bobwalker'),
         (SELECT user_id FROM Users WHERE username='carol123'),
         5,'Excellent walk!');
    `);
  } catch (err) {
    console.error('❌ Error setup:', err.message);
  }
})();

// Route definitions

app.get('/api/dogs', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT d.name AS dog_name, d.size, u.username AS owner_username
      FROM Dogs d JOIN Users u ON d.owner_id = u.user_id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dogs' });
  }
});

app.get('/api/walkrequests/open', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT wr.request_id, d.name AS dog_name, wr.requested_time,
             wr.duration_minutes, wr.location, u.username AS owner_username
      FROM WalkRequests wr
      JOIN Dogs d ON wr.dog_id = d.dog_id
      JOIN Users u ON d.owner_id = u.user_id
      WHERE wr.status='open'
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch open walk requests' });
  }
});

app.get('/api/walkers/summary', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT u.username AS walker_username,
             COUNT(r.rating_id) AS total_ratings,
             ROUND(AVG(r.rating),1) AS average_rating,
             (
               SELECT COUNT(*) FROM WalkRequests wr
               JOIN WalkApplications wa ON wr.request_id = wa.request_id
               WHERE wa.walker_id = u.user_id AND wr.status='completed'
             ) AS completed_walks
      FROM Users u
      LEFT JOIN WalkRatings r ON u.user_id = r.walker_id
      WHERE u.role='walker'
      GROUP BY u.user_id;
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch walker summary' });
  }
});

app.listen(8080, () => console.log('🚀 Server running at http://localhost:8080'));