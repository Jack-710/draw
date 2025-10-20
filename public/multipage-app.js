// 多页面绘画社区应用
let ws;
let clientId;
let sessionId;
let isDrawing = false;
let currentTool = 'brush';
let currentBrushStyle = 'normal'; // normal, spray, paint, roller
let currentColor = '#000000';
let currentSize = 5;
let currentPage = 'loginPage'; // 默认显示登录页面
let currentUser = null; // 当前登录用户

// 分页相关
let explorePage = 1;
let explorePageSize = 6;
let exploreTotalPages = 1;
let profilePage = 1;
let profilePageSize = 4;
let profileTotalPages = 1;
let sessionsPage = 1;
let sessionsPageSize = 3;
let sessionsTotalPages = 1;

// Canvas 设置
const canvas = document.getElementById('drawCanvas');
const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;

// 页面切换
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.style.display = 'none';
  });
  document.getElementById(pageId).style.display = 'block';
  currentPage = pageId;
  
  // 更新底部导航活动状态
  document.querySelectorAll('.nav-main-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.page === pageId) {
      btn.classList.add('active');
    }
  });
  
  // 如果切换到绘画页面，初始化canvas
  if (pageId === 'drawPage' && canvas) {
    setTimeout(() => {
      resizeCanvas();
    }, 100);
  }
  
  // 如果切换到房间选择页面，加载所有会话房间
  if (pageId === 'selectStreamPage') {
    loadSessionRooms();
  } else {
    // 如果离开选择房间页面，停止轮询
    if (sessionPollingInterval) {
      clearInterval(sessionPollingInterval);
      sessionPollingInterval = null;
    }
  }
  
  // 如果离开绘画页面，退出当前会话（但不清空sessionId，以便重新进入）
  if (currentPage === 'drawPage' && pageId !== 'drawPage' && pageId !== 'previewPage') {
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({
        type: 'leave_session'
      }));
      // 注意：不清空sessionId，因为可能需要返回该会话
    }
  }
  
  // 如果切换到预览页面，更新预览画布
  if (pageId === 'previewPage') {
    updatePreviewCanvas();
  }
  
  // 如果切换到个人主页，加载用户作品
  if (pageId === 'profilePage') {
    loadUserArtworks();
  }
}

// 初始化
window.addEventListener('load', () => {
  // 检查是否已登录
  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    currentPage = 'explorePage';
  }
  
  // 显示默认页面
  showPage(currentPage);
  
  if (canvas) {
    resizeCanvas();
    setupEventListeners();
  }
  
  if (currentUser) {
    connectWebSocket();
    loadGallery();
    updateUserInfo();
    loadUserArtworks();
  }
  
  // 底部导航事件
  document.querySelectorAll('.nav-main-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPage = btn.dataset.page;
      if (targetPage) {
        showPage(targetPage);
      }
    });
  });
});

// 初始化 Canvas 大小
function resizeCanvas() {
  if (!canvas) return;
  
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  
  let imageData = null;
  if (canvas.width > 0 && canvas.height > 0) {
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {}
  }
  
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentPage === 'drawPage') {
      resizeCanvas();
    }
  }, 100);
});

// WebSocket 连接
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  // 在URL中传递用户ID和sessionId
  let wsUrl = `${protocol}//${window.location.host}`;
  const params = [];
  if (sessionId) {
    params.push(`sessionId=${sessionId}`);
  }
  if (currentUser && currentUser.id) {
    params.push(`userId=${currentUser.id}`);
  }
  if (params.length > 0) {
    wsUrl += `?${params.join('&')}`;
  }
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    showToast('✅ Connected to server');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    showToast('❌ Connection lost, reconnecting...');
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// 处理 WebSocket 消息
function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'connected':
      clientId = data.clientId;
      if (data.sessionId) {
        sessionId = data.sessionId;
      }
      updateOnlineCount(data.onlineUsers);
      break;

    case 'session_joined':
      sessionId = data.sessionId;
      updateOnlineCount(data.onlineUsers);
      showToast('✅ Joined room successfully');
      break;

    case 'history':
      setTimeout(() => {
        if (!ctx) return;
        
        // 先清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 重绘历史动作
        data.actions.forEach(action => {
          if (action.type === 'draw') {
            drawLine(action.data, false);
          } else if (action.type === 'clear') {
            clearCanvas(false);
          }
        });
        
        // 显示加载的笔画数量
        if (data.actions.length > 0) {
          showToast(`✅ Loaded ${data.actions.length} strokes`);
        } else {
          showToast('📝 Empty canvas - start drawing!');
        }
      }, 100);
      break;

    case 'draw':
      if (ctx) {
        drawLine(data, false);
      }
      break;

    case 'clear':
      if (ctx) {
        clearCanvas(false);
      }
      break;

    case 'user_left':
    case 'user_joined':
      updateOnlineCount(data.onlineUsers);
      break;
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 画笔风格选择
  document.querySelectorAll('.brush-style-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.brush-style-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      currentBrushStyle = target.dataset.style;
    });
  });
  
  // 工具选择
  const brushTool = document.getElementById('brushTool');
  const eraserTool = document.getElementById('eraserTool');
  
  if (brushTool) {
    brushTool.addEventListener('click', () => selectTool('brush'));
  }
  if (eraserTool) {
    eraserTool.addEventListener('click', () => selectTool('eraser'));
  }

  // 笔刷大小
  document.querySelectorAll('.size-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      document.querySelectorAll('.size-dot').forEach(d => d.classList.remove('active'));
      e.target.classList.add('active');
      currentSize = parseInt(e.target.dataset.size);
    });
  });

  // 颜色选择
  const colorPicker = document.getElementById('colorPicker');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      currentColor = e.target.value;
      updateColorIndicator(currentColor);
      if (currentTool === 'eraser') {
        selectTool('brush');
      }
    });
  }


  // 分享
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      showToast(`Online users: ${document.getElementById('onlineCount').textContent}`);
    });
  }

  // 保存按钮
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveCurrentDrawing();
    });
  }

  // 新建作品按钮
  const newDrawingBtn = document.getElementById('newDrawingBtn');
  if (newDrawingBtn) {
    newDrawingBtn.addEventListener('click', () => {
      createNewDrawing();
    });
  }

  // Canvas 绘画事件
  if (canvas) {
    setupCanvasEvents();
  }
  
  updateColorIndicator(currentColor);
}

