// Avatar Helper - Generate Outlook-style avatars from user IDs

function getAvatarColor(userId) {
  // Generate color based on user ID
  const colors = [
    '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3',
    '#00BCD4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
    '#FFC107', '#FF9800', '#FF5722', '#795548', '#607D8B'
  ];
  
  const numId = parseInt(userId) || 0;
  return colors[numId % colors.length];
}

function getUserInitials(userId, displayName, username) {
  // Use display name or username to generate initials
  const name = displayName || username || 'User';
  
  // Split by space or special characters
  const parts = name.trim().split(/[\s_-]+/);
  
  if (parts.length >= 2) {
    // If has multiple parts, use first letter of first two parts
    return (parts[0][0] + parts[1][0]).toUpperCase();
  } else if (parts[0].length >= 2) {
    // If single part with 2+ chars, use first two letters
    return parts[0].substring(0, 2).toUpperCase();
  } else {
    // Fallback to first char + U
    return (parts[0][0] + 'U').toUpperCase();
  }
}

function createAvatarSVG(userId, displayName, size = 40, username = '') {
  const color = getAvatarColor(userId);
  const initials = getUserInitials(userId, displayName, username);
  const fontSize = size * 0.4;
  
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'%3E%3Ccircle cx='${size/2}' cy='${size/2}' r='${size/2}' fill='${encodeURIComponent(color)}'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='0.35em' fill='white' font-family='Arial,sans-serif' font-size='${fontSize}' font-weight='600'%3E${initials}%3C/text%3E%3C/svg%3E`;
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

