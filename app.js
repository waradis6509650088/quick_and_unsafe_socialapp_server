var http = require('http');
var fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multiparty = require('multiparty');
const crypto = require('crypto');

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

// create token table
const createTokenTable = `
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    token TEXT NOT NULL
);
`;
// create user table
const createUserTable = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    prof_img TEXT NOT NULL,
    password TEXT NOT NULL,
    salt TEXT NOT NULL
);
`;
// Create the posts table
const createPostTable = `
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    prof_img TEXT NOT NULL,
    post_img TEXT,
    date_posted INTEGER NOT NULL,
    text_content TEXT NOT NULL
);
`;

db.run(createTokenTable, (err) => {
  if (err) {
    console.error('Error creating table:', err.message);
  } else {
    console.log('Table "token" created or already exists.');
  }
});

db.run(createPostTable, (err) => {
  if (err) {
    console.error('Error creating table:', err.message);
  } else {
    console.log('Table "posts" created or already exists.');
  }
});

db.run(createUserTable, (err) => {
  if (err) {
    console.error('Error creating table:', err.message);
  } else {
    console.log('Table "users" created or already exists.');
  }
});


// Create the HTTP server
const server = http.createServer((req, res) => {
  // Set response headers

  // Handle GET requests to fetch all posts
  // Handle retrieving posts with pagination
  if (req.method === 'GET' && (req.url.startsWith('/posts/') || req.url.startsWith('/posts'))){
    const x = req.url.split('/')[2];  // Extract the {x} from the URL
    const page = parseInt(x, 10) || 0;  // Default to page 0 if invalid `x`
    const offset = page * 10;  // Offset for the database query (multiply page by 10)

    // Query the posts table, ordered by `date_posted` in descending order (newest to oldest)
    const query = `
      SELECT * FROM posts
      ORDER BY date_posted DESC
      LIMIT 20 OFFSET ?
    `;

    db.all(query, [offset], (err, rows) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', details: err.message }));
        return;
      }

      // Map the posts to the desired format with the username, profile image, and post image
      const data = rows.map(row => ({
        username: row.username,
        prof_img: row.prof_img,
        post_img: row.post_img || null,  // Allow for null post_img
        date_posted: row.date_posted,
        text_content: row.text_content
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    });
  } else
  if (req.method === 'POST' && req.url === '/create-post') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { username, post_img, text_content, token } = JSON.parse(body);

        if (!username || !text_content || !token) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // Check if the token exists for the provided username
        const tokenQuery = `SELECT * FROM tokens WHERE username = ? AND token = ?`;
        db.get(tokenQuery, [username, token], (err, row) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database error', details: err.message }));
            return;
          }

          if (!row) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid token or session expired' }));
            return;
          }

          // Get the user's profile image from the users table
          const userQuery = `SELECT prof_img FROM users WHERE username = ?`;
          db.get(userQuery, [username], (err, userRow) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Database error', details: err.message }));
              return;
            }

            if (!userRow) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'User not found' }));
              return;
            }

            // Use the user's prof_img from the database
            const prof_img = userRow.prof_img;

            // Generate the current date in Unix timestamp format
            const date_posted = Math.floor(Date.now() / 1000);

            // If post_img is not provided, set it to NULL
            const postImage = post_img || null;

            // Insert the post into the database
            const postQuery = `
              INSERT INTO posts (username, prof_img, post_img, date_posted, text_content)
              VALUES (?, ?, ?, ?, ?)
            `;
            db.run(postQuery, [username, prof_img, postImage, date_posted, text_content], function (err) {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Database error', details: err.message }));
              } else {
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  message: 'Post created successfully',
                  post: {
                    id: this.lastID,
                    username: username,
                    prof_img: prof_img,
                    post_img: postImage,
                    text_content: text_content,
                    date_posted: date_posted
                  }
                }));
              }
            });
          });
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON format' }));
      }
    });
  } else
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
        const fileUrl = `${newFileName}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: fileUrl }));
      });
    });
  } else
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
  } else
  if (req.method === 'POST' && req.url === '/register-user') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { username, prof_img, password } = JSON.parse(body);

        if (!username || !prof_img || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // Check if the username already exists
        const checkUserQuery = `SELECT * FROM users WHERE username = ?`;
        db.get(checkUserQuery, [username], (err, existingUser) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database error', details: err.message }));
          } else if (existingUser) {
            res.writeHead(409, { 'Content-Type': 'application/json' }); // 409 Conflict
            res.end(JSON.stringify({ error: 'Username already exists' }));
          } else {
            // Generate salt and hash the password
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

            // Insert user into the database
            const userQuery = `INSERT INTO users (username, prof_img, password, salt) VALUES (?, ?, ?, ?)`;
            db.run(userQuery, [username, prof_img, hash, salt], function (err) {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Database error', details: err.message }));
              } else {
                // Generate a random token
                const token = crypto.randomBytes(32).toString('hex');

                // Insert the token into the tokens table
                const tokenQuery = `
                  INSERT INTO tokens (username, token)
                  VALUES (?, ?)
                  ON CONFLICT(username) DO UPDATE SET token = excluded.token
                `;
                db.run(tokenQuery, [username, token], (tokenErr) => {
                  if (tokenErr) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Error storing token', details: tokenErr.message }));
                  } else {
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      message: 'User registered successfully',
                      user: {
                        id: this.lastID,
                        username: username,
                        prof_img: prof_img
                      },
                      token: token
                    }));
                  }
                });
              }
            });
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON format' }));
      }
    });
    } else
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });
  
      req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
  
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing username or password' }));
            return;
          }
  
          // Query to get the user details from the database
          const query = `SELECT * FROM users WHERE username = ?`;
          db.get(query, [username], (err, row) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Database error', details: err.message }));
            } else if (row) {
              // Hash the incoming password using the stored salt
              const hashedPassword = crypto
                .pbkdf2Sync(password, row.salt, 1000, 64, 'sha512')
                .toString('hex');
  
              // Compare the hashed password with the stored one
              if (hashedPassword === row.password) {
                // Generate a random token
                const token = crypto.randomBytes(32).toString('hex');
  
                // Insert or update the token for the user in the tokens table
                const tokenQuery = `
                  INSERT INTO tokens (username, token)
                  VALUES (?, ?)
                  ON CONFLICT(username) DO UPDATE SET token = excluded.token
                `;
                db.run(tokenQuery, [username, token], (tokenErr) => {
                  if (tokenErr) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Error storing token', details: tokenErr.message }));
                  } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      message: 'Login successful',
                      user: {
                        id: row.id,
                        username: row.username,
                        prof_img: row.prof_img
                      },
                      token: token
                    }));
                  }
                });
              } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid username or password' }));
              }
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid username or password' }));
            }
          });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON format' }));
        }
      }); 
    }
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
});

// Set server to listen on port 3000
server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
});