// 设置 Canvas 绘画事件
function setupCanvasEvents() {
  let lastX = 0;
  let lastY = 0;

  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }
  }

  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const coords = getCoordinates(e);
    lastX = coords.x;
    lastY = coords.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    const drawData = {
      type: 'draw',
      startX: lastX,
      startY: lastY,
      endX: coords.x,
      endY: coords.y,
      color: currentTool === 'eraser' ? '#FFFFFF' : currentColor,
      size: currentTool === 'eraser' ? currentSize * 3 : currentSize,
      tool: currentTool,
      brushStyle: currentBrushStyle
    };

    drawLine(drawData, false);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(drawData));
    }

    lastX = coords.x;
    lastY = coords.y;
  }

  function stopDrawing() {
    isDrawing = false;
  }

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);

  canvas.addEventListener('touchstart', startDrawing);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDrawing);
}

// 绘制线条
function drawLine(data, broadcast = true) {
  if (!ctx) return;
  
  const brushStyle = data.brushStyle || 'normal';
  
  switch(brushStyle) {
    case 'spray':
      drawSprayLine(data);
      break;
    case 'paint':
      drawPaintLine(data);
      break;
    case 'roller':
      drawRollerLine(data);
      break;
    case 'normal':
    default:
      drawNormalLine(data);
      break;
  }
}

// 普通画笔
function drawNormalLine(data) {
  ctx.beginPath();
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(data.startX, data.startY);
  ctx.lineTo(data.endX, data.endY);
  ctx.stroke();
}

// 喷漆效果
function drawSprayLine(data) {
  const density = 20; // 喷点密度
  const radius = data.size * 2;
  const distance = Math.sqrt(
    Math.pow(data.endX - data.startX, 2) + 
    Math.pow(data.endY - data.startY, 2)
  );
  
  const steps = Math.max(1, Math.floor(distance / 2));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = data.startX + (data.endX - data.startX) * t;
    const y = data.startY + (data.endY - data.startY) * t;
    
    for (let j = 0; j < density; j++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const offsetX = Math.cos(angle) * dist;
      const offsetY = Math.sin(angle) * dist;
      
      ctx.fillStyle = data.color;
      ctx.globalAlpha = 0.1 + Math.random() * 0.2;
      ctx.fillRect(x + offsetX, y + offsetY, 1, 1);
    }
  }
  
  ctx.globalAlpha = 1;
}

// 油漆刷效果
function drawPaintLine(data) {
  const brushWidth = data.size * 3;
  const bristles = 10;
  
  for (let i = 0; i < bristles; i++) {
    const offset = (i - bristles / 2) * (brushWidth / bristles);
    const randomness = Math.random() * 2 - 1;
    
    ctx.beginPath();
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size / 3;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
    
    // 计算垂直于线条方向的偏移
    const dx = data.endX - data.startX;
    const dy = data.endY - data.startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len > 0) {
      const perpX = -dy / len;
      const perpY = dx / len;
      
      ctx.moveTo(
        data.startX + perpX * (offset + randomness),
        data.startY + perpY * (offset + randomness)
      );
      ctx.lineTo(
        data.endX + perpX * (offset + randomness),
        data.endY + perpY * (offset + randomness)
      );
      ctx.stroke();
    }
  }
  
  ctx.globalAlpha = 1;
}

// 滚筒刷效果
function drawRollerLine(data) {
  const rollerWidth = data.size * 4;
  const texture = 5;
  
  ctx.beginPath();
  ctx.strokeStyle = data.color;
  ctx.lineWidth = rollerWidth;
  ctx.lineCap = 'butt';
  ctx.moveTo(data.startX, data.startY);
  ctx.lineTo(data.endX, data.endY);
  ctx.stroke();
  
  // 添加纹理效果
  const distance = Math.sqrt(
    Math.pow(data.endX - data.startX, 2) + 
    Math.pow(data.endY - data.startY, 2)
  );
  
  const steps = Math.max(1, Math.floor(distance / 3));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = data.startX + (data.endX - data.startX) * t;
    const y = data.startY + (data.endY - data.startY) * t;
    
    for (let j = 0; j < texture; j++) {
      const offset = (Math.random() - 0.5) * rollerWidth;
      
      ctx.fillStyle = data.color;
      ctx.globalAlpha = 0.05;
      
      const dx = data.endX - data.startX;
      const dy = data.endY - data.startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len > 0) {
        const perpX = -dy / len;
        const perpY = dx / len;
        
        ctx.fillRect(
          x + perpX * offset,
          y + perpY * offset,
          2, 2
        );
      }
    }
  }
  
  ctx.globalAlpha = 1;
}

// 清空画布
function clearCanvas(broadcast = true) {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
}

