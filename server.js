const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 中间件
app.use(express.static('public'));
app.use(express.json());

// 初始化数据库
const db = new sqlite3.Database('./drawings.db', (err) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

// 创建数据表
function initDatabase() {
  // 用户表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 会话表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      creator_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  // 绘画动作表
  db.run(`
    CREATE TABLE IF NOT EXISTS draw_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      data TEXT NOT NULL,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 作品表
  db.run(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT,
      image_data TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating artworks table:', err);
    } else {
      // Check if updated_at column exists, if not add it (for existing databases)
      db.run(`SELECT updated_at FROM artworks LIMIT 1`, (err) => {
        if (err && err.message.includes('no such column')) {
          // Column doesn't exist, add it
          db.run(`ALTER TABLE artworks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
            if (err) {
              console.error('Error adding updated_at column:', err);
            } else {
              console.log('Successfully added updated_at column to existing table');
            }
          });
        }
      });
    }
  });

  // 评论表
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      artwork_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 点赞表
  db.run(`
    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      artwork_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(artwork_id, user_id)
    )
  `);

  console.log('Database tables initialized successfully');
}

// 存储所有连接的客户端
const clients = new Map();
let activeSessionId = null;
let nextUserId = 1; // Sequential user ID counter

// 获取指定会话的在线人数
function getSessionOnlineCount(sessionId) {
  let count = 0;
  clients.forEach(client => {
    if (client.sessionId === sessionId) {
      count++;
    }
  });
  return count;
}

