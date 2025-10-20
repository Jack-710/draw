// 更新房间列表页的分页控件（在Create New Drawing下面）
function updateSessionsPageControl(currentPage, totalPages) {
  const streamList = document.querySelector('.stream-list');
  if (!streamList) return;
  
  // 移除旧的分页控件
  let pageControl = streamList.querySelector('.page-control-sessions');
  if (pageControl) {
    pageControl.remove();
  }
  
  // 如果只有一页，不显示分页
  if (totalPages <= 1) return;
  
  // 创建新的分页控件
  pageControl = document.createElement('div');
  pageControl.className = 'page-control-sessions';
  
  // 上一页
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-nav-btn';
  prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.onclick = () => {
    if (currentPage > 1) loadSessionRooms(currentPage - 1);
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
    if (currentPage < totalPages) loadSessionRooms(currentPage + 1);
  };
  pageControl.appendChild(nextBtn);
  
  // 插入到Create New Card后面
  const createNewCard = streamList.querySelector('.create-new-card');
  if (createNewCard && createNewCard.nextSibling) {
    streamList.insertBefore(pageControl, createNewCard.nextSibling);
  } else {
    streamList.appendChild(pageControl);
  }
}