// 选择工具
function selectTool(tool) {
  currentTool = tool;
  
  document.querySelectorAll('.tool-icon').forEach(btn => {
    btn.classList.remove('active');
  });

  if (tool === 'brush') {
    document.getElementById('brushTool')?.classList.add('active');
  } else if (tool === 'eraser') {
    document.getElementById('eraserTool')?.classList.add('active');
  }
}

// 更新颜色指示器
function updateColorIndicator(color) {
  const indicator = document.getElementById('colorIndicator');
  if (indicator) {
    indicator.style.backgroundColor = color;
  }
}

// 更新在线人数
function updateOnlineCount(count) {
  // 更新绘画页面的在线人数
  const onlineCount = document.getElementById('onlineCount');
  if (onlineCount) {
    onlineCount.textContent = count;
  }
  
  // 更新房间选择页面的在线人数
  const userCount = document.querySelector('.user-count');
  if (userCount) {
    userCount.textContent = count;
  }
}

// 加载画廊
function loadGallery(page = 1) {
  const galleryGrid = document.getElementById('galleryGrid');
  if (!galleryGrid) return;
  
  // 清空现有内容
  galleryGrid.innerHTML = '<div class="loading-spinner">Loading...</div>';
  
  // 从服务器加载实际作品
  fetch(`/api/artworks?page=${page}&pageSize=${explorePageSize}`)
    .then(res => res.json())
    .then(data => {
      explorePage = data.page;
      exploreTotalPages = data.totalPages;
      const artworks = data.artworks || data;
      if (artworks.length === 0) {
        // 如果没有作品，显示空状态
        galleryGrid.innerHTML = `
          <div class="empty-state">
            <svg width="120" height="120" viewBox="0 0 24 24" style="opacity: 0.3;">
              <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
            </svg>
            <h3>No artworks yet</h3>
            <p>Create your first drawing to get started!</p>
            <button class="primary-btn" onclick="showPage('selectStreamPage')" style="margin-top: 20px; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600;">
              Create Drawing
            </button>
          </div>
        `;
      } else {
        // 清空loading
        galleryGrid.innerHTML = '';
        
        artworks.forEach(artwork => {
          createGalleryCard(galleryGrid, artwork);
        });
        
        // 更新头部的分页控件
        updateExplorePageControl(data.page, data.totalPages);
      }
    })
    .catch(err => {
      console.error('Failed to load artworks:', err);
      galleryGrid.innerHTML = `
        <div class="empty-state">
          <p style="color: #999;">Failed to load artworks. Please refresh the page.</p>
        </div>
      `;
    });
}

// 创建画廊卡片
function createGalleryCard(container, artwork, index = 0) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  
  // 如果有真实作品，点击时显示详情
  if (artwork && artwork.id) {
    card.onclick = () => loadArtworkDetail(artwork.id);
  } else {
    card.onclick = () => showPage('detailPage');
  }
  
  const participantCount = artwork ? (artwork.participant_count || 1) : 1;
  const likes = artwork ? (artwork.likes_count || artwork.likes || 0) : Math.floor(Math.random() * 1000);
  const timeAgo = artwork && artwork.updated_at ? formatTimeAgo(artwork.updated_at) : (artwork && artwork.created_at ? formatTimeAgo(artwork.created_at) : '');
  
  // 生成参与者头像HTML
  let participantsHTML = '';
  if (artwork && artwork.participants && artwork.participants.length > 0) {
    const maxShow = 3;
    const participants = artwork.participants.slice(0, maxShow);
    participantsHTML = participants.map(p => {
      const avatarUrl = createAvatarSVG(p.id, p.display_name, 24, p.username);
      return `<img src="${avatarUrl}" class="gallery-avatar" title="${p.display_name || p.username}">`;
    }).join('');
    
    if (artwork.participants.length > maxShow) {
      participantsHTML += `<span class="more-participants">+${artwork.participants.length - maxShow}</span>`;
    }
  } else {
    participantsHTML = `<img src="${createAvatarSVG('1', 'Guest', 24, 'Guest')}" class="gallery-avatar">`;
  }
  
  card.innerHTML = `
    <div class="gallery-image">
      <canvas class="gallery-canvas" width="200" height="200"></canvas>
      ${timeAgo ? `<div class="gallery-time">${timeAgo}</div>` : ''}
    </div>
    <div class="gallery-footer">
      <div class="gallery-participants">
        ${participantsHTML}
        <span class="participant-count">${participantCount} ${participantCount === 1 ? 'artist' : 'artists'}</span>
      </div>
      <span class="gallery-likes">♡ ${likes}+</span>
    </div>
  `;
  
  container.appendChild(card);
  
  // 绘制内容
  const canvas = card.querySelector('.gallery-canvas');
  const ctx = canvas.getContext('2d');
  
  if (artwork && artwork.image_data) {
    // 加载真实图片
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 200, 200);
    };
    img.src = artwork.image_data;
  } else {
    // 绘制示例图案
    drawSampleArt(ctx, index);
  }
}