// 获取会话的所有参与者（去重）
function getSessionParticipants(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT u.id, u.username, u.display_name, u.avatar 
       FROM draw_actions da
       JOIN users u ON da.user_id = u.id
       WHERE da.session_id = ?
       ORDER BY u.id ASC`,
      [sessionId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// 创建新会话
function createSession() {
  return new Promise((resolve, reject) => {
    const sessionId = uuidv4();
    const sessionName = `Drawing Session ${new Date().toLocaleString('en-US')}`;
    
    db.run(
      'INSERT INTO sessions (id, name) VALUES (?, ?)',
      [sessionId, sessionName],
      (err) => {
        if (err) reject(err);
        else resolve(sessionId);
      }
    );
  });
}

// 保存绘画动作到数据库
function saveDrawAction(sessionId, actionType, data, userId) {
  db.run(
    'INSERT INTO draw_actions (session_id, action_type, data, user_id) VALUES (?, ?, ?, ?)',
    [sessionId, actionType, JSON.stringify(data), userId],
    (err) => {
      if (err) console.error('Failed to save draw action:', err);
    }
  );
}

// 获取会话的所有绘画动作
function getSessionActions(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM draw_actions WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId],
      (err, rows) => {
        if (err) reject(err);
        else {
          const actions = rows.map(row => ({
            type: row.action_type,
            data: JSON.parse(row.data),
            userId: row.user_id
          }));
          resolve(actions);
        }
      }
    );
  });
}

// WebSocket 连接处理
wss.on('connection', async (ws, req) => {
  const clientId = uuidv4();
  
  // 从URL参数获取用户ID和会话ID
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedSessionId = url.searchParams.get('sessionId');
  const realUserId = url.searchParams.get('userId'); // 真实用户ID
  
  clients.set(clientId, { ws, sessionId: null, userId: realUserId || clientId });
  
  console.log(`New client connected: ${clientId}, user: ${realUserId || 'guest'}, current online users: ${clients.size}`);
  
  let targetSessionId = null;
  
  // 只有明确请求了会话ID，才加入会话
  if (requestedSessionId) {
    targetSessionId = requestedSessionId;
    
    // 将客户端加入目标会话
    const client = clients.get(clientId);
    client.sessionId = targetSessionId;
    
    console.log(`Client ${clientId} joined session: ${targetSessionId}`);
    
    // 通知同一会话的其他客户端有新用户加入
    clients.forEach((clientInfo, id) => {
      if (id !== clientId && 
          clientInfo.sessionId === targetSessionId && 
          clientInfo.ws.readyState === WebSocket.OPEN) {
        clientInfo.ws.send(JSON.stringify({
          type: 'user_joined',
          userId: clientId,
          onlineUsers: getSessionOnlineCount(targetSessionId)
        }));
      }
    });
    
    // 发送历史绘画数据
    try {
      const history = await getSessionActions(targetSessionId);
      ws.send(JSON.stringify({
        type: 'history',
        actions: history
      }));
    } catch (err) {
      console.error('Failed to get history data:', err);
    }
  }

  // 发送连接成功消息和客户端ID
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId,
    sessionId: targetSessionId,
    onlineUsers: targetSessionId ? getSessionOnlineCount(targetSessionId) : 0
  }));

  // 处理消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // 处理加入会话的请求
      if (data.type === 'join_session') {
        const client = clients.get(clientId);
        const newSessionId = data.sessionId;
        const oldSessionId = client.sessionId;
        
        // 如果之前在其他会话，通知旧会话的成员
        if (oldSessionId && oldSessionId !== newSessionId) {
          clients.forEach((clientInfo, id) => {
            if (clientInfo.sessionId === oldSessionId && clientInfo.ws.readyState === WebSocket.OPEN) {
              clientInfo.ws.send(JSON.stringify({
                type: 'user_left',
                userId: clientId,
                onlineUsers: getSessionOnlineCount(oldSessionId)
              }));
            }
          });
        }
        
        // 加入新会话
        client.sessionId = newSessionId;
        
        // 通知新会话的其他成员
        clients.forEach((clientInfo, id) => {
          if (id !== clientId && 
              clientInfo.sessionId === newSessionId && 
              clientInfo.ws.readyState === WebSocket.OPEN) {
            clientInfo.ws.send(JSON.stringify({
              type: 'user_joined',
              userId: clientId,
              onlineUsers: getSessionOnlineCount(newSessionId)
            }));
          }
        });
        
        // 发送历史数据
        getSessionActions(newSessionId).then(history => {
          ws.send(JSON.stringify({
            type: 'history',
            actions: history
          }));
        }).catch(err => {
          console.error('Failed to get history data:', err);
        });
        
        // 确认加入成功
        ws.send(JSON.stringify({
          type: 'session_joined',
          sessionId: newSessionId,
          onlineUsers: getSessionOnlineCount(newSessionId)
        }));
        
        return;
      }
      
      // 处理离开会话的请求
      if (data.type === 'leave_session') {
        const client = clients.get(clientId);
        const oldSessionId = client.sessionId;
        
        if (oldSessionId) {
          // 离开当前会话
          client.sessionId = null;
          
          // 通知会话的其他成员
          clients.forEach((clientInfo, id) => {
            if (clientInfo.sessionId === oldSessionId && clientInfo.ws.readyState === WebSocket.OPEN) {
              clientInfo.ws.send(JSON.stringify({
                type: 'user_left',
                userId: clientId,
                onlineUsers: getSessionOnlineCount(oldSessionId)
              }));
            }
          });
        }
        
        return;
      }
      
      // 获取当前客户端的会话ID
      const currentClient = clients.get(clientId);
      const currentSessionId = currentClient ? currentClient.sessionId : null;
      
      // 只有加入了会话才能绘画
      if (!currentSessionId) {
        return;
      }
      
      // 保存到数据库（保存到客户端当前所在的会话）
      if (data.type === 'draw' || data.type === 'clear') {
        const client = clients.get(clientId);
        const realUserId = client ? client.userId : clientId;
        
        saveDrawAction(currentSessionId, data.type, data, realUserId);
        
        // Update the artwork's updated_at timestamp if it exists
        db.run(
          'UPDATE artworks SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?',
          [currentSessionId],
          (err) => {
            if (err) console.error('Failed to update artwork timestamp:', err);
          }
        );
      }

      // 广播给同一会话中的其他客户端
      clients.forEach((clientInfo, id) => {
        if (id !== clientId && 
            clientInfo.sessionId === currentSessionId && 
            clientInfo.ws.readyState === WebSocket.OPEN) {
          clientInfo.ws.send(JSON.stringify({
            ...data,
            userId: clientId
          }));
        }
      });
    } catch (err) {
      console.error('Failed to process message:', err);
    }
  });

  // 处理断开连接
  ws.on('close', () => {
    const client = clients.get(clientId);
    const userSessionId = client ? client.sessionId : null;
    
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}, current online users: ${clients.size}`);
    
    // 通知同一会话的其他客户端有人离开
    if (userSessionId) {
      clients.forEach((clientInfo, id) => {
        if (clientInfo.sessionId === userSessionId && clientInfo.ws.readyState === WebSocket.OPEN) {
          clientInfo.ws.send(JSON.stringify({
            type: 'user_left',
            userId: clientId,
            onlineUsers: getSessionOnlineCount(userSessionId)
          }));
        }
      });
    }
    
    // Also broadcast general user_left for backward compatibility
    broadcast({
      type: 'user_left',
      userId: clientId,
      onlineUsers: clients.size
    });
  });

  // 错误处理
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// 广播消息给所有客户端（可排除指定客户端）
function broadcast(data, excludeClientId = null) {
  const message = JSON.stringify(data);
  clients.forEach((clientInfo, id) => {
    if (id !== excludeClientId && clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(message);
    }
  });
}

