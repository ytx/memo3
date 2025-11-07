#!/bin/bash

# エラー時に即座に終了
set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== memo3 Release Script ===${NC}\n"

# 現在のバージョンを取得
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "Current version: ${GREEN}${CURRENT_VERSION}${NC}\n"

# バージョン番号を分解
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# バージョン選択肢を計算
VERSION_AS_IS="$CURRENT_VERSION"
VERSION_PATCH="$MAJOR.$MINOR.$((PATCH + 1))"
VERSION_MINOR="$MAJOR.$((MINOR + 1)).0"
VERSION_MAJOR="$((MAJOR + 1)).0.0"

# バージョン選択
echo "Select version to release:"
echo "  0: as is       (${VERSION_AS_IS})"
echo "  1: patch       (${VERSION_PATCH})"
echo "  2: minor       (${VERSION_MINOR})"
echo "  3: major       (${VERSION_MAJOR})"
echo ""
read -p "Enter choice [0-3]: " CHOICE

case $CHOICE in
  0)
    NEW_VERSION="$VERSION_AS_IS"
    ;;
  1)
    NEW_VERSION="$VERSION_PATCH"
    ;;
  2)
    NEW_VERSION="$VERSION_MINOR"
    ;;
  3)
    NEW_VERSION="$VERSION_MAJOR"
    ;;
  *)
    echo -e "${RED}Invalid choice. Exiting.${NC}"
    exit 1
    ;;
esac

echo -e "\n${GREEN}Selected version: ${NEW_VERSION}${NC}\n"

# バージョンが変更される場合のみpackage.jsonを更新
if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
  echo -e "${BLUE}Updating package.json...${NC}"

  # package.jsonのバージョンを更新
  npm version "$NEW_VERSION" --no-git-tag-version

  # git commit と tag を作成
  echo -e "${BLUE}Creating git commit and tag...${NC}"
  git add package.json package-lock.json
  git commit -m "chore: bump version to ${NEW_VERSION}"
  git tag "v${NEW_VERSION}"

  echo -e "${GREEN}Version updated and committed.${NC}\n"
else
  echo -e "${YELLOW}Version unchanged (as is).${NC}\n"
fi

# ビルド実行
echo -e "${BLUE}Running npm run build-all...${NC}"
rm -rf dist
npm run build-all

if [ $? -ne 0 ]; then
  echo -e "${RED}Build failed. Exiting.${NC}"
  exit 1
fi

echo -e "${GREEN}Build completed successfully.${NC}\n"

# ビルド成果物の確認
if [ ! -d "dist" ]; then
  echo -e "${RED}dist directory not found. Exiting.${NC}"
  exit 1
fi