// 加载所有会话房间
async function loadSessionRooms(page = 1) {
  try {
    const response = await fetch(`/api/sessions?page=${page}&pageSize=${sessionsPageSize}`);
    const data = await response.json();
    sessionsPage = data.page;
    sessionsTotalPages = data.totalPages;
    const sessions = data.sessions || data;
    
    const streamList = document.querySelector('.stream-list');
    if (!streamList) return;
    
    // 清空现有房间（保留创建新作品按钮）
    const createNewCard = streamList.querySelector('.create-new-card');
    streamList.innerHTML = '';
    if (createNewCard) {
      streamList.appendChild(createNewCard);
    }
    
    // 添加所有会话房间
    if (sessions.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'empty-hint';
      emptyHint.textContent = 'No drawing rooms yet, create one to get started!';
      streamList.appendChild(emptyHint);
      return;
    }
    
    sessions.forEach(session => {
      createSessionCard(streamList, session);
    });
    
    // 更新头部的分页控件
    updateSessionsPageControl(data.page, data.totalPages);
    
    // 启动定时刷新在线人数
    startSessionOnlineCountPolling();
  } catch (error) {
    console.error('Failed to load session rooms:', error);
  }
}

// 定时刷新会话在线人数
let sessionPollingInterval = null;

function startSessionOnlineCountPolling() {
  // 清除之前的定时器
  if (sessionPollingInterval) {
    clearInterval(sessionPollingInterval);
  }
  
  // 每5秒刷新一次在线人数
  sessionPollingInterval = setInterval(async () => {
    // 只在选择房间页面时刷新
    if (currentPage !== 'selectStreamPage') {
      return;
    }
    
    try {
      const response = await fetch('/api/sessions');
      const sessions = await response.json();
      
      // 更新每个会话的在线人数显示
      sessions.forEach(session => {
        const countElement = document.querySelector(`.session-user-count[data-session-id="${session.id}"]`);
        if (countElement) {
          countElement.textContent = session.online_users || 0;
        }
      });
    } catch (error) {
      console.error('Failed to update session online counts:', error);
    }
  }, 5000);
}

// 创建会话卡片
function createSessionCard(container, session) {
  const card = document.createElement('div');
  card.className = 'stream-card session-card';
  card.setAttribute('data-session-id', session.id);
  
  const createdTime = new Date(session.created_at).toLocaleString('en-US');
  const actionCount = session.action_count || 0;
  
  const onlineUsers = session.online_users || 0;
  
  card.innerHTML = `
    <div class="stream-preview">
      <canvas class="session-preview-canvas" width="200" height="200" data-session-id="${session.id}"></canvas>
      <div class="session-online-badge">
        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12,5.5A3.5,3.5 0 0,1 15.5,9A3.5,3.5 0 0,1 12,12.5A3.5,3.5 0 0,1 8.5,9A3.5,3.5 0 0,1 12,5.5M5,8C5.56,8 6.08,8.15 6.53,8.42C6.38,9.85 6.8,11.27 7.66,12.38C7.16,13.34 6.16,14 5,14A3,3 0 0,1 2,11A3,3 0 0,1 5,8M19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14C17.84,14 16.84,13.34 16.34,12.38C17.2,11.27 17.62,9.85 17.47,8.42C17.92,8.15 18.44,8 19,8M5.5,18.25C5.5,16.18 8.41,14.5 12,14.5C15.59,14.5 18.5,16.18 18.5,18.25V20H5.5V18.25M0,20V18.5C0,17.11 1.89,15.94 4.45,15.6C3.86,16.28 3.5,17.22 3.5,18.25V20H0M24,20H20.5V18.25C20.5,17.22 20.14,16.28 19.55,15.6C22.11,15.94 24,17.11 24,18.5V20Z"/></svg>
        <span class="session-user-count" data-session-id="${session.id}">${onlineUsers}</span>
      </div>
    </div>
    <div class="session-info">
      <div class="session-title">${session.name || 'Untitled Work'}</div>
      <div class="session-meta">
        <span>📝 ${actionCount} strokes</span>
        <span>🕒 ${createdTime}</span>
      </div>
    </div>
    <div class="session-actions">
      <button class="join-session-btn" onclick="joinSession('${session.id}')">
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
      </button>
      <button class="delete-session-btn" onclick="deleteSession('${session.id}', event)">
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
      </button>
    </div>
  `;
  
  container.appendChild(card);
  
  // 加载并重绘会话预览
  loadSessionPreview(session.id);
}

