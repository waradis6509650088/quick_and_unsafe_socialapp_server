var https = require('https');
var http = require('http');
var fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multiparty = require('multiparty');
const { faker } = require('@faker-js/faker');

const uploadDir = path.join(__dirname, 'res');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Create a new SQLite database (or open it if it already exists)
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Create the posts table
const createTableQuery = `
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    prof_img TEXT NOT NULL,
    post_img TEXT,
    date_posted INTEGER NOT NULL,
    text_content TEXT NOT NULL
);
`;

db.run(createTableQuery, (err) => {
  if (err) {
      console.error('Error creating table:', err.message);
  } else {
      console.log('Table "posts" created or already exists.');
  }
});

// Function to generate a random post
function generatePost() {
  const randomSeed = Math.floor(Math.random() * 9000) + 1000; // 4 digit random number
  let randomInteger = Math.floor(Math.random() * 2);
  return {
    "username": faker.internet.username(),
    "prof-img": `https://picsum.photos/seed/${randomSeed}/500/500`,
    "post-img": randomInteger? `https://picsum.photos/seed/${randomSeed}/500/500` : null,
    "date-posted": Date.now(), // Unix time
    "text-content": faker.lorem.sentence(),
  };
}

// Create the HTTP server
const server = http.createServer((req, res) => {
  // Set response headers
  
  // Handle GET requests to fetch all posts
  if (req.method === 'GET' && req.url === '/posts') {
    res.setHeader('Content-Type', 'application/json');
    const posts = [];
    
    // Generate 5 random posts
    for (let i = 0; i < 10; i++) {
      posts.push(generatePost());
    }
    
    // Send response in the requested format
    res.statusCode = 200;
    res.end(JSON.stringify({ data: posts }));

  } 

  // upload image
  if (req.method === 'POST' && req.url === '/upload') {
    const form = new multiparty.Form({ uploadDir });

    form.parse(req, (err, fields, files) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error processing upload.');
            return;
        }

        const file = files.image[0];
        const tempPath = file.path;
        const newFileName = `${Date.now()}_${file.originalFilename}`;
        const newPath = path.join(uploadDir, newFileName);

        // Rename file to have a proper name
        fs.rename(tempPath, newPath, (err) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error saving file.');
                return;
            }

            // Respond with the file URL
            const fileUrl = `http://localhost:3000/res/${newFileName}`;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ url: fileUrl }));
        });
    });
  }

  // retrieve image
  if (req.method === 'GET' && req.url.startsWith('/res/')) {
    // Serve the uploaded files
    const filePath = path.join(__dirname, req.url);
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found.');
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    });
  } 
});

// Set server to listen on port 3000
server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
});