// ==================== 用户认证 API ====================

// 注册
app.post('/api/register', (req, res) => {
  const { username, password, displayName } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password cannot be empty' });
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  // Get the next sequential user ID
  db.get('SELECT MAX(CAST(id AS INTEGER)) as maxId FROM users WHERE id GLOB "[0-9]*"', [], (err, row) => {
    const userId = String((row && row.maxId ? parseInt(row.maxId) : 0) + 1);

    db.run(
      'INSERT INTO users (id, username, password, display_name) VALUES (?, ?, ?, ?)',
      [userId, username, passwordHash, displayName || username],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: err.message });
        }

        res.json({
          success: true,
          user: {
            id: userId,
            username: username,
            displayName: displayName || username
          }
        });
      }
    );
  });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password cannot be empty' });
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  db.get(
    'SELECT id, username, display_name, avatar FROM users WHERE username = ? AND password = ?',
    [username, passwordHash],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!user) {
        return res.status(401).json({ error: 'Incorrect username or password' });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          avatar: user.avatar
        }
      });
    }
  );
});

// 获取用户信息
app.get('/api/users/:id', (req, res) => {
  db.get(
    'SELECT id, username, display_name, avatar, created_at FROM users WHERE id = ?',
    [req.params.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(404).json({ error: 'User does not exist' });
      }
      res.json(user);
    }
  );
});

// ==================== 会话 API ====================

