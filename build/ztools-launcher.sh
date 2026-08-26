#!/usr/bin/env sh

# ZTools 命令行唤起启动器。
# 打包时被 electron-builder 放入应用 resources/ztools/ 目录，
# 安装器会将 /usr/bin/ztools 符号链接指向本脚本。

# 脚本实际所在目录（resources/ztools）。通过符号链接调用时先解析真实路径。
# macOS 自带的 readlink 不支持 -f，这里逐层解析相对/绝对目标并限制深度，
# 避免死链或循环链导致脚本卡死。
SCRIPT_PATH=$0
SCRIPT_DEPTH=0
while [ -L "$SCRIPT_PATH" ]; do
  SCRIPT_LINK=$(readlink "$SCRIPT_PATH")
  case "$SCRIPT_LINK" in
    /*) SCRIPT_PATH=$SCRIPT_LINK ;;
    *) SCRIPT_PATH=$(dirname -- "$SCRIPT_PATH")/$SCRIPT_LINK ;;
  esac
  SCRIPT_DEPTH=$((SCRIPT_DEPTH + 1))
  if [ "$SCRIPT_DEPTH" -gt 40 ]; then
    echo "符号链接解析深度超限: $0" >&2
    exit 1
  fi
done
# pwd -P 输出物理路径，确保目录部分也不残留符号链接。
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P)

# 依次探测 Linux 与 macOS 打包布局中的真实可执行文件。
# 只接受普通文件（-f），避免像旧版那样把 resources/ztools 目录当作可执行文件 exec。
for BIN in \
  "$SCRIPT_DIR/../../MacOS/ZTools" \
  "$SCRIPT_DIR/../../ztools" \
  "$SCRIPT_DIR/../../ZTools"
do
  if [ -f "$BIN" ] && [ -x "$BIN" ]; then
    exec "$BIN" --ztools-wake
  fi
done

echo "未找到 ZTools 可执行文件（已探测 $SCRIPT_DIR/../../MacOS/ZTools、$SCRIPT_DIR/../../ztools、$SCRIPT_DIR/../../ZTools）" >&2
exit 1