// 加载会话预览
async function loadSessionPreview(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/actions`);
    const actions = await response.json();
    
    const canvas = document.querySelector(`.session-preview-canvas[data-session-id="${sessionId}"]`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // 填充白色背景
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 200, 200);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // 重绘所有动作
    actions.forEach(action => {
      if (action.action_type === 'draw') {
        const data = JSON.parse(action.data);
        ctx.beginPath();
        ctx.strokeStyle = data.color;
        ctx.lineWidth = data.size * 0.5; // 缩小线条以适应预览
        ctx.moveTo(data.startX * 0.5, data.startY * 0.5); // 缩放坐标
        ctx.lineTo(data.endX * 0.5, data.endY * 0.5);
        ctx.stroke();
      } else if (action.action_type === 'clear') {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 200, 200);
      }
    });
    
    // 如果没有绘画动作，显示空白提示
    if (actions.length === 0) {
      ctx.fillStyle = '#ccc';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Empty Canvas', 100, 100);
    }
  } catch (error) {
    console.error('Failed to load session preview:', error);
  }
}

// 加入会话
async function joinSession(targetSessionId) {
  if (!currentUser) {
    showToast('Please login first');
    return;
  }
  
  // 更新全局会话ID
  sessionId = targetSessionId;
  
  showToast('Joining room...');
  
  // 清空当前画布
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  
  // 跳转到绘画页面
  showPage('drawPage');
  
  // 确保canvas已经初始化
  setTimeout(() => {
    if (canvas && ctx) {
      resizeCanvas();
    }
    
    // 如果已经有 WebSocket 连接，发送加入会话消息
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'join_session',
        sessionId: targetSessionId
      }));
    } else {
      // 否则重新连接
      connectWebSocket();
    }
  }, 100);
}

// 删除会话
async function deleteSession(sessionId, event) {
  if (event) {
    event.stopPropagation(); // Prevent event bubbling
  }
  
  if (!confirm('Are you sure you want to delete this drawing room?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('✅ Room deleted');
      // 重新加载房间列表
      loadSessionRooms();
    } else {
      showToast('Delete failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to delete session:', error);
    showToast('Delete failed, please try again later');
  }
}

// 绘制示例艺术
function drawSampleArt(ctx, seed = 0) {
  const colors = ['#F4C542', '#E88B7F', '#6B4BA3'];
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  
  // 根据seed稍微变化位置，让每个卡片看起来不同
  const offset = seed * 10;
  
  colors.forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 0.2; // 根据画布大小调整线条粗细
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    ctx.moveTo(width * 0.25 + i * (width * 0.1) + offset, height * 0.3 + i * (height * 0.15));
    ctx.lineTo(width * 0.75 + i * (width * 0.05), height * 0.7 + i * (height * 0.1));
    ctx.stroke();
  });
}

// 更新预览画布
function updatePreviewCanvas() {
  const previewCanvas = document.getElementById('previewCanvas');
  if (!previewCanvas || !canvas) return;
  
  const previewCtx = previewCanvas.getContext('2d');
  previewCanvas.width = canvas.width;
  previewCanvas.height = canvas.height;
  
  // 复制主画布内容到预览画布
  previewCtx.drawImage(canvas, 0, 0);
}

// 保存当前绘画（不发布，保存为私有作品）
async function saveCurrentDrawing() {
  if (!currentUser) {
    showToast('Please login first');
    return;
  }
  
  if (!sessionId) {
    showToast('No active drawing session');
    return;
  }
  
  if (!canvas) {
    showToast('Nothing to save');
    return;
  }
  
  try {
    const title = prompt('Give your artwork a title:') || 'Untitled';
    
    // 将canvas转换为base64图片
    const imageData = canvas.toDataURL('image/png');
    
    const response = await fetch('/api/artworks/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        sessionId: sessionId,
        title: title,
        imageData: imageData
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('✅ Artwork saved!');
      // 更新个人主页的作品列表
      loadUserArtworks();
    } else {
      showToast('Save failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to save:', error);
    showToast('Save failed, please try again later');
  }
}

// 创建新的绘画作品
async function createNewDrawing() {
  if (!currentUser) {
    showToast('Please login first');
    return;
  }
  
  if (confirm('Are you sure you want to create a new drawing? Current canvas will be cleared.')) {
    try {
      const response = await fetch('/api/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          title: `New Drawing ${new Date().toLocaleString('en-US')}`
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 更新当前会话ID
        sessionId = data.sessionId;
        
        // 清空画布
        clearCanvas(false);
        
        // 通过 WebSocket 加入新会话
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'join_session',
            sessionId: sessionId
          }));
        }
        
        showToast('✅ New drawing created!');
      } else {
        showToast('Create failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create new drawing:', error);
      showToast('Create failed, please try again later');
    }
  }
}

// 创建新作品并开始绘画（从选择房间界面）
async function createNewDrawingAndStart() {
  if (!currentUser) {
    showToast('Please login first');
    showPage('loginPage');
    return;
  }
  
  try {
    const response = await fetch('/api/sessions/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        title: `New Drawing ${new Date().toLocaleString('en-US')}`
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新当前会话ID
      sessionId = data.sessionId;
      
      // 清空画布
      if (canvas && ctx) {
        clearCanvas(false);
      }
      
      showToast('✅ New drawing created!');
      
      // 跳转到绘画页面
      showPage('drawPage');
      
      // 加入新创建的会话
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'join_session',
          sessionId: sessionId
        }));
      }
    } else {
      showToast('Create failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to create new drawing:', error);
    showToast('Create failed, please try again later');
  }
}

// 发布作品
async function publishDrawing() {
  if (!currentUser) {
    showToast('Please login first');
    showPage('loginPage');
    return;
  }
  
  if (!canvas) {
    showToast('Nothing to publish');
    return;
  }
  
  try {
    const title = document.getElementById('artworkTitle').value.trim() || 'Untitled';
    
    // 将canvas转换为base64图片
    const imageData = canvas.toDataURL('image/png');
    
    const response = await fetch('/api/artworks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        sessionId: sessionId,
        title: title,
        imageData: imageData
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('✅ Artwork published!');
      
      // 清空标题输入框
      document.getElementById('artworkTitle').value = '';
      
      // 重新加载画廊
      loadGallery();
      
      // 跳转到首页
      setTimeout(() => {
        showPage('explorePage');
      }, 1500);
    } else {
      showToast('Publish failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to publish artwork:', error);
    showToast('Publish failed, please try again later');
  }
}

// 当前查看的作品ID
let currentArtworkId = null;

// 加载作品详情
async function loadArtworkDetail(artworkId) {
  if (!artworkId) return;
  
  currentArtworkId = artworkId;
  
  try {
    // 加载作品信息
    const response = await fetch(`/api/artworks/${artworkId}`);
    const artwork = await response.json();
    
    if (artwork.error) {
      showToast('Failed to load artwork');
      return;
    }
    
    // 更新标题
    document.getElementById('detailTitle').textContent = artwork.title || 'Untitled';
    document.getElementById('detailLikesCount').textContent = artwork.likes_count || 0;
    
    // 显示所有参与者头像
    const userInfoDiv = document.querySelector('#detailPage .user-info');
    if (userInfoDiv && artwork.participants) {
      let participantsHTML = '';
      artwork.participants.forEach(p => {
        const avatarUrl = createAvatarSVG(p.id, p.display_name, 40, p.username);
        participantsHTML += `<img src="${avatarUrl}" class="avatar participant-avatar" title="${p.display_name || p.username}">`;
      });
      
      const participantInfo = `
        <div class="participants-group">
          ${participantsHTML}
        </div>
        <div class="participant-info">
          <span class="participant-count">${artwork.participant_count} ${artwork.participant_count === 1 ? 'artist' : 'artists'}</span>
          ${artwork.updated_at ? `<span class="update-time">${formatTimeAgo(artwork.updated_at)}</span>` : ''}
        </div>
      `;
      userInfoDiv.innerHTML = participantInfo;
    }
    
    // 加载并显示图片
    const detailCanvas = document.getElementById('detailCanvas');
    if (detailCanvas && artwork.image_data) {
      const ctx = detailCanvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        detailCanvas.width = img.width;
        detailCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = artwork.image_data;
    }
    
    // 更新Join按钮
    updateJoinButton(artwork);
    
    // 检查是否已点赞
    if (currentUser) {
      checkLikeStatus(artworkId);
    }
    
    // 加载评论
    loadComments(artworkId);
    
    // 显示详情页
    showPage('detailPage');
    
    // 初始化详情页事件监听器
    setTimeout(() => {
      initDetailPageEvents(artwork);
    }, 100);
    
  } catch (error) {
    console.error('Failed to load artwork details:', error);
    showToast('Load failed, please try again later');
  }
}

// 更新Join按钮
function updateJoinButton(artwork) {
  const actionsDiv = document.querySelector('#detailPage .detail-actions');
  if (!actionsDiv) return;
  
  // 检查是否已有Join按钮
  let joinBtn = document.getElementById('detailJoinBtn');
  if (!joinBtn) {
    joinBtn = document.createElement('button');
    joinBtn.id = 'detailJoinBtn';
    joinBtn.className = 'join-btn';
    joinBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/></svg>
      <span>Join</span>
    `;
    actionsDiv.insertBefore(joinBtn, actionsDiv.firstChild);
  }
  
  // 更新按钮文本
  joinBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M20.71,4.63L19.37,3.29C19,2.9 18.35,2.9 17.96,3.29L9,12.25L11.75,15L20.71,6.04C21.1,5.65 21.1,5 20.71,4.63M7,14A3,3 0 0,0 4,17C4,18.31 2.84,19 2,19C2.92,20.22 4.5,21 6,21A4,4 0 0,0 10,17A3,3 0 0,0 7,14Z"/></svg>
    <span>Join & Draw</span>
  `;
  
  // 设置点击事件
  joinBtn.onclick = () => {
    if (!currentUser) {
      showToast('Please login first');
      showPage('loginPage');
      return;
    }
    
    if (artwork.session_id) {
      // 更新绘画页面标题
      const drawPageTitle = document.getElementById('drawPageTitle');
      if (drawPageTitle) {
        drawPageTitle.textContent = artwork.title || 'Drawing Room';
      }
      
      joinSession(artwork.session_id);
    } else {
      showToast('Cannot join this artwork');
    }
  };
}

// 检查点赞状态
async function checkLikeStatus(artworkId) {
  if (!currentUser) return;
  
  try {
    const response = await fetch(`/api/artworks/${artworkId}/like/${currentUser.id}`);
    const data = await response.json();
    
    const likeBtn = document.getElementById('detailLikeBtn');
    if (likeBtn) {
      if (data.liked) {
        likeBtn.classList.add('liked');
      } else {
        likeBtn.classList.remove('liked');
      }
    }
  } catch (error) {
    console.error('Failed to check like status:', error);
  }
}

// 点赞/取消点赞
async function toggleLike() {
  if (!currentUser) {
    showToast('Please login first');
    return;
  }
  
  if (!currentArtworkId) return;
  
  try {
    const response = await fetch(`/api/artworks/${currentArtworkId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    
    const data = await response.json();
    
    if (data.success) {
      const likeBtn = document.getElementById('detailLikeBtn');
      const likesCount = document.getElementById('detailLikesCount');
      
      if (data.liked) {
        likeBtn.classList.add('liked');
        likesCount.textContent = parseInt(likesCount.textContent) + 1;
        showToast('❤️ Liked');
      } else {
        likeBtn.classList.remove('liked');
        likesCount.textContent = Math.max(0, parseInt(likesCount.textContent) - 1);
        showToast('Like removed');
      }
    } else {
      showToast('Operation failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to like:', error);
    showToast('Operation failed, please try again later');
  }
}

