#!/bin/bash

# DrawSocket 数据备份脚本

echo "========================================="
echo "  DrawSocket - 数据备份"
echo "========================================="
echo ""

# 创建备份目录
BACKUP_DIR="backups"
mkdir -p $BACKUP_DIR

# 生成时间戳
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 备份数据库
if [ -f "drawings.db" ]; then
    echo "💾 备份数据库..."
    cp drawings.db "$BACKUP_DIR/drawings_${TIMESTAMP}.db"
    echo "✓ 数据库已备份到: $BACKUP_DIR/drawings_${TIMESTAMP}.db"
else
    echo "⚠️  数据库文件不存在"
fi

echo ""

# 清理旧备份（保留最近10个）
echo "🗑️  清理旧备份..."
cd $BACKUP_DIR
ls -t drawings_*.db | tail -n +11 | xargs -r rm
cd ..

BACKUP_COUNT=$(ls -1 $BACKUP_DIR/drawings_*.db 2>/dev/null | wc -l)
echo "✓ 当前保留 $BACKUP_COUNT 个备份文件"

echo ""
echo "========================================="
echo "  备份完成！"
echo "========================================="

