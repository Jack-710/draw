// 清空数据库脚本（保留用户信息）

const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('==========================================');
console.log('  清空数据库工具（保留用户信息）');
console.log('==========================================');
console.log('');
console.log('⚠️  警告：此操作将删除以下数据：');
console.log('  - 所有绘画会话');
console.log('  - 所有绘画动作');
console.log('  - 所有作品');
console.log('  - 所有评论');
console.log('  - 所有点赞');
console.log('');
console.log('✓ 保留：用户账号信息');
console.log('');

rl.question('确定要继续吗？(输入 yes 确认): ', (answer) => {
  if (answer.toLowerCase() !== 'yes') {
    console.log('操作已取消');
    rl.close();
    process.exit(0);
  }

  const db = new sqlite3.Database('./drawings.db', (err) => {
    if (err) {
      console.error('❌ 数据库连接失败:', err);
      rl.close();
      process.exit(1);
    }

    console.log('');
    console.log('🔄 开始清空数据...');
    console.log('');

    // 按顺序删除数据（注意外键约束）
    db.serialize(() => {
      // 1. 删除点赞
      db.run('DELETE FROM likes', function(err) {
        if (err) {
          console.error('❌ 删除点赞失败:', err);
        } else {
          console.log(`✓ 已删除 ${this.changes} 条点赞记录`);
        }
      });

      // 2. 删除评论
      db.run('DELETE FROM comments', function(err) {
        if (err) {
          console.error('❌ 删除评论失败:', err);
        } else {
          console.log(`✓ 已删除 ${this.changes} 条评论记录`);
        }
      });

      // 3. 删除作品
      db.run('DELETE FROM artworks', function(err) {
        if (err) {
          console.error('❌ 删除作品失败:', err);
        } else {
          console.log(`✓ 已删除 ${this.changes} 条作品记录`);
        }
      });

      // 4. 删除绘画动作
      db.run('DELETE FROM draw_actions', function(err) {
        if (err) {
          console.error('❌ 删除绘画动作失败:', err);
        } else {
          console.log(`✓ 已删除 ${this.changes} 条绘画动作记录`);
        }
      });

      // 5. 删除会话
      db.run('DELETE FROM sessions', function(err) {
        if (err) {
          console.error('❌ 删除会话失败:', err);
        } else {
          console.log(`✓ 已删除 ${this.changes} 条会话记录`);
        }

        // 统计剩余用户数
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
          if (err) {
            console.error('❌ 查询用户失败:', err);
          } else {
            console.log('');
            console.log('==========================================');
            console.log('  清空完成！');
            console.log('==========================================');
            console.log('');
            console.log(`✓ 保留了 ${row.count} 个用户账号`);
            console.log('');
            console.log('💡 提示：用户可以继续使用原账号登录');
          }

          db.close();
          rl.close();
        });
      });
    });
  });
});