DMG_COUNT=$(ls dist/*.dmg 2>/dev/null | wc -l)
EXE_COUNT=$(ls dist/*.exe 2>/dev/null | wc -l)

echo -e "${BLUE}Build artifacts:${NC}"
echo "  DMG files: $DMG_COUNT"
echo "  EXE files: $EXE_COUNT"
echo ""

if [ "$DMG_COUNT" -eq 0 ] && [ "$EXE_COUNT" -eq 0 ]; then
  echo -e "${RED}No build artifacts found. Exiting.${NC}"
  exit 1
fi

# index.html の生成
echo -e "${BLUE}Generating index.html...${NC}"

# ファイル情報を収集
DMG_FILES=(dist/*.dmg)
EXE_FILES=(dist/*.exe)

# HTMLヘッダー生成
cat > dist/index.html << EOF
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>memo3 - Download</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #333;
      font-size: 32px;
      margin-bottom: 10px;
      text-align: center;
    }
    .version {
      color: #667eea;
      font-size: 18px;
      text-align: center;
      margin-bottom: 30px;
      font-weight: 500;
    }
    .description {
      color: #666;
      text-align: center;
      margin-bottom: 40px;
      line-height: 1.6;
    }
    .downloads {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    .platform {
      margin-bottom: 20px;
    }
    .platform h2 {
      color: #555;
      font-size: 18px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #f0f0f0;
    }
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .download-link {
      display: flex;
      align-items: center;
      padding: 15px 20px;
      background: #f8f9fa;
      border-radius: 8px;
      text-decoration: none;
      color: #333;
      transition: all 0.2s;
      border: 2px solid transparent;
    }
    .download-link:hover {
      background: #667eea;
      color: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
    .download-icon {
      font-size: 24px;
      margin-right: 12px;
    }
    .download-info {
      flex: 1;
    }
    .download-name {
      font-weight: 600;
      font-size: 14px;
    }
    .download-size {
      font-size: 12px;
      opacity: 0.7;
      margin-top: 4px;
    }
    .no-files {
      color: #999;
      text-align: center;
      padding: 20px;
      font-style: italic;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      color: #999;
      font-size: 14px;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>memo3</h1>
    <div class="version">Version ${NEW_VERSION}</div>
    <div class="description">
      Electronベースのマークダウンメモアプリケーション
    </div>

    <div class="downloads">
EOF

# macOS セクション生成
if [ "$DMG_COUNT" -gt 0 ]; then
  cat >> dist/index.html << 'EOF'
      <div class="platform">
        <h2>🍎 macOS</h2>
        <div class="file-list">
EOF

  for dmg in "${DMG_FILES[@]}"; do
    if [ -f "$dmg" ]; then
      FILENAME=$(basename "$dmg")
      FILESIZE=$(du -h "$dmg" | cut -f1)
      cat >> dist/index.html << EOF
          <a href="${FILENAME}" class="download-link">
            <span class="download-icon">📦</span>
            <div class="download-info">
              <div class="download-name">${FILENAME}</div>
              <div class="download-size">${FILESIZE}</div>
            </div>
          </a>
EOF
    fi
  done

  cat >> dist/index.html << 'EOF'
        </div>
      </div>
EOF
else
  cat >> dist/index.html << 'EOF'
      <div class="platform">
        <h2>🍎 macOS</h2>
        <div class="no-files">No macOS builds available</div>
      </div>
EOF
fi

# Windows セクション生成
if [ "$EXE_COUNT" -gt 0 ]; then
  cat >> dist/index.html << 'EOF'
      <div class="platform">
        <h2>🪟 Windows</h2>
        <div class="file-list">
EOF

  for exe in "${EXE_FILES[@]}"; do
    if [ -f "$exe" ]; then
      FILENAME=$(basename "$exe")
      FILESIZE=$(du -h "$exe" | cut -f1)
      cat >> dist/index.html << EOF
          <a href="${FILENAME}" class="download-link">
            <span class="download-icon">📦</span>
            <div class="download-info">
              <div class="download-name">${FILENAME}</div>
              <div class="download-size">${FILESIZE}</div>
            </div>
          </a>
EOF
    fi
  done

  cat >> dist/index.html << 'EOF'
        </div>
      </div>
EOF
else
  cat >> dist/index.html << 'EOF'
      <div class="platform">
        <h2>🪟 Windows</h2>
        <div class="no-files">No Windows builds available</div>
      </div>
EOF
fi

# HTMLフッター生成
cat >> dist/index.html << 'EOF'
    </div>

    <div class="footer">
      <p>Built with Electron and ACE Editor</p>
    </div>
  </div>
</body>
</html>
EOF

echo -e "${GREEN}index.html generated.${NC}\n"

# アップロード
echo -e "${BLUE}Uploading to lolipop3:web/xpenguin.biz/memo3/${NC}"

# index.html をアップロード
echo "Uploading index.html..."
scp dist/index.html lolipop3:web/xpenguin.biz/memo3/

# .dmg ファイルをアップロード
if [ "$DMG_COUNT" -gt 0 ]; then
  echo "Uploading .dmg files..."
  scp dist/*.dmg lolipop3:web/xpenguin.biz/memo3/
fi

# .exe ファイルをアップロード
if [ "$EXE_COUNT" -gt 0 ]; then
  echo "Uploading .exe files..."
  scp dist/*.exe lolipop3:web/xpenguin.biz/memo3/
fi

echo -e "\n${GREEN}=== Release completed successfully! ===${NC}"
echo -e "Version: ${GREEN}${NEW_VERSION}${NC}"
echo -e "Uploaded to: ${BLUE}lolipop3:web/xpenguin.biz/memo3/${NC}"

# Git push のリマインダー
if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
  echo -e "\n${YELLOW}Don't forget to push commits and tags:${NC}"
  echo "  git push origin main"
  echo "  git push origin v${NEW_VERSION}"
fi

echo ""