// 加载评论列表
async function loadComments(artworkId) {
  try {
    const response = await fetch(`/api/artworks/${artworkId}/comments`);
    const comments = await response.json();
    
    const commentsList = document.getElementById('commentsList');
    const commentsHeader = document.getElementById('commentsHeader');
    
    if (!commentsList || !commentsHeader) return;
    
    // 更新评论数量
    commentsHeader.textContent = `${comments.length} ${comments.length === 1 ? 'Comment' : 'Comments'}`;
    
    // 清空现有评论
    commentsList.innerHTML = '';
    
    // 添加评论
    if (comments.length === 0) {
      commentsList.innerHTML = '<div class="no-comments">No comments yet, be the first to comment!</div>';
    } else {
      comments.forEach(comment => {
        const commentItem = createCommentElement(comment);
        commentsList.appendChild(commentItem);
      });
    }
  } catch (error) {
    console.error('Failed to load comments:', error);
  }
}

// 创建评论元素
function createCommentElement(comment) {
  const div = document.createElement('div');
  div.className = 'comment-item';
  
  const timeStr = new Date(comment.created_at).toLocaleString('en-US');
  
  div.innerHTML = `
    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23c58882'/%3E%3C/svg%3E" class="comment-avatar">
    <div class="comment-content">
      <div class="comment-user">${comment.display_name || comment.username}</div>
      <div class="comment-text">${escapeHtml(comment.content)}</div>
      <div class="comment-time">${timeStr}</div>
    </div>
  `;
  
  return div;
}