app.get('/api/sessions', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 6;
  const offset = (page - 1) * pageSize;
  
  // 先获取总数
  db.get(
    'SELECT COUNT(*) as total FROM sessions',
    (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const totalCount = countResult.total;
      const totalPages = Math.ceil(totalCount / pageSize);
      
      db.all(
        `SELECT s.*, u.display_name as creator_name, 
         (SELECT COUNT(*) FROM draw_actions WHERE session_id = s.id) as action_count
         FROM sessions s
         LEFT JOIN users u ON s.creator_id = u.id
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [pageSize, offset],
        (err, rows) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Add online count for each session
          const sessionsWithOnlineCount = rows.map(session => ({
            ...session,
            online_users: getSessionOnlineCount(session.id)
          }));
          
          res.json({
            sessions: sessionsWithOnlineCount,
            page: page,
            pageSize: pageSize,
            totalCount: totalCount,
            totalPages: totalPages,
            hasMore: page < totalPages
          });
        }
      );
    }
  );
});

app.get('/api/sessions/:id/actions', (req, res) => {
  const sessionId = req.params.id;
  db.all(
    'SELECT * FROM draw_actions WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

// 删除会话
app.delete('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;
  
  // 先删除该会话的所有绘画动作
  db.run('DELETE FROM draw_actions WHERE session_id = ?', [sessionId], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // 再删除会话本身
    db.run('DELETE FROM sessions WHERE id = ?', [sessionId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Session does not exist' });
      }
      
      res.json({ success: true, message: 'Session deleted' });
    });
  });
});

// ==================== 作品 API ====================

// 发布作品
app.post('/api/artworks', (req, res) => {
  const { userId, sessionId, title, imageData } = req.body;
  
  if (!userId || !imageData) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const artworkId = uuidv4();

  db.run(
    'INSERT INTO artworks (id, user_id, session_id, title, image_data, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [artworkId, userId, sessionId, title || 'Untitled', imageData],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        success: true,
        artworkId: artworkId
      });
    }
  );
});

// 获取所有作品
app.get('/api/artworks', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  
  // 先获取总数
  db.get(
    'SELECT COUNT(*) as total FROM artworks',
    async (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const totalCount = countResult.total;
      const totalPages = Math.ceil(totalCount / pageSize);
      
      db.all(
        `SELECT a.*, u.display_name, u.avatar, u.username,
         (SELECT COUNT(*) FROM likes WHERE artwork_id = a.id) as likes_count
         FROM artworks a
         JOIN users u ON a.user_id = u.id
         ORDER BY a.updated_at DESC
         LIMIT ? OFFSET ?`,
        [pageSize, offset],
    async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Add participant count for each artwork
      const artworksWithParticipants = await Promise.all(rows.map(async (artwork) => {
        if (artwork.session_id) {
          const participants = await getSessionParticipants(artwork.session_id);
          return {
            ...artwork,
            participant_count: participants.length,
            participants: participants
          };
        }
        return {
          ...artwork,
          participant_count: 1,
          participants: [{
            id: artwork.user_id,
            username: artwork.username,
            display_name: artwork.display_name,
            avatar: artwork.avatar
          }]
        };
      }));
      
        res.json({
          artworks: artworksWithParticipants,
          page: page,
          pageSize: pageSize,
          totalCount: totalCount,
          totalPages: totalPages,
          hasMore: page < totalPages
        });
      }
    );
  });
});

// 获取用户的作品（包括已保存的和已发布的）
app.get('/api/users/:id/artworks', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  
  // 先获取总数
  db.get(
    'SELECT COUNT(*) as total FROM artworks WHERE user_id = ?',
    [req.params.id],
    async (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const totalCount = countResult.total;
      const totalPages = Math.ceil(totalCount / pageSize);
      
      db.all(
        `SELECT a.*, u.display_name, u.avatar, u.username,
         (SELECT COUNT(*) FROM likes WHERE artwork_id = a.id) as likes_count
         FROM artworks a
         JOIN users u ON a.user_id = u.id
         WHERE a.user_id = ?
         ORDER BY a.updated_at DESC
         LIMIT ? OFFSET ?`,
        [req.params.id, pageSize, offset],
    async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Add participant count for each artwork
      const artworksWithParticipants = await Promise.all(rows.map(async (artwork) => {
        if (artwork.session_id) {
          const participants = await getSessionParticipants(artwork.session_id);
          
          // If no participants from draw_actions, at least include the creator
          if (participants.length === 0) {
            return {
              ...artwork,
              participant_count: 1,
              participants: [{
                id: artwork.user_id,
                username: artwork.username,
                display_name: artwork.display_name,
                avatar: artwork.avatar
              }]
            };
          }
          
          return {
            ...artwork,
            participant_count: participants.length,
            participants: participants
          };
        }
        return {
          ...artwork,
          participant_count: 1,
          participants: [{
            id: artwork.user_id,
            username: artwork.username,
            display_name: artwork.display_name,
            avatar: artwork.avatar
          }]
        };
      }));
      
        res.json({
          artworks: artworksWithParticipants,
          page: page,
          pageSize: pageSize,
          totalCount: totalCount,
          totalPages: totalPages,
          hasMore: page < totalPages
        });
      }
    );
  });
});

// 获取单个作品详情
app.get('/api/artworks/:id', async (req, res) => {
  db.get(
    `SELECT a.*, u.display_name, u.avatar, u.username,
     (SELECT COUNT(*) FROM likes WHERE artwork_id = a.id) as likes_count,
     (SELECT COUNT(*) FROM comments WHERE artwork_id = a.id) as comments_count
     FROM artworks a
     JOIN users u ON a.user_id = u.id
     WHERE a.id = ?`,
    [req.params.id],
    async (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Artwork does not exist' });
      }
      
      // Get all participants
      if (row.session_id) {
        const participants = await getSessionParticipants(row.session_id);
        
        // If no participants from draw_actions, at least include the creator
        if (participants.length === 0) {
          row.participants = [{
            id: row.user_id,
            username: row.username,
            display_name: row.display_name,
            avatar: row.avatar
          }];
          row.participant_count = 1;
        } else {
          row.participants = participants;
          row.participant_count = participants.length;
        }
      } else {
        row.participants = [{
          id: row.user_id,
          username: row.username,
          display_name: row.display_name,
          avatar: row.avatar
        }];
        row.participant_count = 1;
      }
      
      res.json(row);
    }
  );
});

// 保存作品（不发布，保存为私有作品）
app.post('/api/artworks/save', (req, res) => {
  const { userId, sessionId, title, imageData } = req.body;
  
  if (!userId || !sessionId || !imageData) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const artworkId = uuidv4();

  // 先保存作品到artworks表，但标记为未发布（私有）
  db.run(
    'INSERT INTO artworks (id, user_id, session_id, title, image_data, likes, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [artworkId, userId, sessionId, title || 'Untitled Work', imageData, 0],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // 同时更新会话标题
      db.run(
        'UPDATE sessions SET name = ? WHERE id = ?',
        [title || `Drawing ${new Date().toLocaleString('en-US')}`, sessionId],
        function(err) {
          if (err) {
            console.error('Failed to update session title:', err);
          }
        }
      );
      
      res.json({ success: true, artworkId: artworkId, sessionId: sessionId });
    }
  );
});

// 创建新会话（新的绘画作品）
app.post('/api/sessions/new', (req, res) => {
  const { userId, title } = req.body;
  const sessionId = uuidv4();
  const sessionName = title || `Drawing ${new Date().toLocaleString('en-US')}`;
  
  db.run(
    'INSERT INTO sessions (id, name, creator_id) VALUES (?, ?, ?)',
    [sessionId, sessionName, userId || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, sessionId: sessionId });
    }
  );
});

// ==================== 评论 API ====================

// 获取作品的评论
app.get('/api/artworks/:id/comments', (req, res) => {
  db.all(
    `SELECT c.*, u.display_name, u.avatar, u.username
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.artwork_id = ?
     ORDER BY c.created_at DESC`,
    [req.params.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// 添加评论
app.post('/api/artworks/:id/comments', (req, res) => {
  const { userId, content } = req.body;
  const artworkId = req.params.id;
  
  if (!userId || !content) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const commentId = uuidv4();

  db.run(
    'INSERT INTO comments (id, artwork_id, user_id, content) VALUES (?, ?, ?, ?)',
    [commentId, artworkId, userId, content],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // 返回新创建的评论信息
      db.get(
        `SELECT c.*, u.display_name, u.avatar, u.username
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.id = ?`,
        [commentId],
        (err, row) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, comment: row });
        }
      );
    }
  );
});

// ==================== 点赞 API ====================

// 点赞/取消点赞
app.post('/api/artworks/:id/like', (req, res) => {
  const { userId } = req.body;
  const artworkId = req.params.id;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing user ID' });
  }

  // 检查是否已经点赞
  db.get(
    'SELECT * FROM likes WHERE artwork_id = ? AND user_id = ?',
    [artworkId, userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row) {
        // 已点赞，取消点赞
        db.run(
          'DELETE FROM likes WHERE artwork_id = ? AND user_id = ?',
          [artworkId, userId],
          (err) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            
            // 更新作品点赞数
            db.run(
              'UPDATE artworks SET likes = likes - 1 WHERE id = ?',
              [artworkId],
              (err) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, liked: false });
              }
            );
          }
        );
      } else {
        // 未点赞，添加点赞
        const likeId = uuidv4();
        db.run(
          'INSERT INTO likes (id, artwork_id, user_id) VALUES (?, ?, ?)',
          [likeId, artworkId, userId],
          (err) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            
            // 更新作品点赞数
            db.run(
              'UPDATE artworks SET likes = likes + 1 WHERE id = ?',
              [artworkId],
              (err) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, liked: true });
              }
            );
          }
        );
      }
    }
  );
});

// 检查用户是否点赞了某个作品
app.get('/api/artworks/:id/like/:userId', (req, res) => {
  db.get(
    'SELECT * FROM likes WHERE artwork_id = ? AND user_id = ?',
    [req.params.id, req.params.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ liked: !!row });
    }
  );
});

// Clear all app data (keep user info)
app.post('/api/clear-app-data', (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  // Verify user exists
  db.get('SELECT id FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Start transaction to clear data
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Clear drawing actions
      db.run('DELETE FROM draw_actions', (err) => {
        if (err) console.error('Failed to clear draw_actions:', err);
      });
      
      // Clear comments
      db.run('DELETE FROM comments', (err) => {
        if (err) console.error('Failed to clear comments:', err);
      });
      
      // Clear likes
      db.run('DELETE FROM likes', (err) => {
        if (err) console.error('Failed to clear likes:', err);
      });
      
      // Clear artworks
      db.run('DELETE FROM artworks', (err) => {
        if (err) console.error('Failed to clear artworks:', err);
      });
      
      // Clear sessions (drawing rooms)
      db.run('DELETE FROM sessions', (err) => {
        if (err) console.error('Failed to clear sessions:', err);
      });
      
      // Commit transaction
      db.run('COMMIT', (err) => {
        if (err) {
          console.error('Transaction failed:', err);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to clear data' });
        }
        
        console.log(`User ${userId} cleared all app data`);
        res.json({ 
          message: 'All app data successfully cleared',
          cleared: {
            artworks: 'All artworks',
            sessions: 'All drawing rooms',
            comments: 'All comments',
            likes: 'All like records',
            actions: 'All drawing actions'
          },
          preserved: {
            users: 'User account information preserved'
          }
        });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`WebSocket service started`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Failed to close database:', err);
    } else {
      console.log('Database closed');
    }
    process.exit(0);
  });
});