// 转义HTML以防止XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 提交评论
async function submitComment() {
  if (!currentUser) {
    showToast('Please login first');
    return;
  }
  
  if (!currentArtworkId) return;
  
  const commentInput = document.getElementById('commentInput');
  if (!commentInput) return;
  
  const content = commentInput.value.trim();
  
  if (!content) {
    showToast('Please enter comment content');
    return;
  }
  
  try {
    const response = await fetch(`/api/artworks/${currentArtworkId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        content: content
      })
    });
    
    const data = await response.json();
    
    if (data.success && data.comment) {
      // 清空输入框
      commentInput.value = '';
      
      // 重新加载评论列表
      loadComments(currentArtworkId);
      
      showToast('✅ Comment published');
    } else {
      showToast('Comment failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Failed to comment:', error);
    showToast('Comment failed, please try again later');
  }
}

// 初始化详情页事件监听器
function initDetailPageEvents(artwork) {
  // 移除旧的事件监听器（如果有）
  const likeBtn = document.getElementById('detailLikeBtn');
  if (likeBtn) {
    const newLikeBtn = likeBtn.cloneNode(true);
    likeBtn.parentNode.replaceChild(newLikeBtn, likeBtn);
    newLikeBtn.addEventListener('click', toggleLike);
  }
  
  // 提交评论按钮
  const submitCommentBtn = document.getElementById('submitCommentBtn');
  if (submitCommentBtn) {
    const newSubmitBtn = submitCommentBtn.cloneNode(true);
    submitCommentBtn.parentNode.replaceChild(newSubmitBtn, submitCommentBtn);
    newSubmitBtn.addEventListener('click', submitComment);
  }
  
  // 评论输入框回车提交
  const commentInput = document.getElementById('commentInput');
  if (commentInput) {
    const newCommentInput = commentInput.cloneNode(true);
    commentInput.parentNode.replaceChild(newCommentInput, commentInput);
    newCommentInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitComment();
      }
    });
  }
}

// 显示提示
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ==================== 登录注册功能 ====================

function showLoginForm() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
}

// 登录
async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showToast('Please enter username and password');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      currentUser = data.user;
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      
      showToast(`Welcome, ${data.user.displayName}!`);
      
      // 连接WebSocket并加载数据
      connectWebSocket();
      loadGallery();
      updateUserInfo();
      
      // 跳转到主页
      setTimeout(() => {
        showPage('explorePage');
      }, 1000);
    } else {
      showToast(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showToast('Login failed, please try again later');
  }
}

// 注册
async function handleRegister() {
  const username = document.getElementById('registerUsername').value.trim();
  const displayName = document.getElementById('registerDisplayName').value.trim();
  const password = document.getElementById('registerPassword').value;
  const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

  if (!username || !password) {
    showToast('Please enter username and password');
    return;
  }

  if (password !== passwordConfirm) {
    showToast('Passwords do not match');
    return;
  }

  if (password.length < 6) {
    showToast('Password must be at least 6 characters');
    return;
  }

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username, 
        password,
        displayName: displayName || username
      })
    });

    const data = await response.json();

    if (data.success) {
      showToast('Registration successful! Please login');
      
      // 清空注册表单
      document.getElementById('registerUsername').value = '';
      document.getElementById('registerDisplayName').value = '';
      document.getElementById('registerPassword').value = '';
      document.getElementById('registerPasswordConfirm').value = '';
      
      // 切换到登录表单
      setTimeout(() => {
        showLoginForm();
        document.getElementById('loginUsername').value = username;
      }, 1500);
    } else {
      showToast(data.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Registration error:', error);
    showToast('Registration failed, please try again later');
  }
}

// 退出登录
function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  if (ws) {
    ws.close();
  }
  showToast('Logged out successfully');
  setTimeout(() => {
    showPage('loginPage');
  }, 1000);
}

// Clear all app data (keep user info)
async function clearAppData() {
  const confirmed = confirm('⚠️ WARNING: This will clear all artworks, rooms and comments data, but keep user accounts.\n\nThis action cannot be undone. Are you sure you want to continue?');
  
  if (!confirmed) return;
  
  const doubleConfirm = confirm('🚨 FINAL CONFIRMATION: Are you sure you want to clear all data?\n\nThis includes:\n• All artworks\n• All drawing rooms\n• All comments and likes\n• Home page content\n\nUser accounts will be preserved.');
  
  if (!doubleConfirm) return;
  
  try {
    showToast('Clearing data...', 'info');
    
    const response = await fetch('/api/clear-app-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: currentUser?.id
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      showToast('Data cleared successfully! Page will refresh...', 'success');
      
      // Clear frontend cache
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      const error = await response.json();
      showToast(`Clear failed: ${error.message || 'Server error'}`, 'error');
    }
  } catch (error) {
    console.error('Clear data error:', error);
    showToast('Clear failed: Network error', 'error');
  }
}

// 更新用户信息显示
function updateUserInfo() {
  if (!currentUser) return;
  
  // 更新用户名
  document.querySelectorAll('.username').forEach(el => {
    el.textContent = currentUser.displayName || currentUser.username;
  });
  
  // 更新个人主页的头像和信息
  const profileAvatar = document.querySelector('.profile-avatar');
  if (profileAvatar) {
    const avatarUrl = createAvatarSVG(currentUser.id, currentUser.displayName, 60, currentUser.username);
    profileAvatar.src = avatarUrl;
  }
  
  // 更新个人主页的用户名
  const profileUsername = document.querySelector('.profile-info h2');
  if (profileUsername) {
    profileUsername.textContent = currentUser.displayName || currentUser.username;
  }
  
  // 更新ID显示
  document.querySelectorAll('.profile-id').forEach(el => {
    el.textContent = `ID: ${currentUser.id}`;
  });
}

// 加载用户作品
async function loadUserArtworks(page = 1) {
  if (!currentUser) return;
  
  try {
    const response = await fetch(`/api/users/${currentUser.id}/artworks?page=${page}&pageSize=${profilePageSize}`);
    const data = await response.json();
    profilePage = data.page;
    profileTotalPages = data.totalPages;
    const artworks = data.artworks || data;
    
    const profileWorksContainer = document.querySelector('.profile-works');
    if (!profileWorksContainer) return;
    
    // 清空现有作品
    profileWorksContainer.innerHTML = '';
    
    if (artworks.length === 0) {
      profileWorksContainer.innerHTML = '<div class="no-artworks" style="grid-column: 1/-1; text-align: center; color: #999; padding: 30px;">No artworks yet, start creating!</div>';
      return;
    }
    
    // 显示用户的作品
    artworks.forEach(artwork => {
      const workItem = document.createElement('div');
      workItem.className = 'work-item';
      workItem.onclick = () => loadArtworkDetail(artwork.id);
      
      const participantCount = artwork.participant_count || 1;
      const timeAgo = artwork.updated_at ? formatTimeAgo(artwork.updated_at) : '';
      
      workItem.innerHTML = `
        <canvas class="work-canvas" width="200" height="200"></canvas>
        ${timeAgo ? `<div class="work-time">${timeAgo}</div>` : ''}
        <div class="work-footer">
          <span class="work-title">${artwork.title || 'Untitled'}</span>
          <div class="work-meta">
            <span class="work-participants">${participantCount} ${participantCount === 1 ? 'artist' : 'artists'}</span>
            <span class="work-likes">♡ ${artwork.likes_count || 0}</span>
          </div>
        </div>
      `;
      
      profileWorksContainer.appendChild(workItem);
      
      // 加载作品图片
      const workCanvas = workItem.querySelector('.work-canvas');
      const ctx = workCanvas.getContext('2d');
      
      if (artwork.image_data) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, 200, 200);
        };
        img.src = artwork.image_data;
      }
    });
    
    // 更新顶部的分页控件
    updateProfilePageControl(data.page, data.totalPages);
  } catch (error) {
    console.error('Failed to load user artworks:', error);
  }
}

// 更新探索页面的分页控件（在header右侧）
function updateExplorePageControl(currentPage, totalPages) {
  const header = document.querySelector('#explorePage .header');
  if (!header) return;
  
  // 移除旧的分页控件
  let pageControl = header.querySelector('.page-control');
  if (pageControl) {
    pageControl.remove();
  }
  
  // 如果只有一页，不显示分页
  if (totalPages <= 1) return;
  
  // 创建新的分页控件
  pageControl = document.createElement('div');
  pageControl.className = 'page-control';
  
  // 上一页
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-nav-btn';
  prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.onclick = () => {
    if (currentPage > 1) loadGallery(currentPage - 1);
  };
  pageControl.appendChild(prevBtn);
  
  // 页码显示
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `${currentPage}/${totalPages}`;
  pageControl.appendChild(pageInfo);
  
  // 下一页
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-nav-btn';
  nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.onclick = () => {
    if (currentPage < totalPages) loadGallery(currentPage + 1);
  };
  pageControl.appendChild(nextBtn);
  
  header.appendChild(pageControl);
}

// 更新个人主页的分页控件（在header右侧，退出按钮左边）
function updateProfilePageControl(currentPage, totalPages) {
  const header = document.querySelector('#profilePage .header');
  if (!header) return;
  
  // 移除旧的分页控件
  let pageControl = header.querySelector('.page-control-profile');
  if (pageControl) {
    pageControl.remove();
  }
  
  // 如果只有一页，不显示分页
  if (totalPages <= 1) return;
  
  // 创建新的分页控件
  pageControl = document.createElement('div');
  pageControl.className = 'page-control-profile';
  
  // 上一页
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-nav-btn';
  prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.onclick = () => {
    if (currentPage > 1) loadUserArtworks(currentPage - 1);
  };
  pageControl.appendChild(prevBtn);
  
  // 页码显示
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `${currentPage}/${totalPages}`;
  pageControl.appendChild(pageInfo);
  
  // 下一页
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-nav-btn';
  nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.onclick = () => {
    if (currentPage < totalPages) loadUserArtworks(currentPage + 1);
  };
  pageControl.appendChild(nextBtn);
  
  // 插入到退出按钮前面
  const logoutBtn = header.querySelector('.logout-btn-header');
  if (logoutBtn) {
    header.insertBefore(pageControl, logoutBtn);
  } else {
    header.appendChild(pageControl);
  }
}



